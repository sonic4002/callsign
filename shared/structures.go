package shared

import (
	"fmt"
	"sort"
)

// Structure roles. A role is what a structure is for; each faction has its own structure
// for every role, with its own name and numbers.
const (
	RoleHQ       = "hq"
	RoleBarracks = "barracks"
	RoleWorks    = "works"
	RoleAirbase  = "airbase"
	RoleDockyard = "dockyard"
	RoleRefinery = "refinery"
	RoleDefence  = "defence"
	RoleFence    = "fence"
	// RoleTech is a building of no army that stands on the map from the start: whoever's
	// engineers take it gets what it gives (gold, healing, repairs).
	RoleTech  = "tech"
	RolePower = "power" // supplies the power the other structures use (sim/power.go)
	RoleRadar = "radar" // turns the mini map on, and is what the airbase needs
)

// What a tech building gives its holder.
const (
	EffectGold   = "gold"
	EffectHeal   = "heal"
	EffectRepair = "repair"
)

// Target classes a weapon's `vs` table may name besides the unit classes and "hq".
const (
	TargetStructure = "structure"
	TargetFence     = "fence"
)

// BaseRoles are the structures that stand in a base slot, in the order a base grows.
var BaseRoles = []string{RolePower, RoleBarracks, RoleRefinery, RoleWorks, RoleRadar, RoleDockyard, RoleAirbase}

// Structure is something a side builds: a base structure that unlocks units, a defence
// that fires on its own, or a fence that stops ground units.
type Structure struct {
	Name         Text     `json:"name"`
	Role         string   `json:"role"`
	Cost         int      `json:"cost"`
	BuildSeconds float64  `json:"buildSeconds"`
	HP           float64  `json:"hp"`
	Armor        float64  `json:"armor"`
	Requires     []string `json:"requires"`  // roles that must stand before this can be built
	Unlocks      []string `json:"unlocks"`   // unit ids this structure lets its owner buy
	Footprint    float64  `json:"footprint"` // radius of the ground it stands on
	Sight        float64  `json:"sight"`
	Capturable   bool     `json:"capturable,omitempty"`
	// Power is what the structure supplies (above zero) or uses (below zero) while it
	// stands. A side that uses more than it supplies is on low power.
	Power float64 `json:"power,omitempty"`

	// Defences fire like a unit's weapon.
	Range         float64            `json:"range,omitempty"`
	Damage        float64            `json:"damage,omitempty"`
	CooldownTicks int                `json:"cooldownTicks,omitempty"`
	Accuracy      float64            `json:"accuracy,omitempty"`
	Pierce        float64            `json:"pierce,omitempty"`
	Vs            map[string]float64 `json:"vs,omitempty"`

	// Fences are bought as a run of segments.
	Blocks        string  `json:"blocks,omitempty"` // "ground"
	Segments      int     `json:"segments,omitempty"`
	SegmentLength float64 `json:"segmentLength,omitempty"`

	// Tech buildings (role "tech") give their holder one thing.
	Effect          string   `json:"effect,omitempty"`          // "gold", "heal" or "repair"
	Lump            int      `json:"lump,omitempty"`            // gold paid once to each side that takes it
	IncomePerSecond int      `json:"incomePerSecond,omitempty"` // gold while it is held
	MendPerSecond   float64  `json:"mendPerSecond,omitempty"`   // hit points given back to each fireteam near it
	Radius          float64  `json:"radius,omitempty"`          // how near a fireteam has to stand
	About           Text     `json:"about,omitempty"`           // what it does, in a few words
	Aliases         []string `json:"aliases,omitempty"`         // other words for it, both languages
}

// Against is the damage multiplier of a defence's weapon on a target class.
func (st *Structure) Against(class string) float64 {
	if v, ok := st.Vs[class]; ok {
		return v
	}
	return 1
}

// TargetClass is the `vs` key a weapon uses against this structure.
func (st *Structure) TargetClass() string {
	if st.Role == RoleFence {
		return TargetFence
	}
	return TargetStructure
}

// Base reports whether the structure stands in a base slot (one of each role per side).
func (st *Structure) Base() bool {
	return st.Role != RoleHQ && st.Role != RoleDefence && st.Role != RoleFence && st.Role != RoleTech
}

// TechIDs lists the kinds of tech building in a fixed order.
func (r *Rules) TechIDs() []string {
	ids := make([]string, 0, len(r.TechBuildings))
	for id := range r.TechBuildings {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// TechFaction is what a tech building carries where a structure names its faction.
const TechFaction = "tech"

// StructureDef finds the definition of a structure by whose design it is and its kind:
// a faction's own, or a tech building's (faction TechFaction).
func (r *Rules) StructureDef(faction, kind string) (Structure, bool) {
	if faction == TechFaction {
		st, ok := r.TechBuildings[kind]
		return st, ok
	}
	st, ok := r.Factions[faction].Structures[kind]
	return st, ok
}

// TechSite is one tech building standing on a map.
type TechSite struct {
	ID      string  `json:"id"`
	Kind    string  `json:"kind"`
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
	Near    string  `json:"near"`    // the nearest map point
	Bearing string  `json:"bearing"` // where it lies from that point
	Name    Text    `json:"name"`    // "the clinic north of Foxtrot"
}

func (r *Rules) checkTech() error {
	for _, id := range r.TechIDs() {
		st := r.TechBuildings[id]
		if st.Role != RoleTech || st.Name.En == "" || st.Name.He == "" || st.About.En == "" || st.About.He == "" {
			return fmt.Errorf("tech building %s needs role \"tech\", a name and what it does in both languages", id)
		}
		if st.HP <= 0 || st.Footprint <= 0 || st.Armor < 0 || st.Armor >= 1 || !st.Capturable {
			return fmt.Errorf("tech building %s has a bad stat, or cannot be captured", id)
		}
		switch st.Effect {
		case EffectGold:
			if st.Lump < 0 || st.IncomePerSecond <= 0 {
				return fmt.Errorf("tech building %s gives no gold", id)
			}
		case EffectHeal, EffectRepair:
			if st.MendPerSecond <= 0 || st.Radius <= 0 {
				return fmt.Errorf("tech building %s needs mendPerSecond and radius", id)
			}
		default:
			return fmt.Errorf("tech building %s has unknown effect %q", id, st.Effect)
		}
	}
	for _, m := range r.Maps {
		seen := map[string]bool{}
		for _, site := range m.TechBuildings {
			if _, ok := r.TechBuildings[site.Kind]; !ok {
				return fmt.Errorf("map %s: tech building %s is of unknown kind %q", m.ID, site.ID, site.Kind)
			}
			if site.ID == "" || seen[site.ID] || site.Name.En == "" || site.Name.He == "" {
				return fmt.Errorf("map %s: tech building %q needs an id of its own and a name in both languages", m.ID, site.ID)
			}
			seen[site.ID] = true
			if m.TerrainAt(site.X, site.Y) != 'L' {
				return fmt.Errorf("map %s: tech building %s is not on land", m.ID, site.ID)
			}
		}
	}
	return nil
}

// StructureIDs lists a faction's structure ids in a fixed order, so that nothing in the
// simulation depends on map iteration.
func (f *Faction) StructureIDs() []string {
	ids := make([]string, 0, len(f.Structures))
	for id := range f.Structures {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// StructureOfRole returns the faction's first structure with a role, by id order.
func (f *Faction) StructureOfRole(role string) (string, *Structure) {
	for _, id := range f.StructureIDs() {
		if st := f.Structures[id]; st.Role == role {
			return id, &st
		}
	}
	return "", nil
}

func (r *Rules) checkStructures(name string, f *Faction) error {
	roles := map[string]bool{}
	for _, id := range f.StructureIDs() {
		st := f.Structures[id]
		roles[st.Role] = true
		if st.Name.En == "" || st.Name.He == "" {
			return fmt.Errorf("structure %s needs a name in both languages", id)
		}
		if st.HP <= 0 || st.Cost < 0 || st.BuildSeconds < 0 || st.Footprint <= 0 || st.Armor < 0 || st.Armor >= 1 {
			return fmt.Errorf("structure %s has a bad stat", id)
		}
		switch st.Role {
		case RoleHQ, RoleBarracks, RoleWorks, RoleAirbase, RoleDockyard, RoleRefinery, RoleRadar:
		case RolePower:
			if st.Power <= 0 {
				return fmt.Errorf("power structure %s supplies no power", id)
			}
		case RoleDefence:
			if st.Range <= 0 || st.Damage <= 0 || st.CooldownTicks <= 0 || st.Accuracy <= 0 {
				return fmt.Errorf("defence %s needs a weapon", id)
			}
		case RoleFence:
			if st.Segments <= 0 || st.SegmentLength <= 0 {
				return fmt.Errorf("fence %s needs segments and a segment length", id)
			}
		default:
			return fmt.Errorf("structure %s has unknown role %q", id, st.Role)
		}
		for _, u := range st.Unlocks {
			unit, ok := f.Units[u]
			if !ok || unit.Requires != st.Role {
				return fmt.Errorf("structure %s unlocks %q, which is not a unit that requires a %s", id, u, st.Role)
			}
		}
	}
	for id, u := range f.Units {
		if u.Requires != "" && !roles[u.Requires] {
			return fmt.Errorf("faction %s: unit %s requires a %s, which the faction cannot build", name, id, u.Requires)
		}
	}
	for _, role := range r.Match.StartStructures {
		if !roles[role] {
			return fmt.Errorf("faction %s has no structure for the starting role %q", name, role)
		}
	}
	return nil
}

// UnitIDs lists a faction's unit ids in a fixed order.
func (f *Faction) UnitIDs() []string {
	ids := make([]string, 0, len(f.Units))
	for id := range f.Units {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}
