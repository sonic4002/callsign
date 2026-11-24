package room

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"callsign/server/sim"
)

// agentFrames reads what a client has been sent and keeps the telemetry frames.
func agentFrames(t *testing.T, c *Client) []map[string]any {
	t.Helper()
	return framesOf(t, c, "telemetry")
}

// tell sends one report as an agent would, a little apart from the one before.
func tell(t *testing.T, rm *Room, c *Client, report string) {
	t.Helper()
	if err := rm.Report(c, json.RawMessage(report)); err != nil {
		t.Fatalf("report refused: %v", err)
	}
}

func TestTelemetryReachesOnlyItsOwnSidesCommander(t *testing.T) {
	rm := newRoom(t, Config{})
	hammer := join(t, rm, 0, RoleHammer, 0)
	enemy := join(t, rm, 1, RoleHammer, 0)
	watcher := join(t, rm, 0, RoleSpectator, 0)
	anvil := join(t, rm, 0, RoleAnvil, 0)
	leader := join(t, rm, 0, RoleSquad, 1)
	other := join(t, rm, 0, RoleSquad, 2)
	for _, c := range []*Client{hammer, enemy, watcher, anvil, leader, other} {
		agentFrames(t, c) // drain the greetings
	}

	tell(t, rm, leader, `{"v":1,"state":"thinking","model":"claude-haiku-5-5","context":{"input":1084}}`)
	got := agentFrames(t, hammer)
	if len(got) != 1 {
		t.Fatalf("the commander got %d telemetry frames, want 1", len(got))
	}
	agent := got[0]["agent"].(map[string]any)
	if agent["squad"].(float64) != 1 || agent["online"] != true || agent["station"].(map[string]any)["en"] != "Viper 1" {
		t.Fatalf("the frame names the wrong station: %+v", agent)
	}
	if agent["telemetry"].(map[string]any)["model"] != "claude-haiku-5-5" {
		t.Fatalf("the report was not passed on as sent: %+v", agent["telemetry"])
	}
	for name, c := range map[string]*Client{"the other side": enemy, "a spectator": watcher, "the operator": anvil, "another leader": other, "the agent itself": leader} {
		if n := len(agentFrames(t, c)); n != 0 {
			t.Errorf("%s was sent %d telemetry frames", name, n)
		}
	}

	// The operator is station 0.
	tell(t, rm, anvil, `{"v":1,"state":"idle"}`)
	got = agentFrames(t, hammer)
	if a := got[0]["agent"].(map[string]any); a["squad"].(float64) != 0 || a["station"].(map[string]any)["en"] != "Anvil" {
		t.Fatalf("the operator's frame: %+v", a)
	}

	// A commander who joins later is told what is known, for their own side only.
	late := join(t, rm, 0, RoleHammer, 0)
	var hello struct {
		Agents []AgentView `json:"agents"`
	}
	if err := json.Unmarshal(<-late.Out, &hello); err != nil {
		t.Fatal(err)
	}
	if len(hello.Agents) != 2 || hello.Agents[0].Squad != 0 || hello.Agents[1].Squad != 1 {
		t.Fatalf("a late commander's greeting lists %+v", hello.Agents)
	}
	lateEnemy := join(t, rm, 1, RoleHammer, 0)
	if err := json.Unmarshal(<-lateEnemy.Out, &hello); err != nil {
		t.Fatal(err)
	}
	if len(hello.Agents) != 0 {
		t.Fatalf("the other side's greeting lists our agents: %+v", hello.Agents)
	}
	var raw map[string]json.RawMessage
	spectator := join(t, rm, 0, RoleSpectator, 0)
	if err := json.Unmarshal(<-spectator.Out, &raw); err != nil {
		t.Fatal(err)
	}
	if _, ok := raw["agents"]; ok {
		t.Fatal("a spectator's greeting carries the agents")
	}
}

func TestTelemetryIsRefusedFromAnyoneButAnAgentAndWhenMalformed(t *testing.T) {
	rm := newRoom(t, Config{})
	hammer := join(t, rm, 0, RoleHammer, 0)
	leader := join(t, rm, 0, RoleSquad, 1)
	if err := rm.Report(hammer, json.RawMessage(`{"state":"idle"}`)); !errors.Is(err, ErrNotAnAgent) {
		t.Fatalf("a commander's report: %v", err)
	}
	for _, bad := range []string{``, `[1,2]`, `"idle"`, `{"state":`, `{"pad":"` + strings.Repeat("x", telemetryMax) + `"}`} {
		if err := rm.Report(leader, json.RawMessage(bad)); !errors.Is(err, ErrBadTelemetry) {
			t.Errorf("a malformed report (%.20q…) was not refused: %v", bad, err)
		}
	}
	agentFrames(t, hammer)
	// A short burst gets through whole; a flood does not.
	time.Sleep(telemetryBurst*telemetryGap + 5*time.Millisecond)
	for i := 0; i < 5; i++ {
		if err := rm.Report(leader, json.RawMessage(`{"state":"thinking"}`)); err != nil {
			t.Fatal(err)
		}
	}
	if n := len(agentFrames(t, hammer)); n != 5 {
		t.Fatalf("a burst of 5 reports reached the commander %d times, want 5", n)
	}
	time.Sleep(telemetryBurst*telemetryGap + 5*time.Millisecond)
	for i := 0; i < 200; i++ {
		if err := rm.Report(leader, json.RawMessage(`{"state":"thinking"}`)); err != nil {
			t.Fatal(err)
		}
	}
	if n := len(agentFrames(t, hammer)); n < telemetryBurst || n > telemetryBurst+2 {
		t.Fatalf("a flood of 200 reports reached the commander %d times, want about %d", n, telemetryBurst)
	}
}

func TestTelemetryIsDroppedWithTheSquadTheAgentAndTheMatch(t *testing.T) {
	rm := newRoom(t, Config{})
	hammer := join(t, rm, 0, RoleHammer, 0)
	leader := join(t, rm, 0, RoleSquad, 1)
	second := join(t, rm, 0, RoleSquad, 2)
	tell(t, rm, leader, `{"state":"idle"}`)
	tell(t, rm, second, `{"state":"idle"}`)
	agentFrames(t, hammer)

	// The agent's connection closes: the row stays, marked offline.
	rm.Leave(leader)
	got := agentFrames(t, hammer)
	if len(got) != 1 || got[0]["agent"].(map[string]any)["online"] != false || got[0]["agent"].(map[string]any)["squad"].(float64) != 1 {
		t.Fatalf("after the agent left: %+v", got)
	}
	// Another agent takes the station: online again, and the old connection's end no longer counts.
	again := join(t, rm, 0, RoleSquad, 1)
	tell(t, rm, again, `{"state":"thinking"}`)
	if got := agentFrames(t, hammer); len(got) != 1 || got[0]["agent"].(map[string]any)["online"] != true {
		t.Fatalf("after a new agent took the station: %+v", got)
	}

	// The squad is lost: its report goes, and the commander is told to drop the row.
	rm.mu.Lock()
	rm.forgetAgent(0, 2)
	left := len(rm.tele[0])
	rm.mu.Unlock()
	got = agentFrames(t, hammer)
	if left != 1 || len(got) != 1 || got[0]["agent"].(map[string]any)["gone"] != true {
		t.Fatalf("after the squad was lost: %d kept, frames %+v", left, got)
	}

	// A new match keeps nothing.
	if err := rm.Restart(hammer); err != nil {
		t.Fatal(err)
	}
	rm.mu.Lock()
	kept := len(rm.tele[0]) + len(rm.tele[1])
	rm.mu.Unlock()
	if kept != 0 {
		t.Fatalf("%d reports survived a restart", kept)
	}
	ended := false
	for _, f := range agentFrames(t, hammer) {
		ended = ended || f["ended"] == true
	}
	if !ended {
		t.Fatal("the commander was not told the reports ended")
	}
}

func TestTelemetryEndsWithTheMatchAndNeverTouchesTheGame(t *testing.T) {
	rm := newRoom(t, Config{Bots: [2]string{"", "rush"}, AutoStart: true, LengthSeconds: 240})
	hammer := join(t, rm, 0, RoleHammer, 0)
	leader := join(t, rm, 0, RoleSquad, 1)
	before := rm.sim.Hash()
	// Whatever an agent claims about itself changes nothing in the simulation.
	tell(t, rm, leader, `{"state":"idle","gold":999999,"tier":3,"squad":2}`)
	if rm.sim.Hash() != before {
		t.Fatal("a telemetry report changed the simulation")
	}
	rm.View(func(s *sim.Sim) {
		if sq := s.Squad(1); sq == nil || sq.Tier != 1 {
			t.Fatalf("a telemetry report changed a squad's tier: %+v", sq)
		}
	})
	for i := 0; i < 241*rules.TickRate; i++ {
		rm.Tick()
	}
	rm.mu.Lock()
	kept := len(rm.tele[0])
	rm.mu.Unlock()
	if kept != 0 {
		t.Fatalf("%d reports kept after the match ended", kept)
	}
	// And nothing is kept afterwards either.
	if err := rm.Report(leader, json.RawMessage(`{"state":"idle"}`)); err != nil && !errors.Is(err, ErrNotAnAgent) {
		t.Fatal(err)
	}
	rm.mu.Lock()
	kept = len(rm.tele[0])
	rm.mu.Unlock()
	if kept != 0 {
		t.Fatal("a report after the match ended was kept")
	}
	_ = hammer
}
