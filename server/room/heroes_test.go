package room

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"callsign/server/sim"
)

// heard reports whether a client was sent a transmission containing some words.
func heard(frames []frame, words string) bool {
	for _, f := range frames {
		if f.Type == "radio" && strings.Contains(f.Message.Text, words) {
			return true
		}
	}
	return false
}

func eventOf(frames []frame, kind string) *frame {
	for i, f := range frames {
		if f.Type == "event" && f.Event.Kind == kind {
			return &frames[i]
		}
	}
	return nil
}

func texts(frames []frame) (out []string) {
	for _, f := range frames {
		if f.Type == "radio" {
			out = append(out, f.Message.Text)
		}
	}
	return out
}

func TestAHeroIsAnnouncedOnBothNetsAndASeizedSquadChangesNets(t *testing.T) {
	rm := newRoom(t, Config{StartGold: 5000})
	hammer0 := join(t, rm, 0, RoleHammer, 0)
	hammer1 := join(t, rm, 1, RoleHammer, 0)
	buy := func(side int, unit string) *sim.Squad {
		t.Helper()
		sq, err := rm.sim.Apply(sim.Command{Side: side, Kind: sim.CmdBuy, Unit: unit})
		if err != nil {
			t.Fatal(err)
		}
		for sq.Deploying() {
			rm.Tick()
		}
		return sq
	}
	drain(t, hammer0)
	drain(t, hammer1)
	oracle := buy(1, "oracle")
	own, theirs := drain(t, hammer1), drain(t, hammer0)
	if !heard(own, "Hammer, this is Anvil. Oracle (Raven 1) is in the field. Out.") {
		t.Fatalf("its own net: %q", texts(own))
	}
	if !heard(theirs, "Hammer, this is Anvil. Warning: enemy hero in the field: Oracle. Out.") {
		t.Fatalf("the enemy's net: %q", texts(theirs))
	}
	// The hero has a leader of its own, who answers to its own callsign.
	raven := join(t, rm, 1, RoleSquad, oracle.ID)
	if st, ok := rm.station(raven.ID); !ok || rm.net.Name(st, "he") != "עורב 1" {
		t.Fatalf("the hero's station: %+v", st)
	}
	if st, ok := rm.net.Resolve("Raven 1"); !ok || rm.squadOf(1, st) != oracle {
		t.Fatal("the net does not find the hero by its callsign")
	}

	buy(1, "technical") // so that Ashfall's next vehicle is its second
	tank := buy(0, "tank")
	rhino := join(t, rm, 0, RoleSquad, tank.ID)
	tank.Teams[0].X, tank.Teams[0].Y = 450, 430
	tank.Order = sim.Order{Kind: sim.OrderHold, X: 450, Y: 430}
	oracle.Teams[0].X, oracle.Teams[0].Y = 560, 430
	oracle.Order = sim.Order{Kind: sim.OrderHold, X: 560, Y: 430}
	ticks(rm, 0.5)
	// Only the hero has the tool's use; a squad that is none is refused by the match.
	militia := join(t, rm, 1, RoleSquad, 3)
	if _, err := rm.Tool(militia, ToolSeize, json.RawMessage(`{"contact":`+itoa(tank.ID)+`}`)); !errors.Is(err, sim.ErrNotHero) {
		t.Fatalf("militia seizing: %v", err)
	}
	if _, err := rm.Say(hammer1, "Viper 1, this is Hammer. Blow up the west bridge. Over."); err != nil {
		t.Fatal(err) // a bridge is hit only on the commander's order (bridges.go)
	}
	if _, err := rm.Tool(militia, ToolPlant, json.RawMessage(`{"place":"the west bridge"}`)); !errors.Is(err, sim.ErrNotHero) {
		t.Fatalf("militia planting: %v", err)
	}
	drain(t, hammer0)
	drain(t, hammer1)
	drain(t, rhino)
	tool(t, rm, raven, ToolSeize, `{"contact":`+itoa(tank.ID)+`}`)
	ticks(rm, 6)
	if tank.Side != 1 {
		t.Fatalf("the tank is still side %d", tank.Side)
	}
	// The side that lost it: the event names it as that side knew it, and its leader is off the net.
	lost := eventOf(drain(t, hammer0), sim.EvSquadLost)
	if lost == nil || lost.Event.Reason != sim.ReasonSeized || lost.Callsign == nil || lost.Callsign.En != "Rhino 1" {
		t.Fatalf("the side that lost the tank was told %+v", lost)
	}
	if _, err := rm.Tool(rhino, ToolHold, json.RawMessage(`{"place":"here"}`)); err == nil {
		t.Fatal("the old leader still commands a seized squad")
	}
	if _, err := rm.Join(Identity{Side: 0, Role: RoleSquad, Squad: tank.ID}, false); err == nil {
		t.Fatal("a leader of the side that lost the squad may still join for it")
	}
	// The side that took it: a new squad on its net, with a number of its own.
	got := eventOf(drain(t, hammer1), sim.EvSquadSpawned)
	if got == nil || got.Event.Reason != sim.ReasonSeized || got.Callsign == nil || got.Callsign.En != "Rhino 2" {
		t.Fatalf("the side that took the tank was told %+v", got)
	}
	taken := join(t, rm, 1, RoleSquad, tank.ID)
	tool(t, rm, taken, ToolHold, `{"place":"B"}`)
	if st, ok := rm.net.Resolve("Rhino 2"); !ok || rm.squadOf(1, st) != tank {
		t.Fatal("the taker's net does not find the seized tank by its new callsign")
	}

	// The hero falls: both nets hear it, and the tank is back with a leader's seat open.
	oracle.Teams[0].HP = 1
	viper := rm.sim.Squad(1)
	for i := range viper.Teams {
		viper.Teams[i].X, viper.Teams[i].Y = 600, 430
	}
	viper.Order = sim.Order{Kind: sim.OrderHold, X: 600, Y: 430}
	drain(t, hammer0)
	drain(t, hammer1)
	ticks(rm, 20)
	if oracle.Alive || tank.Side != 0 {
		t.Fatalf("the hero is alive=%v and the tank is side %d", oracle.Alive, tank.Side)
	}
	own, theirs = drain(t, hammer1), drain(t, hammer0)
	if !heard(own, "Oracle (Raven 1) is down") || !heard(theirs, "The enemy's Oracle is down") {
		t.Fatalf("the hero fell: its own net %q, the enemy's %q", texts(own), texts(theirs))
	}
	if back := eventOf(theirs, sim.EvSquadSpawned); back == nil || back.Event.Reason != sim.ReasonReturned || back.Callsign.En != "Rhino 1" {
		t.Fatalf("the tank came back as %+v", back)
	}
	if _, err := rm.Tool(taken, ToolHold, json.RawMessage(`{"place":"here"}`)); err == nil {
		t.Fatal("the taker's leader still commands a squad that went back")
	}
	join(t, rm, 0, RoleSquad, tank.ID)
}

func itoa(n int) string {
	b, _ := json.Marshal(n)
	return string(b)
}

func TestASquadDigsInByToolAndItsPositionHasAName(t *testing.T) {
	rm := newRoom(t, Config{})
	join(t, rm, 0, RoleHammer, 0) // the match runs once its commander is in
	viper1 := join(t, rm, 0, RoleSquad, 1)
	anvil := join(t, rm, 0, RoleAnvil, 0)
	if _, err := rm.Tool(anvil, ToolFortify, nil); err == nil || !strings.Contains(err.Error(), "may not use") {
		t.Fatalf("the operator digging in: %v", err)
	}
	ticks(rm, 3)
	res, err := rm.Tool(viper1, ToolFortify, json.RawMessage(`{}`))
	if err != nil || res.(map[string]any)["order"] != sim.OrderFortify {
		t.Fatalf("fortify: %v, %v", res, err)
	}
	ticks(rm, 12)
	built := rm.sim.BuiltLandmarks(0)
	if len(built) != 1 {
		t.Fatalf("%d positions after digging in: %+v", len(built), rm.sim.Snapshot(0).Squads[0])
	}
	for _, words := range []string{built[0].ID, built[0].Name.En, built[0].Name.He, "the sandbags", "שקי החול"} {
		tool(t, rm, viper1, ToolHold, `{"place":`+string(mustJSON(words))+`}`)
		if got := rm.sim.Squad(1).Order.Place; got != built[0].ID {
			t.Errorf("hold %q: the order goes to %q, want %q", words, got, built[0].ID)
		}
	}
	// The enemy has not seen it and cannot name it.
	militia := join(t, rm, 1, RoleSquad, 3)
	if _, err := rm.Tool(militia, ToolMove, json.RawMessage(`{"place":`+string(mustJSON(built[0].ID))+`}`)); err == nil {
		t.Fatal("the enemy moved to a position it has never seen, by its id")
	}
}

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}
