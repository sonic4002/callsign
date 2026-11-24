package sim

import "math"

// Crushing. A heavy vehicle that drives through an infantry fireteam in the open runs a
// man down as it passes. Men inside a building, behind standing sandbags or in a grove
// are safe, and a fireteam that sees it coming steps aside when it is able to.

// EvCrushed tells a side one of its fireteams lost a man under a vehicle.
const EvCrushed = "crushed" // Squad, Contact: the vehicle squad, Point

// safeFromCrush reports whether a fireteam is somewhere a vehicle cannot run it down.
func (s *Sim) safeFromCrush(t *Team) bool {
	if t.In != "" {
		return true
	}
	if s.sandbagsAt(t.X, t.Y) >= 0 {
		return true
	}
	for i := range s.Landmarks {
		l := &s.Landmarks[i]
		if l.Kind == "grove" && dist(t.X, t.Y, l.X, l.Y) <= s.kindOf(l).CoverRadius {
			return true
		}
	}
	return false
}

// crush runs after the fireteams have moved. For every heavy vehicle that moved this
// tick: sandbags in its path are flattened; enemy infantry about to be run down step
// aside if they can; and those it reaches in the open lose a man.
func (s *Sim) crush(live []*teamRef) {
	r := s.R.Match.CrushRadius
	gap := int(s.R.Match.CrushSeconds * float64(s.R.TickRate))
	for _, v := range live {
		t := v.t
		if !v.u.Crushes || t.Members == 0 {
			continue
		}
		mx, my := t.X-t.prevX, t.Y-t.prevY
		step := math.Hypot(mx, my)
		moving := step > 0.2 && s.Tick > 0 && (t.prevX != 0 || t.prevY != 0)
		if !moving {
			continue
		}
		ux, uy := mx/step, my/step
		// A vehicle over a position flattens it, whoever built it.
		if i := s.sandbagsAt(t.X, t.Y); i >= 0 && dist(t.X, t.Y, s.Landmarks[i].X, s.Landmarks[i].Y) <= r {
			s.flatten(i)
		}
		for _, o := range live {
			f := o.t
			if o.sq.Side == v.sq.Side || o.u.Class != "infantry" || o.u.Domain != "land" || f.Members == 0 || s.safeFromCrush(f) {
				continue
			}
			dx, dy := f.X-t.X, f.Y-t.Y
			d := math.Hypot(dx, dy)
			ahead := dx*ux + dy*uy
			side := -dx*uy + dy*ux // which side of the vehicle's line the team stands on
			// It is coming, and near: step out of its way. A pinned team cannot.
			if d <= 4*r && ahead > 0 && math.Abs(side) < 1.6*r && s.Nerve(f) != Pinned {
				sgn := 1.0
				if side < 0 {
					sgn = -1
				}
				pace := o.u.Speed * s.dt * 1.4
				nx, ny := f.X-uy*sgn*pace, f.Y+ux*sgn*pace
				if s.Walkable(nx, ny) {
					f.X, f.Y = nx, ny
					dx, dy = f.X-t.X, f.Y-t.Y
					d = math.Hypot(dx, dy)
				}
			}
			if d > r || s.Tick-f.crushTick < gap {
				continue
			}
			f.crushTick = s.Tick
			f.HP -= o.u.HP
			f.Members--
			if f.HP <= 0 {
				f.Members = 0 // the last man standing was already wounded
			}
			f.lastShot = s.Tick
			f.Stress = math.Min(1, f.Stress+o.u.NerveResist*s.rankOf(o.sq).Nerve*s.R.Nerve.PerMemberLost*1.5)
			s.Sides[v.sq.Side].Destroyed += float64(o.u.Cost) / float64(max(1, o.u.Teams*o.u.Members))
			f.shooter = append(f.shooter[:0], v.sq)
			s.creditKill(o, 1)
			s.emit(Event{Side: o.sq.Side, Kind: EvCrushed, Squad: o.sq.ID, Contact: v.sq.ID, Point: s.nearestPoint(f.X, f.Y)})
			if f.Members <= 0 {
				f.Members, f.HP = 0, 0
				s.teamLost(o)
			}
			f.shooter = f.shooter[:0]
		}
	}
	for _, tr := range live {
		tr.t.prevX, tr.t.prevY = tr.t.X, tr.t.Y
	}
}
