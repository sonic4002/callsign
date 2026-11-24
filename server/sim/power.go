package sim

import (
	"math"

	"callsign/shared"
)

// Power is a side's second constraint. Structures supply it or use it; a side that uses
// more than it supplies is on low power: its structures go up and its units deploy at a
// share of the usual speed, its powered defences stop firing and its radar stops. The
// headquarters supplies a little by itself, so an opening is never blocked.

const (
	EvLowPower      = "low_power"      // Count is how much is missing
	EvPowerRestored = "power_restored" // Count is how much is to spare
)

// powerState is one side's power this tick.
type powerState struct {
	supply, use float64
	low         bool
	// debt carries the work a side on low power still owes itself: it builds and deploys
	// only on the ticks where the debt has grown to a whole tick.
	debt float64
	// works is whether construction and deployment advance for this side this tick.
	works bool
}

// PowerView is a side's power as its commander sees it.
type PowerView struct {
	Supply int  `json:"supply"`
	Use    int  `json:"use"`
	Low    bool `json:"low"`
}

// powerOf adds up what a side's standing structures supply and use. The headquarters
// is a map point, not a structure; its share comes from its rules entry.
func (s *Sim) powerOf(side int) (supply, use float64) {
	if _, hq := s.faction(side).StructureOfRole(shared.RoleHQ); hq != nil && s.Sides[side].HQHP > 0 {
		supply += math.Max(0, hq.Power)
	}
	for _, st := range s.Structures {
		if st.Side != side || !st.Standing() {
			continue
		}
		if st.def.Power > 0 {
			supply += st.def.Power
		} else {
			use -= st.def.Power
		}
	}
	return supply, use
}

// powerStep works out each side's power for the tick, says so once when it runs short
// or comes back, and decides whether the side's building and deploying advance.
func (s *Sim) powerStep() {
	for side := range s.Sides {
		p := &s.power[side]
		p.supply, p.use = s.powerOf(side)
		low := p.use > p.supply
		if low != p.low {
			p.low = low
			kind, n := EvPowerRestored, p.supply-p.use
			if low {
				kind, n = EvLowPower, p.use-p.supply
			}
			s.emit(Event{Side: side, Kind: kind, Count: int(math.Round(n)), Point: s.R.HQPoint(side).ID})
		}
		p.works = true
		if !low {
			p.debt = 0
			continue
		}
		factor := s.R.Match.LowPowerFactor
		if factor <= 0 || factor >= 1 {
			continue // no slow-down set in the rules
		}
		p.debt += factor
		if p.debt >= 1 {
			p.debt--
		} else {
			p.works = false
		}
	}
}

// LowPower reports whether a side uses more power than it supplies.
func (s *Sim) LowPower(side int) bool { return s.power[side].low }

// Power is a side's supply and use, in whole units.
func (s *Sim) Power(side int) PowerView {
	p := s.power[side]
	return PowerView{Supply: int(math.Round(p.supply)), Use: int(math.Round(p.use)), Low: p.low}
}

// powered reports whether a structure is doing its work: it stands, and it is not a
// power user on a side that is short of power.
func (s *Sim) powered(st *Structure) bool {
	return st.Standing() && !(st.def.Power < 0 && s.power[st.Side].low)
}

// Radar reports whether a side has its mini map: its radar structure stands and the side
// has power. A faction whose rules have no radar structure always has it.
func (s *Sim) Radar(side int) bool {
	if _, def := s.faction(side).StructureOfRole(shared.RoleRadar); def == nil {
		return true
	}
	for _, st := range s.Structures {
		if st.Side == side && st.def.Role == shared.RoleRadar && s.powered(st) {
			return true
		}
	}
	return false
}

// NextInOpening is the role a side's base should grow by next, following the opening in
// the rules, or "" when the opening is complete. Power comes first whenever the next
// structure would leave the side short of it. The scripted player and an operator with
// the purse both build by this.
func (s *Sim) NextInOpening(side int) string {
	f := s.faction(side)
	supply, use := s.powerOf(side)
	// What is going up already counts, or the side would order it twice.
	pending := func(role string) bool {
		for _, st := range s.Structures {
			if st.Side == side && !st.Ruin && st.def.Role == role {
				return true
			}
		}
		return false
	}
	for _, st := range s.Structures {
		if st.Side == side && !st.Ruin && st.BuildTicks > 0 {
			if st.def.Power > 0 {
				supply += st.def.Power
			} else {
				use -= st.def.Power
			}
		}
	}
	for _, role := range s.R.Match.Opening {
		_, def := f.StructureOfRole(role)
		if def == nil || pending(role) {
			continue
		}
		if role == shared.RolePower {
			return role // where the opening puts it, a side builds its first one
		}
		if use-def.Power > supply && s.powerCount(side) < s.R.Match.PowerStructures {
			return shared.RolePower
		}
		return role
	}
	if use > supply && s.powerCount(side) < s.R.Match.PowerStructures {
		return shared.RolePower
	}
	return ""
}

// powerCount is how many power structures a side has, standing or going up.
func (s *Sim) powerCount(side int) int {
	n := 0
	for _, st := range s.Structures {
		if st.Side == side && !st.Ruin && st.def.Role == shared.RolePower {
			n++
		}
	}
	return n
}

func (s *Sim) hashPower(put func(uint64), f func(float64)) {
	for side := range s.power {
		p := s.power[side]
		f(p.debt)
		put(uint64(b2i(p.low, 1)))
	}
}
