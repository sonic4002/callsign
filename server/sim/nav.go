package sim

import (
	"container/heap"
	"math"
)

// NavCell is the size of one navigation cell in map units. It is finer than the terrain
// grid so that a fence, a building or a bridge deck can block or open a narrow strip.
const NavCell = 20

// How a unit moves decides which cells it may enter.
const (
	navGround   = iota // land units: land, ice and standing bridges
	navCautious        // the same, but never onto a bridge that is about to fall
	navWater           // boats: water, also under bridges
	// The same two ground modes as one side's own units move: also closed where the
	// other side's fences stand. A side's own fence never stops its own troops.
	navGround0
	navCautious0
	navGround1
	navCautious1
	navModes
	navAir = -1 // aircraft cross everything and need no grid
)

// sided is a ground mode as one side's units use it.
func sided(mode, side int) int { return navGround0 + 2*side + mode }

// plain takes a side's mode back to the mode itself, and says whose it was (-1: nobody's).
func plain(mode int) (base, side int) {
	if mode >= navGround0 {
		return (mode - navGround0) % 2, (mode - navGround0) / 2
	}
	return mode, -1
}

type cell struct{ c, r int }

// nav is the navigation grid of one match: what the terrain allows, where the bridges
// lie, and what has been built or has fallen since. Every query is a pure function of
// that state, so paths never depend on anything but the match so far.
type nav struct {
	s          *Sim
	cols, rows int
	ground     []bool      // terrain a land unit walks on
	water      []bool      // terrain a boat sails on
	bridge     []int16     // index+1 of the bridge whose deck covers the cell, 0 for none
	blocked    []uint16    // how many obstacles stand on the cell
	foe        [2][]uint16 // how many fences of the other side stand on the cell, per side they stop
	blocks     map[string][]int
	ver        int // grows whenever a cell changes, so cached paths know they are stale

	comp    [navModes][]int32 // connected regions per mode, built on demand
	compVer [navModes]int
	snaps   [navModes]map[int]int // cell → nearest passable cell, per mode
	snapVer [navModes]int

	// Working space of the path search, kept between searches. A cell's entries count
	// only when its mark is the present search's number.
	g      []float64
	from   []int32
	opened []uint32
	closed []uint32
	search uint32
	heap   navHeap

	// Cells closed for one team's path search by the bodies standing in its way
	// (bodies.go): a cell is shut when its mark is shutID, and only while avoid is set.
	shut   []uint32
	shutID uint32
	avoid  bool
}

func (s *Sim) initNav() {
	m := &s.R.Map
	n := &nav{s: s, cols: int(math.Ceil(m.Width / NavCell)), rows: int(math.Ceil(m.Height / NavCell)), blocks: map[string][]int{}, ver: 1}
	size := n.cols * n.rows
	n.ground, n.water = make([]bool, size), make([]bool, size)
	n.bridge, n.blocked = make([]int16, size), make([]uint16, size)
	n.foe = [2][]uint16{make([]uint16, size), make([]uint16, size)}
	for r := 0; r < n.rows; r++ {
		for c := 0; c < n.cols; c++ {
			x, y := n.center(c, r)
			k := s.R.TerrainKinds[string(m.TerrainAt(x, y))]
			n.ground[r*n.cols+c], n.water[r*n.cols+c] = k.Ground, k.Water
			for i := range m.Bridges {
				if onDeck(&m.Bridges[i], x, y) {
					n.bridge[r*n.cols+c] = int16(i + 1)
				}
			}
		}
	}
	s.nav = n
}

// onDeck reports whether (x, y) lies on a bridge's deck: between its two ends and no
// farther from its centre line than half its width.
func onDeck(b *sharedBridge, x, y float64) bool {
	ax, ay, bx, by := b.From[0], b.From[1], b.To[0], b.To[1]
	t := ((x-ax)*(bx-ax) + (y-ay)*(by-ay)) / ((bx-ax)*(bx-ax) + (by-ay)*(by-ay))
	return t >= 0 && t <= 1 && math.Hypot(x-ax-t*(bx-ax), y-ay-t*(by-ay)) <= b.Width/2
}

func (n *nav) center(c, r int) (float64, float64) {
	return (float64(c) + 0.5) * NavCell, (float64(r) + 0.5) * NavCell
}

func (n *nav) cellOf(x, y float64) (int, int) {
	c, r := int(x/NavCell), int(y/NavCell)
	return max(0, min(n.cols-1, c)), max(0, min(n.rows-1, r))
}

func (n *nav) index(x, y float64) int {
	c, r := n.cellOf(x, y)
	return r*n.cols + c
}

// passable reports whether a unit moving in a mode may stand on a cell.
func (n *nav) passable(mode, i int) bool {
	mode, side := plain(mode)
	switch mode {
	case navWater:
		return n.water[i]
	}
	if n.blocked[i] > 0 || (side >= 0 && n.foe[side][i] > 0) {
		return false
	}
	if b := n.bridge[i]; b > 0 {
		br := &n.s.Bridges[b-1]
		return br.Standing && (mode != navCautious || !br.inDanger(n.s))
	}
	return n.ground[i]
}

// SetBlocked marks the ground under a rectangle centred on (x, y) as blocked or free
// again for land units. Whatever is built on the map (a structure, a fence run, a
// building) calls this with a key of its own; calling it again with the same key moves
// or removes the obstacle. Paths in progress are recomputed on their own.
func (s *Sim) SetBlocked(key string, x, y, w, h float64, blocked bool) {
	n := s.nav
	for _, i := range n.blocks[key] {
		n.blocked[i]--
	}
	delete(n.blocks, key)
	if blocked {
		c0, r0 := n.cellOf(x-w/2+0.01, y-h/2+0.01)
		c1, r1 := n.cellOf(x+w/2-0.01, y+h/2-0.01)
		var cells []int
		for r := r0; r <= r1; r++ {
			for c := c0; c <= c1; c++ {
				n.blocked[r*n.cols+c]++
				cells = append(cells, r*n.cols+c)
			}
		}
		n.blocks[key] = cells
	}
	n.ver++
}

// SetFenced closes the ground along a segment to one side's land units, or opens it
// again: a fence stops the troops of the side it was built against and nobody else.
// The key works as in SetBlocked.
func (s *Sim) SetFenced(key string, against int, ax, ay, bx, by float64, closed bool) {
	n := s.nav
	for _, i := range n.blocks[key] {
		n.foe[against][i]--
	}
	delete(n.blocks, key)
	if closed {
		seen := map[int]bool{}
		var cells []int
		steps := int(dist(ax, ay, bx, by)/(NavCell/2)) + 1
		for k := 0; k <= steps; k++ {
			t := float64(k) / float64(steps)
			i := n.index(ax+(bx-ax)*t, ay+(by-ay)*t)
			if !seen[i] {
				seen[i] = true
				n.foe[against][i]++
				cells = append(cells, i)
			}
		}
		n.blocks[key] = cells
	}
	n.ver++
}

// Walkable reports whether a land unit can stand at (x, y) right now.
func (s *Sim) Walkable(x, y float64) bool { return s.nav.passable(navGround, s.nav.index(x, y)) }

// Sailable reports whether a boat can be at (x, y).
func (s *Sim) Sailable(x, y float64) bool { return s.nav.passable(navWater, s.nav.index(x, y)) }

// regions labels every passable cell of a mode with the number of the region it lies
// in; two cells can reach each other exactly when their numbers match.
func (n *nav) regions(mode int) []int32 {
	if n.compVer[mode] == n.ver {
		return n.comp[mode]
	}
	comp := make([]int32, n.cols*n.rows)
	var next int32
	var stack []int
	for start := range comp {
		if comp[start] != 0 || !n.passable(mode, start) {
			continue
		}
		next++
		comp[start] = next
		stack = append(stack[:0], start)
		for len(stack) > 0 {
			i := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			c, r := i%n.cols, i/n.cols
			for _, d := range [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
				nc, nr := c+d[0], r+d[1]
				if nc < 0 || nr < 0 || nc >= n.cols || nr >= n.rows {
					continue
				}
				if j := nr*n.cols + nc; comp[j] == 0 && n.passable(mode, j) {
					comp[j] = next
					stack = append(stack, j)
				}
			}
		}
	}
	n.comp[mode], n.compVer[mode] = comp, n.ver
	return comp
}

// snap returns the passable cell nearest to a cell, itself when it is passable. Rings
// are searched outward and cells within a ring in a fixed order, so the answer never
// depends on anything but the grid.
func (n *nav) snap(mode, i int) int {
	if n.passable(mode, i) {
		return i
	}
	if n.snapVer[mode] != n.ver || n.snaps[mode] == nil {
		n.snaps[mode], n.snapVer[mode] = map[int]int{}, n.ver
	}
	if j, ok := n.snaps[mode][i]; ok {
		return j
	}
	c0, r0 := i%n.cols, i/n.cols
	best, bd := i, math.MaxFloat64
	for ring := 1; ring < n.cols+n.rows; ring++ {
		for r := r0 - ring; r <= r0+ring; r++ {
			for c := c0 - ring; c <= c0+ring; c++ {
				if (abs(c-c0) != ring && abs(r-r0) != ring) || c < 0 || r < 0 || c >= n.cols || r >= n.rows {
					continue
				}
				if j := r*n.cols + c; n.passable(mode, j) {
					if d := math.Hypot(float64(c-c0), float64(r-r0)); d < bd {
						best, bd = j, d
					}
				}
			}
		}
		// A cell in a later ring can still be nearer than a corner of this one.
		if bd <= float64(ring) {
			break
		}
	}
	n.snaps[mode][i] = best
	return best
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// snapXY moves a position to the nearest place a unit of that mode can be.
func (n *nav) snapXY(mode int, x, y float64) (float64, float64) {
	i := n.index(x, y)
	if n.passable(mode, i) {
		return x, y
	}
	j := n.snap(mode, i)
	return n.center(j%n.cols, j/n.cols)
}

// lineClear reports whether the straight walk from a to b stays on passable cells. It
// visits every cell the line passes through, so a walk never clips the corner of a
// blocked one.
func (n *nav) lineClear(mode int, ax, ay, bx, by float64) bool {
	c, r := n.cellOf(ax, ay)
	ec, er := n.cellOf(bx, by)
	dx, dy := bx-ax, by-ay
	stepC, stepR := 1, 1
	if dx < 0 {
		stepC = -1
	}
	if dy < 0 {
		stepR = -1
	}
	// How far along the line (0…1) the next cell border is, and the gap between borders.
	tC, tR, dC, dR := math.Inf(1), math.Inf(1), math.Inf(1), math.Inf(1)
	if dx != 0 {
		edge := float64(c) * NavCell
		if stepC > 0 {
			edge += NavCell
		}
		tC, dC = (edge-ax)/dx, NavCell/math.Abs(dx)
	}
	if dy != 0 {
		edge := float64(r) * NavCell
		if stepR > 0 {
			edge += NavCell
		}
		tR, dR = (edge-ay)/dy, NavCell/math.Abs(dy)
	}
	for guard := 0; guard < 4*(n.cols+n.rows); guard++ {
		if c == ec && r == er {
			return true
		}
		switch {
		case tC < tR:
			c, tC = c+stepC, tC+dC
		case tR < tC:
			r, tR = r+stepR, tR+dR
		default:
			// Through a corner: both cells beside it must be open too.
			if !n.open(mode, c+stepC, r) || !n.open(mode, c, r+stepR) {
				return false
			}
			c, r, tC, tR = c+stepC, r+stepR, tC+dC, tR+dR
		}
		if !n.open(mode, c, r) {
			return false
		}
	}
	return false
}

func (n *nav) open(mode, c, r int) bool {
	return c >= 0 && r >= 0 && c < n.cols && r < n.rows && n.passable(mode, r*n.cols+c) && !n.shutAt(r*n.cols+c)
}

// shutAt reports whether a cell is closed by a body for the search in hand.
func (n *nav) shutAt(i int) bool { return n.avoid && n.shut[i] == n.shutID }

type navNode struct {
	i    int
	f, h float64
}

type navHeap []navNode

func (h navHeap) Len() int { return len(h) }
func (h navHeap) Less(a, b int) bool {
	if h[a].f != h[b].f {
		return h[a].f < h[b].f
	}
	if h[a].h != h[b].h {
		return h[a].h < h[b].h
	}
	return h[a].i < h[b].i
}
func (h navHeap) Swap(a, b int) { h[a], h[b] = h[b], h[a] }
func (h *navHeap) Push(x any)   { *h = append(*h, x.(navNode)) }
func (h *navHeap) Pop() any {
	old := *h
	x := old[len(old)-1]
	*h = old[:len(old)-1]
	return x
}

var navSteps = [8][2]int{{1, 0}, {0, 1}, {-1, 0}, {0, -1}, {1, 1}, {-1, 1}, {-1, -1}, {1, -1}}

// path finds the way from a to b for a mode: the centres of the cells to pass, ending
// at b itself. When b cannot be reached it leads to the reachable cell nearest to b and
// says so. The start cell always counts as passable, so a unit standing on something
// that has just been blocked can still walk off it.
func (n *nav) path(mode int, ax, ay, bx, by float64) (way [][2]float64, reached bool) {
	start, goal := n.index(ax, ay), n.snap(mode, n.index(bx, by))
	exact := goal == n.index(bx, by)
	if start == goal {
		if exact {
			return [][2]float64{{bx, by}}, true
		}
		x, y := n.center(goal%n.cols, goal/n.cols)
		return [][2]float64{{x, y}}, false
	}
	gc, gr := goal%n.cols, goal/n.cols
	hOf := func(i int) float64 {
		dc, dr := math.Abs(float64(i%n.cols-gc)), math.Abs(float64(i/n.cols-gr))
		return math.Max(dc, dr) + (math.Sqrt2-1)*math.Min(dc, dr)
	}
	if n.g == nil {
		size := n.cols * n.rows
		n.g, n.from = make([]float64, size), make([]int32, size)
		n.opened, n.closed = make([]uint32, size), make([]uint32, size)
	}
	n.search++
	g, from, id := n.g, n.from, n.search
	n.heap = append(n.heap[:0], navNode{start, hOf(start), hOf(start)})
	open := &n.heap
	n.opened[start], from[start], g[start] = id, -1, 0
	best, bestH := start, hOf(start)
	for open.Len() > 0 {
		cur := heap.Pop(open).(navNode)
		if n.closed[cur.i] == id {
			continue
		}
		n.closed[cur.i] = id
		if cur.h < bestH {
			best, bestH = cur.i, cur.h
		}
		if cur.i == goal {
			break
		}
		c, r := cur.i%n.cols, cur.i/n.cols
		for k, d := range navSteps {
			nc, nr := c+d[0], r+d[1]
			if nc < 0 || nr < 0 || nc >= n.cols || nr >= n.rows {
				continue
			}
			j := nr*n.cols + nc
			if n.closed[j] == id || !n.passable(mode, j) || n.shutAt(j) {
				continue
			}
			step := 1.0
			if k >= 4 {
				// No cutting a corner between two blocked cells.
				if !n.passable(mode, r*n.cols+nc) || !n.passable(mode, nr*n.cols+c) || n.shutAt(r*n.cols+nc) || n.shutAt(nr*n.cols+c) {
					continue
				}
				step = math.Sqrt2
			}
			if cost := g[cur.i] + step; n.opened[j] != id || cost < g[j] {
				g[j], from[j], n.opened[j] = cost, int32(cur.i), id
				heap.Push(open, navNode{j, cost + hOf(j), hOf(j)})
			}
		}
	}
	end := goal
	reached = n.closed[goal] == id
	if !reached {
		end = best
	}
	for i := end; i != start && i >= 0; i = int(from[i]) {
		x, y := n.center(i%n.cols, i/n.cols)
		way = append(way, [2]float64{x, y})
	}
	for a, b := 0, len(way)-1; a < b; a, b = a+1, b-1 {
		way[a], way[b] = way[b], way[a]
	}
	if reached && exact {
		way = append(way, [2]float64{bx, by})
	}
	if len(way) == 0 {
		x, y := n.center(end%n.cols, end/n.cols)
		way = [][2]float64{{x, y}}
	}
	return way, reached && exact
}

// modeFor is how a fireteam moves under its squad's present order. Ordered to move, a
// squad crosses whatever bridge still stands; otherwise it stays off one about to fall.
func (s *Sim) modeFor(sq *Squad) int {
	switch sq.unit.Domain {
	case "air":
		return navAir
	case "sea":
		return navWater
	}
	if sq.Order.Kind == OrderMove {
		return sided(navGround, sq.Side)
	}
	return sided(navCautious, sq.Side)
}

// steer returns where a team should head this tick to get to (x, y): the place itself
// when the way is clear, otherwise the next corner of its path. ok is false when there
// is nowhere to go.
//
// A team that has waited on bodies in its way (bodies.go) is steered round them for a
// while: the cells they keep it out of count as closed. When that leaves no way to where
// it is going, it is steered as ever and waits for the way to clear.
func (s *Sim) steer(tr *teamRef, x, y float64) (float64, float64, bool) {
	t, n := tr.t, s.nav
	if s.Tick < t.detour && s.modeFor(tr.sq) != navAir {
		if s.shutBodies(tr, x, y) {
			n.avoid = true
			rx, ry, ok := s.steerOn(tr, x, y, true)
			n.avoid = false
			if t.pathOpen {
				return rx, ry, ok
			}
		}
		t.detour, t.detourNext, t.path = 0, s.Tick+detourRetry*s.R.TickRate, nil
	}
	return s.steerOn(tr, x, y, false)
}

func (s *Sim) steerOn(tr *teamRef, x, y float64, round bool) (float64, float64, bool) {
	mode := s.modeFor(tr.sq)
	t, n := tr.t, s.nav
	if mode == navAir || n.lineClear(mode, t.X, t.Y, x, y) {
		t.path, t.pathOpen = nil, true
		return x, y, true
	}
	goal := n.index(x, y)
	stale := t.path == nil || t.pathVer != n.ver || t.pathMode != mode || t.pathRound != round ||
		(round && s.Tick-t.pathTick >= s.R.TickRate) || // the bodies in the way move: look again every second
		// Going round a body, or making way for one, takes a team off its path: the
		// straight walk back to the next corner may no longer be clear.
		(len(t.path) > 0 && !n.lineClear(mode, t.X, t.Y, t.path[0][0], t.path[0][1]))
	if stale || (t.pathGoal != goal && s.Tick-t.pathTick >= s.R.TickRate/2) {
		t.path, t.pathOpen = n.path(mode, t.X, t.Y, x, y)
		t.pathGoal, t.pathVer, t.pathMode, t.pathTick, t.pathRound = goal, n.ver, mode, s.Tick, round
	}
	// Skip the corners that can already be walked past in a straight line.
	for len(t.path) > 1 && n.lineClear(mode, t.X, t.Y, t.path[1][0], t.path[1][1]) {
		t.path = t.path[1:]
	}
	if len(t.path) > 1 && dist(t.X, t.Y, t.path[0][0], t.path[0][1]) < 2 {
		t.path = t.path[1:]
	}
	if len(t.path) == 0 {
		return 0, 0, false
	}
	if len(t.path) == 1 && dist(t.X, t.Y, t.path[0][0], t.path[0][1]) < 1 {
		return 0, 0, false // as near as it can get
	}
	return t.path[0][0], t.path[0][1], true
}

// Reachable reports whether a squad's unit could get from where it stands to (x, y),
// by a bridge if need be, and through an enemy fence once it is breached.
func (s *Sim) Reachable(sq *Squad, x, y float64) bool {
	mode := s.modeFor(sq)
	if mode == navAir {
		return true
	}
	if mode != navWater {
		// Whatever bridge still stands counts, and so does ground behind an enemy fence:
		// a fence can be shot down, so it never makes a place one that cannot be reached.
		mode = navGround
	}
	n := s.nav
	goal := n.index(x, y)
	if !n.passable(mode, goal) {
		return false
	}
	cx, cy := sq.Center()
	return n.regions(mode)[n.snap(mode, n.index(cx, cy))] == n.regions(mode)[goal]
}
