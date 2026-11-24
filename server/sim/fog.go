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
			if dist(x, y, (float64(col)+0.5)*FogCell, (float64(row)+0.5)*FogCell) <= r {
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
	}
}
