package room

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"callsign/server/sim"
)

func newHub(t *testing.T, cfg HubConfig) *Hub {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	cfg.Factions = [2]string{"aegis", "ashfall"}
	if cfg.Seed == 0 {
		cfg.Seed = 1
	}
	if cfg.Interval == 0 {
		cfg.Interval = time.Hour // tests tick by hand
	}
	h, err := NewHub(ctx, rules, cfg)
	if err != nil {
		t.Fatal(err)
	}
	return h
}

// raw is a frame with everything this file looks at kept as sent.
type raw struct {
	Type  string `json:"type"`
	Lobby *LobbyView
	State struct {
		Squads    []struct{ Side int }
		Contacts  []struct{ Side int }
		Deploying []struct{ Side int }
		Fog       json.RawMessage
	}
	Message Message
	Event   sim.Event
}

func frames(t *testing.T, c *Client) []raw {
	t.Helper()
	var out []raw
	for {
		select {
		case b, ok := <-c.Out:
			if !ok {
				return out
			}
			var f raw
			if err := json.Unmarshal(b, &f); err != nil {
				t.Fatalf("bad frame %s: %v", b, err)
			}
			out = append(out, f)
		default:
			return out
		}
	}
}

func enter(t *testing.T, rm *Room, side int, role, token string) *Client {
	t.Helper()
	c, err := rm.Enter(Identity{Side: side, Role: role}, Auth{Token: token}, true)
	if err != nil {
		t.Fatalf("%s on side %d: %v", role, side, err)
	}
	return c
}

func TestFriendMatchStartsWhenBothAreReady(t *testing.T) {
	h := newHub(t, HubConfig{Bot: "standard"})
	rm, side, token, err := h.Create(Options{Opponent: OpponentFriend, Side: 0})
	if err != nil || side != 0 || token == "" {
		t.Fatalf("create: side %d token %q err %v", side, token, err)
	}
	code := rm.Lobby().Room
	if len(code) != 5 || h.Room(strings.ToLower(code)) != rm {
		t.Fatalf("code %q should find its room in any letter case", code)
	}
	if l := rm.Lobby(); l.Phase != "lobby" || !l.Seats[0].Taken || l.Seats[1].Taken || l.Seats[0].Bot || l.Seats[1].Bot {
		t.Fatalf("lobby after create: %+v", l)
	}
	host := enter(t, rm, 0, RoleHammer, token)

	// The same seat cannot be taken twice; the friend gets the other one.
	if _, _, err := rm.Sit(0); err != ErrSeatTaken {
		t.Fatalf("second sit on side 0: %v", err)
	}
	fside, ftoken, err := rm.Sit(-1)
	if err != nil || fside != 1 || ftoken == token {
		t.Fatalf("friend sit: side %d err %v", fside, err)
	}
	if _, _, err := rm.Sit(-1); err != ErrSeatTaken {
		t.Fatalf("a third person got a seat: %v", err)
	}
	friend := enter(t, rm, 1, RoleHammer, ftoken)

	// Nothing moves until both are ready.
	if err := rm.Ready(host, true); err != nil {
		t.Fatal(err)
	}
	rm.Tick()
	rm.View(func(s *sim.Sim) {
		if s.Tick != 0 {
			t.Fatalf("the clock ran with one commander ready: tick %d", s.Tick)
		}
	})
	if err := rm.Ready(friend, true); err != nil {
		t.Fatal(err)
	}
	rm.Tick()
	rm.View(func(s *sim.Sim) {
		if s.Tick != 1 {
			t.Fatalf("the clock did not start with both ready: tick %d", s.Tick)
		}
	})
	var last *LobbyView
	for _, f := range frames(t, friend) {
		if f.Type == "lobby" {
			last = f.Lobby
		}
	}
	if last == nil || last.Phase != "playing" || !last.Seats[0].Ready || !last.Seats[1].Online {
		t.Fatalf("the friend's last lobby frame: %+v", last)
	}
	// A friend match has no scripted player on either side.
	rm.View(func(s *sim.Sim) {
		for side, b := range rm.bots {
			if b != nil {
				t.Fatalf("side %d is played by a bot", side)
			}
		}
	})
}

func TestSeatsAreHeldByTokens(t *testing.T) {
	h := newHub(t, HubConfig{Bot: "standard"})
	rm, _, token, err := h.Create(Options{Opponent: OpponentFriend, Side: 0})
	if err != nil {
		t.Fatal(err)
	}
	_, ftoken, err := rm.Sit(1)
	if err != nil {
		t.Fatal(err)
	}
	refused := []struct {
		name  string
		id    Identity
		auth  Auth
		wants error
	}{
		{"a Hammer with no token", Identity{Side: 0, Role: RoleHammer}, Auth{}, ErrNoSeat},
		{"a Hammer with a made-up token", Identity{Side: 0, Role: RoleHammer}, Auth{Token: "0123456789abcdef0123456789abcdef"}, ErrNoSeat},
		{"the other side's token", Identity{Side: 0, Role: RoleHammer}, Auth{Token: ftoken}, ErrNoSeat},
		{"a spectator, who would see both sides", Identity{Side: 0, Role: RoleSpectator}, Auth{}, ErrNoWatching},
		{"a seated player turning spectator", Identity{Side: 0, Role: RoleSpectator}, Auth{Token: token}, ErrNoWatching},
	}
	for _, tc := range refused {
		if _, err := rm.Enter(tc.id, tc.auth, true); err != tc.wants {
			t.Errorf("%s: err = %v, want %v", tc.name, err, tc.wants)
		}
	}
	// The right token works, also a second time: that is a reload.
	a := enter(t, rm, 0, RoleHammer, token)
	rm.Leave(a)
	if l := rm.Lobby(); !l.Seats[0].Taken || l.Seats[0].Online {
		t.Fatalf("after leaving, the seat should be held but offline: %+v", l.Seats[0])
	}
	b := enter(t, rm, 0, RoleHammer, token)
	if _, err := rm.Say(b, "Viper 1 hold Bravo"); err != nil {
		t.Fatalf("the rejoined commander could not transmit: %v", err)
	}
}

func TestAgentsNeedTheKeyOrTheirSidesToken(t *testing.T) {
	h := newHub(t, HubConfig{AgentKey: "s3cret"})
	if h.Room("") != nil {
		t.Fatal("with an agent key there must be no open room")
	}
	rm, _, token, err := h.Create(Options{Opponent: OpponentFriend, Side: 0})
	if err != nil {
		t.Fatal(err)
	}
	_, ftoken, _ := rm.Sit(1)
	anvil := Identity{Side: 0, Role: RoleAnvil}
	for name, auth := range map[string]Auth{"no proof": {}, "a wrong key": {Key: "guess"}, "the enemy's token": {Token: ftoken}} {
		if _, err := rm.Enter(anvil, auth, false); err != ErrNotAgent {
			t.Errorf("an agent with %s: err = %v, want %v", name, err, ErrNotAgent)
		}
	}
	// An agent comes in through a host, and the host's claim on the side is decided by
	// what it shows: the key makes it the server's, the seat token the commander's own.
	if _, err := rm.Enter(anvil, Auth{Key: "s3cret"}, false); err != ErrNoHost {
		t.Errorf("an agent naming no host: err = %v, want %v", err, ErrNoHost)
	}
	for name, auth := range map[string]Auth{"no proof": {}, "a wrong key": {Key: "guess"}, "the enemy's token": {Token: ftoken}} {
		if _, err := rm.Enter(Identity{Side: 0, Role: RoleHost, Host: "x", Rank: RankBrowser}, auth, false); err != ErrNotAgent {
			t.Errorf("a host with %s: err = %v, want %v", name, err, ErrNotAgent)
		}
	}
	// The server's host claims the top rank and is put back in its place.
	node, err := rm.Enter(Identity{Side: 0, Role: RoleHost, Host: "node", Rank: 99}, Auth{Key: "s3cret"}, false)
	if err != nil || node.ID.Rank != RankServer {
		t.Fatalf("the server's host: %+v %v", node, err)
	}
	served := Identity{Side: 0, Role: RoleAnvil, Host: "node"}
	first, err := rm.Enter(served, Auth{Key: "s3cret"}, false)
	if err != nil {
		t.Fatalf("the server host's agent was refused: %v", err)
	}
	// The commander's browser shows the seat token, claims nothing, and takes the side.
	page, err := rm.Enter(Identity{Side: 0, Role: RoleHost, Host: "page"}, Auth{Token: token}, false)
	if err != nil || page.ID.Rank != RankBrowser {
		t.Fatalf("the commander's host: %+v %v", page, err)
	}
	if !first.closed {
		t.Error("the server's agent kept running after the commander's browser took the side")
	}
	if _, err := rm.Enter(served, Auth{Key: "s3cret"}, false); err != ErrNotActiveHost {
		t.Errorf("the standby host's agent: err = %v, want %v", err, ErrNotActiveHost)
	}
	if _, err := rm.Enter(Identity{Side: 0, Role: RoleAnvil, Host: "page"}, Auth{Token: token}, false); err != nil {
		t.Errorf("the commander's own agent was refused: %v", err)
	}
	// When the browser goes, the side falls back to the server's host.
	rm.Leave(page)
	if _, err := rm.Enter(served, Auth{Key: "s3cret"}, false); err != nil {
		t.Errorf("the server's agent after the browser left: %v", err)
	}
}

// A side never receives the other side's radio, squads, fog or deployments.
func TestSidesOnlyHearAndSeeTheirOwn(t *testing.T) {
	h := newHub(t, HubConfig{})
	rm, _, token, err := h.Create(Options{Opponent: OpponentFriend, Side: 0})
	if err != nil {
		t.Fatal(err)
	}
	_, ftoken, _ := rm.Sit(1)
	west, east := enter(t, rm, 0, RoleHammer, token), enter(t, rm, 1, RoleHammer, ftoken)
	anvil := join(t, rm, 0, RoleAnvil, 0)
	rm.Ready(west, true)
	rm.Ready(east, true)
	if _, err := rm.Say(west, "Viper 1, this is Hammer. Hold Bravo. Over."); err != nil {
		t.Fatal(err)
	}
	if _, err := rm.Tool(anvil, ToolBuy, json.RawMessage(`{"unit":"commandos","upgrade":""}`)); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 20; i++ {
		rm.Tick()
	}
	sawState := false
	for _, f := range frames(t, east) {
		switch f.Type {
		case "radio":
			t.Fatalf("side 1 heard side 0's net: %q", f.Message.Text)
		case "event":
			if f.Event.Side != 1 {
				t.Fatalf("side 1 got side 0's event %+v", f.Event)
			}
		case "state":
			sawState = true
			for _, sq := range f.State.Squads {
				if sq.Side != 1 {
					t.Fatal("side 1 was sent side 0's squads")
				}
			}
			for _, d := range f.State.Deploying {
				if d.Side != 1 {
					t.Fatal("side 1 was sent side 0's deployments")
				}
			}
			if len(f.State.Contacts) != 0 {
				t.Fatal("side 1 sees side 0 across the map at the start")
			}
		}
	}
	if !sawState {
		t.Fatal("side 1 got no state frames")
	}
	heard, deploying := false, false
	for _, f := range frames(t, west) {
		heard = heard || f.Type == "radio"
		deploying = deploying || (f.Type == "state" && len(f.State.Deploying) > 0)
	}
	if !heard || !deploying {
		t.Fatalf("side 0 should hear its own net (%v) and see its own deployment (%v)", heard, deploying)
	}
}

func TestLeavingKeepsTheSquadsFightingAndTellsTheOther(t *testing.T) {
	h := newHub(t, HubConfig{})
	rm, _, token, _ := h.Create(Options{Opponent: OpponentFriend, Side: 0})
	_, ftoken, _ := rm.Sit(1)
	west, east := enter(t, rm, 0, RoleHammer, token), enter(t, rm, 1, RoleHammer, ftoken)
	rm.Ready(west, true)
	rm.Ready(east, true)
	if _, err := rm.Say(west, "Viper 1 hold Bravo"); err != nil {
		t.Fatal(err)
	}
	leader := join(t, rm, 0, RoleSquad, 1)
	if _, err := rm.Tool(leader, ToolHold, json.RawMessage(`{"point":"B"}`)); err != nil {
		t.Fatal(err)
	}
	frames(t, east)
	rm.Leave(west)
	told := false
	for _, f := range frames(t, east) {
		told = told || (f.Type == "lobby" && f.Lobby.Seats[0].Taken && !f.Lobby.Seats[0].Online && f.Lobby.Phase == "playing")
	}
	if !told {
		t.Fatal("the other commander was not told that side 0 left")
	}
	var before, after float64
	rm.View(func(s *sim.Sim) { before, _ = s.Squad(1).Center() })
	for i := 0; i < 50; i++ {
		rm.Tick()
	}
	rm.View(func(s *sim.Sim) {
		after, _ = s.Squad(1).Center()
		if s.Squad(1).Order.Kind != sim.OrderHold {
			t.Fatalf("the squad dropped its order when its commander left: %+v", s.Squad(1).Order)
		}
	})
	if after <= before {
		t.Fatalf("the squad stopped moving east toward Bravo: x %v then %v", before, after)
	}
	// The side that left can come back with the same token.
	back := enter(t, rm, 0, RoleHammer, token)
	if _, err := rm.Say(back, "Viper 1 hold Delta"); err != nil {
		t.Fatal(err)
	}
}

func TestRematchKeepsBothPlayersAndWaitsForThem(t *testing.T) {
	h := newHub(t, HubConfig{})
	rm, _, token, _ := h.Create(Options{Opponent: OpponentFriend, Side: 0, LengthSeconds: 120})
	_, ftoken, _ := rm.Sit(1)
	west, east := enter(t, rm, 0, RoleHammer, token), enter(t, rm, 1, RoleHammer, ftoken)
	rm.Ready(west, true)
	rm.Ready(east, true)
	rm.Tick()
	if err := rm.Restart(east); err == nil {
		t.Fatal("one commander threw away a match the other was still fighting")
	}
	for i := 0; i < 121*rules.TickRate; i++ {
		rm.Tick()
	}
	if l := rm.Lobby(); l.Phase != "over" {
		t.Fatalf("phase after the clock ran out: %s", l.Phase)
	}
	if err := rm.Restart(east); err != nil {
		t.Fatal(err)
	}
	l := rm.Lobby()
	if l.Phase != "lobby" || l.Match != 1 || !l.Seats[0].Taken || !l.Seats[1].Taken || l.Seats[0].Ready || l.Seats[1].Ready {
		t.Fatalf("lobby after the rematch was asked for: %+v", l)
	}
	rm.Ready(east, true)
	rm.Tick()
	rm.View(func(s *sim.Sim) {
		if s.Tick != 0 {
			t.Fatal("the rematch started before both were ready")
		}
	})
	rm.Ready(west, true)
	rm.Tick()
	rm.View(func(s *sim.Sim) {
		if s.Tick != 1 || s.Over {
			t.Fatalf("the rematch did not start: tick %d over %v", s.Tick, s.Over)
		}
	})
}

func TestAgainstTheBotOnePressStartsAndTheBotTakesTheOtherSide(t *testing.T) {
	h := newHub(t, HubConfig{Bot: "standard"})
	rm, side, token, err := h.Create(Options{Opponent: OpponentBot, Side: 1})
	if err != nil || side != 1 {
		t.Fatalf("create: side %d err %v", side, err)
	}
	if l := rm.Lobby(); !l.Seats[0].Bot || l.Seats[1].Bot {
		t.Fatalf("the bot should play side 0: %+v", l.Seats)
	}
	if _, _, err := rm.Sit(0); err != ErrSeatTaken {
		t.Fatalf("a person sat in the bot's seat: %v", err)
	}
	me := enter(t, rm, 1, RoleHammer, token)
	rm.Ready(me, true)
	rm.Tick()
	if l := rm.Lobby(); l.Phase != "playing" {
		t.Fatalf("phase = %s", l.Phase)
	}
	// Alone, restarting needs nobody's agreement and starts at once.
	if err := rm.Restart(me); err != nil {
		t.Fatal(err)
	}
	if l := rm.Lobby(); l.Phase != "playing" || l.Match != 1 {
		t.Fatalf("after a solo restart: %+v", l)
	}
}

func TestRoomsAreSeparateMatches(t *testing.T) {
	h := newHub(t, HubConfig{Bot: "standard"})
	a, _, ta, _ := h.Create(Options{Opponent: OpponentBot, Side: 0})
	b, _, tb, _ := h.Create(Options{Opponent: OpponentBot, Side: 0})
	if a.Lobby().Room == b.Lobby().Room {
		t.Fatal("two rooms share a code")
	}
	if _, err := b.Enter(Identity{Side: 0, Role: RoleHammer}, Auth{Token: ta}, true); err != ErrNoSeat {
		t.Fatalf("room A's token opened room B: %v", err)
	}
	ca, cb := enter(t, a, 0, RoleHammer, ta), enter(t, b, 0, RoleHammer, tb)
	a.Ready(ca, true)
	if _, err := a.Say(ca, "Viper 1 hold Bravo"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 30; i++ {
		a.Tick()
	}
	for _, f := range frames(t, cb) {
		if f.Type == "radio" || f.Type == "state" || f.Type == "event" {
			t.Fatalf("room B received a %s frame from room A", f.Type)
		}
	}
	b.View(func(s *sim.Sim) {
		if s.Tick != 0 {
			t.Fatalf("room B's clock moved with room A's: tick %d", s.Tick)
		}
	})
	if len(a.Log(0)) != 1 || len(b.Log(0)) != 0 {
		t.Fatalf("radio logs: A %d, B %d", len(a.Log(0)), len(b.Log(0)))
	}
}

// The same seed and the same orders play the same match in any room.
func TestARoomIsDeterministic(t *testing.T) {
	play := func() uint64 {
		h := newHub(t, HubConfig{Bot: "rush", Seed: 7})
		rm, _, token, _ := h.Create(Options{Opponent: OpponentBot, Side: 0, LengthSeconds: 120})
		me := enter(t, rm, 0, RoleHammer, token)
		rm.Ready(me, true)
		leader := join(t, rm, 0, RoleSquad, 1)
		for i := 0; i < 600; i++ {
			if i == 15 {
				if _, err := rm.Tool(leader, ToolHold, json.RawMessage(`{"point":"B"}`)); err != nil {
					t.Fatal(err)
				}
			}
			rm.Tick()
		}
		var sum uint64
		rm.View(func(s *sim.Sim) { sum = s.Hash() })
		return sum
	}
	if a, b := play(), play(); a != b {
		t.Fatalf("two rooms with seed 7 and the same orders ended differently: %x and %x", a, b)
	}
}

func TestEmptyRoomsAreDropped(t *testing.T) {
	h := newHub(t, HubConfig{IdleAfter: 40 * time.Millisecond})
	kept, _, token, _ := h.Create(Options{Opponent: OpponentBot, Side: 0})
	gone, _, _, _ := h.Create(Options{Opponent: OpponentBot, Side: 0})
	c := enter(t, kept, 0, RoleHammer, token)
	agent := join(t, gone, 0, RoleAnvil, 0) // an agent alone does not keep a room alive
	time.Sleep(60 * time.Millisecond)
	h.Sweep()
	if h.Room(kept.Lobby().Room) == nil {
		t.Fatal("a room with a commander in it was dropped")
	}
	if h.Room(gone.cfg.Code) != nil {
		t.Fatal("a room nobody was in was kept")
	}
	if _, open := <-agent.Out; open {
		// The greeting is still queued; the channel must be closed behind it.
		for range agent.Out {
		}
	}
	if _, err := gone.Join(Identity{Side: 0, Role: RoleAnvil}, false); err != ErrNoRoom {
		t.Fatalf("a dropped room let someone in: %v", err)
	}
	// Once its commander leaves, the kept room goes too.
	kept.Leave(c)
	time.Sleep(60 * time.Millisecond)
	h.Sweep()
	if h.Room(kept.cfg.Code) != nil {
		t.Fatal("the room outlived its last person")
	}
}

func TestAgentWorkFollowsTheSeats(t *testing.T) {
	h := newHub(t, HubConfig{Bot: "standard"})
	solo, _, ts, _ := h.Create(Options{Opponent: OpponentBot, Side: 1})
	duo, _, _, _ := h.Create(Options{Opponent: OpponentFriend, Side: 0})
	enter(t, solo, 1, RoleHammer, ts)
	work := map[string][]int{}
	for _, w := range h.AgentWork() {
		work[w.Room] = w.Sides
	}
	// The bot's side needs no agents; the friend's empty seat needs none yet.
	if got := work[solo.cfg.Code]; len(got) != 1 || got[0] != 1 {
		t.Fatalf("solo room agents: %v", got)
	}
	if got := work[duo.cfg.Code]; len(got) != 1 || got[0] != 0 {
		t.Fatalf("friend room agents before the friend sat: %v", got)
	}
	duo.Sit(1)
	for _, w := range h.AgentWork() {
		work[w.Room] = w.Sides
	}
	if got := work[duo.cfg.Code]; len(got) != 2 {
		t.Fatalf("friend room agents with both seated: %v", got)
	}
	// Long after a commander left, their agents are stood down.
	if sides := duo.agentSides(0); len(sides) != 0 {
		t.Fatalf("agents kept for commanders who are gone: %v", sides)
	}
}

func TestLobbyOverHTTPAndWebSocket(t *testing.T) {
	h := newHub(t, HubConfig{Bot: "standard", AgentKey: "s3cret", Share: "http://192.168.1.20:8080/"})
	mux := http.NewServeMux()
	h.Routes(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	call := func(method, path, body, bearer string) (int, map[string]any) {
		t.Helper()
		req, _ := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		out := map[string]any{}
		json.NewDecoder(res.Body).Decode(&out)
		return res.StatusCode, out
	}

	status, made := call("POST", "/api/rooms", `{"opponent":"friend","side":0,"length":300}`, "")
	if status != http.StatusCreated {
		t.Fatalf("create: %d %v", status, made)
	}
	code, token := made["room"].(string), made["token"].(string)
	if made["share"] != "http://192.168.1.20:8080/?room="+code {
		t.Fatalf("share link = %v", made["share"])
	}
	if status, _ := call("POST", "/api/rooms", `{"opponent":"nobody"}`, ""); status != http.StatusBadRequest {
		t.Fatalf("a bad opponent was accepted: %d", status)
	}
	if status, _ := call("GET", "/api/rooms/ZZZZZ", "", ""); status != http.StatusNotFound {
		t.Fatalf("an unknown code: %d", status)
	}
	status, info := call("GET", "/api/rooms/"+strings.ToLower(code), "", "")
	if status != http.StatusOK || info["lobby"].(map[string]any)["length"].(float64) != 300 {
		t.Fatalf("lobby: %d %v", status, info)
	}
	if strings.Contains(string(encode(info)), token) {
		t.Fatal("the lobby gives away a seat token")
	}
	if status, _ := call("POST", "/api/rooms/"+code+"/seat", `{"side":0}`, ""); status != http.StatusConflict {
		t.Fatalf("a taken seat was handed out again: %d", status)
	}
	status, sat := call("POST", "/api/rooms/"+code+"/seat", `{}`, "")
	if status != http.StatusOK || sat["side"].(float64) != 1 {
		t.Fatalf("friend seat: %d %v", status, sat)
	}

	// The endpoints for the agent host and the relay need the key.
	if status, _ := call("GET", "/internal/rooms", "", ""); status != http.StatusUnauthorized {
		t.Fatalf("/internal/rooms without the key: %d", status)
	}
	if status, _ := call("GET", "/internal/tier?room="+code+"&side=0&squad=1", "", "wrong"); status != http.StatusUnauthorized {
		t.Fatalf("/internal/tier with a wrong key: %d", status)
	}
	status, work := call("GET", "/internal/rooms", "", "s3cret")
	if status != http.StatusOK || len(work["rooms"].([]any)) != 1 {
		t.Fatalf("agent work: %d %v", status, work)
	}
	// The relay shows the agent key and, apart from it, the seat token of the player it
	// is thinking for. The tier is only given for that player's own side.
	tier := func(query, seat string) (int, map[string]any) {
		t.Helper()
		req, _ := http.NewRequest("GET", srv.URL+"/internal/tier?"+query, nil)
		req.Header.Set("Authorization", "Bearer s3cret")
		if seat != "" {
			req.Header.Set("X-Callsign-Seat", seat)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		out := map[string]any{}
		json.NewDecoder(res.Body).Decode(&out)
		return res.StatusCode, out
	}
	friend := sat["token"].(string)
	tiers := []struct {
		query  string
		seat   string
		status int
		tier   float64
	}{
		{"room=" + code + "&side=0&squad=1", token, http.StatusOK, 1},
		{"room=" + code + "&side=0&squad=0", token, http.StatusOK, 0},
		{"room=" + code + "&side=0&squad=1", "", http.StatusForbidden, 0},                // no seat shown
		{"room=" + code + "&side=0&squad=1", friend, http.StatusForbidden, 0},            // the other side's seat
		{"room=" + code + "&side=0&squad=1&token=" + token, "", http.StatusForbidden, 0}, // a token in the address counts for nothing
		{"room=" + code + "&side=1&squad=1", friend, http.StatusNotFound, 0},             // squad 1 is side 0's
		{"room=" + code + "&side=1&squad=3", token, http.StatusForbidden, 0},             // side 0's token
		{"room=NOPE2&side=0&squad=1", token, http.StatusNotFound, 0},
	}
	for _, tc := range tiers {
		status, got := tier(tc.query, tc.seat)
		if status != tc.status || (status == http.StatusOK && got["tier"].(float64) != tc.tier) {
			t.Errorf("/internal/tier?%s: %d %v, want %d tier %v", tc.query, status, got, tc.status, tc.tier)
		}
	}
	if _, got := tier("room="+code+"&side=0&squad=0", token); got["operator"] != true {
		t.Errorf("squad 0 should be the operator: %v", got)
	}

	// Over the socket: the seat's token gets in, anything else is turned away with the reason.
	ws := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?room=" + code + "&side=0&role=hammer"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	refused := func(url, want string) {
		t.Helper()
		conn, _, err := websocket.Dial(ctx, url, nil)
		if err != nil {
			t.Fatal(err)
		}
		_, _, err = conn.Read(ctx)
		if got := websocket.CloseStatus(err); got != websocket.StatusPolicyViolation || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: closed with %v, want %q", url, err, want)
		}
	}
	refused(ws, ErrNoSeat.Error())
	refused(ws+"&token="+sat["token"].(string), ErrNoSeat.Error())
	refused(strings.Replace(ws, code, "ZZZZZ", 1)+"&token="+token, ErrNoRoom.Error())
	refused(strings.Replace(ws, "room="+code+"&", "", 1), ErrNoRoom.Error()) // no open room with a key set
	refused(strings.Replace(ws, "hammer", "spectator", 1), ErrNoWatching.Error())

	conn, _, err := websocket.Dial(ctx, ws+"&token="+token, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")
	conn.SetReadLimit(1 << 22)
	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var hello struct {
		Type  string
		Lobby LobbyView
	}
	if json.Unmarshal(data, &hello) != nil || hello.Type != "hello" || hello.Lobby.Room != code || !hello.Lobby.Seats[1].Taken {
		t.Fatalf("greeting: %s", data[:min(len(data), 200)])
	}
	if err := conn.Write(ctx, websocket.MessageText, []byte(`{"type":"ready"}`)); err != nil {
		t.Fatal(err)
	}
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var f raw
		if json.Unmarshal(data, &f) == nil && f.Type == "lobby" && f.Lobby.Seats[0].Ready {
			break
		}
	}
}

func TestTheOpenRoomStillWorksWithoutAKey(t *testing.T) {
	h := newHub(t, HubConfig{Bot: "standard"})
	rm := h.Room("")
	if rm == nil {
		t.Fatal("no open room")
	}
	// As in Phase 0: anyone commands a side, and the first Hammer starts the match.
	c, err := rm.Enter(Identity{Side: 0, Role: RoleHammer}, Auth{}, true)
	if err != nil {
		t.Fatal(err)
	}
	rm.Tick()
	rm.View(func(s *sim.Sim) {
		if s.Tick != 1 {
			t.Fatal("the open room did not start when Hammer joined")
		}
	})
	if _, err := rm.Say(c, "Viper 1 hold Bravo"); err != nil {
		t.Fatal(err)
	}
	if _, err := rm.Enter(Identity{Side: 0, Role: RoleSpectator}, Auth{}, true); err != nil {
		t.Fatalf("the open room refused a spectator: %v", err)
	}
	// While someone commands in it, the agent host serves it too, under the empty code.
	if w := h.AgentWork(); len(w) != 1 || w[0].Room != "" || len(w[0].Sides) != 1 || w[0].Sides[0] != 0 {
		t.Fatalf("agent work for the open room: %+v", w)
	}
}

func TestASeatCanBeGivenBackOnlyBeforeTheStart(t *testing.T) {
	h := newHub(t, HubConfig{})
	rm, _, token, _ := h.Create(Options{Opponent: OpponentFriend, Side: 0})
	_, ftoken, _ := rm.Sit(1)
	west, east := enter(t, rm, 0, RoleHammer, token), enter(t, rm, 1, RoleHammer, ftoken)
	if err := rm.Stand(east); err != nil {
		t.Fatal(err)
	}
	if l := rm.Lobby(); l.Seats[1].Taken || l.Seats[1].Online {
		t.Fatalf("the seat was not given back: %+v", l.Seats[1])
	}
	if _, err := rm.Enter(Identity{Side: 1, Role: RoleHammer}, Auth{Token: ftoken}, true); err != ErrNoSeat {
		t.Fatalf("the old token still opens the seat: %v", err)
	}
	// Someone else takes it, the match starts, and now nobody can stand up.
	_, other, err := rm.Sit(1)
	if err != nil {
		t.Fatal(err)
	}
	east = enter(t, rm, 1, RoleHammer, other)
	rm.Ready(west, true)
	rm.Ready(east, true)
	if err := rm.Stand(east); err == nil {
		t.Fatal("a seat was given back in the middle of a match")
	}
}

func TestTheServerRunsOnlySoManyMatches(t *testing.T) {
	h := newHub(t, HubConfig{MaxRooms: 2})
	for i := 0; i < 2; i++ {
		if _, _, _, err := h.Create(Options{Opponent: OpponentBot, Side: 0}); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, _, err := h.Create(Options{Opponent: OpponentBot, Side: 0}); err != ErrFull {
		t.Fatalf("a third match: %v, want %v", err, ErrFull)
	}
	for _, bad := range []Options{{Opponent: "nobody"}, {Opponent: OpponentBot, Side: 2}, {Opponent: OpponentBot, LengthSeconds: 30}} {
		if _, _, _, err := h.Create(bad); err == nil || err == ErrFull {
			t.Errorf("%+v was not refused for what it asks: %v", bad, err)
		}
	}
}
