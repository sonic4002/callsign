package room

import (
	"errors"
	"strconv"
	"strings"

	"callsign/server/radio"
	"callsign/server/sim"
)

// Who has the initiative on a side.
//
// By default the operator acts on Hammer's orders only: it buys nothing and upgrades
// nothing unless Hammer has just asked. Hammer can hand it the fight, and take it back.
// The room holds the mode, so it is a rule of the game and not a habit of a model:
//
//   - Hammer saying one of the fixed phrases of rules.json (radio.command) to the operator
//     switches it by code. The page's switch transmits exactly those.
//   - For any other wording the operator switches it itself with the `command` tool; it
//     may take the fight only while Hammer has just spoken to it, and may always give it up.
//   - The `buy` tool refuses a purchase that is neither ordered nor the operator's to make.
//     "Ordered" is deliberately simple: Hammer spoke to the operator (or to all stations)
//     within the last orderSeconds of the match. What Hammer meant is the operator's to
//     read; the rule only stops it spending long after Hammer last said anything to it.
//     Handing over the fight, or taking it back, is not an order to buy.
//   - A purchase the operator makes on its own is announced to Hammer by the net itself.
const (
	ModeOrders = "orders" // the operator acts on Hammer's orders only
	ModeFight  = "fight"  // Hammer has handed the operator the fight

	ToolCommand  = "command"
	orderSeconds = 90
)

var (
	ErrNotOrdered = errors.New("Hammer has not ordered a purchase and has not let you buy on your own. Tell Hammer in one short line what you suggest, and wait")
	ErrNoBuying   = errors.New("Hammer handed you the fight but told you not to buy: ask Hammer before spending")
	ErrNotHanded  = errors.New("only Hammer can hand you the fight or let you buy on your own, and Hammer has not just spoken to you")
)

type command struct {
	fight bool // the operator has the initiative: it tasks squads on its own
	buy   bool // the operator may buy and upgrade on its own, with or without the fight
	asked int  // tick of Hammer's last word to the operator, -1 for never
}

// CommandView is the mode as the side's clients and the operator see it.
type CommandView struct {
	Mode string `json:"mode"` // ModeOrders or ModeFight
	Buy  bool   `json:"buy"`  // the operator may buy and upgrade on its own
}

func (c command) view() CommandView {
	if c.fight {
		return CommandView{Mode: ModeFight, Buy: c.buy}
	}
	return CommandView{Mode: ModeOrders, Buy: c.buy}
}

// ordered reports whether Hammer spoke to the side's operator recently enough for a
// purchase now to count as Hammer's.
func (rm *Room) ordered(side int) bool {
	asked := rm.cmd[side].asked
	return asked >= 0 && rm.sim.Tick-asked <= orderSeconds*rm.r.TickRate
}

// heardHammer notes a transmission of Hammer's that reached the operator, and switches
// the mode when it carries one of the fixed phrases.
func (rm *Room) heardHammer(side int, p radio.Parsed) {
	toOperator := false
	for _, st := range p.To {
		toOperator = toOperator || st.Kind == radio.Operator || st.Kind == radio.All
	}
	if !toOperator {
		return
	}
	rm.cmd[side].asked = rm.sim.Tick
	body := strings.ToLower(p.Body)
	says := func(kind string) bool {
		w := rm.r.Radio.Command[kind]
		for _, phrase := range append(append([]string{}, w.En...), w.He...) {
			if strings.Contains(body, strings.ToLower(phrase)) {
				return true
			}
		}
		return false
	}
	c := rm.cmd[side]
	fight, buy := c.fight, c.buy
	switch {
	case says("take"):
		fight, buy = false, false
	case says("give"):
		// Handing over the fight brings the purse with it, unless Hammer keeps it back.
		fight, buy = true, c.buy || !c.fight
	}
	// "You may buy" and "do not buy" stand on their own, with or without the fight.
	if says("grant") && !says("take") {
		buy = true
	}
	if says("revoke") {
		buy = false
	}
	if fight != c.fight || buy != c.buy {
		rm.setCommand(side, fight, buy)
		rm.cmd[side].asked = -1 // those words set who decides; they were not an order to buy
	}
}

// setCommand changes a side's mode and tells the side when it changed.
func (rm *Room) setCommand(side int, fight, buy bool) {
	c := &rm.cmd[side]
	if c.fight == fight && c.buy == buy {
		return
	}
	c.fight, c.buy = fight, buy
	rm.broadcast(side, map[string]any{"type": "command", "command": c.view()})
}

func (rm *Room) toolCommand(side int, a toolArgs) (any, error) {
	c := rm.cmd[side]
	fight, buy := c.fight, c.buy
	switch a.Mode {
	case "":
	case ModeOrders:
		fight, buy = false, false
	case ModeFight:
		if !c.fight {
			buy = true
		}
		fight = true
	default:
		return nil, errors.New(`mode is "orders" or "fight"`)
	}
	if a.MayBuy != nil {
		buy = *a.MayBuy
	}
	// Only Hammer gives the operator more room: taking the fight or the purse needs a
	// word from Hammer just now. Giving either back is always allowed.
	if ((fight && !c.fight) || (buy && !c.buy)) && !rm.ordered(side) {
		return nil, ErrNotHanded
	}
	if fight != c.fight || buy != c.buy {
		rm.setCommand(side, fight, buy)
		rm.cmd[side].asked = -1 // what Hammer said set who decides, it was not an order to buy
	}
	return rm.cmd[side].view(), nil
}

func (rm *Room) mayBuy(side int) (own bool, err error) {
	c := rm.cmd[side]
	switch {
	case rm.ordered(side):
		return false, nil
	case c.buy:
		return true, nil
	case c.fight:
		return false, ErrNoBuying
	}
	return false, ErrNotOrdered
}

func (rm *Room) announce(side int, kind string, sq *sim.Squad, cost int) {
	from, to := radio.Station{Kind: radio.Operator}, radio.Station{Kind: radio.Player}
	lang := rm.lang[side][to.Key()]
	if lang != "he" {
		lang = "en"
	}
	name := rm.squadName(sq)
	callsign := name.En
	if lang == "he" {
		callsign = name.He
	}
	unit := rm.r.Factions[rm.sim.Sides[side].Faction].Units[sq.Unit].Name.In(lang)
	tier := ""
	for _, t := range rm.r.Tiers {
		if t.Tier == sq.Tier {
			tier = t.Name.In(lang)
		}
	}
	body := strings.NewReplacer("{unit}", unit, "{squad}", callsign, "{cost}", strconv.Itoa(cost), "{tier}", tier).
		Replace(rm.r.Radio.OwnPurchase[kind].In(lang))
	text, err := rm.net.Compose(lang, from, []radio.Station{to}, body, radio.Out)
	if err != nil {
		return
	}
	p, err := rm.net.Parse(text)
	if err != nil {
		return
	}
	p.To = []radio.Station{to}
	rm.transmit(side, from, p, text) //nolint:errcheck // the purchase stands either way
}
