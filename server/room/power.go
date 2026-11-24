package room

import (
	"fmt"
	"strconv"
	"strings"

	"callsign/server/radio"
	"callsign/server/sim"
)

// The operator's tools for the structures the side already has: selling one, and paying
// to mend one. Both follow the purse exactly as building does.
const ToolSell = "sell"

// ownStructurePlace resolves what the operator wrote to one of the side's own structures.
func (rm *Room) ownStructurePlace(side int, a toolArgs, tool string) (string, error) {
	text := a.Place
	if text == "" {
		text = a.Structure
	}
	if text == "" {
		return "", fmt.Errorf("%s needs `place`: one of your structures, by its id or its name", tool)
	}
	hq := rm.r.HQPoint(side)
	return rm.place(side, text, false, hq.X, hq.Y)
}

func (rm *Room) toolSell(side int, a toolArgs) (any, error) {
	place, err := rm.ownStructurePlace(side, a, ToolSell)
	if err != nil {
		return nil, err
	}
	st, err := rm.sim.OwnStructure(side, place)
	if err != nil {
		return nil, err
	}
	own, err := rm.mayActAlone(side, ToolSell)
	if err != nil {
		return nil, err
	}
	def, before := st.Def(), rm.sim.Gold(side)
	if _, err := rm.sim.Apply(sim.Command{Side: side, Kind: sim.CmdSell, Place: place}); err != nil {
		return nil, err
	}
	back := rm.sim.Gold(side) - before
	if own {
		rm.announceStructure(side, "sold", def.Name.In, back)
	}
	return map[string]any{"announced": own, "sold": place, "name": def.Name.En, "back": back, "gold": rm.sim.Gold(side)}, nil
}

// toolMend is the operator's repair: the side pays, and the structure mends over time.
func (rm *Room) toolMend(side int, a toolArgs) (any, error) {
	place, err := rm.ownStructurePlace(side, a, ToolRepair)
	if err != nil {
		return nil, err
	}
	st, err := rm.sim.OwnStructure(side, place)
	if err != nil {
		return nil, err
	}
	own, err := rm.mayActAlone(side, ToolRepair)
	if err != nil {
		return nil, err
	}
	cost := rm.sim.RepairCost(st)
	if _, err := rm.sim.Apply(sim.Command{Side: side, Kind: sim.CmdRepair, Place: place}); err != nil {
		return nil, err
	}
	def := st.Def()
	if own {
		rm.announceStructure(side, "repairing", def.Name.In, cost)
	}
	return map[string]any{"announced": own, "repairing": place, "name": def.Name.En, "cost": cost, "gold": rm.sim.Gold(side)}, nil
}

// announceStructure tells Hammer of something the operator did to a structure unasked.
func (rm *Room) announceStructure(side int, line string, name func(string) string, gold int) {
	lang := rm.lang[side][radio.Station{Kind: radio.Player}.Key()]
	if lang != "he" {
		lang = "en"
	}
	body := strings.NewReplacer("{unit}", name(lang), "{cost}", strconv.Itoa(gold)).Replace(rm.r.Radio.OwnPurchase[line].In(lang))
	rm.tellHammer(side, lang, body)
}
