package room

import (
	"encoding/json"
	"errors"
	"fmt"

	"callsign/server/radio"
	"callsign/server/sim"
)

// The game tools. Agents can do nothing to the match except call these.
const (
	ToolRadio  = "radio"
	ToolMove   = "move"
	ToolHold   = "hold"
	ToolAttack = "attack"
	ToolReport = "report"
	ToolBuy    = "buy"
	ToolHaul   = "haul"
)

// allowed lists the tools each role may call. Hammer and spectators have none.
var allowed = map[string][]string{
	RoleSquad: {ToolRadio, ToolReport, ToolMove, ToolHold, ToolAttack},
	RoleAnvil: {ToolRadio, ToolReport, ToolBuy, ToolHaul},
}

// names accepts "Hammer" as well as ["Viper 1", "Viper 2"].
type names []string

func (n *names) UnmarshalJSON(b []byte) error {
	var one string
	if json.Unmarshal(b, &one) == nil {
		*n = names{one}
		return nil
	}
	return json.Unmarshal(b, (*[]string)(n))
}

type toolArgs struct {
	Point   string `json:"point"`
	Contact int    `json:"contact"`
	Unit    string `json:"unit"`
	Upgrade string `json:"upgrade"`
	To      names  `json:"to"`
	Body    string `json:"body"`
	End     string `json:"end"`
	Lang    string `json:"lang"`
	Field   string `json:"field"`  // haul: a gold field by its point ("Kilo", "K", "the airfield"), or "auto"
	Hauler  int    `json:"hauler"` // haul: one hauler's id, or 0 for all of them
}

// Tool runs one game tool for a client and returns its result.
func (rm *Room) Tool(c *Client, name string, raw json.RawMessage) (any, error) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	ok := false
	for _, t := range allowed[c.ID.Role] {
		ok = ok || t == name
	}
	if !ok {
		return nil, fmt.Errorf("%s may not use the tool %q", c.ID.Role, name)
	}
	var a toolArgs
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &a); err != nil {
			return nil, fmt.Errorf("bad arguments: %w", err)
		}
	}
	side := c.ID.Side
	switch name {
	case ToolRadio:
		return rm.toolRadio(c, a)
	case ToolReport:
		return rm.toolReport(c)
	case ToolBuy:
		return rm.toolBuy(side, a)
	case ToolHaul:
		return rm.toolHaul(side, a)
	}

	// move, hold, attack: always the caller's own squad.
	cmd := sim.Command{Side: side, Kind: name, Squad: c.ID.Squad, Contact: a.Contact}
	if a.Point != "" {
		id, ok := rm.net.ResolvePoint(a.Point)
		if !ok {
			return nil, fmt.Errorf("%w: %q", sim.ErrNoPoint, a.Point)
		}
		cmd.Point = id
	}
	sq, err := rm.sim.Apply(cmd)
	if err != nil {
		return nil, err
	}
	return map[string]any{"order": sq.Order.Kind, "point": sq.Order.Point, "contact": sq.Order.Contact}, nil
}

func (rm *Room) toolRadio(c *Client, a toolArgs) (any, error) {
	side := c.ID.Side
	from, ok := rm.station(c.ID)
	if !ok {
		return nil, sim.ErrNoSquad
	}
	if len(a.To) == 0 {
		return nil, errors.New("radio needs a `to` callsign")
	}
	var to []radio.Station
	for _, n := range a.To {
		st, ok := rm.net.Resolve(n)
		if !ok {
			return nil, fmt.Errorf("unknown callsign %q", n)
		}
		to = append(to, st)
	}
	// The whole net speaks the language its commander last used; before Hammer has
	// spoken, the language the station was last spoken to in.
	lang := a.Lang
	if lang != "en" && lang != "he" {
		lang = rm.lang[side][radio.Station{Kind: radio.Player}.Key()]
	}
	if lang == "" {
		lang = rm.lang[side][from.Key()]
	}
	if lang == "" {
		lang = rm.lang[side][radio.All]
	}
	if lang == "" {
		lang = "en"
	}
	text, err := rm.net.Compose(lang, from, to, a.Body, a.End)
	if err != nil {
		return nil, err
	}
	p, err := rm.net.Parse(text)
	if err != nil {
		return nil, err
	}
	p.To = to
	m, err := rm.transmit(side, from, p, text)
	if err != nil {
		return nil, err
	}
	return map[string]any{"sent": m.Text}, nil
}

func (rm *Room) toolReport(c *Client) (any, error) {
	snap := rm.sim.Snapshot(c.ID.Side)
	if c.ID.Role == RoleAnvil {
		return snap, nil
	}
	type friend struct {
		Callsign string        `json:"callsign"`
		Near     string        `json:"near"`
		Order    sim.OrderView `json:"order"`
		Alive    int           `json:"alive"`
	}
	out := map[string]any{"timeLeft": snap.TimeLeft, "points": snap.Points, "contacts": snap.Contacts}
	// A leader told to escort the haulers needs to know where they work.
	haulers := []sim.HaulerView{}
	for _, h := range snap.Haulers {
		if h.Side == c.ID.Side {
			haulers = append(haulers, h)
		}
	}
	out["haulers"] = haulers
	friends := []friend{}
	for _, sq := range snap.Squads {
		if sq.ID == c.ID.Squad {
			out["you"] = sq
			continue
		}
		friends = append(friends, friend{sq.Callsign.En, sq.Near, sq.Order, sq.Alive})
	}
	if out["you"] == nil {
		return nil, sim.ErrNoSquad
	}
	out["friends"] = friends
	return out, nil
}

func (rm *Room) toolBuy(side int, a toolArgs) (any, error) {
	cmd := sim.Command{Side: side, Kind: sim.CmdBuy, Unit: a.Unit}
	if a.Upgrade != "" {
		st, ok := rm.net.Resolve(a.Upgrade)
		sq := rm.squadOf(side, st)
		if !ok || sq == nil {
			return nil, fmt.Errorf("%w: %q", sim.ErrNoSquad, a.Upgrade)
		}
		cmd = sim.Command{Side: side, Kind: sim.CmdUpgrade, Squad: sq.ID}
	} else if a.Unit == "" {
		return nil, errors.New("buy needs `unit` (a new squad) or `upgrade` (a squad's callsign)")
	}
	sq, err := rm.sim.Apply(cmd)
	if err != nil {
		return nil, err
	}
	out := map[string]any{"squad": rm.squadName(sq), "unit": sq.Unit, "tier": sq.Tier, "gold": rm.sim.Gold(side)}
	if sq.Deploying() {
		// The squad is on its way: it joins the net and takes orders when it reaches the field.
		out["deploySeconds"] = float64(sq.DeployTicks) / float64(rm.r.TickRate)
	}
	return out, nil
}

// toolHaul sends the side's haulers to a gold field, named by the map point it lies at,
// or back to choosing for themselves with "auto".
func (rm *Room) toolHaul(side int, a toolArgs) (any, error) {
	field := a.Field
	if field == "" {
		return nil, errors.New("haul needs `field`: a gold field by its point, or \"auto\"")
	}
	if field != sim.HaulAuto {
		id, ok := rm.net.ResolvePoint(field)
		if !ok {
			// "the Kilo field", "שדה כרמל": the point named anywhere in the words.
			if pts := rm.net.FindPoints(field); len(pts) > 0 {
				id, ok = pts[0], true
			}
		}
		field = ""
		for _, g := range rm.r.Gushers {
			if ok && g.Point == id {
				field = g.ID
			}
		}
		if field == "" {
			return nil, fmt.Errorf("%w: %q", sim.ErrNoField, a.Field)
		}
	}
	if _, err := rm.sim.Apply(sim.Command{Side: side, Kind: sim.CmdHaul, Field: field, Hauler: a.Hauler}); err != nil {
		return nil, err
	}
	told := 0
	for _, h := range rm.sim.Snapshot(side).Haulers {
		if h.Side == side && (a.Hauler == 0 || h.ID == a.Hauler) {
			told++
		}
	}
	return map[string]any{"field": field, "haulers": told}, nil
}
