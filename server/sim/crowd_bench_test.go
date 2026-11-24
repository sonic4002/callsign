package sim

import (
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
