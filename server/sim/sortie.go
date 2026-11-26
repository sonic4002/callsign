package sim

import (
	"errors"
	"fmt"
	"math"
	"slices"

	"callsign/shared"
)

// Strike aircraft. A fixed-wing squad holds no ground and cannot wait in the air: it
// stands at its airbase, flies out when it is given a target, drops its whole load in
// one pass, flies home and is rearmed there before it can go again. An attack on
// something that can be destroyed (an enemy squad in sight, a structure, a bridge, a
// building, the enemy headquarters) is flown again and again until the target is gone; an
// attack on open ground is one pass. A move order is a flight over the place and back
// with nothing dropped, to look. Nothing on the ground or in the air is in its way.
//
// An aircraft belongs to an airbase. When that falls, is sold or changes hands, the
// squad takes another airbase of its side; with none left, aircraft on the ground are
// lost with the base, and aircraft in the air finish the pass they are on and are lost
// when they turn for home.

const (
	// OrderReturn is a strike aircraft flying home, or standing there after a sortie.
	OrderReturn = "return"

	SortieParked   = "parked"   // at its airbase, armed
	SortieOut      = "out"      // flying to its target
	SortieBack     = "back"     // flying home
	SortieRearming = "rearming" // at its airbase, being armed

	EvStrike   = "strike"   // Squad; Point, and Place or Structure with Unit: what the bombs fell on; Count the bombs
	EvOverhead = "overhead" // Squad, Point, Place: it has flown over the place it was sent to look at; Count the enemy squads in its sight
	EvRearmed  = "rearmed"  // Squad: armed again at its airbase

	// ReasonNoAirbase is why a strike squad was lost: it had no airbase left to land at.
	ReasonNoAirbase = "no_airbase"

	// strikeSeconds is how long a bomb's blast stays in the snapshots, for the page to draw.
	strikeSeconds = 1.5
)

var (
	ErrNoLoiter     = errors.New("a strike aircraft cannot hold ground or wait in the air: give it a target, or send it back to base")
	ErrNoBombTarget = errors.New("bombs cannot hit that")
)

// sortie is what a strike squad carries beside its order.
type sortie struct {
	State string
	Bombs int // on each plane now
	Home  int // the structure it flies from, 0 when it has none
	rearm int // ticks until it is armed again
}

// Blast is a bomb that has just gone off, for the page to draw and to sound.
type Blast struct {
	X, Y   float64
	Side   int // whose bomb it was
	Tick   int
	Radius float64
}

// BlastView is a blast as a side may see it.
type BlastView struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Side   int     `json:"side"`
	Age    int     `json:"age"` // ticks since it went off
	Radius float64 `json:"radius"`
}

// SortieView is a strike squad's state as its owner sees it.
type SortieView struct {
	State string  `json:"state"`
	Bombs int     `json:"bombs"`           // on each plane now
	Full  int     `json:"full"`            // what a plane carries
	Rearm float64 `json:"rearm,omitempty"` // 0…1 while it is being armed
	Home  string  `json:"home,omitempty"`  // its airbase
}

// Grounded reports whether a strike squad stands at its airbase.
func (a *sortie) grounded() bool { return a.State == SortieParked || a.State == SortieRearming }

// airbaseFor is the airbase a strike squad flies from: its own while that stands and is
// its side's, else the nearest other one that could have made it. nil when none is left.
func (s *Sim) airbaseFor(sq *Squad) *Structure {
	ok := func(st *Structure) bool {
		return st != nil && st.Standing() && st.Side == sq.Side && st.def.Role == sq.unit.Requires
	}
	if st := s.structure(sq.sortie.Home); ok(st) {
		return st
	}
	x, y := sq.Center()
	var best *Structure
	bd := math.MaxFloat64
	for _, st := range s.Structures {
		if !ok(st) {
			continue
		}
		if d := dist(x, y, st.X, st.Y); d < bd {
			best, bd = st, d
		}
	}
	return best
}

// padSlot is where one plane of a squad stands at its airbase: each squad has a corner
// of the apron by its number, so that two squads of one base do not stand in a heap.
func (s *Sim) padSlot(sq *Squad, st *Structure, slot int) (float64, float64) {
	const apron = 36
	k := (sq.Num - 1) % 4
	cx, cy := st.X+apron*float64(2*(k%2)-1), st.Y+apron*float64(2*(k/2)-1)
	ox, oy := s.formation(sq.unit, slot, sq.Side)
	return s.clamp("air", cx+ox, cy+oy)
}

// park stands a strike squad at an airbase, armed and with no order. With no airbase to
// stand at, the squad is lost.
func (s *Sim) park(sq *Squad, st *Structure) {
	if st == nil {
		s.ditch(sq)
		return
	}
	a := sq.sortie
	a.State, a.Bombs, a.Home, a.rearm = SortieParked, sq.unit.Bombs, st.ID, 0
	for i := range sq.Teams {
		t := &sq.Teams[i]
		t.X, t.Y = s.padSlot(sq, st, i)
		t.Action, t.dropped = ActIdle, false
	}
	sq.Order = Order{Kind: OrderNone}
}

// ditch is the end of a strike squad that has nowhere to land.
func (s *Sim) ditch(sq *Squad) {
	if !sq.Alive {
		return
	}
	x, y := sq.Center()
	alive, _ := sq.Strength()
	u := sq.unit
	s.Sides[1-sq.Side].Destroyed += float64(u.Cost) * float64(alive) / float64(max(1, u.Teams*u.Members))
	for i := range sq.Teams {
		sq.Teams[i].Members, sq.Teams[i].HP = 0, 0
	}
	sq.Alive = false
	s.emit(Event{Side: sq.Side, Kind: EvSquadLost, Squad: sq.ID, Point: s.nearestPoint(x, y), Reason: ReasonNoAirbase})
}

// sortieOrder is an order to a strike squad. It takes an attack on anything its bombs
// can hurt, a move as a flight over the place and back, and an order home; it refuses to
// hold a place, and whatever only ground squads do.
func (s *Sim) sortieOrder(c Command, sq *Squad) (*Squad, error) {
	u := sq.unit
	place := c.Place
	if place == "" {
		place = c.Point
	}
	o := Order{Kind: c.Kind, Tick: s.Tick}
	switch {
	case c.Kind == CmdRepair:
		return nil, ErrNoRepair
	case c.Kind == CmdAttack && c.Contact != 0:
		enemy := s.Squad(c.Contact)
		if enemy == nil || enemy.Side == c.Side || !s.visible(enemy) {
			return nil, ErrNoContact
		}
		if u.Against(enemy.unit.Class) == 0 {
			return nil, fmt.Errorf("%w: %s cannot hit %s targets", ErrNoBombTarget, u.Name.En, enemy.unit.Class)
		}
		o.Contact = enemy.ID
		o.X, o.Y = enemy.Center()
	case place == "" && c.Kind == CmdHold:
		o.Kind = OrderReturn // "hold" with no place is "stop": home
	case place == "":
		return nil, ErrNoPoint
	default:
		pl, err := s.resolveFor(c.Side, place)
		if err != nil {
			return nil, err
		}
		if pl.Base != "" {
			return nil, fmt.Errorf("%w: %q is where to build, not where to go", ErrNoPlace, place)
		}
		home := (pl.Structure != nil && pl.Structure.Side == c.Side && pl.Structure.def.Role == u.Requires) ||
			(pl.Kind == PlacePoint && pl.ID == s.R.HQPoint(c.Side).ID)
		switch {
		case c.Kind != CmdAttack && home:
			// Home: to the airbase named, when one was, and from now on it flies from there.
			o.Kind = OrderReturn
			if pl.Structure != nil && pl.Structure.Standing() {
				sq.sortie.Home = pl.Structure.ID
			}
		case c.Kind == CmdHold:
			return nil, ErrNoLoiter
		case c.Kind == CmdAttack && pl.Structure != nil && pl.Structure.Side == c.Side:
			return nil, fmt.Errorf("%w: nothing to attack at %s", ErrBadPlace, pl.Structure.PlaceID())
		case c.Kind == CmdAttack && pl.Structure != nil && !pl.Structure.Ruin:
			if u.Against(pl.Structure.def.TargetClass()) == 0 {
				return nil, fmt.Errorf("%w: %s cannot hurt a structure", ErrNoBombTarget, u.Name.En)
			}
			o.Structure = pl.Structure.ID
			fallthrough
		default:
			o.Place, o.X, o.Y, o.landmark, o.bridge = pl.ID, pl.X, pl.Y, pl.landmark, pl.bridge
			if pl.Structure != nil {
				o.Place = pl.Structure.PlaceID()
			}
			if pl.Kind == PlacePoint {
				o.Point = pl.ID
			}
		}
	}
	sq.Order = o
	return sq, nil
}

// flies reports whether a strike squad's order sends it out now: an attack while it has
// bombs, or a flight over a place.
func (sq *Squad) flies() bool {
	return (sq.Order.Kind == OrderAttack && sq.sortie.Bombs > 0) || sq.Order.Kind == OrderMove
}

// sorties moves every strike squad's sortie on by a tick, before the planes decide where
// to fly: it arms the ones on the ground, sends out the ones with a target, and turns
// home the ones with none.
func (s *Sim) sorties() {
	for _, sq := range s.Squads {
		a := sq.sortie
		if !sq.Alive || a == nil {
			continue
		}
		home := s.airbaseFor(sq)
		if home == nil {
			a.Home = 0
			if a.grounded() || a.State == SortieBack || !sq.flies() {
				s.ditch(sq) // lost with its base, or with nowhere to land
				continue
			}
		} else if home.ID != a.Home {
			a.Home = home.ID
			if a.grounded() {
				a.State = SortieBack // its base is gone under it: it lifts off for the other one
			}
		}
		// The trackers of other orders turn an attack whose target is gone into a hold
		// where the squad is (ai.go, structures.go): for an aircraft that is the way home.
		if k := sq.Order.Kind; k == OrderHold || (k == OrderNone && !a.grounded()) {
			sq.Order = Order{Kind: OrderReturn, Tick: s.Tick}
		}
		switch a.State {
		case SortieRearming:
			if a.rearm--; a.rearm <= 0 {
				a.State, a.Bombs = SortieParked, sq.unit.Bombs
				s.emit(Event{Side: sq.Side, Kind: EvRearmed, Squad: sq.ID, Point: s.nearestPoint(home.X, home.Y)})
			}
		case SortieParked:
			if sq.flies() {
				a.State = SortieOut
			} else if sq.Order.Kind != OrderNone && sq.Order.Kind != OrderAttack {
				sq.Order = Order{Kind: OrderNone}
			}
		case SortieOut:
			if !sq.flies() {
				a.State = SortieBack
			}
		case SortieBack:
			if sq.flies() {
				a.State = SortieOut // given a new target on its way home, with bombs still on
			}
		}
	}
}

// sortiePlan is where one plane flies this tick.
func (s *Sim) sortiePlan(tr *teamRef) plan {
	sq, a := tr.sq, tr.sq.sortie
	switch a.State {
	case SortieOut:
		ox, oy := s.formation(tr.u, tr.slot, sq.Side)
		x, y := s.clamp("air", sq.Order.X+ox, sq.Order.Y+oy)
		return plan{act: ActAdvance, x: x, y: y}
	case SortieBack:
		if st := s.structure(a.Home); st != nil {
			x, y := s.padSlot(sq, st, tr.slot)
			return plan{act: ActAdvance, x: x, y: y}
		}
	}
	return plan{act: ActIdle}
}

// fly moves a plane straight toward where its plan sends it. Its nerve never slows it.
func (s *Sim) fly(tr *teamRef) {
	t, p := tr.t, tr.plan
	t.Action = p.act
	t.hx, t.hy = 0, 0
	if p.act != ActAdvance {
		return
	}
	speed := tr.u.Speed * s.dt
	if pace := s.R.Map.Pace; pace > 0 {
		speed *= pace
	}
	d := dist(t.X, t.Y, p.x, p.y)
	if d <= speed {
		t.dx, t.dy = p.x-t.X, p.y-t.Y
		t.X, t.Y = p.x, p.y
		return
	}
	t.hx, t.hy = (p.x-t.X)/d, (p.y-t.Y)/d
	t.dx, t.dy = t.hx*speed, t.hy*speed
	t.X, t.Y = t.X+t.dx, t.Y+t.dy
}

// strikes is what the planes do where they have got to: drop on the target they are
// over, turn home from a place they were sent to look at, and land.
func (s *Sim) strikes(live []*teamRef) {
	s.Blasts = slices.DeleteFunc(s.Blasts, func(b Blast) bool {
		return float64(s.Tick-b.Tick) > strikeSeconds*float64(s.R.TickRate)
	})
	for _, sq := range s.Squads {
		a := sq.sortie
		if !sq.Alive || a == nil || a.grounded() {
			continue
		}
		over, dropped := true, 0
		for _, tr := range live {
			if tr.sq != sq || tr.t.Members == 0 {
				continue
			}
			if p := tr.plan; p.act != ActAdvance || dist(tr.t.X, tr.t.Y, p.x, p.y) > 0.5 {
				over = false
				continue
			}
			if a.State == SortieOut && sq.Order.Kind == OrderAttack && !tr.t.dropped {
				s.bomb(tr, live)
				tr.t.dropped = true
				dropped += tr.u.Bombs * tr.t.Members
			}
		}
		cx, cy := sq.Center()
		switch {
		case dropped > 0 || (over && a.State == SortieOut && sq.Order.Kind == OrderAttack):
			// The planes fly together and drop together; one that was a step behind has
			// dropped by the time the squad turns.
			if !over {
				continue
			}
			o := sq.Order
			e := Event{Side: sq.Side, Kind: EvStrike, Squad: sq.ID, Point: s.nearestPoint(o.X, o.Y), Count: sq.unit.Bombs * len(liveTeamsOf(sq)), Contact: o.Contact}
			if st := s.structure(o.Structure); st != nil {
				e.Structure, e.Unit = st.PlaceID(), st.Kind
			} else if o.Contact == 0 {
				e.Place = o.Place
			}
			s.emit(e)
			a.Bombs = 0
			if !s.strikeAgain(sq) {
				sq.Order = Order{Kind: OrderReturn, Tick: s.Tick}
			}
			a.State = SortieBack
		case over && a.State == SortieOut:
			// A flight over a place: it has seen what is there, and turns for home.
			s.emit(Event{Side: sq.Side, Kind: EvOverhead, Squad: sq.ID, Point: s.nearestPoint(cx, cy), Place: sq.Order.Place, Count: len(sq.Contacts)})
			sq.Order = Order{Kind: OrderReturn, Tick: s.Tick}
			a.State = SortieBack
		case over && a.State == SortieBack:
			for i := range sq.Teams {
				sq.Teams[i].dropped, sq.Teams[i].Action = false, ActIdle
			}
			if sq.Order.Kind == OrderReturn {
				sq.Order = Order{Kind: OrderNone}
			}
			if a.Bombs < sq.unit.Bombs {
				a.State, a.rearm = SortieRearming, max(1, int(math.Round(sq.unit.RearmSeconds*float64(s.R.TickRate))))
			} else {
				a.State = SortieParked
			}
		}
	}
}

func liveTeamsOf(sq *Squad) []*Team {
	var out []*Team
	for i := range sq.Teams {
		if sq.Teams[i].Members > 0 {
			out = append(out, &sq.Teams[i])
		}
	}
	return out
}

// strikeAgain reports whether a strike squad's attack order stands after a pass: its
// target can be destroyed and is still there, and, for an enemy squad, still in sight.
func (s *Sim) strikeAgain(sq *Squad) bool {
	o := &sq.Order
	switch {
	case o.Contact != 0:
		c := s.SquadAny(o.Contact)
		return c != nil && c.Alive && s.visible(c)
	case o.Structure != 0:
		st := s.structure(o.Structure)
		return st != nil && !st.Ruin && st.Side != sq.Side
	case o.bridge > 0:
		return s.Bridges[o.bridge-1].Standing
	case o.landmark > 0:
		l := &s.Landmarks[o.landmark-1]
		return l.Kind != Rubble && s.kindOf(l).Garrison > 0
	}
	return o.Point != "" && o.Point == s.R.HQPoint(1-sq.Side).ID
}

// bomb is one plane's load going off under it. Everything of the enemy's inside the
// blast is hit, seen or not, less toward the edge: fireteams (not aircraft), structures
// and fences, the headquarters, and the bridge or the building the order named. Cover
// and walls take off what they take off a shot.
func (s *Sim) bomb(tr *teamRef, live []*teamRef) {
	sq, t, u := tr.sq, tr.t, tr.u
	x, y, r := t.X, t.Y, u.BlastRadius
	power := u.Damage * float64(u.Bombs) * float64(t.Members)
	share := func(d float64) float64 { return 1 - 0.6*math.Max(0, d)/r }
	t.lastFire = s.Tick
	s.Blasts = append(s.Blasts, Blast{X: x, Y: y, Side: sq.Side, Tick: s.Tick, Radius: r})

	for _, o := range live {
		d := dist(x, y, o.t.X, o.t.Y)
		if o.sq.Side == sq.Side || o.t.Members == 0 || d > r || u.Against(o.u.Class) == 0 {
			continue
		}
		dmg := power * share(d) * u.Against(o.u.Class) * (1 - o.u.Armor*(1-u.Pierce))
		if o.t.In != "" {
			// Inside a building: the walls take their share, and so does the building.
			if i, l := s.landmarkByID(o.t.In); l != nil {
				dmg *= s.kindOf(l).GarrisonCover
				if i+1 != sq.Order.landmark {
					s.Landmarks[i].dmg += power * share(d) * u.Against(shared.TargetStructure) * s.R.Match.GarrisonDamageShare
				}
			}
		} else if o.t.Cover > 0 && o.t.Cover < 1 {
			dmg *= o.t.Cover
		}
		o.t.hits++
		o.t.dmg += dmg
		if !slices.Contains(o.t.shooter, sq) {
			o.t.shooter = append(o.t.shooter, sq)
		}
	}
	for _, st := range s.Structures {
		if st.Ruin || st.Gone || st.Side == sq.Side || (st.Tech() && st.ID != sq.Order.Structure) {
			continue // a tech building is bombed only on an order: it is worth more taken than broken
		}
		d, vs := s.reach(t, st), u.Against(st.def.TargetClass())
		if d > r || vs == 0 {
			continue
		}
		st.dmg += power * share(d) * vs * (1 - st.def.Armor*(1-u.Pierce))
		st.hit = true
	}
	enemy := &s.Sides[1-sq.Side]
	if hq := s.R.HQPoint(enemy.ID); dist(x, y, hq.X, hq.Y) <= r+hqStandoff/2 {
		enemy.HQHP -= power * u.Against("hq")
		if s.Tick-enemy.hqAlarm > 20*s.R.TickRate {
			enemy.hqAlarm = s.Tick
			s.emit(Event{Side: enemy.ID, Kind: EvHQUnderAttack, Point: hq.ID})
		}
	}
	if i := sq.Order.bridge; i > 0 && s.Bridges[i-1].Standing && s.Bridges[i-1].distTo(x, y) <= r {
		s.Bridges[i-1].dmg += power * u.Against(shared.TargetStructure)
		s.Bridges[i-1].by[sq.Side] = true
	}
	if i := sq.Order.landmark; i > 0 && s.kindOf(&s.Landmarks[i-1]).Garrison > 0 && dist(x, y, s.Landmarks[i-1].X, s.Landmarks[i-1].Y) <= r {
		s.Landmarks[i-1].dmg += power * u.Against(shared.TargetStructure)
	}
}

// evades is the multiplier on the chance of a shot at a team: a strike aircraft in flight
// is fast, and slips its unit's share of what is fired at it. On the ground it slips none.
func (s *Sim) evades(tgt *teamRef) float64 {
	if a := tgt.sq.sortie; a != nil && !a.grounded() {
		return 1 - tgt.u.Evade
	}
	return 1
}

// sortieView is a strike squad's sortie for its owner's snapshot.
func (s *Sim) sortieView(sq *Squad) *SortieView {
	a := sq.sortie
	v := &SortieView{State: a.State, Bombs: a.Bombs, Full: sq.unit.Bombs}
	if a.Home != 0 {
		v.Home = "s" + fmt.Sprint(a.Home)
	}
	if a.State == SortieRearming {
		total := math.Max(1, sq.unit.RearmSeconds*float64(s.R.TickRate))
		v.Rearm = round3(math.Max(0, 1-float64(a.rearm)/total))
	}
	return v
}

// snapBlasts lists the blasts a side may see: its own bombs', and the ones in its sight.
func (s *Sim) snapBlasts(snap *Snapshot, side int) {
	snap.Blasts = []BlastView{}
	for _, b := range s.Blasts {
		if side == Spectator || b.Side == side || s.InSight(side, b.X, b.Y) {
			snap.Blasts = append(snap.Blasts, BlastView{X: round1(b.X), Y: round1(b.Y), Side: b.Side, Age: s.Tick - b.Tick, Radius: b.Radius})
		}
	}
}

func (s *Sim) hashSorties(put func(uint64)) {
	for _, sq := range s.Squads {
		if a := sq.sortie; a != nil {
			h := 0
			for _, c := range a.State {
				h = h*31 + int(c)
			}
			put(uint64(h))
			put(uint64(a.Bombs))
			put(uint64(a.Home))
			put(uint64(a.rearm))
		}
	}
}
