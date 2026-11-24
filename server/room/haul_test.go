package room

import (
	"encoding/json"
	"errors"
	"testing"

	"callsign/server/sim"
)

// The operator directs the haulers by the name of the point a field lies at, in either
// language, and buys more of them; a squad leader can do neither but is told where the
// haulers work, so that it can be sent to guard them.
func TestHaulTool(t *testing.T) {
	rm := newRoom(t, Config{AutoStart: true, Purse: true})
	anvil := join(t, rm, 0, RoleAnvil, 0)
	viper := join(t, rm, 0, RoleSquad, 1)
	working := func() string {
		field := ""
		rm.View(func(s *sim.Sim) {
			for _, h := range s.Snapshot(0).Haulers {
				if h.Side == 0 {
					field = h.Assigned
				}
			}
		})
		return field
	}
	for args, want := range map[string]string{
		`{"field":"Foxtrot"}`:         "F",
		`{"field":"K"}`:               "K",
		`{"field":"שדה כרמל"}`:        "K",
		`{"field":"the Bravo field"}`: "B",
		`{"field":"auto"}`:            "",
	} {
		tool(t, rm, anvil, ToolHaul, args)
		if got := working(); got != want {
			t.Errorf("haul %s: haulers sent to %q, want %q", args, got, want)
		}
	}
	for args, want := range map[string]error{
		`{"field":"Golf"}`:         sim.ErrNoField, // a point with no gold field
		`{"field":"nowhere"}`:      sim.ErrNoField,
		`{"field":"K","hauler":7}`: sim.ErrNoHauler,
	} {
		if _, err := rm.Tool(anvil, ToolHaul, json.RawMessage(args)); !errors.Is(err, want) {
			t.Errorf("haul %s: err = %v, want %v", args, err, want)
		}
	}
	if _, err := rm.Tool(viper, ToolHaul, json.RawMessage(`{"field":"K"}`)); err == nil {
		t.Error("a squad leader directed the haulers")
	}

	// Buying a hauler: it is named for the player, costs gold, and is no station on the net.
	hauler, _ := rules.HaulerOf("aegis")
	res, err := rm.Tool(anvil, ToolBuy, json.RawMessage(`{"unit":"`+hauler+`"}`))
	if err != nil {
		t.Fatalf("buying a hauler: %v", err)
	}
	if name := res.(map[string]any)["squad"].(Name); name.En != "Hauler 2" || name.He != "מוביל 2" {
		t.Errorf("the bought hauler is called %+v", name)
	}
	if _, err := rm.Say(join(t, rm, 0, RoleHammer, 0), "Hauler 1, this is Hammer. Hold Golf. Over."); err == nil {
		// With no callsign it is a plain message to the operator, which is fine; it must
		// never be routed to the hauler as a station.
		for _, m := range rm.Log(0) {
			for _, to := range m.To {
				if to.Squad > sim.HaulerIDBase {
					t.Errorf("a radio call was addressed to a hauler: %+v", m)
				}
			}
		}
	}

	// A leader's report lists its own side's haulers and nothing of the enemy's.
	rep, err := rm.Tool(viper, ToolReport, nil)
	if err != nil {
		t.Fatal(err)
	}
	hs := rep.(map[string]any)["haulers"].([]sim.HaulerView)
	if len(hs) != 1 || hs[0].Side != 0 {
		t.Errorf("the leader's report lists haulers %+v, want the one on the field", hs)
	}
}
