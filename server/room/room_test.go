package room

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"callsign/server/radio"
	"callsign/server/sim"
	"callsign/shared"
)

var rules = shared.MustLoad()

func newRoom(t *testing.T, cfg Config) *Room {
	t.Helper()
	cfg.Factions = [2]string{"aegis", "ashfall"}
	if cfg.Seed == 0 {
		cfg.Seed = 1
	}
	rm, err := New(rules, cfg)
	if err != nil {
		t.Fatal(err)
	}
	return rm
}

func join(t *testing.T, rm *Room, side int, role string, squad int) *Client {
	t.Helper()
	c, err := rm.Join(Identity{Side: side, Role: role, Squad: squad}, role != RoleSquad)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

type frame struct {
	Type     string    `json:"type"`
	Match    int       `json:"match"`
	Message  Message   `json:"message"`
	Event    sim.Event `json:"event"`
	Callsign *Name     `json:"callsign"`
	Log      []Message `json:"log"`
	ID       int       `json:"id"`
	OK       bool      `json:"ok"`
	Error    string    `json:"error"`
	Reason   string    `json:"reason"`
}

// drain returns everything queued for a client so far.
func drain(t *testing.T, c *Client) []frame {
	t.Helper()
	var out []frame
	for {
		select {
		case b, ok := <-c.Out:
			if !ok {
				return out
			}
			var f frame
			if err := json.Unmarshal(b, &f); err != nil {
				t.Fatalf("bad frame %s: %v", b, err)
			}
			out = append(out, f)
		default:
			return out
		}
	}
}

func radioFrames(fs []frame) []Message {
	var out []Message
	for _, f := range fs {
		if f.Type == "radio" {
			out = append(out, f.Message)
		}
	}
	return out
}

func tool(t *testing.T, rm *Room, c *Client, name, args string) {
	t.Helper()
	if _, err := rm.Tool(c, name, json.RawMessage(args)); err != nil {
		t.Fatalf("%s %s: %v", name, args, err)
	}
}

// The Phase 0 line: Hammer orders Viper 2 to hold Foxtrot, in either language. The squad
// leader hears it, acts through the game tools, answers in procedure, and the squad goes.
func TestViperTwoHoldsFoxtrot(t *testing.T) {
	cases := []struct{ order, body, reply string }{
		{"Viper 2, this is Hammer. Hold Foxtrot. Over.", "Wilco", "Hammer, this is Viper 2. Wilco. Out."},
		{"צפע 2, כאן פטיש, תחזיקו את פסל, עבור.", "רות, יבוצע", "פטיש, כאן צפע 2, רות, יבוצע, סוף."},
	}
	for _, tc := range cases {
		rm := newRoom(t, Config{})
		hammer := join(t, rm, 0, RoleHammer, 0)
		viper1 := join(t, rm, 0, RoleSquad, 1)
		viper2 := join(t, rm, 0, RoleSquad, 2)
		drain(t, hammer)
		drain(t, viper1)
		drain(t, viper2)

		if _, err := rm.Say(hammer, tc.order); err != nil {
			t.Fatalf("%q: %v", tc.order, err)
		}
		// Everyone on the side hears it; the address says who acts.
		for _, c := range []*Client{viper1, viper2} {
			heard := radioFrames(drain(t, c))
			if len(heard) != 1 {
				t.Fatalf("%q: a squad leader heard %d messages, want 1", tc.order, len(heard))
			}
			m := heard[0]
			if len(m.To) != 1 || m.To[0].Squad != 2 || m.To[0].Key != "infantry-2" || m.From.Key != radio.Player ||
				m.End != radio.Over || len(m.Points) != 1 || m.Points[0] != "F" {
				t.Fatalf("%q routed wrong: %+v", tc.order, m)
			}
		}

		// Viper 2's leader does what an agent does: one tool to act, one to answer.
		tool(t, rm, viper2, ToolHold, `{"point":"F"}`)
		body, _ := json.Marshal(tc.body)
		tool(t, rm, viper2, ToolRadio, `{"to":"Hammer","end":"out","body":`+string(body)+`}`)
		heard := radioFrames(drain(t, hammer))
		if len(heard) != 2 || heard[1].Text != tc.reply {
			t.Fatalf("Hammer heard %+v, want the reply %q", heard, tc.reply)
		}
		if heard[1].End != radio.Out || len(heard[1].Prowords) != 1 || heard[1].Prowords[0] != "wilco" {
			t.Fatalf("reply not read as Wilco, Out: %+v", heard[1])
		}

		arrived := false
		for i := 0; i < 90*rules.TickRate && !arrived; i++ {
			rm.Tick()
			for _, f := range drain(t, hammer) {
				arrived = arrived || (f.Type == "event" && f.Event.Kind == sim.EvArrived && f.Event.Squad == 2 && f.Event.Point == "F")
			}
		}
		if !arrived {
			t.Fatalf("%q: Viper 2 never reported arriving at Foxtrot", tc.order)
		}
		rm.View(func(s *sim.Sim) {
			f := rules.PointByID("F")
			v2, v1 := s.Squad(2), s.Squad(1)
			x, y := v2.Center()
			if d := math.Hypot(x-f.X, y-f.Y); d > rules.Match.HoldRadius || v2.Order.Kind != sim.OrderHold || v2.Order.Point != "F" {
				t.Fatalf("Viper 2 is %.0f from Foxtrot with order %+v", d, v2.Order)
			}
			if v1.Order.Kind != sim.OrderNone {
				t.Fatalf("Viper 1 was not addressed but has order %+v", v1.Order)
			}
		})
	}
}

func TestSayRoutesByCallsignOnly(t *testing.T) {
	rm := newRoom(t, Config{})
	hammer := join(t, rm, 0, RoleHammer, 0)
	enemy := join(t, rm, 1, RoleHammer, 0)
	watcher := join(t, rm, 0, RoleSpectator, 0)

	m, err := rm.Say(hammer, "What's happening at Kilo?")
	if err != nil || len(m.To) != 1 || m.To[0].Key != radio.Operator || len(m.Points) != 1 || m.Points[0] != "K" {
		t.Fatalf("no callsign should go to the operator: %+v %v", m, err)
	}
	m, err = rm.Say(hammer, "All stations, this is Hammer. Radio check. Over.")
	if err != nil || m.To[0].Key != radio.All {
		t.Fatalf("all stations: %+v %v", m, err)
	}
	refused := []struct {
		text string
		want string
	}{
		{"Viper 7, this is Hammer. Hold Foxtrot. Over.", "no station Viper 7"},
		{"צפע 7, כאן פטיש, תחזיקו את פסל, עבור.", "no station צפע 7"},
		{"Rhino 1, this is Hammer. Hold Foxtrot. Over.", "no station Rhino 1"},
		{"Viper 2, this is Anvil. Hold Foxtrot. Over.", "you are Hammer"},
		{"Hammer, this is Hammer. Radio check. Over.", "cannot call yourself"},
		{"Viper 2, this is Hammer. Hold Foxtrot. Over and out.", "never both"},
	}
	for _, tc := range refused {
		if _, err := rm.Say(hammer, tc.text); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%q: err = %v, want %q", tc.text, err, tc.want)
		}
	}
	if n := len(rm.Log(0)); n != 2 {
		t.Fatalf("log holds %d messages, want only the 2 that were sent", n)
	}
	if got := radioFrames(drain(t, enemy)); len(got) != 0 {
		t.Fatalf("the enemy heard our net: %+v", got)
	}
	if got := radioFrames(drain(t, watcher)); len(got) != 2 {
		t.Fatalf("spectator heard %d messages, want 2", len(got))
	}
}

func TestRolesLimitTools(t *testing.T) {
	rm := newRoom(t, Config{})
	hammer := join(t, rm, 0, RoleHammer, 0)
	anvil := join(t, rm, 0, RoleAnvil, 0)
	viper1 := join(t, rm, 0, RoleSquad, 1)
	watcher := join(t, rm, 0, RoleSpectator, 0)

	if _, err := rm.Join(Identity{Side: 0, Role: RoleSquad, Squad: 3}, false); !errors.Is(err, sim.ErrNoSquad) {
		t.Fatalf("leading an enemy squad: err = %v", err)
	}
	if _, err := rm.Join(Identity{Side: 0, Role: "admin"}, false); err == nil {
		t.Fatal("unknown role was let in")
	}
	denied := []struct {
		c    *Client
		tool string
		args string
	}{
		{hammer, ToolMove, `{"point":"F"}`},
		{hammer, ToolBuy, `{"unit":"tank"}`},
		{watcher, ToolReport, `{}`},
		{anvil, ToolMove, `{"point":"F"}`},
		{anvil, ToolAttack, `{"point":"Z"}`},
		{viper1, ToolBuy, `{"unit":"tank"}`},
		{viper1, "selfdestruct", `{}`},
	}
	for _, d := range denied {
		if _, err := rm.Tool(d.c, d.tool, json.RawMessage(d.args)); err == nil || !strings.Contains(err.Error(), "may not use") {
			t.Errorf("%s calling %s: err = %v, want a refusal", d.c.ID.Role, d.tool, err)
		}
	}
	if _, err := rm.Say(anvil, "Viper 1, this is Anvil. Hold Golf. Over."); err == nil {
		t.Error("an agent sent raw text instead of using the radio tool")
	}

	// A squad leader's tools reach its own squad and nothing else.
	tool(t, rm, viper1, ToolMove, `{"point":"the bridge"}`)
	rm.View(func(s *sim.Sim) {
		if s.Squad(1).Order.Point != "G" || s.Squad(2).Order.Kind != sim.OrderNone {
			t.Fatalf("orders after Viper 1 moved: %+v / %+v", s.Squad(1).Order, s.Squad(2).Order)
		}
	})
	for args, want := range map[string]error{
		`{"point":"Sierra"}`: sim.ErrUnreachable,
		`{"point":"Romeo"}`:  sim.ErrNoPoint,
		`{"contact":3}`:      sim.ErrNoPoint, // move needs a point; only attack takes a contact
	} {
		if _, err := rm.Tool(viper1, ToolMove, json.RawMessage(args)); !errors.Is(err, want) {
			t.Errorf("move %s: err = %v, want %v", args, err, want)
		}
	}
	if _, err := rm.Tool(viper1, ToolAttack, json.RawMessage(`{"contact":3}`)); !errors.Is(err, sim.ErrNoContact) {
		t.Errorf("attack on an unseen contact: err = %v", err)
	}

	// Only the operator spends gold, and the simulation still checks the price.
	tool(t, rm, anvil, ToolBuy, `{"unit":"tank"}`)
	if _, err := rm.Tool(anvil, ToolBuy, json.RawMessage(`{"upgrade":"Viper 1"}`)); !errors.Is(err, sim.ErrNoGold) {
		t.Errorf("upgrade with 50 gold: err = %v", err)
	}
	if _, err := rm.Tool(anvil, ToolBuy, json.RawMessage(`{"upgrade":"Viper 9"}`)); !errors.Is(err, sim.ErrNoSquad) {
		t.Errorf("upgrade of a missing squad: err = %v", err)
	}
	// The tank is on its way first, and joins the side when its deploy time is up.
	rm.Tick()
	deploying, spawned := false, false
	for _, f := range drain(t, anvil) {
		deploying = deploying || (f.Type == "event" && f.Event.Kind == sim.EvDeploying && f.Event.Squad == 5 && f.Callsign != nil && f.Callsign.En == "Rhino 1")
		spawned = spawned || (f.Type == "event" && f.Event.Kind == sim.EvSquadSpawned && f.Event.Squad == 5)
	}
	if !deploying || spawned {
		t.Errorf("after the purchase: deploying event %v, spawned %v; want the tank on its way and not yet there", deploying, spawned)
	}
	if _, err := rm.Tool(anvil, ToolBuy, json.RawMessage(`{"upgrade":"Rhino 1"}`)); !errors.Is(err, sim.ErrNoSquad) {
		t.Errorf("upgrade of a squad still deploying: err = %v", err)
	}
	for i := 0; i < 10*rules.TickRate && !spawned; i++ {
		rm.Tick()
		for _, f := range drain(t, anvil) {
			spawned = spawned || (f.Type == "event" && f.Event.Kind == sim.EvSquadSpawned && f.Event.Squad == 5)
		}
	}
	if !spawned {
		t.Error("the operator was not told when the new squad reached the field")
	}

	// Reports: a leader gets its own squad, the operator the whole side, nobody the enemy.
	res, err := rm.Tool(viper1, ToolReport, nil)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(res)
	if !strings.Contains(string(b), `"Viper 1"`) || strings.Contains(string(b), "militia") {
		t.Errorf("leader report: %s", b)
	}
}

func TestAgentRadioAnswersInTheCallersLanguage(t *testing.T) {
	rm := newRoom(t, Config{})
	hammer := join(t, rm, 0, RoleHammer, 0)
	anvil := join(t, rm, 0, RoleAnvil, 0)
	viper1 := join(t, rm, 0, RoleSquad, 1)
	say := func(text string) {
		t.Helper()
		if _, err := rm.Say(hammer, text); err != nil {
			t.Fatal(err)
		}
	}
	last := func() string { l := rm.Log(0); return l[len(l)-1].Text }

	say("סדן, כאן פטיש, מה המצב? עבור.")
	tool(t, rm, anvil, ToolRadio, `{"to":["Viper 1","Viper 2"],"body":"דווחו מצב","end":"over"}`)
	if got, want := last(), "צפע 1 וצפע 2, כאן סדן, דווחו מצב, עבור."; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
	// Viper 1 was just called in Hebrew, so it answers in Hebrew without being told to.
	tool(t, rm, viper1, ToolRadio, `{"to":"Anvil","body":"בעמדה","end":"over"}`)
	if got, want := last(), "סדן, כאן צפע 1, בעמדה, עבור."; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
	say("Viper 1, this is Hammer. Radio check. Over.")
	tool(t, rm, viper1, ToolRadio, `{"to":"Hammer","body":"Five by five. Out.","end":"out"}`)
	if got, want := last(), "Hammer, this is Viper 1. Five by five. Out."; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
	for args, want := range map[string]string{
		`{"to":"Wolf 1","body":"Wilco","end":"out"}`:               "unknown callsign",
		`{"to":"Viper 8","body":"Wilco","end":"out"}`:              "no station",
		`{"to":"Hammer","body":"Wilco","end":"over and out"}`:      "must end with over or out",
		`{"to":"Hammer","body":"Wilco, over and out","end":"out"}`: "never both",
		`{"body":"Wilco","end":"out"}`:                             "needs a `to`",
	} {
		if _, err := rm.Tool(viper1, ToolRadio, json.RawMessage(args)); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("radio %s: err = %v, want %q", args, err, want)
		}
	}
}

func TestScriptedEnemyPlaysToTheEnd(t *testing.T) {
	rm := newRoom(t, Config{Bots: [2]string{"", "rush"}, AutoStart: true, LengthSeconds: 240})
	watcher := join(t, rm, 0, RoleSpectator, 0)
	leader := join(t, rm, 0, RoleSquad, 1)
	ended, states := false, 0
	for i := 0; i < 241*rules.TickRate; i++ {
		rm.Tick()
		for _, f := range drain(t, watcher) {
			ended = ended || (f.Type == "event" && f.Event.Kind == sim.EvMatchEnd)
			if f.Type == "state" {
				states++
			}
		}
	}
	rm.View(func(s *sim.Sim) {
		if !s.Over || s.Winner != 1 {
			t.Fatalf("an unopposed rush should win: over=%v winner=%d reason=%s", s.Over, s.Winner, s.Reason)
		}
	})
	if !ended || states == 0 {
		t.Fatalf("spectator saw end=%v and %d state frames", ended, states)
	}
	if _, err := rm.Tool(leader, ToolHold, nil); err == nil {
		t.Fatal("an order was accepted after the match ended")
	}
	// The operator signs off once on each side, in that side's words for the result.
	lost, won := rm.Log(0), rm.Log(1)
	if m := lost[len(lost)-1]; !m.Final || m.From.Key != radio.Operator || m.Text != "Hammer, this is Anvil. We have been defeated. Out." {
		t.Fatalf("the losing side's last message: %+v", m)
	}
	if m := won[len(won)-1]; !m.Final || !strings.Contains(m.Text, "Victory") {
		t.Fatalf("the winning side's last message: %+v", m)
	}
	finals := 0
	for _, m := range lost {
		if m.Final {
			finals++
		}
	}
	if finals != 1 {
		t.Fatalf("the sign-off was sent %d times", finals)
	}
}

func TestSignOffFollowsTheCommandersLanguage(t *testing.T) {
	rm := newRoom(t, Config{Bots: [2]string{"", "rush"}, AutoStart: true, LengthSeconds: 240})
	hammer := join(t, rm, 0, RoleHammer, 0)
	if _, err := rm.Say(hammer, "צפע 1 תפוס את דוד"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 241*rules.TickRate; i++ {
		rm.Tick()
	}
	log := rm.Log(0)
	if m := log[len(log)-1]; m.Text != "פטיש, כאן סדן, הובסנו, סוף." || m.Lang != "he" {
		t.Fatalf("sign-off = %q (%s)", m.Text, m.Lang)
	}
}

func TestRestart(t *testing.T) {
	rm := newRoom(t, Config{})
	hammer := join(t, rm, 0, RoleHammer, 0)
	anvil := join(t, rm, 0, RoleAnvil, 0)
	viper1 := join(t, rm, 0, RoleSquad, 1)
	if _, err := rm.Say(hammer, "Viper 1, this is Hammer. Hold Golf. Over."); err != nil {
		t.Fatal(err)
	}
	if err := rm.Restart(anvil); err == nil {
		t.Fatal("an agent restarted the match")
	}
	tool(t, rm, anvil, ToolBuy, `{"unit":"tank"}`)
	if n := len(rm.sim.Snapshot(0).Deploying); n != 1 {
		t.Fatalf("%d deployments after buying a tank, want 1", n)
	}
	drain(t, hammer)
	if err := rm.Restart(hammer); err != nil {
		t.Fatal(err)
	}
	if snap := rm.sim.Snapshot(0); len(snap.Deploying) != 0 || snap.Gold != rules.Match.StartGold {
		t.Fatalf("after restart: %d deployments and %d gold, want a clean start", len(snap.Deploying), snap.Gold)
	}
	fs := drain(t, hammer)
	if len(fs) != 1 || fs[0].Type != "hello" || fs[0].Match != 1 || len(fs[0].Log) != 0 {
		t.Fatalf("after restart Hammer got %+v", fs)
	}
	drain(t, viper1)
	if _, open := <-viper1.Out; open {
		t.Fatal("the old squad leader was left connected to a squad that no longer exists")
	}
}

// The same exchange over real WebSockets, with the room ticking on its own.
func TestOverWebSocket(t *testing.T) {
	rm := newRoom(t, Config{})
	srv := httptest.NewServer(http.HandlerFunc(rm.ServeWS))
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	go rm.Run(ctx, time.Millisecond)

	dial := func(query string) *websocket.Conn {
		conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"?"+query, nil)
		if err != nil {
			t.Fatal(err)
		}
		conn.SetReadLimit(1 << 20)
		return conn
	}
	write := func(conn *websocket.Conn, v string) {
		if err := conn.Write(ctx, websocket.MessageText, []byte(v)); err != nil {
			t.Fatal(err)
		}
	}
	until := func(conn *websocket.Conn, what string, match func(frame) bool) frame {
		for {
			_, data, err := conn.Read(ctx)
			if err != nil {
				t.Fatalf("waiting for %s: %v", what, err)
			}
			var f frame
			if err := json.Unmarshal(data, &f); err != nil {
				t.Fatal(err)
			}
			if match(f) {
				return f
			}
		}
	}

	leader := dial("side=0&role=squad&squad=2&state=0")
	defer leader.CloseNow()
	until(leader, "hello", func(f frame) bool { return f.Type == "hello" })
	hammer := dial("side=0&role=hammer")
	defer hammer.CloseNow()
	until(hammer, "hello", func(f frame) bool { return f.Type == "hello" })

	write(hammer, `{"type":"radio","text":"Viper 2, this is Hammer. Hold Foxtrot. Over and out."}`)
	if f := until(hammer, "refusal", func(f frame) bool { return f.Type == "refused" }); !strings.Contains(f.Reason, "never both") {
		t.Fatalf("refusal reason = %q", f.Reason)
	}
	write(hammer, `{"type":"radio","text":"Viper 2, this is Hammer. Hold Foxtrot. Over."}`)
	order := until(leader, "the order", func(f frame) bool { return f.Type == "radio" })
	write(leader, `{"type":"tool","id":1,"name":"hold","args":{"point":"`+order.Message.Points[0]+`"}}`)
	write(leader, `{"type":"tool","id":2,"name":"radio","args":{"to":"Hammer","body":"Wilco","end":"out"}}`)
	write(leader, `{"type":"tool","id":3,"name":"buy","args":{"unit":"tank"}}`)
	for id := 1; id <= 3; id++ {
		f := until(leader, "a tool result", func(f frame) bool { return f.Type == "result" })
		if f.ID != id || f.OK != (id < 3) {
			t.Fatalf("tool result %d: %+v", id, f)
		}
	}
	reply := until(hammer, "the reply", func(f frame) bool { return f.Type == "radio" && f.Message.From.Squad == 2 })
	if reply.Message.Text != "Hammer, this is Viper 2. Wilco. Out." {
		t.Fatalf("reply = %q", reply.Message.Text)
	}
	until(hammer, "arrival at Foxtrot", func(f frame) bool {
		return f.Type == "event" && f.Event.Kind == sim.EvArrived && f.Event.Squad == 2 && f.Event.Point == "F"
	})
}

func TestSayStrictnessLevels(t *testing.T) {
	rm := newRoom(t, Config{})
	hammer := join(t, rm, 0, RoleHammer, 0)
	cases := []struct {
		text  string
		level int
		to    string // station key the message reaches, or "" when refused
		want  string // part of the refusal
	}{
		{"צפע 1 תפוס את דוד", Relaxed, "infantry-1", ""},
		{"Viper 1 attack", Relaxed, "infantry-1", ""},
		{"What's happening at Kilo?", Relaxed, radio.Operator, ""},
		{"Viper 1 attack Delta", 0, "infantry-1", ""}, // a frame with no level is relaxed
		{"Viper 1 attack Delta", Standard, "", "start with the call"},
		{"Viper 1, attack Delta", Standard, "", "start with the call"},
		{"Viper 1, this is Hammer. Attack Delta", Standard, "infantry-1", ""},
		{"Viper 1, this is Hammer. Attack Delta", Strict, "", "Over or Out"},
		{"What's happening at Kilo?", Strict, "", "start with the call"},
		{"צפע 1, כאן פטיש. תקוף את דוד. עבור.", Strict, "infantry-1", ""},
	}
	for _, tc := range cases {
		m, err := rm.SayAt(hammer, tc.text, tc.level)
		switch {
		case tc.to == "" && (err == nil || !strings.Contains(err.Error(), tc.want)):
			t.Errorf("level %d %q: err = %v, want %q", tc.level, tc.text, err, tc.want)
		case tc.to != "" && (err != nil || len(m.To) != 1 || m.To[0].Key != tc.to):
			t.Errorf("level %d %q: got %+v %v, want it to reach %s", tc.level, tc.text, m.To, err, tc.to)
		}
	}
}
