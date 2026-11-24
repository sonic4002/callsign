package room

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"callsign/server/radio"
)

// frames reads what a client has been sent and keeps the frames of one type.
func framesOf(t *testing.T, c *Client, kind string) []map[string]any {
	t.Helper()
	var out []map[string]any
	for {
		select {
		case raw := <-c.Out:
			var f map[string]any
			if err := json.Unmarshal(raw, &f); err != nil {
				t.Fatal(err)
			}
			if f["type"] == kind {
				out = append(out, f)
			}
		default:
			return out
		}
	}
}

// enrich lets a quiet match run until side 0 can afford what these tests buy.
func enrich(rm *Room) {
	for i := 0; i < 150*rules.TickRate; i++ {
		rm.sim.Step()
	}
}

func buyErr(rm *Room, anvil *Client, args string) error {
	_, err := rm.Tool(anvil, ToolBuy, json.RawMessage(args))
	return err
}

// The operator spends Hammer's gold only on Hammer's word, until Hammer hands it the fight.
func TestOperatorBuysOnlyOnOrdersUntilHandedTheFight(t *testing.T) {
	rm := newRoom(t, Config{LengthSeconds: 1800})
	hammer := join(t, rm, 0, RoleHammer, 0)
	anvil := join(t, rm, 0, RoleAnvil, 0)
	enrich(rm)
	say := func(text string) {
		t.Helper()
		if _, err := rm.Say(hammer, text); err != nil {
			t.Fatal(err)
		}
	}
	later := func() { rm.sim.Tick += (orderSeconds + 1) * rules.TickRate }

	// Nobody asked: refused, with a reason the operator can act on.
	if err := buyErr(rm, anvil, `{"unit":"tank"}`); !errors.Is(err, ErrNotOrdered) {
		t.Fatalf("an unordered purchase: err = %v", err)
	}
	if err := buyErr(rm, anvil, `{"upgrade":"Viper 1"}`); !errors.Is(err, ErrNotOrdered) {
		t.Fatalf("an unordered upgrade: err = %v", err)
	}
	// An order to a squad is not a word to the operator.
	say("Viper 1, this is Hammer. Hold Golf. Over.")
	if err := buyErr(rm, anvil, `{"unit":"tank"}`); !errors.Is(err, ErrNotOrdered) {
		t.Fatalf("a purchase after an order to a squad: err = %v", err)
	}
	// Hammer asks: the purchase is Hammer's, and nothing is announced.
	say("Anvil, buy a tank")
	before := len(rm.Log(0))
	if err := buyErr(rm, anvil, `{"unit":"tank"}`); err != nil {
		t.Fatal(err)
	}
	if len(rm.Log(0)) != before {
		t.Fatalf("an ordered purchase was announced: %+v", rm.Log(0)[before:])
	}
	// Long after Hammer last spoke to it, the operator is on its own again: refused.
	later()
	if err := buyErr(rm, anvil, `{"unit":"commandos"}`); !errors.Is(err, ErrNotOrdered) {
		t.Fatalf("a purchase long after the order: err = %v", err)
	}

	// Hammer hands over the fight, in the fixed words: the mode changes and the side is told.
	framesOf(t, hammer, "command")
	say("Anvil, this is Hammer. Run the fight. Over.")
	got := framesOf(t, hammer, "command")
	if len(got) != 1 || got[0]["command"].(map[string]any)["mode"] != ModeFight {
		t.Fatalf("after the hand-over the page was told %v", got)
	}
	// The hand-over is not an order to buy: what the operator buys from here on is its own
	// doing, at once and long after alike, and the net says so.
	before = len(rm.Log(0))
	if err := buyErr(rm, anvil, `{"unit":"commandos"}`); err != nil {
		t.Fatalf("the operator runs the fight but could not buy: %v", err)
	}
	// Its own purchase is announced to Hammer by the net.
	log := rm.Log(0)
	if len(log) != before+1 {
		t.Fatalf("the operator's own purchase was not announced")
	}
	m := log[len(log)-1]
	if m.From.Key != radio.Operator || m.To[0].Key != radio.Player || !strings.Contains(m.Text, "Bought Commandos for 100 gold") || !strings.Contains(m.Text, "Viper 3") {
		t.Fatalf("announcement = %q", m.Text)
	}
	later()
	if err := buyErr(rm, anvil, `{"upgrade":"Viper 1"}`); err != nil {
		t.Fatal(err)
	}
	if m := rm.Log(0)[len(rm.Log(0))-1]; !strings.Contains(m.Text, "Upgraded Viper 1 to Sergeant for 300 gold") {
		t.Fatalf("upgrade announcement = %q", m.Text)
	}

	// Hammer takes command back: the operator is on orders again.
	say("סדן, כאן פטיש, הפיקוד אצלי, עבור.")
	if v := rm.cmd[0].view(); v.Mode != ModeOrders {
		t.Fatalf("after taking command back: %+v", v)
	}
	if err := buyErr(rm, anvil, `{"unit":"commandos"}`); !errors.Is(err, ErrNotOrdered) {
		t.Fatalf("a purchase right after command was taken back: err = %v", err)
	}
	// The other side was never touched, and a new match starts on orders.
	if rm.cmd[1].view().Mode != ModeOrders {
		t.Fatal("side 1 changed mode")
	}
	say("סדן, נהל את הקרב")
	if rm.cmd[0].view().Mode != ModeFight {
		t.Fatal("the Hebrew hand-over was not understood")
	}
	if err := rm.Restart(hammer); err != nil {
		t.Fatal(err)
	}
	if rm.cmd[0].view().Mode != ModeOrders {
		t.Fatal("a new match did not start on orders")
	}
}

// For words the fixed phrases do not cover, the operator sets the mode itself, but it can
// take the fight only while Hammer has just spoken to it.
func TestOperatorSetsTheModeWithTheCommandTool(t *testing.T) {
	rm := newRoom(t, Config{LengthSeconds: 1800})
	hammer := join(t, rm, 0, RoleHammer, 0)
	anvil := join(t, rm, 0, RoleAnvil, 0)
	viper := join(t, rm, 0, RoleSquad, 1)
	enrich(rm)
	set := func(args string) (CommandView, error) {
		out, err := rm.Tool(anvil, ToolCommand, json.RawMessage(args))
		v, _ := out.(CommandView)
		return v, err
	}
	if _, err := rm.Tool(viper, ToolCommand, json.RawMessage(`{"mode":"fight"}`)); err == nil {
		t.Fatal("a squad leader set the mode")
	}
	if _, err := set(`{"mode":"fight"}`); !errors.Is(err, ErrNotHanded) {
		t.Fatalf("the operator took the fight unasked: err = %v", err)
	}
	if _, err := rm.Say(hammer, "Anvil, you take it from here, but do not spend anything"); err != nil {
		t.Fatal(err)
	}
	v, err := set(`{"mode":"fight","buy":false}`)
	if err != nil || v.Mode != ModeFight || v.Buy {
		t.Fatalf("hand-over with a limit: %+v %v", v, err)
	}
	if err := buyErr(rm, anvil, `{"unit":"commandos"}`); !errors.Is(err, ErrNoBuying) {
		t.Fatalf("a purchase against Hammer's limit: err = %v", err)
	}
	// Reading it changes nothing; giving it up is always allowed.
	if v, _ := set(`{}`); v.Mode != ModeFight {
		t.Fatalf("reading the mode changed it: %+v", v)
	}
	if v, err := set(`{"mode":"orders"}`); err != nil || v.Mode != ModeOrders {
		t.Fatalf("giving the fight back: %+v %v", v, err)
	}
	// The operator's report says where it stands.
	out, err := rm.Tool(anvil, ToolReport, nil)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(out)
	var status struct {
		Gold    int         `json:"gold"`
		Command CommandView `json:"command"`
		Ordered *bool       `json:"purchaseOrdered"`
	}
	if json.Unmarshal(raw, &status) != nil || status.Gold < 1000 || status.Command.Mode != ModeOrders || status.Ordered == nil || *status.Ordered {
		t.Fatalf("the operator's report: %s", raw[:min(len(raw), 200)])
	}
}
