package room

import (
	"errors"
	"log"
	"strings"

	"callsign/server/radio"
	"callsign/server/sim"
)

// Base cues are the short fixed lines the operator says about the base by itself:
// "construction complete", "not enough gold", "our base is under attack". The server
// writes them from the rules' own words (radio.cues), in the net's language, and sends
// each as a radio message from the operator to the commander of that side only. No model
// is asked, and no agent is woken: a squad is not addressed, and the operator's own
// agent never answers its own voice.
//
// Each kind of cue has a gap; a repeat inside the gap is dropped, so a base under fire
// says so once and not with every shell.

// cueOf maps what happened to the cue that tells of it, with the words to fill in.
// It returns "" when the event is not one the operator speaks about.
func (rm *Room) cueOf(e sim.Event) (key string, vars map[string]string) {
	side := e.Side
	if side < 0 || side > 1 {
		return "", nil
	}
	lang := rm.cueLang(side)
	vars = map[string]string{"point": rm.pointName(e.Point, lang)}
	structure := func() string { return rm.kindName(e.Unit, lang) }
	mine := e.Owner != nil && *e.Owner == side
	switch e.Kind {
	case sim.EvStructureBuilt:
		vars["structure"] = structure()
		if rm.unlocks(e.Unit) {
			return "newOptions", vars
		}
		return "structureReady", vars
	case sim.EvSquadSpawned:
		sq := rm.squadAny(e.Squad)
		if sq == nil || e.Tick < rm.r.TickRate {
			return "", nil // the squads a match starts with are not news
		}
		vars["squad"] = rm.squadName(sq).In(lang)
		return "unitReady", vars
	case sim.EvHQUnderAttack, sim.EvStructureAttacked:
		return "baseUnderAttack", vars
	case sim.EvHaulerAttacked:
		vars["unit"] = rm.haulerName(e, lang)
		return "haulerUnderAttack", vars
	case sim.EvHaulerLost:
		vars["unit"] = rm.haulerName(e, lang)
		return "haulerLost", vars
	case sim.EvStructureLost:
		if !mine {
			return "", nil // an enemy structure falling is for the squads to report
		}
		vars["structure"] = structure()
		return "structureLost", vars
	case sim.EvStructureCaptured:
		vars["structure"] = structure()
		if mine {
			return "structureTaken", vars
		}
		if e.Reason == "seen" {
			return "", nil // it was never ours: the squad that saw it reports it
		}
		return "structureLost", vars
	case sim.EvTechLost:
		vars["structure"] = structure()
		return "structureLost", vars
	}
	// Events other parts of the game raise are matched by name, so a cue can be given
	// to one in the rules alone (low power, a hero in the field).
	for name, cue := range rm.r.Radio.Cues {
		for _, kind := range cue.Events {
			if kind == e.Kind {
				if sq := rm.squadAny(e.Squad); sq != nil {
					vars["squad"] = rm.squadName(sq).In(lang)
				}
				if e.Unit != "" {
					vars["structure"], vars["unit"] = rm.kindName(e.Unit, lang), rm.kindName(e.Unit, lang)
				}
				return name, vars
			}
		}
	}
	return "", nil
}

// In is a name in one of the two languages.
func (n Name) In(lang string) string {
	if lang == "he" {
		return n.He
	}
	return n.En
}

func (rm *Room) cueLang(side int) string {
	if rm.lang[side][radio.Station{Kind: radio.Player}.Key()] == "he" {
		return "he"
	}
	return "en"
}

func (rm *Room) pointName(id, lang string) string {
	for _, p := range rm.r.Map.Points {
		if p.ID == id {
			return p.Callsign.In(lang)
		}
	}
	return id
}

// kindName is the name of a structure or a unit by its rules id, whoever's design it is.
func (rm *Room) kindName(kind, lang string) string {
	if def, ok := rm.r.TechBuildings[kind]; ok {
		return def.Name.In(lang)
	}
	for _, name := range rm.factionNames() {
		f := rm.r.Factions[name]
		if def, ok := f.Structures[kind]; ok {
			return def.Name.In(lang)
		}
		if u, ok := f.Units[kind]; ok {
			return u.Name.In(lang)
		}
	}
	return kind
}

func (rm *Room) factionNames() []string {
	return []string{rm.sim.Sides[0].Faction, rm.sim.Sides[1].Faction}
}

// unlocks reports whether a structure of this kind opens something to buy.
func (rm *Room) unlocks(kind string) bool {
	for _, name := range rm.factionNames() {
		if def, ok := rm.r.Factions[name].Structures[kind]; ok {
			return len(def.Unlocks) > 0
		}
	}
	return false
}

func (rm *Room) haulerName(e sim.Event, lang string) string {
	id := e.Hauler
	if id == 0 {
		id = e.Squad
	}
	if sq := rm.squadAny(id); sq != nil {
		return rm.kindName(sq.Unit, lang)
	}
	return rm.kindName(e.Unit, lang)
}

// cue sends one base cue to a side, unless the same kind was said too recently.
func (rm *Room) cue(side int, key string, vars map[string]string) {
	def, ok := rm.r.Radio.Cues[key]
	if !ok || side < 0 || side > 1 {
		return
	}
	if rm.cued[side] == nil {
		rm.cued[side] = map[string]int{}
	}
	gap := int(def.Gap * float64(rm.r.TickRate))
	if last, said := rm.cued[side][key]; said && rm.sim.Tick-last < gap {
		return
	}
	rm.cued[side][key] = rm.sim.Tick
	lang := rm.cueLang(side)
	body := def.Line.In(lang)
	for name, value := range vars {
		body = strings.ReplaceAll(body, "{"+name+"}", value)
	}
	if strings.Contains(body, "{") {
		return // a word the line needs is missing: say nothing rather than half of it
	}
	from, to := radio.Station{Kind: radio.Operator}, radio.Station{Kind: radio.Player}
	text, err := rm.net.Compose(lang, from, []radio.Station{to}, body, radio.Out)
	if err != nil {
		log.Printf("cue %s for side %d: %v", key, side, err)
		return
	}
	rm.seq++
	m := Message{
		Seq: rm.seq, Tick: rm.sim.Tick, From: rm.name(from, side), To: []Name{rm.name(to, side)},
		Lang: lang, Text: text, Body: body, End: radio.Out, Cue: key,
	}
	rm.logs[side] = append(rm.logs[side], m)
	rm.broadcast(side, map[string]any{"type": "radio", "message": m})
}

// cueEvent says what the operator has to say about an event, if anything.
func (rm *Room) cueEvent(e sim.Event) {
	if key, vars := rm.cueOf(e); key != "" {
		rm.cue(e.Side, key, vars)
	}
}

// cueRefusal says why a purchase or a build was refused, when the reason is one the
// operator has a fixed line for: not enough gold, or a production line that is full.
func (rm *Room) cueRefusal(side int, err error) {
	switch {
	case errors.Is(err, sim.ErrNoGold):
		rm.cue(side, "noGold", nil)
	case errors.Is(err, sim.ErrLineFull):
		rm.cue(side, "queueFull", nil)
	}
}
