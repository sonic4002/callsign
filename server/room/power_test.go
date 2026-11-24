package room

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"callsign/server/sim"
	"callsign/shared"
)

func TestTheOperatorSellsAndRepairsAndIsToldOfPower(t *testing.T) {
	rm := newRoom(t, Config{AutoStart: true, Purse: true, StartGold: 2000})
	anvil := join(t, rm, 0, RoleAnvil, 0)
	viper1 := join(t, rm, 0, RoleSquad, 1)
	ticks(rm, 0.2)

	// The operator's status carries power and the radar.
	status := func() map[string]any {
		res, err := rm.Tool(anvil, ToolReport, nil)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := json.Marshal(res)
		var m map[string]any
		if err := json.Unmarshal(raw, &m); err != nil {
			t.Fatal(err)
		}
		return m
	}
	st := status()
	power, _ := st["power"].(map[string]any)
	if power == nil || power["low"] != false || power["supply"].(float64) <= power["use"].(float64) || st["radar"] != true {
		t.Fatalf("a full base has power and its radar: power=%v radar=%v", st["power"], st["radar"])
	}

	// Squads neither sell nor pay for repairs.
	if _, err := rm.Tool(viper1, ToolSell, json.RawMessage(`{"place":"radar"}`)); err == nil || !strings.Contains(err.Error(), "may not use") {
		t.Fatalf("a squad selling: err = %v", err)
	}
	// Nothing is damaged; the headquarters is not for sale; nor is what is not there.
	if _, err := rm.Tool(anvil, ToolRepair, json.RawMessage(`{"place":"the radar station"}`)); !errors.Is(err, sim.ErrNotDamaged) {
		t.Fatalf("repairing a whole structure: err = %v", err)
	}
	for _, args := range []string{`{"place":"A"}`, `{"place":"Alpha"}`} {
		if _, err := rm.Tool(anvil, ToolSell, json.RawMessage(args)); !errors.Is(err, sim.ErrNotYours) {
			t.Fatalf("selling the headquarters with %s: err = %v", args, err)
		}
	}
	if _, err := rm.Tool(anvil, ToolSell, json.RawMessage(`{}`)); err == nil {
		t.Fatal("sell with no place should say what it needs")
	}

	// Repair by name, in Hebrew.
	rm.View(func(s *sim.Sim) {
		for _, st := range s.Structures {
			if st.Side == 0 && st.Def().Role == shared.RoleWorks {
				st.HP = st.Def().HP / 2
			}
		}
	})
	res, err := rm.Tool(anvil, ToolRepair, json.RawMessage(`{"place":"מפעל הרכב"}`))
	m, _ := res.(map[string]any)
	if err != nil || m["name"] != "Vehicle Works" || m["cost"].(int) <= 0 {
		t.Fatalf("repairing the works by its Hebrew name: %v %v", res, err)
	}
	log := rm.Log(0)
	if len(log) == 0 || !strings.Contains(log[len(log)-1].Text, "Repairing the Vehicle Works") {
		t.Fatalf("the net did not say what the operator is mending: %+v", log)
	}

	// Sell the power plant: gold back, and the side goes short.
	gold := st["gold"].(float64)
	res, err = rm.Tool(anvil, ToolSell, json.RawMessage(`{"place":"power plant"}`))
	m, _ = res.(map[string]any)
	plant := rules.Factions["aegis"].Structures["powerPlant"]
	if err != nil || m["back"] != int(float64(plant.Cost)*rules.Match.SellShare) || float64(m["gold"].(int)) <= gold-200 {
		t.Fatalf("selling the power plant: %v %v", res, err)
	}
	// The sale is told once, by the base cue for it.
	ticks(rm, 0.3)
	sold := 0
	for _, m := range rm.Log(0) {
		if m.Cue == "structureSold" && strings.Contains(m.Text, "Power Plant sold") {
			sold++
		}
		if strings.Contains(m.Text, "Sold the") {
			t.Fatalf("the sale was announced a second time: %q", m.Text)
		}
	}
	if sold != 1 {
		t.Fatalf("the net said the sale %d times, want once: %+v", sold, rm.Log(0))
	}
	st = status()
	if power := st["power"].(map[string]any); power["low"] != true || st["radar"] != false {
		t.Fatalf("with the power plant sold: power=%v radar=%v", power, st["radar"])
	}
	// Built again by its role.
	tool(t, rm, anvil, ToolBuild, `{"structure":"power"}`)
	ticks(rm, plant.BuildSeconds/rules.Match.LowPowerFactor+1)
	st = status()
	if power := st["power"].(map[string]any); power["low"] != false || st["radar"] != true {
		t.Fatalf("with a new power plant: power=%v radar=%v", power, st["radar"])
	}
}

func TestSellingFollowsThePurse(t *testing.T) {
	rm := newRoom(t, Config{AutoStart: true})
	hammer := join(t, rm, 0, RoleHammer, 0)
	anvil := join(t, rm, 0, RoleAnvil, 0)
	ticks(rm, 30)
	if _, err := rm.Tool(anvil, ToolSell, json.RawMessage(`{"place":"dockyard"}`)); !errors.Is(err, ErrNotOrdered) {
		t.Fatalf("an unordered sale: err = %v, want ErrNotOrdered", err)
	}
	if _, err := rm.Say(hammer, "Anvil, this is Hammer. Sell the dockyard. Over."); err != nil {
		t.Fatal(err)
	}
	res, err := rm.Tool(anvil, ToolSell, json.RawMessage(`{"place":"dockyard"}`))
	if m, _ := res.(map[string]any); err != nil || m["announced"] != true { // the base cue tells it
		t.Fatalf("an ordered sale: %v %v", res, err)
	}
}
