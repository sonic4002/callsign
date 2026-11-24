package sim

import (
	"errors"
	"fmt"
	"math"

	"callsign/shared"
)

const (
	EvDeploying      = "deploying" // a squad was bought; Count is the seconds until it is fielded
	EvSquadSpawned   = "squad_spawned"
	EvSquadLost      = "squad_lost"
	EvEnemyDestroyed = "enemy_destroyed"
	EvLosses         = "losses"
	EvContact        = "contact"
	EvPinned         = "pinned"
	EvArrived        = "arrived"
	EvCaptured       = "captured"
	EvPointLost      = "point_lost"
	EvHQUnderAttack  = "hq_under_attack"
	EvUpgraded       = "upgraded"
	EvMatchEnd       = "match_end"
)

// Event is something one side learns about. It never carries what that side cannot see.
type Event struct {
	Tick    int    `json:"tick"`
	Side    int    `json:"side"`
	Kind    string `json:"kind"`
	Squad   int    `json:"squad,omitempty"`   // own squad the event is about
	Hauler  int    `json:"hauler,omitempty"`  // own hauler the event is about
	Field   string `json:"field,omitempty"`   // gusher id, for a hauler event
	Unit    string `json:"unit,omitempty"`    // unit id, for a deployment
	Contact int    `json:"contact,omitempty"` // enemy squad id
	Point   string `json:"point,omitempty"`   // nearest map point
	Count   int    `json:"count,omitempty"`
	// Structure is the id of the structure a structure event is about, with its kind in
	// Unit; Owner is whose it was (lost) or is now (captured).
	Structure string `json:"structure,omitempty"`
	Owner     *int   `json:"owner,omitempty"`
	Winner    *int   `json:"winner,omitempty"`
	Reason    string `json:"reason,omitempty"`
}

func (s *Sim) emit(e Event) { s.events = append(s.events, e) }

const (
	CmdMove    = "move"
	CmdHold    = "hold"
	CmdAttack  = "attack"
	CmdBuy     = "buy"
	CmdUpgrade = "upgrade"
)

// Command is one validated change a side asks for. Everything a player or agent does
// to the match goes through Apply; nothing else writes to the simulation.
type Command struct {
	Side    int    `json:"side"`
	Kind    string `json:"kind"`
	Squad   int    `json:"squad,omitempty"`
	Point   string `json:"point,omitempty"`
	Contact int    `json:"contact,omitempty"`
	Unit    string `json:"unit,omitempty"`
	// Place is where a move, hold, attack, capture or repair goes when it is not a plain
	// point, and where a defence or a fence is built; Place2 is a fence's far end.
	// Structure is what to build: a structure id of the side's faction, or a role.
	Place     string `json:"place,omitempty"`
	Place2    string `json:"place2,omitempty"`
	Structure string `json:"structure,omitempty"`
	Field     string `json:"field,omitempty"`  // haul: a gusher id, or "auto"
	Hauler    int    `json:"hauler,omitempty"` // haul: one hauler, or 0 for all of them
}

var (
	ErrOver        = errors.New("the match is over")
	ErrNoSquad     = errors.New("no such squad on your side")
	ErrNoPoint     = errors.New("no such map point")
	ErrUnreachable = errors.New("that squad cannot reach that point")
	ErrNoContact   = errors.New("no such contact in sight")
	ErrNoUnit      = errors.New("your faction has no such unit")
	ErrNoGold      = errors.New("not enough gold")
	ErrPopCap      = errors.New("population cap reached")
	ErrMaxTier     = errors.New("that squad already has the top brain tier")
	ErrBadCommand  = errors.New("unknown command")
)

// Apply carries out a command now, or returns why it cannot be done. For buy it returns
// the new squad, which is still deploying: it takes orders once it is on the field.
func (s *Sim) Apply(c Command) (*Squad, error) {
	if s.Over {
		return nil, ErrOver
	}
	if c.Side != 0 && c.Side != 1 {
		return nil, ErrBadCommand
	}
	switch c.Kind {
	case CmdMove, CmdHold, CmdAttack:
		return s.order(c)
	case CmdBuy:
		return s.buy(c)
	case CmdUpgrade:
		return s.upgrade(c)
	case CmdCapture:
		return s.captureOrder(c)
	case CmdRepair:
		return s.repairOrder(c)
	case CmdBuild:
		_, err := s.build(c)
		return nil, err
	case CmdHaul:
		return s.haulCommand(c)
	}
	return nil, ErrBadCommand
}

func (s *Sim) order(c Command) (*Squad, error) {
	sq := s.Squad(c.Squad)
	if sq == nil || sq.Side != c.Side || sq.haul != nil {
		return nil, ErrNoSquad
	}
	o := Order{Kind: c.Kind, Tick: s.Tick}
	switch {
	case c.Kind == CmdAttack && c.Contact != 0:
		enemy := s.Squad(c.Contact)
		if enemy == nil || enemy.Side == c.Side || !s.visible(enemy) {
			return nil, ErrNoContact
		}
		o.Contact = enemy.ID
		o.X, o.Y = enemy.Center()
	case c.Place != "":
		return s.orderPlace(c, sq)
	case c.Point != "":
		p := s.pointState(c.Point)
		if p == nil {
			return nil, ErrNoPoint
		}
		if sq.unit.Domain != "air" && (p.Y >= s.R.Map.WaterY) != (sq.unit.Domain == "sea") {
			return nil, fmt.Errorf("%w: %s is a %s unit", ErrUnreachable, sq.unit.Name.En, sq.unit.Domain)
		}
		o.Point, o.X, o.Y = p.ID, p.X, p.Y
	case c.Kind == CmdHold:
		o.X, o.Y = sq.Center() // hold where you stand
	default:
		return nil, ErrNoPoint
	}
	sq.Order = o
	return sq, nil
}

// visible reports whether any team of an enemy squad is in sight of the other side.
func (s *Sim) visible(sq *Squad) bool {
	for i := range sq.Teams {
		if sq.Teams[i].Members > 0 && sq.Teams[i].Spotted {
			return true
		}
	}
	return false
}

// Population is a side's living squads plus the ones still deploying. Haulers are not
// squads: they have their own cap.
func (s *Sim) Population(side int) int {
	n := 0
	for _, sq := range s.Squads {
		if sq.Side == side && sq.haul == nil && (sq.Alive || sq.Deploying()) {
			n++
		}
	}
	return n
}

func (s *Sim) spend(side, gold int) error {
	if s.Gold(side) < gold {
		return fmt.Errorf("%w: need %d, have %d", ErrNoGold, gold, s.Gold(side))
	}
	s.Sides[side].goldUnit -= int64(gold) * int64(s.R.TickRate)
	return nil
}

func (s *Sim) buy(c Command) (*Squad, error) {
	// The build tree: the unit must be one this side can field, and what it needs must stand.
	u, err := s.mayBuy(c.Side, c.Unit)
	if err != nil {
		return nil, err
	}
	if u.Class == shared.HaulerClass {
		if err := s.buyHauler(c, u); err != nil {
			return nil, err
		}
	} else if s.Population(c.Side) >= s.R.Match.PopulationCap {
		// A squad on its way already holds its place under the cap.
		return nil, ErrPopCap
	}
	if err := s.spend(c.Side, u.Cost); err != nil {
		return nil, err
	}
	sq := s.raise(c.Side, c.Unit)
	ticks := int(math.Round(u.DeploySeconds * float64(s.R.TickRate)))
	if ticks <= 0 {
		s.field(sq)
		return sq, nil
	}
	sq.DeployTicks, sq.DeployTotal = ticks, ticks
	s.emit(Event{Side: c.Side, Kind: EvDeploying, Squad: sq.ID, Unit: sq.Unit, Count: int(math.Ceil(u.DeploySeconds))})
	return sq, nil
}

func (s *Sim) upgrade(c Command) (*Squad, error) {
	sq := s.Squad(c.Squad)
	if sq == nil || sq.Side != c.Side || sq.haul != nil {
		return nil, ErrNoSquad
	}
	cost, ok := s.R.TierCost(sq.Tier + 1)
	if !ok {
		return nil, ErrMaxTier
	}
	if err := s.spend(c.Side, cost); err != nil {
		return nil, err
	}
	sq.Tier++
	s.emit(Event{Side: c.Side, Kind: EvUpgraded, Squad: sq.ID, Count: sq.Tier})
	return sq, nil
}
