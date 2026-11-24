package sim

import (
	"errors"
	"fmt"
	"math"

	"callsign/shared"
)

// Placing base structures. A side chooses where each one goes: on open land, clear of
// what already stands there, and close to its own base. The page tints the same ground
// green with the same rule (client/placement.js), so every check here is plain geometry
// on the map and on the structures a side can see; a test keeps the two in step.

var (
	ErrBadGround = errors.New("nothing can be built on that ground")
	ErrNoShore   = errors.New("a dockyard stands on the shore, beside open water")
	ErrBaseFull  = errors.New("your base has as many structures as it can hold")
)

// Clearances a new structure keeps, added to its own footprint.
const (
	clearLandmark  = 34.0 // from a landmark's centre
	clearStructure = 12.0 // from another structure's footprint
	clearFence     = 6.0  // from a fence segment
	clearField     = 10.0 // from the edge of a gold field
	clearEdge      = 20.0 // from the edge of the map
)

// CanPlace reports why a structure cannot stand at (x, y) for a side, or nil when it can.
func (s *Sim) CanPlace(side int, def *shared.Structure, x, y float64) error {
	m := &s.R.Map
	fp := def.Footprint
	if x < fp+clearEdge || y < fp+clearEdge || x > m.Width-fp-clearEdge || y > m.Height-fp-clearEdge {
		return fmt.Errorf("%w: too close to the edge of the map", ErrBadGround)
	}
	// Too far comes first: it is the reason a commander pointing across the map needs.
	if !s.baseReach(side, def, x, y) {
		return fmt.Errorf("%w: build within %.0f of your headquarters or %.0f of a finished structure of your own",
			ErrTooFar, s.R.Match.BaseRadius, s.R.Match.BaseReach)
	}
	if m.TerrainAt(x, y) != 'L' {
		return fmt.Errorf("%w: it must be open land", ErrBadGround)
	}
	if def.Role == shared.RoleDockyard {
		if !s.onShore(x, y, fp) {
			return ErrNoShore
		}
	} else {
		for _, d := range [][2]float64{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
			if m.TerrainAt(x+d[0]*fp, y+d[1]*fp) != 'L' {
				return fmt.Errorf("%w: it must be open land", ErrBadGround)
			}
		}
	}
	for i := range m.Landmarks {
		if dist(x, y, m.Landmarks[i].X, m.Landmarks[i].Y) < fp+clearLandmark {
			return fmt.Errorf("%w: %s is in the way", ErrNoRoom, m.Landmarks[i].Name.En)
		}
	}
	for i := range m.Bridges {
		b := &m.Bridges[i]
		if segDist(x, y, b.From[0], b.From[1], b.To[0], b.To[1]) < fp+b.Width {
			return fmt.Errorf("%w: %s is in the way", ErrNoRoom, b.Name.En)
		}
	}
	for i := range m.Gushers {
		if g := &m.Gushers[i]; dist(x, y, g.X, g.Y) < fp+g.FieldRadius+clearField {
			return fmt.Errorf("%w: that is a gold field", ErrNoRoom)
		}
	}
	for i := range m.Points {
		if p := &m.Points[i]; dist(x, y, p.X, p.Y) < fp+s.R.Match.CaptureRadius {
			return fmt.Errorf("%w: too close to %s", ErrNoRoom, p.Callsign.En)
		}
	}
	for _, st := range s.Structures {
		if st.Ruin {
			continue // a ruin is cleared away by what is built over it
		}
		if st.def.Role == shared.RoleFence {
			if segDist(x, y, st.AX, st.AY, st.BX, st.BY) < fp+clearFence {
				return fmt.Errorf("%w: a fence is in the way", ErrNoRoom)
			}
			continue
		}
		if dist(x, y, st.X, st.Y) < fp+st.def.Footprint+clearStructure {
			return fmt.Errorf("%w: the %s is in the way", ErrNoRoom, st.def.Name.En)
		}
	}
	return nil
}

// onShore reports whether there is water right beside a footprint at (x, y).
func (s *Sim) onShore(x, y, fp float64) bool {
	m := &s.R.Map
	for _, d := range [][2]float64{{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {0.7, 0.7}, {-0.7, 0.7}, {0.7, -0.7}, {-0.7, -0.7}} {
		for _, r := range []float64{m.Cell, fp + m.Cell/2} {
			if m.TerrainAt(x+d[0]*r, y+d[1]*r) == 'W' {
				return true
			}
		}
	}
	return false
}

// baseReach reports whether (x, y) is inside the ground a side may build its base on:
// near its headquarters, or near a finished base structure of its own. A dockyard has to
// reach the shore, so its ground stretches as far as the shore nearest the headquarters.
func (s *Sim) baseReach(side int, def *shared.Structure, x, y float64) bool {
	hq := s.R.HQPoint(side)
	r := s.R.Match.BaseRadius
	if def.Role == shared.RoleDockyard {
		r = math.Max(r, s.dockReach(side))
	}
	if dist(x, y, hq.X, hq.Y) <= r {
		return true
	}
	for _, st := range s.Structures {
		if st.Side == side && st.Standing() && st.def.Base() && dist(x, y, st.X, st.Y) <= s.R.Match.BaseReach {
			return true
		}
	}
	return false
}

// DockReach is how far from its headquarters a side may put a dockyard: far enough to
// reach the nearest shore.
func (s *Sim) dockReach(side int) float64 {
	hq := s.R.HQPoint(side)
	x, y := s.dockPosition(side)
	return dist(hq.X, hq.Y, x, y) + 120
}

// SiteFor chooses where a base structure goes when nobody said: the scripted enemy and
// an operator who was only told what to build both use it. It takes the first place of
// the standing base layout the structure fits (a refinery the one nearest a gusher, a
// dockyard the shore nearest the headquarters), and failing that the open ground
// nearest the headquarters.
func (s *Sim) SiteFor(side int, def *shared.Structure) (x, y float64, ok bool) {
	if def.Role == shared.RoleDockyard {
		dx, dy := s.dockPosition(side)
		if s.CanPlace(side, def, dx, dy) == nil {
			return dx, dy, true
		}
		return s.SiteNear(side, def, dx, dy)
	}
	best, bd := -1, math.MaxFloat64
	for i := range baseSlots {
		sx, sy := s.baseSlot(side, i)
		if s.CanPlace(side, def, sx, sy) != nil {
			continue
		}
		if def.Role != shared.RoleRefinery || len(s.R.Map.Gushers) == 0 {
			return sx, sy, true
		}
		for g := range s.R.Map.Gushers {
			if d := dist(sx, sy, s.R.Map.Gushers[g].X, s.R.Map.Gushers[g].Y); d < bd {
				best, bd = i, d
			}
		}
	}
	if best >= 0 {
		sx, sy := s.baseSlot(side, best)
		return sx, sy, true
	}
	hq := s.R.HQPoint(side)
	return s.SiteNear(side, def, hq.X+s.inward(side)*120, hq.Y)
}

// SiteNear is the nearest place to (x, y) where the structure may stand, searched ring by
// ring in a fixed order that is mirrored for the east side.
func (s *Sim) SiteNear(side int, def *shared.Structure, x, y float64) (float64, float64, bool) {
	if s.CanPlace(side, def, x, y) == nil {
		return x, y, true
	}
	const step = 20.0
	in := s.inward(side)
	for ring := 1; ring <= 24; ring++ {
		for dy := -ring; dy <= ring; dy++ {
			for dx := -ring; dx <= ring; dx++ {
				if max(abs(dx), abs(dy)) != ring {
					continue
				}
				if px, py := x+in*float64(dx)*step, y+float64(dy)*step; s.CanPlace(side, def, px, py) == nil {
					return px, py, true
				}
			}
		}
	}
	return x, y, false
}

// baseSite is where a build command puts a base structure: the very spot when the order
// gave one as an offset from a point, the nearest fitting ground when it named a place
// ("near Bravo"), and the side's own choice when it named none.
func (s *Sim) baseSite(c Command, def *shared.Structure) (float64, float64, error) {
	if c.Place == "" {
		if x, y, ok := s.SiteFor(c.Side, def); ok {
			return x, y, nil
		}
		return 0, 0, ErrNoRoom
	}
	pl, err := s.resolveFor(c.Side, c.Place)
	if err != nil {
		return 0, 0, err
	}
	switch {
	case pl.Kind == PlaceOffset:
		if err := s.CanPlace(c.Side, def, pl.X, pl.Y); err != nil {
			return 0, 0, err
		}
		return pl.X, pl.Y, nil
	case pl.Base != "":
		d := compass[pl.Base]
		pl.X, pl.Y = pl.X+d[0]*180, pl.Y+d[1]*180
	}
	x, y, ok := s.SiteNear(c.Side, def, pl.X, pl.Y)
	if !ok {
		if err := s.CanPlace(c.Side, def, pl.X, pl.Y); errors.Is(err, ErrTooFar) {
			return 0, 0, err
		}
		return 0, 0, ErrNoRoom
	}
	return x, y, nil
}

// bases counts a side's base structures, standing or going up.
func (s *Sim) bases(side int) int {
	n := 0
	for _, st := range s.Structures {
		if st.Side == side && !st.Ruin && st.def.Base() {
			n++
		}
	}
	return n
}

// clearRuins takes away the ruins a new structure is built over.
func (s *Sim) clearRuins(st *Structure) {
	for _, old := range s.Structures {
		if old != st && old.Ruin && !old.Gone && old.def.Role != shared.RoleFence &&
			dist(old.X, old.Y, st.X, st.Y) < old.def.Footprint+st.def.Footprint {
			old.Gone = true
		}
	}
}
