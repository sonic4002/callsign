package sim

import (
	"errors"
	"fmt"
	"math"

	"callsign/shared"
)

// Selling and repairing a side's own structures.
//
// Selling removes a structure at once and gives back a share of what it cost; what it
// unlocked and the power it gave or used go with it. Repairing mends a damaged structure
// over time for gold in proportion to the damage, until it is whole or the gold is gone.
// An engineer squad sent into a damaged structure of its own side mends it fully, and is
// used up doing it.

const (
	CmdSell = "sell"

	EvStructureSold     = "structure_sold"     // Structure, Unit (its kind), Count: the gold given back
	EvStructureRepaired = "structure_repaired" // Structure, Unit; Squad when engineers did it
	EvRepairStopped     = "repair_stopped"     // Structure, Unit, Reason: "gold"
)

var (
	ErrNotYours   = errors.New("that is not a structure of yours")
	ErrNotDamaged = errors.New("it is not damaged")
)

// OwnStructure resolves a place to a structure the side owns, for the room's tools.
func (s *Sim) OwnStructure(side int, place string) (*Structure, error) {
	return s.ownStructure(side, place)
}

// ownStructure resolves a place to a structure the side owns and that is not a ruin.
func (s *Sim) ownStructure(side int, place string) (*Structure, error) {
	pl, err := s.resolveFor(side, place)
	if err != nil {
		return nil, err
	}
	st := pl.Structure
	if st == nil || st.Side != side || st.Ruin || st.Gone {
		return nil, fmt.Errorf("%w: %s", ErrNotYours, place)
	}
	return st, nil
}

// SellValue is the gold a side gets for selling a structure now. A fence is sold one
// segment at a time, for that segment's share of the run.
func (s *Sim) SellValue(st *Structure) int {
	cost := float64(st.def.Cost)
	if st.def.Role == shared.RoleFence && st.def.Segments > 0 {
		cost /= float64(st.def.Segments)
	}
	return int(math.Round(cost * s.R.Match.SellShare))
}

// sell removes one of a side's structures and pays its share back. The headquarters is
// a map point and not a structure, so it can never be named here.
func (s *Sim) sell(c Command) error {
	place := c.Place
	if place == "" {
		place = c.Structure
	}
	st, err := s.ownStructure(c.Side, place)
	if err != nil {
		return err
	}
	gold := s.SellValue(st)
	s.Sides[c.Side].goldUnit += int64(gold) * int64(s.R.TickRate)
	st.Ruin, st.Gone, st.HP, st.BuildTicks, st.Repairing = true, true, 0, 0, false
	s.blockGround(st, false)
	s.emit(Event{Side: c.Side, Kind: EvStructureSold, Structure: st.PlaceID(), Unit: st.Kind, Count: gold, Point: s.nearestPoint(st.X, st.Y)})
	// The other side sees it go if it is looking; otherwise it finds out when it next looks.
	other := 1 - c.Side
	if st.seen[other].Visible {
		s.remember(st, other)
	}
	return nil
}

// repairFor starts the paid mending of one of a side's structures.
func (s *Sim) repairFor(c Command) error {
	place := c.Place
	if place == "" {
		place = c.Structure
	}
	st, err := s.ownStructure(c.Side, place)
	if err != nil {
		return err
	}
	if st.BuildTicks > 0 {
		return fmt.Errorf("%w: the %s is still going up", ErrBuilding, st.def.Name.En)
	}
	if !st.damaged() {
		return fmt.Errorf("%w: the %s", ErrNotDamaged, st.def.Name.En)
	}
	if s.Gold(c.Side) <= 0 {
		return fmt.Errorf("%w: mending costs gold", ErrNoGold)
	}
	st.Repairing, st.repairSide = true, c.Side
	return nil
}

// RepairCost is the gold it would take to make a structure whole from where it is now.
func (s *Sim) RepairCost(st *Structure) int {
	missing := 1 - math.Max(0, st.HP)/st.def.HP
	return int(math.Ceil(float64(st.def.Cost) * s.R.Match.RepairCostShare * missing))
}

// mayMend checks an engineer squad's order to mend a structure of its own side.
func (s *Sim) mayMend(sq *Squad, st *Structure) error {
	if !sq.unit.Engineer() {
		return ErrNotEngineers
	}
	if st.Side != sq.Side || st.Ruin {
		return fmt.Errorf("%w: %s", ErrNotYours, st.PlaceID())
	}
	if st.BuildTicks > 0 {
		return fmt.Errorf("%w: the %s is still going up", ErrBuilding, st.def.Name.En)
	}
	if !st.damaged() {
		return fmt.Errorf("%w: the %s", ErrNotDamaged, st.def.Name.En)
	}
	return nil
}

// repairStructures does one tick of mending: the paid kind, and engineers at work.
func (s *Sim) repairStructures() {
	m := &s.R.Match
	for _, st := range s.Structures {
		if !st.Repairing {
			continue
		}
		if st.Ruin || st.Side != st.repairSide {
			st.Repairing, st.repairDebt = false, 0
			continue
		}
		// Gold is kept as gold × tick rate, so a second's cost is a tick's cost in units.
		st.repairDebt += float64(st.def.Cost) * m.RepairCostShare * m.RepairPerSecond
		due := int64(st.repairDebt)
		side := &s.Sides[st.Side]
		if side.goldUnit < due || (due == 0 && side.goldUnit <= 0) {
			st.Repairing, st.repairDebt = false, 0
			s.emit(Event{Side: st.Side, Kind: EvRepairStopped, Structure: st.PlaceID(), Unit: st.Kind, Reason: "gold", Point: s.nearestPoint(st.X, st.Y)})
			continue
		}
		side.goldUnit -= due
		st.repairDebt -= float64(due)
		st.HP = math.Min(st.def.HP, st.HP+st.def.HP*m.RepairPerSecond*s.dt)
		if st.HP >= st.def.HP {
			st.Repairing, st.repairDebt = false, 0
			s.emit(Event{Side: st.Side, Kind: EvStructureRepaired, Structure: st.PlaceID(), Unit: st.Kind, Point: s.nearestPoint(st.X, st.Y)})
		}
	}

	// Engineers: beside the structure and left alone for as long as a takeover takes, they
	// make it whole, and stay inside.
	quiet := int(s.R.Nerve.QuietSeconds * float64(s.R.TickRate))
	for _, sq := range s.Squads {
		if !sq.Alive || sq.Order.Kind != OrderRepair || sq.Order.Structure == 0 {
			continue
		}
		st := s.structure(sq.Order.Structure)
		if st == nil || st.Ruin || st.Side != sq.Side || !st.damaged() {
			x, y := sq.Center()
			sq.Order = Order{Kind: OrderHold, X: x, Y: y, Tick: s.Tick, arrived: true}
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
		st.HP, st.Repairing, st.repairDebt = st.def.HP, false, 0
		s.emit(Event{Side: sq.Side, Kind: EvStructureRepaired, Structure: st.PlaceID(), Unit: st.Kind, Squad: sq.ID, Point: s.nearestPoint(st.X, st.Y)})
		for i := range sq.Teams {
			sq.Teams[i].Members, sq.Teams[i].HP = 0, 0
		}
		sq.Alive = false
		s.emit(Event{Side: sq.Side, Kind: EvSquadLost, Squad: sq.ID, Point: s.nearestPoint(st.X, st.Y), Reason: "spent"})
	}
}

// damaged reports whether a structure has lost health worth mending. Going up, its health
// is added a tick at a time, which can leave a finished one a hair under full.
func (st *Structure) damaged() bool { return st.HP < st.def.HP-0.5 }
