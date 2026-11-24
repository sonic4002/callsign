package sim

import (
	"math"

	"callsign/shared"
)

// Rubble is what a building becomes when it falls: low cover and nothing to go inside.
const Rubble = "rubble"

// LandmarkState is one landmark in a match. Only buildings change: they take damage,
// hold a garrison, and fall.
type LandmarkState struct {
	*shared.Landmark
	Kind string  // the map's kind, or Rubble once a building has fallen
	HP   float64 // of a building; 0 for everything else

	dmg float64 // damage taken in the tick being resolved

	// Who is inside, counted at the start of every tick and kept up as teams go in and out.
	gSide  int
	gTeams int

	// A position built during the match (sandbags): the way it faces, as a unit vector,
	// and the side that built it. Built is false for the map's own landmarks.
	Built        bool
	FaceX, FaceY float64
	By           int
}

func (s *Sim) initLandmarks() {
	s.landIdx = map[string]int{}
	for i := range s.R.Map.Landmarks {
		l := &s.R.Map.Landmarks[i]
		k := s.R.LandmarkKinds[l.Kind]
		s.landIdx[l.ID] = len(s.Landmarks)
		s.Landmarks = append(s.Landmarks, LandmarkState{Landmark: l, Kind: l.Kind, HP: k.HP, gSide: NoSide})
		if k.Size > 0 {
			s.SetBlocked("landmark:"+l.ID, l.X, l.Y, k.Size, k.Size, true)
		}
	}
}

func (s *Sim) kindOf(l *LandmarkState) shared.LandmarkKind { return s.R.LandmarkKinds[l.Kind] }

func (s *Sim) landmarkByID(id string) (int, *LandmarkState) {
	if i, ok := s.landIdx[id]; ok {
		return i, &s.Landmarks[i]
	}
	return -1, nil
}

// countGarrisons works out who is inside every building.
func (s *Sim) countGarrisons() {
	for i := range s.Landmarks {
		s.Landmarks[i].gSide, s.Landmarks[i].gTeams = NoSide, 0
	}
	for _, sq := range s.Squads {
		if !sq.Alive {
			continue
		}
		for i := range sq.Teams {
			if t := &sq.Teams[i]; t.Members > 0 && t.In != "" {
				if _, l := s.landmarkByID(t.In); l != nil {
					l.gSide = sq.Side
					l.gTeams++
				}
			}
		}
	}
}

// Share is a building's hit points as a share of a new one; 1 for what cannot be damaged.
func (s *Sim) landmarkShare(l *LandmarkState) float64 {
	if full := s.R.LandmarkKinds[l.Landmark.Kind].HP; full > 0 && l.Kind != Rubble {
		return math.Max(0, l.HP/full)
	} else if l.Kind == Rubble {
		return 0
	}
	return 1
}

// garrison counts who is inside a building: the side, or NoSide when it is empty, and
// how many fireteams.
func (s *Sim) garrison(id string) (side, teams int) {
	if _, l := s.landmarkByID(id); l != nil {
		return l.gSide, l.gTeams
	}
	return NoSide, 0
}

// entryRadius is how close a fireteam must come to a building to go inside.
func (s *Sim) entryRadius(l *LandmarkState) float64 { return s.kindOf(l).Size/2 + 1.6*NavCell }

// coverSpot is where one fireteam of a holding squad should be: inside a building it
// was sent to or that stands at its post, behind the nearest cover, or at its plain
// slot. It returns the landmark chosen, -1 for none.
//
// These are the fireteam AI's two cover options. A squad ordered to hold takes the
// cover its post offers without being told; a squad sent to a landmark uses that one.
func (s *Sim) coverSpot(tr *teamRef, slotX, slotY float64) (x, y float64, landmark int) {
	sq, u := tr.sq, tr.u
	if u.Class != "infantry" || (sq.Order.Kind != OrderHold && sq.Order.Kind != OrderRepair && sq.Order.landmark == 0) {
		return slotX, slotY, -1
	}
	if sq.Order.ground || (u.Hero && sq.Order.landmark == 0) {
		// The order named the ground itself. And a hero goes inside only the building it
		// was sent to: it is one soldier with work to do, not a squad looking for a post.
		return slotX, slotY, -1
	}
	// How far from the post cover may be. At a map point the squad must stay inside the
	// capture radius, or it would hold the cover and lose the point.
	reach := s.R.Match.CoverSeek
	if sq.Order.Point != "" {
		reach = math.Min(reach, s.R.Match.CaptureRadius-6)
	}
	if sq.Order.Kind == OrderMove || sq.Order.Kind == OrderAttack {
		reach = 0 // only the landmark named in the order
	}
	best, bd, inside := -1, math.MaxFloat64, false
	for i := range s.Landmarks {
		l := &s.Landmarks[i]
		k := s.kindOf(l)
		named := sq.Order.landmark == i+1
		d := dist(sq.Order.X, sq.Order.Y, l.X, l.Y)
		if !named && d > reach {
			continue
		}
		room := k.Garrison > 0 && !s.failing(l) && s.roomFor(tr, l, k)
		if k.Garrison > 0 && !room && !named {
			continue // a full or failing building is no post; its wall may still be cover when named
		}
		// The named landmark first, then a building with room, then whatever is nearest.
		score := d
		if room {
			score -= 1e4
		}
		if named {
			score -= 1e6
		}
		if score < bd {
			best, bd, inside = i, score, room
		}
	}
	if best < 0 {
		return slotX, slotY, -1
	}
	l := &s.Landmarks[best]
	if inside {
		return l.X, l.Y, best
	}
	// Outside: close in around the landmark, well inside its cover.
	ox, oy := formation(tr.slot, u.Teams, sq.Side)
	r := s.kindOf(l).CoverRadius
	if s.kindOf(l).Size > 0 {
		// Beside a building, on the side nearer the post.
		dx, dy := sq.Order.X-l.X, sq.Order.Y-l.Y
		if d := math.Hypot(dx, dy); d > 1 {
			return l.X + dx/d*r*0.8 + ox*0.3, l.Y + dy/d*r*0.8 + oy*0.3, best
		}
		return l.X + r*0.8, l.Y + oy*0.3, best
	}
	return l.X + ox*0.35, l.Y + oy*0.35, best
}

// failing reports whether a building is close enough to falling that troops should get out.
func (s *Sim) failing(l *LandmarkState) bool {
	return s.kindOf(l).Garrison > 0 && s.landmarkShare(l) < 0.2
}

// roomFor reports whether a fireteam may be inside a building: it is in already, or the
// building is empty or its own side's and not full. Slots go to a squad's teams in order.
func (s *Sim) roomFor(tr *teamRef, l *LandmarkState, k shared.LandmarkKind) bool {
	if tr.t.In == l.ID {
		return true
	}
	side, teams := s.garrison(l.ID)
	if side != NoSide && side != tr.sq.Side {
		return false
	}
	// Teams of this squad ahead of this one that are still on their way count too, so a
	// squad does not send four teams to a door that takes three.
	ahead := 0
	for i := 0; i < tr.slot; i++ {
		if o := &tr.sq.Teams[i]; o.Members > 0 && o.In != l.ID {
			ahead++
		}
	}
	return teams+ahead < k.Garrison
}

// enterBuildings puts the fireteams that have reached the building they are heading for
// inside it, and takes out the ones that should not be inside any more.
func (s *Sim) enterBuildings(live []*teamRef) {
	for _, tr := range live {
		t := tr.t
		if t.Members == 0 {
			continue
		}
		if t.In != "" {
			_, l := s.landmarkByID(t.In)
			if tr.plan.leave || l == nil || s.kindOf(l).Garrison == 0 {
				s.leave(tr)
			}
			continue
		}
		if tr.plan.enter == 0 {
			continue
		}
		l := &s.Landmarks[tr.plan.enter-1]
		k := s.kindOf(l)
		if k.Garrison == 0 || s.failing(l) || dist(t.X, t.Y, l.X, l.Y) > s.entryRadius(l) || !s.roomFor(tr, l, k) {
			continue
		}
		_, before := s.garrison(l.ID)
		t.In, t.path = l.ID, nil
		l.gSide, l.gTeams = tr.sq.Side, l.gTeams+1
		ox, oy := formation(tr.slot, tr.u.Teams, tr.sq.Side)
		t.X, t.Y = l.X+ox*0.25, l.Y+oy*0.25
		if before == 0 {
			s.emit(Event{Side: tr.sq.Side, Kind: EvGarrisoned, Squad: tr.sq.ID, Place: l.ID, Point: s.nearestPoint(l.X, l.Y)})
		}
	}
}

// leave puts a fireteam just outside the building it was in.
func (s *Sim) leave(tr *teamRef) {
	t := tr.t
	_, l := s.landmarkByID(t.In)
	t.In = ""
	if l == nil {
		return
	}
	if l.gTeams--; l.gTeams <= 0 {
		l.gSide, l.gTeams = NoSide, 0
	}
	// Out of the door on the side it is going to, onto ground it can stand on.
	dx, dy := tr.sq.Order.X-l.X, tr.sq.Order.Y-l.Y
	d := math.Hypot(dx, dy)
	if d < 1 {
		dx, dy, d = 1, 0, 1
	}
	r := s.R.LandmarkKinds[l.Landmark.Kind].Size/2 + NavCell
	t.X, t.Y = s.nav.snapXY(navGround, l.X+dx/d*r, l.Y+dy/d*r)
}

// coverAgainst is the multiplier on a shot's chance to hit a fireteam, from the cover it
// is in, for a shooter at (sx, sy). Inside a building the cover is all round; behind a
// landmark it works against shooters on the far side, and from any side for a team right
// in the middle of it.
func (s *Sim) coverAgainst(tgt *teamRef, sx, sy float64) float64 {
	t := tgt.t
	if t.In != "" {
		if _, l := s.landmarkByID(t.In); l != nil {
			return s.kindOf(l).GarrisonCover
		}
	}
	if !s.canUseCover(tgt) {
		return 1
	}
	best := 1.0
	for i := range s.Landmarks {
		l := &s.Landmarks[i]
		k := s.kindOf(l)
		d := dist(t.X, t.Y, l.X, l.Y)
		if d > k.CoverRadius || k.Cover <= 0 || k.Cover >= best {
			continue
		}
		if k.Arc > 0 {
			// Sandbags cover from the front they were built to face, and from nowhere else.
			if s.inArc(l, k, sx, sy) {
				best = k.Cover
			}
			continue
		}
		if d < k.CoverRadius*0.4 || (l.X-t.X)*(sx-t.X)+(l.Y-t.Y)*(sy-t.Y) > 0 {
			best = k.Cover
		}
	}
	return best
}

// canUseCover reports whether a fireteam is in a state to benefit from cover: on foot,
// standing still, and on ground that offers any.
func (s *Sim) canUseCover(tr *teamRef) bool {
	if tr.u.Class != "infantry" || tr.plan.act == ActAdvance || tr.plan.act == ActFallBack {
		return false
	}
	return !s.R.TerrainKinds[string(s.R.Map.TerrainAt(tr.t.X, tr.t.Y))].NoCover
}

// noteCover records the cover each fireteam stands in, for its own side to see: the best
// factor any shooter could face, 1 for none.
func (s *Sim) noteCover(live []*teamRef) {
	for _, tr := range live {
		t := tr.t
		t.Cover = 1
		if t.In != "" {
			if _, l := s.landmarkByID(t.In); l != nil {
				t.Cover = s.kindOf(l).GarrisonCover
			}
			continue
		}
		if !s.canUseCover(tr) {
			continue
		}
		for i := range s.Landmarks {
			l := &s.Landmarks[i]
			if k := s.kindOf(l); k.Cover > 0 && k.Cover < t.Cover && dist(t.X, t.Y, l.X, l.Y) <= k.CoverRadius {
				t.Cover = k.Cover
			}
		}
	}
}

// resolveBuildings applies the tick's damage to buildings and brings down the ones with
// nothing left: the building becomes rubble and whoever was inside is put out, shaken.
func (s *Sim) resolveBuildings(live []*teamRef) {
	for i := range s.Landmarks {
		l := &s.Landmarks[i]
		if l.dmg == 0 {
			continue
		}
		dmg := l.dmg
		l.dmg = 0
		if s.kindOf(l).Garrison == 0 || l.Kind == Rubble {
			continue
		}
		if l.HP -= dmg; l.HP > 0 {
			continue
		}
		side, teams := s.garrison(l.ID)
		l.HP, l.Kind = 0, Rubble
		for _, tr := range live {
			if tr.t.In == l.ID && tr.t.Members > 0 {
				s.leave(tr)
				tr.t.Stress = math.Max(tr.t.Stress, math.Min(1, s.R.Nerve.ShakenAt+0.15))
			}
		}
		s.SetBlocked("landmark:"+l.ID, 0, 0, 0, 0, false)
		for o := 0; o < 2; o++ {
			if o == side || s.InSight(o, l.X, l.Y) {
				s.emit(Event{Side: o, Kind: EvBuildingFell, Place: l.ID, Point: s.nearestPoint(l.X, l.Y), Count: countIf(o == side, teams)})
			}
		}
	}
}

func countIf(cond bool, n int) int {
	if cond {
		return n
	}
	return 0
}
