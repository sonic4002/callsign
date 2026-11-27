package sim

import (
	"math"
	"strings"

	"callsign/shared"
)

// Tech buildings stand on the map from the first tick and belong to no army. An engineer
// squad takes one for its side with the ordinary capture order (and is used up doing it);
// the other side's engineers can take it back. While a side holds one it gets what the
// building gives: gold, healing for infantry standing by it, or repairs for vehicles
// beside it. They need nothing to run, cannot be built or sold, and heavy weapons can
// knock one down, which ends what it gave.
//
// In the simulation a tech building is a Structure with role "tech", faction
// shared.TechFaction and, until someone takes it, side NoSide. That gives it hit points,
// a ruin, fog of war as last seen, a place id ("s7") and the capture rules for free.

// EvTechLost tells a side that a tech building it held is now someone else's.
const EvTechLost = "tech_lost" // Structure, Unit, Owner: whose it is now

// initTech puts the map's tech buildings on the ground.
func (s *Sim) initTech() {
	for i := range s.R.Map.TechBuildings {
		site := &s.R.Map.TechBuildings[i]
		def, ok := s.R.TechBuildings[site.Kind]
		if !ok {
			continue
		}
		st := &Structure{
			ID: len(s.Structures) + 1, Side: NoSide, Faction: shared.TechFaction, Kind: site.Kind, Slot: -1,
			X: site.X, Y: site.Y, HP: def.HP, Site: site.ID, def: &def, alarm: never,
		}
		s.Structures = append(s.Structures, st)
		s.blockGround(st, true)
	}
}

// techPlace lets an order name a tech building by its site id ("tech-clinic-w").
func (s *Sim) techPlace(id string) (Place, bool) {
	low := strings.ToLower(id)
	for _, st := range s.Structures {
		if st.Site != "" && strings.ToLower(st.Site) == low && !st.Gone {
			return Place{Kind: PlaceStructure, ID: st.PlaceID(), X: st.X, Y: st.Y, Structure: st}, true
		}
	}
	return Place{}, false
}

// Tech reports whether a structure is a tech building.
func (st *Structure) Tech() bool { return st.def.Role == shared.RoleTech }

// techTaken is called when a tech building has just changed hands: the lump of gold is
// paid, once to each side over a match, and the side that held it is told.
func (s *Sim) techTaken(st *Structure, from int) {
	if !st.Tech() {
		return
	}
	if side := st.Side; side >= 0 && !st.paid[side] && st.def.Lump > 0 {
		st.paid[side] = true
		s.earn(side, int64(st.def.Lump)*int64(s.R.TickRate))
	}
	if from >= 0 {
		owner := st.Side
		s.emit(Event{Side: from, Kind: EvTechLost, Structure: st.PlaceID(), Unit: st.Kind, Point: s.nearestPoint(st.X, st.Y), Owner: &owner})
	}
}

// techWork gives each standing, held tech building's effect for this tick.
func (s *Sim) techWork() {
	quiet := int(s.R.Nerve.QuietSeconds * float64(s.R.TickRate))
	for _, st := range s.Structures {
		if st.Side < 0 || !st.Tech() || !st.Standing() || st.disabledUntil > s.Tick {
			continue
		}
		switch st.def.Effect {
		case shared.EffectGold:
			// Gold is kept as gold × tick rate, so this much a tick is that much a second.
			s.earn(st.Side, int64(st.def.IncomePerSecond))
		case shared.EffectHeal, shared.EffectRepair:
			per := st.def.MendPerSecond / float64(s.R.TickRate)
			for _, sq := range s.Squads {
				if !sq.Alive || sq.Side != st.Side || !mends(st.def.Effect, sq.unit.Class) {
					continue
				}
				full := float64(sq.unit.Members) * sq.unit.HP
				for i := range sq.Teams {
					t := &sq.Teams[i]
					// A fireteam that is gone is not brought back; one being shot at is not mended.
					if t.Members == 0 || t.HP >= full || s.Tick-t.lastShot <= quiet || dist(t.X, t.Y, st.X, st.Y) > st.def.Radius {
						continue
					}
					t.HP = math.Min(full, t.HP+per)
					t.Members = int(math.Ceil(t.HP / sq.unit.HP))
				}
			}
		}
	}
}

// mends reports whether a tech building's effect is for a class of unit: a clinic is for
// soldiers, a service yard for anything on wheels or tracks, haulers among them.
func mends(effect, class string) bool {
	if effect == shared.EffectHeal {
		return class == "infantry"
	}
	return class == "vehicle" || class == shared.HaulerClass
}

func (s *Sim) hashTech(put func(uint64)) {
	for _, st := range s.Structures {
		if st.Site != "" {
			put(uint64(b2i(st.paid[0], 1) | b2i(st.paid[1], 2)))
		}
	}
}
