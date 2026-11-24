package relay

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"callsign/relay/provider"
	"callsign/shared"
)

const (
	seatToken  = "seat-token-of-the-west-player-0001"
	otherToken = "seat-token-of-somebody-else-0002"
	apiKey     = "sk-ant-api03-not-a-real-key-ABCD"
)

// brain is a provider that answers from a script and remembers what it was asked.
type brain struct {
	name string
	mu   sync.Mutex
	// answer is called for every thought; nil answers "Wilco".
	answer func(n int, req provider.Request) (*provider.Response, error)
	asked  []provider.Request
	keys   []string
	gate   chan struct{} // when set, a thought waits here
}

func (b *brain) Name() string { return b.name }

func (b *brain) Think(ctx context.Context, key string, req provider.Request) (*provider.Response, error) {
	b.mu.Lock()
	b.asked = append(b.asked, req)
	b.keys = append(b.keys, key)
	n, answer, gate := len(b.asked), b.answer, b.gate
	b.mu.Unlock()
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
	return &provider.Response{
		Content:    []provider.Block{{Type: provider.Text, Text: "Wilco"}},
		StopReason: provider.EndTurn, InputTokens: 100, OutputTokens: 7, Model: req.Model,
	}, nil
}

type rig struct {
	t      *testing.T
	relay  *Relay
	srv    *httptest.Server
	game   *FakeGame
	keys   *KeyStore
	brains map[string]*brain
	player map[string]string // seat token → the player token of whoever holds that seat
	dir    string
	logs   *bytes.Buffer
	logMu  sync.Mutex
}

func newRig(t *testing.T, limits Limits) *rig {
	t.Helper()
	rules, err := shared.Load()
	if err != nil {
		t.Fatal(err)
	}
	models, err := shared.LoadModels(rules)
	if err != nil {
		t.Fatal(err)
	}
	r := &rig{t: t, game: NewFakeGame(), brains: map[string]*brain{}, dir: t.TempDir(), logs: &bytes.Buffer{}}
	master, err := MasterKey("", r.dir)
	if err != nil {
		t.Fatal(err)
	}
	if r.keys, err = OpenKeyStore(r.dir, master, 100); err != nil {
		t.Fatal(err)
	}
	providers := map[string]provider.Provider{}
	for _, name := range provider.Names {
		r.brains[name] = &brain{name: name}
		providers[name] = r.brains[name]
	}
	r.relay, err = New(Config{
		Game: r.game, Keys: r.keys, TokenKey: TokenKey(master), Models: models, Rules: rules, Providers: providers, Limits: limits,
		Origins: []string{"https://play.example"},
		Logf: func(format string, args ...any) {
			r.logMu.Lock()
			defer r.logMu.Unlock()
			fmt.Fprintf(r.logs, format+"\n", args...)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	r.relay.sleep = func(context.Context, time.Duration) error { return nil }
	r.srv = httptest.NewServer(r.relay.Handler())
	t.Cleanup(r.srv.Close)

	r.player = map[string]string{}
	for _, seat := range []string{seatToken, otherToken} {
		if r.player[seat], err = r.relay.Mint(); err != nil {
			t.Fatal(err)
		}
	}
	r.game.Seat("ROOM1", 0, seatToken)
	r.game.Seat("ROOM1", 1, otherToken)
	r.game.Squad("ROOM1", 0, 1, 1)
	r.game.Squad("ROOM1", 0, 2, 2)
	r.game.Squad("ROOM1", 0, 3, 3)
	r.game.Squad("ROOM1", 1, 4, 3)
	return r
}

type result struct {
	status int
	header http.Header
	body   map[string]any
	raw    string
}

func (r result) code() string {
	e, _ := r.body["error"].(map[string]any)
	s, _ := e["code"].(string)
	return s
}

// do makes a call as the person holding a seat: their player token as the bearer and the
// seat's token beside it. Any other `token` is sent as the bearer as it is.
func (r *rig) do(method, path, token string, body any, header ...string) result {
	r.t.Helper()
	if player, ok := r.player[token]; ok {
		header = append([]string{"X-Callsign-Seat", token}, header...)
		token = player
	}
	var reader io.Reader
	switch b := body.(type) {
	case nil:
	case string:
		reader = strings.NewReader(b)
	default:
		raw, _ := json.Marshal(b)
		reader = bytes.NewReader(raw)
	}
	req, _ := http.NewRequest(method, r.srv.URL+path, reader)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for i := 0; i+1 < len(header); i += 2 {
		req.Header.Set(header[i], header[i+1])
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		r.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	out := result{status: res.StatusCode, header: res.Header, raw: string(raw)}
	json.Unmarshal(raw, &out.body)
	return out
}

func (r *rig) putKey(token, name, key string) {
	r.t.Helper()
	if res := r.do("PUT", "/relay/v1/key", token, map[string]string{"provider": name, "key": key}); res.status != 200 {
		r.t.Fatalf("storing a key: %d %s", res.status, res.raw)
	}
}

// thought is a request body as an agent sends it.
func thought(role string, squad int) map[string]any {
	return map[string]any{
		"room": "ROOM1", "side": 0, "role": role, "squad": squad,
		"system": "You lead a squad.",
		"tools": []any{map[string]any{
			"name": "hold", "description": "Hold a point.", "strict": true,
			"input_schema": map[string]any{"type": "object", "properties": map[string]any{"point": map[string]any{"type": "string"}}, "required": []string{"point"}, "additionalProperties": false},
		}},
		"messages": []any{map[string]any{"role": "user", "content": "Radio call for you from Hammer: hold Foxtrot"}},
	}
}

func TestTheTierOnTheGameServerPicksTheModel(t *testing.T) {
	want := map[string][4]string{ // provider → tier 1, 2, 3, operator
		provider.Anthropic:  {"claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5-5"},
		provider.OpenRouter: {"anthropic/claude-haiku-5.5", "anthropic/claude-sonnet-5.5", "anthropic/claude-opus-5.5", "anthropic/claude-opus-5.5"},
		provider.OpenAI:     {"gpt-6-luna", "gpt-6.2-sol", "gpt-6.2-astra", "gpt-6.2-astra"},
		provider.Gemini:     {"gemini-3.5-flash-lite", "gemini-4-hydrogen", "gemini-4-carbon", "gemini-4-carbon"},
	}
	effort := [4]string{"low", "medium", "high", "medium"}
	for _, name := range provider.Names {
		r := newRig(t, Limits{})
		r.putKey(seatToken, name, apiKey)
		for i, body := range []map[string]any{thought("squad", 1), thought("squad", 2), thought("squad", 3), thought("anvil", 0)} {
			res := r.do("POST", "/relay/v1/think", seatToken, body)
			if res.status != 200 || res.body["model"] != want[name][i] || res.body["provider"] != name || res.body["stop_reason"] != "end_turn" {
				t.Fatalf("%s tier %d: %d %s", name, i+1, res.status, res.raw)
			}
			asked := r.brains[name].asked[i]
			if asked.Model != want[name][i] || asked.Effort != effort[i] || asked.MaxTokens != 4096 {
				t.Errorf("%s tier %d was asked with %s/%s/%d", name, i+1, asked.Model, asked.Effort, asked.MaxTokens)
			}
		}
		if got := r.brains[name].keys[0]; got != apiKey {
			t.Errorf("%s was called with key %q", name, got)
		}
	}
}

func TestAnUpgradeChangesTheModelOnTheNextThought(t *testing.T) {
	r := newRig(t, Limits{})
	r.putKey(seatToken, provider.Anthropic, apiKey)
	if res := r.do("POST", "/relay/v1/think", seatToken, thought("squad", 1)); res.body["model"] != "claude-haiku-5-5" {
		t.Fatalf("before: %s", res.raw)
	}
	r.game.Squad("ROOM1", 0, 1, 3) // bought with gold on the game server
	if res := r.do("POST", "/relay/v1/think", seatToken, thought("squad", 1)); res.body["model"] != "claude-opus-5-5" {
		t.Fatalf("after: %s", res.raw)
	}
	if r.game.Asked != 2 {
		t.Fatalf("the game server was asked %d times for 2 thoughts: the tier must never be remembered", r.game.Asked)
	}
}

func TestACallerCannotNameAModelOrAnAddress(t *testing.T) {
	r := newRig(t, Limits{})
	r.putKey(seatToken, provider.Anthropic, apiKey)
	for _, field := range []string{"model", "max_tokens", "tier", "provider", "url", "base_url", "effort", "temperature", "stream"} {
		body := thought("squad", 1)
		body[field] = "claude-opus-5-5"
		if res := r.do("POST", "/relay/v1/think", seatToken, body); res.status != 400 || res.code() != codeBadRequest {
			t.Errorf("a request with %q got %d %s", field, res.status, res.raw)
		}
	}
	body := thought("squad", 1)
	body["tools"].([]any)[0].(map[string]any)["cache_control"] = map[string]string{"type": "ephemeral"}
	if res := r.do("POST", "/relay/v1/think", seatToken, body); res.status != 400 {
		t.Errorf("an unknown tool field got %d", res.status)
	}
	if n := len(r.brains[provider.Anthropic].asked); n != 0 {
		t.Fatalf("%d refused requests reached the provider", n)
	}
}

func TestOnlyTheSeatHolderThinksForASquad(t *testing.T) {
	r := newRig(t, Limits{})
	r.putKey(seatToken, provider.Anthropic, apiKey)
	r.putKey(otherToken, provider.Anthropic, apiKey)
	cases := []struct {
		name  string
		token string
		body  map[string]any
		want  int
	}{
		{"no token", "", thought("squad", 1), 401},
		{"short token", "abc", thought("squad", 1), 401},
		{"the other side's token", otherToken, thought("squad", 1), 403},
		{"a squad of the other side", seatToken, thought("squad", 4), 403},
		{"a squad that does not exist", seatToken, thought("squad", 99), 403},
	}
	other := thought("squad", 1)
	other["room"] = "ROOM2"
	cases = append(cases, struct {
		name  string
		token string
		body  map[string]any
		want  int
	}{"another room", seatToken, other, 403})
	for _, tc := range cases {
		if res := r.do("POST", "/relay/v1/think", tc.token, tc.body); res.status != tc.want || res.code() != codeNotYourSeat {
			t.Errorf("%s: %d %s", tc.name, res.status, res.raw)
		}
	}
	if n := len(r.brains[provider.Anthropic].asked); n != 0 {
		t.Fatalf("%d refused requests reached the provider", n)
	}
	// When the game server cannot be asked, nobody thinks: there is no tier to guess.
	r.game.Err = fmt.Errorf("down")
	if res := r.do("POST", "/relay/v1/think", seatToken, thought("squad", 1)); res.status != 503 || res.code() != codeProvider {
		t.Errorf("game server down: %d %s", res.status, res.raw)
	}
}

func TestBadRequests(t *testing.T) {
	r := newRig(t, Limits{})
	r.putKey(seatToken, provider.Anthropic, apiKey)
	change := func(f func(map[string]any)) map[string]any {
		b := thought("squad", 1)
		f(b)
		return b
	}
	bodies := map[string]any{
		"not JSON":             "{",
		"two values":           `{"room":"ROOM1","side":0,"role":"anvil","squad":0,"messages":[{"role":"user","content":"x"}]} {}`,
		"no side":              change(func(b map[string]any) { delete(b, "side") }),
		"side 2":               change(func(b map[string]any) { b["side"] = 2 }),
		"unknown role":         change(func(b map[string]any) { b["role"] = "spectator" }),
		"squad without an id":  change(func(b map[string]any) { b["squad"] = 0 }),
		"operator with squad":  change(func(b map[string]any) { b["role"] = "anvil" }),
		"room with a slash":    change(func(b map[string]any) { b["room"] = "../x" }),
		"no messages":          change(func(b map[string]any) { b["messages"] = []any{} }),
		"assistant first":      change(func(b map[string]any) { b["messages"] = []any{map[string]any{"role": "assistant", "content": "hi"}} }),
		"system role":          change(func(b map[string]any) { b["messages"] = []any{map[string]any{"role": "system", "content": "hi"}} }),
		"content is a number":  change(func(b map[string]any) { b["messages"] = []any{map[string]any{"role": "user", "content": 5}} }),
		"tool name with a dot": change(func(b map[string]any) { b["tools"].([]any)[0].(map[string]any)["name"] = "a.b" }),
		"schema not an object": change(func(b map[string]any) { b["tools"].([]any)[0].(map[string]any)["input_schema"] = "x" }),
		"tool_use from the user": change(func(b map[string]any) {
			b["messages"] = []any{map[string]any{"role": "user", "content": []any{map[string]any{"type": "tool_use", "id": "a", "name": "hold", "input": map[string]any{}}}}}
		}),
		"system too long": change(func(b map[string]any) { b["system"] = strings.Repeat("x", maxSystem+1) }),
	}
	for name, body := range bodies {
		if res := r.do("POST", "/relay/v1/think", seatToken, body); res.status != 400 || res.code() != codeBadRequest {
			t.Errorf("%s: %d %s", name, res.status, res.raw)
		}
	}
	if res := r.do("POST", "/relay/v1/think", seatToken, strings.Repeat("x", maxBody+10)); res.status != 413 {
		t.Errorf("an oversized body got %d", res.status)
	}
	if res := r.do("GET", "/relay/v1/think", seatToken, nil); res.status != 405 {
		t.Errorf("GET think got %d", res.status)
	}
	if n := len(r.brains[provider.Anthropic].asked); n != 0 {
		t.Fatalf("%d bad requests reached the provider", n)
	}
}

func TestAConversationPassesThroughInShape(t *testing.T) {
	r := newRig(t, Limits{})
	r.putKey(seatToken, provider.Gemini, apiKey)
	state := `{"type":"relay_state","provider":"gemini","steps":[{"type":"thought","signature":"s1"}]}`
	r.brains[provider.Gemini].answer = func(int, provider.Request) (*provider.Response, error) {
		return &provider.Response{
			Content: []provider.Block{
				{Type: provider.State, Raw: json.RawMessage(state), Origin: provider.Gemini},
				{Type: provider.Text, Text: "Moving."},
				{Type: provider.ToolUse, ID: "call_7", Name: "hold", Input: json.RawMessage(`{"point":"F"}`)},
			},
			StopReason: provider.StopTool, InputTokens: 50, OutputTokens: 9, Model: "gemini-4-hydrogen",
		}, nil
	}
	body := thought("squad", 2)
	res := r.do("POST", "/relay/v1/think", seatToken, body)
	if res.status != 200 {
		t.Fatal(res.raw)
	}
	var got struct {
		Content    []map[string]any `json:"content"`
		StopReason string           `json:"stop_reason"`
		Usage      map[string]int   `json:"usage"`
	}
	json.Unmarshal([]byte(res.raw), &got)
	if got.StopReason != "tool_use" || got.Usage["input_tokens"] != 50 || got.Usage["output_tokens"] != 9 || len(got.Content) != 3 ||
		got.Content[0]["type"] != "relay_state" || got.Content[1]["text"] != "Moving." || got.Content[2]["id"] != "call_7" ||
		got.Content[2]["input"].(map[string]any)["point"] != "F" {
		t.Fatalf("answer = %s", res.raw)
	}

	// The agent echoes the turn and adds the result, with a block the relay does not
	// carry and a field it does not know: both are left behind.
	turn := []any{}
	for _, b := range got.Content {
		turn = append(turn, b)
	}
	turn = append(turn, map[string]any{"type": "image", "source": map[string]any{"type": "url", "url": "https://example.com/x.png"}})
	body["messages"] = append(body["messages"].([]any),
		map[string]any{"role": "assistant", "content": turn},
		map[string]any{"role": "user", "content": []any{map[string]any{
			"type": "tool_result", "tool_use_id": "call_7", "is_error": true, "cache_control": map[string]string{"type": "ephemeral"},
			"content": []any{map[string]any{"type": "text", "text": "no such point"}},
		}}})
	if res := r.do("POST", "/relay/v1/think", seatToken, body); res.status != 200 {
		t.Fatal(res.raw)
	}
	asked := r.brains[provider.Gemini].asked[1].Messages
	if len(asked) != 3 || len(asked[1].Blocks) != 3 || asked[1].Blocks[0].Type != provider.State || asked[1].Blocks[0].Origin != provider.Gemini ||
		asked[1].Blocks[2].ID != "call_7" {
		t.Fatalf("the assistant turn reached the provider as %+v", asked[1].Blocks)
	}
	// This test's client rewrites JSON through a map, which reorders keys; a browser does
	// not. What matters here is that the block arrives whole.
	var sentState, gotState any
	json.Unmarshal([]byte(state), &sentState)
	json.Unmarshal(asked[1].Blocks[0].Raw, &gotState)
	if fmt.Sprint(sentState) != fmt.Sprint(gotState) {
		t.Fatalf("the state block arrived as %s", asked[1].Blocks[0].Raw)
	}
	if r := asked[2].Blocks[0]; r.Type != provider.ToolResult || r.Content != "no such point" || !r.IsError || r.ToolUseID != "call_7" {
		t.Fatalf("the tool result reached the provider as %+v", r)
	}
}

func TestKeys(t *testing.T) {
	r := newRig(t, Limits{})
	if res := r.do("GET", "/relay/v1/key", seatToken, nil); res.status != 200 || res.body["set"] != false {
		t.Fatalf("before: %s", res.raw)
	}
	if res := r.do("POST", "/relay/v1/think", seatToken, thought("squad", 1)); res.status != 428 || res.code() != codeNoKey {
		t.Fatalf("thinking with no key: %d %s", res.status, res.raw)
	}
	res := r.do("PUT", "/relay/v1/key", seatToken, map[string]string{"provider": "anthropic", "key": "  " + apiKey + "\n"})
	if res.status != 200 || res.body["set"] != true || res.body["provider"] != "anthropic" || res.body["hint"] != "…ABCD" {
		t.Fatalf("put: %s", res.raw)
	}
	res = r.do("GET", "/relay/v1/key", seatToken, nil)
	if res.body["set"] != true || res.body["hint"] != "…ABCD" || strings.Contains(res.raw, apiKey) || strings.Contains(res.raw, apiKey[:20]) {
		t.Fatalf("get: %s", res.raw)
	}
	// Another seat sees nothing of it.
	if res := r.do("GET", "/relay/v1/key", otherToken, nil); res.body["set"] != false {
		t.Fatalf("another seat reads: %s", res.raw)
	}

	// On disk: one file named by a hash, holding neither the key nor the token.
	files, _ := os.ReadDir(filepath.Join(r.dir, "keys"))
	if len(files) != 1 || files[0].Name() != SeatID(r.player[seatToken])+".json" {
		t.Fatalf("key files: %v", files)
	}
	path := filepath.Join(r.dir, "keys", files[0].Name())
	data, _ := os.ReadFile(path)
	if bytes.Contains(data, []byte(apiKey)) || bytes.Contains(data, []byte("ABCD")) || bytes.Contains(data, []byte(seatToken)) || bytes.Contains(data, []byte(r.player[seatToken])) || bytes.Contains(data, []byte("anthropic")) {
		t.Fatalf("the stored file is not sealed: %s", data)
	}
	for _, name := range []string{path, filepath.Join(r.dir, "master.key")} {
		if info, _ := os.Stat(name); info.Mode().Perm() != 0o600 {
			t.Errorf("%s has mode %v, want 0600", name, info.Mode().Perm())
		}
	}

	bad := []map[string]string{
		{"provider": "mistral", "key": apiKey},
		{"provider": "anthropic", "key": "short"},
		{"provider": "anthropic", "key": "has a space in the middle of it"},
		{"provider": "anthropic", "key": "sk-ant-oat01-a-subscription-token-not-a-key"},
		{"provider": "anthropic", "key": apiKey, "url": "https://elsewhere.example"},
	}
	for _, b := range bad {
		if res := r.do("PUT", "/relay/v1/key", seatToken, b); res.status != 400 || res.code() != codeBadRequest {
			t.Errorf("put %v: %d %s", b, res.status, res.raw)
		}
	}
	if res := r.do("GET", "/relay/v1/key", seatToken, nil); res.body["hint"] != "…ABCD" {
		t.Fatalf("a refused put changed the key: %s", res.raw)
	}

	if res := r.do("DELETE", "/relay/v1/key", seatToken, nil); res.status != 200 || res.body["set"] != false {
		t.Fatalf("delete: %s", res.raw)
	}
	if files, _ := os.ReadDir(filepath.Join(r.dir, "keys")); len(files) != 0 {
		t.Fatalf("after delete: %v", files)
	}
	if res := r.do("DELETE", "/relay/v1/key", seatToken, nil); res.status != 200 {
		t.Fatalf("deleting twice: %s", res.raw)
	}
}

func TestStoredKeysAreBoundToTheirSeatAndTheMasterKey(t *testing.T) {
	dir := t.TempDir()
	master, _ := MasterKey("", dir)
	again, _ := MasterKey("", dir)
	if !bytes.Equal(master, again) || len(master) != 32 {
		t.Fatal("the master key file is not stable")
	}
	store, _ := OpenKeyStore(dir, master, 2)
	a, b := SeatID("token-a-0123456789"), SeatID("token-b-0123456789")
	if err := store.Put(a, Stored{Provider: "openai", Key: "sk-aaaaaaaaaaaaaaaaaaaa"}); err != nil {
		t.Fatal(err)
	}
	if got, err := store.Get(a); err != nil || got.Key != "sk-aaaaaaaaaaaaaaaaaaaa" || got.Provider != "openai" {
		t.Fatalf("get = %+v, %v", got, err)
	}
	// A sealed file copied to another seat's name does not open there.
	data, _ := os.ReadFile(store.path(a))
	os.WriteFile(store.path(b), data, 0o600)
	if _, err := store.Get(b); err == nil {
		t.Fatal("a key file moved to another seat opened")
	}
	// The store is bounded, and replacing a key does not count as a new one.
	if err := store.Put(a, Stored{Provider: "openai", Key: "sk-bbbbbbbbbbbbbbbbbbbb"}); err != nil {
		t.Fatalf("replacing a key in a full store: %v", err)
	}
	if err := store.Put(SeatID("token-c-0123456789"), Stored{}); err != ErrStoreFull {
		t.Fatalf("a third key in a store of two: %v", err)
	}
	// Another master key opens nothing.
	other, _ := OpenKeyStore(dir, bytes.Repeat([]byte{7}, 32), 2)
	if _, err := other.Get(a); err == nil {
		t.Fatal("a key opened under the wrong master key")
	}
	// From the environment: hex or base64 of 32 bytes, nothing else.
	if k, err := MasterKey(strings.Repeat("ab", 32), ""); err != nil || len(k) != 32 {
		t.Fatalf("hex master key: %v", err)
	}
	if _, err := MasterKey("too-short", ""); err == nil {
		t.Fatal("a short master key was accepted")
	}
	// A master key file others can read is refused.
	os.Chmod(filepath.Join(dir, "master.key"), 0o644)
	if _, err := MasterKey("", dir); err == nil {
		t.Fatal("a world-readable master key file was accepted")
	}
}

func TestProviderFailuresBecomeTheRelaysCodes(t *testing.T) {
	cases := []struct {
		err    *provider.Error
		status int
		code   string
		calls  int
	}{
		{&provider.Error{Code: provider.BadKey, Status: 401, Message: "invalid x-api-key"}, 424, codeBadKey, 1},
		{&provider.Error{Code: provider.RateLimited, Status: 429, Message: "slow down", RetryAfter: 9 * time.Second}, 429, codeRateLimited, 1},
		{&provider.Error{Code: provider.Failed, Status: 400, Message: "roles must alternate"}, 502, codeProvider, 1},
		{&provider.Error{Code: provider.Overloaded, Status: 529, Message: "Overloaded"}, 503, codeProvider, 2},
	}
	for _, tc := range cases {
		r := newRig(t, Limits{})
		r.putKey(seatToken, provider.Anthropic, apiKey)
		b := r.brains[provider.Anthropic]
		b.answer = func(int, provider.Request) (*provider.Response, error) { return nil, tc.err }
		res := r.do("POST", "/relay/v1/think", seatToken, thought("squad", 1))
		if res.status != tc.status || res.code() != tc.code || len(b.asked) != tc.calls {
			t.Errorf("%s: %d %s after %d calls, want %d %s after %d", tc.err.Code, res.status, res.raw, len(b.asked), tc.status, tc.code, tc.calls)
		}
		if tc.code == codeRateLimited && res.header.Get("Retry-After") != "9" {
			t.Errorf("Retry-After = %q, want 9", res.header.Get("Retry-After"))
		}
		if strings.Contains(res.raw, apiKey) {
			t.Error("the key is in an error answer")
		}
	}

	// Overload once, then an answer: the one retry saves the thought.
	r := newRig(t, Limits{})
	r.putKey(seatToken, provider.OpenAI, apiKey)
	b := r.brains[provider.OpenAI]
	b.answer = func(n int, req provider.Request) (*provider.Response, error) {
		if n == 1 {
			return nil, &provider.Error{Code: provider.Overloaded, Status: 503, Message: "overloaded"}
		}
		return &provider.Response{StopReason: provider.EndTurn, Model: req.Model}, nil
	}
	if res := r.do("POST", "/relay/v1/think", seatToken, thought("squad", 1)); res.status != 200 || len(b.asked) != 2 {
		t.Fatalf("retry: %d %s after %d calls", res.status, res.raw, len(b.asked))
	}
	// A refusal is an answer, not an error.
	b.answer = func(int, provider.Request) (*provider.Response, error) {
		return &provider.Response{StopReason: provider.Refusal}, nil
	}
	if res := r.do("POST", "/relay/v1/think", seatToken, thought("squad", 1)); res.status != 200 || res.body["stop_reason"] != "refusal" || res.raw == "" || !strings.Contains(res.raw, `"content":[]`) {
		t.Fatalf("refusal: %d %s", res.status, res.raw)
	}
}

func TestASeatIsLimited(t *testing.T) {
	r := newRig(t, Limits{Concurrent: 2, PerMinute: 60, Burst: 3, KeyChanges: 4, Idle: time.Minute})
	r.putKey(seatToken, provider.Anthropic, apiKey)
	r.putKey(otherToken, provider.Anthropic, apiKey)
	b := r.brains[provider.Anthropic]
	b.gate = make(chan struct{})

	// Two thoughts in flight fill the seat; a third is turned away, another seat is not.
	done := make(chan result, 3)
	for i := 0; i < 2; i++ {
		go func() { done <- r.do("POST", "/relay/v1/think", seatToken, thought("squad", 1)) }()
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		b.mu.Lock()
		n := len(b.asked)
		b.mu.Unlock()
		if n == 2 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the first two thoughts never reached the provider")
		}
		time.Sleep(5 * time.Millisecond)
	}
	if res := r.do("POST", "/relay/v1/think", seatToken, thought("squad", 1)); res.status != 429 || res.code() != codeRateLimited || res.header.Get("Retry-After") == "" {
		t.Fatalf("a third thought at once: %d %s", res.status, res.raw)
	}
	go func() {
		body := thought("squad", 4)
		body["side"] = 1
		done <- r.do("POST", "/relay/v1/think", otherToken, body)
	}()
	for i := 0; i < 3; i++ {
		b.gate <- struct{}{}
	}
	for i := 0; i < 3; i++ {
		if res := <-done; res.status != 200 {
			t.Fatalf("an admitted thought failed: %d %s", res.status, res.raw)
		}
	}

	// The burst: three thoughts started, two were used above, so one more passes.
	b.mu.Lock()
	b.gate = nil
	b.mu.Unlock()
	if res := r.do("POST", "/relay/v1/think", seatToken, thought("squad", 1)); res.status != 200 {
		t.Fatalf("the third of the burst: %d %s", res.status, res.raw)
	}
	if res := r.do("POST", "/relay/v1/think", seatToken, thought("squad", 1)); res.status != 429 {
		t.Fatalf("past the burst: %d %s", res.status, res.raw)
	}
	// A minute later the seat may think again.
	r.relay.limits.now = func() time.Time { return time.Now().Add(time.Minute) }
	if res := r.do("POST", "/relay/v1/think", seatToken, thought("squad", 1)); res.status != 200 {
		t.Fatalf("after a minute: %d %s", res.status, res.raw)
	}

	// Key requests have their own small budget (one was spent storing the key).
	r.relay.limits.now = time.Now
	codes := []int{}
	for i := 0; i < 6; i++ {
		codes = append(codes, r.do("GET", "/relay/v1/key", otherToken, nil).status)
	}
	if fmt.Sprint(codes) != "[200 200 200 429 429 429]" {
		t.Fatalf("key requests: %v", codes)
	}
}

func TestOnlyTheGamesOwnPagesMayCall(t *testing.T) {
	r := newRig(t, Limits{})
	r.putKey(seatToken, provider.Anthropic, apiKey)
	host := strings.TrimPrefix(r.srv.URL, "http://")

	// Same origin, as a page reaches the relay through the game server: allowed, no CORS.
	res := r.do("GET", "/relay/v1/key", seatToken, nil, "Origin", "http://"+host)
	if res.status != 200 || res.header.Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("same origin: %d %v", res.status, res.header)
	}
	// An origin on the list: allowed, and told so.
	res = r.do("GET", "/relay/v1/key", seatToken, nil, "Origin", "https://play.example")
	if res.status != 200 || res.header.Get("Access-Control-Allow-Origin") != "https://play.example" {
		t.Fatalf("listed origin: %d %v", res.status, res.header)
	}
	res = r.do("OPTIONS", "/relay/v1/think", "", nil, "Origin", "https://play.example", "Access-Control-Request-Method", "POST")
	if res.status != 204 || !strings.Contains(res.header.Get("Access-Control-Allow-Headers"), "Authorization") {
		t.Fatalf("preflight: %d %v", res.status, res.header)
	}
	// Any other page: refused before anything is read, and never told it may read.
	for _, origin := range []string{"https://evil.example", "http://" + host + ".evil.example", "null"} {
		for _, call := range [][2]string{{"GET", "/relay/v1/key"}, {"POST", "/relay/v1/think"}, {"OPTIONS", "/relay/v1/think"}} {
			res := r.do(call[0], call[1], seatToken, thought("squad", 1), "Origin", origin)
			if res.status != 403 || res.header.Get("Access-Control-Allow-Origin") != "" {
				t.Errorf("%s %s from %s: %d %v", call[0], call[1], origin, res.status, res.header)
			}
		}
	}
	if n := len(r.brains[provider.Anthropic].asked); n != 0 {
		t.Fatalf("%d foreign requests reached the provider", n)
	}
}

func TestTheLogSaysWhoAndHowMuchNeverWhat(t *testing.T) {
	r := newRig(t, Limits{})
	r.putKey(seatToken, provider.Anthropic, apiKey)
	body := thought("squad", 2)
	body["system"] = "SECRET-SYSTEM-PROMPT"
	body["messages"] = []any{map[string]any{"role": "user", "content": "SECRET-ORDER"}}
	res := r.do("POST", "/relay/v1/think", seatToken, body)
	if res.status != 200 || res.header.Get("X-Request-Id") == "" {
		t.Fatal(res.raw)
	}
	r.do("POST", "/relay/v1/think", otherToken, thought("squad", 1))
	r.logMu.Lock()
	logs := r.logs.String()
	r.logMu.Unlock()
	for _, secret := range []string{apiKey, "ABCD", seatToken, otherToken, r.player[seatToken], r.player[otherToken], "SECRET-SYSTEM-PROMPT", "SECRET-ORDER", "Wilco"} {
		if strings.Contains(logs, secret) {
			t.Errorf("the log holds %q:\n%s", secret, logs)
		}
	}
	for _, want := range []string{
		"req=" + res.header.Get("X-Request-Id"), "seat=" + SeatID(r.player[seatToken])[:8], "room=ROOM1 side=0 role=squad squad=2 tier=2",
		"provider=anthropic model=claude-sonnet-5-5 in=100 out=7", "result=end_turn", "result=not_your_seat",
	} {
		if !strings.Contains(logs, want) {
			t.Errorf("the log lacks %q:\n%s", want, logs)
		}
	}
}

func TestHTTPGame(t *testing.T) {
	var got *http.Request
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		got = req
		switch req.URL.Query().Get("squad") {
		case "7":
			w.WriteHeader(http.StatusForbidden)
		case "8":
			w.WriteHeader(http.StatusNotFound)
		case "9":
			w.WriteHeader(http.StatusInternalServerError)
		default:
			w.Write([]byte(`{"tier":2}`))
		}
	}))
	defer srv.Close()
	g := &HTTPGame{URL: srv.URL + "/internal/tier", Secret: "shared-secret"}
	tier, err := g.Tier(context.Background(), seatToken, "ROOM1", 1, 3)
	if err != nil || tier != 2 {
		t.Fatalf("tier = %d, %v", tier, err)
	}
	if got.Method != "GET" || got.URL.Path != "/internal/tier" || got.URL.RawQuery != "room=ROOM1&side=1&squad=3" ||
		got.Header.Get("X-Callsign-Seat") != seatToken || got.Header.Get("Authorization") != "Bearer shared-secret" {
		t.Fatalf("asked %s %s with %v", got.Method, got.URL, got.Header)
	}
	for squad, want := range map[int]error{7: ErrNotYourSeat, 8: ErrNotYourSeat} {
		if _, err := g.Tier(context.Background(), seatToken, "ROOM1", 0, squad); err != want {
			t.Errorf("squad %d: %v", squad, err)
		}
	}
	if _, err := g.Tier(context.Background(), seatToken, "ROOM1", 0, 9); err == nil || err == ErrNotYourSeat {
		t.Errorf("a failing game server: %v", err)
	}
	srv.Close()
	if _, err := g.Tier(context.Background(), seatToken, "ROOM1", 0, 1); err == nil || err == ErrNotYourSeat {
		t.Errorf("an unreachable game server: %v", err)
	}
}

// roundTrip answers in a provider's place.
type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

// The whole path with the real translators: a browser's request in, the provider's own
// wire format out to its one address, and the provider's answer back in the game's shape.
func TestTheWholePathToEachProvider(t *testing.T) {
	answers := map[string]string{
		"api.anthropic.com":                 `{"model":"claude-haiku-5-5","content":[{"type":"tool_use","id":"toolu_1","name":"hold","input":{"point":"F"}}],"stop_reason":"tool_use","usage":{"input_tokens":30,"output_tokens":12}}`,
		"openrouter.ai":                     `{"model":"anthropic/claude-haiku-5.5","choices":[{"finish_reason":"tool_calls","message":{"content":null,"tool_calls":[{"id":"toolu_1","type":"function","function":{"name":"hold","arguments":"{\"point\":\"F\"}"}}]}}],"usage":{"prompt_tokens":30,"completion_tokens":12}}`,
		"api.openai.com":                    `{"model":"gpt-6-luna","choices":[{"finish_reason":"tool_calls","message":{"content":null,"tool_calls":[{"id":"toolu_1","type":"function","function":{"name":"hold","arguments":"{\"point\":\"F\"}"}}]}}],"usage":{"prompt_tokens":30,"completion_tokens":12}}`,
		"generativelanguage.googleapis.com": `{"model":"gemini-3.5-flash-lite","status":"requires_action","steps":[{"type":"function_call","id":"toolu_1","name":"hold","arguments":{"point":"F"}}],"usage":{"total_input_tokens":30,"total_output_tokens":12}}`,
	}
	hosts := map[string]string{provider.Anthropic: "api.anthropic.com", provider.OpenRouter: "openrouter.ai", provider.OpenAI: "api.openai.com", provider.Gemini: "generativelanguage.googleapis.com"}
	models := map[string]string{provider.Anthropic: "claude-haiku-5-5", provider.OpenRouter: "anthropic/claude-haiku-5.5", provider.OpenAI: "gpt-6-luna", provider.Gemini: "gemini-3.5-flash-lite"}
	for _, name := range provider.Names {
		var called []string
		r := newRig(t, Limits{})
		r.relay.cfg.Providers = provider.All(roundTrip(func(req *http.Request) (*http.Response, error) {
			raw, _ := io.ReadAll(req.Body)
			var body struct {
				Model string `json:"model"`
			}
			json.Unmarshal(raw, &body)
			called = append(called, req.URL.Scheme+"://"+req.URL.Host+" "+body.Model)
			return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(answers[req.URL.Host])), Request: req}, nil
		}))
		r.putKey(seatToken, name, apiKey)
		res := r.do("POST", "/relay/v1/think", seatToken, thought("squad", 1))
		if res.status != 200 {
			t.Fatalf("%s: %d %s", name, res.status, res.raw)
		}
		if len(called) != 1 || called[0] != "https://"+hosts[name]+" "+models[name] {
			t.Errorf("%s called %v", name, called)
		}
		var got struct {
			Content    []map[string]any `json:"content"`
			StopReason string           `json:"stop_reason"`
			Usage      map[string]int   `json:"usage"`
			Model      string           `json:"model"`
			Provider   string           `json:"provider"`
		}
		json.Unmarshal([]byte(res.raw), &got)
		call := got.Content[len(got.Content)-1]
		if got.StopReason != "tool_use" || got.Provider != name || got.Model != models[name] || got.Usage["input_tokens"] != 30 || got.Usage["output_tokens"] != 12 ||
			call["type"] != "tool_use" || call["id"] != "toolu_1" || call["name"] != "hold" || call["input"].(map[string]any)["point"] != "F" {
			t.Errorf("%s answered %s", name, res.raw)
		}
	}
}

func TestModelsFileCoversEveryTier(t *testing.T) {
	rules, _ := shared.Load()
	models, err := shared.LoadModels(rules)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range provider.Names {
		if models.Providers[name] == nil {
			t.Errorf("models.json has no provider %s", name)
		}
	}
	if len(models.Providers) != len(provider.Names) {
		t.Errorf("models.json names providers the relay does not have: %v", models.Providers)
	}
}

// A player token is the relay's own: it signs the ones it hands out and takes no other, so
// a key cannot be stored under a made-up name, and thinking needs a seat's token as well.
func TestPlayerTokens(t *testing.T) {
	r := newRig(t, Limits{})
	res := r.do("POST", "/relay/v1/player", "", nil)
	token, _ := res.body["token"].(string)
	if res.status != 200 || !strings.HasPrefix(token, "p1.") || !r.relay.isPlayer(token) {
		t.Fatalf("asking for a player token: %d %s", res.status, res.raw)
	}
	key := map[string]string{"provider": "anthropic", "key": apiKey}
	forged := token[:len(token)-2] + "xx"
	for name, bearer := range map[string]string{"made up": "a-made-up-token-of-decent-length", "forged": forged, "a seat token": seatToken + "x", "none": ""} {
		if res := r.do("PUT", "/relay/v1/key", bearer, key); res.status != 401 || res.code() != codeNotYourSeat {
			t.Errorf("%s: storing a key gave %d %s", name, res.status, res.raw)
		}
	}
	if files, _ := os.ReadDir(filepath.Join(r.dir, "keys")); len(files) != 0 {
		t.Fatalf("a refused token left %d files in the store", len(files))
	}
	if res := r.do("PUT", "/relay/v1/key", token, key); res.status != 200 {
		t.Fatalf("a minted token could not store a key: %d %s", res.status, res.raw)
	}
	// The key alone thinks for nobody: without a seat, or with a seat that is not theirs.
	if res := r.do("POST", "/relay/v1/think", token, thought("squad", 1)); res.status != 401 || res.code() != codeNotYourSeat {
		t.Errorf("thinking with no seat token: %d %s", res.status, res.raw)
	}
	if res := r.do("POST", "/relay/v1/think", token, thought("squad", 1), "X-Callsign-Seat", "a-seat-token-nobody-was-given"); res.status != 403 || res.code() != codeNotYourSeat {
		t.Errorf("thinking with a wrong seat token: %d %s", res.status, res.raw)
	}
	// The same player keeps the key from one match to the next: a new seat, the same token.
	r.game.Seat("ROOM2", 1, "the-seat-of-the-next-match-0003")
	r.game.Squad("ROOM2", 1, 5, 1)
	next := thought("squad", 5)
	next["room"], next["side"] = "ROOM2", 1
	if res := r.do("POST", "/relay/v1/think", token, next, "X-Callsign-Seat", "the-seat-of-the-next-match-0003"); res.status != 200 {
		t.Errorf("thinking in the next match on the stored key: %d %s", res.status, res.raw)
	}
	// Tokens survive a restart: another relay on the same master key takes them.
	if !(&Relay{cfg: Config{TokenKey: r.relay.cfg.TokenKey}}).isPlayer(token) || (&Relay{cfg: Config{TokenKey: bytes.Repeat([]byte{7}, 32)}}).isPlayer(token) {
		t.Error("a player token must be good under the same token key and no other")
	}
}
