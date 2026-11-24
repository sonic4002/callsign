package relay

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"strings"
	"time"
)

// A player token is who a browser is to the relay: the name its AI key is filed under.
// It outlives matches, so a player stores a key once. The relay makes these tokens itself
// and signs them, which is how it can refuse a made-up one without remembering any:
//
//	p1.<random id>.<HMAC-SHA256 of the id under the token key>
//
// A player token alone only reaches that player's own key (store, replace, forget, see the
// provider and last four characters). Thinking also needs the token of a seat in a match,
// which the game server checks: see think.

const playerPrefix = "p1."

// TokenKey derives the key that signs player tokens from the store's master key, so that
// tokens survive a restart and two relays sharing a store accept each other's.
func TokenKey(master []byte) []byte {
	mac := hmac.New(sha256.New, master)
	mac.Write([]byte("callsign player tokens"))
	return mac.Sum(nil)
}

func (r *Relay) sign(id string) string {
	mac := hmac.New(sha256.New, r.cfg.TokenKey)
	mac.Write([]byte(id))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// Mint makes a new player token.
func (r *Relay) Mint() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	id := base64.RawURLEncoding.EncodeToString(raw)
	return playerPrefix + id + "." + r.sign(id), nil
}

// isPlayer reports whether the relay made this token.
func (r *Relay) isPlayer(token string) bool {
	rest, ok := strings.CutPrefix(token, playerPrefix)
	id, sig, found := strings.Cut(rest, ".")
	return ok && found && len(id) >= 16 && hmac.Equal([]byte(sig), []byte(r.sign(id)))
}

// player answers POST /relay/v1/player with a new token. Anyone may ask; how fast tokens
// are handed out is bounded across all callers.
func (r *Relay) player(w http.ResponseWriter, _ *http.Request) {
	if !r.admitNewSeat() {
		r.fail(w, apiError{status: http.StatusTooManyRequests, code: codeRateLimited, message: "too many new players right now; try again in a minute", retry: 30 * time.Second})
		return
	}
	token, err := r.Mint()
	if err != nil {
		r.fail(w, apiError{status: http.StatusInternalServerError, code: codeProvider, message: "a token could not be made"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token})
}

// seatHeader reads the token of the seat a thought is for. It goes in a header of its own,
// apart from the player token, and is only ever passed on to the game server.
func seatHeader(req *http.Request) (string, bool) {
	t := strings.TrimSpace(req.Header.Get("X-Callsign-Seat"))
	return t, len(t) >= 16 && len(t) <= 512 && !strings.ContainsAny(t, " \t\r\n")
}
