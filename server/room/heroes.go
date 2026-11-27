package room

import (
	"math"
	"strings"

	"callsign/server/sim"
	"callsign/shared"
)

// The tools for heroes and for digging in. They are orders like move and hold: the
// caller's own squad, through the simulation's own checks.
const (
	ToolFortify = "fortify" // an infantry squad builds a sandbag position where it stands
	ToolPlant   = "plant"   // a hero sets a demolition charge on an enemy structure, a bridge or the enemy headquarters
	ToolSeize   = "seize"   // a hero takes over an enemy vehicle squad
	ToolSalvo   = "salvo"   // a squad with missile pods (the attack helicopter) empties them over a place
)

// unitNamed finds a unit by id in whichever army has it: a side may hold a squad that is
// not of its own design.
func (rm *Room) unitNamed(id string) (shared.Unit, bool) {
	for _, f := range rm.r.Factions {
		if u, ok := f.Units[id]; ok {
			return u, true
		}
	}
	return shared.Unit{}, false
}

// builtPlace finds a sandbag position a side knows of by its name in either language,
// or, for the bare word, the one nearest to (x, y). It returns the position's id, or "".
func (rm *Room) builtPlace(side int, low string, x, y float64) string {
	built := rm.sim.BuiltLandmarks(side)
	trim := func(s string) string { return strings.TrimPrefix(strings.ToLower(s), "the ") }
	for _, l := range built {
		if strings.Contains(low, trim(l.Name.En)) || strings.Contains(low, l.Name.He) {
			return l.ID
		}
	}
	word := rm.r.LandmarkKinds[sim.Sandbags].Word
	// "שקי חול" is said "שקי החול" with the article.
	said := strings.ReplaceAll(low, "שקי החול", word.He)
	if !strings.Contains(said, strings.ToLower(word.En)) && !strings.Contains(said, word.He) {
		return ""
	}
	best, bd := "", math.MaxFloat64
	for _, l := range built {
		if d := math.Hypot(l.X-x, l.Y-y); d < bd {
			best, bd = l.ID, d
		}
	}
	return best
}
