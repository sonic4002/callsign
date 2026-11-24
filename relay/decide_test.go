package relay

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"callsign/relay/provider"
)

const gameKey = "ts-live-the-games-own-key-0000-WXYZ"

// oracle is a decision model that answers from a script and remembers what it was asked.
type oracle struct {
	mu     sync.Mutex
	asked  []provider.Decision
	keys   []string
	answer func(n int, req provider.Decision) (*provider.Decided, error)
	gate   chan struct{}
	tokens int // input tokens each answer reports
}

func (o *oracle) Name() string { return provider.TypeSafe }

func (o *oracle) Decide(ctx context.Context, key string, req provider.Decision) (*provider.Decided, error) {
	o.mu.Lock()
	o.asked = append(o.asked, req)
	o.keys = append(o.keys, key)
	n, answer, gate, tokens := len(o.asked), o.answer, o.gate, o.tokens
	o.mu.Unlock()
	if gate != nil {
		select {
		case <-gate:
		case <-ctx.Done():
			return nil, &provider.Error{Code: provider.Overloaded, Message: "the provider could not be reached: timed out"}
		}
	}
	if answer != nil {
		return answer(n, req)
	}
	if tokens == 0 {
		tokens = 1400
	}
	return &provider.Decided{Choice: "hold:F", Confidence: 0.97, Probabilities: map[string]float64{"hold:F": 0.98, "say_again": 0.02}, InputTokens: tokens, Model: "jev-1.14.0"}, nil
}

func (o *oracle) count() int {
	o.mu.Lock()
	defer o.mu.Unlock()
	return len(o.asked)
}

func decideRig(t *testing.T, change func(*Decide)) (*rig, *oracle) {
	t.Helper()
	o := &oracle{}
	r := newRig(t, DefaultLimits, func(c *Config) {
		c.Decide = Decide{Provider: o, Key: gameKey}
		if change != nil {
			change(&c.Decide)
		}
	})
	return r, o
}

// order is a request body as the fast brain sends it.
func order(squad int) map[string]any {
	return map[string]any{
		"room": "ROOM1", "side": 0, "squad": squad,
		"situation": map[string]any{"you": "Viper 1 near Alpha"},
		"call":      "push up to the town",
		"question":  "Which single action does the radio call order?",
		"options":   map[string]string{"hold:F": "go to Foxtrot and defend it", "move:F": "go to Foxtrot", "say_again": "the call is unclear"},
	}
}

func TestADecisionIsMadeWithTheGamesKeyAndThePinnedModel(t *testing.T) {
	r, o := decideRig(t, nil)
	res := r.do("POST", "/relay/v1/decide", seatToken, order(1))
	if res.status != 200 || res.body["choice"] != "hold:F" || res.body["model"] != "jev-1.14.0" || res.body["provider"] != "typesafe" {
		t.Fatalf("decide: %d %s", res.status, res.raw)
	}
	if p, _ := res.body["probabilities"].(map[string]any); p["hold:F"] != 0.98 {
		t.Fatalf("probabilities: %s", res.raw)
	}
	if usage, _ := res.body["usage"].(map[string]any); usage["input_tokens"] != 1400.0 {
		t.Fatalf("usage: %s", res.raw)
	}
	got := o.asked[0]
	if o.keys[0] != gameKey || got.Model != "jev-1.14.0" {
		t.Fatalf("asked with model %q", got.Model)
	}
	if !strings.Contains(string(got.State), `"radio_call":"push up to the town"`) || !strings.Contains(string(got.State), "Viper 1 near Alpha") || len(got.Options) != 3 {
		t.Fatalf("state = %s, options = %v", got.State, got.Options)
	}
	// Nothing the player sees or the log keeps carries the key or what was said.
	logs := r.logs.String()
	for _, secret := range []string{gameKey, "push up", "Viper 1 near Alpha"} {
		if strings.Contains(res.raw, gameKey) || strings.Contains(logs, secret) {
			t.Fatalf("%q leaked: log %q", secret, logs)
		}
	}
	if !strings.Contains(logs, "decide model=jev-1.14.0 in=1400") {
		t.Fatalf("the log does not say what the decision cost: %q", logs)
	}
	// No player's key is needed, and none is used.
	if n := len(r.brains[provider.Anthropic].asked); n != 0 {
		t.Fatalf("a decision reached a chat provider %d times", n)
	}
}

func TestACallerCannotNameTheDecisionModel(t *testing.T) {
	r, o := decideRig(t, nil)
	for _, field := range []string{"model", "key", "url", "state", "questions"} {
		body := order(1)
		body[field] = "jev-latest"
		if res := r.do("POST", "/relay/v1/decide", seatToken, body); res.status != 400 || res.code() != codeBadRequest {
			t.Fatalf("a request with %q: %d %s", field, res.status, res.raw)
		}
	}
	if o.count() != 0 {
		t.Fatal("a refused request reached the model")
	}
}

func TestOnlyASeatOfALiveRoomDecides(t *testing.T) {
	r, o := decideRig(t, nil)
	// No player token at all, and one the relay did not make.
	if res := r.do("POST", "/relay/v1/decide", "", order(1)); res.status != 401 || res.code() != codeNotYourSeat {
		t.Fatalf("no token: %d %s", res.status, res.raw)
	}
	if res := r.do("POST", "/relay/v1/decide", "made-up-token", order(1)); res.status != 401 {
		t.Fatalf("a made-up token: %d %s", res.status, res.raw)
	}
	// A real player without a seat header.
	if res := r.do("POST", "/relay/v1/decide", r.player[seatToken], order(1)); res.status != 401 || res.code() != codeNotYourSeat {
		t.Fatalf("no seat: %d %s", res.status, res.raw)
	}
	// The other side's squad, a squad that does not exist, a room that does not exist.
	other := order(4)
	other["side"] = 1
	gone := order(9)
	nowhere := order(1)
	nowhere["room"] = "NOROOM"
	for name, body := range map[string]map[string]any{"the other side": other, "no such squad": gone, "no such room": nowhere} {
		if res := r.do("POST", "/relay/v1/decide", seatToken, body); res.status != 403 || res.code() != codeNotYourSeat {
			t.Fatalf("%s: %d %s", name, res.status, res.raw)
		}
	}
	// The operator does not use the decision model.
	anvil := order(0)
	if res := r.do("POST", "/relay/v1/decide", seatToken, anvil); res.status != 400 {
		t.Fatalf("the operator: %d %s", res.status, res.raw)
	}
	if o.count() != 0 {
		t.Fatalf("%d refused requests reached the model", o.count())
	}
	// The game server down: nothing is decided on trust.
	r.game.Err = context.DeadlineExceeded
	if res := r.do("POST", "/relay/v1/decide", seatToken, order(1)); res.status != 503 || res.code() != codeProvider || o.count() != 0 {
		t.Fatalf("game server down: %d %s", res.status, res.raw)
	}
}

func TestADecisionRequestIsSmall(t *testing.T) {
	r, o := decideRig(t, nil)
	big := order(1)
	big["situation"] = strings.Repeat("x", maxDecideBody)
	if res := r.do("POST", "/relay/v1/decide", seatToken, big); res.status != 413 || res.code() != codeBadRequest {
		t.Fatalf("a huge body: %d %s", res.status, res.raw)
	}
	long := order(1)
	long["situation"] = strings.Repeat("x", maxSituation)
	if res := r.do("POST", "/relay/v1/decide", seatToken, long); res.status != 400 {
		t.Fatalf("a long situation: %d %s", res.status, res.raw)
	}
	call := order(1)
	call["call"] = strings.Repeat("attack ", 200)
	if res := r.do("POST", "/relay/v1/decide", seatToken, call); res.status != 400 {
		t.Fatalf("a long call: %d %s", res.status, res.raw)
	}
	many := order(1)
	options := map[string]string{}
	for i := 0; i <= maxOptions; i++ {
		options["o"+strings.Repeat("x", i%7)+string(rune('a'+i%26))+string(rune('a'+i/26))] = "x"
	}
	many["options"] = options
	if res := r.do("POST", "/relay/v1/decide", seatToken, many); res.status != 400 {
		t.Fatalf("too many options: %d %s", res.status, res.raw)
	}
	for name, opts := range map[string]map[string]string{
		"one option":         {"hold:F": "x"},
		"a bad name":         {"hold F!": "x", "say_again": "y"},
		"a long description": {"hold:F": strings.Repeat("x", maxOptionAbout+1), "say_again": "y"},
	} {
		body := order(1)
		body["options"] = opts
		if res := r.do("POST", "/relay/v1/decide", seatToken, body); res.status != 400 || res.code() != codeBadRequest {
			t.Fatalf("%s: %d %s", name, res.status, res.raw)
		}
	}
	if o.count() != 0 {
		t.Fatal("a refused request reached the model")
	}
}

func TestASeatsDecisionsAreLimited(t *testing.T) {
	r, o := decideRig(t, func(d *Decide) {
		d.Seat = Limits{Concurrent: 2, PerMinute: 60, Burst: 3, KeyChanges: 1, Idle: time.Minute}
	})
	for i := 0; i < 3; i++ {
		if res := r.do("POST", "/relay/v1/decide", seatToken, order(1)); res.status != 200 {
			t.Fatalf("decision %d: %d %s", i, res.status, res.raw)
		}
	}
	res := r.do("POST", "/relay/v1/decide", seatToken, order(1))
	if res.status != 429 || res.code() != codeRateLimited || res.header.Get("Retry-After") == "" {
		t.Fatalf("a fourth decision in a burst of three: %d %s", res.status, res.raw)
	}
	// Another seat has its own count.
	other := order(4)
	other["side"] = 1
	if res := r.do("POST", "/relay/v1/decide", otherToken, other); res.status != 200 {
		t.Fatalf("the other seat: %d %s", res.status, res.raw)
	}
	if o.count() != 4 {
		t.Fatalf("the model was asked %d times, want 4", o.count())
	}
}

func TestAllDecisionsTogetherAreLimited(t *testing.T) {
	r, o := decideRig(t, func(d *Decide) { d.PerMinute, d.Burst = 60, 2 })
	other := order(4)
	other["side"] = 1
	if res := r.do("POST", "/relay/v1/decide", seatToken, order(1)); res.status != 200 {
		t.Fatalf("first: %d %s", res.status, res.raw)
	}
	if res := r.do("POST", "/relay/v1/decide", otherToken, other); res.status != 200 {
		t.Fatalf("second: %d %s", res.status, res.raw)
	}
	// The relay as a whole has given out its two; a seat that has asked nothing yet waits too.
	if res := r.do("POST", "/relay/v1/decide", otherToken, other); res.status != 429 || res.code() != codeRateLimited || res.header.Get("Retry-After") == "" {
		t.Fatalf("third: %d %s", res.status, res.raw)
	}
	if o.count() != 2 {
		t.Fatalf("the model was asked %d times, want 2", o.count())
	}
	// A minute later there is room again.
	r.relay.decider.all.now = func() time.Time { return time.Now().Add(time.Minute) }
	if res := r.do("POST", "/relay/v1/decide", seatToken, order(1)); res.status != 200 {
		t.Fatalf("a minute later: %d %s", res.status, res.raw)
	}
}

func TestTheDaysCeilingTurnsTheRouteOffQuietly(t *testing.T) {
	file := filepath.Join(t.TempDir(), "jev-spend.json")
	// 100 dollars a million tokens and a ceiling of 22 cents: two calls of 1000
	// tokens fit (0.10 each), the third would not.
	r, o := decideRig(t, func(d *Decide) { d.USDPerMTok, d.DailyUSD, d.SpendFile = 100, 0.22, file })
	o.tokens = 1000
	for i := 0; i < 2; i++ {
		if res := r.do("POST", "/relay/v1/decide", seatToken, order(1)); res.status != 200 {
			t.Fatalf("decision %d: %d %s", i, res.status, res.raw)
		}
	}
	res := r.do("POST", "/relay/v1/decide", seatToken, order(1))
	if res.status != 503 || res.code() != codeDecideOff {
		t.Fatalf("past the ceiling: %d %s", res.status, res.raw)
	}
	if o.count() != 2 {
		t.Fatalf("the model was asked %d times past the ceiling, want 2", o.count())
	}
	if got := r.relay.decider.spent.today(); got < 0.19 || got > 0.21 {
		t.Fatalf("spent today = %v, want 0.20", got)
	}
	// What was spent is kept, so a restart does not start the day again.
	kept, err := os.ReadFile(file)
	if err != nil || !strings.Contains(string(kept), `"microUSD":200000`) {
		t.Fatalf("the spending file: %q %v", kept, err)
	}
	if again := newSpending(0.22, 100, file); again.reserve(1000) {
		t.Fatal("a restarted relay forgot the day's spending")
	}
	// The next day starts from nothing.
	r.relay.decider.spent.now = func() time.Time { return time.Now().Add(25 * time.Hour) }
	if res := r.do("POST", "/relay/v1/decide", seatToken, order(1)); res.status != 200 {
		t.Fatalf("the next day: %d %s", res.status, res.raw)
	}
}

func TestWithoutTheGamesKeyTheRouteIsOff(t *testing.T) {
	r, o := decideRig(t, func(d *Decide) { d.Key = "" })
	if res := r.do("POST", "/relay/v1/decide", seatToken, order(1)); res.status != 503 || res.code() != codeDecideOff {
		t.Fatalf("no key: %d %s", res.status, res.raw)
	}
	if o.count() != 0 {
		t.Fatal("the model was asked without a key")
	}
	health := r.do("GET", "/relay/healthz", "", nil)
	if d, _ := health.body["decide"].(map[string]any); d["on"] != false || strings.Contains(health.raw, "key") {
		t.Fatalf("health: %s", health.raw)
	}
	on, _ := decideRig(t, nil)
	health = on.do("GET", "/relay/healthz", "", nil)
	if d, _ := health.body["decide"].(map[string]any); d["on"] != true || d["model"] != "jev-1.14.0" || strings.Contains(health.raw, gameKey) {
		t.Fatalf("health with a key: %s", health.raw)
	}
}

func TestTheDecisionModelsFailuresBecomeTheRelaysCodes(t *testing.T) {
	cases := []struct {
		err    *provider.Error
		status int
		code   string
	}{
		// The game's key is wrong: nothing a player can mend, so the brain is told to do without.
		{&provider.Error{Code: provider.BadKey, Status: 401, Message: "bad key " + gameKey}, 503, codeDecideOff},
		{&provider.Error{Code: provider.RateLimited, Status: 429, Message: "slow down"}, 429, codeRateLimited},
		{&provider.Error{Code: provider.Overloaded, Status: 529, Message: "busy"}, 503, codeProvider},
		{&provider.Error{Code: provider.Failed, Status: 400, Message: "no"}, 502, codeProvider},
	}
	for _, c := range cases {
		r, o := decideRig(t, nil)
		o.answer = func(int, provider.Decision) (*provider.Decided, error) { return nil, c.err }
		res := r.do("POST", "/relay/v1/decide", seatToken, order(1))
		if res.status != c.status || res.code() != c.code {
			t.Fatalf("%s: %d %s, want %d %s", c.err.Code, res.status, res.raw, c.status, c.code)
		}
		if strings.Contains(res.raw, gameKey) || strings.Contains(r.logs.String(), gameKey) {
			t.Fatalf("%s: the game's key leaked", c.err.Code)
		}
		// A call that failed is not charged for.
		if spent := r.relay.decider.spent.today(); spent != 0 {
			t.Fatalf("%s: charged %v for a failed call", c.err.Code, spent)
		}
	}
}
