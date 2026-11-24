package sim

// CoverOf is the cover factor a squad's first fireteam, standing still, has against a
// shooter at (sx, sy): a seam for the tests of directional cover.
func (s *Sim) CoverOf(sq *Squad, sx, sy float64) float64 {
	return s.coverAgainst(&teamRef{sq: sq, t: &sq.Teams[0], u: sq.unit}, sx, sy)
}
