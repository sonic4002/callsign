package sim_test

import (
	"errors"
	"math"
	"os"
	"strconv"
	"testing"

	"callsign/server/bot"
	"callsign/server/sim"
	"callsign/shared"
)

// simOn starts a match on one of the maps, with rules the test may have changed.
func simOn(t *testing.T, r *shared.Rules, mapID string, cfg sim.Config) (*sim.Sim, *shared.Rules) {
	t.Helper()
	r, err := r.ForMap(mapID)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Factions == [2]string{} {
		cfg.Factions = [2]string{"aegis", "ashfall"}
	}
	if cfg.Seed == 0 {
		cfg.Seed = 1
	}
	s, err := sim.New(r, cfg)
	if err != nil {
		t.Fatal(err)
	}
	return s, r
}

// engineers is the rules with the commandos able to mend bridges, as an engineer unit will.
func engineers(t *testing.T) *shared.Rules {
	t.Helper()
	r, err := shared.Parse(shared.RulesJSON)
	if err != nil {
		t.Fatal(err)
	}
	u := r.Factions["aegis"].Units["commandos"]
	u.RepairPerSecond = 60
	r.Factions["aegis"].Units["commandos"] = u
	return r
}

func bridge(s *sim.Sim, id string) *sim.BridgeState {
	for i := range s.Bridges {
		if s.Bridges[i].ID == id {
			return &s.Bridges[i]
		}
	}
	return nil
}

func landmark(s *sim.Sim, id string) *sim.LandmarkState {
	for i := range s.Landmarks {
		if s.Landmarks[i].ID == id {
			return &s.Landmarks[i]
		}
	}
	return nil
}

func events(all []sim.Event, kind string, side int) []sim.Event {
	var out []sim.Event
	for _, e := range all {
		if e.Kind == kind && e.Side == side {
			out = append(out, e)
		}
	}
	return out
}

// onSouthBridge reports whether a position is on the deck of the small map's south bridge.
func onSouthBridge(x, y float64) bool { return x >= 720 && x <= 880 && math.Abs(y-760) <= 40 }

// wreck has a rocket team of side 1 shoot the south bridge of the small map until it is
// at or below a share of its hit points, then stand down. It returns the events.
func wreck(t *testing.T, s *sim.Sim, share float64) []sim.Event {
	t.Helper()
	rpg := buyFielded(t, s, 1, "rpgTeam")
	place(rpg, 1080, 760)
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdAttack, Squad: rpg.ID, Place: "bridge-south"})
	var all []sim.Event
	b := bridge(s, "bridge-south")
	for i := 0; i < 600 && b.Share() > share; i++ {
		all = append(all, s.Step()...)
	}
	if b.Share() > share {
		t.Fatalf("the bridge still has %.0f%% after a minute of rockets", 100*b.Share())
	}
	if b.Standing {
		must(t, s, sim.Command{Side: 1, Kind: sim.CmdHold, Squad: rpg.ID})
	}
	return all
}

func TestEveryMapHasEveryKindOfGround(t *testing.T) {
	if len(rules.Maps) != 3 {
		t.Fatalf("%d maps, want 3", len(rules.Maps))
	}
	points := map[string]int{"small": 9, "medium": 12, "large": 15}
	for _, id := range rules.MapIDs() {
		m := rules.Maps[id]
		kinds := map[rune]int{}
		for _, row := range m.Terrain {
			for _, k := range row {
				kinds[k]++
			}
			// Mirrored west to east, so neither side starts better.
			for i := range row {
				if row[i] != row[len(row)-1-i] {
					t.Fatalf("%s: terrain is not mirrored", id)
				}
			}
		}
		for _, k := range "LWIM" {
			if kinds[k] == 0 {
				t.Errorf("%s has no %q terrain", id, k)
			}
		}
		if len(m.Bridges) == 0 || len(m.Landmarks) < 10 || len(m.Gushers) < 2 {
			t.Errorf("%s: %d bridges, %d landmarks, %d gushers", id, len(m.Bridges), len(m.Landmarks), len(m.Gushers))
		}
		if len(m.Points) != points[id] {
			t.Errorf("%s has %d points, want %d", id, len(m.Points), points[id])
		}
		names := map[string]bool{}
		for _, l := range m.Landmarks {
			if names[l.Name.En] || names[l.Name.He] {
				t.Errorf("%s: two landmarks are called %q", id, l.Name.En)
			}
			names[l.Name.En], names[l.Name.He] = true, true
		}
		// Only letters that exist in both alphabets, and never ר.
		for _, p := range m.Points {
			if !map[string]bool{"A": true, "B": true, "G": true, "D": true, "H": true, "F": true, "K": true, "S": true, "Z": true,
				"L": true, "M": true, "N": true, "T": true, "Y": true, "V": true}[p.ID] {
				t.Errorf("%s: point %s is not a shared letter", id, p.ID)
			}
		}
	}
}

// playOn plays a scripted match on a map and returns the hash once a second. Every tick,
// every unit must be on ground or water its kind can be on.
func playOn(t *testing.T, mapID string, seed uint64, factions [2]string) (*sim.Sim, []uint64) {
	t.Helper()
	s, r := simOn(t, rules, mapID, sim.Config{Seed: seed, Factions: factions})
	players := [2]*bot.Player{{Side: 0, Style: bot.Standard, R: r}, {Side: 1, Style: bot.Standard, R: r}}
	var trace []uint64
	for !s.Over {
		if s.Tick%r.TickRate == 0 {
			for _, p := range players {
				for _, c := range p.Act(s.Snapshot(p.Side)) {
					if _, err := s.Apply(c); err != nil {
						t.Fatalf("%s seed %d tick %d: scripted command %+v refused: %v", mapID, seed, s.Tick, c, err)
					}
				}
			}
			trace = append(trace, s.Hash())
		}
		s.Step()
		for _, sq := range s.Squads {
			domain := r.Factions[s.Sides[sq.Side].Faction].Units[sq.Unit].Domain
			for _, tm := range sq.Teams {
				if !sq.Alive || tm.Members == 0 {
					continue
				}
				if (domain == "sea" && !s.Sailable(tm.X, tm.Y)) || (domain == "land" && tm.In == "" && !s.Walkable(tm.X, tm.Y)) {
					t.Fatalf("%s seed %d tick %d: squad %d (%s) is where it cannot be, at %.1f,%.1f", mapID, seed, s.Tick, sq.ID, sq.Unit, tm.X, tm.Y)
				}
			}
		}
	}
	return s, append(trace, s.Hash())
}

func TestScriptedMatchesOnEveryMapAreDeterministic(t *testing.T) {
	for _, id := range rules.MapIDs() {
		a, ta := playOn(t, id, 3, [2]string{"aegis", "ashfall"})
		_, tb := playOn(t, id, 3, [2]string{"aegis", "ashfall"})
		if len(ta) != len(tb) {
			t.Fatalf("%s: two runs of one seed differ in length", id)
		}
		for i := range ta {
			if ta[i] != tb[i] {
				t.Fatalf("%s: two runs of one seed differ at second %d", id, i)
			}
		}
		// The scripted players got somewhere: both crossed the map's water or mountains.
		crossed := [2]bool{}
		for _, sq := range a.Squads {
			x, _ := sq.Center()
			if sq.Alive && (x > a.R.Map.Width/2) == (sq.Side == 0) {
				crossed[sq.Side] = true
			}
		}
		_, other := playOn(t, id, 4, [2]string{"aegis", "ashfall"})
		if len(other) == len(ta) && other[len(other)-1] == ta[len(ta)-1] {
			t.Errorf("%s: another seed played the same match", id)
		}
		t.Logf("%s: winner %d by %s, crossed the middle: %v", id, a.Winner, a.Reason, crossed)
	}
}

func TestGroundUnitsGoRoundWaterAndOverBridges(t *testing.T) {
	s, _ := simOn(t, rules, "small", sim.Config{})
	// From the western bank to the farm on the eastern one: the river is in the way.
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdMove, Squad: 1, Point: "H"})
	crossedAt := ""
	for i := 0; i < 900; i++ {
		s.Step()
		for _, tm := range s.Squad(1).Teams {
			if !s.Walkable(tm.X, tm.Y) {
				t.Fatalf("tick %d: a fireteam is in the water or a mountain at %.0f,%.0f", s.Tick, tm.X, tm.Y)
			}
			if rules.Map.TerrainAt(tm.X, tm.Y) == 'W' && crossedAt == "" {
				crossedAt = "a bridge" // on water terrain and walkable: a deck
			}
		}
	}
	x, y := s.Squad(1).Center()
	h := rules.PointByID("H")
	if math.Hypot(x-h.X, y-h.Y) > 80 {
		t.Fatalf("the squad is at %.0f,%.0f, not at Hotel", x, y)
	}
	if crossedAt == "" {
		t.Fatal("the squad reached the far bank without using a bridge")
	}
	// A boat keeps to the water and gets to the sea rig; it cannot be sent ashore.
	boat := buyFielded(t, s, 0, "patrolBoat")
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: boat.ID, Point: "S"})
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdMove, Squad: boat.ID, Point: "F"}); !errors.Is(err, sim.ErrUnreachable) {
		t.Fatalf("a boat sent to the town: %v", err)
	}
	for i := 0; i < 700; i++ {
		s.Step()
		for _, tm := range boat.Teams {
			if !s.Sailable(tm.X, tm.Y) {
				t.Fatalf("tick %d: the boat is aground at %.0f,%.0f", s.Tick, tm.X, tm.Y)
			}
		}
	}
	if owner(s, "S") != 0 {
		t.Fatalf("the boat did not take the sea rig; it is at %v", boat.Teams[0])
	}
}

func TestIceIsCrossedSlowly(t *testing.T) {
	s, _ := simOn(t, rules, "small", sim.Config{})
	speed := func(x float64) float64 {
		place(s.Squad(1), x, 240)
		must(t, s, sim.Command{Side: 0, Kind: sim.CmdMove, Squad: 1, Place: "E of G 60"})
		s.Step()
		before := s.Squad(1).Teams[0].X
		s.Step()
		return s.Squad(1).Teams[0].X - before
	}
	land, ice := speed(600), speed(740)
	if land <= 0 || math.Abs(ice/land-rules.TerrainKinds["I"].Speed) > 0.01 {
		t.Fatalf("a tick's walk is %.2f on land and %.2f on ice, want ice at %.0f%%", land, ice, 100*rules.TerrainKinds["I"].Speed)
	}
	// The ford is ground like any other: a squad standing on it takes the point.
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: 1, Point: "G"})
	run(s, 20)
	if owner(s, "G") != 0 {
		t.Fatal("a squad on the frozen ford did not take Golf")
	}
}

func TestBridgeFallsWithEverythingOnIt(t *testing.T) {
	s, _ := simOn(t, rules, "small", sim.Config{StartGold: 2000})
	place(s.Squad(1), 740, 760)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: 1, Place: "bridge-south"})
	all := wreck(t, s, 0)
	b := bridge(s, "bridge-south")
	if b.Standing || s.Walkable(800, 760) || !s.Sailable(800, 760) {
		t.Fatalf("the bridge should be down and water again: standing=%v", b.Standing)
	}
	if s.Squad(1) != nil {
		t.Fatal("the squad on the bridge survived its fall")
	}
	if len(events(all, sim.EvBridgeUnderAttack, 0)) == 0 {
		t.Error("the side with a squad on the bridge was not warned it was under attack")
	}
	fell := events(all, sim.EvBridgeFell, 0)
	if len(fell) != 1 || fell[0].Place != "bridge-south" || fell[0].Count != 3 {
		t.Fatalf("side 0 was told %+v, want the bridge fell with 3 fireteams on it", fell)
	}
	if e := events(all, sim.EvBridgeFell, 1); len(e) != 1 || e[0].Count != 0 {
		t.Fatalf("side 1 brought it down and was told %+v", e)
	}
	if !has(all, sim.EvSquadLost, 0) {
		t.Error("no squad_lost for the squad that went down with the bridge")
	}
	// With nothing left to shoot at, the rocket team holds.
	if o := s.Squads[len(s.Squads)-1].Order; o.Kind != sim.OrderHold {
		t.Errorf("the rocket team's order is %q after the bridge fell", o.Kind)
	}
	for _, v := range s.Snapshot(sim.Spectator).Bridges {
		if v.ID == "bridge-south" && (v.Standing || v.HP != 0) {
			t.Errorf("spectators are shown %+v", v)
		}
	}
	// The other crossings still stand, so the far bank can still be reached; by the
	// fallen bridge itself a squad now stops at the bank.
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdMove, Squad: 2, Point: "H"})
	place(s.Squad(2), 600, 760)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdMove, Squad: 2, Place: "bridge-south"})
	run(s, 15)
	if x, _ := s.Squad(2).Center(); x > 720 {
		t.Fatalf("a squad walked onto a fallen bridge: x=%.0f", x)
	}
}

func TestEngineersBringABridgeBack(t *testing.T) {
	r := engineers(t)
	s, _ := simOn(t, r, "small", sim.Config{StartGold: 2000})
	wreck(t, s, 0)
	// Only a bridge can be repaired, and only by a unit that repairs.
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdRepair, Squad: 1, Point: "D"}); !errors.Is(err, sim.ErrNotBridge) {
		t.Fatalf("repairing a point: %v", err)
	}
	if _, err := s.Apply(sim.Command{Side: 1, Kind: sim.CmdRepair, Squad: 3, Place: "bridge-south"}); !errors.Is(err, sim.ErrNoRepair) {
		t.Fatalf("militia repairing a bridge: %v", err)
	}
	place(s.Squad(1), 560, 760)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdRepair, Squad: 1, Place: "bridge-south"})
	var all []sim.Event
	b := bridge(s, "bridge-south")
	for i := 0; i < 600 && !b.Standing; i++ {
		all = append(all, s.Step()...)
	}
	if !b.Standing || !s.Walkable(800, 760) {
		t.Fatalf("after a minute of repair the bridge has %.0f%% and standing=%v", 100*b.Share(), b.Standing)
	}
	if b.Share() < r.BridgeRules.StandShare {
		t.Fatalf("the bridge stands at %.0f%%, below the %.0f%% it needs", 100*b.Share(), 100*r.BridgeRules.StandShare)
	}
	if e := events(all, sim.EvBridgeRepaired, 0); len(e) != 1 || e[0].Place != "bridge-south" || e[0].Squad != 1 {
		t.Fatalf("the repairing side was told %+v", e)
	}
	// The work goes on to a whole bridge, and then the squad simply holds.
	all = run(s, 30)
	if b.Share() != 1 || s.Squad(1).Order.Kind != sim.OrderHold {
		t.Fatalf("after the repair: %.0f%%, order %q", 100*b.Share(), s.Squad(1).Order.Kind)
	}
	// And it carries troops again.
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdMove, Squad: 1, Point: "H"})
	crossed := false
	for i := 0; i < 400; i++ {
		s.Step()
		x, y := s.Squad(1).Center()
		crossed = crossed || onSouthBridge(x, y)
	}
	if !crossed {
		t.Fatal("the squad did not use the repaired bridge")
	}
}

func TestTroopsStayOffABridgeAboutToFall(t *testing.T) {
	s, r := simOn(t, rules, "small", sim.Config{StartGold: 2000})
	wreck(t, s, r.BridgeRules.DangerShare-0.01)
	b := bridge(s, "bridge-south")
	if !b.Standing || b.Share() <= 0 {
		t.Fatalf("the bridge should be badly hit and standing: %.0f%%", 100*b.Share())
	}
	// Told to hold the farm, a squad at the ridge goes the long way round.
	place(s.Squad(1), 520, 720)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: 1, Point: "H"})
	for i := 0; i < 900; i++ {
		s.Step()
		for _, tm := range s.Squad(1).Teams {
			if onSouthBridge(tm.X, tm.Y) {
				t.Fatalf("tick %d: a squad told to hold walked onto a bridge at %.0f%%", s.Tick, 100*b.Share())
			}
		}
	}
	h := r.PointByID("H")
	if x, y := s.Squad(1).Center(); math.Hypot(x-h.X, y-h.Y) > 90 {
		t.Fatalf("the squad did not get to Hotel the long way: it is at %.0f,%.0f", x, y)
	}
	// Told to move, a squad takes the bridge while it stands.
	place(s.Squad(2), 520, 720)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdMove, Squad: 2, Point: "H"})
	crossed := false
	for i := 0; i < 400; i++ {
		s.Step()
		x, y := s.Squad(2).Center()
		crossed = crossed || onSouthBridge(x, y)
	}
	if !crossed {
		t.Fatal("a squad ordered to move did not cross the damaged bridge")
	}
}

func TestInfantryGoInsideABuilding(t *testing.T) {
	s, _ := simOn(t, rules, "small", sim.Config{})
	place(s.Squad(1), 450, 560)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: 1, Place: "D-bunker-1"})
	all := run(s, 12)
	in, covered := 0, 0
	for _, tm := range s.Squad(1).Teams {
		if tm.In == "D-bunker-1" {
			in++
		}
		if tm.Cover < 1 {
			covered++
		}
	}
	room := min(3, rules.LandmarkKinds["bunker"].Garrison) // the squad has three fireteams
	if in != room || covered != 3 {
		t.Fatalf("%d fireteams inside (room for %d), %d of 3 in cover", in, room, covered)
	}
	if e := events(all, sim.EvGarrisoned, 0); len(e) != 1 || e[0].Place != "D-bunker-1" || e[0].Squad != 1 {
		t.Fatalf("garrisoned events: %+v", e)
	}
	mine := s.Snapshot(0)
	if len(mine.Landmarks) != 1 || mine.Landmarks[0].Garrison == nil || mine.Landmarks[0].Garrison.Teams != room || mine.Landmarks[0].Garrison.Side != 0 {
		t.Fatalf("own side is shown %+v", mine.Landmarks)
	}
	for _, tv := range mine.Squads[0].Teams {
		if tv.Cover <= 0 || tv.Cover >= 1 {
			t.Errorf("own team view has cover %v", tv.Cover)
		}
	}
	if theirs := s.Snapshot(1).Landmarks; len(theirs) != 0 {
		t.Fatalf("the enemy, who has seen nothing, is shown %+v", theirs)
	}
	// Ordered elsewhere, they come out and go.
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdMove, Squad: 1, Point: "B"})
	run(s, 3)
	for _, tm := range s.Squad(1).Teams {
		if tm.In != "" || !s.Walkable(tm.X, tm.Y) {
			t.Fatalf("a fireteam is still inside or stuck in the wall: %+v", tm)
		}
	}
	// A building holds one side only: once ours are in, the enemy stays out.
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: 2, Place: "D-bunker-1"})
	run(s, 30)
	place(s.Squad(3), 450, 560)
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdHold, Squad: 3, Place: "D-bunker-1"})
	for i := 0; i < 100 && s.Squad(3) != nil; i++ {
		s.Step()
		if sq := s.Squad(3); sq != nil {
			for _, tm := range sq.Teams {
				if tm.In != "" {
					t.Fatal("the enemy went inside a building our squad holds")
				}
			}
		}
	}
}

func TestAGarrisonIsHiddenUntilCloseOrFiring(t *testing.T) {
	s, _ := simOn(t, rules, "small", sim.Config{})
	place(s.Squad(1), 450, 580)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: 1, Place: "D-bunker-1"})
	run(s, 12)
	// Militia come into sight of the bunker but stay out of everyone's range.
	place(s.Squad(2), 200, 150) // the other squad is elsewhere
	place(s.Squad(3), 215, 634)
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdHold, Squad: 3})
	run(s, 2)
	seen := 0
	for _, c := range s.Snapshot(1).Contacts {
		for _, tv := range c.Teams {
			if tv.In != "" {
				t.Fatalf("a fireteam inside the bunker is in sight from 235 away: %+v", tv)
			}
			seen++
		}
	}
	if outside := 3 - min(3, rules.LandmarkKinds["bunker"].Garrison); seen != outside {
		t.Fatalf("the enemy sees %d fireteams, want only the %d outside the bunker", seen, outside)
	}
	for _, l := range s.Snapshot(1).Landmarks {
		if l.Garrison != nil {
			t.Fatalf("the enemy knows who is in the bunker: %+v", l)
		}
	}
	// Closing in, they are shot at from the bunker, and that gives the garrison away.
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdAttack, Squad: 3, Place: "D-bunker-1"})
	inside := 0
	for i := 0; i < 300 && inside == 0; i++ {
		s.Step()
		for _, c := range s.Snapshot(1).Contacts {
			for _, tv := range c.Teams {
				if tv.In == "D-bunker-1" {
					inside++
				}
			}
		}
	}
	if inside == 0 {
		t.Fatal("the garrison was never seen, even after it opened fire")
	}
	known := false
	for _, l := range s.Snapshot(1).Landmarks {
		known = known || (l.ID == "D-bunker-1" && l.Garrison != nil && l.Garrison.Side == 0)
	}
	if !known {
		t.Fatal("the enemy saw fire from the bunker and still is not shown its garrison")
	}
}

// fight puts militia against commandos at the ridge and returns how many commandos and
// militia are left after a minute. The commandos are in the bunker or in the open.
func fight(t *testing.T, garrisoned bool) (commandos, militia int) {
	t.Helper()
	s, _ := simOn(t, rules, "small", sim.Config{Seed: 7})
	place(s.Squad(1), 450, 600)
	if garrisoned {
		must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: 1, Place: "D-bunker-1"})
	} else {
		must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: 1, Place: "N of D 250"})
	}
	run(s, 15)
	x, y := s.Squad(1).Center()
	for _, id := range []int{3, 4} {
		place(s.Squad(id), x, y-240)
		must(t, s, sim.Command{Side: 1, Kind: sim.CmdAttack, Squad: id, Contact: 0, Place: "N of D 60"})
	}
	if !garrisoned {
		for _, id := range []int{3, 4} {
			must(t, s, sim.Command{Side: 1, Kind: sim.CmdAttack, Squad: id, Place: "N of D 250"})
		}
	}
	run(s, 60)
	if sq := s.Squad(1); sq != nil {
		commandos, _ = sq.Strength()
	}
	for _, id := range []int{3, 4} {
		if sq := s.Squad(id); sq != nil {
			n, _ := sq.Strength()
			militia += n
		}
	}
	return commandos, militia
}

func TestABuildingProtectsItsGarrison(t *testing.T) {
	inC, inM := fight(t, true)
	outC, outM := fight(t, false)
	t.Logf("in the bunker: %d commandos and %d militia left; in the open: %d and %d", inC, inM, outC, outM)
	if inC-inM <= outC-outM {
		t.Fatalf("a bunker made no difference: %d:%d inside against %d:%d in the open", inC, inM, outC, outM)
	}
}

func TestABuildingFallsAndThrowsItsGarrisonOut(t *testing.T) {
	s, r := simOn(t, rules, "small", sim.Config{StartGold: 2000})
	place(s.Squad(3), 1208, 300)
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdHold, Squad: 3, Place: "K-ruin-1"})
	run(s, 12)
	inside := 0
	var wasIn []int
	for i, tm := range s.Squad(3).Teams {
		if tm.In == "K-ruin-1" {
			inside++
			wasIn = append(wasIn, i)
		}
	}
	if inside != r.LandmarkKinds["ruin"].Garrison {
		t.Fatalf("%d militia fireteams in the ruin", inside)
	}
	if s.Walkable(1208, 230) {
		t.Fatal("a building does not block the ground it stands on")
	}
	// Two rockets at once bring it down before anyone inside can get out.
	tank := buyFielded(t, s, 0, "rocketLauncher")
	place(tank, 965, 230)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdAttack, Squad: tank.ID, Place: "K-ruin-1"})
	var all []sim.Event
	for i := 0; i < 600 && landmark(s, "K-ruin-1").Kind != sim.Rubble; i++ {
		all = append(all, s.Step()...)
	}
	if landmark(s, "K-ruin-1").Kind != sim.Rubble {
		t.Fatal("rockets could not bring a ruin down in a minute")
	}
	if e := events(all, sim.EvBuildingFell, 1); len(e) != 1 || e[0].Place != "K-ruin-1" || e[0].Count != inside {
		t.Fatalf("the garrison's side was told %+v", e)
	}
	if e := events(all, sim.EvBuildingFell, 0); len(e) != 1 || e[0].Count != 0 {
		t.Fatalf("the side that shot it down, watching, was told %+v", e)
	}
	if sq := s.Squad(3); sq != nil {
		for _, i := range wasIn {
			if tm := sq.Teams[i]; tm.Members > 0 && (tm.In != "" || !s.Walkable(tm.X, tm.Y) || s.Nerve(&tm) == sim.Steady) {
				t.Fatalf("a fireteam thrown out of the ruin: %+v, nerve %s", tm, s.Nerve(&tm))
			}
		}
	}
	s.Step()
	if !s.Walkable(1208, 230) {
		t.Fatal("rubble still blocks the ground")
	}
	if tank.Order.Kind != sim.OrderHold {
		t.Errorf("the launcher's order is %q with nothing left to shoot", tank.Order.Kind)
	}
	for _, v := range s.Snapshot(0).Landmarks {
		if v.ID == "K-ruin-1" && (v.Kind != sim.Rubble || v.HP != 0 || v.Garrison != nil) {
			t.Errorf("side 0 is shown %+v", v)
		}
	}
	// Rubble is cover, and nothing to go inside.
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: 1, Place: "K-ruin-1"})
}

func TestAGarrisonLeavesABuildingAboutToFall(t *testing.T) {
	s, _ := simOn(t, rules, "small", sim.Config{StartGold: 2000})
	place(s.Squad(3), 1208, 300)
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdHold, Squad: 3, Place: "K-ruin-1"})
	run(s, 12)
	// A tank knocks it down a shell at a time, which gives the garrison time to see it coming.
	tank := buyFielded(t, s, 0, "tank")
	place(tank, 965, 230)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdAttack, Squad: tank.ID, Place: "K-ruin-1"})
	var all []sim.Event
	for i := 0; i < 600 && landmark(s, "K-ruin-1").Kind != sim.Rubble; i++ {
		all = append(all, s.Step()...)
	}
	if e := events(all, sim.EvBuildingFell, 1); len(e) != 1 || e[0].Count != 0 {
		t.Fatalf("the building fell on its garrison, or never fell: %+v", e)
	}
	for _, tm := range s.Squad(3).Teams {
		if tm.Members > 0 && tm.In != "" {
			t.Fatalf("a fireteam is still inside rubble: %+v", tm)
		}
	}
}

func TestHoldingSquadsTakeTheCoverAtTheirPost(t *testing.T) {
	s, _ := simOn(t, rules, "small", sim.Config{})
	place(s.Squad(1), 400, 600)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: 1, Point: "D"})
	run(s, 25)
	in := 0
	for _, tm := range s.Squad(1).Teams {
		if tm.Cover >= 1 {
			t.Fatalf("a fireteam holding Delta is in the open: %+v", tm)
		}
		if tm.In != "" {
			in++
		}
	}
	if in == 0 {
		t.Fatal("nobody went into the bunker at Delta")
	}
	if owner(s, "D") != 0 {
		t.Fatal("the squad took cover and lost the point: Delta is not ours")
	}
	// A tank holds its post in the open: cover is for men on foot.
	tank := buyFielded(t, s, 0, "tank")
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: tank.ID, Point: "D"})
	run(s, 30)
	for _, tm := range tank.Teams {
		if tm.Cover < 1 || tm.In != "" {
			t.Fatalf("a tank took cover: %+v", tm)
		}
	}
}

func TestPlaces(t *testing.T) {
	s, _ := simOn(t, rules, "small", sim.Config{})
	f := rules.PointByID("F")
	for text, want := range map[string]struct {
		kind string
		x, y float64
	}{
		"F":           {sim.PlacePoint, f.X, f.Y},
		"f":           {sim.PlacePoint, f.X, f.Y},
		"F-house-1":   {sim.PlaceLandmark, 800, 470},
		"d-bunker-1":  {sim.PlaceLandmark, 450, 634},
		"bridge-west": {sim.PlaceBridge, 680, 520},
		"N of F":      {sim.PlaceOffset, f.X, f.Y - sim.DefaultOffset},
		"e of f 200":  {sim.PlaceOffset, f.X + 200, f.Y},
		"SW of D 100": {sim.PlaceOffset, 450 - 100/math.Sqrt2, 690 + 100/math.Sqrt2},
	} {
		p, err := s.ResolvePlace(text)
		if err != nil || p.Kind != want.kind || math.Hypot(p.X-want.x, p.Y-want.y) > 0.01 {
			t.Errorf("%q → %+v %v, want %s at %.0f,%.0f", text, p, err, want.kind, want.x, want.y)
		}
	}
	for _, text := range []string{"", "Q", "F-house-9", "north of F", "N of Q", "N of F 5000", "N of"} {
		if _, err := s.ResolvePlace(text); !errors.Is(err, sim.ErrNoPlace) {
			t.Errorf("%q: %v, want no such place", text, err)
		}
	}
	// Other parts of the game add places of their own.
	s.Places = append(s.Places, func(id string) (sim.Place, bool) {
		return sim.Place{Kind: sim.PlaceStructure, ID: "works-1", X: 300, Y: 480}, id == "works-1"
	})
	if p, err := s.ResolvePlace("works-1"); err != nil || p.Kind != sim.PlaceStructure {
		t.Fatalf("a place from a finder: %+v %v", p, err)
	}

	// Orders go to places: an offset from a point, as written.
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: 1, Place: "N of D 150"})
	run(s, 40)
	if x, y := s.Squad(1).Center(); math.Hypot(x-450, y-540) > 40 {
		t.Fatalf("held %.0f,%.0f, not 150 north of Delta", x, y)
	}
	if o := s.Snapshot(0).Squads[0].Order; o.Place != "N of D 150" || o.Point != "" {
		t.Fatalf("the order is shown as %+v", o)
	}
	// What a unit can never stand on is refused: water for men, land for boats.
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdMove, Squad: 1, Place: "S of D 300"}); !errors.Is(err, sim.ErrUnreachable) {
		t.Fatalf("infantry sent into the sea: %v", err)
	}
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdMove, Squad: 1, Place: "nowhere"}); !errors.Is(err, sim.ErrNoPoint) {
		t.Fatalf("an unknown place: %v", err)
	}
}

func TestBlockedGroundIsWalkedRound(t *testing.T) {
	s, _ := simOn(t, rules, "small", sim.Config{})
	// A wall across the straight way from the headquarters to Bravo.
	s.SetBlocked("test-wall", 335, 340, 240, 20, true)
	if s.Walkable(335, 340) {
		t.Fatal("blocked ground is walkable")
	}
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdMove, Squad: 1, Point: "B"})
	for i := 0; i < 400; i++ {
		s.Step()
		for _, tm := range s.Squad(1).Teams {
			if !s.Walkable(tm.X, tm.Y) {
				t.Fatalf("tick %d: a fireteam walked through the wall at %.0f,%.0f", s.Tick, tm.X, tm.Y)
			}
		}
	}
	b := rules.PointByID("B")
	if x, y := s.Squad(1).Center(); math.Hypot(x-b.X, y-b.Y) > 60 {
		t.Fatalf("the squad did not get round the wall: it is at %.0f,%.0f", x, y)
	}
	s.SetBlocked("test-wall", 0, 0, 0, 0, false)
	if !s.Walkable(335, 340) {
		t.Fatal("the ground is still blocked after the wall is gone")
	}
}

func TestBridgesAndBuildingsAreAsLastSeen(t *testing.T) {
	s, _ := simOn(t, rules, "small", sim.Config{StartGold: 2000})
	wreck(t, s, 0)
	view := func(side int) sim.BridgeView {
		for _, v := range s.Snapshot(side).Bridges {
			if v.ID == "bridge-south" {
				return v
			}
		}
		return sim.BridgeView{}
	}
	if v := view(0); !v.Standing || v.HP != 1 || v.Visible {
		t.Fatalf("side 0 saw nothing and is shown %+v", v)
	}
	if v := view(1); v.Standing || !v.Visible {
		t.Fatalf("side 1 is looking at the fallen bridge and is shown %+v", v)
	}
	place(s.Squad(1), 600, 760)
	run(s, 1)
	if v := view(0); v.Standing || !v.Visible {
		t.Fatalf("side 0 is at the bank and is shown %+v", v)
	}
}

// Balance on each map, under scripted play from both ends. CALLSIGN_BALANCE sets how
// many seeds each pairing plays; the suite plays a few, `make balance` plays 100.
func TestFactionsAreRoughlyEvenOnEveryMap(t *testing.T) {
	seeds, limit := 4, 0.80
	if v, err := strconv.Atoi(os.Getenv("CALLSIGN_BALANCE")); err == nil && v > 0 {
		seeds, limit = v, 0.55
	}
	for _, id := range rules.MapIDs() {
		wins, games, hq := map[string]int{}, 0, 0
		for _, factions := range [][2]string{{"aegis", "ashfall"}, {"ashfall", "aegis"}} {
			for seed := 1; seed <= seeds; seed++ {
				s, _ := playOn(t, id, uint64(seed), factions)
				games++
				if s.Winner != sim.NoSide {
					wins[factions[s.Winner]]++
				}
				if s.Reason == "hq_destroyed" {
					hq++
				}
			}
		}
		t.Logf("%s: %d games: %v, %d by a fallen headquarters", id, games, wins, hq)
		for faction, n := range wins {
			if share := float64(n) / float64(games); share > limit {
				t.Errorf("%s: %s won %d of %d scripted matches (%.0f%%), over the %.0f%% limit", id, faction, n, games, 100*share, 100*limit)
			}
		}
	}
}
