package room

import (
	"encoding/json"
	"errors"
	"fmt"
)

// The commander's own hand. Building a structure, buying a unit, cancelling one, selling
// or repairing a structure and setting a rally point from the page's panel go straight to
// the room: no radio call, no agent in between, done in the same tick or refused with the
// reason. The checks are the game's own, the ones the operator's tools meet (gold, the
// build tree, placement, power, caps, the line). Orders to squads never come this way:
// those are radio calls.
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
	ActRally  = "rally"
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
	default:
		return nil, fmt.Errorf("unknown action %q", act)
	}
	if err != nil {
		return nil, err
	}
	// The side's agents learn of it without being called: a line for the operator's
	// picture of the net, not a transmission.
	rm.broadcast(side, map[string]any{"type": "direct", "act": act, "tick": rm.sim.Tick, "result": res})
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
	return nil
}
