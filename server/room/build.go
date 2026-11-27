package room

import (
	"errors"
	"fmt"
	"math"
	"strings"

	"callsign/server/sim"
	"callsign/shared"
)

// The tools for bases: the operator builds, engineer squads capture and repair, and any
// squad can be sent at a structure.
const (
	ToolBuild   = "build"
	ToolCapture = "capture"
)

// mayActAlone is the one check for "may the operator spend without being told to?".
// Building follows the purse exactly as buying does (command.go): an order from Hammer
// just now, or a standing permission. `own` reports that nobody asked for this one, so
// the net must tell Hammer about it.
func (rm *Room) mayActAlone(side int, what string) (own bool, err error) {
	_ = what
	return rm.mayBuy(side)
}

// sideWords are the ways to name a side of one's own base, in both languages.
var sideWords = []struct {
	side  string
	words []string
}{
	{"north", []string{"north", "צפון", "צפוני"}},
	{"south", []string{"south", "דרום", "דרומי"}},
	{"east", []string{"east", "מזרח", "מזרחי"}},
	{"west", []string{"west", "מערב", "מערבי"}},
	{"front", []string{"front", "forward", "חזית", "קדמי", "קדימה"}},
	{"rear", []string{"rear", "back", "behind", "עורף", "אחורי", "מאחור"}},
}

// place turns what an agent wrote for a place into the written form the simulation's one
// resolver reads: a point id, a landmark or bridge id, a structure id, "<bearing> of
// <point> [<metres>]", or "base:<side>". Exact ids come first, then a structure named in
// words, then the map's own names, then a side of one's own base. When the words fit
// several landmarks the error is ErrWhichPlace and names them.
func (rm *Room) place(side int, text string, enemy bool, nearX, nearY float64) (string, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return "", nil
	}
	if pl, err := rm.sim.ResolveFor(side, text); err == nil {
		return pl.ID, nil
	}
	low := strings.ToLower(text)
	if id := rm.structureNamed(side, low, enemy, nearX, nearY); id != "" {
		return id, nil
	}
	if id := rm.builtPlace(side, low, nearX, nearY); id != "" {
		return id, nil
	}
	place, choices, ok := rm.net.ResolvePlace(text)
	switch {
	case ok:
		return place, nil
	case len(choices) > 1:
		// The words fit more than one landmark: say which, so the squad can ask.
		names := make([]string, len(choices))
		for i, id := range choices {
			names[i] = rm.net.PlaceName(id, "en") + " (" + id + ")"
		}
		return "", fmt.Errorf("%w: %q could be %s", ErrWhichPlace, text, strings.Join(names, " or "))
	}
	for _, w := range sideWords {
		for _, word := range w.words {
			if strings.Contains(low, word) {
				return "base:" + w.side, nil
			}
		}
	}
	return "", fmt.Errorf("%w: %q", sim.ErrBadPlace, text)
}

// structureNamed finds the structure a text names by its name, kind or role: an enemy
// one the side has seen when `enemy` is set or the text says so, otherwise one of its
// own. Of several, the nearest to (x, y); the lowest id breaks a tie.
func (rm *Room) structureNamed(side int, low string, enemy bool, x, y float64) string {
	if strings.Contains(low, "enemy") || strings.Contains(low, "אויב") {
		enemy = true
	}
	best, bd := "", math.MaxFloat64
	for _, st := range rm.sim.Snapshot(side).Structures {
		// A tech building called by its own name on the map ("the clinic east of Delta")
		// is that one, whoever holds it.
		if !st.Ruin && st.Site != "" {
			for _, site := range rm.r.Map.TechBuildings {
				if site.ID == st.Site && (strings.Contains(low, strings.ToLower(site.Name.En)) || strings.Contains(low, site.Name.He)) {
					return st.ID
				}
			}
		}
		if st.Ruin || (st.Side != side) != enemy {
			continue
		}
		def, _ := rm.r.StructureDef(st.Faction, st.Kind)
		named := false
		for _, name := range append([]string{def.Name.En, def.Name.He, st.Kind, st.Role, roleWord(st.Role), st.Site}, def.Aliases...) {
			named = named || (name != "" && strings.Contains(low, strings.ToLower(name)))
		}
		if !named {
			continue
		}
		if d := math.Hypot(st.X-x, st.Y-y); d < bd {
			best, bd = st.ID, d
		}
	}
	return best
}

// roleWord is the plain English word for a role where it differs from the role's key.
func roleWord(role string) string {
	switch role {
	case shared.RoleWorks:
		return "factory"
	case shared.RoleAirbase:
		return "airfield"
	}
	return ""
}

// structureKey finds which of a faction's structures a text names: by id, role, or name
// in either language.
func (rm *Room) structureKey(side int, text string) (string, bool) {
	f := rm.r.Factions[rm.sim.Sides[side].Faction]
	low := strings.ToLower(strings.TrimSpace(text))
	if low == "" {
		return "", false
	}
	for _, id := range f.StructureIDs() {
		st := f.Structures[id]
		if low == strings.ToLower(id) || low == strings.ToLower(st.Name.En) || low == st.Name.He {
			return id, true
		}
	}
	if id, st := f.StructureOfRole(low); st != nil {
		return id, true
	}
	for _, id := range f.StructureIDs() {
		st := f.Structures[id]
		if strings.Contains(low, strings.ToLower(st.Name.En)) || strings.Contains(low, st.Name.He) {
			return id, true
		}
	}
	return "", false
}

func (rm *Room) toolBuild(side int, a toolArgs) (any, error) {
	if a.Structure == "" {
		return nil, errors.New("build needs `structure`: one of your faction's structures")
	}
	key, ok := rm.structureKey(side, a.Structure)
	if !ok {
		return nil, fmt.Errorf("%w: %q", sim.ErrNoStructure, a.Structure)
	}
	own, err := rm.mayActAlone(side, ToolBuild)
	if err != nil {
		return nil, err
	}
	before := rm.sim.Gold(side)
	hq := rm.r.HQPoint(side)
	cmd := sim.Command{Side: side, Kind: sim.CmdBuild, Structure: key}
	if cmd.Place, err = rm.place(side, a.Place, false, hq.X, hq.Y); err != nil {
		return nil, err
	}
	if cmd.Place2, err = rm.place(side, a.Place2, false, hq.X, hq.Y); err != nil {
		return nil, err
	}
	if cmd.Run, err = fenceRun(a.Run); err != nil {
		return nil, err
	}
	if len(a.Powers) > 0 {
		if def, ok := rm.r.StructureDef(rm.sim.Sides[side].Faction, key); ok && def.Role == shared.RoleSuperweapon {
			if _, err := rm.sim.ValidateSuperPowers(side, a.Powers); err != nil {
				return nil, err
			}
		}
	}
	st, err := rm.sim.Build(cmd)
	if err != nil {
		return nil, err
	}
	if len(a.Powers) > 0 && st.Def().Role == shared.RoleSuperweapon {
		if _, err := rm.sim.SelectSuperPowers(side, a.Powers); err != nil {
			return nil, err
		}
	}
	def := st.Def()
	if own {
		rm.announceBuilt(side, def.Name, before-rm.sim.Gold(side))
	}
	return map[string]any{
		"announced": own,
		"structure": st.PlaceID(), "kind": st.Kind, "name": def.Name.En, "near": rm.near(st.X, st.Y),
		"buildSeconds": float64(st.BuildTicks) / float64(rm.r.TickRate), "gold": rm.sim.Gold(side),
	}, nil
}

// near names the map point closest to a position.
func (rm *Room) near(x, y float64) string {
	best, bd := "", math.MaxFloat64
	for _, p := range rm.r.Map.Points {
		if d := math.Hypot(p.X-x, p.Y-y); d < bd {
			best, bd = p.ID, d
		}
	}
	return best
}

// toolEngineer is capture and repair: an engineer squad's own orders.
func (rm *Room) toolEngineer(c *Client, name string, a toolArgs) (any, error) {
	side := c.ID.Side
	sq := rm.sim.Squad(c.ID.Squad)
	if sq == nil || sq.Side != side {
		return nil, sim.ErrNoSquad
	}
	text := a.Place
	if text == "" {
		text = a.Point
	}
	if text == "" {
		return nil, fmt.Errorf("%s needs `place`: a structure id from your status", name)
	}
	x, y := sq.Center()
	place, err := rm.place(side, text, name == ToolCapture, x, y)
	if err != nil {
		return nil, err
	}
	sq, err = rm.sim.Apply(sim.Command{Side: side, Kind: name, Squad: sq.ID, Place: place})
	if err != nil {
		return nil, err
	}
	return map[string]any{"order": sq.Order.Kind, "place": sq.Order.Place}, nil
}

// StructureBrief is a structure as a squad leader's report lists it.
type StructureBrief struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Role     string  `json:"role"`
	Yours    bool    `json:"yours"`
	Near     string  `json:"near"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	HP       float64 `json:"hp"`
	Building bool    `json:"building,omitempty"`
	// A tech building: whose it is ("yours", "enemy" or "nobody") and what holding it gives.
	Holder string `json:"holder,omitempty"`
	Gives  string `json:"gives,omitempty"`
	// What this one is called on the map, in both languages ("the clinic east of Delta").
	Site   string `json:"site,omitempty"`
	SiteHe string `json:"siteHe,omitempty"`
}

// structureBriefs lists the structures a side knows of, for a leader's report: its own
// base structures and defences, and every enemy structure it has seen. Fences are left
// out; they are many and a squad meets them on the ground.
func (rm *Room) structureBriefs(snap sim.Snapshot) []StructureBrief {
	out := []StructureBrief{}
	for _, st := range snap.Structures {
		if st.Ruin || st.Role == shared.RoleFence {
			continue
		}
		def, _ := rm.r.StructureDef(st.Faction, st.Kind)
		b := StructureBrief{
			ID: st.ID, Name: def.Name.En, Role: st.Role, Yours: st.Side == snap.Side, Near: rm.near(st.X, st.Y),
			X: st.X, Y: st.Y, HP: math.Round(st.HP*100) / 100, Building: st.Building < 1,
		}
		if st.Role == shared.RoleTech {
			b.Gives = def.About.En
			for _, site := range rm.r.Map.TechBuildings {
				if site.ID == st.Site {
					b.Site, b.SiteHe = site.Name.En, site.Name.He
				}
			}
			switch st.Side {
			case snap.Side:
				b.Holder = "yours"
			case sim.NoSide:
				b.Holder = "nobody"
			default:
				b.Holder = "enemy"
			}
		}
		out = append(out, b)
	}
	return out
}

// fenceRun reads the way a fence is to lie from what the operator wrote: the short form
// ("ns"), compass words in either order ("north-south", "south to north", "NE-SW"), or
// the same in Hebrew. Empty stays empty: the run then faces the enemy.
func fenceRun(text string) (string, error) {
	low := strings.ToLower(strings.TrimSpace(text))
	if low == "" {
		return "", nil
	}
	if _, ok := sim.FenceRuns[low]; ok {
		return low, nil
	}
	has := func(words ...string) bool {
		for _, w := range words {
			if strings.Contains(low, w) {
				return true
			}
		}
		return false
	}
	n, so := has("north", "צפון"), has("south", "דרום")
	e, w := has("east", "מזרח"), has("west", "מערב")
	switch low {
	case "n-s", "s-n":
		n, so = true, true
	case "e-w", "w-e":
		e, w = true, true
	case "ne-sw", "sw-ne":
		return "nesw", nil
	case "nw-se", "se-nw":
		return "nwse", nil
	}
	switch {
	case n && so && e && w:
		// A diagonal: which end is north decides it ("north-east to south-west").
		ne := strings.Contains(low, "north-east") || strings.Contains(low, "northeast") || strings.Contains(low, "צפון-מזרח") || strings.Contains(low, "צפון־מזרח") || strings.Contains(low, "צפון מזרח")
		if ne {
			return "nesw", nil
		}
		return "nwse", nil
	case n && so:
		return "ns", nil
	case e && w:
		return "ew", nil
	}
	return "", fmt.Errorf("%w: a fence runs north-south, east-west, northeast-southwest or northwest-southeast, not %q", sim.ErrBadPlace, text)
}
