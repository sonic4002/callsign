package room

import (
	"errors"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// The listening service (stt/server.py) transcribes a player's spoken call on this
// machine's GPU. It is optional: a server started without one says so in /api/server and
// the page recognises speech in the browser, as it always has.
//
// The service is reached only through here, at POST /stt/transcribe, and a server on the
// internet must not lend its GPU to strangers. So a recording is passed on only when it
// comes from a commander's seat in a live room, is no longer than the service takes, and
// its sender has not been talking faster than a person can.

const (
	// listenBody is 15 seconds of 16 kHz 16-bit mono, with room for a WAV header.
	listenBody = 15*16000*2 + 1024
	// A sender may make listenBurst calls at once and one more every listenEvery after that.
	listenBurst = 8
	listenEvery = 3 * time.Second
)

// talkLimit counts calls per network address: a bucket of listenBurst calls that refills
// one call every listenEvery.
type talkLimit struct {
	mu   sync.Mutex
	now  func() time.Time
	from map[string]*talker
}

type talker struct {
	calls float64 // calls left
	at    time.Time
}

func newTalkLimit() *talkLimit {
	return &talkLimit{now: time.Now, from: map[string]*talker{}}
}

// allow takes one call from addr's bucket, and reports whether there was one to take.
func (l *talkLimit) allow(addr string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if len(l.from) > 4096 {
		// Forget everyone whose bucket would be full again by now.
		for a, t := range l.from {
			if now.Sub(t.at) > listenBurst*listenEvery {
				delete(l.from, a)
			}
		}
	}
	t := l.from[addr]
	if t == nil {
		t = &talker{calls: listenBurst, at: now}
		l.from[addr] = t
	}
	t.calls = min(listenBurst, t.calls+float64(now.Sub(t.at))/float64(listenEvery))
	t.at = now
	if t.calls < 1 {
		return false
	}
	t.calls--
	return true
}

// senderAddr is the network address a request came from. Behind this machine's own https
// front (Caddy, or a Cloudflare Tunnel) every connection arrives from a private address,
// and the front writes the real one last in X-Forwarded-For. A sender who reaches the
// server directly cannot use that header to pass for someone else.
func senderAddr(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if ip := net.ParseIP(host); ip != nil && (ip.IsLoopback() || ip.IsPrivate()) {
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			parts := strings.Split(fwd, ",")
			return strings.TrimSpace(parts[len(parts)-1])
		}
	}
	return host
}

// listenHandler passes a commander's recording on to the listening service at target.
//
//	POST /stt/transcribe?room=<code>&side=<0|1>&lang=he|en&hints=<words>
//	X-Callsign-Seat: <seat token>
//
// In a room with seats the token must hold that side's seat. The open room of a server
// without an agent key has no seats, and that server is trusted to be on this machine.
func (h *Hub) listenHandler(target *url.URL) http.Handler {
	proxy := &httputil.ReverseProxy{
		Rewrite: func(p *httputil.ProxyRequest) {
			p.SetURL(target)
			p.Out.URL.Path = "/transcribe"
			q := p.In.URL.Query()
			p.Out.URL.RawQuery = url.Values{"lang": {q.Get("lang")}, "hints": {q.Get("hints")}}.Encode()
			p.Out.Header.Del("X-Callsign-Seat")
			p.Out.Header.Del("Cookie")
		},
		Transport: &http.Transport{ResponseHeaderTimeout: 20 * time.Second, MaxIdleConnsPerHost: 4},
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
			var tooLong *http.MaxBytesError
			if errors.As(err, &tooLong) {
				writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "the recording is too long"})
				return
			}
			// The page falls back to its own recogniser; the recording is not logged.
			writeJSON(w, http.StatusBadGateway, map[string]any{"error": "the listening service did not answer"})
		},
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		side, err := strconv.Atoi(q.Get("side"))
		rm := h.Room(q.Get("room"))
		if rm == nil || err != nil || (side != 0 && side != 1) || (rm.Seated() && !rm.Holds(side, r.Header.Get("X-Callsign-Seat"))) {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": ErrNoSeat.Error()})
			return
		}
		if !h.talk.allow(senderAddr(r)) {
			w.Header().Set("Retry-After", strconv.Itoa(int(listenEvery/time.Second)))
			writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "too many calls; wait a moment"})
			return
		}
		if r.ContentLength > listenBody {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "the recording is too long"})
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, listenBody)
		proxy.ServeHTTP(w, r)
	})
}
