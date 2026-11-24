package sim_test

import (
	"testing"

	"callsign/server/sim"
	"callsign/shared"
)

// The opening: a match starts with the headquarters alone. The refinery is built first
// and brings a hauler; further haulers come out of the works.
func TestTheOpeningIsARefineryThatBringsAHauler(t *testing.T) {
	s, err := sim.New(rules, sim.Config{Seed: 1, Factions: [2]string{"aegis", "ashfall"}})
	if err != nil {
		t.Fatal(err)
	}
	snap := s.Snapshot(0)
	for _, st := range snap.Structures {
		if st.Side == 0 {
			t.Fatalf("a match starts with a structure standing: %+v", st)
		}
	}
	if n := len(haulersOf(snap, 0)); n != 0 {
		t.Fatalf("a match starts with %d haulers, want none", n)
	}
	var refinery, barracks shared.Structure
	for _, def := range rules.Factions["aegis"].Structures {
		switch def.Role {
		case shared.RoleRefinery:
			refinery = def
		case shared.RoleBarracks:
			barracks = def
		}
	}
	if spare := snap.Gold - refinery.Cost - barracks.Cost - rules.Factions["aegis"].Units["commandos"].Cost; spare < 0 {
		t.Fatalf("the starting gold (%d) does not pay for a refinery, a barracks and a first squad", snap.Gold)
	}
	// No refinery, no barracks: nothing can be bought yet, and the refusal says what to build.
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "commandos"}, sim.ErrNeedsStructure, "Barracks")
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "crawler"}, sim.ErrNeedsStructure, "Vehicle Works")

	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "refinery"}); err != nil {
		t.Fatal(err)
	}
	run(s, refinery.BuildSeconds-1)
	if n := len(haulersOf(s.Snapshot(0), 0)); n != 0 {
		t.Fatalf("the hauler arrived before the refinery stood: %d", n)
	}
	run(s, 2)
	built := own(s, 0, shared.RoleRefinery)
	haulers := haulersOf(s.Snapshot(0), 0)
	if built == nil || len(haulers) != 1 {
		t.Fatalf("a finished refinery should bring one hauler: refinery %v, haulers %d", built != nil, len(haulers))
	}
	if d := (haulers[0].X-built.X)*(haulers[0].X-built.X) + (haulers[0].Y-built.Y)*(haulers[0].Y-built.Y); d > 120*120 {
		t.Fatalf("the hauler did not appear at the refinery: %+v", haulers[0])
	}
	gold := s.Gold(0)
	// It goes to work by itself and earns more than the trickle would.
	run(s, 90)
	if earned, trickle := s.Gold(0)-gold, 90*rules.Match.HQTrickle; earned <= trickle {
		t.Fatalf("in 90 s the side earned %d, no more than the trickle's %d", earned, trickle)
	}
	// More haulers need the works.
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "crawler"}, sim.ErrNeedsStructure, "Vehicle Works")
}

// A side with no gold for a refinery is not stuck: the headquarters trickle pays for one.
func TestTheTrickleRecoversASideWithNothing(t *testing.T) {
	s, err := sim.New(rules, sim.Config{Seed: 1, Factions: [2]string{"aegis", "ashfall"}, StartGold: 1})
	if err != nil {
		t.Fatal(err)
	}
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "refinery"}, sim.ErrNoGold, "")
	for i := 0; i < 120*rules.TickRate && s.Gold(0) < 400; i++ {
		s.Step()
	}
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "refinery"}); err != nil {
		t.Fatalf("after two minutes of the trickle (%d gold): %v", s.Gold(0), err)
	}
	run(s, 20)
	if len(haulersOf(s.Snapshot(0), 0)) != 1 {
		t.Fatal("the recovered side's refinery brought no hauler")
	}
}

// Haulers unload at a refinery, turn to the headquarters when it falls, and a rebuilt
// refinery brings a hauler of its own.
func TestHaulersUnloadAtTheRefinery(t *testing.T) {
	s := newSim(t, 1)
	refinery := own(s, 0, shared.RoleRefinery)
	if refinery == nil || len(haulersOf(s.Snapshot(0), 0)) != 1 {
		t.Fatal("a standing refinery should have brought its hauler")
	}
	rx, ry := refinery.X, refinery.Y
	hq := rules.HQPoint(0)
	near := func(h sim.HaulerView, x, y float64) bool { return (h.X-x)*(h.X-x)+(h.Y-y)*(h.Y-y) < 100*100 }
	unloadedAt := func(seconds int) (atRefinery, atHQ bool) {
		for i := 0; i < seconds*rules.TickRate; i++ {
			s.Step()
			for _, h := range haulersOf(s.Snapshot(0), 0) {
				if h.State == sim.HaulUnloading {
					atRefinery = atRefinery || near(h, rx, ry)
					atHQ = atHQ || (near(h, hq.X, hq.Y) && !near(h, rx, ry))
				}
			}
		}
		return
	}
	if r, h := unloadedAt(120); !r || h {
		t.Fatalf("with a refinery standing: unloaded at the refinery %v, at the headquarters %v", r, h)
	}

	// An enemy squad brings the refinery down, and is then taken off the board.
	raiders := buyFielded(t, s, 1, "technical")
	place(raiders, rx+120, ry)
	for _, sq := range s.Squads {
		if sq.Side == 0 && !sq.IsHauler() {
			place(sq, 100, 60) // nobody home to stop them
		}
	}
	s.Step()
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdAttack, Squad: raiders.ID, Place: refinery.ID})
	for i := 0; i < 4000 && own(s, 0, shared.RoleRefinery) != nil; i++ {
		s.Step()
	}
	if own(s, 0, shared.RoleRefinery) != nil {
		t.Fatal("the raiders never brought the refinery down")
	}
	place(raiders, 1500, 60)
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdHold, Squad: raiders.ID, Point: "K"})
	before := len(haulersOf(s.Snapshot(0), 0))
	if before > 0 {
		if r, h := unloadedAt(200); r || !h {
			t.Fatalf("with the refinery gone: unloaded at its ruin %v, at the headquarters %v", r, h)
		}
	}

	// Rebuilt, it serves again and brings one more hauler.
	for s.Gold(0) < 600 {
		s.Step()
	}
	before = len(haulersOf(s.Snapshot(0), 0))
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "refinery"}); err != nil {
		t.Fatal(err)
	}
	run(s, 20)
	if own(s, 0, shared.RoleRefinery) == nil {
		t.Fatal("the refinery was not rebuilt")
	}
	if after := len(haulersOf(s.Snapshot(0), 0)); after != before+1 {
		t.Fatalf("a rebuilt refinery should bring a hauler: %d before, %d after", before, after)
	}
	// And with the works standing a further one can be bought.
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "crawler"}); err != nil {
		t.Fatalf("a hauler from the works: %v", err)
	}
}

// A captured refinery takes the loads of its new owner's haulers.
func TestACapturedRefineryServesItsNewOwner(t *testing.T) {
	s := newSim(t, 1)
	theirs := own(s, 1, shared.RoleRefinery)
	engineers := buyFielded(t, s, 0, "engineers")
	place(engineers, theirs.X-40, theirs.Y)
	for _, sq := range s.Squads {
		if sq.Side == 1 {
			place(sq, 1500, 60)
		}
	}
	s.Step()
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdCapture, Squad: engineers.ID, Place: theirs.ID})
	run(s, 30)
	found := false
	for _, site := range s.DropOffs(0) {
		found = found || (site.X == theirs.X && site.Y == theirs.Y)
	}
	if !found {
		t.Fatalf("side 0 took the enemy refinery but its drop-offs are %+v", s.DropOffs(0))
	}
	for _, site := range s.DropOffs(1) {
		if site.X == theirs.X && site.Y == theirs.Y {
			t.Fatal("the refinery still serves the side that lost it")
		}
	}
}
