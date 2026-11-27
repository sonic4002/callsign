package sim

import (
	"math"
)

// FogCell is the size of one fog-of-war cell in map units.
const FogCell = 40

// pointMemory is a map point as a side last saw it.
type pointMemory struct {
	Owner    int
	CapSide  int
	CapTicks int
	Visible  bool // in sight this tick
}

// landmarkMemory is a landmark as a side last saw it.
type landmarkMemory struct {
	Kind    string
	HP      float64 // share 0…1
	GSide   int     // who is inside, NoSide for nobody as far as the side knows
	GTeams  int
	Visible bool
}

// bridgeMemory is a bridge as a side last saw it.
type bridgeMemory struct {
	HP       float64 // share 0…1
	Standing bool
	Visible  bool
}

// FogView is the ground a side has seen at any time: a bitset of cells, row by row,
// lowest bit first. What is in sight right now follows from the side's own teams.
type FogView struct {
	Cell int    `json:"cell"`
	Cols int    `json:"cols"`
	Rows int    `json:"rows"`
	Seen []byte `json:"seen"` // base64 in JSON
}

func (s *Sim) fogSize() (cols, rows int) {
	return int(math.Ceil(s.R.Map.Width / FogCell)), int(math.Ceil(s.R.Map.Height / FogCell))
}

func (s *Sim) initFog() {
	cols, rows := s.fogSize()
	for side := range s.Sides {
		sd := &s.Sides[side]
		sd.explored = make([]byte, (cols*rows+7)/8)
		sd.points = make([]pointMemory, len(s.Points))
		for i := range s.Points {
			sd.points[i] = pointMemory{Owner: s.Points[i].Owner, CapSide: NoSide}
		}
		sd.enemyHQ = 1
		sd.lands = make([]landmarkMemory, len(s.Landmarks))
		for i := range s.Landmarks {
			sd.lands[i] = landmarkMemory{Kind: s.Landmarks[i].Kind, HP: 1, GSide: NoSide}
		}
		sd.bridges = make([]bridgeMemory, len(s.Bridges))
		for i := range s.Bridges {
			sd.bridges[i] = bridgeMemory{HP: 1, Standing: true}
		}
	}
	s.observe()
}

// reveal marks every cell whose centre lies within r of (x, y) as explored.
func (s *Sim) reveal(side int, x, y, r float64) {
	cols, rows := s.fogSize()
	seen := s.Sides[side].explored
	c0, c1 := max(0, int((x-r)/FogCell)), min(cols-1, int((x+r)/FogCell))
	r0, r1 := max(0, int((y-r)/FogCell)), min(rows-1, int((y+r)/FogCell))
	for row := r0; row <= r1; row++ {
		for col := c0; col <= c1; col++ {
			dx, dy := x-(float64(col)+0.5)*FogCell, y-(float64(row)+0.5)*FogCell
			if dx*dx+dy*dy <= r*r {
				i := row*cols + col
				seen[i/8] |= 1 << (i % 8)
			}
		}
	}
}

// Explored reports whether a side has ever seen the ground at (x, y).
func (s *Sim) Explored(side int, x, y float64) bool {
	cols, rows := s.fogSize()
	col, row := int(x/FogCell), int(y/FogCell)
	if x < 0 || y < 0 || col >= cols || row >= rows {
		return false
	}
	i := row*cols + col
	return s.Sides[side].explored[i/8]&(1<<(i%8)) != 0
}

// InSight reports whether a side can see (x, y) right now: from its headquarters, from
// a point it holds, or from any of its living teams.
func (s *Sim) InSight(side int, x, y float64) bool {
	if s.postSees(side, x, y) {
		return true
	}
	for _, sq := range s.Squads {
		if !sq.Alive || sq.Side != side {
			continue
		}
		for i := range sq.Teams {
			if t := &sq.Teams[i]; t.Members > 0 && dist(x, y, t.X, t.Y) <= sq.unit.Sight {
				return true
			}
		}
	}
	return false
}

// postSees reports whether (x, y) is in sight of a side's fixed posts: its headquarters
// and every point it holds.
func (s *Sim) postSees(side int, x, y float64) bool {
	hq := s.R.HQPoint(side)
	if dist(x, y, hq.X, hq.Y) <= s.R.HQ.Sight {
		return true
	}
	for i := range s.Points {
		p := &s.Points[i]
		if p.Owner == side && dist(x, y, p.X, p.Y) <= s.R.Match.PointSight {
			return true
		}
	}
	return s.structureSees(side, x, y)
}

// observe updates what each side has explored and what it remembers of the points and
// of the enemy headquarters. A side always knows the state of a point it holds: the
// crew there reports in, which is also how it learns the point was lost.
func (s *Sim) observe() {
	for side := range s.Sides {
		sd := &s.Sides[side]
		hq := s.R.HQPoint(side)
		s.reveal(side, hq.X, hq.Y, s.R.HQ.Sight)
		for i := range s.Points {
			if p := &s.Points[i]; p.Owner == side {
				s.reveal(side, p.X, p.Y, s.R.Match.PointSight)
			}
		}
		for _, sq := range s.Squads {
			if !sq.Alive || sq.Side != side {
				continue
			}
			for i := range sq.Teams {
				if t := &sq.Teams[i]; t.Members > 0 {
					s.reveal(side, t.X, t.Y, sq.unit.Sight)
				}
			}
		}
		s.observeStructures(side)
		for i := range s.Points {
			p, m := &s.Points[i], &sd.points[i]
			m.Visible = s.InSight(side, p.X, p.Y)
			if m.Visible || m.Owner == side {
				m.Owner, m.CapSide, m.CapTicks = p.Owner, p.CapSide, p.CapTicks
			}
		}
		if enemy := s.R.HQPoint(1 - side); s.InSight(side, enemy.X, enemy.Y) {
			sd.enemyHQ = math.Max(0, s.Sides[1-side].HQHP/s.R.HQ.HP)
		}
		s.observeHaul(side)
		s.observeMap(side)
		s.observeCraters(side)
	}
}

// observeMap updates what a side knows of the landmarks and bridges. A building's
// state is learned by seeing it. Who is inside is learned only from close by or when
// they give themselves away; a side always knows about its own troops.
func (s *Sim) observeMap(side int) {
	sd := &s.Sides[side]
	for i := range s.Landmarks {
		l, m := &s.Landmarks[i], &sd.lands[i]
		m.Visible = s.InSight(side, l.X, l.Y)
		if l.Built {
			// A position built in the match is learned by seeing it, and its builder knows it.
			if m.Visible || l.By == side {
				m.Kind, m.HP = l.Kind, s.landmarkShare(l)
			}
			continue
		}
		if s.R.LandmarkKinds[l.Landmark.Kind].Garrison == 0 {
			continue
		}
		gside, teams := s.garrison(l.ID)
		if gside == side {
			m.Kind, m.HP, m.GSide, m.GTeams = l.Kind, s.landmarkShare(l), gside, teams
			continue
		}
		if !m.Visible {
			continue
		}
		m.Kind, m.HP = l.Kind, s.landmarkShare(l)
		seen, close := 0, false
		for _, sq := range s.Squads {
			if !sq.Alive {
				continue
			}
			for j := range sq.Teams {
				t := &sq.Teams[j]
				switch {
				case t.Members == 0:
				case sq.Side != side && t.In == l.ID && t.Spotted:
					seen++
				case sq.Side == side && dist(t.X, t.Y, l.X, l.Y) <= s.R.Match.GarrisonSight:
					close = true
				}
			}
		}
		switch {
		case seen > 0:
			m.GSide, m.GTeams = gside, seen
		case close || m.GSide == side || l.Kind == Rubble:
			m.GSide, m.GTeams = NoSide, 0 // looked inside, or it was ours and we left
		}
	}
	for i := range s.Bridges {
		b, m := &s.Bridges[i], &sd.bridges[i]
		mx, my := b.mid()
		m.Visible = s.InSight(side, mx, my) || s.InSight(side, b.From[0], b.From[1]) || s.InSight(side, b.To[0], b.To[1])
		if m.Visible {
			m.HP, m.Standing = b.Share(), b.Standing
		}
	}
}
