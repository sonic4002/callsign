package sim

import (
	"errors"
	"fmt"
	"math"

	"callsign/shared"
)

// Sandbags. An infantry squad told to dig in builds a sandbag position where it stands:
// a small landmark that covers whoever is in it from the front it was built to face, and
// from nowhere else, so that flanking still works. Heavy weapons knock it down and a
// vehicle driving over it flattens it.

const (
	CmdFortify   = "fortify"
	OrderFortify = "fortify"

	Sandbags     = "sandbags"
	SandbagsFlat = "sandbagsFlat"

	EvFortified = "fortified" // Squad, Place: the position it built
)

var (
	ErrNotInfantry = errors.New("only an infantry squad can dig in")
	ErrNoSandbags  = errors.New("that squad has built all the sandbag positions it can")
)

// fortifyOrder tells an infantry squad to dig in where it stands.
func (s *Sim) fortifyOrder(c Command) (*Squad, error) {
	sq := s.Squad(c.Squad)
	if sq == nil || sq.Side != c.Side || sq.haul != nil {
		return nil, ErrNoSquad
	}
	if sq.unit.Class != "infantry" || sq.unit.Domain != "land" {
		return nil, ErrNotInfantry
	}
	if sq.Dug >= s.R.Match.SandbagLimit {
		return nil, ErrNoSandbags
	}
	x, y := sq.Center()
	x, y = s.nav.snapXY(navGround, x, y)
	sq.dig = 0
	sq.Order = Order{Kind: OrderFortify, X: x, Y: y, Tick: s.Tick}
	return sq, nil
}

// fortify is the digging: a squad that stands at its post and is not shot at works, and
// when the time is up its position stands and it holds it.
func (s *Sim) fortify(live []*teamRef) {
	quiet := int(s.R.Nerve.QuietSeconds * float64(s.R.TickRate))
	need := int(math.Round(s.R.Match.FortifySeconds * float64(s.R.TickRate)))
	for _, sq := range s.Squads {
		if !sq.Alive || sq.Order.Kind != OrderFortify {
			continue
		}
		working := true
		for i := range sq.Teams {
			t := &sq.Teams[i]
			if t.Members == 0 {
				continue
			}
			if s.Tick-t.lastShot <= quiet || dist(t.X, t.Y, sq.Order.X, sq.Order.Y) > 60 || t.Action == ActAdvance || t.Action == ActFallBack {
				working = false
			}
		}
		if !working {
			continue
		}
		if sq.dig++; sq.dig < need {
			continue
		}
		idx := s.buildSandbags(sq, live)
		l := &s.Landmarks[idx]
		sq.Dug++
		sq.dig = 0
		sq.Order = Order{Kind: OrderHold, X: l.X, Y: l.Y, Tick: s.Tick, Place: l.ID, landmark: idx + 1}
		s.emit(Event{Side: sq.Side, Kind: EvFortified, Squad: sq.ID, Place: l.ID, Point: l.Near})
	}
}

var bearingNames = []struct {
	id, en, he string
	dx, dy     float64
}{
	{"N", "north", "מצפון ל", 0, -1}, {"NE", "north-east", "מצפון-מזרח ל", 1, -1}, {"E", "east", "ממזרח ל", 1, 0}, {"SE", "south-east", "מדרום-מזרח ל", 1, 1},
	{"S", "south", "מדרום ל", 0, 1}, {"SW", "south-west", "מדרום-מערב ל", -1, 1}, {"W", "west", "ממערב ל", -1, 0}, {"NW", "north-west", "מצפון-מערב ל", -1, -1},
}

// buildSandbags puts a position where a squad stands, facing the nearest enemy in sight,
// or else the nearest point the side does not hold, or else the enemy headquarters. It
// returns the landmark's index.
func (s *Sim) buildSandbags(sq *Squad, live []*teamRef) int {
	x, y := sq.Order.X, sq.Order.Y
	fx, fy, bd := 0.0, 0.0, math.MaxFloat64
	for _, o := range live {
		if o.sq.Side == sq.Side || !o.t.Spotted || o.t.Members == 0 {
			continue
		}
		if d := dist(x, y, o.t.X, o.t.Y); d < bd {
			fx, fy, bd = o.t.X, o.t.Y, d
		}
	}
	if bd == math.MaxFloat64 {
		for i := range s.Points {
			p := &s.Points[i]
			if p.Owner == sq.Side || p.Kind == "hq" {
				continue
			}
			if d := dist(x, y, p.X, p.Y); d > 30 && d < bd {
				fx, fy, bd = p.X, p.Y, d
			}
		}
	}
	if bd == math.MaxFloat64 {
		hq := s.R.HQPoint(1 - sq.Side)
		fx, fy = hq.X, hq.Y
	}
	dx, dy := fx-x, fy-y
	if d := math.Hypot(dx, dy); d > 0.001 {
		dx, dy = dx/d, dy/d
	} else {
		dx, dy = 1, 0
	}
	// Named like the map's own landmarks: by where it lies from the nearest point.
	near := s.pointState(s.nearestPoint(x, y))
	b := bearingNames[0]
	best := -2.0
	ox, oy := x-near.X, y-near.Y
	for _, c := range bearingNames {
		n := math.Hypot(c.dx, c.dy)
		if dot := (ox*c.dx + oy*c.dy) / n; dot > best {
			b, best = c, dot
		}
	}
	n := 1
	for i := range s.Landmarks {
		if l := &s.Landmarks[i]; l.Built && l.Near == near.ID {
			n++
		}
	}
	word := s.R.LandmarkKinds[Sandbags].Word
	lm := &shared.Landmark{
		ID: fmt.Sprintf("%s-sandbags-%d", near.ID, n), Kind: Sandbags, X: x, Y: y, Near: near.ID, Bearing: b.id,
		Name: shared.Text{
			En: fmt.Sprintf("the %s %s of %s", word.En, b.en, near.Callsign.En),
			He: fmt.Sprintf("%s %s%s", word.He, b.he, near.Callsign.He),
		},
	}
	if n > 1 {
		lm.Name.En = fmt.Sprintf("the %s %s of %s (%d)", word.En, b.en, near.Callsign.En, n)
		lm.Name.He = fmt.Sprintf("%s %s%s (%d)", word.He, b.he, near.Callsign.He, n)
	}
	s.landIdx[lm.ID] = len(s.Landmarks)
	s.Landmarks = append(s.Landmarks, LandmarkState{
		Landmark: lm, Kind: Sandbags, HP: s.R.LandmarkKinds[Sandbags].HP, gSide: NoSide,
		Built: true, FaceX: dx, FaceY: dy, By: sq.Side,
	})
	// Each side remembers every landmark; the builder knows this one, the other does not yet.
	for side := range s.Sides {
		m := landmarkMemory{HP: 1, GSide: NoSide}
		if side == sq.Side {
			m.Kind = Sandbags
		}
		s.Sides[side].lands = append(s.Sides[side].lands, m)
	}
	return len(s.Landmarks) - 1
}

// inArc reports whether a shooter at (sx, sy) is in front of a position: inside the arc
// it was built to face.
func (s *Sim) inArc(l *LandmarkState, k shared.LandmarkKind, sx, sy float64) bool {
	dx, dy := sx-l.X, sy-l.Y
	d := math.Hypot(dx, dy)
	if d < 0.001 {
		return false
	}
	cos := (dx*l.FaceX + dy*l.FaceY) / d
	return cos >= math.Cos(k.Arc/2*math.Pi/180)
}

// sandbagsAt is the standing position a point lies in, or -1.
func (s *Sim) sandbagsAt(x, y float64) int {
	k := s.R.LandmarkKinds[Sandbags]
	for i := range s.Landmarks {
		if l := &s.Landmarks[i]; l.Kind == Sandbags && dist(x, y, l.X, l.Y) <= k.CoverRadius {
			return i
		}
	}
	return -1
}

// hitSandbags lets rounds from a heavy weapon aimed at a team in a position knock the
// position about too. Rifles do nothing to it.
func (s *Sim) hitSandbags(tr, tgt *teamRef) {
	if tr.u.Class == "infantry" && tr.u.Pierce == 0 {
		return
	}
	if i := s.sandbagsAt(tgt.t.X, tgt.t.Y); i >= 0 {
		s.Landmarks[i].dmg += tr.u.Damage * tr.u.Against("structure") * float64(tr.t.Members)
	}
}

// flatten knocks a position down for good.
func (s *Sim) flatten(i int) {
	l := &s.Landmarks[i]
	l.Kind, l.HP, l.dmg = SandbagsFlat, 0, 0
	for _, sq := range s.Squads {
		if sq.Alive && sq.Order.landmark == i+1 {
			sq.Order.landmark = 0 // it holds the ground, with nothing left to stand behind
		}
	}
}

// resolveSandbags applies the tick's damage to the positions.
func (s *Sim) resolveSandbags() {
	for i := range s.Landmarks {
		l := &s.Landmarks[i]
		if l.Kind != Sandbags || l.dmg == 0 {
			continue
		}
		l.HP -= l.dmg
		l.dmg = 0
		if l.HP <= 0 {
			s.flatten(i)
		}
	}
}

// BuiltLandmarks lists the positions built during the match that a side knows of, so that
// orders can name them by their name as well as by their id.
func (s *Sim) BuiltLandmarks(side int) []*shared.Landmark {
	var out []*shared.Landmark
	for i := range s.Landmarks {
		l := &s.Landmarks[i]
		if l.Built && (side == Spectator || s.Sides[side].lands[i].Kind != "") {
			out = append(out, l.Landmark)
		}
	}
	return out
}
