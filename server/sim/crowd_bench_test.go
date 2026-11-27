package sim

import (
	"math"
	"slices"
	"testing"

	"callsign/shared"
)

// crowd is a match with far more on the field than the population cap allows: n squads
// a side of every kind the factions have, all sent to the middle of the map.
func crowd(tb testing.TB, mapID string, n int) *Sim {
	tb.Helper()
	r, err := shared.MustLoad().ForMap(mapID)
	if err != nil {
		tb.Fatal(err)
	}
	s, err := New(r, Config{Seed: 7, Factions: [2]string{"aegis", "ashfall"}, FullBase: true, LengthSeconds: 3600})
	if err != nil {
		tb.Fatal(err)
	}
	for side := 0; side < 2; side++ {
		f := r.Factions[s.Sides[side].Faction]
		var ids []string
		for id, u := range f.Units {
			if u.Class != shared.HaulerClass && !u.Hero {
				ids = append(ids, id)
			}
		}
		slices.Sort(ids)
		for i := 0; i < n; i++ {
			s.field(s.raise(side, ids[i%len(ids)]))
		}
	}
	mid := s.nearestPoint(r.Map.Width/2, r.Map.Height/2)
	for _, sq := range s.Squads {
		if sq.Alive && sq.haul == nil {
			// Whatever cannot get there (a boat sent inland) stays where it is.
			_, _ = s.Apply(Command{Side: sq.Side, Kind: CmdMove, Squad: sq.ID, Point: mid})
		}
	}
	return s
}

// One tick of a crowded match: 24 squads a side walking to one point and fighting there.
func BenchmarkCrowdTick(b *testing.B) {
	s := crowd(b, "small", 24)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if s.Over || s.Tick >= 900 {
			b.StopTimer()
			s = crowd(b, "small", 24)
			b.StartTimer()
		}
		s.Step()
	}
}

// Twice the population cap on each side, of every kind of unit, all sent to one point
// and fighting there: after every tick no two bodies overlap, and the same match played
// twice is the same match.
func TestACrowdNeverOverlapsAndIsTheSameEveryTime(t *testing.T) {
	a, b := crowd(t, "small", 24), crowd(t, "small", 24)
	// A team that steps one way and straight back the next tick is jittering.
	type step struct{ x, y, dx, dy float64 }
	last, turns, steps := map[*Team]step{}, map[*Team]int{}, 0
	for i := 0; i < 900 && !a.Over; i++ {
		a.Step()
		b.Step()
		for _, sq := range a.Squads {
			for j := range sq.Teams {
				tm := &sq.Teams[j]
				was, seen := last[tm]
				now := step{x: tm.X, y: tm.Y, dx: tm.X - was.x, dy: tm.Y - was.y}
				if !seen {
					now.dx, now.dy = 0, 0
				}
				last[tm] = now
				if tm.Members == 0 || (now.dx == 0 && now.dy == 0) {
					continue
				}
				steps++
				if now.dx*was.dx+now.dy*was.dy < -0.5*math.Hypot(now.dx, now.dy)*math.Hypot(was.dx, was.dy) {
					turns[tm]++
				}
			}
		}
		if d, x, y := a.Overlap(); d > 1e-6 {
			t.Fatalf("tick %d: squad %d (%s) and squad %d (%s) overlap by %.3f", a.Tick, x.ID, x.Unit, y.ID, y.Unit, d)
		}
		if a.Hash() != b.Hash() {
			t.Fatalf("tick %d: the same crowded match came out two ways", a.Tick)
		}
	}
	total, worst := 0, 0
	for _, n := range turns {
		total, worst = total+n, max(worst, n)
	}
	t.Logf("%d steps, %d of them straight back the way the team had just come; the worst team did it %d times", steps, total, worst)
	// Teams under fire do turn about (advance, fall back, jump clear of a tank): before
	// bodies took room this match had 441 such steps, 154 by one team. Blocking must not
	// add a shuffle of its own on top.
	if total > steps/50 || worst > 60 {
		t.Fatalf("teams jitter: %d of %d steps went straight back, %d by one team", total, steps, worst)
	}
}

// A full army (the population cap, in land units) is sent from its base to the point
// nearest the enemy's headquarters, on every map: out of the base, over the bridges in
// file, and into place around the point. It must all be there in not much more than the
// time the slowest of it needs to walk the way alone.
func TestAFullArmyLeavesItsBaseAndCrossesEveryMap(t *testing.T) {
	for _, id := range []string{"small", "medium", "large", "huge"} {
		r, err := shared.MustLoad().ForMap(id)
		if err != nil {
			t.Fatal(err)
		}
		s, err := New(r, Config{Seed: 9, Factions: [2]string{"aegis", "ashfall"}, FullBase: true, LengthSeconds: 3600})
		if err != nil {
			t.Fatal(err)
		}
		for _, sq := range s.Squads {
			if sq.Side == 1 {
				sq.Alive = false // the enemy takes no part: this is a test of walking
			}
		}
		f := r.Factions[s.Sides[0].Faction]
		var ids []string
		slowest := math.MaxFloat64
		for uid, u := range f.Units {
			if u.Domain == "land" && u.Class != shared.HaulerClass && !u.Hero {
				ids = append(ids, uid)
				slowest = math.Min(slowest, u.Speed)
			}
		}
		slices.Sort(ids)
		var army []*Squad
		for i := 0; i < r.Match.PopulationCap; i++ {
			sq := s.raise(0, ids[i%len(ids)])
			s.field(sq)
			army = append(army, sq)
		}
		home, enemy := r.HQPoint(0), r.HQPoint(1)
		var goal *PointState
		for i := range s.Points {
			p := &s.Points[i]
			if p.Kind == "hq" || !s.Reachable(army[0], p.X, p.Y) {
				continue
			}
			if goal == nil || dist(p.X, p.Y, enemy.X, enemy.Y) < dist(goal.X, goal.Y, enemy.X, enemy.Y) {
				goal = p
			}
		}
		way, _ := s.nav.path(navGround, home.X, home.Y, goal.X, goal.Y)
		length, px, py := 0.0, home.X, home.Y
		for _, w := range way {
			length, px, py = length+dist(px, py, w[0], w[1]), w[0], w[1]
		}
		pace := r.Map.Pace
		if pace <= 0 {
			pace = 1
		}
		alone := length / (slowest * pace)
		limit := 1.25*alone + 30
		for _, sq := range army {
			if _, err := s.Apply(Command{Side: 0, Kind: CmdMove, Squad: sq.ID, Point: goal.ID}); err != nil {
				t.Fatalf("%s: %v", id, err)
			}
		}
		arrived := map[int]bool{}
		for len(arrived) < len(army) && float64(s.Tick) < limit*float64(r.TickRate) {
			for _, e := range s.Step() {
				if e.Kind == EvArrived {
					arrived[e.Squad] = true
				}
			}
			if d, x, y := s.Overlap(); d > 1e-6 {
				t.Fatalf("%s tick %d: squad %d (%s) and squad %d (%s) overlap by %.3f", id, s.Tick, x.ID, x.Unit, y.ID, y.Unit, d)
			}
		}
		for _, sq := range army {
			if !arrived[sq.ID] {
				x, y := sq.Center()
				t.Errorf("%s: squad %d (%s) is not at %s after %.0f seconds (the walk alone takes %.0f): it is at %.0f,%.0f, %.0f away",
					id, sq.ID, sq.Unit, goal.ID, limit, alone, x, y, dist(x, y, goal.X, goal.Y))
			}
		}
		t.Logf("%s: %d squads at %s after %.0f seconds; the slowest walks the %.0f units alone in %.0f", id, len(arrived), goal.ID, float64(s.Tick)/float64(r.TickRate), length, alone)
	}
}
