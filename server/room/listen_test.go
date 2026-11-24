package room

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeListener is a stand-in for the listening service: it notes what reached it.
type fakeListener struct {
	mu    sync.Mutex
	calls []*http.Request
	sizes []int
}

func (s *fakeListener) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return // cut off on the way: not a recording
	}
	s.mu.Lock()
	s.calls, s.sizes = append(s.calls, r), append(s.sizes, len(body))
	s.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	io.WriteString(w, `{"text":"צפע 1, כאן פטיש, עבור"}`)
}

func (s *fakeListener) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.calls)
}

// listening starts a hub with a listening service behind it, and one match with a seat.
func listening(t *testing.T, cfg HubConfig) (srv *httptest.Server, service *fakeListener, h *Hub, code, token string) {
	t.Helper()
	service = &fakeListener{}
	upstream := httptest.NewServer(service)
	t.Cleanup(upstream.Close)
	cfg.Listen = upstream.URL
	h = newHub(t, cfg)
	mux := http.NewServeMux()
	h.Routes(mux)
	srv = httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	if cfg.AgentKey != "" {
		rm, _, tok, err := h.Create(Options{Opponent: OpponentBot, Side: 0})
		if err != nil {
			t.Fatal(err)
		}
		code, token = rm.Lobby().Room, tok
	}
	return
}

func say(t *testing.T, srv *httptest.Server, query, token string, body []byte, headers ...string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest("POST", srv.URL+"/stt/transcribe?"+query, bytes.NewReader(body))
	if token != "" {
		req.Header.Set("X-Callsign-Seat", token)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { res.Body.Close() })
	return res
}

func TestWithoutAListeningServiceNothingIsOffered(t *testing.T) {
	h := newHub(t, HubConfig{AgentKey: "k"})
	mux := http.NewServeMux()
	h.Routes(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	var info struct {
		STT *bool `json:"stt"`
	}
	res, err := http.Get(srv.URL + "/api/server")
	if err != nil {
		t.Fatal(err)
	}
	decode(t, res, &info)
	if info.STT == nil || *info.STT {
		t.Fatalf("a server without a listening service must say stt: false, said %v", info.STT)
	}
	if res := say(t, srv, "room=X&side=0&lang=he", "t", []byte("pcm")); res.StatusCode != http.StatusNotFound {
		t.Fatalf("/stt/transcribe without a service answered %d", res.StatusCode)
	}
}

func TestOnlyASeatedCommanderIsListenedTo(t *testing.T) {
	srv, service, h, code, token := listening(t, HubConfig{AgentKey: "k"})
	var info struct {
		STT bool `json:"stt"`
	}
	res, err := http.Get(srv.URL + "/api/server")
	if err != nil {
		t.Fatal(err)
	}
	decode(t, res, &info)
	if !info.STT {
		t.Fatal("the lobby is not told that the server listens")
	}

	pcm := bytes.Repeat([]byte{1, 0}, 16000)
	for name, c := range map[string]struct{ query, token string }{
		"no token":         {"room=" + code + "&side=0&lang=he", ""},
		"a wrong token":    {"room=" + code + "&side=0&lang=he", strings.Repeat("0", len(token))},
		"the other side":   {"room=" + code + "&side=1&lang=he", token},
		"no side":          {"room=" + code + "&lang=he", token},
		"no such room":     {"room=ZZZZZZ&side=0&lang=he", token},
		"no room at all":   {"side=0&lang=he", token},
		"the agent key":    {"room=" + code + "&side=0&lang=he&key=k", "k"},
		"a spectator side": {"room=" + code + "&side=2&lang=he", token},
	} {
		if res := say(t, srv, c.query, c.token, pcm); res.StatusCode != http.StatusForbidden {
			t.Errorf("%s: answered %d, want 403", name, res.StatusCode)
		}
	}
	if n := service.count(); n != 0 {
		t.Fatalf("%d refused recordings reached the listening service", n)
	}

	res = say(t, srv, "room="+strings.ToLower(code)+"&side=0&lang=he&hints="+"צפע,פסל", token, pcm, "Cookie", "a=b")
	text, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK || !strings.Contains(string(text), "צפע 1") {
		t.Fatalf("the commander's call answered %d %s", res.StatusCode, text)
	}
	got := service.calls[0]
	if got.URL.Path != "/transcribe" || got.URL.Query().Get("lang") != "he" || got.URL.Query().Get("hints") != "צפע,פסל" || service.sizes[0] != len(pcm) {
		t.Fatalf("the service was sent %s with %d bytes", got.URL, service.sizes[0])
	}
	// The seat's token, the room and the browser's cookies stay here.
	if got.URL.Query().Has("room") || got.URL.Query().Has("side") || got.Header.Get("X-Callsign-Seat") != "" || got.Header.Get("Cookie") != "" {
		t.Fatalf("the service was shown more than the recording: %s %v", got.URL, got.Header)
	}

	// A match that has been dropped no longer opens the door.
	h.drop(code)
	if res := say(t, srv, "room="+code+"&side=0&lang=he", token, pcm); res.StatusCode != http.StatusForbidden {
		t.Fatalf("a dropped match's token answered %d", res.StatusCode)
	}
}

func TestTheOpenRoomIsListenedToWithoutASeat(t *testing.T) {
	srv, service, _, _, _ := listening(t, HubConfig{})
	if res := say(t, srv, "side=0&lang=en", "", []byte{1, 0}); res.StatusCode != http.StatusOK || service.count() != 1 {
		t.Fatalf("the open room's commander answered %d", res.StatusCode)
	}
}

func TestLongRecordingsAreRefused(t *testing.T) {
	srv, service, _, code, token := listening(t, HubConfig{AgentKey: "k"})
	query := "room=" + code + "&side=0&lang=he"
	fits := make([]byte, 15*16000*2+44) // fifteen seconds as a WAV file
	if res := say(t, srv, query, token, fits); res.StatusCode != http.StatusOK {
		t.Fatalf("fifteen seconds answered %d", res.StatusCode)
	}
	long := make([]byte, 16*16000*2)
	if res := say(t, srv, query, token, long); res.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("sixteen seconds answered %d", res.StatusCode)
	}
	// The same without a stated length: it is cut off while being read.
	req, _ := http.NewRequest("POST", srv.URL+"/stt/transcribe?"+query, io.MultiReader(bytes.NewReader(long)))
	req.Header.Set("X-Callsign-Seat", token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("sixteen seconds of unstated length answered %d", res.StatusCode)
	}
	if n := service.count(); n != 1 {
		t.Fatalf("the service was sent %d recordings, want only the one that fits", n)
	}
}

func TestTalkingIsLimitedPerAddress(t *testing.T) {
	srv, service, h, code, token := listening(t, HubConfig{AgentKey: "k"})
	now := time.Unix(1000, 0)
	h.talk.now = func() time.Time { return now }
	query := "room=" + code + "&side=0&lang=he"
	// The test's requests come from this machine, as they would from the https front,
	// which names the real sender last.
	from := func(addr string) int {
		return say(t, srv, query, token, []byte{1, 0}, "X-Forwarded-For", "6.6.6.6, "+addr).StatusCode
	}
	for i := 0; i < listenBurst; i++ {
		if got := from("203.0.113.7"); got != http.StatusOK {
			t.Fatalf("call %d answered %d", i+1, got)
		}
	}
	if got := from("203.0.113.7"); got != http.StatusTooManyRequests {
		t.Fatalf("the call past the limit answered %d", got)
	}
	if got := from("203.0.113.8"); got != http.StatusOK {
		t.Fatalf("another address was held back too: %d", got)
	}
	// A refused sender without a seat does not use up the seat holder's calls, and is not counted.
	if res := say(t, srv, query, "", []byte{1, 0}, "X-Forwarded-For", "203.0.113.9"); res.StatusCode != http.StatusForbidden {
		t.Fatalf("no token answered %d", res.StatusCode)
	}
	now = now.Add(listenEvery)
	if got := from("203.0.113.7"); got != http.StatusOK {
		t.Fatalf("after waiting, the call answered %d", got)
	}
	if got := from("203.0.113.7"); got != http.StatusTooManyRequests {
		t.Fatalf("waiting once bought more than one call: %d", got)
	}
	if n := service.count(); n != listenBurst+2 {
		t.Fatalf("the service was sent %d recordings, want %d", n, listenBurst+2)
	}
}

func TestSenderAddrTrustsOnlyOurOwnFront(t *testing.T) {
	for _, c := range []struct{ remote, forwarded, want string }{
		{"172.18.0.5:4000", "198.51.100.4", "198.51.100.4"},
		{"127.0.0.1:4000", "1.1.1.1, 198.51.100.4", "198.51.100.4"},
		{"172.18.0.5:4000", "", "172.18.0.5"},
		{"198.51.100.9:4000", "10.0.0.1", "198.51.100.9"}, // a direct sender cannot pass for another
	} {
		r := httptest.NewRequest("POST", "/stt/transcribe", nil)
		r.RemoteAddr = c.remote
		if c.forwarded != "" {
			r.Header.Set("X-Forwarded-For", c.forwarded)
		}
		if got := senderAddr(r); got != c.want {
			t.Errorf("from %s forwarded %q: %s, want %s", c.remote, c.forwarded, got, c.want)
		}
	}
}
