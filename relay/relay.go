// Package relay is the model relay: the one place a player's AI key is used.
//
// Agents never call an AI provider. They send a thought here with their seat token; the
// relay asks the game server which brain tier that squad has bought, picks the model for
// that tier from shared/models.json, and calls the provider with the key the player
// stored. Nobody's squad thinks with a stronger model than its gold paid for, and the key
// never goes back to a browser.
//
// The relay keeps no match state. Apart from the encrypted key store it remembers nothing,
// so it can be restarted at any time and two can run side by side on one key directory.
package relay

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"math"
	mrand "math/rand/v2"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"callsign/relay/provider"
	"callsign/shared"
)

// Error codes of the relay's API.
const (
	codeNoKey       = "no_key"
	codeBadKey      = "bad_key"
	codeRateLimited = "rate_limited"
	codeProvider    = "provider_error"
	codeNotYourSeat = "not_your_seat"
	codeBadRequest  = "bad_request"
)

// Config is everything a relay is built from.
type Config struct {
	Game      Game
	Keys      *KeyStore
	TokenKey  []byte // signs player tokens; see TokenKey
	Models    *shared.Models
	Rules     *shared.Rules
	Providers map[string]provider.Provider
	Limits    Limits
	// Decide is the decision route, paid for with the game's own key (decide.go). Left
	// empty, the route answers that it is off.
	Decide Decide
	// Origins are the pages allowed to call the relay from another origin. A page served
	// by the game server reaches the relay through it, on its own origin, and needs no entry.
	Origins []string
	Timeout time.Duration // for one thought, the retry included
	Logf    func(format string, args ...any)
}

// Relay serves the API under /relay/v1/.
type Relay struct {
	cfg     Config
	limits  *limiter
	decider *decider
	sleep   func(context.Context, time.Duration) error
	newSeat struct {
		sync.Mutex
		tokens float64
		seen   time.Time
	}
}

// newKeysPerMinute bounds how fast player tokens are handed out, across all callers. A
// key can only be stored under a token the relay made, so this also bounds how fast the
// store can grow.
const newKeysPerMinute = 30

func New(cfg Config) (*Relay, error) {
	switch {
	case cfg.Game == nil, cfg.Keys == nil, cfg.Models == nil, cfg.Rules == nil:
		return nil, errors.New("relay: Game, Keys, Models and Rules are all required")
	case len(cfg.TokenKey) < 32:
		return nil, errors.New("relay: TokenKey must be at least 32 bytes")
	case len(cfg.Providers) == 0:
		return nil, errors.New("relay: no providers")
	}
	for name := range cfg.Providers {
		if cfg.Models.Providers[name] == nil {
			return nil, errors.New("relay: models.json has no models for provider " + name)
		}
	}
	if cfg.Limits == (Limits{}) {
		cfg.Limits = DefaultLimits
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 75 * time.Second
	}
	if cfg.Logf == nil {
		cfg.Logf = log.Printf
	}
	r := &Relay{cfg: cfg, limits: newLimiter(cfg.Limits), sleep: sleepCtx, decider: newDecider(cfg.Decide, cfg.Models.Decision)}
	r.newSeat.tokens = newKeysPerMinute
	r.newSeat.seen = time.Now()
	return r, nil
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

func (r *Relay) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/relay/v1/player", r.page(r.player, http.MethodPost))
	mux.HandleFunc("/relay/v1/think", r.guard(r.think, http.MethodPost))
	mux.HandleFunc("/relay/v1/decide", r.guard(r.decide, http.MethodPost))
	mux.HandleFunc("/relay/v1/key", r.guard(r.key, http.MethodGet, http.MethodPut, http.MethodDelete))
	mux.HandleFunc("/relay/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "providers": provider.Names, "decide": r.decider.status()})
	})
	return mux
}

type apiError struct {
	status  int
	code    string
	message string
	retry   time.Duration
}

func (r *Relay) fail(w http.ResponseWriter, e apiError) {
	if e.retry > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(e.retry.Seconds()))))
	}
	writeJSON(w, e.status, map[string]any{"error": map[string]string{"code": e.code, "message": e.message}})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// guard is page plus the player token: the handler gets the token and the request id. A
// token the relay did not make is refused here, before anything is read or stored.
func (r *Relay) guard(next func(http.ResponseWriter, *http.Request, string, string), methods ...string) http.HandlerFunc {
	return r.page(func(w http.ResponseWriter, req *http.Request) {
		token, found := strings.CutPrefix(req.Header.Get("Authorization"), "Bearer ")
		token = strings.TrimSpace(token)
		if !found || len(token) > 512 || !r.isPlayer(token) {
			w.Header().Set("WWW-Authenticate", "Bearer")
			r.fail(w, apiError{status: http.StatusUnauthorized, code: codeNotYourSeat, message: "send your player token as a bearer token; POST /relay/v1/player gives one"})
			return
		}
		next(w, req, token, w.Header().Get("X-Request-Id"))
	}, methods...)
}

// page is what every endpoint shares: the origin check, the method and a request id.
func (r *Relay) page(next http.HandlerFunc, methods ...string) http.HandlerFunc {
	allowed := strings.Join(methods, ", ")
	return func(w http.ResponseWriter, req *http.Request) {
		id := requestID()
		w.Header().Set("X-Request-Id", id)
		w.Header().Set("X-Content-Type-Options", "nosniff")

		if origin := req.Header.Get("Origin"); origin != "" {
			cross, ok := r.origin(req, origin)
			if !ok {
				r.fail(w, apiError{status: http.StatusForbidden, code: codeBadRequest, message: "this page may not call the relay"})
				return
			}
			if cross {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Add("Vary", "Origin")
				w.Header().Set("Access-Control-Expose-Headers", "X-Request-Id, Retry-After")
			}
			if req.Method == http.MethodOptions {
				w.Header().Set("Access-Control-Allow-Methods", allowed)
				w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Callsign-Seat")
				w.Header().Set("Access-Control-Max-Age", "600")
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		ok := false
		for _, m := range methods {
			ok = ok || req.Method == m
		}
		if !ok {
			w.Header().Set("Allow", allowed)
			r.fail(w, apiError{status: http.StatusMethodNotAllowed, code: codeBadRequest, message: "use " + allowed})
			return
		}
		next(w, req)
	}
}

// origin decides whether a page may call. It reports whether the call crosses origins
// (and so needs the CORS headers) and whether it is allowed at all.
func (r *Relay) origin(req *http.Request, origin string) (cross, ok bool) {
	// Through the game server's pass-through the Host is still the game's own, so a page
	// of the game is on the same origin as the relay it calls.
	if u, err := url.Parse(origin); err == nil && u.Host != "" && u.Host == req.Host {
		return false, true
	}
	for _, o := range r.cfg.Origins {
		if o == origin {
			return true, true
		}
	}
	return false, false
}

func requestID() string {
	var b [8]byte
	rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// ---- thinking ----

func (r *Relay) think(w http.ResponseWriter, req *http.Request, token, id string) {
	started := time.Now()
	seat := SeatID(token)
	body, err := io.ReadAll(http.MaxBytesReader(w, req.Body, maxBody))
	if err != nil {
		r.fail(w, apiError{status: http.StatusRequestEntityTooLarge, code: codeBadRequest, message: "the request is too large"})
		return
	}
	in, thought, err := parseThink(body)
	if err != nil {
		r.fail(w, apiError{status: http.StatusBadRequest, code: codeBadRequest, message: err.Error()})
		return
	}

	if ok, wait := r.limits.begin(seat); !ok {
		r.log(id, seat, in, "", "", "", nil, started, codeRateLimited)
		r.fail(w, apiError{status: http.StatusTooManyRequests, code: codeRateLimited, message: "this seat is thinking too much at once; try again shortly", retry: wait})
		return
	}
	defer r.limits.done(seat)

	ctx, cancel := context.WithTimeout(req.Context(), r.cfg.Timeout)
	defer cancel()

	operator := in.Role == "anvil"
	held, ok := seatHeader(req)
	if !ok {
		r.log(id, seat, in, "", "", "", nil, started, codeNotYourSeat)
		r.fail(w, apiError{status: http.StatusUnauthorized, code: codeNotYourSeat, message: "send the token of your seat in this match as X-Callsign-Seat"})
		return
	}
	tier, err := r.cfg.Game.Tier(ctx, held, in.Room, *in.Side, in.Squad)
	switch {
	case errors.Is(err, ErrNotYourSeat):
		r.log(id, seat, in, "", "", "", nil, started, codeNotYourSeat)
		r.fail(w, apiError{status: http.StatusForbidden, code: codeNotYourSeat, message: "this seat token does not command that squad"})
		return
	case err != nil:
		r.log(id, seat, in, "", "", "", nil, started, "game_unreachable")
		r.fail(w, apiError{status: http.StatusServiceUnavailable, code: codeProvider, message: "the game server could not say which brain this squad has", retry: 2 * time.Second})
		return
	}
	if !operator {
		if _, known := r.cfg.Rules.TierCost(tier); !known {
			r.log(id, seat, in, strconv.Itoa(tier), "", "", nil, started, "bad_tier")
			r.fail(w, apiError{status: http.StatusBadGateway, code: codeProvider, message: "the game server named a brain tier the rules do not have"})
			return
		}
	}
	tierKey := shared.TierKey(operator, tier)

	stored, err := r.cfg.Keys.Get(seat)
	switch {
	case errors.Is(err, ErrNoKey):
		r.log(id, seat, in, tierKey, "", "", nil, started, codeNoKey)
		r.fail(w, apiError{status: http.StatusPreconditionRequired, code: codeNoKey, message: "no AI key is stored for this seat"})
		return
	case err != nil:
		r.log(id, seat, in, tierKey, "", "", nil, started, "key_store")
		r.fail(w, apiError{status: http.StatusInternalServerError, code: codeProvider, message: "the stored key could not be read; store it again"})
		return
	}
	p := r.cfg.Providers[stored.Provider]
	model := r.cfg.Models.Providers[stored.Provider][tierKey]
	if p == nil || model == "" {
		r.log(id, seat, in, tierKey, stored.Provider, "", nil, started, codeNoKey)
		r.fail(w, apiError{status: http.StatusPreconditionRequired, code: codeNoKey, message: "the stored key is for a provider this relay does not serve; store a key again"})
		return
	}
	thought.Model = model
	thought.Effort = r.cfg.Models.Effort[tierKey]
	thought.MaxTokens = r.cfg.Models.MaxTokens

	res, err := p.Think(ctx, stored.Key, thought)
	var perr *provider.Error
	if errors.As(err, &perr) && perr.Code == provider.Overloaded {
		// One more try, after a pause the provider asked for or a short one of our own.
		wait := 600*time.Millisecond + time.Duration(mrand.Int64N(int64(600*time.Millisecond)))
		if perr.RetryAfter > 0 {
			wait = min(perr.RetryAfter, 4*time.Second)
		}
		if r.sleep(ctx, wait) == nil {
			res, err = p.Think(ctx, stored.Key, thought)
		}
	}
	if err != nil {
		e := apiError{status: http.StatusBadGateway, code: codeProvider, message: "the AI provider could not answer"}
		if errors.As(err, &perr) {
			e.message = stored.Provider + ": " + perr.Message
			switch perr.Code {
			case provider.BadKey:
				e.status, e.code = http.StatusFailedDependency, codeBadKey
			case provider.RateLimited:
				e.status, e.code, e.retry = http.StatusTooManyRequests, codeRateLimited, max(perr.RetryAfter, time.Second)
			case provider.Overloaded:
				e.status, e.retry = http.StatusServiceUnavailable, 2*time.Second
			}
		}
		if ctx.Err() == context.DeadlineExceeded {
			e.status, e.message = http.StatusGatewayTimeout, stored.Provider+": no answer in time"
		}
		r.log(id, seat, in, tierKey, stored.Provider, model, nil, started, e.code)
		r.fail(w, e)
		return
	}
	if res.Model == "" {
		res.Model = model
	}
	r.log(id, seat, in, tierKey, stored.Provider, model, res, started, res.StopReason)
	writeJSON(w, http.StatusOK, reply(stored.Provider, res))
}

// log writes one line about a thought: who asked and what it cost, never what was said
// and never a key or a token.
func (r *Relay) log(id, seat string, in *thinkRequest, tier, name, model string, res *provider.Response, started time.Time, outcome string) {
	tin, tout := 0, 0
	if res != nil {
		tin, tout = res.InputTokens, res.OutputTokens
	}
	r.cfg.Logf("relay: req=%s seat=%s room=%s side=%d role=%s squad=%d tier=%s provider=%s model=%s in=%d out=%d ms=%d result=%s",
		id, seat[:8], in.Room, *in.Side, in.Role, in.Squad, dash(tier), dash(name), dash(model), tin, tout, time.Since(started).Milliseconds(), outcome)
}

func dash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}

// ---- the seat's key ----

func (r *Relay) key(w http.ResponseWriter, req *http.Request, token, id string) {
	seat := SeatID(token)
	if !r.limits.keyOp(seat) {
		r.fail(w, apiError{status: http.StatusTooManyRequests, code: codeRateLimited, message: "too many key requests; try again in a minute", retry: 30 * time.Second})
		return
	}
	switch req.Method {
	case http.MethodGet:
		stored, err := r.cfg.Keys.Get(seat)
		switch {
		case errors.Is(err, ErrNoKey):
			writeJSON(w, http.StatusOK, map[string]any{"provider": nil, "set": false})
		case err != nil:
			r.fail(w, apiError{status: http.StatusInternalServerError, code: codeProvider, message: "the stored key could not be read; store it again"})
		default:
			writeJSON(w, http.StatusOK, map[string]any{"provider": stored.Provider, "set": true, "hint": hint(stored.Key)})
		}

	case http.MethodPut:
		var in struct {
			Provider string `json:"provider"`
			Key      string `json:"key"`
		}
		dec := json.NewDecoder(http.MaxBytesReader(w, req.Body, 4096))
		dec.DisallowUnknownFields()
		if dec.Decode(&in) != nil {
			r.fail(w, apiError{status: http.StatusBadRequest, code: codeBadRequest, message: `send {"provider": "...", "key": "..."}`})
			return
		}
		in.Key = strings.TrimSpace(in.Key)
		if msg := checkKey(in.Provider, in.Key, r.cfg.Providers); msg != "" {
			r.fail(w, apiError{status: http.StatusBadRequest, code: codeBadRequest, message: msg})
			return
		}
		switch err := r.cfg.Keys.Put(seat, Stored{Provider: in.Provider, Key: in.Key}); {
		case errors.Is(err, ErrStoreFull):
			r.fail(w, apiError{status: http.StatusInsufficientStorage, code: codeProvider, message: "the relay cannot store more keys"})
			return
		case err != nil:
			r.cfg.Logf("relay: req=%s seat=%s key store: %v", id, seat[:8], err)
			r.fail(w, apiError{status: http.StatusInternalServerError, code: codeProvider, message: "the key could not be stored"})
			return
		}
		r.cfg.Logf("relay: req=%s seat=%s key stored provider=%s", id, seat[:8], in.Provider)
		writeJSON(w, http.StatusOK, map[string]any{"provider": in.Provider, "set": true, "hint": hint(in.Key)})

	case http.MethodDelete:
		if err := r.cfg.Keys.Delete(seat); err != nil {
			r.fail(w, apiError{status: http.StatusInternalServerError, code: codeProvider, message: "the key could not be removed"})
			return
		}
		r.cfg.Logf("relay: req=%s seat=%s key forgotten", id, seat[:8])
		writeJSON(w, http.StatusOK, map[string]any{"provider": nil, "set": false})
	}
}

func (r *Relay) admitNewSeat() bool {
	r.newSeat.Lock()
	defer r.newSeat.Unlock()
	now := time.Now()
	r.newSeat.tokens = min(newKeysPerMinute, r.newSeat.tokens+now.Sub(r.newSeat.seen).Minutes()*newKeysPerMinute)
	r.newSeat.seen = now
	if r.newSeat.tokens < 1 {
		return false
	}
	r.newSeat.tokens--
	return true
}

// checkKey returns why a key cannot be stored, or "".
func checkKey(name, key string, providers map[string]provider.Provider) string {
	if providers[name] == nil {
		return `"provider" must be one of: ` + strings.Join(provider.Names, ", ")
	}
	if len(key) < 16 || len(key) > 512 {
		return "that does not look like an API key"
	}
	for _, c := range key {
		if c <= ' ' || c > '~' {
			return "an API key has no spaces or unusual characters"
		}
	}
	if name == provider.Anthropic && strings.HasPrefix(key, "sk-ant-oat") {
		return "that is a Claude subscription token, not an API key; create an API key in the Claude Console"
	}
	return ""
}

// hint is the last four characters of a key, for the player to tell which one is stored.
func hint(key string) string {
	return "…" + key[len(key)-4:]
}
