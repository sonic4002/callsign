package sim_test

import (
	"testing"

	"callsign/server/sim"
	"callsign/shared"
)

// The economy stands on the base: haulers unload at a refinery, cannot be bought without
// one, turn to the headquarters when it falls, and come back to a rebuilt one.
func TestHaulersUnloadAtTheRefineryAndNeedOne(t *testing.T) {
	s := newSim(t, 1)
	refinery := own(s, 0, shared.RoleRefinery)
	if refinery == nil {
		t.Fatal("a match does not start with a refinery")
	}
	if n := len(haulersOf(s.Snapshot(0), 0)); n != rules.Match.StartHaulers {
		t.Fatalf("a match starts with %d haulers, want %d", n, rules.Match.StartHaulers)
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

	// An enemy tank squad brings the refinery down, and is then taken off the board.
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
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "crawler"}); err == nil {
		t.Fatal("a hauler was bought with no refinery standing")
	}
	if len(haulersOf(s.Snapshot(0), 0)) > 0 {
		if r, h := unloadedAt(200); r || !h {
			t.Fatalf("with the refinery gone: unloaded at its ruin %v, at the headquarters %v", r, h)
		}
	}

	// Rebuilt, it serves again and a hauler can be bought.
	for s.Gold(0) < 600 {
		s.Step()
	}
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "refinery"}); err != nil {
		t.Fatal(err)
	}
	run(s, 20)
	if own(s, 0, shared.RoleRefinery) == nil {
		t.Fatal("the refinery was not rebuilt")
	}
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "crawler"}); err != nil {
		t.Fatalf("a hauler with the refinery back: %v", err)
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
