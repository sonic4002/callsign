package sim_test

import (
	"errors"
	"testing"

	"callsign/server/sim"
	"callsign/shared"
)

func haulersOf(snap sim.Snapshot, side int) []sim.HaulerView {
	var out []sim.HaulerView
	for _, h := range snap.Haulers {
		if h.Side == side {
			out = append(out, h)
		}
	}
	return out
}

func field(snap sim.Snapshot, gusher string) sim.FieldView {
	for _, f := range snap.Fields {
		if f.Gusher == gusher {
			return f
		}
	}
	return sim.FieldView{}
}

// A side starts with one hauler that works without being told: out to the nearest field,
// load, home, unload, and again. The gold it brings is the side's to spend.
func TestHaulersCollectGoldOnTheirOwn(t *testing.T) {
	s := newSim(t, 1)
	start := s.Snapshot(0)
	if hs := haulersOf(start, 0); len(hs) != 1 || len(haulersOf(start, 1)) != 0 {
		t.Fatalf("side 0 sees %d own haulers and %d enemy ones at the start", len(hs), len(haulersOf(start, 1)))
	}
	if len(start.Squads) != 2 {
		t.Fatalf("haulers must not be listed as squads: %d squads", len(start.Squads))
	}
	states := map[string]bool{}
	for i := 0; i < 70*rules.TickRate; i++ {
		s.Step()
		states[haulersOf(s.Snapshot(0), 0)[0].State] = true
	}
	for _, want := range []string{sim.HaulOut, sim.HaulLoading, sim.HaulReturning, sim.HaulUnloading} {
		if !states[want] {
			t.Errorf("in 70 s the hauler was never %q; it was %v", want, states)
		}
	}
	_, u := rules.HaulerOf("aegis")
	trickle := rules.Match.StartGold + 70*rules.Match.HQTrickle
	if got := s.Gold(0); got < trickle+int(u.Capacity) {
		t.Fatalf("gold after 70 s = %d, want the trickle (%d) plus at least one load of %.0f", got, trickle, u.Capacity)
	}
	if h := haulersOf(s.Snapshot(0), 0)[0]; h.Field != "B" {
		t.Errorf("the west hauler works field %q, want its home field B", h.Field)
	}
	if got := s.Snapshot(0).Income; got <= rules.Match.HQTrickle*60 {
		t.Errorf("income = %d a minute, want more than the trickle alone (%d)", got, rules.Match.HQTrickle*60)
	}
}

// Gold in a field is finite: haulers draw it down, and the gusher slowly brings it back,
// never past the field's cap.
func TestGusherRefillsItsField(t *testing.T) {
	s := newSim(t, 1)
	g := rules.GusherByID("F") // nobody works the middle field at the start
	s.Fields[2].Gold = 0
	run(s, 10)
	if got, want := s.Fields[2].Gold, g.RatePerSecond*10; got < want-0.01 || got > want+0.01 {
		t.Fatalf("an empty field holds %.1f after 10 s, want %.1f", got, want)
	}
	s.Fields[2].Gold = g.FieldCap - 1
	run(s, 5)
	if s.Fields[2].Gold != g.FieldCap {
		t.Fatalf("a full field holds %.1f, want its cap %.0f", s.Fields[2].Gold, g.FieldCap)
	}
	// A hauler takes out what it carries home.
	before := s.Fields[0].Gold
	s.Fields[0].Gold = 200
	run(s, 60)
	if s.Fields[0].Gold >= before {
		t.Fatalf("the home field was not drawn down: %.0f", s.Fields[0].Gold)
	}
}

// The haul command sends haulers to a named field, and "auto" hands the choice back.
func TestHaulCommand(t *testing.T) {
	s := newSim(t, 1)
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdHaul, Field: "Q"}); !errors.Is(err, sim.ErrNoField) {
		t.Fatalf("haul to an unknown field: err = %v", err)
	}
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHaul, Field: "F"})
	run(s, 3)
	if h := haulersOf(s.Snapshot(0), 0)[0]; h.Field != "F" || h.Assigned != "F" {
		t.Fatalf("after haul F the hauler works %q (sent to %q)", h.Field, h.Assigned)
	}
	if h := haulersOf(s.Snapshot(1), 1)[0]; h.Assigned != "" {
		t.Fatalf("side 0's order reached side 1's hauler: %+v", h)
	}
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHaul, Field: sim.HaulAuto})
	run(s, 3)
	if h := haulersOf(s.Snapshot(0), 0)[0]; h.Field != "B" || h.Assigned != "" {
		t.Fatalf("after haul auto the hauler works %q (sent to %q), want its own choice B", h.Field, h.Assigned)
	}
	other := haulersOf(s.Snapshot(1), 1)[0].ID
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdHaul, Field: "F", Hauler: other}); !errors.Is(err, sim.ErrNoHauler) {
		t.Fatalf("haul with the enemy's hauler id: err = %v", err)
	}
	// Haulers take no squad orders and no upgrades.
	mine := haulersOf(s.Snapshot(0), 0)[0].ID
	for _, c := range []sim.Command{
		{Side: 0, Kind: sim.CmdHold, Squad: mine, Point: "G"},
		{Side: 0, Kind: sim.CmdUpgrade, Squad: mine},
	} {
		if _, err := s.Apply(c); !errors.Is(err, sim.ErrNoSquad) {
			t.Errorf("%s on a hauler: err = %v, want ErrNoSquad", c.Kind, err)
		}
	}
}

// Haulers are bought like squads but have their own cap and their own ids, and no leader
// is announced for them.
func TestBuyingHaulers(t *testing.T) {
	s, err := sim.New(rules, sim.Config{Seed: 1, Factions: [2]string{"aegis", "ashfall"}, StartGold: 5000, FullBase: true})
	if err != nil {
		t.Fatal(err)
	}
	if s.Gold(0) != 5000 || s.Gold(1) != 5000 {
		t.Fatalf("starting gold = %d and %d, want the configured 5000", s.Gold(0), s.Gold(1))
	}
	id, u := rules.HaulerOf("aegis")
	var events []sim.Event
	for s.Haulers(0) < rules.Match.HaulerCap {
		sq := must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: id})
		if sq.ID <= sim.HaulerIDBase || !sq.IsHauler() {
			t.Fatalf("a bought hauler got id %d", sq.ID)
		}
	}
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: id}); !errors.Is(err, sim.ErrHaulerCap) {
		t.Fatalf("a hauler past the cap: err = %v", err)
	}
	if got, want := s.Gold(0), 5000-(rules.Match.HaulerCap-1)*u.Cost; got != want {
		t.Fatalf("gold after buying haulers = %d, want %d", got, want)
	}
	events = append(events, run(s, u.DeploySeconds+1)...)
	for _, e := range events {
		if e.Kind == sim.EvSquadSpawned && e.Squad > sim.HaulerIDBase {
			t.Fatal("a hauler was announced as a squad joining the net")
		}
	}
	if n := len(haulersOf(s.Snapshot(0), 0)); n != rules.Match.HaulerCap {
		t.Fatalf("%d haulers on the field, want %d", n, rules.Match.HaulerCap)
	}
	if s.Population(0) != 2 {
		t.Fatalf("haulers count toward the squad cap: population %d", s.Population(0))
	}
	// The next squad bought still gets the next squad id.
	if sq := must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "tank"}); sq.ID != 5 {
		t.Fatalf("the squad bought after the haulers got id %d, want 5", sq.ID)
	}
}

// A hauler that is shot at runs for home and its side is told; the field is then avoided.
// The enemy sees the hauler as a contact it can attack, and remembers where it last was.
func TestHaulerUnderFire(t *testing.T) {
	s := newSim(t, 1)
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdHold, Squad: 3, Point: "B"})
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdHold, Squad: 4, Point: "B"})
	hauler := haulersOf(s.Snapshot(0), 0)[0].ID
	attacked, lost, seen, fled, remembered := false, false, false, false, false
	for i := 0; i < 150*rules.TickRate && !lost; i++ {
		for _, e := range s.Step() {
			if e.Side == 0 && e.Kind == sim.EvHaulerAttacked && e.Hauler == hauler {
				attacked = true
			}
			if e.Side == 0 && e.Kind == sim.EvHaulerLost && e.Hauler == hauler {
				lost = true
			}
		}
		theirs := s.Snapshot(1)
		for _, c := range theirs.Contacts {
			if c.ID == hauler && c.Class == shared.HaulerClass {
				if !seen {
					// A hauler in sight can be attacked by its contact id like any squad.
					must(t, s, sim.Command{Side: 1, Kind: sim.CmdAttack, Squad: 3, Contact: hauler})
				}
				seen = true
			}
		}
		for _, h := range haulersOf(theirs, 0) {
			remembered = remembered || (h.ID == hauler && !h.Visible)
		}
		for _, h := range haulersOf(s.Snapshot(0), 0) {
			fled = fled || h.State == sim.HaulFleeing
		}
	}
	if !attacked || !seen || !fled {
		t.Fatalf("ambush at the home field: attacked event %v, enemy saw it as a contact %v, it fled %v", attacked, seen, fled)
	}
	if !lost && !remembered {
		t.Error("the hauler got away, but the enemy does not remember where it last saw it")
	}
	if lost {
		if n := len(haulersOf(s.Snapshot(0), 0)); n != 0 {
			t.Fatalf("a destroyed hauler is still listed: %d", n)
		}
	}
}

// A hauler does not drive into a field it knows to be under fire: with the enemy standing
// on the home field in plain sight, it takes the middle field or waits at home.
func TestHaulersAvoidAFieldUnderFire(t *testing.T) {
	s := newSim(t, 1)
	// Side 1's squads walk to Bravo; side 0's own squads stand next to it and see them.
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdMove, Squad: 1, Point: "D"})
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdHold, Squad: 3, Point: "B"})
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdHold, Squad: 4, Point: "B"})
	run(s, 150)
	for _, h := range haulersOf(s.Snapshot(0), 0) {
		if h.State == sim.HaulLoading && h.Field == "B" {
			t.Fatalf("a hauler is loading in a field the enemy holds: %+v", h)
		}
	}
}

// Fields are fogged like points: a side is shown the gold as it last saw it.
func TestFieldsAreShownAsLastSeen(t *testing.T) {
	s := newSim(t, 1)
	start := rules.GusherByID("B").StartGold / rules.GusherByID("B").FieldCap
	run(s, 40)
	mine, theirs := field(s.Snapshot(0), "B"), field(s.Snapshot(1), "B")
	if !mine.Visible || mine.Gold >= start {
		t.Fatalf("side 0 works Bravo and should see it drawn down: %+v (started at %.2f)", mine, start)
	}
	if theirs.Visible || theirs.Gold != float64(int(start*100+0.5))/100 {
		t.Fatalf("side 1 has never seen Bravo but is shown %+v, want the starting %.2f", theirs, start)
	}
	if spec := field(s.Snapshot(sim.Spectator), "B"); spec.Gold != mine.Gold {
		t.Fatalf("spectator sees %.2f, side 0 sees %.2f", spec.Gold, mine.Gold)
	}
}

// The land rigs no longer pay; the sea rig still does, and the headquarters trickles.
func TestOnlyTheSeaRigAndTheTricklePayWithoutHaulers(t *testing.T) {
	if rules.Rigs["landRig"].Income != 0 || rules.Rigs["seaRig"].Income <= 0 || rules.Match.HQTrickle <= 0 {
		t.Fatalf("rig incomes: land %d, sea %d, trickle %d", rules.Rigs["landRig"].Income, rules.Rigs["seaRig"].Income, rules.Match.HQTrickle)
	}
	// A side that lost every hauler can afford a new one within ninety seconds.
	for name := range rules.Factions {
		_, u := rules.HaulerOf(name)
		if secs := float64(u.Cost) / float64(rules.Match.HQTrickle); secs > 90 {
			t.Errorf("%s: a hauler costs %d, %.0f s of trickle", name, u.Cost, secs)
		}
	}
	// Send both haulers to wait: with no loads coming in, ten seconds pay ten trickles.
	s := newSim(t, 1)
	for i := range s.Fields {
		s.Fields[i].Gold = 0
	}
	before := s.Gold(0)
	run(s, 10)
	if got, want := s.Gold(0)-before, 10*rules.Match.HQTrickle; got != want {
		t.Fatalf("ten idle seconds paid %d, want %d", got, want)
	}
}
