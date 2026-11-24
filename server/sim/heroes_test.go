package sim_test

import (
	"errors"
	"math"
	"testing"

	"callsign/server/sim"
)

// The arena: open ground between Bravo and Delta on the small map, away from every
// landmark and out of reach of both bases.
const arenaX, arenaY = 450.0, 430.0

// heroSim is a match with every structure standing and gold for anything, the four
// starting squads sent out of the way to the corners they came from.
func heroSim(t *testing.T, seed uint64) *sim.Sim {
	t.Helper()
	s, err := sim.New(rules, sim.Config{Seed: seed, Factions: [2]string{"aegis", "ashfall"}, FullBase: true, StartGold: 5000})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// aside sends the starting squads to the far corner of their own base, so that they take
// no part unless a test moves them.
func aside(s *sim.Sim) {
	for _, sq := range s.Squads {
		x := 40.0
		if sq.Side == 1 {
			x = rules.Map.Width - 40
		}
		if !s.Walkable(x, 480) {
			panic("the corner the tests park squads in is not ground")
		}
		stand(sq, x, 480)
	}
}

// stand puts a squad down at a spot with the order to hold it.
func stand(sq *sim.Squad, x, y float64) {
	place(sq, x, y)
	sq.Order = sim.Order{Kind: sim.OrderHold, X: x, Y: y}
}

func contact(s *sim.Sim, side, id int) *sim.ContactView {
	for _, c := range s.Snapshot(side).Contacts {
		if c.ID == id {
			return &c
		}
	}
	return nil
}

func squadView(s *sim.Sim, side, id int) *sim.SquadView {
	for _, v := range s.Snapshot(side).Squads {
		if v.ID == id {
			return &v
		}
	}
	return nil
}

func health(sq *sim.Squad) (hp float64) {
	for i := range sq.Teams {
		hp += math.Max(0, sq.Teams[i].HP)
	}
	return hp
}

func members(sq *sim.Squad) (n int) {
	for i := range sq.Teams {
		n += sq.Teams[i].Members
	}
	return n
}

func TestAHeroNeedsItsStructuresAndThereIsOnlyOne(t *testing.T) {
	// A real opening: a barracks stands, the vehicle works does not.
	s := baseSim(t, 1)
	wealth(s, 0, 500)
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "sentinel"}, sim.ErrNeedsStructure, "build")

	s = heroSim(t, 1)
	sq := must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "sentinel"})
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "sentinel"}); !errors.Is(err, sim.ErrHeroInField) {
		t.Fatalf("a second hero while the first deploys: err = %v", err)
	}
	var all []sim.Event
	for sq.Deploying() {
		all = append(all, s.Step()...)
	}
	if !has(all, sim.EvHeroFielded, 0) || !has(all, sim.EvHeroFielded, 1) {
		t.Fatalf("both sides should hear a hero took the field: %+v", events(all, sim.EvHeroFielded, 0))
	}
	if got := s.Callsign(sq); got.En != "Ghost 1" || got.He != "רפאים 1" {
		t.Fatalf("callsign = %+v", got)
	}
	if sq.Tier != 2 || len(sq.Teams) != 1 || sq.Teams[0].Members != 1 {
		t.Fatalf("a hero is one soldier a brain tier up: tier %d, %d teams", sq.Tier, len(sq.Teams))
	}
	v := squadView(s, 0, sq.ID)
	if v == nil || v.Hero == nil || v.Hero.Charges != 2 || v.Hero.HP != 1 {
		t.Fatalf("hero view = %+v", v)
	}
	// The infantry keep their own numbers: the next rifle squad is not "Viper 4".
	next := buyFielded(t, s, 0, "commandos")
	if got := s.Callsign(next); got.En != "Viper 3" {
		t.Fatalf("a hero took a rifle squad's number: %+v", got)
	}

	// It falls: both sides hear, and another may be bought.
	sq.Teams[0].HP = 1
	militia := s.Squad(3)
	x, y := sq.Center()
	stand(militia, x+30, y)
	all = run(s, 20)
	if sq.Alive {
		t.Fatal("the hero outlived a militia squad at arm's length with one point of health")
	}
	if !has(all, sim.EvHeroFell, 0) || !has(all, sim.EvHeroFell, 1) {
		t.Fatal("both sides should hear a hero fell")
	}
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "sentinel"})
}

func TestASentinelIsSeenOnlyFromCloseUntilItFires(t *testing.T) {
	s := heroSim(t, 2)
	aside(s)
	ghost := buyFielded(t, s, 0, "sentinel")
	militia := buyFielded(t, s, 1, "militia")
	stand(militia, arenaX, arenaY)
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdHold, Squad: militia.ID, Place: "N of D 260"})
	mx, my := militia.Center()
	// Well inside the militia's sight, beyond the distance at which it is noticed. It is
	// told to move, so that it does not open fire yet.
	stand(ghost, mx-200, my)
	ghost.Teams[0].Cooldown = 10000
	run(s, 2)
	if contact(s, 1, ghost.ID) != nil {
		t.Fatal("a stealthy hero 200 away that has not fired is in the enemy's contacts")
	}
	if contact(s, 0, militia.ID) == nil {
		t.Fatal("the hero does not see the squad it is watching")
	}
	// It fires: the shot gives it away.
	ghost.Teams[0].Cooldown = 0
	run(s, 3)
	if contact(s, 1, ghost.ID) == nil {
		t.Fatal("a hero that fired is still unseen")
	}
	// Close by it is seen whether it fires or not.
	s = heroSim(t, 2)
	aside(s)
	ghost = buyFielded(t, s, 0, "sentinel")
	militia = buyFielded(t, s, 1, "militia")
	stand(militia, arenaX, arenaY)
	stand(ghost, arenaX-70, arenaY)
	ghost.Teams[0].Cooldown = 10000
	run(s, 0.3)
	if c := contact(s, 1, ghost.ID); c == nil || !c.Hero {
		t.Fatalf("a hero 70 away is not seen as a hero: %+v", c)
	}
}

// enemyStructure finds a structure of a role on the other side, as a side is shown it.
func enemyStructure(s *sim.Sim, side int, role string) *sim.StructureView {
	for _, st := range s.Snapshot(side).Structures {
		if st.Side != side && st.Role == role && !st.Ruin {
			return &st
		}
	}
	return nil
}

func TestASentinelPlantsAChargeOnAStructure(t *testing.T) {
	s := heroSim(t, 3)
	aside(s)
	ghost := buyFielded(t, s, 0, "sentinel")
	// Next to the enemy base, in sight of its barracks, wherever that was put.
	for _, st := range s.Structures {
		if st.Side == 1 && st.Def().Role == "barracks" {
			stand(ghost, st.X-110, st.Y)
		}
	}
	ghost.Teams[0].Cooldown = 100000 // it is here to plant, not to shoot
	run(s, 0.3)
	target := enemyStructure(s, 0, "barracks")
	if target == nil {
		t.Fatalf("the hero does not see the enemy barracks: %+v", s.Snapshot(0).Structures)
	}
	// A squad that is not a hero cannot; a place that is no structure or bridge is refused.
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdPlant, Squad: 1, Place: target.ID}); !errors.Is(err, sim.ErrNotHero) {
		t.Fatalf("commandos planting: err = %v", err)
	}
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdPlant, Squad: ghost.ID, Place: "F"}); !errors.Is(err, sim.ErrNoTarget) {
		t.Fatalf("planting on a point: err = %v", err)
	}
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdPlant, Squad: ghost.ID, Place: target.ID})
	ghost.Teams[0].HP = 1e6 // this test is about the charge, not about surviving the base
	before := target.HP
	var all []sim.Event
	for i := 0; i < 60*rules.TickRate && !has(all, sim.EvChargePlanted, 0); i++ {
		all = append(all, s.Step()...)
	}
	if !has(all, sim.EvChargePlanted, 0) {
		x, y := ghost.Center()
		t.Fatalf("no charge after a minute; the hero is at %.0f,%.0f alive=%v order=%+v", x, y, ghost.Alive, ghost.Order)
	}
	if n := len(s.Snapshot(0).Charges); n != 1 {
		t.Fatalf("%d charges shown to the side that set one", n)
	}
	if v := squadView(s, 0, ghost.ID); v.Hero.Charges != 1 || v.Order.Kind != sim.OrderHold {
		t.Fatalf("after planting: %+v, order %+v", v.Hero, v.Order)
	}
	all = run(s, rules.Factions["aegis"].Units["sentinel"].FuseSeconds+0.5)
	if !has(all, sim.EvChargeBlew, 0) {
		t.Fatal("the fuse ran out and nothing blew")
	}
	after := seen(s, 0, target.ID)
	if after != nil && !after.Ruin && after.HP >= before-0.5 {
		t.Fatalf("the barracks went from %.2f to %.2f of its health", before, after.HP)
	}
	if len(s.Snapshot(0).Charges) != 0 {
		t.Fatal("a charge that blew is still shown")
	}
}

func TestAChargeBringsDownABridgeAndBarelyScratchesAHeadquarters(t *testing.T) {
	s := heroSim(t, 4)
	aside(s)
	ghost := buyFielded(t, s, 0, "sentinel")
	stand(ghost, 620, 520)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdPlant, Squad: ghost.ID, Place: "bridge-west"})
	all := run(s, 20)
	if !has(all, sim.EvChargePlanted, 0) || !has(all, sim.EvChargeBlew, 0) {
		t.Fatalf("planted=%v blew=%v", has(all, sim.EvChargePlanted, 0), has(all, sim.EvChargeBlew, 0))
	}
	if bridge(s, "bridge-west").Standing {
		t.Fatal("the west bridge still stands after a charge")
	}
	// The headquarters takes a share only.
	hq := rules.HQPoint(1)
	if !s.Walkable(hq.X-200, hq.Y) {
		t.Fatal("the test puts the hero where it cannot stand")
	}
	stand(ghost, hq.X-200, hq.Y)
	stand(s.Squad(3), 800, 240) // the garrison is away: a hero under fire falls back like anyone
	stand(s.Squad(4), 800, 260)
	ghost.Teams[0].Cooldown = 100000
	ghost.Teams[0].In = "" // it had taken to a house by the bridge
	run(s, 0.3)
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdPlant, Squad: ghost.ID, Place: rules.HQPoint(0).ID}); !errors.Is(err, sim.ErrNoTarget) {
		t.Fatalf("a charge on its own headquarters: err = %v", err)
	}
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdPlant, Squad: ghost.ID, Place: hq.ID})
	ghost.Teams[0].HP = 1e6 // this test is about the charge, not about surviving the base
	all = run(s, 25)
	if !has(all, sim.EvChargeBlew, 0) || !has(all, sim.EvChargeBlew, 1) {
		x, y := ghost.Center()
		t.Fatalf("a charge on a headquarters should be heard by both sides; the hero is at %.0f,%.0f with order %+v", x, y, ghost.Order)
	}
	if left := s.Sides[1].HQHP / rules.HQ.HP; left > 0.95 || left < 0.8 {
		t.Fatalf("headquarters after one charge: %.2f of its health", left)
	}
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdPlant, Squad: ghost.ID, Place: hq.ID}); !errors.Is(err, sim.ErrNoCharges) {
		t.Fatalf("a third charge: err = %v", err)
	}
}

func TestAnOracleSeizesAVehicleSquadWhileItStaysNear(t *testing.T) {
	s := heroSim(t, 5)
	aside(s)
	tank := buyFielded(t, s, 0, "tank")
	raven := buyFielded(t, s, 1, "oracle")
	if got := s.Callsign(raven); got.En != "Raven 1" || got.He != "עורב 1" {
		t.Fatalf("callsign = %+v", got)
	}
	stand(tank, arenaX, arenaY)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: tank.ID, Place: "N of D 260"})
	run(s, 3)
	tx, ty := tank.Center()
	stand(raven, tx+200, ty)
	run(s, 0.3)
	was := s.Callsign(tank)
	// Infantry cannot be seized, and only a hero that can seize may try.
	if _, err := s.Apply(sim.Command{Side: 1, Kind: sim.CmdSeize, Squad: raven.ID, Contact: 1}); !errors.Is(err, sim.ErrNotVehicle) {
		t.Fatalf("seizing infantry: err = %v", err)
	}
	if _, err := s.Apply(sim.Command{Side: 1, Kind: sim.CmdSeize, Squad: 3, Contact: tank.ID}); !errors.Is(err, sim.ErrNotHero) {
		t.Fatalf("militia seizing: err = %v", err)
	}
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdSeize, Squad: raven.ID, Contact: tank.ID})
	hp := health(raven)
	all := run(s, 15)
	if tank.Side != 1 {
		x, y := raven.Center()
		t.Fatalf("the tank is still side %d; the oracle is at %.0f,%.0f, the tank at %.0f,%.0f, order %+v", tank.Side, x, y, tx, ty, raven.Order)
	}
	if health(raven) < hp {
		t.Fatalf("the tank shot a disguised hero that kept its distance: %.0f → %.0f", hp, health(raven))
	}
	lost, joined := events(all, sim.EvSquadLost, 0), events(all, sim.EvSquadSpawned, 1)
	if len(lost) != 1 || lost[0].Squad != tank.ID || lost[0].Reason != sim.ReasonSeized || len(joined) != 1 || joined[0].Reason != sim.ReasonSeized {
		t.Fatalf("events: lost %+v, joined %+v", lost, joined)
	}
	if got := s.Callsign(tank); got.En != "Rhino 1" {
		t.Fatalf("the seized tank answers to %+v on its new net (it was %+v)", got, was)
	}
	if squadView(s, 1, tank.ID) == nil || squadView(s, 0, tank.ID) != nil || contact(s, 0, tank.ID) == nil {
		t.Fatal("the seized tank should be the taker's squad and its old side's contact")
	}
	if v := squadView(s, 1, raven.ID); v.Hero.Seized != tank.ID {
		t.Fatalf("hero view = %+v", v.Hero)
	}
	// The new side commands it; the old one cannot.
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdMove, Squad: tank.ID, Point: "B"}); !errors.Is(err, sim.ErrNoSquad) {
		t.Fatalf("its old side ordering it: err = %v", err)
	}
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdHold, Squad: tank.ID, Place: "N of D 250"})
	// The hero walks off: beyond its reach the crew comes to its senses.
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdMove, Squad: raven.ID, Point: "K"})
	all = run(s, 30)
	if tank.Side != 0 {
		t.Fatal("the hero is far away and the tank is still seized")
	}
	back, gone := events(all, sim.EvSquadSpawned, 0), events(all, sim.EvSquadLost, 1)
	if len(back) != 1 || back[0].Reason != sim.ReasonReturned || len(gone) != 1 || gone[0].Reason != sim.ReasonReturned {
		t.Fatalf("events: back %+v, gone %+v", back, gone)
	}
	if got := s.Callsign(tank); got != was {
		t.Fatalf("the tank came back as %+v, not %+v", got, was)
	}
	if v := squadView(s, 1, raven.ID); v.Hero.Seized != 0 {
		t.Fatal("the hero still shows a squad it no longer holds")
	}
}

func TestASeizedSquadGoesBackWhenTheHeroFalls(t *testing.T) {
	s := heroSim(t, 6)
	aside(s)
	tank := buyFielded(t, s, 0, "tank")
	raven := buyFielded(t, s, 1, "oracle")
	stand(tank, arenaX, arenaY)
	stand(raven, arenaX+100, arenaY)
	run(s, 0.3)
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdSeize, Squad: raven.ID, Contact: tank.ID})
	run(s, 6)
	if tank.Side != 1 {
		t.Fatal("not seized")
	}
	raven.Teams[0].HP = 1
	stand(s.Squad(1), arenaX+130, arenaY)
	all := run(s, 20)
	if raven.Alive {
		t.Fatal("the oracle survived commandos at arm's length with one point of health")
	}
	if tank.Side != 0 || !has(all, sim.EvHeroFell, 0) || len(events(all, sim.EvSquadSpawned, 0)) != 1 {
		t.Fatalf("after the hero fell the tank is side %d", tank.Side)
	}
}

func TestADisguisedOracleIsNotShotFromAfar(t *testing.T) {
	stand := func(d float64) (lost float64) {
		s := heroSim(t, 7)
		aside(s)
		raven := buyFielded(t, s, 1, "oracle")
		stand(s.Squad(1), arenaX, arenaY)
		must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: 1, Place: "N of D 260"})
		run(s, 3)
		x, y := s.Squad(1).Center()
		stand(raven, x+d, y)
		raven.Teams[0].Cooldown = 100000
		hp := health(raven)
		run(s, 8)
		if c := contact(s, 0, raven.ID); d > 100 && (c == nil || !c.Disguised) {
			t.Fatalf("at %.0f the oracle should be a contact marked as disguised: %+v", d, c)
		}
		return hp - health(raven)
	}
	if far := stand(160); far != 0 {
		t.Fatalf("commandos shot a disguised figure 160 away for %.0f", far)
	}
	if near := stand(50); near == 0 {
		t.Fatal("commandos let a disguised hero stand 50 away")
	}
}

func TestAnOracleFrightensWhoeverIsNear(t *testing.T) {
	s := heroSim(t, 8)
	aside(s)
	raven := buyFielded(t, s, 1, "oracle")
	stand(s.Squad(1), arenaX, arenaY)
	stand(s.Squad(2), arenaX, arenaY+500)
	stand(raven, arenaX+130, arenaY)
	raven.Teams[0].Cooldown = 100000
	run(s, 30)
	near, far := s.Squad(1).Teams[0].Stress, s.Squad(2).Teams[0].Stress
	if near < rules.Nerve.ShakenAt || near >= rules.Nerve.PinnedAt || far != 0 {
		t.Fatalf("stress near the oracle %.2f (shaken at %.2f, pinned at %.2f), far from it %.2f", near, rules.Nerve.ShakenAt, rules.Nerve.PinnedAt, far)
	}
}

func digIn(t *testing.T, s *sim.Sim, sq *sim.Squad) *sim.LandmarkState {
	t.Helper()
	must(t, s, sim.Command{Side: sq.Side, Kind: sim.CmdFortify, Squad: sq.ID})
	// The time it takes with nobody shooting, and some more for a squad that is disturbed.
	var all []sim.Event
	for i := 0; i < 20*rules.TickRate && !has(all, sim.EvFortified, sq.Side); i++ {
		all = append(all, s.Step()...)
	}
	ev := events(all, sim.EvFortified, sq.Side)
	if len(ev) != 1 || ev[0].Squad != sq.ID {
		v := squadView(s, sq.Side, sq.ID)
		t.Fatalf("fortified events: %+v; the squad: order %+v dig %.2f teams %+v", ev, v.Order, v.Dig, v.Teams)
	}
	return landmark(s, ev[0].Place)
}

func TestASquadDigsInAndIsCoveredFromTheFrontOnly(t *testing.T) {
	s, _ := simOn(t, rules, "small", sim.Config{Seed: 9, Base: []string{}})
	viper := s.Squad(1)
	stand(viper, arenaX, arenaY)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: 1, Place: "N of D 260"})
	run(s, 3)
	if v := squadView(s, 0, 1); v.Dig != 0 {
		t.Fatal("digging before the order")
	}
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdFortify, Squad: 1})
	run(s, 2)
	if v := squadView(s, 0, 1); v.Dig <= 0 || v.Dig >= 1 || v.Order.Kind != sim.OrderFortify {
		t.Fatalf("two seconds in: dig %.2f, order %+v", v.Dig, v.Order)
	}
	all := run(s, rules.Match.FortifySeconds)
	ev := events(all, sim.EvFortified, 0)
	if len(ev) != 1 {
		t.Fatalf("fortified events: %+v", ev)
	}
	l := landmark(s, ev[0].Place)
	if l == nil || l.Kind != sim.Sandbags || !l.Built || l.By != 0 {
		t.Fatalf("the position: %+v", l)
	}
	if l.Name.En == "" || l.Name.He == "" || l.Near == "" {
		t.Fatalf("the position has no name: %+v", l.Landmark)
	}
	// With no enemy in sight it faces the nearest point the side does not hold: Bravo, to the north.
	if l.FaceY > -0.9 {
		t.Fatalf("faces %.2f,%.2f, not north toward Bravo", l.FaceX, l.FaceY)
	}
	if v := squadView(s, 0, 1); v.Order.Kind != sim.OrderHold || v.Order.Place != l.ID || v.Dug != 1 {
		t.Fatalf("after digging: order %+v, dug %d", v.Order, v.Dug)
	}
	// It is a place orders can name; the radio net knows it by its names (BuiltLandmarks).
	if pl, err := s.ResolvePlace(l.ID); err != nil || pl.ID != l.ID {
		t.Fatalf("%q resolves to %+v, %v", l.ID, pl, err)
	}
	if got := s.BuiltLandmarks(0); len(got) != 1 || got[0].ID != l.ID || len(s.BuiltLandmarks(1)) != 0 {
		t.Fatalf("positions known: the builder %d, the enemy %d", len(got), len(s.BuiltLandmarks(1)))
	}
	if _, err := s.Apply(sim.Command{Side: 1, Kind: sim.CmdMove, Squad: 3, Place: l.ID}); !errors.Is(err, sim.ErrNoPlace) {
		t.Fatalf("the enemy naming a position it never saw: err = %v", err)
	}
	// Cover: from the front, not from the flank or behind.
	stand(viper, l.X, l.Y)
	cover := rules.LandmarkKinds[sim.Sandbags].Cover
	if got := s.CoverOf(viper, l.X, l.Y-200); got != cover {
		t.Fatalf("cover from the front = %.2f, want %.2f", got, cover)
	}
	if got := s.CoverOf(viper, l.X+100, l.Y-200); got != cover {
		t.Fatalf("cover from inside the arc = %.2f, want %.2f", got, cover)
	}
	for _, from := range [][2]float64{{l.X + 200, l.Y}, {l.X - 200, l.Y}, {l.X, l.Y + 200}, {l.X + 200, l.Y - 60}} {
		if got := s.CoverOf(viper, from[0], from[1]); got != 1 {
			t.Fatalf("cover from %.0f,%.0f = %.2f, want none", from[0]-l.X, from[1]-l.Y, got)
		}
	}
	// The builder is shown it; the enemy is not until it sees it.
	shown := func(side int) *sim.LandmarkView {
		for _, v := range s.Snapshot(side).Landmarks {
			if v.ID == l.ID {
				return &v
			}
		}
		return nil
	}
	if v := shown(0); v == nil || !v.Built || v.X != l.X || v.Name == nil || *v.By != 0 || math.Abs(v.Face+math.Pi/2) > 0.3 {
		t.Fatalf("the builder's view: %+v", v)
	}
	if v := shown(1); v != nil {
		t.Fatalf("the enemy is shown a position it never saw: %+v", v)
	}
	stand(s.Squad(3), l.X+250, l.Y)
	run(s, 0.3)
	if v := shown(1); v == nil || v.Kind != sim.Sandbags {
		t.Fatalf("the enemy looks at the position and is not shown it: %+v", v)
	}
}

func TestSandbagsFaceTheEnemyInSightAndHaveALimit(t *testing.T) {
	s, _ := simOn(t, rules, "small", sim.Config{Seed: 10, Base: []string{}})
	viper := s.Squad(1)
	stand(viper, arenaX, arenaY)
	stand(s.Squad(3), arenaX+255, arenaY) // in sight, to the east, out of its own range
	s.Squad(3).Teams[0].Cooldown, s.Squad(3).Teams[1].Cooldown = 100000, 100000
	for i := range viper.Teams {
		viper.Teams[i].Cooldown = 100000
	}
	run(s, 0.3)
	if contact(s, 0, 3) == nil {
		t.Skip("the enemy is not in sight at this distance; the facing rule needs one that is")
	}
	l := digIn(t, s, viper)
	if l.FaceX < 0.9 {
		t.Fatalf("faces %.2f,%.2f, not east toward the enemy in sight", l.FaceX, l.FaceY)
	}
	stand(s.Squad(3), 1400, 600)
	stand(viper, arenaX, arenaY+120)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: 1, Place: "N of D 140"})
	run(s, 3)
	second := digIn(t, s, viper)
	if second.ID == l.ID {
		t.Fatal("two positions share an id")
	}
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdFortify, Squad: 1}); !errors.Is(err, sim.ErrNoSandbags) {
		t.Fatalf("a third position: err = %v", err)
	}
}

func TestOnlyInfantryDigInAndNotUnderFire(t *testing.T) {
	s := heroSim(t, 11)
	aside(s)
	tank := buyFielded(t, s, 0, "tank")
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdFortify, Squad: tank.ID}); !errors.Is(err, sim.ErrNotInfantry) {
		t.Fatalf("a tank digging in: err = %v", err)
	}
	viper := s.Squad(1)
	stand(viper, arenaX, arenaY)
	stand(s.Squad(3), arenaX+150, arenaY)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdFortify, Squad: 1})
	all := run(s, rules.Match.FortifySeconds+2)
	if has(all, sim.EvFortified, 0) && s.Squad(3).Alive {
		t.Fatal("a squad built a position while it was being shot at")
	}
}

func TestATankRunsDownInfantryInTheOpenAndNotBehindSandbags(t *testing.T) {
	crushed := func(dugIn bool) int {
		s, _ := simOn(t, rules, "small", sim.Config{Seed: 12, StartGold: 5000, Base: []string{"barracks", "works"}})
		aside(s)
		tank := buyFielded(t, s, 0, "tank")
		militia := s.Squad(3)
		stand(militia, arenaX, arenaY)
		must(t, s, sim.Command{Side: 1, Kind: sim.CmdHold, Squad: 3, Place: "N of D 260"})
		run(s, 3)
		if dugIn {
			l := digIn(t, s, militia)
			// The men stand in the position, off its middle, where the tank will pass them.
			for i := range militia.Teams {
				militia.Teams[i].X, militia.Teams[i].Y = l.X, l.Y+24
			}
		}
		mx, my := militia.Teams[0].X, militia.Teams[0].Y
		for i := range militia.Teams {
			militia.Teams[i].X, militia.Teams[i].Y = mx, my
			militia.Teams[i].Stress = 1 // pinned: they cannot step aside
			militia.Teams[i].Cooldown = 100000
		}
		// The tank drives a line that passes the men within its tracks' width.
		// One tank drives; the squad's guns stay silent, so that only its tracks can kill.
		for i := range tank.Teams {
			tank.Teams[i].Cooldown, tank.Teams[i].HP = 100000, 1e6
		}
		tank.Teams[0].X, tank.Teams[0].Y = mx-160, my+8
		must(t, s, sim.Command{Side: 0, Kind: sim.CmdMove, Squad: tank.ID, Place: "N of D 250"})
		tank.Order.X, tank.Order.Y = mx+160, my+8
		before, told := members(militia), 0
		for i := 0; i < 20*rules.TickRate; i++ {
			for i := range militia.Teams {
				militia.Teams[i].Stress = 1
			}
			told += len(events(s.Step(), sim.EvCrushed, 1))
		}
		if tx, _ := tank.Center(); tx < mx+60 {
			t.Fatalf("the tank did not drive through: it is at x=%.0f, the men at %.0f", tx, mx)
		}
		n := before - members(militia)
		if (n > 0) != (told > 0) || told > n {
			t.Fatalf("%d men run down and %d events about it", n, told)
		}
		return n
	}
	if n := crushed(false); n == 0 {
		t.Fatal("a tank drove through pinned infantry in the open and ran nobody down")
	}
	if n := crushed(true); n != 0 {
		t.Fatalf("a tank ran down %d men behind standing sandbags", n)
	}
}

func TestSteadyInfantryStepAsideAndATechnicalCrushesNobody(t *testing.T) {
	pass := func(unit string, side int, pinned bool) int {
		s, _ := simOn(t, rules, "small", sim.Config{Seed: 13, StartGold: 5000, Base: []string{"barracks", "works"}})
		aside(s)
		v := buyFielded(t, s, side, unit)
		foot := s.Squad(3)
		if side == 1 {
			foot = s.Squad(1)
		}
		stand(foot, arenaX, arenaY)
		for i := range foot.Teams {
			foot.Teams[i].X, foot.Teams[i].Y = arenaX, arenaY
			foot.Teams[i].Cooldown = 100000
		}
		for i := range v.Teams {
			v.Teams[i].Cooldown, v.Teams[i].HP = 100000, 1e6
		}
		v.Teams[0].X, v.Teams[0].Y = arenaX-160, arenaY+6
		must(t, s, sim.Command{Side: side, Kind: sim.CmdMove, Squad: v.ID, Place: "N of D 250"})
		v.Order.X, v.Order.Y = arenaX+160, arenaY+6
		before := members(foot)
		for i := 0; i < 20*rules.TickRate; i++ {
			if pinned {
				for i := range foot.Teams {
					foot.Teams[i].Stress = 1
				}
			}
			s.Step()
		}
		return before - members(foot)
	}
	if n := pass("tank", 0, false); n != 0 {
		t.Fatalf("steady infantry lost %d men under a tank they saw coming", n)
	}
	if n := pass("technical", 1, true); n != 0 {
		t.Fatalf("a light vehicle ran down %d men", n)
	}
}

func TestAVehicleFlattensSandbagsAndHeavyWeaponsKnockThemDown(t *testing.T) {
	s, _ := simOn(t, rules, "small", sim.Config{Seed: 14, StartGold: 5000, Base: []string{"barracks", "works"}})
	tank := buyFielded(t, s, 0, "tank")
	aside(s)
	militia := s.Squad(3)
	stand(militia, arenaX, arenaY)
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdHold, Squad: 3, Place: "N of D 260"})
	run(s, 3)
	l := digIn(t, s, militia)
	// Rifles do nothing to it.
	stand(s.Squad(1), l.X, l.Y-150)
	run(s, 10)
	if l.Kind != sim.Sandbags || l.HP != rules.LandmarkKinds[sim.Sandbags].HP {
		t.Fatalf("rifle fire left the position %s at %.0f", l.Kind, l.HP)
	}
	stand(s.Squad(1), 150, 600)
	// A tank's gun does.
	stand(tank, l.X, l.Y-200)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: tank.ID, Place: "N of D 450"})
	tank.Order.X, tank.Order.Y = l.X, l.Y-200
	run(s, 6)
	if l.HP >= rules.LandmarkKinds[sim.Sandbags].HP {
		t.Fatal("a tank shelled men in a position and the sandbags are untouched")
	}

	// Driving over it flattens it at once, and it stays flat.
	s, _ = simOn(t, rules, "small", sim.Config{Seed: 14, StartGold: 5000, Base: []string{"barracks", "works"}})
	aside(s)
	tank = buyFielded(t, s, 0, "tank")
	viper := s.Squad(1)
	stand(viper, arenaX, arenaY)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: 1, Place: "N of D 260"})
	run(s, 3)
	l = digIn(t, s, viper)
	tank.Teams[0].X, tank.Teams[0].Y = l.X-120, l.Y
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdMove, Squad: tank.ID, Place: "N of D 250"})
	tank.Order.X, tank.Order.Y = l.X+120, l.Y
	run(s, 15)
	if l.Kind != sim.SandbagsFlat {
		tx, ty := tank.Center()
		t.Fatalf("a tank drove over the position and it is %s (tank at %.0f,%.0f, position %.0f,%.0f)", l.Kind, tx, ty, l.X, l.Y)
	}
	if got := s.CoverOf(viper, l.X, l.Y-200); got != 1 {
		t.Fatalf("flattened sandbags still cover: %.2f", got)
	}
	if v := squadView(s, 0, 1); v.Order.Kind != sim.OrderHold {
		t.Fatalf("the squad that held it: %+v", v.Order)
	}
}

func TestASquadEarnsItsRanksByWhatItDestroys(t *testing.T) {
	s := heroSim(t, 15)
	aside(s)
	viper := s.Squad(1)
	cost := float64(rules.Factions["aegis"].Units["commandos"].Cost)
	if len(rules.Ranks) != 2 || rules.Ranks[0].Kills != 3 || rules.Ranks[1].Kills != 6 {
		t.Fatalf("ranks table: %+v", rules.Ranks)
	}
	viper.Kills = 3*cost - 1
	if all := run(s, 1); has(all, sim.EvPromoted, 0) || squadView(s, 0, 1).Rank != "" {
		t.Fatal("promoted a kill short")
	}
	if p := squadView(s, 0, 1).Kills; p < 0.9 || p >= 1 {
		t.Fatalf("progress toward the first rank = %.2f", p)
	}
	viper.Kills = 3 * cost
	all := run(s, 1)
	ev := events(all, sim.EvPromoted, 0)
	if len(ev) != 1 || ev[0].Squad != 1 || ev[0].Unit != "seasoned" || has(all, sim.EvPromoted, 1) {
		t.Fatalf("promotion events: %+v", ev)
	}
	if v := squadView(s, 0, 1); v.Rank != "seasoned" || v.Tier != 1 {
		t.Fatalf("view: rank %q tier %d", v.Rank, v.Tier)
	}
	// A bought brain is another thing: the rank stays through an upgrade.
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdUpgrade, Squad: 1})
	if v := squadView(s, 0, 1); v.Rank != "seasoned" || v.Tier != 2 {
		t.Fatalf("after an upgrade: rank %q tier %d", v.Rank, v.Tier)
	}
	viper.Kills = 6 * cost
	if all = run(s, 1); len(events(all, sim.EvPromoted, 0)) != 1 || squadView(s, 0, 1).Rank != "elite" {
		t.Fatalf("at six times its cost the squad is %q", squadView(s, 0, 1).Rank)
	}
	// Elite mends its wounds out of combat; the fallen stay fallen.
	full := viper.Teams[0].HP
	viper.Teams[0].HP = full / 2
	run(s, 40)
	if got := viper.Teams[0].HP; got <= full/2 {
		t.Fatalf("an elite squad out of combat did not mend: %.0f of %.0f", got, full)
	}
	other := s.Squad(2)
	other.Teams[0].HP /= 2
	half := other.Teams[0].HP
	run(s, 20)
	if other.Teams[0].HP != half {
		t.Fatal("a squad with no rank mended")
	}
}

func TestKillsAreCreditedToTheSquadThatMadeThem(t *testing.T) {
	s := heroSim(t, 16)
	aside(s)
	viper, militia := s.Squad(1), s.Squad(3)
	stand(viper, arenaX, arenaY)
	stand(militia, arenaX+120, arenaY)
	for i := range militia.Teams {
		militia.Teams[i].Cooldown = 100000
	}
	before := members(militia)
	run(s, 40)
	lost := before - members(militia)
	if lost == 0 {
		t.Fatal("forty seconds of fire at an idle squad killed nobody")
	}
	u := rules.Factions["ashfall"].Units["militia"]
	want := float64(u.Cost) * float64(lost) / float64(u.Teams*u.Members)
	if math.Abs(viper.Kills-want) > 0.01 || s.Squad(2).Kills != 0 {
		t.Fatalf("credited %.1f for %d men worth %.1f; the squad that was not there has %.1f", viper.Kills, lost, want, s.Squad(2).Kills)
	}
}

func TestMatchesWithHeroesAreDeterministic(t *testing.T) {
	a, ha := playMatch(t, 3, [2]string{"standard", "standard"})
	b, hb := playMatch(t, 3, [2]string{"standard", "standard"})
	if a.Hash() != b.Hash() || len(ha) != len(hb) {
		t.Fatal("two scripted matches with the same seed ended differently")
	}
	heroes := 0
	for _, sq := range a.Squads {
		if sq.Unit == "sentinel" || sq.Unit == "oracle" {
			heroes++
		}
	}
	if heroes == 0 {
		t.Fatal("no scripted player fielded a hero in a whole match")
	}
}

// A hero sent to plant keeps walking while it is shaken and shot at; pinned, it stops.
// And a hero told to hold ground does not walk into the building beside it.
func TestAHeroOnItsTaskKeepsGoingUnlessPinnedAndDoesNotGarrisonUnasked(t *testing.T) {
	walked := func(stress float64) float64 {
		s := heroSim(t, 3)
		aside(s)
		ghost := buyFielded(t, s, 0, "sentinel")
		var target *sim.Structure
		for _, st := range s.Structures {
			if st.Side == 1 && st.Def().Role == "barracks" {
				target = st
			}
		}
		stand(ghost, target.X-260, target.Y)
		run(s, 0.3)
		must(t, s, sim.Command{Side: 0, Kind: sim.CmdPlant, Squad: ghost.ID, Place: target.PlaceID()})
		x0, _ := ghost.Center()
		for i := 0; i < 3*rules.TickRate; i++ {
			ghost.Teams[0].Stress, ghost.Teams[0].HP = stress, 1e6
			s.ShotAt(ghost)
			s.Step()
		}
		x1, _ := ghost.Center()
		return x1 - x0
	}
	if d := walked((rules.Nerve.ShakenAt + rules.Nerve.PinnedAt) / 2); d < 40 {
		t.Fatalf("a shaken hero under fire went %.0f toward the structure it was sent to in three seconds", d)
	}
	if d := walked(1); d > 5 {
		t.Fatalf("a pinned hero went on %.0f", d)
	}

	s := heroSim(t, 3)
	aside(s)
	ghost := buyFielded(t, s, 0, "sentinel")
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: ghost.ID, Point: "D"})
	run(s, 60)
	if in := ghost.Teams[0].In; in != "" {
		t.Fatalf("a hero told to hold Delta went inside %s", in)
	}
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: ghost.ID, Place: "D-bunker-1"})
	run(s, 30)
	if in := ghost.Teams[0].In; in != "D-bunker-1" {
		t.Fatalf("a hero sent into the bunker is in %q", in)
	}
}
