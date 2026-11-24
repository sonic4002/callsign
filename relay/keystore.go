package relay

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// KeyStore keeps each seat's provider key on disk, encrypted. It is the only thing the
// relay remembers. Two relays can share one directory: every write is a whole file put in
// place by rename, and every read goes to disk.
//
// A key is sealed with AES-256-GCM under the master key, and bound to its seat: the file
// is named after a hash of the seat token and the same hash is authenticated with the
// ciphertext, so a file copied onto another seat's name does not open. The seat token
// itself is never written down.
type KeyStore struct {
	dir  string
	aead cipher.AEAD
	max  int
	mu   sync.Mutex // one writer at a time in this process
}

// Stored is one seat's key, in memory only.
type Stored struct {
	Provider string `json:"provider"`
	Key      string `json:"key"`
}

type sealed struct {
	V     int    `json:"v"`
	Nonce string `json:"nonce"`
	Box   string `json:"box"`
}

var (
	ErrNoKey     = errors.New("no key is stored for this seat")
	ErrStoreFull = errors.New("the key store is full")
)

// MasterKey returns the 32-byte key that seals the store: from text (base64 or hex, as an
// environment variable gives it) when set, otherwise from <dir>/master.key, which is made
// with fresh random bytes and mode 0600 the first time.
func MasterKey(text, dir string) ([]byte, error) {
	if text = strings.TrimSpace(text); text != "" {
		for _, decode := range []func(string) ([]byte, error){hex.DecodeString, base64.StdEncoding.DecodeString, base64.RawStdEncoding.DecodeString, base64.URLEncoding.DecodeString} {
			if key, err := decode(text); err == nil && len(key) == 32 {
				return key, nil
			}
		}
		return nil, errors.New("the master key must be 32 bytes, written as hex or base64")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, "master.key")
	if data, err := os.ReadFile(path); err == nil {
		key, err := hex.DecodeString(strings.TrimSpace(string(data)))
		if err != nil || len(key) != 32 {
			return nil, fmt.Errorf("%s does not hold a 32-byte key in hex", path)
		}
		if info, err := os.Stat(path); err == nil && info.Mode().Perm()&0o077 != 0 {
			return nil, fmt.Errorf("%s can be read by others; make it mode 0600", path)
		}
		return key, nil
	} else if !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	// O_EXCL: when two relays start at once on one directory, one makes the file and the
	// other reads it.
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, fs.ErrExist) {
		return MasterKey("", dir)
	}
	if err != nil {
		return nil, err
	}
	if _, err := f.WriteString(hex.EncodeToString(key) + "\n"); err != nil {
		f.Close()
		return nil, err
	}
	return key, f.Close()
}

// OpenKeyStore opens the store under dir, holding at most max keys.
func OpenKeyStore(dir string, master []byte, max int) (*KeyStore, error) {
	block, err := aes.NewCipher(master)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	keys := filepath.Join(dir, "keys")
	if err := os.MkdirAll(keys, 0o700); err != nil {
		return nil, err
	}
	return &KeyStore{dir: keys, aead: aead, max: max}, nil
}

// SeatID is the name a seat goes by on disk and in the log: a hash of its token.
func SeatID(token string) string {
	sum := sha256.Sum256([]byte("callsign seat\x00" + token))
	return hex.EncodeToString(sum[:])
}

func (s *KeyStore) path(seat string) string { return filepath.Join(s.dir, seat+".json") }

// Put stores a seat's key, replacing the one it had.
func (s *KeyStore) Put(seat string, k Stored) error {
	plain, err := json.Marshal(k)
	if err != nil {
		return err
	}
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return err
	}
	data, err := json.Marshal(sealed{
		V:     1,
		Nonce: base64.StdEncoding.EncodeToString(nonce),
		Box:   base64.StdEncoding.EncodeToString(s.aead.Seal(nil, nonce, plain, []byte(seat))),
	})
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := os.Stat(s.path(seat)); errors.Is(err, fs.ErrNotExist) {
		entries, err := os.ReadDir(s.dir)
		if err != nil {
			return err
		}
		if len(entries) >= s.max {
			return ErrStoreFull
		}
	}
	tmp, err := os.CreateTemp(s.dir, ".put-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), s.path(seat))
}

// Get returns a seat's key, or ErrNoKey.
func (s *KeyStore) Get(seat string) (Stored, error) {
	data, err := os.ReadFile(s.path(seat))
	if errors.Is(err, fs.ErrNotExist) {
		return Stored{}, ErrNoKey
	}
	if err != nil {
		return Stored{}, err
	}
	var box sealed
	if json.Unmarshal(data, &box) != nil || box.V != 1 {
		return Stored{}, errors.New("a stored key could not be read")
	}
	nonce, err1 := base64.StdEncoding.DecodeString(box.Nonce)
	ct, err2 := base64.StdEncoding.DecodeString(box.Box)
	if err1 != nil || err2 != nil || len(nonce) != s.aead.NonceSize() {
		return Stored{}, errors.New("a stored key could not be read")
	}
	plain, err := s.aead.Open(nil, nonce, ct, []byte(seat))
	if err != nil {
		// A different master key, or a file that was moved or changed.
		return Stored{}, errors.New("a stored key could not be opened with this master key")
	}
	var k Stored
	if json.Unmarshal(plain, &k) != nil {
		return Stored{}, errors.New("a stored key could not be read")
	}
	return k, nil
}

// Delete forgets a seat's key. Forgetting one that is not there is not an error.
func (s *KeyStore) Delete(seat string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.Remove(s.path(seat)); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}
