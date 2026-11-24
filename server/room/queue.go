package room

import (
	"fmt"
	"strings"

	"callsign/server/sim"
)

// The operator's tools for production lines: take a unit out of its line, and say where
// new units gather.
const (
	ToolCancel = "cancel"
	ToolRally  = "rally"
)

// homeWords put a rally point back beside its structure, in both languages.
var homeWords = []string{"home", "default", "beside", "by the door", "at the structure", "ליד המבנה", "בבית", "רגיל", "ברירת מחדל"}

// unitKey finds which unit a text names for a side: by id, or by its name in either
// language, among the side's own units and those a captured structure gives it.
func (rm *Room) unitKey(side int, text string) (string, bool) {
	low := strings.ToLower(strings.TrimSpace(text))
	if low == "" {
		return "", false
	}
	factions := []string{rm.sim.Sides[side].Faction}
	for name := range rm.r.Factions {
		if name != factions[0] {
			factions = append(factions, name)
		}
	}
	for pass := 0; pass < 2; pass++ {
		for _, name := range factions {
			f := rm.r.Factions[name]
			for _, id := range f.UnitIDs() {
				u := f.Units[id]
				exact := low == strings.ToLower(id) || low == strings.ToLower(u.Name.En) || low == u.Name.He
				inside := strings.Contains(low, strings.ToLower(u.Name.En)) || strings.Contains(low, u.Name.He)
				if (pass == 0 && exact) || (pass == 1 && inside) {
					return id, true
				}
			}
		}
	}
	return "", false
}

// toolCancel takes the last unit of a kind out of its production line; with no unit, the
// last one bought of any kind.
func (rm *Room) toolCancel(side int, a toolArgs) (any, error) {
	unit := ""
	if strings.TrimSpace(a.Unit) != "" {
		id, ok := rm.unitKey(side, a.Unit)
		if !ok {
			return nil, fmt.Errorf("%w: %q", sim.ErrNoUnit, a.Unit)
		}
		unit = id
	}
	before := rm.sim.Gold(side)
	sq, err := rm.sim.Apply(sim.Command{Side: side, Kind: sim.CmdCancel, Unit: unit})
	if err != nil {
		return nil, err
	}
	return map[string]any{"cancelled": rm.squadName(sq), "unit": sq.Unit, "refund": rm.sim.Gold(side) - before, "gold": rm.sim.Gold(side)}, nil
}

// toolRally sets where new units gather: for every structure of the side, or for the one
// named. "home" puts them back beside their structure.
func (rm *Room) toolRally(side int, a toolArgs) (any, error) {
	if strings.TrimSpace(a.Place) == "" {
		return nil, fmt.Errorf("rally needs `place`: a point, a landmark, an offset from a point, or \"home\"")
	}
	hq := rm.r.HQPoint(side)
	cmd := sim.Command{Side: side, Kind: sim.CmdRally}
	low := strings.ToLower(a.Place)
	for _, w := range homeWords {
		if strings.Contains(low, w) {
			cmd.Place = sim.RallyDefault
		}
	}
	if cmd.Place == "" {
		place, err := rm.place(side, a.Place, false, hq.X, hq.Y)
		if err != nil {
			return nil, err
		}
		cmd.Place = place
	}
	if strings.TrimSpace(a.Structure) != "" {
		if _, err := rm.sim.ResolveFor(side, a.Structure); err == nil {
			cmd.Structure = strings.TrimSpace(a.Structure)
		} else if id := rm.structureNamed(side, strings.ToLower(a.Structure), false, hq.X, hq.Y); id != "" {
			cmd.Structure = id
		} else {
			return nil, fmt.Errorf("%w: %q", sim.ErrNoProducer, a.Structure)
		}
	}
	if _, err := rm.sim.Apply(cmd); err != nil {
		return nil, err
	}
	out := map[string]any{"place": cmd.Place}
	if cmd.Structure != "" {
		out["structure"] = cmd.Structure
	}
	return out, nil
}
