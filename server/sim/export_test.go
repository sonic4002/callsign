package sim

// CoverOf is the cover factor a squad's first fireteam, standing still, has against a
// shooter at (sx, sy): a seam for the tests of directional cover.
func (s *Sim) CoverOf(sq *Squad, sx, sy float64) float64 {
	return s.coverAgainst(&teamRef{sq: sq, t: &sq.Teams[0], u: sq.unit}, sx, sy)
}

// ShotAt marks a squad's fireteams as having just been shot at: a seam for the tests of
// what a team does under fire.
func (s *Sim) ShotAt(sq *Squad) {
	for i := range sq.Teams {
		sq.Teams[i].lastShot = s.Tick
	}
}

// Overlap is the deepest that two bodies on the map overlap right now (0 when none do)
// and the squads they belong to: a seam for the tests of bodies. Teams inside a building
// take no room, and a crushing vehicle may be over enemy infantry.
func (s *Sim) Overlap() (depth float64, a, b *Squad) {
	live := s.liveTeams()
	for i, x := range live {
		if x.t.In != "" || x.sq.sortie != nil {
			continue // a strike aircraft takes no room: it flies over everything (sortie.go)
		}
		for _, y := range live[i+1:] {
			if y.t.In != "" || y.sq.sortie != nil {
				continue
			}
			if d := touch(x, y) - dist(x.t.X, x.t.Y, y.t.X, y.t.Y); d > depth {
				depth, a, b = d, x.sq, y.sq
			}
		}
	}
	return depth, a, b
}

// Body is the radius of the room one team of a squad takes up.
func (s *Sim) Body(sq *Squad) float64 { return s.R.BodyOf(sq.unit) }
