package sim_test

import (
	"math"
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

// On every map, both sides' base slots, dockyard and unloading spots are open land:
// never water, ice, a mountain, a landmark, a gold field or a point's ring. The two
// sides' layouts mirror each other.
func TestTheBaseLayoutIsOpenLandOnEveryMap(t *testing.T) {
	for _, id := range rules.MapIDs() {
		r, err := rules.ForMap(id)
		if err != nil {
			t.Fatal(err)
		}
		s, err := sim.New(r, sim.Config{Seed: 1, Factions: [2]string{"aegis", "ashfall"}, FullBase: true})
		if err != nil {
			t.Fatal(err)
		}
		var at [2]map[string][2]float64
		for side := 0; side < 2; side++ {
			at[side] = map[string][2]float64{}
			for _, st := range s.Snapshot(side).Structures {
				if st.Side != side {
					continue
				}
				at[side][st.Role] = [2]float64{st.X, st.Y}
				if k := r.Map.TerrainAt(st.X, st.Y); k != 'L' {
					t.Errorf("%s: side %d's %s stands on %q at (%.0f, %.0f)", id, side, st.Kind, k, st.X, st.Y)
				}
				for _, l := range r.Map.Landmarks {
					if math.Hypot(l.X-st.X, l.Y-st.Y) < 40 {
						t.Errorf("%s: side %d's %s stands on %s", id, side, st.Kind, l.ID)
					}
				}
				for _, g := range r.Map.Gushers {
					if math.Hypot(g.X-st.X, g.Y-st.Y) < g.FieldRadius {
						t.Errorf("%s: side %d's %s stands in the %s gold field", id, side, st.Kind, g.ID)
					}
				}
			}
			if len(at[side]) < len(shared.BaseRoles) {
				t.Errorf("%s: side %d has only %d of the base structures", id, side, len(at[side]))
			}
		}
		for role, w := range at[0] {
			if e := at[1][role]; math.Abs(w[0]-(r.Map.Width-e[0])) > 1 || math.Abs(w[1]-e[1]) > 1 {
				t.Errorf("%s: the %s is not mirrored: west (%.0f, %.0f), east (%.0f, %.0f)", id, role, w[0], w[1], e[0], e[1])
			}
		}
	}
}

// Haulers find their way on the map like any ground unit: sent to the rich field on the
// town island they cross a bridge to it, come back the same way, and go down with a
// bridge that falls under them.
func TestHaulersCrossBridgesAndFallWithThem(t *testing.T) {
	s, _ := simOn(t, rules, drillGround, sim.Config{StartGold: 2000})
	hauler := haulersOf(s.Snapshot(0), 0)[0]
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdHaul, Field: "F"}); err != nil {
		t.Fatal(err)
	}
	gold := s.Gold(0)
	loaded, home := false, false
	for i := 0; i < 240*rules.TickRate && !home; i++ {
		s.Step()
		h := haulersOf(s.Snapshot(0), 0)[0]
		if k := rules.Map.TerrainAt(h.X, h.Y); k != 'L' && !onABridge(s, h.X, h.Y) {
			t.Fatalf("the hauler is on %q at (%.0f, %.0f)", k, h.X, h.Y)
		}
		loaded = loaded || (h.State == sim.HaulLoading && h.X > 720 && h.X < 880)
		home = loaded && h.State == sim.HaulUnloading
	}
	if !loaded || !home || s.Gold(0) <= gold {
		t.Fatalf("the hauler never brought a load back from the island: loaded there %v, unloading %v", loaded, home)
	}
	// On the south bridge when it falls: lost with it, and its side is told.
	sq := s.SquadAny(hauler.ID)
	all := wreck(t, s, 0.5) // half down
	rpg := s.Squads[len(s.Squads)-1]
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdAttack, Squad: rpg.ID, Place: "bridge-south"})
	for i := 0; i < 200 && bridge(s, "bridge-south").Standing; i++ {
		place(sq, 800, 760) // caught on the deck
		all = append(all, s.Step()...)
	}
	if s.SquadAny(hauler.ID) != nil && s.SquadAny(hauler.ID).Alive {
		x, y := sq.Center()
		t.Fatalf("the hauler on the bridge survived its fall: bridge standing %v, hauler at (%.0f, %.0f), walkable %v", bridge(s, "bridge-south").Standing, x, y, s.Walkable(x, y))
	}
	if !has(all, sim.EvHaulerLost, 0) {
		t.Error("no hauler_lost for the hauler that went down with the bridge")
	}
}

func onABridge(s *sim.Sim, x, y float64) bool {
	for _, b := range s.Snapshot(sim.Spectator).Bridges {
		if b.Standing {
			for _, m := range rules.Map.Bridges {
				if m.ID == b.ID {
					ax, ay, bx, by := m.From[0], m.From[1], m.To[0], m.To[1]
					t := ((x-ax)*(bx-ax) + (y-ay)*(by-ay)) / ((bx-ax)*(bx-ax) + (by-ay)*(by-ay))
					if t >= -0.2 && t <= 1.2 && math.Hypot(x-ax-t*(bx-ax), y-ay-t*(by-ay)) <= m.Width/2+20 {
						return true
					}
				}
			}
		}
	}
	return false
}

// A squad ordered to attack a bridge shoots it from the bank: when the bridge goes down,
// nobody who was told to bring it down goes down with it.
func TestASquadAttackingABridgeStandsOnTheBank(t *testing.T) {
	for _, from := range [][2]float64{{1080, 760}, {560, 760}, {800, 760}} {
		s := newSim(t, 1)
		rpg := buyFielded(t, s, 1, "rpgTeam")
		place(rpg, from[0], from[1])
		must(t, s, sim.Command{Side: 1, Kind: sim.CmdAttack, Squad: rpg.ID, Place: "bridge-south"})
		b := bridge(s, "bridge-south")
		full := 0
		for i := range rpg.Teams {
			full += rpg.Teams[i].Members
		}
		for i := 0; i < 1500 && b.Standing; i++ {
			s.Step()
			if i < 150 {
				continue // a squad that started on the deck has had time to walk off it
			}
			for j := range rpg.Teams {
				if tm := &rpg.Teams[j]; tm.Members > 0 && onSouthBridge(tm.X, tm.Y) {
					t.Fatalf("from (%.0f, %.0f): a fireteam shoots the bridge from its deck, at (%.0f, %.0f)", from[0], from[1], tm.X, tm.Y)
				}
			}
		}
		if b.Standing {
			t.Fatalf("from (%.0f, %.0f): the bridge still stands, at %.0f%%", from[0], from[1], 100*b.Share())
		}
		left := 0
		for i := range rpg.Teams {
			left += rpg.Teams[i].Members
		}
		if left != full {
			t.Fatalf("from (%.0f, %.0f): %d of %d went down with the bridge they were shooting", from[0], from[1], full-left, full)
		}
	}
}

// "Hold 150 metres north of Delta" names the ground. The bunker that stands there is not
// what was asked for, and the squad stays outside; told to hold Delta, it takes the cover.
func TestASquadHoldingNamedGroundStaysOutOfTheBuildingBesideIt(t *testing.T) {
	inside := func(place string) int {
		s := newSim(t, 1)
		sq := s.Squads[0]
		must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: sq.ID, Place: place})
		run(s, 60)
		n := 0
		for i := range sq.Teams {
			if sq.Teams[i].In != "" {
				n++
			}
		}
		return n
	}
	if n := inside("N of D 60"); n != 0 {
		t.Fatalf("%d fireteams went inside a building when the order named the ground beside it", n)
	}
	if n := inside("D-bunker-1"); n == 0 {
		t.Fatal("a squad sent to the bunker by name stays outside it")
	}
}

// A squad that reaches the tech building it was sent to says so: the news names the
// building, not only the point it happens to be nearest.
func TestArrivingAtATechBuildingNamesIt(t *testing.T) {
	s := newSim(t, 1)
	sq := s.Squads[0]
	var clinic *sim.StructureView
	for _, st := range s.Snapshot(0).Structures {
		if st.Site == "tech-clinic-w" {
			clinic = &st
			break
		}
	}
	if clinic == nil {
		t.Fatal("the drill ground has no clinic in the west")
	}
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: sq.ID, Place: clinic.ID})
	for _, e := range run(s, 90) {
		if e.Kind == sim.EvArrived && e.Squad == sq.ID {
			if e.Structure != clinic.ID || e.Unit != clinic.Kind {
				t.Fatalf("arrived with structure %q (%q), want %q", e.Structure, e.Unit, clinic.ID)
			}
			return
		}
	}
	t.Fatal("the squad never arrived at the clinic")
}
