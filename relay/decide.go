package relay

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"

	"callsign/relay/provider"
)

// The decision route: POST /relay/v1/decide.
//
// A squad on the fast brain sends its situation, the radio call and the list of things
// the call could mean; the decision model picks one. Unlike a thought, this is paid for
// with the game's own key (Config.Decide.Key, from CALLSIGN_JEV_KEY), by the owner's
// decision, so the route is guarded harder than /think:
//
//   - the player token, as everywhere;
//   - the seat token, which the game server must confirm commands that squad in a live room;
//   - a rate limit for each seat and one for the whole relay;
//   - a small cap on the request and on every part of it;
//   - a ceiling on what may be spent in a day, after which the route answers "decide_off"
//     and the brain falls back to its grammar without a word to the player.
//
// The relay sets the model, pinned to a version (shared/models.json, "decision"). The key
// is never logged and never sent anywhere but the provider's one address.

const (
	codeDecideOff = "decide_off" // no key, or the day's ceiling is reached: use the rule brain

	maxDecideBody  = 24 << 10 // bytes of a request
	maxSituation   = 12 << 10
	maxCall        = 600
	maxOptions     = 64
	maxOptionAbout = 300
	maxQuestion    = 400
)

var optionName = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,48}$`)

// Decide is what the decision route is built from. With no Key the route answers
// "decide_off" and nothing else changes.
type Decide struct {
	Provider provider.Decider
	Key      string // the game's own key; never a player's
	Model    string // pinned model id; empty takes it from models.json
	// Seat bounds one seat's decisions; the zero value is DefaultDecideLimits.
	Seat Limits
	// PerMinute bounds decisions across all seats, refilled evenly; Burst may start at once.
	PerMinute int
	Burst     int
	// DailyUSD is the most the route may spend in one day (UTC). Zero means the default;
	// a negative value turns the ceiling off.
	DailyUSD float64
	// USDPerMTok is the provider's price for a million input tokens.
	USDPerMTok float64
	// SpendFile keeps the day's spending across restarts. Empty keeps it in memory only.
	SpendFile string
}

// DefaultDecideLimits fits a full army taking orders: an order is one decision, and
// orders come at the pace a person talks.
var DefaultDecideLimits = Limits{Concurrent: 4, PerMinute: 60, Burst: 20, KeyChanges: 1, Idle: 10 * time.Minute}

const (
	defaultDecidePerMinute = 1200
	defaultDecideBurst     = 120
	defaultDailyUSD        = 2.0
	defaultUSDPerMTok      = 0.042
)

// decideRequest is the body of POST /relay/v1/decide. There is no model and no address in it.
type decideRequest struct {
	Room      string            `json:"room"`
	Side      *int              `json:"side"`
	Squad     int               `json:"squad"`
	Situation json.RawMessage   `json:"situation"` // a JSON object or a string: what the squad knows
	Call      string            `json:"call"`      // the radio call to read
	Question  string            `json:"question"`
	Options   map[string]string `json:"options"`
}

func parseDecide(body []byte) (*decideRequest, error) {
	var in decideRequest
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		return nil, errors.New("the request is not the expected JSON: " + plain(err))
	}
	if dec.More() {
		return nil, errors.New("the request holds more than one JSON value")
	}
	switch {
	case !roomCode.MatchString(in.Room):
		return nil, errors.New(`"room" must be the room's code`)
	case in.Side == nil || (*in.Side != 0 && *in.Side != 1):
		return nil, errors.New(`"side" must be 0 or 1`)
	case in.Squad <= 0:
		return nil, errors.New(`a decision is for a squad: send its "squad" id`)
	case len(in.Situation) > maxSituation:
		return nil, errors.New(`"situation" is too long`)
	case in.Call == "" || len(in.Call) > maxCall:
		return nil, errors.New(`"call" must be the radio call, and short`)
	case len(in.Question) > maxQuestion:
		return nil, errors.New(`"question" is too long`)
	case len(in.Options) < 2 || len(in.Options) > maxOptions:
		return nil, errors.New(`"options" must hold 2 to 64 options`)
	}
	if len(in.Situation) > 0 && !json.Valid(in.Situation) {
		return nil, errors.New(`"situation" is not JSON`)
	}
	for name, about := range in.Options {
		if !optionName.MatchString(name) {
			return nil, errors.New("an option's name is not allowed")
		}
		if len(about) > maxOptionAbout {
			return nil, errors.New("an option's description is too long")
		}
	}
	return &in, nil
}

// bucket is a rate limit over everything: tokens that refill evenly.
type bucket struct {
	mu        sync.Mutex
	tokens    float64
	burst     float64
	perMinute float64
	seen      time.Time
	now       func() time.Time
}

func newBucket(perMinute, burst int) *bucket {
	return &bucket{tokens: float64(burst), burst: float64(burst), perMinute: float64(perMinute), seen: time.Now(), now: time.Now}
}

func (b *bucket) take() (bool, time.Duration) {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := b.now()
	b.tokens = min(b.burst, b.tokens+now.Sub(b.seen).Minutes()*b.perMinute)
	b.seen = now
	if b.tokens < 1 {
		return false, time.Duration((1 - b.tokens) / b.perMinute * float64(time.Minute))
	}
	b.tokens--
	return true, 0
}

// spending counts what the decision route has cost today, in millionths of a dollar. A
// call is charged for at its estimated size before it is made and corrected afterwards,
// so calls in flight together cannot run past the ceiling.
type spending struct {
	mu      sync.Mutex
	day     string
	micro   int64
	ceiling int64 // negative: no ceiling
	perMTok float64
	file    string
	now     func() time.Time
}

type spendFile struct {
	Day   string `json:"day"`
	Micro int64  `json:"microUSD"`
}

func newSpending(dailyUSD, perMTok float64, file string) *spending {
	s := &spending{ceiling: int64(dailyUSD * 1e6), perMTok: perMTok, file: file, now: time.Now}
	if dailyUSD < 0 {
		s.ceiling = -1
	}
	if raw, err := os.ReadFile(file); file != "" && err == nil {
		var kept spendFile
		if json.Unmarshal(raw, &kept) == nil && kept.Micro >= 0 {
			s.day, s.micro = kept.Day, kept.Micro
		}
	}
	return s
}

func (s *spending) cost(tokens int) int64 { return int64(float64(tokens) * s.perMTok) }

// roll starts a new count when the day (UTC) has changed. Call with the lock held.
func (s *spending) roll() {
	if today := s.now().UTC().Format("2006-01-02"); today != s.day {
		s.day, s.micro = today, 0
	}
}

// reserve charges for a call of about `tokens` before it is made. It reports false when
// that would pass the day's ceiling.
func (s *spending) reserve(tokens int) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.roll()
	c := s.cost(tokens)
	if s.ceiling >= 0 && s.micro+c > s.ceiling {
		return false
	}
	s.micro += c
	return true
}

// settle replaces a reservation with what the call really used.
func (s *spending) settle(reserved, used int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.roll()
	s.micro = max(0, s.micro+s.cost(used)-s.cost(reserved))
	if s.file == "" {
		return
	}
	raw, _ := json.Marshal(spendFile{Day: s.day, Micro: s.micro})
	tmp := s.file + ".tmp"
	if os.WriteFile(tmp, raw, 0o600) == nil {
		os.Rename(tmp, s.file)
	}
}

// today is the day's spending in dollars.
func (s *spending) today() float64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.roll()
	return float64(s.micro) / 1e6
}

// decider holds the route's running state.
type decider struct {
	cfg    Decide
	seats  *limiter
	all    *bucket
	spent  *spending
	on     bool
}

func newDecider(cfg Decide, models map[string]string) *decider {
	if cfg.Seat == (Limits{}) {
		cfg.Seat = DefaultDecideLimits
	}
	if cfg.PerMinute <= 0 {
		cfg.PerMinute = defaultDecidePerMinute
	}
	if cfg.Burst <= 0 {
		cfg.Burst = defaultDecideBurst
	}
	if cfg.DailyUSD == 0 {
		cfg.DailyUSD = defaultDailyUSD
	}
	if cfg.USDPerMTok <= 0 {
		cfg.USDPerMTok = defaultUSDPerMTok
	}
	if cfg.Model == "" && cfg.Provider != nil {
		cfg.Model = models[cfg.Provider.Name()]
	}
	if cfg.SpendFile != "" {
		cfg.SpendFile = filepath.Clean(cfg.SpendFile)
	}
	return &decider{
		cfg: cfg, seats: newLimiter(cfg.Seat), all: newBucket(cfg.PerMinute, cfg.Burst),
		spent: newSpending(cfg.DailyUSD, cfg.USDPerMTok, cfg.SpendFile),
		on:    cfg.Provider != nil && cfg.Key != "" && cfg.Model != "",
	}
}

func (r *Relay) decide(w http.ResponseWriter, req *http.Request, token, id string) {
	started := time.Now()
	seat := SeatID(token)
	d := r.decider
	body, err := io.ReadAll(http.MaxBytesReader(w, req.Body, maxDecideBody))
	if err != nil {
		r.fail(w, apiError{status: http.StatusRequestEntityTooLarge, code: codeBadRequest, message: "the request is too large"})
		return
	}
	in, err := parseDecide(body)
	if err != nil {
		r.fail(w, apiError{status: http.StatusBadRequest, code: codeBadRequest, message: err.Error()})
		return
	}
	note := func(model string, res *provider.Decided, outcome string) {
		tin := 0
		if res != nil {
			tin = res.InputTokens
		}
		r.cfg.Logf("relay: req=%s seat=%s room=%s side=%d squad=%d decide model=%s in=%d ms=%d spent=%.4f result=%s",
			id, seat[:8], in.Room, *in.Side, in.Squad, dash(model), tin, time.Since(started).Milliseconds(), d.spent.today(), outcome)
	}
	if !d.on {
		r.fail(w, apiError{status: http.StatusServiceUnavailable, code: codeDecideOff, message: "this relay has no decision model"})
		return
	}
	if ok, wait := d.seats.begin(seat); !ok {
		note("", nil, codeRateLimited)
		r.fail(w, apiError{status: http.StatusTooManyRequests, code: codeRateLimited, message: "this seat is asking too fast; try again shortly", retry: wait})
		return
	}
	defer d.seats.done(seat)
	if ok, wait := d.all.take(); !ok {
		note("", nil, "busy")
		r.fail(w, apiError{status: http.StatusTooManyRequests, code: codeRateLimited, message: "the relay is busy; try again shortly", retry: max(wait, time.Second)})
		return
	}

	ctx, cancel := context.WithTimeout(req.Context(), 8*time.Second)
	defer cancel()
	held, ok := seatHeader(req)
	if !ok {
		note("", nil, codeNotYourSeat)
		r.fail(w, apiError{status: http.StatusUnauthorized, code: codeNotYourSeat, message: "send the token of your seat in this match as X-Callsign-Seat"})
		return
	}
	// The game server vouches for the seat: a live room, that side, a squad on it.
	switch _, err := r.cfg.Game.Tier(ctx, held, in.Room, *in.Side, in.Squad); {
	case errors.Is(err, ErrNotYourSeat):
		note("", nil, codeNotYourSeat)
		r.fail(w, apiError{status: http.StatusForbidden, code: codeNotYourSeat, message: "this seat token does not command that squad"})
		return
	case err != nil:
		note("", nil, "game_unreachable")
		r.fail(w, apiError{status: http.StatusServiceUnavailable, code: codeProvider, message: "the game server could not vouch for this seat", retry: 2 * time.Second})
		return
	}

	// About three bytes to a token, and the provider's fixed overhead on top: an estimate
	// on the high side, put right once the provider says what it counted.
	estimate := len(body)/2 + 300
	if !d.spent.reserve(estimate) {
		note(d.cfg.Model, nil, "ceiling")
		r.fail(w, apiError{status: http.StatusServiceUnavailable, code: codeDecideOff, message: "the decision model is resting for today"})
		return
	}
	state, _ := json.Marshal(map[string]any{"situation": json.RawMessage(orNull(in.Situation)), "radio_call": in.Call})
	res, err := d.cfg.Provider.Decide(ctx, d.cfg.Key, provider.Decision{Model: d.cfg.Model, State: state, Instructions: in.Question, Options: in.Options})
	if err != nil {
		d.spent.settle(estimate, 0)
		e := apiError{status: http.StatusBadGateway, code: codeProvider, message: "the decision model could not answer"}
		var perr *provider.Error
		if errors.As(err, &perr) {
			switch perr.Code {
			case provider.BadKey:
				// The game's key is wrong: nothing a player can do, and nothing to tell them.
				e.status, e.code, e.message = http.StatusServiceUnavailable, codeDecideOff, "this relay's decision model is not set up"
			case provider.RateLimited:
				e.status, e.code, e.retry = http.StatusTooManyRequests, codeRateLimited, max(perr.RetryAfter, time.Second)
			case provider.Overloaded:
				e.status, e.retry = http.StatusServiceUnavailable, time.Second
			}
		}
		note(d.cfg.Model, nil, e.code)
		r.fail(w, e)
		return
	}
	d.spent.settle(estimate, res.InputTokens)
	if res.Model == "" {
		res.Model = d.cfg.Model
	}
	note(res.Model, res, "ok")
	writeJSON(w, http.StatusOK, map[string]any{
		"choice": res.Choice, "confidence": res.Confidence, "probabilities": res.Probabilities,
		"model": res.Model, "provider": d.cfg.Provider.Name(),
		"usage": map[string]int{"input_tokens": res.InputTokens, "output_tokens": res.OutputTokens},
		"ms":    time.Since(started).Milliseconds(),
	})
}

func orNull(raw json.RawMessage) []byte {
	if len(bytes.TrimSpace(raw)) == 0 {
		return []byte("null")
	}
	return raw
}

// decideStatus is what the health page says about the route: whether squads can use it,
// never anything about the key.
func (d *decider) status() map[string]any {
	return map[string]any{"on": d.on, "model": d.cfg.Model}
}
