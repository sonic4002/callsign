package sim

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"

	"callsign/shared"
)

// Structures are what a side builds: base structures that unlock units, defences that
// fire on their own, and fences that stop ground units. They are part of the match
// state: deterministic, hashed, and shown to the other side only as it last saw them.

const (
	EvStructureStarted  = "structure_started"  // Structure, Unit (its kind), Count seconds
	EvStructureBuilt    = "structure_built"    // Structure, Unit
	EvStructureLost     = "structure_lost"     // Structure, Unit, Owner: whose it was
	EvStructureCaptured = "structure_captured" // Structure, Unit, Owner: whose it is now
)

const (
	CmdBuild   = "build"
	CmdCapture = "capture"

	OrderCapture = "capture"
)

var (
	ErrNoStructure    = errors.New("your faction has no such structure")
	ErrNeedsStructure = errors.New("a structure is missing")
	ErrAlreadyBuilt   = errors.New("you already have one")
	ErrBuilding       = errors.New("one at a time")
	ErrTooFar         = errors.New("too far from your own ground")
	ErrNoRoom         = errors.New("no room to build there")
	ErrTooMany        = errors.New("you have as many as you can hold")
	ErrBadPlace       = ErrNoPlace
	ErrNotEngineers   = errors.New("only an engineer squad can do that")
	ErrNotCapturable  = errors.New("that cannot be taken over")
	ErrNoBridge       = ErrNotBridge
)

// structMemory is a structure as one side last saw it.
type structMemory struct {
	Known    bool
	Visible  bool // in sight this tick
	Side     int
	HP       float64 // share 0…1
	Building float64 // progress 0…1, 1 when it stands
	Ruin     bool
	Gone     bool
}

type Structure struct {
	ID      int    // the place id is "s<ID>"
	Side    int    // who owns it now
	Faction string // whose design it is; stays when it changes hands
	Kind    string // rules id within that faction
	Slot    int    // base slot, or -1 for defences and fences
	Run     int    // fence segments bought together share a run number, else 0
	X, Y    float64
	// A fence segment's two ends.
	AX, AY, BX, BY float64
	HP             float64
	BuildTicks     int // ticks until it stands; 0 once built
	BuildTotal     int
	Ruin           bool // destroyed; the wreck stays where it stood
	Gone           bool // a ruin that was cleared to build again
	Cooldown       int

	def  *shared.Structure
	seen [2]structMemory
	dmg  float64 // scratch for the tick being resolved
	hit  bool
	// alarm is the tick the owner was last told this structure is under attack.
	alarm int
}

// PlaceID is the id an order names this structure by.
func (st *Structure) PlaceID() string { return "s" + strconv.Itoa(st.ID) }

// Standing reports whether the structure is built and not destroyed.
func (st *Structure) Standing() bool { return !st.Ruin && st.BuildTicks == 0 }

// Def is the rules entry of the structure.
func (st *Structure) Def() *shared.Structure { return st.def }

// structurePlace is the finder that makes structures places: "s7" is structure 7.
func (s *Sim) structurePlace(id string) (Place, bool) {
	if n, err := strconv.Atoi(strings.TrimPrefix(id, "s")); err == nil && strings.HasPrefix(id, "s") {
		if st := s.structure(n); st != nil && !st.Gone {
			return Place{Kind: PlaceStructure, ID: st.PlaceID(), X: st.X, Y: st.Y, Structure: st}, true
		}
	}
	return Place{}, false
}

// baseSide turns front and rear into compass sides for a side of the map.
func (s *Sim) baseSide(side int, word string) string {
	front, rear := "east", "west"
	if s.inward(side) < 0 {
		front, rear = "west", "east"
	}
	switch word {
	case "north", "south", "east", "west":
		return word
	case "front":
		return front
	case "rear":
		return rear
	}
	return ""
}

var compass = map[string][2]float64{"north": {0, -1}, "south": {0, 1}, "east": {1, 0}, "west": {-1, 0}}

// inward is +1 for a side whose headquarters is on the west half, -1 on the east half.
func (s *Sim) inward(side int) float64 {
	if s.R.HQPoint(side).X > s.R.Map.Width/2 {
		return -1
	}
	return 1
}

// The base layout: where base structures go around a headquarters, in the order they
// are taken. Offsets are for a western base; an eastern one is mirrored.
var baseSlots = [][2]float64{{-60, -170}, {-60, 170}, {80, -280}, {200, -160}, {200, 160}}

func (s *Sim) baseSlot(side, slot int) (x, y float64) {
	hq := s.R.HQPoint(side)
	return hq.X + s.inward(side)*baseSlots[slot][0], hq.Y + baseSlots[slot][1]
}

// dockSlot is where a dockyard stands: on the shore nearest the headquarters.
const dockSlot = -2

func (s *Sim) dockPosition(side int) (x, y float64) {
	hq := s.R.HQPoint(side)
	return s.shoreNear(hq.X+s.inward(side)*60, hq.Y)
}

// shoreNear is the land nearest to (x, y) that has open water beside it: where a
// dockyard can stand. The search is by cell, nearest first, the lowest row and column
// breaking a tie.
func (s *Sim) shoreNear(x, y float64) (float64, float64) {
	m := &s.R.Map
	bx, by, bd := x, y, math.MaxFloat64
	for r := 0; r < len(m.Terrain); r++ {
		for c := 0; c < len(m.Terrain[r]); c++ {
			cx, cy := (float64(c)+0.5)*m.Cell, (float64(r)+0.5)*m.Cell
			if m.TerrainAt(cx, cy) != 'L' || !s.Walkable(cx, cy) {
				continue
			}
			wet := false
			for _, d := range [][2]float64{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
				wet = wet || s.Sailable(cx+d[0]*m.Cell, cy+d[1]*m.Cell)
			}
			if d := dist(x, y, cx, cy); wet && d < bd {
				bx, by, bd = cx, cy, d
			}
		}
	}
	return bx, by
}

func (s *Sim) structure(id int) *Structure {
	if id < 1 || id > len(s.Structures) {
		return nil
	}
	return s.Structures[id-1]
}

func (s *Sim) faction(side int) *shared.Faction {
	f := s.R.Factions[s.Sides[side].Faction]
	return &f
}

// Has reports whether a side has a standing structure with a role, its own or captured.
func (s *Sim) Has(side int, role string) bool {
	for _, st := range s.Structures {
		if st.Side == side && st.Standing() && st.def.Role == role {
			return true
		}
	}
	return false
}

// Site is a place haulers unload at.
type Site struct {
	X, Y      float64
	Structure int // 0 for the headquarters
}

// DropOffs lists where a side's haulers unload: its standing refineries, or else its
// headquarters. Workstream 3 (haulers) reads the economy's drop-off points only here.
func (s *Sim) DropOffs(side int) []Site {
	var out []Site
	for _, st := range s.Structures {
		if st.Side == side && st.Standing() && st.def.Role == shared.RoleRefinery {
			out = append(out, Site{X: st.X, Y: st.Y, Structure: st.ID})
		}
	}
	if len(out) == 0 {
		hq := s.R.HQPoint(side)
		out = append(out, Site{X: hq.X, Y: hq.Y})
	}
	return out
}

// blockGround is the one place the simulation says "this ground is now closed (or open
// again) to ground units". Workstream 1 owns the navigation grid and connects it here;
// until then only fences stop anything, by the straight-line check in fenceStops.
func (s *Sim) blockGround(st *Structure, closed bool) {
	_ = st
	_ = closed
}

// initStructures puts up what each side starts with.
func (s *Sim) initStructures(full bool, base []string) {
	for side := range s.Sides {
		roles := s.R.Match.StartStructures
		if len(base) > 0 {
			roles = base
		}
		if full {
			roles = shared.BaseRoles
		}
		f := s.faction(side)
		for _, role := range roles {
			id, def := f.StructureOfRole(role)
			if def == nil || !def.Base() {
				continue
			}
			st := s.raiseBase(side, id, def)
			st.HP, st.BuildTicks = def.HP, 0
			s.blockGround(st, true)
		}
	}
}

func (s *Sim) newStructure(side int, kind string, def *shared.Structure, x, y float64) *Structure {
	st := &Structure{
		ID: len(s.Structures) + 1, Side: side, Faction: s.Sides[side].Faction, Kind: kind, Slot: -1,
		X: x, Y: y, def: def, alarm: never,
	}
	st.BuildTotal = int(math.Round(def.BuildSeconds * float64(s.R.TickRate)))
	st.BuildTicks = st.BuildTotal
	st.HP = def.HP * buildStartHP
	s.Structures = append(s.Structures, st)
	return st
}

// buildStartHP is the share of its hit points a structure has when work begins.
const buildStartHP = 0.3

// raiseBase starts a base structure in the next free slot. The caller has checked that
// there is one.
func (s *Sim) raiseBase(side int, kind string, def *shared.Structure) *Structure {
	slot := s.freeSlot(side, def.Role)
	var x, y float64
	if slot == dockSlot {
		x, y = s.dockPosition(side)
	} else {
		x, y = s.baseSlot(side, slot)
	}
	// A ruin in the slot is cleared away.
	for _, old := range s.Structures {
		if old.Ruin && !old.Gone && old.def.Base() && dist(old.X, old.Y, x, y) < 1 {
			old.Gone = true
		}
	}
	st := s.newStructure(side, kind, def, x, y)
	st.Slot = slot
	return st
}

// freeSlot is the base slot a new structure of a role takes, or -1 when the base is full.
func (s *Sim) freeSlot(side int, role string) int {
	taken := func(x, y float64) bool {
		for _, st := range s.Structures {
			if !st.Ruin && st.def.Base() && dist(st.X, st.Y, x, y) < 1 {
				return true
			}
		}
		return false
	}
	if role == shared.RoleDockyard {
		if x, y := s.dockPosition(side); !taken(x, y) {
			return dockSlot
		}
		return -1
	}
	// A refinery goes where the haulers' trip is shortest: the free slot nearest a gusher.
	best, bd := -1, math.MaxFloat64
	for i := range baseSlots {
		x, y := s.baseSlot(side, i)
		if taken(x, y) {
			continue
		}
		if role != shared.RoleRefinery {
			return i
		}
		for g := range s.R.Map.Gushers {
			if d := dist(x, y, s.R.Map.Gushers[g].X, s.R.Map.Gushers[g].Y); d < bd {
				best, bd = i, d
			}
		}
		if len(s.R.Map.Gushers) == 0 {
			return i
		}
	}
	return best
}

// structureByKey finds a faction's structure by its id or by its role.
func structureByKey(f *shared.Faction, key string) (string, *shared.Structure) {
	if st, ok := f.Structures[key]; ok {
		return key, &st
	}
	return f.StructureOfRole(key)
}

// Build starts a structure and returns it. Apply does the same for a build command.
func (s *Sim) Build(c Command) (*Structure, error) {
	if s.Over {
		return nil, ErrOver
	}
	if c.Side != 0 && c.Side != 1 {
		return nil, ErrBadCommand
	}
	return s.build(c)
}

// build starts a structure. Base structures take the next free slot of the base;
// defences and fences take a place.
func (s *Sim) build(c Command) (*Structure, error) {
	f := s.faction(c.Side)
	kind, def := structureByKey(f, c.Structure)
	if def == nil || def.Role == shared.RoleHQ {
		return nil, ErrNoStructure
	}
	for _, role := range def.Requires {
		if !s.Has(c.Side, role) {
			_, need := f.StructureOfRole(role)
			return nil, fmt.Errorf("%w: the %s needs %s first", ErrNeedsStructure, def.Name.En, a(need.Name.En))
		}
	}
	// One base structure goes up at a time, and one defence or fence beside it.
	for _, st := range s.Structures {
		if st.Side == c.Side && !st.Ruin && st.BuildTicks > 0 && st.def.Base() == def.Base() {
			return nil, fmt.Errorf("%w: the %s is still going up", ErrBuilding, st.def.Name.En)
		}
	}
	switch def.Role {
	case shared.RoleDefence:
		return s.buildDefence(c, kind, def)
	case shared.RoleFence:
		return s.buildFence(c, kind, def)
	}
	for _, st := range s.Structures {
		if st.Side == c.Side && !st.Ruin && st.def.Role == def.Role {
			return nil, fmt.Errorf("%w: the %s", ErrAlreadyBuilt, st.def.Name.En)
		}
	}
	if s.freeSlot(c.Side, def.Role) == -1 {
		return nil, ErrNoRoom
	}
	if err := s.spend(c.Side, def.Cost); err != nil {
		return nil, err
	}
	st := s.raiseBase(c.Side, kind, def)
	s.started(st)
	return st, nil
}

func (s *Sim) started(st *Structure) {
	s.blockGround(st, true)
	if st.BuildTicks == 0 {
		s.emit(Event{Side: st.Side, Kind: EvStructureBuilt, Structure: st.PlaceID(), Unit: st.Kind, Point: s.nearestPoint(st.X, st.Y)})
		return
	}
	s.emit(Event{Side: st.Side, Kind: EvStructureStarted, Structure: st.PlaceID(), Unit: st.Kind,
		Point: s.nearestPoint(st.X, st.Y), Count: int(math.Ceil(st.def.BuildSeconds))})
}

// ownGround reports whether (x, y) is close enough to something a side holds to build
// there: its headquarters, a structure of its own, or a point it owns.
func (s *Sim) ownGround(side int, x, y float64) bool {
	r := s.R.Match.BuildRadius
	if hq := s.R.HQPoint(side); dist(x, y, hq.X, hq.Y) <= r {
		return true
	}
	for _, st := range s.Structures {
		if st.Side == side && !st.Ruin && st.def.Role != shared.RoleFence && dist(x, y, st.X, st.Y) <= r {
			return true
		}
	}
	for i := range s.Points {
		if p := &s.Points[i]; p.Owner == side && dist(x, y, p.X, p.Y) <= r {
			return true
		}
	}
	return false
}

// towardEnemy is the unit vector from a position to the enemy headquarters.
func (s *Sim) towardEnemy(side int, x, y float64) (float64, float64) {
	e := s.R.HQPoint(1 - side)
	d := dist(x, y, e.X, e.Y)
	if d < 1 {
		return s.inward(side), 0
	}
	return (e.X - x) / d, (e.Y - y) / d
}

// onLand reports whether something can be built at (x, y): open land, clear of the map
// edge, of water, ice and mountains, and of the map's own buildings.
func (s *Sim) onLand(x, y, margin float64) bool {
	if x < margin || x > s.R.Map.Width-margin || y < margin || y > s.R.Map.Height-margin {
		return false
	}
	return s.R.Map.TerrainAt(x, y) == 'L' && s.Walkable(x, y)
}

// clear reports whether a structure of a footprint fits at (x, y).
func (s *Sim) clear(x, y, footprint float64) bool {
	if !s.onLand(x, y, footprint+4) {
		return false
	}
	for side := range s.Sides {
		if hq := s.R.HQPoint(side); dist(x, y, hq.X, hq.Y) < footprint+70 {
			return false
		}
	}
	for _, st := range s.Structures {
		if !st.Ruin && st.def.Role != shared.RoleFence && dist(x, y, st.X, st.Y) < footprint+st.def.Footprint+6 {
			return false
		}
	}
	return true
}

func (s *Sim) buildDefence(c Command, kind string, def *shared.Structure) (*Structure, error) {
	n := 0
	for _, st := range s.Structures {
		if st.Side == c.Side && !st.Ruin && st.def.Role == shared.RoleDefence {
			n++
		}
	}
	if n >= s.R.Match.DefenceCap {
		return nil, fmt.Errorf("%w: %d defences", ErrTooMany, n)
	}
	place := c.Place
	if place == "" {
		place = "base:front"
	}
	pl, err := s.resolveFor(c.Side, place)
	if err != nil {
		return nil, err
	}
	x, y := pl.X, pl.Y
	switch {
	case pl.Base != "":
		d := compass[pl.Base]
		x, y = x+d[0]*200, y+d[1]*200
	default:
		// Beside the point or structure, on the side the enemy comes from.
		dx, dy := s.towardEnemy(c.Side, x, y)
		off := 60.0
		if pl.Structure != nil {
			off = pl.Structure.def.Footprint + def.Footprint + 20
		}
		x, y = x+dx*off, y+dy*off
	}
	// When the spot is taken, try around it in a fixed order.
	found := false
	for ring := 0; ring < 4 && !found; ring++ {
		for k := 0; k < 8 && !found; k++ {
			a := float64(k) * math.Pi / 4
			tx, ty := x+float64(ring)*45*math.Cos(a), y+float64(ring)*45*math.Sin(a)
			if s.clear(tx, ty, def.Footprint) && s.ownGround(c.Side, tx, ty) {
				x, y, found = tx, ty, true
			}
			if ring == 0 {
				break
			}
		}
	}
	if !found {
		if !s.ownGround(c.Side, x, y) {
			return nil, fmt.Errorf("%w: build within %.0f of your base, a structure or a point you hold", ErrTooFar, s.R.Match.BuildRadius)
		}
		return nil, ErrNoRoom
	}
	if err := s.spend(c.Side, def.Cost); err != nil {
		return nil, err
	}
	st := s.newStructure(c.Side, kind, def, x, y)
	s.started(st)
	return st, nil
}

// buildFence puts up a run of fence: along a side of the base, across the approach to a
// point, or from one place toward another.
func (s *Sim) buildFence(c Command, kind string, def *shared.Structure) (*Structure, error) {
	runs := map[int]bool{}
	next := 1
	for _, st := range s.Structures {
		if st.def.Role == shared.RoleFence {
			if st.Side == c.Side && !st.Ruin {
				runs[st.Run] = true
			}
			next = max(next, st.Run+1)
		}
	}
	if len(runs) >= s.R.Match.FenceRuns {
		return nil, fmt.Errorf("%w: %d fence runs", ErrTooMany, len(runs))
	}
	place := c.Place
	if place == "" {
		place = "base:front"
	}
	pl, err := s.resolveFor(c.Side, place)
	if err != nil {
		return nil, err
	}
	length := float64(def.Segments) * def.SegmentLength
	var ax, ay, bx, by float64
	switch {
	case c.Place2 != "":
		to, err := s.resolveFor(c.Side, c.Place2)
		if err != nil {
			return nil, err
		}
		d := dist(pl.X, pl.Y, to.X, to.Y)
		if d < def.SegmentLength {
			return nil, ErrNoRoom
		}
		// The run is centred between the two places and is as long as a run can be.
		run := math.Min(length, d)
		ux, uy := (to.X-pl.X)/d, (to.Y-pl.Y)/d
		mx, my := (pl.X+to.X)/2, (pl.Y+to.Y)/2
		ax, ay, bx, by = mx-ux*run/2, my-uy*run/2, mx+ux*run/2, my+uy*run/2
	case pl.Base != "":
		d := compass[pl.Base]
		cx, cy := pl.X+d[0]*280, pl.Y+d[1]*280
		ax, ay, bx, by = cx-d[1]*length/2, cy+d[0]*length/2, cx+d[1]*length/2, cy-d[0]*length/2
	default:
		dx, dy := s.towardEnemy(c.Side, pl.X, pl.Y)
		cx, cy := pl.X+dx*110, pl.Y+dy*110
		ax, ay, bx, by = cx-dy*length/2, cy+dx*length/2, cx+dy*length/2, cy-dx*length/2
	}
	if !s.ownGround(c.Side, (ax+bx)/2, (ay+by)/2) {
		return nil, fmt.Errorf("%w: build within %.0f of your base, a structure or a point you hold", ErrTooFar, s.R.Match.BuildRadius)
	}
	n := int(math.Round(dist(ax, ay, bx, by) / def.SegmentLength))
	type seg struct{ ax, ay, bx, by float64 }
	var segs []seg
	for i := 0; i < n; i++ {
		t0, t1 := float64(i)/float64(n), float64(i+1)/float64(n)
		g := seg{ax + (bx-ax)*t0, ay + (by-ay)*t0, ax + (bx-ax)*t1, ay + (by-ay)*t1}
		// A fence does not run into the sea, off the map, or through a structure.
		mx, my := (g.ax+g.bx)/2, (g.ay+g.by)/2
		if s.onLand(mx, my, 6) && s.clear(mx, my, 2) {
			segs = append(segs, g)
		}
	}
	if len(segs) == 0 {
		return nil, ErrNoRoom
	}
	if err := s.spend(c.Side, def.Cost); err != nil {
		return nil, err
	}
	var first *Structure
	for _, g := range segs {
		st := s.newStructure(c.Side, kind, def, (g.ax+g.bx)/2, (g.ay+g.by)/2)
		st.AX, st.AY, st.BX, st.BY, st.Run = g.ax, g.ay, g.bx, g.by, next
		s.blockGround(st, true)
		if first == nil {
			first = st
		}
	}
	s.emit(Event{Side: c.Side, Kind: EvStructureStarted, Structure: first.PlaceID(), Unit: kind,
		Point: s.nearestPoint(first.X, first.Y), Count: int(math.Ceil(def.BuildSeconds))})
	return first, nil
}

// construct moves every structure that is going up one tick closer to standing.
func (s *Sim) construct() {
	runBuilt := map[int]bool{}
	for _, st := range s.Structures {
		if st.Ruin || st.BuildTicks == 0 {
			continue
		}
		st.HP = math.Min(st.def.HP, st.HP+st.def.HP*(1-buildStartHP)/float64(st.BuildTotal))
		if st.BuildTicks--; st.BuildTicks > 0 {
			continue
		}
		if st.Run != 0 {
			// A fence run is reported once, not once per segment.
			if runBuilt[st.Run] {
				continue
			}
			runBuilt[st.Run] = true
		}
		s.emit(Event{Side: st.Side, Kind: EvStructureBuilt, Structure: st.PlaceID(), Unit: st.Kind, Point: s.nearestPoint(st.X, st.Y)})
		if st.def.Role == shared.RoleRefinery {
			s.grantHauler(st) // a finished refinery brings its first hauler
		}
	}
}

// unitFor finds the rules entry of a unit a side may field: its own faction's, or one a
// captured structure lets it build.
func (s *Sim) unitFor(side int, unitID string) (shared.Unit, bool) {
	if u, ok := s.faction(side).Units[unitID]; ok {
		return u, true
	}
	for _, st := range s.Structures {
		if st.Side != side || st.Faction == s.Sides[side].Faction {
			continue
		}
		if u, ok := s.R.Factions[st.Faction].Units[unitID]; ok && u.Requires == st.def.Role {
			return u, true
		}
	}
	// A squad raised from a structure that was since lost keeps its unit.
	names := make([]string, 0, len(s.R.Factions))
	for name := range s.R.Factions {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if u, ok := s.R.Factions[name].Units[unitID]; ok {
			return u, false
		}
	}
	return shared.Unit{}, false
}

// mayBuy checks the build tree for a purchase: the unit must be one the side can field,
// and the structure it needs must stand.
func (s *Sim) mayBuy(side int, unitID string) (shared.Unit, error) {
	own := s.faction(side)
	if u, ok := own.Units[unitID]; ok {
		if u.Requires != "" && !s.Has(side, u.Requires) {
			_, need := own.StructureOfRole(u.Requires)
			return u, fmt.Errorf("%w: build %s first", ErrNeedsStructure, a(need.Name.En))
		}
		return u, nil
	}
	// A captured structure lets its new owner build that faction's units of its role.
	for _, st := range s.Structures {
		if st.Side != side || !st.Standing() || st.Faction == s.Sides[side].Faction {
			continue
		}
		if u, ok := s.R.Factions[st.Faction].Units[unitID]; ok && u.Requires == st.def.Role {
			return u, nil
		}
	}
	return shared.Unit{}, ErrNoUnit
}

// ForeignUnits lists the other factions' units a side can buy now through structures it
// has captured, in a fixed order.
func (s *Sim) ForeignUnits(side int) []string {
	var out []string
	for _, st := range s.Structures {
		if st.Side != side || !st.Standing() || st.Faction == s.Sides[side].Faction {
			continue
		}
		units := s.R.Factions[st.Faction].Units
		ids := make([]string, 0, len(units))
		for id := range units {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for _, id := range ids {
			// A side keeps to its own hauler: a captured works does not add another kind.
			if units[id].Requires == st.def.Role && units[id].Class != shared.HaulerClass && !contains(out, id) {
				out = append(out, id)
			}
		}
	}
	return out
}

// a puts the right article in front of a structure's English name.
func a(name string) string {
	if strings.HasPrefix(name, "The ") {
		return strings.ToLower(name[:1]) + name[1:]
	}
	if strings.ContainsRune("AEIOU", rune(name[0])) {
		return "an " + name
	}
	return "a " + name
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// structureSees reports whether a side's standing structures have (x, y) in sight.
func (s *Sim) structureSees(side int, x, y float64) bool {
	for _, st := range s.Structures {
		if st.Side == side && st.Standing() && st.def.Sight > 0 && dist(x, y, st.X, st.Y) <= st.def.Sight {
			return true
		}
	}
	return false
}

// observeStructures reveals the ground around a side's structures and updates what the
// side remembers of the other side's.
func (s *Sim) observeStructures(side int) {
	for _, st := range s.Structures {
		if st.Side == side {
			if st.Standing() && st.def.Sight > 0 {
				s.reveal(side, st.X, st.Y, st.def.Sight)
			}
			continue
		}
		m := &st.seen[side]
		m.Visible = !st.Gone && s.InSight(side, st.X, st.Y)
		if m.Visible || (m.Known && st.Gone && s.InSight(side, st.X, st.Y)) {
			s.remember(st, side)
		}
	}
}

func (s *Sim) remember(st *Structure, side int) {
	m := &st.seen[side]
	m.Known, m.Side, m.Ruin, m.Gone = true, st.Side, st.Ruin, st.Gone
	m.HP = math.Max(0, st.HP/st.def.HP)
	m.Building = 1
	if st.BuildTotal > 0 {
		m.Building = 1 - float64(st.BuildTicks)/float64(st.BuildTotal)
	}
}

// structureTarget picks the structure a team fires at when it has no unit to shoot: the
// fence that stopped it, the structure it was ordered to attack, or, on an attack or
// hold order, the nearest enemy defence and then the nearest enemy structure in range.
func (s *Sim) structureTarget(tr *teamRef, order string) *Structure {
	t, u, side := tr.t, tr.u, tr.sq.Side
	inReach := func(st *Structure) bool {
		if st == nil || st.Ruin || st.Side == side || u.Against(st.def.TargetClass()) == 0 {
			return false
		}
		d := math.Max(0, s.reach(t, st))
		return d <= u.Range && d >= u.MinRange
	}
	if st := s.structure(t.blocked); inReach(st) {
		return st
	}
	if order != OrderAttack && order != OrderHold {
		return nil
	}
	if st := s.structure(tr.sq.Order.Structure); inReach(st) && tr.sq.Order.Kind == OrderAttack {
		return st
	}
	var best *Structure
	bd := math.MaxFloat64
	for _, st := range s.Structures {
		if st.def.Role == shared.RoleFence || !st.seen[side].Visible || !inReach(st) {
			continue
		}
		d := s.reach(t, st)
		if st.def.Role != shared.RoleDefence {
			d += 10000 // anything that shoots back comes first
		}
		if d < bd {
			best, bd = st, d
		}
	}
	return best
}

// reach is the distance from a team to the nearest edge of a structure.
func (s *Sim) reach(t *Team, st *Structure) float64 {
	if st.def.Role == shared.RoleFence {
		return segDist(t.X, t.Y, st.AX, st.AY, st.BX, st.BY)
	}
	return dist(t.X, t.Y, st.X, st.Y) - st.def.Footprint
}

// fireAtStructure is a team's shots at a structure. The cooldown is already set.
func (s *Sim) fireAtStructure(tr *teamRef, st *Structure) {
	t, u := tr.t, tr.u
	chance := u.Accuracy
	if s.Nerve(t) == Shaken {
		chance *= 0.75
	}
	if far := math.Max(0, s.reach(t, st)) / u.Range; far > 0.6 {
		chance *= 1 - 0.75*(far-0.6)
	}
	for i := 0; i < t.Members; i++ {
		if s.rng.Float64() < chance {
			st.dmg += u.Damage * u.Against(st.def.TargetClass()) * (1 - st.def.Armor*(1-u.Pierce))
		}
	}
	st.hit = true
}

// defencesFire lets every standing defence shoot the nearest enemy team it can see and hurt.
func (s *Sim) defencesFire(live []*teamRef) {
	for _, st := range s.Structures {
		if st.def.Role != shared.RoleDefence || !st.Standing() {
			continue
		}
		if st.Cooldown > 0 {
			st.Cooldown--
			continue
		}
		var target *teamRef
		bd := st.def.Range
		for _, o := range live {
			if o.sq.Side == st.Side || o.t.Members == 0 || !o.t.Spotted || st.def.Against(o.u.Class) == 0 {
				continue
			}
			if d := dist(st.X, st.Y, o.t.X, o.t.Y); d <= bd {
				target, bd = o, d
			}
		}
		if target == nil {
			continue
		}
		st.Cooldown = st.def.CooldownTicks
		chance := st.def.Accuracy
		if target.plan.act == ActCover {
			chance *= 0.5
		}
		if far := bd / st.def.Range; far > 0.6 {
			chance *= 1 - 0.75*(far-0.6)
		}
		if s.rng.Float64() < chance {
			target.t.hits++
			target.t.dmg += st.def.Damage * st.def.Against(target.u.Class) * (1 - target.u.Armor*(1-st.def.Pierce))
		} else {
			target.t.misses++
		}
	}
}

// resolveStructures applies the tick's damage to structures and brings down the ones
// that have none left.
func (s *Sim) resolveStructures() {
	for _, st := range s.Structures {
		if !st.hit {
			continue
		}
		st.hit = false
		st.HP -= st.dmg
		st.dmg = 0
		if st.Ruin {
			continue
		}
		if st.HP <= 0 {
			s.destroy(st)
			continue
		}
		if s.Tick-st.alarm > 20*s.R.TickRate && st.def.Role != shared.RoleFence {
			st.alarm = s.Tick
			owner := st.Side
			s.emit(Event{Side: owner, Kind: EvStructureAttacked, Structure: st.PlaceID(), Unit: st.Kind, Point: s.nearestPoint(st.X, st.Y)})
		}
	}
}

// EvStructureAttacked tells the owner, at most every twenty seconds per structure.
const EvStructureAttacked = "structure_attacked"

func (s *Sim) destroy(st *Structure) {
	st.Ruin, st.HP, st.BuildTicks = true, 0, 0
	s.blockGround(st, false)
	owner := st.Side
	for side := range s.Sides {
		if side != owner && !st.seen[side].Visible {
			continue // the other side learns of it when it next looks
		}
		s.emit(Event{Side: side, Kind: EvStructureLost, Structure: st.PlaceID(), Unit: st.Kind,
			Point: s.nearestPoint(st.X, st.Y), Owner: &owner})
	}
	for side := range s.Sides {
		if side != owner && st.seen[side].Visible {
			s.remember(st, side)
		}
	}
}

// trackStructures turns an order on a structure that is gone, or has changed hands,
// into a hold where the squad stands.
func (s *Sim) trackStructures() {
	for _, sq := range s.Squads {
		if !sq.Alive || sq.Order.Structure == 0 {
			continue
		}
		st := s.structure(sq.Order.Structure)
		if st == nil || st.Ruin || st.Side == sq.Side {
			x, y := sq.Center()
			sq.Order = Order{Kind: OrderHold, X: x, Y: y, Tick: s.Tick}
		}
	}
}

// orderPlace is move, hold and attack on a place that is not a plain map point.
// orderStructure is an order whose place is a structure: attack it, or stand beside it.
func (s *Sim) orderStructure(c Command, sq *Squad, pl Place) (*Squad, error) {
	if sq.unit.Domain == "sea" {
		return nil, fmt.Errorf("%w: %s is a sea unit", ErrUnreachable, sq.unit.Name.En)
	}
	st := pl.Structure
	o := Order{Kind: c.Kind, Tick: s.Tick, X: pl.X, Y: pl.Y, Place: st.PlaceID()}
	switch {
	case c.Kind == CmdRepair:
		return nil, ErrNoBridge // mending structures comes with the third wave
	case c.Kind == CmdAttack && st.Side != c.Side && !st.Ruin:
		if sq.unit.Against(st.def.TargetClass()) == 0 {
			return nil, fmt.Errorf("%w: %s cannot hurt a structure", ErrUnreachable, sq.unit.Name.En)
		}
		o.Structure = st.ID
	case c.Kind == CmdAttack && st.Side != c.Side:
		// It has fallen since this side last saw it: the squad goes to where it stood
		// and finds that out for itself.
	case c.Kind == CmdAttack:
		return nil, fmt.Errorf("%w: nothing to attack at %s", ErrBadPlace, st.PlaceID())
	default:
		// Stand beside it, on the side the enemy comes from.
		dx, dy := s.towardEnemy(c.Side, st.X, st.Y)
		o.X, o.Y = st.X+dx*(st.def.Footprint+35), st.Y+dy*(st.def.Footprint+35)
	}
	if sq.unit.Domain == "land" {
		o.X, o.Y = s.nav.snapXY(navGround, o.X, o.Y)
	}
	sq.Order = o
	return sq, nil
}

// captureOrder sends an engineer squad to take over an enemy structure.
func (s *Sim) captureOrder(c Command) (*Squad, error) {
	sq := s.Squad(c.Squad)
	if sq == nil || sq.Side != c.Side {
		return nil, ErrNoSquad
	}
	if !sq.unit.Engineer() {
		return nil, ErrNotEngineers
	}
	pl, err := s.resolveFor(c.Side, c.Place)
	if err != nil {
		return nil, err
	}
	st := pl.Structure
	if st == nil || st.Side == c.Side || st.Ruin {
		return nil, fmt.Errorf("%w: there is no enemy structure at %s", ErrBadPlace, c.Place)
	}
	if !st.def.Capturable {
		return nil, fmt.Errorf("%w: a %s", ErrNotCapturable, st.def.Name.En)
	}
	sq.Order = Order{Kind: OrderCapture, Tick: s.Tick, X: st.X, Y: st.Y, Structure: st.ID, Place: st.PlaceID()}
	return sq, nil
}

// engineers counts the time capturing squads have spent beside their structure, and
// hands the structure over when it is enough.
func (s *Sim) engineers() {
	quiet := int(s.R.Nerve.QuietSeconds * float64(s.R.TickRate))
	for _, sq := range s.Squads {
		if !sq.Alive || sq.Order.Kind != OrderCapture {
			continue
		}
		st := s.structure(sq.Order.Structure)
		if st == nil || !st.Standing() {
			sq.Order.work = 0
			continue
		}
		beside, engaged := false, false
		for i := range sq.Teams {
			t := &sq.Teams[i]
			if t.Members == 0 {
				continue
			}
			beside = beside || dist(t.X, t.Y, st.X, st.Y) <= st.def.Footprint+45
			engaged = engaged || s.Tick-t.lastShot <= quiet
		}
		if !beside || engaged {
			sq.Order.work = 0
			continue
		}
		sq.Order.work++
		if float64(sq.Order.work) < sq.unit.CaptureSeconds*float64(s.R.TickRate) {
			continue
		}
		// The structure changes hands; the engineers stay inside to run it.
		from := st.Side
		st.Side = sq.Side
		for side := range s.Sides {
			s.remember(st, side)
			s.emit(Event{Side: side, Kind: EvStructureCaptured, Structure: st.PlaceID(), Unit: st.Kind,
				Squad: b2i(side == sq.Side, sq.ID), Point: s.nearestPoint(st.X, st.Y), Owner: &st.Side})
		}
		_ = from
		for i := range sq.Teams {
			sq.Teams[i].Members, sq.Teams[i].HP = 0, 0
		}
		sq.Alive = false
		s.emit(Event{Side: sq.Side, Kind: EvSquadLost, Squad: sq.ID, Point: s.nearestPoint(st.X, st.Y), Reason: "spent"})
	}
}

func b2i(cond bool, v int) int {
	if cond {
		return v
	}
	return 0
}

// CaptureProgress is how far a squad's takeover has come, 0…1.
func (s *Sim) CaptureProgress(sq *Squad) float64 {
	if sq.Order.Kind != OrderCapture || sq.unit.CaptureSeconds <= 0 {
		return 0
	}
	return math.Min(1, float64(sq.Order.work)/(sq.unit.CaptureSeconds*float64(s.R.TickRate)))
}

// fenceStops reports the hostile fence that a ground team's step from where it stands
// to (nx, ny) would cross, or nil. This is the stand-in for the navigation grid: a team
// stopped by a fence shoots it down (structureTarget).
func (s *Sim) fenceStops(tr *teamRef, nx, ny float64) *Structure {
	if tr.u.Domain != "land" {
		return nil
	}
	t := tr.t
	for _, st := range s.Structures {
		if st.def.Role != shared.RoleFence || st.Ruin || st.Side == tr.sq.Side || st.def.Blocks != "ground" {
			continue
		}
		if segCross(t.X, t.Y, nx, ny, st.AX, st.AY, st.BX, st.BY) || segDist(nx, ny, st.AX, st.AY, st.BX, st.BY) < 5 {
			return st
		}
	}
	return nil
}

// segDist is the distance from a point to a segment.
func segDist(px, py, ax, ay, bx, by float64) float64 {
	dx, dy := bx-ax, by-ay
	l := dx*dx + dy*dy
	if l == 0 {
		return dist(px, py, ax, ay)
	}
	t := math.Max(0, math.Min(1, ((px-ax)*dx+(py-ay)*dy)/l))
	return dist(px, py, ax+t*dx, ay+t*dy)
}

// segCross reports whether segment p–q crosses segment a–b.
func segCross(px, py, qx, qy, ax, ay, bx, by float64) bool {
	side := func(x1, y1, x2, y2, x, y float64) float64 { return (x2-x1)*(y-y1) - (y2-y1)*(x-x1) }
	d1, d2 := side(ax, ay, bx, by, px, py), side(ax, ay, bx, by, qx, qy)
	d3, d4 := side(px, py, qx, qy, ax, ay), side(px, py, qx, qy, bx, by)
	return d1*d2 < 0 && d3*d4 < 0
}

// StructureView is a structure as one side may see it: its own as they are, the other
// side's as last seen.
type StructureView struct {
	ID       string  `json:"id"`
	Kind     string  `json:"kind"`
	Faction  string  `json:"faction"`
	Role     string  `json:"role"`
	Side     int     `json:"side"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	HP       float64 `json:"hp"`       // share 0…1
	Building float64 `json:"building"` // progress 0…1; 1 when it stands
	Ruin     bool    `json:"ruin,omitempty"`
	Visible  bool    `json:"visible"` // in sight now; otherwise as last seen
	Run      int     `json:"run,omitempty"`
	// A fence segment's ends.
	AX float64 `json:"ax,omitempty"`
	AY float64 `json:"ay,omitempty"`
	BX float64 `json:"bx,omitempty"`
	BY float64 `json:"by,omitempty"`
}

func (s *Sim) structureViews(side int) []StructureView {
	out := []StructureView{}
	for _, st := range s.Structures {
		v := StructureView{
			ID: st.PlaceID(), Kind: st.Kind, Faction: st.Faction, Role: st.def.Role, Side: st.Side,
			X: round1(st.X), Y: round1(st.Y), Run: st.Run, Visible: true,
			AX: round1(st.AX), AY: round1(st.AY), BX: round1(st.BX), BY: round1(st.BY),
		}
		if side == Spectator || st.Side == side {
			if st.Gone {
				continue
			}
			v.HP, v.Ruin, v.Building = math.Max(0, st.HP/st.def.HP), st.Ruin, 1
			if st.BuildTotal > 0 {
				v.Building = 1 - float64(st.BuildTicks)/float64(st.BuildTotal)
			}
		} else {
			m := st.seen[side]
			if !m.Known || m.Gone {
				continue
			}
			v.Side, v.HP, v.Ruin, v.Building, v.Visible = m.Side, m.HP, m.Ruin, m.Building, m.Visible
		}
		out = append(out, v)
	}
	return out
}

func (s *Sim) hashStructures(put func(uint64), f func(float64)) {
	for _, st := range s.Structures {
		put(uint64(st.ID))
		put(uint64(int64(st.Side)))
		put(uint64(st.BuildTicks))
		put(uint64(st.Cooldown))
		f(st.HP)
		f(st.X)
		f(st.Y)
		flags := uint64(0)
		if st.Ruin {
			flags |= 1
		}
		if st.Gone {
			flags |= 2
		}
		put(flags)
		for side := range st.seen {
			m := st.seen[side]
			f(m.HP)
			f(m.Building)
			put(uint64(int64(m.Side)) ^ uint64(b2i(m.Known, 8)) ^ uint64(b2i(m.Ruin, 16)) ^ uint64(b2i(m.Gone, 32)))
		}
	}
}
