package room

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"callsign/server/sim"
	"callsign/shared"
)

// baseRoom is a room whose match starts as a real one does: everything past the
// barracks and the refinery has to be built.
func baseRoom(t *testing.T) *Room {
	t.Helper()
	rm, err := New(rules, Config{Seed: 1, Factions: [2]string{"aegis", "ashfall"}, AutoStart: true, Purse: true, Base: []string{"refinery", "barracks"}}) // these tests are about the build tree, not about who may spend
	if err != nil {
		t.Fatal(err)
	}
	return rm
}

func ticks(rm *Room, seconds float64) {
	for i := 0; i < int(seconds*float64(rules.TickRate)); i++ {
		rm.Tick()
	}
}

func TestOnlyTheOperatorBuildsAndTheBuildTreeIsEnforced(t *testing.T) {
	rm := baseRoom(t)
	anvil := join(t, rm, 0, RoleAnvil, 0)
	viper1 := join(t, rm, 0, RoleSquad, 1)
	hammer := join(t, rm, 0, RoleHammer, 0)

	for _, c := range []*Client{viper1, hammer} {
		if _, err := rm.Tool(c, ToolBuild, json.RawMessage(`{"structure":"vehicleWorks"}`)); err == nil || !strings.Contains(err.Error(), "may not use") {
			t.Errorf("%s building: err = %v, want a refusal", c.ID.Role, err)
		}
	}
	// The reason names what is missing, so the operator can pass it on.
	_, err := rm.Tool(anvil, ToolBuy, json.RawMessage(`{"unit":"tank"}`))
	if !errors.Is(err, sim.ErrNeedsStructure) || !strings.Contains(err.Error(), "Vehicle Works") {
		t.Fatalf("a tank with no works: err = %v", err)
	}
	for args, want := range map[string]error{
		`{}`:                        nil, // a plain message, checked below
		`{"structure":"castle"}`:    sim.ErrNoStructure,
		`{"structure":"Chop Shop"}`: sim.ErrNoStructure, // the other faction's
		`{"structure":"airbase"}`:   sim.ErrNeedsStructure,
		`{"structure":"barracks","place":"S200 of G"}`:     sim.ErrTooFar, // a base structure goes near the base
		`{"structure":"sentryGun","place":"Kilo"}`:         sim.ErrTooFar,
		`{"structure":"sentryGun","place":"the moon"}`:     sim.ErrBadPlace,
		`{"structure":"flakBattery","place":"base:front"}`: sim.ErrNeedsStructure,
	} {
		_, err := rm.Tool(anvil, ToolBuild, json.RawMessage(args))
		if err == nil || (want != nil && !errors.Is(err, want)) {
			t.Errorf("build %s: err = %v, want %v", args, err, want)
		}
	}

	// By its name in either language, by its id, or by its role.
	ticks(rm, 1)
	res, err := rm.Tool(anvil, ToolBuild, json.RawMessage(`{"structure":"מפעל הרכב"}`))
	if err != nil {
		t.Fatalf("building the works by its Hebrew name: %v", err)
	}
	out := res.(map[string]any)
	if out["kind"] != "vehicleWorks" || out["name"] != "Vehicle Works" || out["buildSeconds"].(float64) <= 0 || out["near"] == "" {
		t.Fatalf("build result = %+v", out)
	}
	if _, err := rm.Tool(anvil, ToolBuild, json.RawMessage(`{"structure":"dockyard"}`)); !errors.Is(err, sim.ErrBuilding) {
		t.Fatalf("a second base structure at once: err = %v", err)
	}
	started := false
	rm.Tick()
	for _, f := range drain(t, hammer) {
		started = started || (f.Type == "event" && f.Event.Kind == sim.EvStructureStarted && f.Event.Unit == "vehicleWorks" && f.Event.Structure != "")
	}
	if !started {
		t.Fatal("the commander was not told that the works is going up")
	}
	ticks(rm, rules.Factions["aegis"].Structures["vehicleWorks"].BuildSeconds+25)
	if _, err := rm.Tool(anvil, ToolBuy, json.RawMessage(`{"unit":"tank"}`)); err != nil {
		t.Fatalf("a tank once the works stands: %v", err)
	}
	// A defence takes a side of the base in plain words, in either language.
	if _, err := rm.Tool(anvil, ToolBuild, json.RawMessage(`{"structure":"Sentry Gun","place":"the north side"}`)); err != nil {
		t.Fatalf("a gun on the north side: %v", err)
	}
	ticks(rm, 20)
	if _, err := rm.Tool(anvil, ToolBuild, json.RawMessage(`{"structure":"חומת מגן","place":"חזית"}`)); err != nil {
		t.Fatalf("a wall on the front, in Hebrew: %v", err)
	}
	rm.View(func(s *sim.Sim) {
		hq := rules.HQPoint(0)
		gun, wall := false, 0
		for _, st := range s.Snapshot(0).Structures {
			gun = gun || (st.Kind == "sentryGun" && st.Y < hq.Y-100)
			if st.Role == shared.RoleFence && st.X > hq.X+200 {
				wall++
			}
		}
		if !gun || wall == 0 {
			t.Fatalf("the gun should stand north of the headquarters and the wall east of it (gun %v, wall segments %d)", gun, wall)
		}
	})
}

func TestSquadsAreSentAtStructuresAndOnlyEngineersCapture(t *testing.T) {
	rm, err := New(rules, Config{Seed: 1, Factions: [2]string{"aegis", "ashfall"}, AutoStart: true, FullBase: true, Purse: true})
	if err != nil {
		t.Fatal(err)
	}
	anvil := join(t, rm, 0, RoleAnvil, 0)
	viper1 := join(t, rm, 0, RoleSquad, 1)
	enemy := join(t, rm, 1, RoleSquad, 3)

	// What nobody has seen cannot be named.
	if _, err := rm.Tool(viper1, ToolAttack, json.RawMessage(`{"point":"the enemy chop shop"}`)); !errors.Is(err, sim.ErrNoPoint) {
		t.Fatalf("attacking an unseen structure: err = %v", err)
	}
	// A report lists the side's own structures and no enemy ones yet.
	briefs := func(c *Client) []StructureBrief {
		res, err := rm.Tool(c, ToolReport, nil)
		if err != nil {
			t.Fatal(err)
		}
		return res.(map[string]any)["structures"].([]StructureBrief)
	}
	for _, b := range briefs(viper1) {
		if !b.Yours {
			t.Fatalf("Viper 1's first report lists an enemy structure: %+v", b)
		}
	}
	if len(briefs(viper1)) != len(shared.BaseRoles) {
		t.Fatalf("Viper 1 should be told of its side's %d base structures, got %d", len(shared.BaseRoles), len(briefs(viper1)))
	}

	// Engineers and Viper 1 walk up to the enemy works.
	tool(t, rm, anvil, ToolBuy, `{"unit":"engineers"}`)
	ticks(rm, 6)
	engineers := join(t, rm, 0, RoleSquad, 5)
	var works string
	rm.View(func(s *sim.Sim) {
		for _, st := range s.Snapshot(sim.Spectator).Structures {
			if st.Side == 1 && st.Role == shared.RoleWorks {
				works = st.ID
				for _, id := range []int{1, 5} {
					sq := s.Squad(id)
					for i := range sq.Teams {
						sq.Teams[i].X, sq.Teams[i].Y = st.X-190, st.Y+float64(i*8)
					}
				}
			}
		}
		for _, id := range []int{3, 4} {
			for i := range s.Squad(id).Teams {
				s.Squad(id).Teams[i].X, s.Squad(id).Teams[i].Y = 1500, 60
			}
		}
	})
	ticks(rm, 0.2)
	seen := false
	for _, b := range briefs(viper1) {
		seen = seen || (b.ID == works && !b.Yours && b.Name == "Chop Shop" && b.Role == shared.RoleWorks)
	}
	if !seen {
		t.Fatalf("Viper 1 stands beside the enemy works and its report does not list it: %+v", briefs(viper1))
	}
	// The enemy is not told what the other side has built, only what it has seen of it.
	for _, b := range briefs(enemy) {
		if !b.Yours {
			t.Fatalf("side 1's report lists a side 0 structure it never saw: %+v", b)
		}
	}

	// By name or by id, a squad is sent at it.
	for _, args := range []string{`{"point":"the enemy chop shop"}`, `{"point":"` + works + `"}`, `{"place":"המוסך של האויב"}`} {
		res, err := rm.Tool(viper1, ToolAttack, json.RawMessage(args))
		if err != nil || res.(map[string]any)["place"] != works {
			t.Fatalf("attack %s: %v %v", args, res, err)
		}
	}
	// Only engineers take structures over; nobody repairs one.
	if _, err := rm.Tool(viper1, ToolCapture, json.RawMessage(`{"place":"`+works+`"}`)); !errors.Is(err, sim.ErrNotEngineers) {
		t.Fatalf("commandos capturing: err = %v", err)
	}
	if _, err := rm.Tool(engineers, ToolRepair, json.RawMessage(`{"place":"`+works+`"}`)); !errors.Is(err, sim.ErrNoBridge) {
		t.Fatalf("repairing a structure: err = %v", err)
	}
	if _, err := rm.Tool(anvil, ToolCapture, json.RawMessage(`{"place":"`+works+`"}`)); err == nil || !strings.Contains(err.Error(), "may not use") {
		t.Fatalf("the operator capturing: err = %v", err)
	}
	tool(t, rm, viper1, ToolHold, `{}`)
	res, err := rm.Tool(engineers, ToolCapture, json.RawMessage(`{"place":"the enemy chop shop"}`))
	if err != nil || res.(map[string]any)["order"] != sim.OrderCapture {
		t.Fatalf("engineers capturing by name: %v %v", res, err)
	}
	ticks(rm, 40)
	rm.View(func(s *sim.Sim) {
		if !s.Has(0, shared.RoleWorks) || s.Has(1, shared.RoleWorks) {
			t.Fatal("after the capture the works should be side 0's")
		}
	})
	// The engineers' leader is gone with them, and their side may buy the captured design.
	if _, err := rm.Tool(engineers, ToolReport, nil); err == nil {
		t.Fatal("the engineers' leader is still on the net after the squad was used up")
	}
	tool(t, rm, anvil, ToolBuy, `{"unit":"technical"}`)
}

// Building is spending: the operator builds on Hammer's order, or on its own only while
// it holds the purse, and then the net tells Hammer what was started.
func TestBuildingFollowsThePurse(t *testing.T) {
	rm, err := New(rules, Config{Seed: 1, Factions: [2]string{"aegis", "ashfall"}, AutoStart: true, Base: []string{"refinery", "barracks"}})
	if err != nil {
		t.Fatal(err)
	}
	hammer := join(t, rm, 0, RoleHammer, 0)
	anvil := join(t, rm, 0, RoleAnvil, 0)
	ticks(rm, 30)
	build := func() (map[string]any, error) {
		out, err := rm.Tool(anvil, ToolBuild, json.RawMessage(`{"structure":"vehicleWorks"}`))
		m, _ := out.(map[string]any)
		return m, err
	}
	if _, err := build(); !errors.Is(err, ErrNotOrdered) {
		t.Fatalf("an unordered build: err = %v, want ErrNotOrdered", err)
	}
	// An unordered hauler is refused the same way.
	if _, err := rm.Tool(anvil, ToolBuy, json.RawMessage(`{"unit":"crawler"}`)); !errors.Is(err, ErrNotOrdered) {
		t.Fatalf("an unordered hauler: err = %v, want ErrNotOrdered", err)
	}
	if _, err := rm.Say(hammer, "Anvil, you may buy as you see fit"); err != nil {
		t.Fatal(err)
	}
	before := len(rm.Log(0))
	out, err := build()
	if err != nil || out["announced"] != true {
		t.Fatalf("a build on the purse: %v %v", out, err)
	}
	log := rm.Log(0)
	if len(log) != before+1 || !strings.Contains(log[len(log)-1].Text, "Building Vehicle Works") || log[len(log)-1].From.Key != "operator" {
		t.Fatalf("the net did not announce the build: %+v", log[len(log)-1])
	}
	// An ordered build is not announced: Hammer asked for it.
	if _, err := rm.Say(hammer, "Anvil, stop buying"); err != nil {
		t.Fatal(err)
	}
	ticks(rm, 20)
	if _, err := rm.Say(hammer, "Anvil, build a dockyard"); err != nil {
		t.Fatal(err)
	}
	out2, err := rm.Tool(anvil, ToolBuild, json.RawMessage(`{"structure":"dockyard"}`))
	if m, _ := out2.(map[string]any); err != nil || m["announced"] != false {
		t.Fatalf("an ordered build: %v %v", out2, err)
	}
}
