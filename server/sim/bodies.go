package sim

import (
	"math"

	"callsign/shared"
)

// Bodies. Every fireteam, vehicle, boat and aircraft on the map takes up room: a circle
// whose radius comes from the rules (Match.Body per class, or the unit's own). Two
// bodies never end a tick closer than their radii added.
//
// Who takes room, and against whom:
//   - What walks or drives shares the ground; boats share the water; aircraft fly over
//     everything and keep apart only from other aircraft. Ground and water never meet.
//   - A team inside a building takes no room, and a squad still being deployed has no
//     team on the map at all.
//   - A vehicle that crushes is not stopped by enemy infantry: it drives over them, and
//     crush.go does the rest. It is the one pair that may overlap. Infantry are stopped
//     by that vehicle like by anything else.
//
// Friends make way. A team walking into a friend that is standing asks it to step
// aside, and it does when there is room: sideways off the walker's line, or ahead of it
// in a passage too narrow for that. It then stands aside a moment before going back to
// its post. A friend moving the same way is followed in file. Two friends that still
// block each other with no room to go round (head on in a narrow passage, or a walker
// behind a friend that cannot step aside) change places after a second.
//
// Enemies block. Bodies of the two sides on the ground or on the water are kept a
// standoff (Match.BodyStandoff) farther apart than touching, so nobody squeezes past an
// enemy: one fireteam on a bridge, in the gap of a fence or in a pass holds it until it
// is destroyed or leaves. One man or one truck holds no ground: a hero or a hauler
// neither keeps that standoff nor is kept at it; its body blocks like any other.
//
// A team whose step is taken goes round on one side and keeps to that side; when it
// cannot, it closes up and waits. After a second and a half of waiting on an enemy (four
// seconds on friends) its path is found again around the bodies standing in the way, and
// it keeps to that way for as long as there is one (another bridge, the long way about);
// if there is no way round it stays and waits for the way to clear. A team never moves
// unless the step brings it nearer to where it is going, so it does not jitter. And a
// team an enemy holds up fights: even ordered to move, it shoots what is in range
// rather than push on against a body that will not give.
//
// Where teams end up: a team ordered to a place claims the spot it will stand on. The
// oldest claim wins; a team whose slot is claimed or stood on takes the nearest free
// spot around it (post), so every team sent to one point has a spot of its own. A team
// the crowd keeps from its spot stands where it is, at the crowd's edge.
//
// Haulers. A hauler's body is the largest. Friends standing in its lane make way for
// it like for anyone; it follows a friend going its way; enemies it goes round (it
// keeps no standoff, so it passes as near as touching) and, with no way round, it waits.
// Its places at a field and at a drop-off are spots like a squad's: taken, it loads or
// unloads from the nearest free one.
//
// Order: teams move one at a time, in the order they were raised on even ticks and the
// other way round on odd ones, so neither side always gets the contested step. All of it
// is a function of the match so far.

const (
	layerLand = iota
	layerSea
	layerAir
)

const (
	bodyCell = 64.0 // side of one cell of the grid bodies are looked up in

	yieldTicks        = 5  // a team that made way stands aside this long after the last push
	followTicks       = 5  // a team behind a slower friend waits this long before overtaking
	heldAfter         = 5  // blocked by an enemy this long, a team turns to shooting what it can
	swapAfter         = 10 // friends blocking each other change places after this many ticks
	detourAfter       = 15 // blocked by an enemy this long, a team looks for a way round
	detourAfterFriend = 40 // the same when it is friends that stand in the way
	detourSeconds     = 8  // how long a way round is kept to after it was last found
	detourRetry       = 3  // seconds before looking for a way round again after finding none
	settleAfter       = 15 // blocked this long within reach of its spot, a team stands where it is
	postSlack         = 2  // room left between two bodies standing at their posts
	postRings         = 8  // how far out a free spot is looked for, in rings
)

// settled is the age of a claim to the spot a team stands on because it could get no
// nearer: older than any other.
const settled = -1

// The angles a blocked team tries to go round at, as cosine and sine.
var slideAngles = [3][2]float64{
	{math.Cos(25 * math.Pi / 180), math.Sin(25 * math.Pi / 180)},
	{math.Cos(50 * math.Pi / 180), math.Sin(50 * math.Pi / 180)},
	{math.Cos(75 * math.Pi / 180), math.Sin(75 * math.Pi / 180)},
}

func layerOf(u *shared.Unit) int {
	switch u.Domain {
	case "sea":
		return layerSea
	case "air":
		return layerAir
	}
	return layerLand
}

// bodyGrid is where the bodies are this tick, cell by cell, so that a team asks only
// its neighbours whether a place is free. Teams keep the order they were put in.
type bodyGrid struct {
	cols, rows int
	cells      [][]*teamRef
	reach      float64 // the widest any body keeps another away from its centre
}

func (g *bodyGrid) at(x, y float64) int {
	return g.row(y)*g.cols + g.col(x)
}

func (g *bodyGrid) col(x float64) int { return max(0, min(g.cols-1, int(x/bodyCell))) }
func (g *bodyGrid) row(y float64) int { return max(0, min(g.rows-1, int(y/bodyCell))) }

// put files a team under (x, y); cell is where the team keeps its place on this grid.
func (g *bodyGrid) put(tr *teamRef, cell *int, x, y float64) {
	*cell = g.at(x, y)
	g.cells[*cell] = append(g.cells[*cell], tr)
}

func (g *bodyGrid) drop(tr *teamRef, cell *int) {
	if *cell < 0 {
		return
	}
	list := g.cells[*cell]
	for i, o := range list {
		if o == tr {
			copy(list[i:], list[i+1:])
			list[len(list)-1] = nil
			g.cells[*cell] = list[:len(list)-1]
			break
		}
	}
	*cell = -1
}

func (g *bodyGrid) reset(s *Sim) {
	if g.cells == nil {
		g.cols, g.rows = int(s.R.Map.Width/bodyCell)+1, int(s.R.Map.Height/bodyCell)+1
		g.cells = make([][]*teamRef, g.cols*g.rows)
		for _, f := range s.R.Factions {
			for _, u := range f.Units {
				g.reach = math.Max(g.reach, s.R.BodyOf(&u))
			}
		}
		g.reach += s.R.Match.BodyStandoff
	}
	for i := range g.cells {
		g.cells[i] = g.cells[i][:0]
	}
}

// buildBodies files this tick's teams: where each body is, and the spot each has
// claimed. Teams inside a building take no room and are on neither grid.
func (s *Sim) buildBodies(live []*teamRef) {
	s.bodies.reset(s)
	s.spots.reset(s)
	s.live = live
	for _, tr := range live {
		if tr.t.In != "" {
			continue
		}
		s.bodies.put(tr, &tr.cell, tr.t.X, tr.t.Y)
		if s.claims(tr.t) {
			s.spots.put(tr, &tr.spot, tr.t.claimX, tr.t.claimY)
		}
	}
}

// startMoves opens the tick's movement: what each team did last tick is kept, and its
// step this tick starts at nothing.
func (s *Sim) startMoves(live []*teamRef) {
	for _, tr := range live {
		t := tr.t
		t.pdx, t.pdy, t.dx, t.dy = t.dx, t.dy, 0, 0
	}
}

// still reports whether a team has not moved this tick or the last.
func still(t *Team) bool { return t.dx == 0 && t.dy == 0 && t.pdx == 0 && t.pdy == 0 }

// runsDown reports whether a is a vehicle that drives over b instead of being stopped
// by it: a crushing vehicle and enemy infantry on the ground.
func runsDown(a, b *teamRef) bool {
	return a.u.Crushes && a.sq.Side != b.sq.Side && b.u.Class == "infantry" && b.u.Domain == "land"
}

// holdsGround reports whether a body is one that enemies are kept a standoff from.
func holdsGround(a *teamRef) bool { return a.sq.haul == nil && !a.u.Hero }

// touch is how far apart the centres of two bodies must be for them not to overlap, 0
// when they take no room from each other.
func touch(a, b *teamRef) float64 {
	if a.layer != b.layer || runsDown(a, b) || runsDown(b, a) {
		return 0
	}
	return a.r + b.r
}

// apart is how far from b's centre a must keep its own when it moves, 0 when b does not
// stop it: touching for friends and aircraft, the standoff more for enemies.
func (s *Sim) apart(a, b *teamRef) float64 {
	if a.layer != b.layer || runsDown(a, b) {
		return 0
	}
	d := a.r + b.r
	if a.sq.Side != b.sq.Side && a.layer != layerAir && holdsGround(a) && holdsGround(b) {
		d += s.R.Match.BodyStandoff
	}
	return d
}

// hit is the body that keeps a team from standing at (x, y): the one it would be most
// too close to, nil when the place is free. A body the team is already too close to
// stops only a step that brings it closer still, so two that find themselves inside each
// other's room (a squad that changed sides, a unit just made) can always part. but is a
// body left out of the count.
func (s *Sim) hit(tr *teamRef, x, y float64, but *teamRef) *teamRef {
	g, t := &s.bodies, tr.t
	reach := tr.r + g.reach
	c0, c1, r0, r1 := g.col(x-reach), g.col(x+reach), g.row(y-reach), g.row(y+reach)
	var worst *teamRef
	deep := 1e-6
	for r := r0; r <= r1; r++ {
		for c := c0; c <= c1; c++ {
			for _, o := range g.cells[r*g.cols+c] {
				if o == tr || o == but || o.t.Members == 0 {
					continue
				}
				need := s.apart(tr, o)
				if need == 0 {
					continue
				}
				d := dist(x, y, o.t.X, o.t.Y)
				if need-d > deep && d < dist(t.X, t.Y, o.t.X, o.t.Y)-1e-9 {
					worst, deep = o, need-d
				}
			}
		}
	}
	return worst
}

// shift moves a team's body to (x, y).
func (s *Sim) shift(tr *teamRef, x, y float64) {
	t := tr.t
	t.dx, t.dy = t.dx+x-t.X, t.dy+y-t.Y
	t.X, t.Y = x, y
	if tr.cell >= 0 {
		if c := s.bodies.at(x, y); c != tr.cell {
			s.bodies.drop(tr, &tr.cell)
			s.bodies.put(tr, &tr.cell, x, y)
		}
	}
}

// canStand reports whether a team may be at (x, y) as far as the map goes: on the map,
// on terrain it moves over, and not across a hostile fence from where it is.
func (s *Sim) canStand(tr *teamRef, x, y float64) bool {
	const edge = 10
	if x < edge || y < edge || x > s.R.Map.Width-edge || y > s.R.Map.Height-edge {
		return false
	}
	mode := s.modeFor(tr.sq)
	if mode == navAir {
		return true
	}
	return s.nav.passable(mode, s.nav.index(x, y)) && s.fenceStops(tr, x, y) == nil
}

// standing reports whether a team is one that can be asked to make way: it is not going
// anywhere this tick, or it has just made way and is still standing aside.
func (s *Sim) standing(tr *teamRef) bool {
	return (tr.plan.act != ActAdvance && tr.plan.act != ActFallBack) || s.Tick < tr.t.yield
}

// stride is how far a team gets in one tick where it stands.
func (s *Sim) stride(tr *teamRef) float64 {
	t := tr.t
	speed := tr.u.Speed * s.dt
	if p := s.R.Map.Pace; p > 0 {
		speed *= p // a bigger map is crossed faster, so the match keeps its pace
	}
	if tr.u.Domain == "land" && s.bridgeAt(t.X, t.Y) == nil {
		speed *= s.R.TerrainKinds[string(s.R.Map.TerrainAt(t.X, t.Y))].Speed
	}
	switch s.Nerve(t) {
	case Shaken:
		speed *= 0.6
	case Pinned:
		speed *= 0.15
	}
	return speed
}

// step takes a team from where it stands toward (nx, ny), the next step on its way to
// (tx, ty), as far as the bodies around it allow.
func (s *Sim) step(tr *teamRef, nx, ny, tx, ty float64) {
	t := tr.t
	sx, sy := nx-t.X, ny-t.Y
	l := math.Hypot(sx, sy)
	if l < 1e-9 {
		return
	}
	ux, uy := sx/l, sy/l
	t.hx, t.hy = ux, uy
	b := s.hit(tr, nx, ny, nil)
	if b == nil {
		s.shift(tr, nx, ny)
		t.jam = 0
		return
	}
	friend := b.sq.Side == tr.sq.Side
	if friend && s.standing(b) {
		s.makeWay(b, tr, ux, uy)
		if s.hit(tr, nx, ny, nil) == nil {
			s.shift(tr, nx, ny)
			t.jam = 0
			return
		}
	}
	// Behind a friend going the same way at least as fast: keep in file, closed up.
	bdx, bdy := b.t.dx, b.t.dy
	if bdx == 0 && bdy == 0 {
		bdx, bdy = b.t.pdx, b.t.pdy // its turn has not come this tick: what it did last tick
	}
	following := friend && !s.standing(b) && bdx*ux+bdy*uy >= 0.8*l
	if !following || t.jam >= followTicks {
		if s.Tick-t.leanTick > 2*swapAfter || t.lean == 0 {
			// Round the side the body is not on; dead ahead, to the right, as on a road.
			t.lean = -1
			if ux*(b.t.Y-t.Y)-uy*(b.t.X-t.X) < 0 {
				t.lean = 1
			}
		}
		here := dist(t.X, t.Y, tx, ty)
		for _, a := range slideAngles {
			for _, side := range [2]float64{float64(t.lean), -float64(t.lean)} {
				cx := t.X + (ux*a[0]-side*uy*a[1])*l
				cy := t.Y + (uy*a[0]+side*ux*a[1])*l
				// Only a step that gets it nearer: a team does not circle what it cannot pass.
				if dist(cx, cy, tx, ty) > here-0.2*l || !s.canStand(tr, cx, cy) || s.hit(tr, cx, cy, nil) != nil {
					continue
				}
				s.shift(tr, cx, cy)
				t.lean, t.leanTick, t.jam = int(side), s.Tick, 0
				return
			}
		}
	}
	// No way round this tick: close up to whatever is in the way, and wait.
	for _, f := range [2]float64{0.5, 0.25} {
		if cx, cy := t.X+sx*f, t.Y+sy*f; s.hit(tr, cx, cy, nil) == nil {
			s.shift(tr, cx, cy)
			break
		}
	}
	if following && t.dx*ux+t.dy*uy >= 0.5*l {
		return // keeping up with the friend ahead is not being blocked
	}
	t.jam++
	if t.jam == 1 {
		t.stuck = 0
	}
	if friend && s.standing(b) {
		t.stuck++ // behind a friend that is where it means to be, and cannot make way
	} else {
		t.stuck = 0
	}
	if !friend && t.jam >= heldAfter {
		// Held up by an enemy: for a while the team would sooner shoot than push on (decide).
		t.held = s.Tick + 2*s.R.TickRate
	}
	if friend && t.jam >= swapAfter && s.swap(tr, b, ux, uy) {
		return
	}
	s.lookRound(tr, friend)
}

// lookRound has a team that has been blocked long enough find its path again around
// the bodies standing in its way: the enemy's, and its friends' too when it is friends
// it has been waiting on.
func (s *Sim) lookRound(tr *teamRef, friend bool) {
	t := tr.t
	wait := detourAfter
	if friend {
		wait = detourAfterFriend
	}
	if t.jam >= wait && s.Tick >= t.detourNext && s.Tick >= t.detour {
		t.detour, t.detourAll, t.path = s.Tick+detourSeconds*s.R.TickRate, friend, nil
	}
}

// makeWay has a standing team f step out of the way of its friend m, which is heading
// along (ux, uy): off m's line on the side f already stands, or ahead of m when there is
// no room there (a narrow passage, a neighbour), or else to the other side. Pushed again
// while it is still standing aside, it keeps to the side it took: a team is never sent
// back and forth across the line of the friend it makes way for. A pinned team stays down.
func (s *Sim) makeWay(f, m *teamRef, ux, uy float64) {
	t := f.t
	if s.Nerve(t) == Pinned {
		return
	}
	l := s.stride(f)
	again := s.Tick < t.yield && t.aside != 0
	side := 1.0
	if ux*(t.Y-m.t.Y)-uy*(t.X-m.t.X) < 0 {
		side = -1
	}
	if again {
		side = float64(t.aside)
	}
	for k, d := range [3][2]float64{{-uy * side, ux * side}, {ux, uy}, {uy * side, -ux * side}} {
		if k == 2 && again {
			break
		}
		x, y := t.X+d[0]*l, t.Y+d[1]*l
		if s.canStand(f, x, y) && s.hit(f, x, y, nil) == nil {
			s.shift(f, x, y)
			if k == 2 {
				side = -side
			}
			t.yield, t.aside, t.path = s.Tick+yieldTicks, int(side), nil
			return
		}
	}
}

// swap has two friends that block each other change places: a walker and the friend in
// its way that could not step aside, or two walkers head on where neither can go round.
// Friends going the same way do not: nothing would be gained.
func (s *Sim) swap(tr, b *teamRef, ux, uy float64) bool {
	t, o := tr.t, b.t
	moving := !s.standing(b)
	if moving && (o.hx != 0 || o.hy != 0) && o.hx*ux+o.hy*uy > -0.3 {
		return false
	}
	if moving && o.jam < 3 && !still(o) {
		return false // it is getting on: wait for it
	}
	ax, ay, bx, by := t.X, t.Y, o.X, o.Y
	if !s.canStand(tr, bx, by) || !s.canStand(b, ax, ay) || s.hit(tr, bx, by, b) != nil || s.hit(b, ax, ay, tr) != nil {
		return false
	}
	s.shift(tr, bx, by)
	s.shift(b, ax, ay)
	t.jam, t.lean, t.path = 0, 0, nil
	o.jam, o.lean, o.path = 0, 0, nil
	if !moving {
		o.yield = s.Tick + yieldTicks
	}
	return true
}

// bump is the body a team at (x, y) would stand on, nil for none: touching alone,
// without the standoff enemies are kept at. It is for a team that is thrown aside (men
// jumping out of a vehicle's way), which does not mind how near the enemy is.
func (s *Sim) bump(tr *teamRef, x, y float64) *teamRef {
	g := &s.bodies
	reach := tr.r + g.reach
	c0, c1, r0, r1 := g.col(x-reach), g.col(x+reach), g.row(y-reach), g.row(y+reach)
	for r := r0; r <= r1; r++ {
		for c := c0; c <= c1; c++ {
			for _, o := range g.cells[r*g.cols+c] {
				if o != tr && o.t.Members > 0 && dist(x, y, o.t.X, o.t.Y) < touch(tr, o)-1e-6 {
					return o
				}
			}
		}
	}
	return nil
}

// dodge has a team jump (dx, dy) out of a vehicle's way. A friend standing where it
// would land is shoved the same way first, when that friend has somewhere to go.
func (s *Sim) dodge(tr *teamRef, dx, dy float64) bool {
	t := tr.t
	x, y := t.X+dx, t.Y+dy
	if !s.Walkable(x, y) {
		return false
	}
	if b := s.bump(tr, x, y); b != nil {
		bx, by := b.t.X+dx, b.t.Y+dy
		if b.sq.Side != tr.sq.Side || b.layer != layerLand || !s.Walkable(bx, by) || s.bump(b, bx, by) != nil {
			return false
		}
		s.shift(b, bx, by)
		b.t.path = nil
		if s.bump(tr, x, y) != nil {
			return false
		}
	}
	s.shift(tr, x, y)
	t.path = nil
	return true
}

// settle is the last word on overlap for the tick: a team that was put down on top of
// another (out of a building, out of a structure's door, off ground a structure took)
// goes to the nearest free place. Of two, the one raised later moves.
func (s *Sim) settle(live []*teamRef) {
	g := &s.bodies
	for _, tr := range live {
		if tr.cell < 0 || tr.t.Members == 0 {
			continue
		}
		t := tr.t
		reach := tr.r + g.reach
		c0, c1, r0, r1 := g.col(t.X-reach), g.col(t.X+reach), g.row(t.Y-reach), g.row(t.Y+reach)
		over := false
		for r := r0; r <= r1 && !over; r++ {
			for c := c0; c <= c1 && !over; c++ {
				for _, o := range g.cells[r*g.cols+c] {
					if o.i < tr.i && o.t.Members > 0 && dist(t.X, t.Y, o.t.X, o.t.Y) < touch(tr, o)-1e-6 {
						over = true
						break
					}
				}
			}
		}
		if over {
			x, y := s.room(tr.sq, t, t.X, t.Y)
			s.shift(tr, x, y)
			t.path = nil
		}
	}
}

// freeSpot looks for a place around (x, y) that ok accepts and a unit moving in mode can
// stand on and walk to from (x, y) in a straight line. Rings are tried from the inside
// out, each sp wider than the last; on the first ring that has one, the place nearest to
// (nx, ny) is taken, the earliest on the ring when two are as near.
func (s *Sim) freeSpot(mode int, x, y, sp float64, rings int, nx, ny float64, ok func(x, y float64) bool) (float64, float64, bool) {
	const edge = 10
	n := s.nav
	for k := 1; k <= rings; k++ {
		bx, by, bd := 0.0, 0.0, math.MaxFloat64
		for j := 0; j < 6*k; j++ {
			a := 2 * math.Pi * float64(j) / float64(6*k)
			px, py := x+float64(k)*sp*math.Cos(a), y+float64(k)*sp*math.Sin(a)
			if px < edge || py < edge || px > s.R.Map.Width-edge || py > s.R.Map.Height-edge {
				continue
			}
			d := dist(px, py, nx, ny)
			if d >= bd {
				continue
			}
			if mode != navAir && (!n.passable(mode, n.index(px, py)) || !n.lineClear(mode, x, y, px, py)) {
				continue
			}
			if ok(px, py) {
				bx, by, bd = px, py, d
			}
		}
		if bd < math.MaxFloat64 {
			return bx, by, true
		}
	}
	return x, y, false
}

// huddle is a team's slot when its squad stands as close together as bodies allow,
// shoulder to shoulder: behind cover, or coming out of a door. spread is how far from
// the middle the slots lie.
func (s *Sim) huddle(u *shared.Unit, i, side int) (x, y, spread float64) {
	if u.Teams == 1 {
		return 0, 0, 0
	}
	spread = (s.R.BodyOf(u) + postSlack/2) / math.Sin(math.Pi/float64(u.Teams))
	a := 2 * math.Pi * float64(i) / float64(u.Teams)
	x, y = spread*math.Cos(a), spread*math.Sin(a)
	if side == 1 {
		x = -x
	}
	return x, y, spread
}

// room is the place nearest to (x, y) where a team of a squad can be put down without
// standing on anybody: (x, y) itself when it is free. self is the team being moved, nil
// for one not on the map yet. It asks every squad, so it is for the rare moments a team
// appears somewhere, not for walking.
func (s *Sim) room(sq *Squad, self *Team, x, y float64) (float64, float64) {
	r, layer := s.R.BodyOf(sq.unit), layerOf(sq.unit)
	free := func(px, py float64) bool {
		for _, o := range s.Squads {
			if (!o.Alive && o != sq) || layerOf(o.unit) != layer {
				continue
			}
			need := r + s.R.BodyOf(o.unit)
			for i := range o.Teams {
				if t := &o.Teams[i]; t != self && t.Members > 0 && t.In == "" && dist(px, py, t.X, t.Y) < need {
					return false
				}
			}
		}
		return true
	}
	if free(x, y) {
		return x, y
	}
	mode := navGround
	switch layer {
	case layerSea:
		mode = navWater
	case layerAir:
		mode = navAir
	}
	px, py, _ := s.freeSpot(mode, x, y, 2*r+postSlack, 2*postRings, x, y, free)
	return px, py
}

// post is the spot a team sent to (x, y) will stand on: (x, y) itself unless another
// body has it. The team claims the spot, and keeps it while it wants the same place.
// Among friends the oldest claim wins; whoever stands still where no claim says is in
// possession. A team that loses its spot takes the nearest free one around (x, y).
//
// A team that the others keep from the last steps to its spot does not push for ever:
// blocked for a while within reach of its place, it stands where it is, and that is its
// spot from then on, before any other claim. So does a team kept farther out by friends
// that stand in their own places: it stays at the edge of the crowd.
func (s *Sim) post(tr *teamRef, x, y float64) (float64, float64) {
	t := tr.t
	if t.In != "" {
		return x, y
	}
	claim := func(px, py float64) {
		t.claimX, t.claimY, t.claimTick = px, py, s.Tick
		s.spots.drop(tr, &tr.spot)
		s.spots.put(tr, &tr.spot, px, py)
	}
	if at := [2]float64{x, y}; !t.claimed || t.claimFor != at {
		t.claimed, t.claimFor, t.claimWait = true, at, 0
		claim(x, y)
	} else if tr.spot < 0 {
		s.spots.put(tr, &tr.spot, t.claimX, t.claimY) // a claim let go a while ago, and taken up again
	}
	t.claimSeen = s.Tick + 1
	sp := 2*tr.r + postSlack
	near := dist(t.X, t.Y, t.claimX, t.claimY) <= 2*sp || dist(t.X, t.Y, x, y) <= s.R.Match.HoldRadius
	// Farther out, only behind friends that have their own places and cannot make way:
	// the crowd around the point is full on this side, and the team stands at its edge.
	edge := t.stuck >= 2*settleAfter && dist(t.X, t.Y, x, y) <= postRings*sp
	if t.jam >= settleAfter && (near || edge) {
		claim(t.X, t.Y)
		t.claimTick = settled
	}
	if s.Tick < t.claimWait || s.postFree(tr, t.claimX, t.claimY, false) {
		return t.claimX, t.claimY
	}
	px, py, ok := s.freeSpot(s.modeFor(tr.sq), x, y, 2*tr.r+postSlack, postRings, t.X, t.Y, func(px, py float64) bool {
		return s.postFree(tr, px, py, true)
	})
	if !ok {
		// Nowhere near: go as close as the others let it, and look again in a second.
		px, py, t.claimWait = x, y, s.Tick+s.R.TickRate
	}
	claim(px, py)
	return px, py
}

// claims reports whether a team holds a claim to a spot this tick or the last.
func (s *Sim) claims(t *Team) bool { return t.claimed && s.Tick-t.claimSeen <= 0 }

// postFree reports whether a team may take (x, y) as its spot. A friend's claim stands
// in the way when it is older (any claim, when the team is choosing a new spot: all);
// so does any body standing still there that is at its own spot or has none. A new
// spot is chosen with a little room to spare; a spot already held is given up only when
// the other body would truly overlap it.
func (s *Sim) postFree(tr *teamRef, x, y float64, all bool) bool {
	t, g := tr.t, &s.spots
	slack := -0.01
	if all {
		slack = postSlack
	}
	reach := tr.r + g.reach + postSlack
	c0, c1, r0, r1 := g.col(x-reach), g.col(x+reach), g.row(y-reach), g.row(y+reach)
	for r := r0; r <= r1; r++ {
		for c := c0; c <= c1; c++ {
			for _, o := range s.spots.cells[r*g.cols+c] {
				ot := o.t
				if o == tr || o.layer != tr.layer || o.sq.Side != tr.sq.Side || ot.In != "" || ot.Members == 0 {
					continue
				}
				if (all || ot.claimTick < t.claimTick || (ot.claimTick == t.claimTick && o.i < tr.i)) &&
					dist(x, y, ot.claimX, ot.claimY) < tr.r+o.r+slack {
					return false
				}
			}
			for _, o := range s.bodies.cells[r*g.cols+c] {
				ot := o.t
				if o == tr || ot.Members == 0 || ot.dx != 0 || ot.dy != 0 {
					continue // itself, or a body on the move
				}
				friend := o.sq.Side == tr.sq.Side
				if friend && s.claims(ot) && dist(ot.X, ot.Y, ot.claimX, ot.claimY) > 3 {
					continue // stopped on its way to a spot of its own
				}
				need := s.apart(tr, o)
				if need == 0 {
					continue
				}
				if friend || !all {
					need += slack
				}
				if dist(x, y, ot.X, ot.Y) < need {
					return false
				}
			}
		}
	}
	return true
}

// shutBodies closes, for the path search of one team, the navigation cells that the
// bodies standing still around it keep it out of: the enemy's, and its friends' too
// when it is friends it has been waiting on. It reports whether (x, y) is left open.
func (s *Sim) shutBodies(tr *teamRef, x, y float64) bool {
	n, t := s.nav, tr.t
	if n.shut == nil {
		n.shut = make([]uint32, n.cols*n.rows)
	}
	n.shutID++
	for _, o := range s.live {
		if o == tr || o.t.In != "" || o.t.Members == 0 || !still(o.t) {
			continue
		}
		if o.sq.Side == tr.sq.Side && !t.detourAll {
			continue
		}
		need := s.apart(tr, o)
		if need == 0 {
			continue
		}
		// Half a cell more: a team is anywhere in its cell, not at its centre.
		need += NavCell / 2
		c0, r0 := n.cellOf(o.t.X-need, o.t.Y-need)
		c1, r1 := n.cellOf(o.t.X+need, o.t.Y+need)
		for r := r0; r <= r1; r++ {
			for c := c0; c <= c1; c++ {
				if cx, cy := n.center(c, r); dist(cx, cy, o.t.X, o.t.Y) < need {
					n.shut[r*n.cols+c] = n.shutID
				}
			}
		}
	}
	// The team itself stands pressed against what blocks it, inside the ground just
	// closed: the cells right around it stay open, so that it can walk away.
	c0, r0 := n.cellOf(t.X-1.5*NavCell, t.Y-1.5*NavCell)
	c1, r1 := n.cellOf(t.X+1.5*NavCell, t.Y+1.5*NavCell)
	for r := r0; r <= r1; r++ {
		for c := c0; c <= c1; c++ {
			n.shut[r*n.cols+c] = 0
		}
	}
	return n.shut[n.index(x, y)] != n.shutID
}
