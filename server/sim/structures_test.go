package sim_test

import (
	"errors"
	"strings"
	"testing"

	"callsign/server/bot"
	"callsign/server/sim"
	"callsign/shared"
)

// baseSim is a match that starts as a real one does: a headquarters, a barracks, a
// refinery, and everything else still to be built.
func baseSim(t *testing.T, seed uint64) *sim.Sim {
	t.Helper()
	// The base as it stands once the opening is done: a refinery (and its hauler) and a barracks.
	s, err := sim.New(rules, sim.Config{Seed: seed, Factions: [2]string{"aegis", "ashfall"}, Base: []string{"refinery", "barracks"}})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// own finds a side's structure with a role in what that side is shown.
func own(s *sim.Sim, side int, role string) *sim.StructureView {
	for _, st := range s.Snapshot(side).Structures {
		if st.Side == side && st.Role == role && !st.Ruin {
			return &st
		}
	}
	return nil
}

// seen finds a structure by id in what a side is shown.
func seen(s *sim.Sim, side int, id string) *sim.StructureView {
	for _, st := range s.Snapshot(side).Structures {
		if st.ID == id {
			return &st
		}
	}
	return nil
}

func refused(t *testing.T, s *sim.Sim, c sim.Command, want error, words string) {
	t.Helper()
	_, err := s.Apply(c)
	if !errors.Is(err, want) || !strings.Contains(err.Error(), words) {
		t.Fatalf("%+v: err = %v, want %v mentioning %q", c, err, want, words)
	}
}

// wealth waits until a side can pay for something. Nobody has orders, so only the
// headquarters' trickle changes.
func wealth(s *sim.Sim, side, gold int) {
	for s.Gold(side) < gold && !s.Over {
		s.Step()
	}
}

func TestAMatchStartsWithABarracksAndARefinery(t *testing.T) {
	s := baseSim(t, 1)
	for side := 0; side < 2; side++ {
		for _, role := range rules.Match.StartStructures {
			if st := own(s, side, role); st == nil || st.Building != 1 || st.HP != 1 {
				t.Fatalf("side %d starts without a standing %s: %+v", side, role, st)
			}
		}
		if own(s, side, shared.RoleWorks) != nil || s.Has(side, shared.RoleDockyard) {
			t.Fatalf("side %d starts with more than the rules give it", side)
		}
	}
	// The two bases mirror each other across the map.
	a, b := own(s, 0, shared.RoleBarracks), own(s, 1, shared.RoleBarracks)
	if a.X+b.X != rules.Map.Width || a.Y != b.Y {
		t.Fatalf("barracks at (%v,%v) and (%v,%v) are not mirrored", a.X, a.Y, b.X, b.Y)
	}
}

func TestStructuresUnlockUnits(t *testing.T) {
	s := baseSim(t, 1)
	// Infantry come from the barracks the side starts with; a tank needs a works.
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "commandos"})
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "tank"}, sim.ErrNeedsStructure, "Vehicle Works")
	refused(t, s, sim.Command{Side: 1, Kind: sim.CmdBuy, Unit: "speedboat"}, sim.ErrNeedsStructure, "Boat Shed")
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "airbase"}, sim.ErrNeedsStructure, "Vehicle Works")
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "chopShop"}, sim.ErrNoStructure, "")
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "barracks"}, sim.ErrAlreadyBuilt, "Barracks")

	works := rules.Factions["aegis"].Structures["vehicleWorks"]
	gun := rules.Factions["aegis"].Structures["sentryGun"]
	wealth(s, 0, works.Cost+gun.Cost)
	before := s.Gold(0)
	// A role names the faction's structure for it as well as its id does.
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: shared.RoleWorks}); err != nil {
		t.Fatal(err)
	}
	if got := before - s.Gold(0); got != works.Cost {
		t.Fatalf("the works took %d gold when work began, want %d", got, works.Cost)
	}
	events := run(s, 1)
	st := own(s, 0, shared.RoleWorks)
	if !has(events, sim.EvStructureStarted, 0) || st == nil || st.Building <= 0 || st.Building >= 1 || st.Kind != "vehicleWorks" {
		t.Fatalf("a second in, the works should be going up: %+v", st)
	}
	// Under construction it unlocks nothing, and a second base structure has to wait.
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "tank"}, sim.ErrNeedsStructure, "Vehicle Works")
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "dockyard"}, sim.ErrBuilding, "Vehicle Works")
	// A defence goes up beside it.
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "sentryGun"}); err != nil {
		t.Fatalf("a defence should go up while a base structure does: %v", err)
	}
	events = run(s, works.BuildSeconds)
	if st := own(s, 0, shared.RoleWorks); !has(events, sim.EvStructureBuilt, 0) || st.Building != 1 || st.HP != 1 {
		t.Fatalf("after %v s the works should stand: %+v", works.BuildSeconds, st)
	}
	wealth(s, 0, 250)
	tank := must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "tank"})
	if fielded(s, tank); !tank.Alive {
		t.Fatal("the tank never reached the field")
	}
	// The other side has seen none of it.
	for _, st := range s.Snapshot(1).Structures {
		if st.Side == 0 {
			t.Fatalf("side 1 is shown a structure it has never seen: %+v", st)
		}
	}
}

func TestADestroyedStructureTakesItsUnlocksAndLeavesARuin(t *testing.T) {
	s := newSim(t, 1) // a full base on both sides
	target := own(s, 1, shared.RoleWorks)
	tanks := buyFielded(t, s, 0, "tank")
	technical := buyFielded(t, s, 1, "technical")
	place(technical, 200, 100) // out of the way; it must outlive its works
	place(tanks, target.X-150, target.Y)
	for _, sq := range s.Squads {
		if sq.Side == 1 && sq != technical {
			place(sq, 1500, 60) // nobody home
		}
	}
	s.Step() // the tanks see the works
	if st := seen(s, 0, target.ID); st == nil || !st.Visible || st.Role != shared.RoleWorks {
		t.Fatalf("side 0 stands beside the enemy works but is shown %+v", st)
	}
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdAttack, Squad: tanks.ID, Place: target.ID})
	var events []sim.Event
	for i := 0; i < 3000 && own(s, 1, shared.RoleWorks) != nil; i++ {
		events = append(events, s.Step()...)
	}
	if own(s, 1, shared.RoleWorks) != nil {
		t.Fatal("two tanks never brought the works down")
	}
	if !has(events, sim.EvStructureLost, 1) || !has(events, sim.EvStructureLost, 0) || !has(events, sim.EvStructureAttacked, 1) {
		t.Fatal("both sides should hear that the works fell, and its owner that it was under attack")
	}
	if st := seen(s, 1, target.ID); st == nil || !st.Ruin || st.HP != 0 {
		t.Fatalf("the works should be left as a ruin: %+v", st)
	}
	if st := seen(s, 0, target.ID); st == nil || !st.Ruin {
		t.Fatalf("the attacker saw it fall and should be shown the ruin: %+v", st)
	}
	refused(t, s, sim.Command{Side: 1, Kind: sim.CmdBuy, Unit: "technical"}, sim.ErrNeedsStructure, "Chop Shop")
	if !technical.Alive {
		t.Fatal("a squad already in the field should outlive the structure that built it")
	}
	// The order on a structure that is gone becomes a hold, and the slot can be built on again.
	if s.Step(); tanks.Order.Kind != sim.OrderHold {
		t.Fatalf("the tanks' order is %q after their target fell, want hold", tanks.Order.Kind)
	}
	wealth(s, 1, 400)
	if _, err := s.Apply(sim.Command{Side: 1, Kind: sim.CmdBuild, Structure: "chopShop"}); err != nil {
		t.Fatalf("rebuilding over the ruin: %v", err)
	}
	if st := own(s, 1, shared.RoleWorks); st == nil || st.X != target.X || st.Y != target.Y {
		t.Fatalf("the new works should stand where the old one did: %+v", st)
	}
}

func TestDefencesFireOnTheirOwn(t *testing.T) {
	s := newSim(t, 1)
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "sentryGun", Place: "base:front"}); err != nil {
		t.Fatal(err)
	}
	gun := own(s, 0, shared.RoleDefence)
	for _, sq := range s.Squads {
		if sq.Side == 0 {
			place(sq, 100, 60) // the gun is alone
		}
	}
	militia := s.Squad(3)
	place(militia, gun.X+200, gun.Y)
	// While it is going up it does nothing.
	run(s, 2)
	if alive, full := militia.Strength(); alive != full {
		t.Fatal("a gun under construction fired")
	}
	run(s, rules.Factions["aegis"].Structures["sentryGun"].BuildSeconds+12)
	if alive, full := militia.Strength(); alive == full {
		t.Fatal("a standing sentry gun never hurt the squad in front of it")
	}
	// It does not move, and it never fires at what it cannot hurt.
	if now := own(s, 0, shared.RoleDefence); now.X != gun.X || now.Y != gun.Y {
		t.Fatal("the gun moved")
	}
	flak := rules.Factions["aegis"].Structures["flakBattery"]
	if flak.Against("infantry") != 0 || flak.Against("air") == 0 {
		t.Fatal("the flak battery should engage aircraft only")
	}
}

func TestDefencesAndFencesNeedOwnGround(t *testing.T) {
	s := newSim(t, 1)
	// Kilo is the far side of the map and nobody holds it.
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "sentryGun", Place: "K"}, sim.ErrTooFar, "")
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "barrierWall", Place: "K"}, sim.ErrTooFar, "")
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "sentryGun", Place: "nowhere"}, sim.ErrBadPlace, "")
	// A point the side holds will do.
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: 1, Point: "B"})
	for i := 0; i < 1200 && s.Points[1].Owner != 0; i++ {
		s.Step()
	}
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "sentryGun", Place: "B"}); err != nil {
		t.Fatalf("a gun at a point the side holds: %v", err)
	}
	// The cap on defences holds.
	for i := 0; i < rules.Match.DefenceCap+2; i++ {
		run(s, rules.Factions["aegis"].Structures["sentryGun"].BuildSeconds+1)
		wealth(s, 0, 200)
		_, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "sentryGun"})
		if i >= rules.Match.DefenceCap-1 && !errors.Is(err, sim.ErrTooMany) {
			t.Fatalf("defence %d: err = %v, want the cap", i+2, err)
		}
	}
}

func TestAFenceStopsGroundUnitsUntilItIsBreached(t *testing.T) {
	s := newSim(t, 1)
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "barrierWall", Place: "base:front"}); err != nil {
		t.Fatal(err)
	}
	wall := rules.Factions["aegis"].Structures["barrierWall"]
	var fence []sim.StructureView
	for _, st := range s.Snapshot(0).Structures {
		if st.Role == shared.RoleFence {
			fence = append(fence, st)
		}
	}
	if len(fence) != wall.Segments || fence[0].Run == 0 || fence[0].AX != fence[0].BX {
		t.Fatalf("a run on the front of a western base should be %d segments north to south: %+v", wall.Segments, fence)
	}
	for _, sq := range s.Squads {
		if sq.Side == 0 {
			place(sq, 100, 60)
		}
	}
	run(s, wall.BuildSeconds+1)
	line := fence[0].AX
	// Militia come from the east, straight at the middle of the run.
	militia := s.Squad(3)
	place(militia, line+120, 480)
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdMove, Squad: militia.ID, Point: "A"})
	run(s, 12)
	x, _ := militia.Center()
	if x <= line {
		t.Fatalf("the militia walked through a standing wall: at x=%.0f, wall at %.0f", x, line)
	}
	if x > line+40 {
		t.Fatalf("the militia never reached the wall: at x=%.0f", x)
	}
	// Stopped, they shoot it down and go on.
	var events []sim.Event
	for i := 0; i < 6000; i++ {
		events = append(events, s.Step()...)
		if x, _ = militia.Center(); x < line-20 {
			break
		}
	}
	if x >= line-20 {
		t.Fatalf("the militia never breached the wall: at x=%.0f", x)
	}
	ruins := 0
	for _, st := range s.Snapshot(0).Structures {
		if st.Role == shared.RoleFence && st.Ruin {
			ruins++
		}
	}
	if ruins == 0 || ruins == wall.Segments {
		t.Fatalf("%d of %d segments fell; a breach is some, not none and not all", ruins, wall.Segments)
	}
	// Its owner's own squads were never stopped by it.
	own := s.Squad(1)
	place(own, line-60, 400)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdMove, Squad: own.ID, Point: "F"})
	run(s, 8)
	if x, _ := own.Center(); x <= line {
		t.Fatalf("a side's own wall stopped its own squad at x=%.0f", x)
	}
}

func TestEngineersTakeOverAStructure(t *testing.T) {
	s := baseSim(t, 1)
	wealth(s, 1, 320)
	if _, err := s.Apply(sim.Command{Side: 1, Kind: sim.CmdBuild, Structure: "chopShop"}); err != nil {
		t.Fatal(err)
	}
	run(s, rules.Factions["ashfall"].Structures["chopShop"].BuildSeconds+1)
	works := own(s, 1, shared.RoleWorks)
	for _, sq := range s.Squads {
		if sq.Side == 1 {
			place(sq, 1500, 60)
		}
	}
	engineers := buyFielded(t, s, 0, "engineers")
	commandos := s.Squad(1)
	place(engineers, works.X-200, works.Y)
	place(commandos, works.X-200, works.Y+30)
	s.Step()

	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdCapture, Squad: commandos.ID, Place: works.ID}, sim.ErrNotEngineers, "")
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdCapture, Squad: engineers.ID, Place: "A"}, sim.ErrBadPlace, "")
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdRepair, Squad: engineers.ID, Place: works.ID}, sim.ErrNoBridge, "")
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "technical"}, sim.ErrNoUnit, "")
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdCapture, Squad: engineers.ID, Place: works.ID})

	var events []sim.Event
	progress := 0.0
	for i := 0; i < 1200 && engineers.Alive; i++ {
		events = append(events, s.Step()...)
		for _, sq := range s.Snapshot(0).Squads {
			if sq.ID == engineers.ID && sq.Order.Capture > progress {
				progress = sq.Order.Capture
			}
		}
	}
	if engineers.Alive || progress <= 0 {
		t.Fatalf("the engineers never finished: alive=%v, best progress %.2f", engineers.Alive, progress)
	}
	if !has(events, sim.EvStructureCaptured, 0) || !has(events, sim.EvStructureCaptured, 1) {
		t.Fatal("both sides should hear of the takeover")
	}
	for _, e := range events {
		if e.Kind == sim.EvEnemyDestroyed && e.Contact == engineers.ID {
			t.Fatal("the engineers were used up, not destroyed by the enemy")
		}
	}
	if st := seen(s, 0, works.ID); st == nil || st.Side != 0 || st.Faction != "ashfall" || st.HP != 1 {
		t.Fatalf("the works should be side 0's now, still an Ashfall design, undamaged: %+v", st)
	}
	if st := seen(s, 1, works.ID); st == nil || st.Side != 0 {
		t.Fatalf("its old owner should know who has it: %+v", st)
	}
	// What it unlocked is the new owner's: its own works units, and that faction's.
	if got := s.Snapshot(0).ForeignUnits; len(got) != 1 || got[0] != "technical" {
		t.Fatalf("foreign units = %v, want the technical", got)
	}
	refused(t, s, sim.Command{Side: 1, Kind: sim.CmdBuy, Unit: "technical"}, sim.ErrNeedsStructure, "Chop Shop")
	technical := buyFielded(t, s, 0, "technical")
	tank := buyFielded(t, s, 0, "tank")
	if !technical.Alive || technical.Side != 0 || !tank.Alive {
		t.Fatal("the new owner should field a technical and a tank from the captured works")
	}
	if c := s.Callsign(technical); c.En != "Rhino 1" {
		t.Fatalf("a captured design still takes this side's callsigns: %v", c)
	}
	// Headquarters, defences and fences cannot be taken.
	if rules.Factions["ashfall"].Structures["den"].Capturable || rules.Factions["ashfall"].Structures["gunNest"].Capturable {
		t.Fatal("only base structures may be capturable")
	}
}

func TestACaptureIsBrokenOffUnderFire(t *testing.T) {
	s := newSim(t, 1)
	works := own(s, 1, shared.RoleWorks)
	engineers := buyFielded(t, s, 0, "engineers")
	place(engineers, works.X-60, works.Y)
	for _, sq := range s.Squads {
		if sq.Side == 1 {
			place(sq, 1500, 60)
		}
	}
	place(s.Squad(3), works.X+100, works.Y) // militia right there
	place(s.Squad(1), 100, 60)
	place(s.Squad(2), 100, 60)
	s.Step()
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdCapture, Squad: engineers.ID, Place: works.ID})
	run(s, rules.Factions["aegis"].Units["engineers"].CaptureSeconds+4)
	if st := seen(s, 1, works.ID); st.Side != 1 {
		t.Fatal("engineers under fire took the works anyway")
	}
}

func TestEnemyStructuresAreShownAsLastSeen(t *testing.T) {
	s := newSim(t, 1)
	target := own(s, 1, shared.RoleRefinery)
	if seen(s, 0, target.ID) != nil {
		t.Fatal("side 0 is shown a refinery it has never seen")
	}
	scouts := s.Squad(1)
	for _, sq := range s.Squads {
		if sq.Side == 1 {
			place(sq, 1500, 60)
		}
	}
	place(scouts, target.X-150, target.Y)
	run(s, 1)
	if st := seen(s, 0, target.ID); st == nil || !st.Visible || st.HP != 1 {
		t.Fatalf("scouts beside the refinery are shown %+v", st)
	}
	// They leave; then it is damaged behind their back.
	place(scouts, 100, 60)
	run(s, 1)
	tank := buyFielded(t, s, 0, "tank")
	_ = tank
	for _, st := range s.Structures {
		if st.PlaceID() == target.ID {
			st.HP /= 2
		}
	}
	run(s, 1)
	if st := seen(s, 0, target.ID); st == nil || st.Visible || st.HP != 1 {
		t.Fatalf("out of sight, the refinery should be remembered whole: %+v", st)
	}
	if st := seen(s, sim.Spectator, target.ID); st.HP != 0.5 {
		t.Fatalf("the spectator sees it as it is: %+v", st)
	}
	// A structure gives its owner sight of the ground around it.
	if !s.InSight(1, target.X+100, target.Y) || s.InSight(0, target.X+100, target.Y) {
		t.Fatal("a structure should see for its owner only")
	}
}

func TestDropOffsAreRefineriesOrElseTheHeadquarters(t *testing.T) {
	s := baseSim(t, 1)
	ref := own(s, 0, shared.RoleRefinery)
	if sites := s.DropOffs(0); len(sites) != 1 || sites[0].X != ref.X || sites[0].Y != ref.Y || sites[0].Structure == 0 {
		t.Fatalf("drop-offs = %+v, want the refinery", sites)
	}
	for _, st := range s.Structures {
		if st.PlaceID() == ref.ID {
			st.Ruin = true
		}
	}
	hq := rules.HQPoint(0)
	if sites := s.DropOffs(0); len(sites) != 1 || sites[0].X != hq.X || sites[0].Structure != 0 {
		t.Fatalf("with no refinery the headquarters takes the gold: %+v", sites)
	}
}

// A match from a real start plays the same twice, builds bases, and comes to a result.
func TestScriptedPlayersBuildBasesTheSameWayTwice(t *testing.T) {
	play := func() (*sim.Sim, []uint64) {
		s := baseSim(t, 7)
		players := [2]*bot.Player{{Side: 0, Style: bot.Standard, R: rules}, {Side: 1, Style: bot.Standard, R: rules}}
		var trace []uint64
		for !s.Over {
			if s.Tick%rules.TickRate == 0 {
				for _, p := range players {
					for _, c := range p.Act(s.Snapshot(p.Side)) {
						if _, err := s.Apply(c); err != nil {
							t.Fatalf("tick %d: scripted command %+v refused: %v", s.Tick, c, err)
						}
					}
				}
				trace = append(trace, s.Hash())
			}
			s.Step()
		}
		return s, trace
	}
	a, ta := play()
	_, tb := play()
	if len(ta) != len(tb) {
		t.Fatalf("the two runs differ in length: %d and %d", len(ta), len(tb))
	}
	for i := range ta {
		if ta[i] != tb[i] {
			t.Fatalf("the two runs part at second %d", i)
		}
	}
	for side := 0; side < 2; side++ {
		roles := map[string]bool{}
		for _, st := range a.Snapshot(sim.Spectator).Structures {
			if st.Side == side {
				roles[st.Role] = true
			}
		}
		for _, role := range []string{shared.RoleDockyard, shared.RoleWorks, shared.RoleDefence} {
			if !roles[role] {
				t.Errorf("side %d's scripted player never built a %s", side, role)
			}
		}
	}
}

// The rush style lives off the barracks it starts with.
func TestARushStillPlaysToAResult(t *testing.T) {
	s := baseSim(t, 2)
	players := [2]*bot.Player{{Side: 0, Style: bot.Easy, R: rules}, {Side: 1, Style: bot.Rush, R: rules}}
	for !s.Over {
		if s.Tick%rules.TickRate == 0 {
			for _, p := range players {
				for _, c := range p.Act(s.Snapshot(p.Side)) {
					if _, err := s.Apply(c); err != nil {
						t.Fatalf("tick %d: %+v refused: %v", s.Tick, c, err)
					}
				}
			}
		}
		s.Step()
	}
	if s.Reason == "" {
		t.Fatal("the match ended with no reason")
	}
}

// A fence can also run from one place toward another: it is centred between them and no
// longer than a run may be.
func TestAFenceRunsBetweenTwoPlaces(t *testing.T) {
	s := newSim(t, 1)
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "barrierWall", Place: "A", Place2: "B"}); err != nil {
		t.Fatal(err)
	}
	a, b := rules.PointByID("A"), rules.PointByID("B")
	wall := rules.Factions["aegis"].Structures["barrierWall"]
	n := 0
	for _, st := range s.Snapshot(0).Structures {
		if st.Role != shared.RoleFence {
			continue
		}
		n++
		// Every segment lies on the line from Alpha to Bravo.
		cross := (b.X-a.X)*(st.Y-a.Y) - (b.Y-a.Y)*(st.X-a.X)
		if cross > 600 || cross < -600 {
			t.Fatalf("segment at (%v,%v) is off the line from Alpha to Bravo", st.X, st.Y)
		}
	}
	if n == 0 || n > wall.Segments {
		t.Fatalf("the run has %d segments, want 1 to %d", n, wall.Segments)
	}
	// The cap on runs holds.
	for i := 0; i < rules.Match.FenceRuns+1; i++ {
		run(s, wall.BuildSeconds+1)
		wealth(s, 0, wall.Cost)
		side := []string{"base:north", "base:south", "base:front", "base:rear", "base:north"}[i]
		_, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "barrierWall", Place: side})
		if i >= rules.Match.FenceRuns-1 && !errors.Is(err, sim.ErrTooMany) {
			t.Fatalf("run %d: err = %v, want the cap", i+2, err)
		}
		if i < rules.Match.FenceRuns-1 && err != nil {
			t.Fatalf("run %d on %s: %v", i+2, side, err)
		}
	}
}

// A squad ordered onto a structure beside the enemy headquarters shoots the structure.
func TestAnOrderOnAStructureOutranksTheHeadquartersBesideIt(t *testing.T) {
	s := newSim(t, 1)
	target := own(s, 1, shared.RoleRefinery)
	hq := rules.HQPoint(1)
	tanks := buyFielded(t, s, 0, "tank")
	for _, sq := range s.Squads {
		if sq.Side == 1 {
			place(sq, 1500, 60)
		}
	}
	// Within reach of both the refinery and the headquarters.
	place(tanks, hq.X-150, (hq.Y+target.Y)/2)
	s.Step()
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdAttack, Squad: tanks.ID, Place: target.ID})
	for i := 0; i < 3000 && own(s, 1, shared.RoleRefinery) != nil; i++ {
		s.Step()
	}
	if own(s, 1, shared.RoleRefinery) != nil {
		t.Fatal("the tanks never brought the refinery down")
	}
	if got := s.Snapshot(sim.Spectator).HQ[1]; got != 1 {
		t.Fatalf("the headquarters was shot at while the order was on the refinery: health %.2f", got)
	}
}
