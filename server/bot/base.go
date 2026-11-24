package bot

import (
	"callsign/server/sim"
	"callsign/shared"
)

// The scripted player's base grows out of the opening and of what it wants to field: see
// upkeep. When the unit it wants next needs a structure it does not have, it builds that
// structure (and first whatever that structure needs), saving for it if it must. Every
// structure goes where the game's own SiteFor puts it: the order names no place.

// baseStep is what the base asks for this turn.
type baseStep struct {
	build *sim.Command // start this structure now
	wait  bool         // the structure is going up, or the side is saving for it
}

// stands reports whether the side has a finished structure with a role.
func (p *Player) stands(snap sim.Snapshot, role string) bool {
	for _, st := range snap.Structures {
		if st.Side == p.Side && !st.Ruin && st.Building >= 1 && st.Role == role {
			return true
		}
	}
	return false
}

// rising reports whether a structure with a role is going up.
func (p *Player) rising(snap sim.Snapshot, role string) bool {
	for _, st := range snap.Structures {
		if st.Side == p.Side && !st.Ruin && st.Building < 1 && st.Role == role {
			return true
		}
	}
	return false
}

// canBuy reports whether the structure a unit needs stands.
func (p *Player) canBuy(snap sim.Snapshot, unit string) bool {
	u, ok := p.R.Factions[snap.Faction].Units[unit]
	return ok && (u.Requires == "" || p.stands(snap, u.Requires))
}

// raise asks for the structure with a role, or for what it needs first.
func (p *Player) raise(snap sim.Snapshot, role string, depth int) baseStep {
	f := p.R.Factions[snap.Faction]
	id, def := f.StructureOfRole(role)
	if def == nil || depth > 4 {
		return baseStep{}
	}
	if p.rising(snap, role) {
		return baseStep{wait: true}
	}
	for _, need := range def.Requires {
		if !p.stands(snap, need) {
			return p.raise(snap, need, depth+1)
		}
	}
	// One base structure goes up at a time, and one defence beside it.
	for _, st := range snap.Structures {
		if st.Side == p.Side && !st.Ruin && st.Building < 1 && (st.Role != shared.RoleDefence && st.Role != shared.RoleFence) == def.Base() {
			return baseStep{wait: true}
		}
	}
	// Power first: what would leave the side short waits for another power structure.
	if role != shared.RolePower && def.Power < 0 && p.spare(snap)+def.Power < 0 && p.powerCount(snap) < p.R.Match.PowerStructures {
		return p.raise(snap, shared.RolePower, depth+1)
	}
	if snap.Gold < def.Cost {
		return baseStep{wait: true}
	}
	c := sim.Command{Side: p.Side, Kind: sim.CmdBuild, Structure: id}
	if !def.Base() {
		c.Place = "base:front"
	}
	return baseStep{build: &c}
}

// upkeep is the building that does not wait for a purchase. The base grows in the order
// of the opening (rules: match.opening, as the game works it out in Snapshot.Opening):
// power, the refinery and the barracks at once, and put back first when they fall. What
// comes after them (the works, the radar, the airbase) goes up when the unit wanted next
// needs it, or as soon as there is gold to spare for it. Power comes before anything
// that would leave the base short. A damaged structure is mended when the side is rich,
// and once the armour is out one defence goes up at the front. It sells nothing and
// sets no rally point.
func (p *Player) upkeep(snap sim.Snapshot, vehicles int) baseStep {
	if p.Style == Rush {
		// A rush wants bodies and nothing else: the barracks, and no economy.
		if !p.stands(snap, shared.RoleBarracks) {
			return p.raise(snap, shared.RoleBarracks, 0)
		}
		return baseStep{}
	}
	switch next := snap.Opening; next {
	case "":
	case shared.RolePower, shared.RoleRefinery, shared.RoleBarracks:
		return p.raise(snap, next, 0)
	default:
		// Ahead of need only with gold to spare: the structure, and two squads besides.
		f := p.R.Factions[snap.Faction]
		if _, def := f.StructureOfRole(next); def != nil && snap.Gold >= def.Cost+p.reserve(snap) {
			if step := p.raise(snap, next, 0); step.build != nil {
				return step
			}
		}
	}
	if st := p.worstDamaged(snap); st != "" && snap.Gold >= 2*p.reserve(snap) {
		return baseStep{build: &sim.Command{Side: p.Side, Kind: sim.CmdRepair, Place: st}}
	}
	if vehicles >= 2 && !p.stands(snap, shared.RoleDefence) && !p.rising(snap, shared.RoleDefence) {
		if step := p.raise(snap, shared.RoleDefence, 0); step.build != nil {
			return step
		}
	}
	return baseStep{}
}

// reserve is the gold the side keeps for the fight while it builds ahead: two squads of
// its line infantry.
func (p *Player) reserve(snap sim.Snapshot) int {
	_, u := p.unitOf(snap.Faction, "infantry")
	return 2 * u.Cost
}

// worstDamaged is the side's own standing structure that has lost the most, of those
// under two thirds of their strength and not being mended already.
func (p *Player) worstDamaged(snap sim.Snapshot) string {
	best, worst := "", 0.66
	for _, st := range snap.Structures {
		if st.Side == p.Side && !st.Ruin && st.Building >= 1 && !st.Repairing && st.Role != shared.RoleFence && st.HP < worst {
			best, worst = st.ID, st.HP
		}
	}
	return best
}

// spare is the power the side will have to spare once everything going up stands.
func (p *Player) spare(snap sim.Snapshot) float64 {
	spare := float64(snap.Power.Supply - snap.Power.Use)
	f := p.R.Factions
	for _, st := range snap.Structures {
		if st.Side == p.Side && !st.Ruin && st.Building < 1 {
			spare += f[st.Faction].Structures[st.Kind].Power
		}
	}
	return spare
}

// powerCount is how many power structures the side has, standing or going up.
func (p *Player) powerCount(snap sim.Snapshot) int {
	n := 0
	for _, st := range snap.Structures {
		if st.Side == p.Side && !st.Ruin && st.Role == shared.RolePower {
			n++
		}
	}
	return n
}
