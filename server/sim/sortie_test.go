package sim_test

import (
	"errors"
	"math"
	"testing"

	"callsign/server/sim"
	"callsign/shared"
)

// sortieOf reads a strike squad's sortie from its side's snapshot.
func sortieOf(t *testing.T, s *sim.Sim, sq *sim.Squad) sim.SortieView {
	t.Helper()
	for _, v := range s.Snapshot(sq.Side).Squads {
		if v.ID == sq.ID {
			if v.Sortie == nil {
				t.Fatalf("squad %d (%s) has no sortie", sq.ID, sq.Unit)
			}
			return *v.Sortie
		}
	}
	t.Fatalf("squad %d is not on the field", sq.ID)
	return sim.SortieView{}
}

// until steps the match until an event of a kind comes for a side, for at most so many
// seconds, and returns every event on the way.
func until(t *testing.T, s *sim.Sim, kind string, side int, seconds float64) []sim.Event {
	t.Helper()
	var all []sim.Event
	for i := 0; i < int(seconds*float64(rules.TickRate)); i++ {
		ev := s.Step()
		all = append(all, ev...)
		if has(ev, kind, side) {
			return all
		}
	}
	t.Fatalf("no %q for side %d in %.0f seconds", kind, side, seconds)
	return nil
}

// scout flies a strike squad over the enemy headquarters and home again, so that its
// side has seen the enemy's base: a structure nobody has seen cannot be named in an order.
func scout(t *testing.T, s *sim.Sim, sq *sim.Squad) {
	t.Helper()
	must(t, s, sim.Command{Side: sq.Side, Kind: sim.CmdMove, Squad: sq.ID, Point: rules.HQPoint(1 - sq.Side).ID})
	until(t, s, sim.EvOverhead, sq.Side, 30)
	for i := 0; i < 600 && sortieOf(t, s, sq).State != sim.SortieParked; i++ {
		s.Step()
	}
}

func hpOf(sq *sim.Squad) float64 {
	hp := 0.0
	for i := range sq.Teams {
		hp += sq.Teams[i].HP
	}
	return hp
}

func TestStrikeAircraftStandAtTheAirbaseUnderTheirOwnCallsign(t *testing.T) {
	s := newSim(t, 1)
	jet := buyFielded(t, s, 0, "strikeJet")
	prop := buyFielded(t, s, 1, "propBomber")
	heli := buyFielded(t, s, 0, "helicopter")
	if got := s.Callsign(jet); got.En != "Comet 1" || got.He != "שביט 1" {
		t.Fatalf("the jet's callsign = %+v", got)
	}
	if got := s.Callsign(prop); got.En != "Comet 1" || got.He != "שביט 1" {
		t.Fatalf("the bomber's callsign = %+v", got)
	}
	if got := s.Callsign(heli); got.En != "Hawk 1" {
		t.Fatalf("a jet took a helicopter's number: %+v", got)
	}
	run(s, 3)
	for _, sq := range []*sim.Squad{jet, prop} {
		base := own(s, sq.Side, shared.RoleAirbase)
		a := sortieOf(t, s, sq)
		u := rules.Factions[s.Sides[sq.Side].Faction].Units[sq.Unit]
		if a.State != sim.SortieParked || a.Bombs != u.Bombs || a.Home != base.ID || sq.Order.Kind != sim.OrderNone {
			t.Fatalf("%s out of the hangar: %+v, order %q", sq.Unit, a, sq.Order.Kind)
		}
		if x, y := sq.Center(); math.Hypot(x-base.X, y-base.Y) > 80 {
			t.Fatalf("%s stands at %.0f,%.0f, not at its airbase %.0f,%.0f", sq.Unit, x, y, base.X, base.Y)
		}
		if cost := u.Cost; cost <= rules.Factions["aegis"].Units["helicopter"].Cost {
			t.Fatalf("%s costs %d, no more than a helicopter", sq.Unit, cost)
		}
	}
}

func TestAStrikeIsOnePassThenHomeToRearm(t *testing.T) {
	s := newSim(t, 1)
	jet := buyFielded(t, s, 0, "strikeJet")
	militia := s.Squad(3) // the first Ashfall squad
	if militia == nil || militia.Side != 1 {
		t.Fatal("squad 3 is not Ashfall's")
	}
	f := rules.PointByID("F")
	place(militia, f.X, f.Y)
	before, _ := militia.Strength()
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdAttack, Squad: jet.ID, Point: "F"})
	ev := until(t, s, sim.EvStrike, 0, 20)
	if a := sortieOf(t, s, jet); a.State != sim.SortieBack || a.Bombs != 0 {
		t.Fatalf("after the drop: %+v", a)
	}
	if jet.Order.Kind != sim.OrderReturn {
		t.Fatalf("a strike on open ground is one pass; the order is now %q", jet.Order.Kind)
	}
	if n := len(s.Snapshot(0).Blasts); n != 2 {
		t.Fatalf("its side sees %d blasts, want one a plane", n)
	}
	if n := len(s.Snapshot(1).Blasts); n != 2 {
		t.Fatalf("the side that was hit sees %d blasts where its men stand", n)
	}
	run(s, 0.2)
	if after, _ := militia.Strength(); after >= before {
		t.Fatalf("four bombs on a militia cell and %d of %d men still stand", after, before)
	}
	for _, e := range ev {
		if e.Kind == sim.EvArrived && e.Squad == jet.ID {
			t.Fatal("a plane does not arrive anywhere: it reports its strike")
		}
	}
	// Home, and no flying again until it is armed.
	for i := 0; i < 200 && sortieOf(t, s, jet).State != sim.SortieRearming; i++ {
		s.Step()
	}
	base := own(s, 0, shared.RoleAirbase)
	if x, y := jet.Center(); sortieOf(t, s, jet).State != sim.SortieRearming || math.Hypot(x-base.X, y-base.Y) > 80 {
		t.Fatalf("the jet did not come home: %+v at %.0f,%.0f", sortieOf(t, s, jet), x, y)
	}
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdAttack, Squad: jet.ID, Point: "F"})
	run(s, 2)
	if a := sortieOf(t, s, jet); a.State != sim.SortieRearming {
		t.Fatalf("an unarmed jet took off: %+v", a)
	}
	rearm := rules.Factions["aegis"].Units["strikeJet"].RearmSeconds
	until(t, s, sim.EvRearmed, 0, rearm+1)
	run(s, 0.3)
	if a := sortieOf(t, s, jet); a.State != sim.SortieOut || a.Bombs != 2 {
		t.Fatalf("armed again with a target waiting, the jet is %+v", a)
	}
}

func TestAStrikeOnAStructureIsFlownUntilItFalls(t *testing.T) {
	s := newSim(t, 1)
	prop := buyFielded(t, s, 1, "propBomber")
	target := own(s, 0, shared.RoleRadar)
	if _, err := s.Apply(sim.Command{Side: 1, Kind: sim.CmdAttack, Squad: prop.ID, Place: target.ID}); !errors.Is(err, sim.ErrNoPlace) {
		t.Fatalf("a strike on a structure nobody has seen: %v", err)
	}
	scout(t, s, prop)
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdAttack, Squad: prop.ID, Place: target.ID})
	until(t, s, sim.EvStrike, 1, 30)
	run(s, 0.2)
	if now := seen(s, 0, target.ID); now.HP >= 1 {
		t.Fatal("three bombs on a radar and it is whole")
	}
	if prop.Order.Kind != sim.OrderAttack {
		t.Fatalf("the radar still stands, and the order is %q", prop.Order.Kind)
	}
	strikes := 1
	for i := 0; i < 3000 && !seen(s, 0, target.ID).Ruin; i++ {
		if has(s.Step(), sim.EvStrike, 1) {
			strikes++
		}
	}
	if !seen(s, 0, target.ID).Ruin || strikes < 2 {
		t.Fatalf("the radar did not fall to repeated sorties (%d strikes)", strikes)
	}
	run(s, 40)
	if a := sortieOf(t, s, prop); a.State != sim.SortieParked || prop.Order.Kind != sim.OrderNone {
		t.Fatalf("with its target gone the bomber should be home and armed: %+v, order %q", a, prop.Order.Kind)
	}
}

func TestWhatAStrikeAircraftRefuses(t *testing.T) {
	s := newSim(t, 1)
	jet := buyFielded(t, s, 0, "strikeJet")
	drones := buyFielded(t, s, 1, "fpvSwarm")
	a := rules.PointByID("A")
	place(drones, a.X+60, a.Y)
	run(s, 0.5)
	for _, c := range []struct {
		cmd  sim.Command
		want error
	}{
		{sim.Command{Kind: sim.CmdHold, Point: "F"}, sim.ErrNoLoiter},
		{sim.Command{Kind: sim.CmdRepair, Place: "bridge-west"}, sim.ErrNoRepair},
		{sim.Command{Kind: sim.CmdCapture, Place: "Z"}, sim.ErrNotEngineers},
		{sim.Command{Kind: sim.CmdFortify}, sim.ErrNotInfantry},
		{sim.Command{Kind: sim.CmdAttack, Contact: drones.ID}, sim.ErrNoBombTarget},
		{sim.Command{Kind: sim.CmdAttack, Place: own(s, 0, shared.RoleRadar).ID}, sim.ErrNoPlace},
		{sim.Command{Kind: sim.CmdAttack}, sim.ErrNoPlace},
	} {
		c.cmd.Side, c.cmd.Squad = 0, jet.ID
		if _, err := s.Apply(c.cmd); !errors.Is(err, c.want) {
			t.Errorf("%s %s%s: %v, want %v", c.cmd.Kind, c.cmd.Point, c.cmd.Place, err, c.want)
		}
	}
	if jet.Order.Kind != sim.OrderNone || sortieOf(t, s, jet).State != sim.SortieParked {
		t.Fatal("a refused order moved the jet")
	}
}

func TestAMoveIsAFlightOverAndBackWithNothingDropped(t *testing.T) {
	s := newSim(t, 1)
	jet := buyFielded(t, s, 0, "strikeJet")
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdMove, Squad: jet.ID, Point: "H"})
	h := rules.PointByID("H")
	seen := false
	for i := 0; i < 300 && !seen; i++ {
		for _, e := range s.Step() {
			seen = seen || (e.Kind == sim.EvOverhead && e.Squad == jet.ID)
		}
	}
	if x, y := jet.Center(); !seen || math.Hypot(x-h.X, y-h.Y) > 40 {
		t.Fatalf("the jet never flew over Hotel (at %.0f,%.0f)", x, y)
	}
	if !s.Explored(0, h.X, h.Y) {
		t.Fatal("a flight over Hotel showed its side nothing of it")
	}
	run(s, 30)
	if a := sortieOf(t, s, jet); a.State != sim.SortieParked || a.Bombs != 2 || len(s.Snapshot(sim.Spectator).Blasts) != 0 {
		t.Fatalf("after a flight to look, the jet should be home with its bombs: %+v", a)
	}
	if owner(s, "H") != sim.NoSide {
		t.Fatal("an aircraft took a point")
	}
	// Sent home in the air, it turns back; "hold" with no place is the same order.
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdAttack, Squad: jet.ID, Point: "Z"})
	run(s, 2)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: jet.ID})
	run(s, 0.2)
	if a := sortieOf(t, s, jet); a.State != sim.SortieBack || jet.Order.Kind != sim.OrderReturn {
		t.Fatalf("recalled, the jet is %+v under order %q", a, jet.Order.Kind)
	}
	run(s, 20)
	if a := sortieOf(t, s, jet); a.State != sim.SortieParked || a.Bombs != 2 || s.Sides[1].HQHP != rules.HQ.HP {
		t.Fatalf("recalled before the drop, the jet should stand armed and Zulu unhurt: %+v", a)
	}
}

func TestAStrikeSquadIsLostWithItsAirbase(t *testing.T) {
	// On the ground: gone with the base.
	s := newSim(t, 1)
	jet := buyFielded(t, s, 0, "strikeJet")
	base := own(s, 0, shared.RoleAirbase)
	run(s, 1)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdSell, Place: base.ID})
	ev := run(s, 0.3)
	lost := false
	for _, e := range ev {
		lost = lost || (e.Kind == sim.EvSquadLost && e.Squad == jet.ID && e.Reason == sim.ReasonNoAirbase)
	}
	if !lost || jet.Alive {
		t.Fatal("the airbase is gone and the jet parked on it is not")
	}

	// In the air: it finishes its pass, and is lost when it turns for home.
	s = newSim(t, 1)
	jet = buyFielded(t, s, 0, "strikeJet")
	base = own(s, 0, shared.RoleAirbase)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdAttack, Squad: jet.ID, Point: "Z"})
	run(s, 2)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdSell, Place: base.ID})
	run(s, 0.3)
	if !jet.Alive {
		t.Fatal("a jet on its way to the target fell out of the sky with its base")
	}
	until(t, s, sim.EvStrike, 0, 20)
	run(s, 0.3)
	if jet.Alive || s.Sides[1].HQHP >= rules.HQ.HP {
		t.Fatalf("after its last pass the jet has nowhere to land (alive %v, Zulu at %.0f)", jet.Alive, s.Sides[1].HQHP)
	}
}

func TestAStrikeSquadTakesAnotherAirbaseWhenItsOwnFalls(t *testing.T) {
	s := newSim(t, 1)
	jet := buyFielded(t, s, 0, "strikeJet")
	first := own(s, 0, shared.RoleAirbase)
	cost := rules.Factions["aegis"].Structures["airbase"]
	wealth(s, 0, cost.Cost)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "airbase"})
	run(s, cost.BuildSeconds+2)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdSell, Place: first.ID})
	run(s, 25)
	a := sortieOf(t, s, jet)
	if !jet.Alive || a.Home == first.ID || a.Home == "" || a.State != sim.SortieParked {
		t.Fatalf("with a second airbase standing the jet should have moved to it: alive %v, %+v", jet.Alive, a)
	}
}

func TestFlakAndAntiAirWeaponsEngageStrikeAircraft(t *testing.T) {
	// A flak battery by the target: the bombers fly through its fire.
	s := newSim(t, 1)
	prop := buyFielded(t, s, 1, "propBomber")
	flak := rules.Factions["aegis"].Structures["flakBattery"]
	wealth(s, 0, flak.Cost)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "flakBattery", Place: "base:front"})
	run(s, flak.BuildSeconds+1)
	full := hpOf(prop)
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdAttack, Squad: prop.ID, Point: "A"})
	for i := 0; i < 1200 && prop.Alive && hpOf(prop) == full; i++ {
		s.Step()
	}
	if hpOf(prop) == full {
		t.Fatal("bombers flew sorties past a flak battery and it never hit one")
	}

	// And every unit that can shoot at aircraft shoots at these.
	for shooterSide, unit := range map[int]string{0: "commandos", 1: "militia"} {
		s := newSim(t, 2)
		plane := buyFielded(t, s, 1-shooterSide, map[int]string{0: "strikeJet", 1: "propBomber"}[1-shooterSide])
		shooter := buyFielded(t, s, shooterSide, unit)
		g := rules.PointByID("G")
		place(shooter, g.X, g.Y)
		must(t, s, sim.Command{Side: shooterSide, Kind: sim.CmdHold, Squad: shooter.ID})
		full := hpOf(plane)
		for i := 0; i < 8 && hpOf(plane) == full && plane.Alive; i++ {
			must(t, s, sim.Command{Side: 1 - shooterSide, Kind: sim.CmdMove, Squad: plane.ID, Point: "G"})
			run(s, 30)
		}
		if hpOf(plane) == full {
			t.Fatalf("%s never hit a %s flying over them", unit, plane.Unit)
		}
	}
	for _, f := range []string{"aegis", "ashfall"} {
		for id, u := range rules.Factions[f].Units {
			if u.Strike() && (u.Class != "air" || u.Against("air") != 0) {
				t.Fatalf("%s must be an air target that cannot fight in the air", id)
			}
		}
	}
}

func TestSortiesAreTheSameEveryTime(t *testing.T) {
	play := func() uint64 {
		s := newSim(t, 7)
		jet := buyFielded(t, s, 0, "strikeJet")
		prop := buyFielded(t, s, 1, "propBomber")
		must(t, s, sim.Command{Side: 0, Kind: sim.CmdAttack, Squad: jet.ID, Point: "Z"})
		must(t, s, sim.Command{Side: 1, Kind: sim.CmdAttack, Squad: prop.ID, Point: "A"})
		run(s, 90)
		return s.Hash()
	}
	if a, b := play(), play(); a != b {
		t.Fatal("the same sorties came out two ways")
	}
}

func TestTheTwoStrikeAircraftAreAFairMatch(t *testing.T) {
	jet, prop := rules.Factions["aegis"].Units["strikeJet"], rules.Factions["ashfall"].Units["propBomber"]
	load := func(u shared.Unit) float64 { return u.Damage * float64(u.Bombs*u.Teams*u.Members) }
	if a, b := load(jet), load(prop); math.Abs(a-b) > 0.05*a {
		t.Fatalf("a sortie drops %.0f against %.0f", a, b)
	}
	// What one gold buys of bombs dropped per minute over a 1000 m round trip, and of health.
	rate := func(u shared.Unit) float64 { return load(u) / (2000/u.Speed + u.RearmSeconds) / float64(u.Cost) }
	body := func(u shared.Unit) float64 {
		// For the time a pass keeps it under a gun: the slower one is shot at longer.
		return u.HP / (1 - u.Armor) / (1 - u.Evade) * float64(u.Teams*u.Members) / float64(u.Cost) * u.Speed
	}
	if a, b := rate(jet), rate(prop); a/b > 1.15 || b/a > 1.15 {
		t.Fatalf("bombs for gold: %.4f against %.4f", a, b)
	}
	if a, b := body(jet), body(prop); a/b > 1.15 || b/a > 1.15 {
		t.Fatalf("health for gold under fire: %.1f against %.1f", a, b)
	}
}

func TestAStrikeThatDestroysItsTargetStillSpendsItsBombs(t *testing.T) {
	// The planes of a squad reach their target a step apart. A target that falls to the
	// first bombs must not leave the squad with its load and no strike to report.
	s := newSim(t, 1)
	jet := buyFielded(t, s, 0, "strikeJet")
	nest := rules.Factions["ashfall"].Structures["gunNest"]
	wealth(s, 1, nest.Cost)
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdBuild, Structure: "gunNest", Place: "base:front"})
	run(s, nest.BuildSeconds+1)
	scout(t, s, jet)
	gun := seen(s, 0, own(s, 1, shared.RoleDefence).ID)
	if gun == nil || !jet.Alive {
		t.Fatalf("the flight over Zulu did not show the gun nest (jet alive %v)", jet.Alive)
	}
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdAttack, Squad: jet.ID, Place: gun.ID})
	ev := until(t, s, sim.EvStrike, 0, 30)
	run(s, 0.3)
	if now := seen(s, 1, gun.ID); !now.Ruin {
		t.Fatalf("four bombs on a gun nest left it at %.2f", now.HP)
	}
	var strike sim.Event
	for _, e := range ev {
		if e.Kind == sim.EvStrike {
			strike = e
		}
	}
	if strike.Structure != gun.ID || strike.Count != 4 {
		t.Fatalf("the strike was reported as %+v", strike)
	}
	if a := sortieOf(t, s, jet); a.Bombs != 0 || a.State != sim.SortieBack || jet.Order.Kind != sim.OrderReturn {
		t.Fatalf("its target gone, the jet should be flying home empty: %+v, order %q", a, jet.Order.Kind)
	}
	until(t, s, sim.EvRearmed, 0, 60)
}

func TestAStrikeBringsDownABridgeAndThenStops(t *testing.T) {
	s := newSim(t, 1)
	jet := buyFielded(t, s, 0, "strikeJet")
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdAttack, Squad: jet.ID, Place: "bridge-west"})
	strikes, fell := 0, false
	for i := 0; i < 3000 && !fell; i++ {
		for _, e := range s.Step() {
			if e.Kind == sim.EvStrike && e.Side == 0 {
				strikes++
				if e.Place != "bridge-west" {
					t.Fatalf("the strike was reported on %q", e.Place)
				}
			}
			fell = fell || (e.Kind == sim.EvBridgeFell && e.Place == "bridge-west")
		}
	}
	if !fell || strikes < 2 {
		t.Fatalf("the west bridge should fall to a second sortie (fell %v after %d strikes)", fell, strikes)
	}
	run(s, 40)
	if a := sortieOf(t, s, jet); a.State != sim.SortieParked || jet.Order.Kind != sim.OrderNone {
		t.Fatalf("the bridge is down and the jet is %+v under order %q", a, jet.Order.Kind)
	}
	// The other bridges were never the target, and stand untouched.
	for _, b := range s.Snapshot(sim.Spectator).Bridges {
		if b.ID != "bridge-west" && (!b.Standing || b.HP < 1) {
			t.Fatalf("%s was hit: %+v", b.ID, b)
		}
	}
}
