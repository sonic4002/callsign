package sim_test

import (
	"errors"
	"math"
	"testing"

	"callsign/server/sim"
	"callsign/shared"
)

func salvoOf(t *testing.T, s *sim.Sim, sq *sim.Squad) sim.SalvoView {
	t.Helper()
	for _, v := range s.Snapshot(sq.Side).Squads {
		if v.ID == sq.ID {
			if v.Salvo == nil {
				t.Fatalf("squad %d (%s) has no salvo", sq.ID, sq.Unit)
			}
			return *v.Salvo
		}
	}
	t.Fatalf("squad %d is not on the field", sq.ID)
	return sim.SalvoView{}
}

// An airbase holds four planes. A squad's planes each take a pad; with the pads taken
// the next squad is refused until another airbase stands, and is then made there.
func TestAnAirbaseHoldsFourPlanes(t *testing.T) {
	s := newSim(t, 1)
	base := own(s, 0, shared.RoleAirbase)
	def := rules.Factions["aegis"].Structures["airbase"]
	if def.Planes != 4 {
		t.Fatalf("the airbase holds %d planes, want 4", def.Planes)
	}
	first := buyFielded(t, s, 0, "strikeJet")
	second := buyFielded(t, s, 0, "strikeJet")
	// Four planes, each on a pad of its own.
	seen := map[[2]float64]bool{}
	for _, sq := range []*sim.Squad{first, second} {
		if home := sortieOf(t, s, sq).Home; home != base.ID {
			t.Fatalf("squad %d stands at %q, want %q", sq.ID, home, base.ID)
		}
		for i := range sq.Teams {
			at := [2]float64{sq.Teams[i].X, sq.Teams[i].Y}
			if seen[at] {
				t.Fatalf("two planes stand on the same pad at %v", at)
			}
			seen[at] = true
			if d := math.Hypot(at[0]-base.X, at[1]-base.Y); d > def.Footprint+1 {
				t.Errorf("a plane stands %.0f from its airbase, off its ground (%.0f)", d, def.Footprint)
			}
		}
	}
	if len(seen) != 4 {
		t.Fatalf("%d planes stand at the airbase, want 4", len(seen))
	}
	wealth(s, 0, 500)
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "strikeJet"}); !errors.Is(err, sim.ErrAirbaseFull) {
		t.Fatalf("a fifth plane at a full airbase: %v, want ErrAirbaseFull", err)
	}
	// A helicopter takes no pad.
	buyFielded(t, s, 0, "helicopter")
	// A second airbase has room again, and the new squad is its own.
	wealth(s, 0, def.Cost)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "airbase"})
	run(s, def.BuildSeconds+2)
	third := buyFielded(t, s, 0, "strikeJet")
	if home := sortieOf(t, s, third).Home; home == base.ID || home == "" {
		t.Fatalf("the third squad stands at %q, want the new airbase", home)
	}
	// Planes whose airbase falls are taken in by another over its number, not lost; they
	// stand behind its pads, and it makes no new ones while it is over.
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdSell, Place: sortieOf(t, s, third).Home})
	run(s, 25)
	if a := sortieOf(t, s, third); !third.Alive || a.Home != base.ID || a.State != sim.SortieParked {
		t.Fatalf("the squad whose airbase was sold: alive %v, %+v, want parked at %s", third.Alive, a, base.ID)
	}
	for _, sq := range []*sim.Squad{first, second} {
		for i := range sq.Teams {
			for j := range third.Teams {
				if sq.Teams[i].X == third.Teams[j].X && sq.Teams[i].Y == third.Teams[j].Y {
					t.Fatalf("a plane taken in stands on another's pad at %.0f, %.0f", sq.Teams[i].X, sq.Teams[i].Y)
				}
			}
		}
	}
	wealth(s, 0, 500)
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "strikeJet"}); !errors.Is(err, sim.ErrAirbaseFull) {
		t.Fatalf("a plane bought at an airbase over its number: %v, want ErrAirbaseFull", err)
	}
	// Ashfall's squad of three fills its yard: a second squad does not fit beside it.
	buyFielded(t, s, 1, "propBomber")
	wealth(s, 1, 450)
	if _, err := s.Apply(sim.Command{Side: 1, Kind: sim.CmdBuy, Unit: "propBomber"}); !errors.Is(err, sim.ErrAirbaseFull) {
		t.Fatalf("a second squad of three at a yard of four: %v, want ErrAirbaseFull", err)
	}
}

// The honeycomb salvo: the helicopters fly to within range, every one empties its pods,
// the missiles come down scattered around the place and hurt what is under them, and
// the pods then take three minutes to load.
func TestAHelicopterFiresItsSalvoAndReloadsForThreeMinutes(t *testing.T) {
	s := newSim(t, 1)
	heli := buyFielded(t, s, 0, "helicopter")
	sv := rules.Factions["aegis"].Units["helicopter"].Salvo
	if sv == nil || sv.ReloadSeconds != 180 {
		t.Fatalf("the helicopter's salvo = %+v, want one that reloads in 180 seconds", sv)
	}
	if got := salvoOf(t, s, heli); got.Ready != 1 || got.Wait != 0 {
		t.Fatalf("a new squad's pods = %+v, want loaded", got)
	}
	// Enemy soldiers standing in the open at a point well away from both bases.
	enemy := buyFielded(t, s, 1, "militia")
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdHold, Squad: enemy.ID, Point: "F"})
	for i := 0; i < 1200 && dist2(enemy, "F") > 40; i++ {
		s.Step()
	}
	before := hpOf(enemy)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdSalvo, Squad: heli.ID, Point: "F"})
	ev := until(t, s, sim.EvSalvo, 0, 120)
	var fired sim.Event
	for _, e := range ev {
		if e.Kind == sim.EvSalvo {
			fired = e
		}
	}
	if want := sv.Missiles * 2; fired.Count != want || fired.Point != "F" {
		t.Fatalf("the salvo event = %+v, want %d missiles at F", fired, want)
	}
	f := rules.PointByID("F")
	cx, cy := heli.Center()
	if d := math.Hypot(cx-f.X, cy-f.Y); d > sv.Range+1 || d < sv.Range-60 {
		t.Errorf("the squad fired from %.0f away, want just inside its range of %.0f", d, sv.Range)
	}
	if heli.Order.Kind != sim.OrderHold {
		t.Errorf("after firing the squad's order is %q, want hold", heli.Order.Kind)
	}
	// In flight they are in the snapshot, each bound for ground around the place.
	inFlight := 0
	for i := 0; i < 5*rules.TickRate; i++ {
		for _, r := range s.Snapshot(0).Rockets {
			if d := math.Hypot(r.X-f.X, r.Y-f.Y); d > sv.Spread+0.2 {
				t.Fatalf("a missile is bound for %.0f from the place, past the spread of %.0f", d, sv.Spread)
			}
			inFlight++
		}
		s.Step()
	}
	if inFlight == 0 {
		t.Fatal("no missile was ever seen in flight")
	}
	if n := len(s.Snapshot(0).Rockets); n != 0 {
		t.Fatalf("%d missiles still in flight five seconds on", n)
	}
	if after := hpOf(enemy); after >= before {
		t.Errorf("the enemy under the salvo lost nothing (%.0f → %.0f)", before, after)
	}
	// Loading: refused until three minutes have gone, and said when it is done.
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdSalvo, Squad: heli.ID, Point: "F"}); !errors.Is(err, sim.ErrSalvoLoading) {
		t.Fatalf("a second salvo at once: %v, want ErrSalvoLoading", err)
	}
	if got := salvoOf(t, s, heli); got.Ready >= 0.1 || got.Wait < 170 || got.Wait > 180 {
		t.Fatalf("just after firing the pods = %+v", got)
	}
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdMove, Squad: heli.ID, Point: "A"}) // out of harm's way
	run(s, 170)
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdSalvo, Squad: heli.ID, Point: "F"}); !errors.Is(err, sim.ErrSalvoLoading) {
		t.Fatalf("a salvo ten seconds early: %v, want ErrSalvoLoading", err)
	}
	if !has(run(s, 12), sim.EvSalvoLoaded, 0) {
		t.Fatal("nothing said the pods were loaded again")
	}
	if heli.Alive {
		must(t, s, sim.Command{Side: 0, Kind: sim.CmdSalvo, Squad: heli.ID, Point: "F"})
	}
}

func TestOnlyAUnitWithASalvoFiresOne(t *testing.T) {
	s := newSim(t, 1)
	tank := buyFielded(t, s, 0, "tank")
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdSalvo, Squad: tank.ID, Point: "F"}); !errors.Is(err, sim.ErrNoSalvo) {
		t.Fatalf("a tank's salvo: %v, want ErrNoSalvo", err)
	}
	heli := buyFielded(t, s, 0, "helicopter")
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdSalvo, Squad: heli.ID}); !errors.Is(err, sim.ErrNoPoint) {
		t.Fatalf("a salvo at nowhere: %v, want ErrNoPoint", err)
	}
	if _, err := s.Apply(sim.Command{Side: 1, Kind: sim.CmdSalvo, Squad: heli.ID, Point: "F"}); !errors.Is(err, sim.ErrNoSquad) {
		t.Fatalf("the other side's salvo: %v, want ErrNoSquad", err)
	}
}

// The same seed and the same orders give the same salvo, missile for missile.
func TestSalvosAreTheSameEveryTime(t *testing.T) {
	play := func() uint64 {
		s := newSim(t, 7)
		heli := buyFielded(t, s, 0, "helicopter")
		must(t, s, sim.Command{Side: 0, Kind: sim.CmdSalvo, Squad: heli.ID, Place: "N40 E60 of F"})
		run(s, 60)
		return s.Hash()
	}
	if a, b := play(), play(); a != b {
		t.Fatalf("two runs of one salvo differ: %x and %x", a, b)
	}
}

func dist2(sq *sim.Squad, point string) float64 {
	p := rules.PointByID(point)
	x, y := sq.Center()
	return math.Hypot(x-p.X, y-p.Y)
}
