package sim_test

import (
	"math"
	"testing"

	"callsign/server/bot"
	"callsign/server/sim"
)

// Bodies take room (bodies.go). These tests drive the match through orders and ticks
// and look at where the teams are.

// overlapEps is how far two bodies may be inside each other before it counts: rounding, no more.
const overlapEps = 1e-6

// noOverlap fails the test when two bodies on the map overlap.
func noOverlap(t *testing.T, s *sim.Sim) {
	t.Helper()
	if d, a, b := s.Overlap(); d > overlapEps {
		t.Fatalf("tick %d: squad %d (%s) and squad %d (%s) overlap by %.3f", s.Tick, a.ID, a.Unit, b.ID, b.Unit, d)
	}
}

// inRow puts a squad's teams down side by side along a line, a body's width and a
// little more apart, the first at (x, y).
func inRow(s *sim.Sim, sq *sim.Squad, x, y, dx, dy float64) {
	gap := 2*s.Body(sq) + 4
	for i := range sq.Teams {
		sq.Teams[i].X, sq.Teams[i].Y = x+dx*gap*float64(i), y+dy*gap*float64(i)
	}
	sq.Order = sim.Order{Kind: sim.OrderNone}
}

// silent keeps squads from firing for the rest of the test: these are tests of walking.
func silent(squads ...*sim.Squad) {
	for _, sq := range squads {
		for i := range sq.Teams {
			sq.Teams[i].Cooldown = 1 << 30
		}
	}
}

// tick runs the match for some seconds, checking after every tick that no bodies
// overlap, and calling each (when given) after every tick.
func tick(t *testing.T, s *sim.Sim, seconds float64, each func()) {
	t.Helper()
	for i := 0; i < int(seconds*float64(rules.TickRate)); i++ {
		s.Step()
		noOverlap(t, s)
		if each != nil {
			each()
		}
	}
}

func teamsOf(squads ...*sim.Squad) (out []*sim.Team) {
	for _, sq := range squads {
		for i := range sq.Teams {
			if sq.Teams[i].Members > 0 {
				out = append(out, &sq.Teams[i])
			}
		}
	}
	return out
}

func TestSquadsSentToOnePointEachFindASpot(t *testing.T) {
	s := heroSim(t, 21)
	aside(s)
	squads := []*sim.Squad{
		buyFielded(t, s, 0, "commandos"), buyFielded(t, s, 0, "commandos"),
		buyFielded(t, s, 0, "tank"), buyFielded(t, s, 0, "engineers"),
	}
	for i, sq := range squads {
		inRow(s, sq, 200, 420+34*float64(i), 1, 0)
		must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: sq.ID, Place: "N of D 260"})
	}
	px, py := squads[0].Order.X, squads[0].Order.Y
	arrived := map[int]bool{}
	for i := 0; i < 40*rules.TickRate; i++ {
		for _, e := range s.Step() {
			if e.Kind == sim.EvArrived {
				arrived[e.Squad] = true
			}
		}
		noOverlap(t, s)
	}
	type at struct{ x, y float64 }
	var before []at
	for _, tm := range teamsOf(squads...) {
		before = append(before, at{tm.X, tm.Y})
	}
	tick(t, s, 5, nil)
	for i, tm := range teamsOf(squads...) {
		if tm.X != before[i].x || tm.Y != before[i].y {
			t.Fatalf("a team is still shuffling about 40 seconds after the order: %.1f,%.1f then %.1f,%.1f", before[i].x, before[i].y, tm.X, tm.Y)
		}
		if d := math.Hypot(tm.X-px, tm.Y-py); d > 70 {
			t.Fatalf("a team stands %.0f from the point all four squads were sent to", d)
		}
	}
	for _, sq := range squads {
		if !arrived[sq.ID] {
			t.Fatalf("squad %d (%s) never reported arriving", sq.ID, sq.Unit)
		}
	}
}

// The west bridge of the small map, and the island it leads to.
const (
	bridgeX, bridgeY = 680.0, 520.0 // the middle of the west bridge's deck
	eastBridgeX      = 920.0
)

// bridgeScene has an Aegis rifle squad on the west bank, ordered to Foxtrot on the
// island, and one Ashfall fireteam standing in the middle of the west bridge; with
// both, another stands on the east bridge, so that there is no way round. Nobody fires.
func bridgeScene(t *testing.T, both bool) (s *sim.Sim, viper *sim.Squad, guards []*sim.Squad) {
	t.Helper()
	s = heroSim(t, 22)
	aside(s)
	viper = buyFielded(t, s, 0, "commandos")
	inRow(s, viper, 480, 440, 0, 1)
	guards = append(guards, buyFielded(t, s, 1, "sappers"))
	stand(guards[0], bridgeX, bridgeY)
	if both {
		guards = append(guards, buyFielded(t, s, 1, "sappers"))
		stand(guards[1], eastBridgeX, bridgeY)
	}
	silent(append(guards, viper)...)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdMove, Squad: viper.ID, Point: "F"})
	return s, viper, guards
}

func TestAnEnemyOnABridgeHoldsItUntilItIsDestroyedOrLeaves(t *testing.T) {
	onIsland := func(viper *sim.Squad) (n int) {
		for _, tm := range teamsOf(viper) {
			if tm.X > 720 && tm.X < 880 {
				n++
			}
		}
		return n
	}
	for _, how := range []string{"destroyed", "leaves"} {
		s, viper, guards := bridgeScene(t, true)
		tick(t, s, 60, func() {
			for _, tm := range teamsOf(viper) {
				if tm.X > bridgeX-s.Body(viper) && tm.X < eastBridgeX+s.Body(viper) {
					t.Fatalf("tick %d: a fireteam got past the enemy on the bridge, to x=%.0f", s.Tick, tm.X)
				}
			}
		})
		if !viper.Alive || guards[0].Teams[0].Members != 4 {
			t.Fatal("this is a test of walking: nobody was to be hurt")
		}
		if how == "destroyed" {
			// The squad is let fire: it shoots down the fireteam that holds it up, though
			// its order is to move.
			guards[0].Teams[0].HP = 1
			for _, tm := range teamsOf(viper) {
				tm.Cooldown = 0
			}
		} else {
			stand(guards[0], 300, 150)
		}
		for i := 0; i < 40*rules.TickRate && onIsland(viper) < 3; i++ {
			s.Step()
			noOverlap(t, s)
		}
		if how == "destroyed" && guards[0].Alive {
			t.Fatal("a squad held up by an enemy in range did not shoot it")
		}
		if onIsland(viper) < 3 {
			t.Fatalf("the enemy on the bridge %s, and 40 seconds later %d of 3 fireteams have crossed", how, onIsland(viper))
		}
	}
}

func TestASquadGoesRoundAHeldBridgeWhenThereIsAnotherWay(t *testing.T) {
	s, viper, _ := bridgeScene(t, false)
	arrived := false
	for i := 0; i < 120*rules.TickRate && !arrived; i++ {
		for _, e := range s.Step() {
			arrived = arrived || (e.Kind == sim.EvArrived && e.Squad == viper.ID)
		}
		noOverlap(t, s)
		for _, tm := range teamsOf(viper) {
			if tm.X > bridgeX-s.Body(viper) && tm.X < 720 && math.Abs(tm.Y-bridgeY) <= 40 {
				t.Fatalf("tick %d: a fireteam got past the enemy on the bridge", s.Tick)
			}
		}
	}
	if !arrived {
		x, y := viper.Center()
		t.Fatalf("the squad did not go round by the south and east bridges: after two minutes it is at %.0f,%.0f", x, y)
	}
}

// corridor walls off a passage one navigation cell wide, from x=240 to x=440 along
// y=470, on the open ground east of the western headquarters of the small map.
func corridor(s *sim.Sim) {
	s.SetBlocked("test-wall-north", 340, 430, 200, 60, true)
	s.SetBlocked("test-wall-south", 340, 510, 200, 60, true)
}

// passEachOther sends two friendly squads through the corridor from its two ends, and
// reports how many seconds it took until both stood at the far ends.
func passEachOther(t *testing.T, unit string, limit float64) float64 {
	t.Helper()
	s := heroSim(t, 23)
	aside(s)
	corridor(s)
	a, b := buyFielded(t, s, 0, unit), buyFielded(t, s, 0, unit)
	silent(a, b)
	inRow(s, a, 220, 470, -1, 0)
	inRow(s, b, 460, 470, 1, 0)
	a.Order = sim.Order{Kind: sim.OrderMove, X: 500, Y: 470}
	b.Order = sim.Order{Kind: sim.OrderMove, X: 180, Y: 470}
	there := func(sq *sim.Squad) bool {
		for _, tm := range teamsOf(sq) {
			if math.Hypot(tm.X-sq.Order.X, tm.Y-sq.Order.Y) > 40 {
				return false
			}
		}
		return true
	}
	for i := 0; i < int(limit*float64(rules.TickRate)); i++ {
		s.Step()
		noOverlap(t, s)
		for _, tm := range teamsOf(a, b) {
			if tm.X > 240 && tm.X < 440 && (tm.Y < 460 || tm.Y > 480) {
				t.Fatalf("tick %d: a team left the corridor through its wall, at %.1f,%.1f", s.Tick, tm.X, tm.Y)
			}
			if (tm.X < 240 || tm.X > 440) && (tm.Y < 400 || tm.Y > 540) {
				t.Fatalf("tick %d: a team went round the walls instead of through the corridor, at %.1f,%.1f", s.Tick, tm.X, tm.Y)
			}
		}
		if there(a) && there(b) {
			return float64(i+1) / float64(rules.TickRate)
		}
	}
	ax, ay := a.Center()
	bx, by := b.Center()
	t.Fatalf("%s: two friendly squads met in a corridor one cell wide and %v seconds later are at %.0f,%.0f and %.0f,%.0f", unit, limit, ax, ay, bx, by)
	return 0
}

func TestFriendsPassEachOtherInACorridorOneCellWide(t *testing.T) {
	// Alone, a squad walks the 280 units in about ten seconds.
	if took := passEachOther(t, "engineers", 25); took > 20 {
		t.Fatalf("two fireteams took %.0f seconds to pass each other", took)
	}
	// Tanks are wider than the corridor leaves room for two: they change places.
	passEachOther(t, "tank", 60)
}

func TestATankDrivesOverInfantryAndALightVehicleGoesRoundThem(t *testing.T) {
	drive := func(unit string, side int) (lost int, nearest float64, crossed bool) {
		s, _ := simOn(t, rules, drillGround, sim.Config{Seed: 24, StartGold: 5000, Base: []string{"barracks", "works"}})
		aside(s)
		v := buyFielded(t, s, side, unit)
		foot := s.Squad(3) // militia
		if side == 1 {
			foot = s.Squad(1) // commandos
		}
		// The men stand in a line across the vehicle's way, pinned: they cannot step aside.
		inRow(s, foot, arenaX, arenaY-27, 0, 1)
		foot.Order = sim.Order{Kind: sim.OrderHold, X: arenaX, Y: arenaY}
		inRow(s, v, arenaX-160, arenaY, -1, 0)
		silent(v, foot)
		for i := range v.Teams {
			v.Teams[i].HP = 1e6
		}
		v.Order = sim.Order{Kind: sim.OrderMove, X: arenaX + 140, Y: arenaY}
		before := members(foot)
		nearest = math.MaxFloat64
		for i := 0; i < 30*rules.TickRate; i++ {
			for j := range foot.Teams {
				foot.Teams[j].Stress = 1
			}
			s.Step()
			noOverlap(t, s)
			for _, vt := range teamsOf(v) {
				for _, ft := range teamsOf(foot) {
					nearest = math.Min(nearest, math.Hypot(vt.X-ft.X, vt.Y-ft.Y))
				}
			}
		}
		x, _ := v.Center()
		return before - members(foot), nearest, x > arenaX+100
	}
	lost, nearest, crossed := drive("tank", 0)
	if lost == 0 || !crossed || nearest > rules.Match.CrushRadius {
		t.Fatalf("a tank drove at a line of pinned infantry: %d men run down, nearest %.0f, through: %v", lost, nearest, crossed)
	}
	lost, nearest, crossed = drive("technical", 1)
	keep := rules.Match.Body["vehicle"] + rules.Match.Body["infantry"] + rules.Match.BodyStandoff
	if lost != 0 || nearest < keep-0.01 {
		t.Fatalf("a light vehicle is stopped by infantry like anything else: %d men run down, and it came within %.1f of them (it must keep %.0f off)", lost, nearest, keep)
	}
	if !crossed {
		t.Fatal("the light vehicle did not go round the men in its way")
	}
}

func TestTeamsInsideABuildingTakeNoRoom(t *testing.T) {
	s := heroSim(t, 25)
	aside(s)
	viper := buyFielded(t, s, 0, "commandos")
	inRow(s, viper, 520, 440, 1, 0)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: viper.ID, Place: "F-house-2"})
	sappers := buyFielded(t, s, 1, "sappers")
	stand(sappers, 300, 150)
	silent(viper, sappers)
	tick(t, s, 20, nil)
	house := landmark(s, "F-house-2")
	for _, tm := range teamsOf(viper) {
		if tm.In != house.ID {
			t.Fatalf("the squad is not inside the house it was sent to hold: %+v", tm)
		}
	}
	// Three teams within a few steps of each other: on the ground they would overlap.
	a, b := viper.Teams[0], viper.Teams[1]
	if d := math.Hypot(a.X-b.X, a.Y-b.Y); d >= 2*s.Body(viper) {
		t.Fatalf("teams inside stand %.1f apart: this test needs them closer than two bodies", d)
	}
	// An enemy walks up to the wall, far nearer the men inside than it could come to
	// men in the open: its spot is not taken and nothing keeps it off.
	sx, sy := house.X, house.Y+32
	inRow(s, sappers, house.X, house.Y+120, 1, 0)
	sappers.Order = sim.Order{Kind: sim.OrderMove, X: sx, Y: sy}
	tick(t, s, 10, nil)
	tm := sappers.Teams[0]
	if d := math.Hypot(tm.X-sx, tm.Y-sy); d > 2 {
		t.Fatalf("the enemy stopped %.1f short of the wall of a garrisoned house", d)
	}
	keep := 2*rules.Match.Body["infantry"] + rules.Match.BodyStandoff
	if d := math.Hypot(tm.X-a.X, tm.Y-a.Y); d >= keep {
		t.Fatalf("the enemy is %.0f from the men inside: this test needs it nearer than the %.0f bodies in the open keep", d, keep)
	}
}

// After every tick of whole scripted matches, on every map, no two bodies overlap: on
// the ground, on the water or in the air.
func TestNoBodiesOverlapInScriptedMatches(t *testing.T) {
	for _, id := range rules.MapIDs() {
		s, r := simOn(t, rules, id, sim.Config{Seed: 3, Base: []string{}})
		players := [2]*bot.Player{{Side: 0, Style: bot.Standard, R: r}, {Side: 1, Style: bot.Standard, R: r}}
		for !s.Over {
			if s.Tick%r.TickRate == 0 {
				for _, p := range players {
					for _, c := range p.Act(s.Snapshot(p.Side)) {
						if _, err := s.Apply(c); err != nil {
							t.Fatalf("%s tick %d: scripted command %+v refused: %v", id, s.Tick, c, err)
						}
					}
				}
			}
			s.Step()
			if d, a, b := s.Overlap(); d > overlapEps {
				t.Fatalf("%s tick %d: squad %d (%s) and squad %d (%s) overlap by %.3f", id, s.Tick, a.ID, a.Unit, b.ID, b.Unit, d)
			}
		}
	}
}
