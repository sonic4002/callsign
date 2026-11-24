package room

import (
	"math"
	"strings"

	"callsign/server/radio"
	"callsign/server/sim"
	"callsign/shared"
)

// The tools for heroes and for digging in. They are orders like move and hold: the
// caller's own squad, through the simulation's own checks.
const (
	ToolFortify = "fortify" // an infantry squad builds a sandbag position where it stands
	ToolPlant   = "plant"   // a hero sets a demolition charge on an enemy structure, a bridge or the enemy headquarters
	ToolSeize   = "seize"   // a hero takes over an enemy vehicle squad
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

// heroNews puts a hero taking the field or falling on the net of the side the event is
// for: its own operator tells its commander, and so does the enemy's.
func (rm *Room) heroNews(e sim.Event) {
	cue := ""
	switch {
	case e.Kind == sim.EvHeroFielded && e.Squad != 0:
		cue = "fielded"
	case e.Kind == sim.EvHeroFielded:
		cue = "enemyFielded"
	case e.Kind == sim.EvHeroFell && e.Squad != 0:
		cue = "fell"
	case e.Kind == sim.EvHeroFell:
		cue = "enemyFell"
	default:
		return
	}
	u, ok := rm.unitNamed(e.Unit)
	line, has := rm.r.Radio.HeroCue[cue]
	if !ok || !has || e.Side < 0 || e.Side > 1 {
		return
	}
	lang := rm.lang[e.Side][radio.Station{Kind: radio.Player}.Key()]
	if lang != "he" {
		lang = "en"
	}
	hero := u.Name.In(lang)
	if sq := rm.sim.SquadAny(e.Squad); sq != nil && e.Squad != 0 {
		// Its own side hears who it is on the net as well.
		hero += " (" + rm.sim.Callsign(sq).In(lang) + ")"
	}
	rm.tellHammer(e.Side, lang, strings.ReplaceAll(line.In(lang), "{hero}", hero))
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
