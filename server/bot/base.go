package bot

import (
	"callsign/server/sim"
	"callsign/shared"
)

// The scripted player's base grows out of what it wants to field. It never builds ahead:
// when the unit it wants next needs a structure it does not have, it builds that
// structure (and first whatever that structure needs), saving for it if it must. Two
// things come before any purchase: a lost barracks or refinery is put back, and once its
// armour is out it places one defence at the front of its base.

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
	return ok && (u.Requires == "" || p.stands(snap, u.Requires)) && (u.Also == "" || p.stands(snap, u.Also))
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
	if snap.Gold < def.Cost {
		return baseStep{wait: true}
	}
	c := sim.Command{Side: p.Side, Kind: sim.CmdBuild, Structure: id}
	if !def.Base() {
		c.Place = "base:front"
	}
	return baseStep{build: &c}
}

// upkeep is the building that does not wait for a purchase: putting back a lost
// barracks or refinery, and one defence once the armour is out.
func (p *Player) upkeep(snap sim.Snapshot, vehicles int) baseStep {
	if p.Style == Rush {
		// A rush wants bodies and nothing else: the barracks, and no economy.
		if !p.stands(snap, shared.RoleBarracks) {
			return p.raise(snap, shared.RoleBarracks, 0)
		}
		return baseStep{}
	}
	// The opening, and what is put back first when it falls: the refinery, which brings
	// a hauler, then the barracks.
	for _, role := range []string{shared.RoleRefinery, shared.RoleBarracks} {
		if !p.stands(snap, role) {
			return p.raise(snap, role, 0)
		}
	}
	if vehicles >= 2 && !p.stands(snap, shared.RoleDefence) && !p.rising(snap, shared.RoleDefence) {
		if step := p.raise(snap, shared.RoleDefence, 0); step.build != nil {
			return step
		}
	}
	return baseStep{}
}
