package room

import (
	"encoding/json"
	"strings"
	"testing"

	"callsign/server/radio"
	"callsign/server/sim"
)

// cuesHeard reads what a client was sent and keeps the base cues.
func cuesHeard(t *testing.T, c *Client) []Message {
	t.Helper()
	var out []Message
	for _, f := range drain(t, c) {
		if f.Type == "radio" && f.Message.Cue != "" {
			out = append(out, f.Message)
		}
	}
	return out
}

func TestTheOperatorSaysWhatHappensAtTheBaseInTheNetLanguage(t *testing.T) {
	rm := newRoom(t, Config{AutoStart: true, StartGold: 2000})
	hammer := join(t, rm, 0, RoleHammer, 0)
	enemy := join(t, rm, 1, RoleHammer, 0)
	anvil := join(t, rm, 0, RoleAnvil, 0)
	viper := join(t, rm, 0, RoleSquad, 1)
	for i := 0; i < 3*rules.TickRate; i++ {
		rm.Tick()
	}
	if got := cuesHeard(t, hammer); len(got) != 0 {
		t.Fatalf("the squads a match starts with were announced: %q", got[0].Text)
	}
	drain(t, enemy)
	drain(t, viper)

	// A purchase Hammer ordered: the squad is announced when it takes the field.
	if _, err := rm.Say(hammer, "Anvil, buy a tank"); err != nil {
		t.Fatal(err)
	}
	if _, err := rm.Tool(anvil, ToolBuy, json.RawMessage(`{"unit":"tank","upgrade":""}`)); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 20*rules.TickRate; i++ {
		rm.Tick()
	}
	got := cuesHeard(t, hammer)
	if len(got) != 1 || got[0].Cue != "unitReady" || got[0].Text != "Hammer, this is Anvil. Rhino 1 in the field. Out." {
		t.Fatalf("after the tank deployed Hammer heard %+v", got)
	}
	m := got[0]
	if m.From.Key != radio.Operator || len(m.To) != 1 || m.To[0].Key != "player" || m.Lang != "en" || m.End != radio.Out {
		t.Fatalf("a cue is the operator's word to its commander, ending Out: %+v", m)
	}
	// The other side hears none of it, and neither is it lost from the net's log.
	if heard := cuesHeard(t, enemy); len(heard) != 0 {
		t.Fatalf("the enemy heard our cue: %q", heard[0].Text)
	}
	if log := rm.Log(0); log[len(log)-1].Cue != "unitReady" {
		t.Fatalf("the cue is not in the net's log: %+v", log[len(log)-1])
	}
	// The squad on the net hears it as traffic like everyone on its side.
	if heard := cuesHeard(t, viper); len(heard) != 1 {
		t.Fatalf("a squad on the net should receive the cue as traffic, got %d", len(heard))
	}

	// Once Hammer speaks Hebrew the cues are Hebrew.
	if _, err := rm.Say(hammer, "סדן, מה המצב?"); err != nil {
		t.Fatal(err)
	}
	rm.cueEvent(sim.Event{Tick: rm.sim.Tick, Side: 0, Kind: sim.EvStructureBuilt, Unit: "vehicleWorks", Point: "A"})
	rm.cueEvent(sim.Event{Tick: rm.sim.Tick, Side: 0, Kind: sim.EvStructureBuilt, Unit: "sentryGun", Point: "A"})
	got = cuesHeard(t, hammer)
	if len(got) != 2 || got[0].Cue != "newOptions" || got[1].Cue != "structureReady" || got[0].Lang != "he" {
		t.Fatalf("two structures finished: %+v", got)
	}
	if !strings.Contains(got[0].Text, "פטיש, כאן סדן") || !strings.Contains(got[0].Text, "נפתחו אפשרויות חדשות") || !strings.Contains(got[1].Text, "הבנייה הושלמה") {
		t.Fatalf("Hebrew cues read %q and %q", got[0].Text, got[1].Text)
	}
}

func TestACueIsNotRepeatedInsideItsGap(t *testing.T) {
	rm := newRoom(t, Config{AutoStart: true})
	hammer := join(t, rm, 0, RoleHammer, 0)
	gap := int(rules.Radio.Cues["baseUnderAttack"].Gap * float64(rules.TickRate))
	if gap < 2 {
		t.Fatalf("the base-under-attack cue needs a gap to test, has %d ticks", gap)
	}
	attack := func() {
		rm.cueEvent(sim.Event{Tick: rm.sim.Tick, Side: 0, Kind: sim.EvHQUnderAttack, Point: "A"})
		rm.cueEvent(sim.Event{Tick: rm.sim.Tick, Side: 0, Kind: sim.EvStructureAttacked, Unit: "barracks", Point: "A"})
	}
	attack()
	for i := 0; i < gap-1; i++ {
		rm.Tick()
		attack()
	}
	if got := cuesHeard(t, hammer); len(got) != 1 || got[0].Cue != "baseUnderAttack" {
		t.Fatalf("a base under fire for less than the gap was announced %d times", len(got))
	}
	rm.Tick()
	rm.Tick()
	attack()
	if got := cuesHeard(t, hammer); len(got) != 1 {
		t.Fatalf("after the gap the cue should be said again, once; got %d", len(got))
	}
}

func TestARefusalForGoldIsSaidAndOtherRefusalsAreNot(t *testing.T) {
	rm := newRoom(t, Config{AutoStart: true, StartGold: 100})
	hammer := join(t, rm, 0, RoleHammer, 0)
	anvil := join(t, rm, 0, RoleAnvil, 0)
	if _, err := rm.Say(hammer, "Anvil, buy a helicopter"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if _, err := rm.Tool(anvil, ToolBuy, json.RawMessage(`{"unit":"helicopter","upgrade":""}`)); err == nil {
			t.Fatal("a helicopter was bought with 100 gold")
		}
	}
	got := cuesHeard(t, hammer)
	if len(got) != 1 || got[0].Cue != "noGold" || got[0].Text != "Hammer, this is Anvil. Not enough gold. Out." {
		t.Fatalf("three refusals for gold in a row: %+v", got)
	}
	if _, err := rm.Tool(anvil, ToolBuy, json.RawMessage(`{"unit":"no such unit","upgrade":""}`)); err == nil {
		t.Fatal("an unknown unit was bought")
	}
	if got := cuesHeard(t, hammer); len(got) != 0 {
		t.Fatalf("a refusal that was not about gold was announced: %q", got[0].Text)
	}
}

func TestCuesForHaulersTechBuildingsAndEventsNamedInTheRules(t *testing.T) {
	rm := newRoom(t, Config{AutoStart: true})
	hammer := join(t, rm, 0, RoleHammer, 0)
	enemy := join(t, rm, 1, RoleHammer, 0)
	us, them := 0, 1
	for _, tc := range []struct {
		e    sim.Event
		cue  string
		text string
	}{
		{sim.Event{Side: 0, Kind: sim.EvHaulerAttacked, Unit: "crawler", Point: "B"}, "haulerUnderAttack", "Ore crawler under attack near Bravo"},
		{sim.Event{Side: 0, Kind: sim.EvHaulerLost, Unit: "crawler", Point: "B"}, "haulerLost", "We lost Ore crawler near Bravo"},
		{sim.Event{Side: 0, Kind: sim.EvStructureCaptured, Unit: "tech_clinic", Point: "D", Owner: &us}, "structureTaken", "Field Clinic is ours"},
		{sim.Event{Side: 0, Kind: sim.EvTechLost, Unit: "tech_goldworks", Point: "G", Owner: &them}, "structureLost", "We lost Assay Office"},
		{sim.Event{Side: 0, Kind: sim.EvStructureLost, Unit: "refinery", Point: "A", Owner: &us}, "", ""}, // inside the gap of the one before
		{sim.Event{Side: 0, Kind: "low_power"}, "lowPower", "Low power"},
		{sim.Event{Side: 0, Kind: "power_restored"}, "powerRestored", "Power restored"},
		{sim.Event{Side: 0, Kind: sim.EvStructureLost, Unit: "chopShop", Point: "Z", Owner: &them}, "", ""}, // the enemy's loss is not ours to announce
		{sim.Event{Side: 0, Kind: sim.EvContact, Squad: 1, Point: "F"}, "", ""},
	} {
		tc.e.Tick = rm.sim.Tick
		rm.cueEvent(tc.e)
		got := cuesHeard(t, hammer)
		switch {
		case tc.cue == "" && len(got) != 0:
			t.Errorf("%s was announced: %q", tc.e.Kind, got[0].Text)
		case tc.cue != "" && (len(got) != 1 || got[0].Cue != tc.cue || !strings.Contains(got[0].Text, tc.text)):
			t.Errorf("%s: heard %+v, want the %s cue saying %q", tc.e.Kind, got, tc.cue, tc.text)
		}
	}
	if heard := cuesHeard(t, enemy); len(heard) != 0 {
		t.Fatalf("the enemy heard %d of our cues", len(heard))
	}
	// Every cue in the rules can be said in both languages with the words it asks for.
	for name, cue := range rules.Radio.Cues {
		for _, line := range []string{cue.Line.En, cue.Line.He} {
			for _, hole := range []string{"{structure}", "{squad}", "{unit}", "{point}", "{hero}"} {
				line = strings.ReplaceAll(line, hole, "x")
			}
			if strings.ContainsAny(line, "{}") {
				t.Errorf("cue %s asks for a word nothing fills in: %q", name, line)
			}
		}
	}
}

func TestATechBuildingIsTakenByTheNameItHasOnTheMap(t *testing.T) {
	rm, err := New(rules, Config{Seed: 1, Factions: [2]string{"aegis", "ashfall"}, AutoStart: true, FullBase: true, Purse: true})
	if err != nil {
		t.Fatal(err)
	}
	anvil := join(t, rm, 0, RoleAnvil, 0)
	hammer := join(t, rm, 0, RoleHammer, 0)
	tool(t, rm, anvil, ToolBuy, `{"unit":"engineers"}`)
	ticks(rm, 6)
	engineers := join(t, rm, 0, RoleSquad, 5)
	var west, east sim.StructureView
	rm.View(func(s *sim.Sim) {
		for _, st := range s.Snapshot(sim.Spectator).Structures {
			switch st.Site {
			case "tech-assay-w":
				west = st
			case "tech-assay-e":
				east = st
			}
		}
		// The engineers stand by the western office, a squad of ours looks at the eastern
		// one, and the enemy is far away.
		place := func(id int, x, y float64) {
			for i := range s.Squad(id).Teams {
				s.Squad(id).Teams[i].X, s.Squad(id).Teams[i].Y = x+float64(i*6), y
			}
		}
		place(5, west.X-70, west.Y)
		place(1, east.X-80, east.Y)
		place(3, 1500, 900)
		place(4, 1500, 900)
	})
	ticks(rm, 0.3)
	res, err := rm.Tool(engineers, ToolReport, nil)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, b := range res.(map[string]any)["structures"].([]StructureBrief) {
		if b.ID == east.ID {
			found = b.Holder == "nobody" && b.Site == "the assay office east of Golf" && b.SiteHe != "" && b.Gives != "" && !b.Yours
		}
	}
	if !found {
		t.Fatalf("the report should list the eastern office as nobody's, by its name, with what it gives")
	}
	// Named in Hebrew, the far one is the one taken, though the near one is the same kind.
	tool(t, rm, engineers, ToolCapture, `{"place":"בית הבוחן ממזרח לגימל"}`)
	drain(t, hammer)
	ticks(rm, 60)
	rm.View(func(s *sim.Sim) {
		for _, st := range s.Snapshot(0).Structures {
			if st.ID == west.ID && st.Side != sim.NoSide {
				t.Errorf("the near office was taken instead: side %d", st.Side)
			}
			if st.ID == east.ID && st.Side != 0 {
				t.Errorf("the office named was not taken: side %d", st.Side)
			}
		}
	})
	got := cuesHeard(t, hammer)
	if len(got) != 1 || got[0].Cue != "structureTaken" || got[0].Text != "Hammer, this is Anvil. Assay Office is ours. Out." {
		t.Fatalf("after the takeover Hammer heard %+v", got)
	}
}
