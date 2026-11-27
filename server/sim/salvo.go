package sim

import (
	"errors"
	"fmt"
	"math"
	"slices"
)

// A missile salvo is a second weapon some units carry beside their gun (the attack
// helicopter's honeycomb pods). It is fired on an order of its own: the squad flies to
// within the salvo's range of the place it was given and every aircraft empties its pods
// over it, many small missiles that fall scattered across the ground around the place.
// Each one is a small blast like a bomb's: it hits whatever of the enemy's is under it,
// seen or not. The pods then take minutes to load again; until they are, the order is
// refused. Having fired, the squad holds where it is.

const (
	CmdSalvo   = "salvo"
	OrderSalvo = "salvo"

	EvSalvo       = "salvo"        // Squad; Point, Place: where the missiles fall; Count: how many
	EvSalvoLoaded = "salvo_loaded" // Squad: its pods are loaded again

	// salvoGap is the ticks between one aircraft's missiles leaving their pods.
	salvoGap = 1

	// BlastMissile marks the blast of one missile of a salvo, smaller than a bomb's.
	BlastMissile = "missile"
)

var (
	ErrNoSalvo      = errors.New("this squad carries no missile salvo")
	ErrSalvoLoading = errors.New("the missile pods are still being loaded")
)

// Rocket is one missile of a salvo on its way.
type Rocket struct {
	X0, Y0 float64 // where it was fired from
	X, Y   float64 // where it comes down
	Side   int
	Launch int // the tick it leaves its pod
	Land   int // the tick it goes off
	sq     *Squad
}

// RocketView is a missile in flight as a side may see it.
type RocketView struct {
	X0     float64 `json:"x0"`
	Y0     float64 `json:"y0"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Side   int     `json:"side"`
	Unit   string  `json:"unit"`   // what fired it
	Age    int     `json:"age"`    // ticks since it left its pod
	Flight int     `json:"flight"` // ticks from pod to ground
}

// SalvoView is a squad's missile salvo as its owner sees it.
type SalvoView struct {
	Ready float64 `json:"ready"`          // 0…1: how far the pods are loaded, 1 when they can fire
	Wait  int     `json:"wait,omitempty"` // seconds until they can
}

// salvoOrder is the order to fire the salvo at a place or at an enemy squad in sight.
func (s *Sim) salvoOrder(c Command) (*Squad, error) {
	sq := s.Squad(c.Squad)
	if sq == nil || sq.Side != c.Side || !sq.Alive {
		return nil, ErrNoSquad
	}
	if sq.unit.Salvo == nil {
		return nil, ErrNoSalvo
	}
	if left := sq.salvoAt - s.Tick; left > 0 {
		return nil, fmt.Errorf("%w: %d seconds to go", ErrSalvoLoading, (left+s.R.TickRate-1)/s.R.TickRate)
	}
	o := Order{Kind: OrderSalvo, Tick: s.Tick}
	place := c.Place
	if place == "" {
		place = c.Point
	}
	switch {
	case c.Contact != 0:
		enemy := s.Squad(c.Contact)
		if enemy == nil || enemy.Side == c.Side || !s.visible(enemy) {
			return nil, ErrNoContact
		}
		o.X, o.Y = enemy.Center()
	case place != "":
		pl, err := s.resolveFor(c.Side, place)
		if err != nil {
			return nil, err
		}
		if pl.Base != "" {
			return nil, fmt.Errorf("%w: %q is where to build, not a target", ErrNoPlace, place)
		}
		o.Place, o.X, o.Y = pl.ID, pl.X, pl.Y
	default:
		return nil, ErrNoPoint
	}
	o.Point = s.nearestPoint(o.X, o.Y)
	sq.Order = o
	return sq, nil
}

// salvos fires the salvo of every squad that has come within range of where it was told
// to fire, sets off the missiles that have reached the ground, and says when pods are
// loaded again.
func (s *Sim) salvos(live []*teamRef) {
	for _, sq := range s.Squads {
		sv := sq.unit.Salvo
		if !sq.Alive || sv == nil {
			continue
		}
		if sq.salvoAt != 0 && s.Tick >= sq.salvoAt {
			sq.salvoAt = 0
			s.emit(Event{Side: sq.Side, Kind: EvSalvoLoaded, Squad: sq.ID})
		}
		if sq.Order.Kind != OrderSalvo {
			continue
		}
		o := sq.Order
		cx, cy := sq.Center()
		if dist(cx, cy, o.X, o.Y) > sv.Range {
			continue // still flying in
		}
		flight := max(1, int(math.Round(sv.FlightSeconds*float64(s.R.TickRate))))
		n := 0
		for i := range sq.Teams {
			t := &sq.Teams[i]
			if t.Members == 0 {
				continue
			}
			for k := 0; k < sv.Missiles*t.Members; k++ {
				// Anywhere on the ground around the place, evenly.
				a, d := s.rng.Float64()*2*math.Pi, sv.Spread*math.Sqrt(s.rng.Float64())
				x := math.Max(0, math.Min(s.R.Map.Width, o.X+math.Cos(a)*d))
				y := math.Max(0, math.Min(s.R.Map.Height, o.Y+math.Sin(a)*d))
				launch := s.Tick + k*salvoGap
				s.Rockets = append(s.Rockets, Rocket{X0: t.X, Y0: t.Y, X: x, Y: y, Side: sq.Side, Launch: launch, Land: launch + flight, sq: sq})
				n++
			}
			t.lastFire = s.Tick // firing gives it away
		}
		sq.salvoAt = s.Tick + max(1, int(math.Round(sv.ReloadSeconds*float64(s.R.TickRate))))
		s.emit(Event{Side: sq.Side, Kind: EvSalvo, Squad: sq.ID, Point: o.Point, Place: o.Place, Count: n})
		sq.Order = Order{Kind: OrderHold, X: cx, Y: cy, Tick: s.Tick}
	}
	s.Rockets = slices.DeleteFunc(s.Rockets, func(r Rocket) bool {
		if s.Tick < r.Land {
			return false
		}
		sv := r.sq.unit.Salvo
		s.burst(r.sq, r.sq.unit, r.X, r.Y, sv.BlastRadius, sv.Damage, BlastMissile, live)
		return true
	})
}

// salvoView is a squad's salvo for its owner's snapshot.
func (s *Sim) salvoView(sq *Squad) *SalvoView {
	left := sq.salvoAt - s.Tick
	if left <= 0 {
		return &SalvoView{Ready: 1}
	}
	total := math.Max(1, sq.unit.Salvo.ReloadSeconds*float64(s.R.TickRate))
	return &SalvoView{Ready: round3(math.Max(0, 1-float64(left)/total)), Wait: (left + s.R.TickRate - 1) / s.R.TickRate}
}

// snapRockets lists the missiles in flight a side may see: its own, and the ones that
// were fired from, or come down on, ground in its sight.
func (s *Sim) snapRockets(snap *Snapshot, side int) {
	snap.Rockets = []RocketView{}
	for _, r := range s.Rockets {
		if s.Tick < r.Launch {
			continue
		}
		if side == Spectator || r.Side == side || s.InSight(side, r.X, r.Y) || s.InSight(side, r.X0, r.Y0) {
			snap.Rockets = append(snap.Rockets, RocketView{X0: round1(r.X0), Y0: round1(r.Y0), X: round1(r.X), Y: round1(r.Y), Side: r.Side, Unit: r.sq.Unit, Age: s.Tick - r.Launch, Flight: r.Land - r.Launch})
		}
	}
}

func (s *Sim) hashSalvos(put func(uint64), f func(float64)) {
	for _, sq := range s.Squads {
		if sq.unit.Salvo != nil {
			put(uint64(sq.salvoAt))
		}
	}
	for _, r := range s.Rockets {
		f(r.X)
		f(r.Y)
		put(uint64(r.Land))
	}
}
