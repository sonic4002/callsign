package room

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"callsign/server/sim"
)

// actRoom is a match under way with power, a refinery and a barracks, and no purse given
// to the operator: what is built here is built by the commander's own hand.
func actRoom(t *testing.T) *Room {
	t.Helper()
	rm, err := New(rules, Config{Seed: 1, Factions: [2]string{"aegis", "ashfall"}, AutoStart: true, Base: []string{"power", "refinery", "barracks"}})
	if err != nil {
		t.Fatal(err)
	}
	return rm
}

func act(rm *Room, c *Client, name, args string) (map[string]any, error) {
	res, err := rm.Act(c, name, json.RawMessage(args))
	m, _ := res.(map[string]any)
	return m, err
}

// The commander builds and buys from the panel with no agent in between: it starts in the
// same tick, the operator hears of it without a call, and announces it once when ready.
func TestTheCommanderBuildsAndBuysDirectly(t *testing.T) {
	rm := actRoom(t)
	hammer := join(t, rm, 0, RoleHammer, 0)
	anvil := join(t, rm, 0, RoleAnvil, 0)
	enemy := join(t, rm, 1, RoleHammer, 0)
	ticks(rm, 40) // gold for a works
	drain(t, hammer)
	drain(t, anvil)
	drain(t, enemy)

	gold := rm.sim.Gold(0)
	res, err := act(rm, hammer, ActBuild, `{"structure":"vehicleWorks"}`)
	if err != nil {
		t.Fatalf("building the works: %v", err)
	}
	works := rules.Factions["aegis"].Structures["vehicleWorks"]
	if rm.sim.Gold(0) != gold-works.Cost || res["kind"] != "vehicleWorks" || res["announced"] != false {
		t.Fatalf("the works did not start at once: gold %d → %d, %v", gold, rm.sim.Gold(0), res)
	}
	// No transmission: the operator gets a line for its picture, and nobody is called.
	told := false
	for _, f := range drain(t, anvil) {
		if f.Type == "radio" {
			t.Fatalf("a direct build was put on the radio: %q", f.Message.Text)
		}
		told = told || f.Type == "direct"
	}
	if !told {
		t.Fatal("the operator was not told what the commander built")
	}
	for _, f := range drain(t, enemy) {
		if f.Type == "direct" {
			t.Fatal("the enemy was told what our commander built")
		}
	}
	// When it stands, the operator's cue says so once.
	ticks(rm, works.BuildSeconds+2)
	cues := 0
	for _, m := range cuesHeard(t, hammer) {
		if strings.Contains(m.Text, "Construction complete: Vehicle Works") {
			cues++
		}
	}
	if cues != 1 {
		t.Fatalf("the works was announced %d times, want once", cues)
	}

	// A unit: in its line at once, announced once when it is in the field.
	ticks(rm, 30)
	drain(t, hammer)
	n := len(rm.sim.Snapshot(0).Deploying)
	if _, err := act(rm, hammer, ActBuy, `{"unit":"tank"}`); err != nil {
		t.Fatalf("buying a tank: %v", err)
	}
	if got := len(rm.sim.Snapshot(0).Deploying); got != n+1 {
		t.Fatalf("%d on their way after the purchase, want %d", got, n+1)
	}
	ticks(rm, rules.Factions["aegis"].Units["tank"].DeploySeconds+2)
	cues = 0
	for _, m := range cuesHeard(t, hammer) {
		if m.Cue == "unitReady" {
			cues++
		}
	}
	if cues != 1 {
		t.Fatalf("the tank was announced %d times, want once", cues)
	}
	// The operator still builds only on an order or with the purse.
	if _, err := rm.Tool(anvil, ToolBuild, json.RawMessage(`{"structure":"radar"}`)); !errors.Is(err, ErrNotOrdered) {
		t.Fatalf("the operator building unasked after a direct build: err = %v", err)
	}
}

func TestDirectActionsMeetEveryCheckAndOnlyTheCommanderMayAct(t *testing.T) {
	rm := actRoom(t)
	hammer := join(t, rm, 0, RoleHammer, 0)
	anvil := join(t, rm, 0, RoleAnvil, 0)
	viper := join(t, rm, 0, RoleSquad, 1)
	watcher, err := rm.Join(Identity{Side: 0, Role: RoleSpectator}, true)
	if err != nil {
		t.Fatal(err)
	}
	enemy := join(t, rm, 1, RoleHammer, 0)
	for name, c := range map[string]*Client{"the operator": anvil, "a squad leader": viper, "a spectator": watcher} {
		if _, err := act(rm, c, ActBuild, `{"structure":"powerPlant"}`); !errors.Is(err, ErrNotCommander) {
			t.Fatalf("%s building from the panel: err = %v", name, err)
		}
		if _, err := act(rm, c, ActBuy, `{"unit":"commandos"}`); !errors.Is(err, ErrNotCommander) {
			t.Fatalf("%s buying from the panel: err = %v", name, err)
		}
	}
	// The game's own refusals, each with its reason.
	for _, tc := range []struct {
		act, args string
		want      error
	}{
		{ActBuy, `{"unit":"tank"}`, sim.ErrNeedsStructure},                           // no works
		{ActBuy, `{"unit":"helicopter"}`, sim.ErrNeedsStructure},                     // no airbase
		{ActBuild, `{"structure":"airbase"}`, sim.ErrNeedsStructure},                 // no radar
		{ActBuild, `{"structure":"barracks","place":"N10 E10 of A"}`, sim.ErrNoRoom}, // on the headquarters
		{ActBuild, `{"structure":"barracks","place":"S300 E900 of A"}`, sim.ErrTooFar},
		{ActBuy, `{"unit":"nothing"}`, sim.ErrNoUnit},
		{ActCancel, `{"unit":"commandos"}`, sim.ErrNothingDue},
		{"dance", `{}`, nil},
	} {
		_, err := act(rm, hammer, tc.act, tc.args)
		if err == nil || (tc.want != nil && !errors.Is(err, tc.want)) {
			t.Errorf("%s %s: err = %v, want %v", tc.act, tc.args, err, tc.want)
		}
	}
	// Not enough gold, and a line that is full.
	for rm.sim.Gold(0) >= rules.Factions["aegis"].Units["commandos"].Cost {
		if _, err := act(rm, hammer, ActBuy, `{"unit":"commandos"}`); err != nil {
			if !errors.Is(err, sim.ErrLineFull) && !errors.Is(err, sim.ErrTooMany) {
				t.Fatalf("buying until something gives: %v", err)
			}
			break
		}
	}
	// Whatever gold is left goes on barrier walls until there is not enough for one more.
	wall := rules.Factions["aegis"].Structures["barrierWall"]
	for i := 0; i < 8 && rm.sim.Gold(0) >= wall.Cost; i++ {
		if _, err := act(rm, hammer, ActBuild, `{"structure":"barrierWall","place":"base:front"}`); err != nil {
			break
		}
		ticks(rm, wall.BuildSeconds+1)
	}
	if rm.sim.Gold(0) < rules.Factions["aegis"].Structures["vehicleWorks"].Cost {
		if _, err := act(rm, hammer, ActBuild, `{"structure":"vehicleWorks"}`); !errors.Is(err, sim.ErrNoGold) {
			t.Fatalf("a works without the gold: err = %v (gold %d)", err, rm.sim.Gold(0))
		}
	}
	// Only one's own side: the enemy commander cannot sell or rally our barracks.
	var ours string
	for _, st := range rm.sim.Snapshot(0).Structures {
		if st.Side == 0 && st.Role == "barracks" {
			ours = st.ID
		}
	}
	if _, err := act(rm, enemy, ActSell, `{"place":"`+ours+`"}`); err == nil {
		t.Fatal("the enemy commander sold our barracks")
	}
	if _, err := act(rm, enemy, ActRally, `{"place":"Z","structure":"`+ours+`"}`); err == nil {
		t.Fatal("the enemy commander set our barracks' rally point")
	}
	// Our own: a rally point, then the sale.
	if _, err := act(rm, hammer, ActRally, `{"place":"D","structure":"`+ours+`"}`); err != nil {
		t.Fatalf("setting our rally point: %v", err)
	}
	if res, err := act(rm, hammer, ActSell, `{"place":"`+ours+`"}`); err != nil || res["sold"] != ours {
		t.Fatalf("selling our barracks: %v %v", res, err)
	}
}
