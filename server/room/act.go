package room

import (
	"encoding/json"
	"errors"
	"fmt"

	"callsign/server/radio"
	"callsign/server/sim"
)

// The commander's own hand. Building a structure, buying a unit, cancelling one, selling
// or repairing a structure and setting a rally point from the page's panel go straight to
// the room: no radio call, no agent in between, done in the same tick or refused with the
// reason. The checks are the game's own, the ones the operator's tools meet (gold, the
// build tree, placement, power, caps, the line).
//
// A squad can be sent somewhere by hand too (owner, 2026-11-26): the commander selects it
// and taps the map, and the order (move, hold or attack) is the squad's in the same tick.
// The squad answers "Wilco, out" on the net by code, with no thought of its leader's, and
// counts as ordered by Hammer by name. Everything else a squad can be told is a radio call.
//
// Only a commander's seat may act, and only for its own side. The side's agents are told
// what was done in a frame of its own ("direct"), which wakes nobody; the operator's base
// cues announce the structure or the squad when it is ready, as for any other.
const (
	ActBuild  = "build"
	ActBuy    = "buy"
	ActCancel = "cancel"
	ActSell   = "sell"
	ActRepair = "repair"
	ActRally       = "rally"
	ActOrder       = "order"
	ActSuperSelect = "super_select"
	ActSuperFire   = "super_fire"
)

// ErrNotCommander refuses a direct action from anyone but a side's commander.
var ErrNotCommander = errors.New("only a side's commander builds and buys from the panel")

// Act carries out one direct action for the commander's side.
func (rm *Room) Act(c *Client, act string, raw json.RawMessage) (any, error) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if c.ID.Role != RoleHammer || c.ID.Side < 0 || c.ID.Side > 1 {
		return nil, ErrNotCommander
	}
	if rm.sim.Over {
		return nil, errors.New("the match is over")
	}
	var a toolArgs
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &a); err != nil {
			return nil, fmt.Errorf("bad arguments: %w", err)
		}
	}
	side := c.ID.Side
	rm.direct = true
	defer func() { rm.direct = false }()
	var res any
	var err error
	switch act {
	case ActBuild:
		res, err = rm.toolBuild(side, a)
	case ActBuy:
		if a.Upgrade != "" {
			return nil, errors.New("an upgrade is asked of the operator on the radio")
		}
		res, err = rm.toolBuy(side, a)
	case ActCancel:
		res, err = rm.toolCancel(side, a)
	case ActSell:
		res, err = rm.toolSell(side, a)
	case ActRepair:
		res, err = rm.toolMend(side, a)
	case ActRally:
		res, err = rm.toolRally(side, a)
	case ActOrder:
		res, err = rm.directOrder(side, a)
	case ActSuperSelect:
		chosen, serr := rm.sim.SelectSuperPowers(side, a.Powers)
		res, err = map[string]any{"chosen": chosen}, serr
	case ActSuperFire:
		st, ferr := rm.sim.FireSuperPower(side, a.Power, a.X, a.Y, a.X2, a.Y2, a.Targets)
		if ferr == nil {
			res = map[string]any{"id": st.ID, "power": st.Power, "x": st.X, "y": st.Y, "impactTick": st.ImpactTick}
		} else {
			err = ferr
		}
	default:
		return nil, fmt.Errorf("unknown action %q", act)
	}
	if err != nil {
		return nil, err
	}
	// The side's agents learn of it without being called: a line for the operator's
	// picture of the net, not a transmission.
	// It carries the commander's language: a squad sent by hand reports in it afterwards.
	rm.broadcast(side, map[string]any{"type": "direct", "act": act, "tick": rm.sim.Tick, "result": res, "lang": rm.lang[side][radio.Station{Kind: radio.Player}.Key()]})
	return res, nil
}

// SetLang records the language a commander's page is in, until the commander speaks on
// the net (which sets it too). The operator's base cues are written in it: a commander
// who builds from the panel before saying a word still hears of it in their own language.
func (rm *Room) SetLang(c *Client, lang string) error {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if c.ID.Role != RoleHammer || c.ID.Side < 0 || c.ID.Side > 1 {
		return ErrNotCommander
	}
	if lang != "he" && lang != "en" {
		return fmt.Errorf("unknown language %q", lang)
	}
	rm.lang[c.ID.Side]["player"] = lang
	// The side's agents write in it from their first line, before the commander has spoken.
	rm.broadcast(c.ID.Side, map[string]any{"type": "netlang", "lang": lang})
	return nil
}

// directOrder gives one of the commander's squads an order from the page, and has the
// squad acknowledge it on the net.
func (rm *Room) directOrder(side int, a toolArgs) (any, error) {
	sq := rm.sim.Squad(a.Squad)
	if sq == nil || !sq.Alive || sq.Side != side {
		return nil, sim.ErrNoSquad
	}
	if a.Order != ToolMove && a.Order != ToolHold && a.Order != ToolAttack {
		return nil, fmt.Errorf("a squad is sent by hand to move, hold or attack; %q is asked on the radio", a.Order)
	}
	res, err := rm.orderSquad(side, sq.ID, a.Order, a)
	if err != nil {
		return nil, err
	}
	// Hammer's own squad from now on: the operator plans around it, and it reports to Hammer.
	rm.traffic[side].hammers[sq.ID] = true
	lang := rm.lang[side][radio.Station{Kind: radio.Player}.Key()]
	if lang != "he" {
		lang = "en"
	}
	from := radio.Station{Kind: radio.Squad, Class: sq.CallClass(), Num: sq.Num}
	to := radio.Station{Kind: radio.Player}
	body := "Wilco"
	if lang == "he" {
		body = "יבוצע"
	}
	if text, err := rm.net.Compose(lang, from, []radio.Station{to}, body, radio.Out); err == nil {
		if p, err := rm.net.Parse(text); err == nil {
			p.To = []radio.Station{to}
			rm.transmit(side, from, p, text, KindAck) //nolint:errcheck // the order stands either way
		}
	}
	name := rm.squadName(sq)
	return map[string]any{"squad": name, "id": sq.ID, "order": res}, nil
}
