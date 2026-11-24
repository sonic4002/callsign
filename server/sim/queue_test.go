package sim_test

import (
	"errors"
	"math"
	"testing"

	"callsign/server/sim"
	"callsign/shared"
)

func deploying(s *sim.Sim, side int) []sim.DeployView {
	var out []sim.DeployView
	for _, d := range s.Snapshot(side).Deploying {
		if d.Side == side {
			out = append(out, d)
		}
	}
	return out
}

// spawnTicks plays on and returns the tick each of the squads reached the field.
func spawnTicks(s *sim.Sim, seconds float64, squads ...*sim.Squad) map[int]int {
	at := map[int]int{}
	for i := 0; i < int(seconds*float64(rules.TickRate)); i++ {
		for _, e := range s.Step() {
			if e.Kind == sim.EvSquadSpawned {
				at[e.Squad] = s.Tick
			}
		}
	}
	return at
}

func TestAStructureMakesOneUnitAtATime(t *testing.T) {
	s := baseSim(t, 1)
	wealth(s, 0, 600)
	u := rules.Factions["aegis"].Units["commandos"]
	ticks := int(math.Round(u.DeploySeconds * float64(rules.TickRate)))
	start := s.Tick
	var squads []*sim.Squad
	for i := 0; i < 3; i++ {
		squads = append(squads, must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "commandos"}))
	}
	line := deploying(s, 0)
	barracks := own(s, 0, shared.RoleBarracks)
	if len(line) != 3 {
		t.Fatalf("%d in line, want 3", len(line))
	}
	for i, d := range line {
		if d.From != barracks.ID || d.Line != i || d.TicksAhead != i*ticks || d.TicksLeft != ticks {
			t.Fatalf("line[%d] = %+v, want from %s, place %d, %d ticks ahead", i, d, barracks.ID, i, i*ticks)
		}
	}
	at := spawnTicks(s, 3*u.DeploySeconds+1)
	for i, sq := range squads {
		if got, want := at[sq.ID]-start, (i+1)*ticks; got != want {
			t.Fatalf("squad %d came out after %d ticks, want %d", i+1, got, want)
		}
	}
}

func TestASecondStructureAddsASecondLine(t *testing.T) {
	s := baseSim(t, 1)
	wealth(s, 0, 1200)
	second, err := s.Build(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "barracks"})
	if err != nil {
		t.Fatal(err)
	}
	run(s, second.Def().BuildSeconds+1)
	u := rules.Factions["aegis"].Units["commandos"]
	ticks := int(math.Round(u.DeploySeconds * float64(rules.TickRate)))
	start := s.Tick
	a := must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "commandos"})
	b := must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "commandos"})
	if a.From == b.From {
		t.Fatalf("both squads wait at structure %d: the second barracks made no second line", a.From)
	}
	at := spawnTicks(s, u.DeploySeconds+1)
	if at[a.ID]-start != ticks || at[b.ID]-start != ticks {
		t.Fatalf("two lines came out after %d and %d ticks, want %d each", at[a.ID]-start, at[b.ID]-start, ticks)
	}
}

func TestTheLineHasALimitAndCanBeCutShort(t *testing.T) {
	s := baseSim(t, 1)
	wealth(s, 0, 2000)
	u := rules.Factions["aegis"].Units["commandos"]
	var squads []*sim.Squad
	for i := 0; i < rules.Match.QueueLimit; i++ {
		squads = append(squads, must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "commandos"}))
	}
	gold := s.Gold(0)
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "commandos"}); !errors.Is(err, sim.ErrLineFull) {
		t.Fatalf("one more than the line holds: err = %v", err)
	}
	if s.Gold(0) != gold {
		t.Fatal("a refused purchase was paid for")
	}
	// Cancelling takes the last one out and gives all its gold back: it had not begun.
	last := squads[len(squads)-1]
	got := must(t, s, sim.Command{Side: 0, Kind: sim.CmdCancel, Unit: "commandos"})
	if got.ID != last.ID || s.Gold(0) != gold+u.Cost || last.Deploying() {
		t.Fatalf("cancel took squad %d and gave back %d, want squad %d and %d", got.ID, s.Gold(0)-gold, last.ID, u.Cost)
	}
	// The next one bought takes the callsign number that was given back.
	again := must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "commandos"})
	if again.Num != last.Num {
		t.Fatalf("the next squad is number %d, want the freed %d", again.Num, last.Num)
	}
	// The one being made gives back only what is not built yet.
	for i := 0; i < rules.Match.QueueLimit-1; i++ {
		must(t, s, sim.Command{Side: 0, Kind: sim.CmdCancel})
	}
	run(s, u.DeploySeconds/2)
	gold = s.Gold(0)
	events := []sim.Event{}
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdCancel}); err != nil {
		t.Fatal(err)
	}
	events = append(events, s.Step()...)
	refund := s.Gold(0) - gold
	if refund <= 0 || refund >= u.Cost || !has(events, sim.EvDeployCancelled, 0) {
		t.Fatalf("cancelling a half-made squad gave back %d of %d (event %v)", refund, u.Cost, has(events, sim.EvDeployCancelled, 0))
	}
	if len(deploying(s, 0)) != 0 || s.Population(0) != 2 {
		t.Fatalf("after cancelling everything: %d in line, population %d", len(deploying(s, 0)), s.Population(0))
	}
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdCancel}); !errors.Is(err, sim.ErrNothingDue) {
		t.Fatalf("cancel with an empty line: err = %v", err)
	}
}

func TestALineIsLostWithItsStructure(t *testing.T) {
	s := baseSim(t, 1)
	wealth(s, 0, 600)
	a := must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "commandos"})
	b := must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "commandos"})
	gold := s.Gold(0)
	byID(s, own(s, 0, shared.RoleBarracks).ID).Ruin = true
	events := run(s, 1)
	lost := 0
	for _, e := range events {
		if e.Kind == sim.EvDeployLost && e.Side == 0 && (e.Squad == a.ID || e.Squad == b.ID) {
			lost++
		}
	}
	if lost != 2 || a.Deploying() || b.Deploying() || a.Alive || b.Alive {
		t.Fatalf("%d of the 2 squads in line were lost with the barracks", lost)
	}
	if s.Population(0) != 2 || s.Gold(0) < gold || s.Gold(0) > gold+2*rules.Match.HQTrickle {
		t.Fatalf("after the loss: population %d, gold %d → %d (nothing is given back)", s.Population(0), gold, s.Gold(0))
	}
	for _, e := range events {
		if e.Kind == sim.EvSquadSpawned && (e.Squad == a.ID || e.Squad == b.ID) {
			t.Fatal("a lost squad was announced on the net")
		}
	}
}

func TestUnitsComeOutOfTheirStructureAndGather(t *testing.T) {
	s := newSim(t, 1) // every base structure stands
	wealth(s, 0, 2000)
	hq := rules.HQPoint(0)
	for unit, role := range map[string]string{"commandos": shared.RoleBarracks, "tank": shared.RoleWorks, "helicopter": shared.RoleAirbase, "patrolBoat": shared.RoleDockyard} {
		wealth(s, 0, 500)
		st := own(s, 0, role)
		sq := must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: unit})
		var events []sim.Event
		for sq.Deploying() {
			events = append(events, s.Step()...)
		}
		x, y := sq.Center()
		def := structureDef("aegis", st.Kind)
		if d := math.Hypot(x-st.X, y-st.Y); d > def.Footprint+rules.Map.Cell*2 {
			t.Fatalf("%s appeared %v from the %s that made it (headquarters is %v away)", unit, d, def.Name.En, math.Hypot(x-hq.X, y-hq.Y))
		}
		switch unit {
		case "helicopter":
			if math.Hypot(x-st.X, y-st.Y) > 15 { // it has flown one tick already
				t.Fatalf("the helicopter lifts off the pad, not from (%v, %v)", x, y)
			}
		case "patrolBoat":
			if !s.Sailable(x, y) {
				t.Fatal("the boat came out on dry land")
			}
		default:
			if !s.Walkable(x, y) {
				t.Fatalf("%s came out where it cannot stand", unit)
			}
		}
		// It walks to its place beside the structure and then awaits orders, without a report.
		events = append(events, run(s, 12)...)
		gx, gy := sq.Center()
		if sq.Order.Kind != sim.OrderNone {
			t.Fatalf("%s still has order %q after gathering", unit, sq.Order.Kind)
		}
		if d := math.Hypot(gx-x, gy-y); d < 15 || math.Hypot(gx-st.X, gy-st.Y) > 260 {
			t.Fatalf("%s gathered %v from the door, %v from the structure", unit, d, math.Hypot(gx-st.X, gy-st.Y))
		}
		for _, e := range events {
			if e.Kind == sim.EvArrived && e.Squad == sq.ID {
				t.Fatalf("%s reported arriving at its own door", unit)
			}
		}
	}
}

func TestARefineryBringsItsHaulerOutOfItsOwnBay(t *testing.T) {
	s, err := sim.New(rules, sim.Config{Seed: 1, Factions: [2]string{"aegis", "ashfall"}})
	if err != nil {
		t.Fatal(err)
	}
	st, err := s.Build(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "refinery"})
	if err != nil {
		t.Fatal(err)
	}
	for !st.Standing() {
		s.Step()
	}
	h := haulersOf(s.Snapshot(0), 0)
	if len(h) != 1 {
		t.Fatalf("%d haulers after the refinery, want 1", len(h))
	}
	if d := math.Hypot(h[0].X-st.X, h[0].Y-st.Y); d > st.Def().Footprint+2*rules.Map.Cell {
		t.Fatalf("the hauler appeared %v from its refinery", d)
	}
}

func TestRallyPoints(t *testing.T) {
	s := baseSim(t, 1)
	wealth(s, 0, 1500)
	barracks := own(s, 0, shared.RoleBarracks)
	events := []sim.Event{}
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdRally, Place: "D"}); err != nil {
		t.Fatal(err)
	}
	events = append(events, s.Step()...)
	if !has(events, sim.EvRallySet, 0) {
		t.Fatal("no rally_set event")
	}
	if got := own(s, 0, shared.RoleBarracks).Rally; got == nil || got.Place != "D" {
		t.Fatalf("the barracks' rally is %+v, want D", got)
	}
	if st := seen(s, 1, barracks.ID); st != nil && st.Rally != nil {
		t.Fatal("the enemy is shown a rally point")
	}
	sq := fielded(s, must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "commandos"}))
	if sq.Order.Kind != sim.OrderHold || sq.Order.Point != "D" {
		t.Fatalf("a squad made after the rally order has order %q at %q, want hold at D", sq.Order.Kind, sq.Order.Point)
	}
	// A structure built later gathers there too; one structure can have its own.
	works, err := s.Build(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "vehicleWorks"})
	if err != nil {
		t.Fatal(err)
	}
	if got := seen(s, 0, works.PlaceID()).Rally; got == nil || got.Place != "D" {
		t.Fatalf("a structure built after the order gathers at %+v", got)
	}
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdRally, Place: "B", Structure: works.PlaceID()})
	if a, b := seen(s, 0, works.PlaceID()).Rally, own(s, 0, shared.RoleBarracks).Rally; a.Place != "B" || b.Place != "D" {
		t.Fatalf("rally of the works %q and of the barracks %q, want B and D", a.Place, b.Place)
	}
	// "home" puts them back beside their structure.
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdRally, Place: sim.RallyDefault})
	if own(s, 0, shared.RoleBarracks).Rally != nil {
		t.Fatal("the rally point was not cleared")
	}
	sq = fielded(s, must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "commandos"}))
	if sq.Order.Kind == sim.OrderHold {
		t.Fatal("a squad made after the rally was cleared still went to hold a point")
	}
	for _, bad := range []sim.Command{
		{Side: 0, Kind: sim.CmdRally, Place: "the moon"},
		{Side: 0, Kind: sim.CmdRally, Place: "base:north"},
		{Side: 0, Kind: sim.CmdRally, Place: "D", Structure: "s999"},
	} {
		if _, err := s.Apply(bad); err == nil {
			t.Errorf("%+v was accepted", bad)
		}
	}
}

// A boat cannot gather at a land point: it gathers beside its dockyard instead.
func TestARallyPlaceAUnitCannotReachIsLeftAlone(t *testing.T) {
	s := newSim(t, 1)
	wealth(s, 0, 600)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdRally, Place: "D"})
	boat := fielded(s, must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "patrolBoat"}))
	if boat.Order.Kind == sim.OrderHold {
		t.Fatalf("the boat was sent to hold %q", boat.Order.Point)
	}
	run(s, 10)
	if x, y := boat.Center(); !s.Sailable(x, y) {
		t.Fatal("the boat left the water")
	}
}
