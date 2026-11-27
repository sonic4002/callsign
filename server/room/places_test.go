package room

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"callsign/server/sim"
)

func TestTheLobbyChoosesTheMapAndTheStartingGold(t *testing.T) {
	h := newHub(t, HubConfig{Bot: "easy"})
	rm, side, _, err := h.Create(Options{Opponent: OpponentFriend, Side: 0, Map: "medium", StartGold: 2500, LengthSeconds: 1200})
	if err != nil {
		t.Fatal(err)
	}
	l := rm.Lobby()
	if l.Map != "medium" || l.StartGold != 2500 || l.Length != 1200 {
		t.Fatalf("the lobby shows map %q, %d gold, %d s", l.Map, l.StartGold, l.Length)
	}
	rm.View(func(s *sim.Sim) {
		if s.Gold(0) != 2500 || s.Gold(1) != 2500 || len(s.Points) != 15 || s.R.Map.ID != "medium" {
			t.Fatalf("the match has %d and %d gold on %q with %d points", s.Gold(0), s.Gold(1), s.R.Map.ID, len(s.Points))
		}
	})
	// The page is told about the room's map as "the map", and still has every map.
	c, err := rm.Join(Identity{Side: side, Role: RoleHammer}, true)
	if err != nil {
		t.Fatal(err)
	}
	var hello struct {
		Rules struct {
			Map struct {
				ID     string
				Width  float64
				Points []struct{ ID string }
			}
			Maps map[string]json.RawMessage
		}
	}
	if err := json.Unmarshal(<-c.Out, &hello); err != nil {
		t.Fatal(err)
	}
	if hello.Rules.Map.ID != "medium" || hello.Rules.Map.Width != 4000 || len(hello.Rules.Map.Points) != 15 || len(hello.Rules.Maps) != 4 {
		t.Fatalf("the greeting's rules play on %+v, with %d maps", hello.Rules.Map, len(hello.Rules.Maps))
	}
	// A rematch keeps the choices.
	if err := rm.reset(); err != nil {
		t.Fatal(err)
	}
	if l := rm.lobby(); l.Map != "medium" || l.StartGold != 2500 {
		t.Fatalf("after a rematch the lobby shows %q and %d gold", l.Map, l.StartGold)
	}

	// Left alone, a match is the small map with the rules' gold.
	rm, _, _, err = h.Create(Options{Opponent: OpponentBot, Side: 0})
	if err != nil {
		t.Fatal(err)
	}
	if l := rm.Lobby(); l.Map != "small" || l.StartGold != rules.Match.StartGold {
		t.Fatalf("the default lobby shows %q and %d gold", l.Map, l.StartGold)
	}
	for _, o := range []Options{
		{Opponent: OpponentBot, Side: 0, Map: "nowhere"},
		{Opponent: OpponentBot, Side: 0, StartGold: MinStartGold - 1},
		{Opponent: OpponentBot, Side: 0, StartGold: MaxStartGold + 1},
		{Opponent: OpponentBot, Side: 0, LengthSeconds: 3600},
	} {
		if _, _, _, err := h.Create(o); err == nil {
			t.Errorf("a match was made with %+v", o)
		}
	}
	// What the lobby offers, before any room exists.
	maps := h.mapList()
	if len(maps) != 4 || maps[0]["id"] != "small" || maps[1]["id"] != "medium" || maps[2]["id"] != "large" || maps[3]["id"] != "huge" {
		t.Fatalf("the maps on offer: %v", maps)
	}
}

func TestOrdersGoToPlaces(t *testing.T) {
	rm := newRoom(t, Config{})
	viper1 := join(t, rm, 0, RoleSquad, 1)
	anvil := join(t, rm, 0, RoleAnvil, 0)
	order := func() sim.Order {
		var o sim.Order
		rm.View(func(s *sim.Sim) { o = s.Squad(1).Order })
		return o
	}
	for args, want := range map[string]string{
		`{"place":"the bunker at Delta"}`:      "D-bunker-1",
		`{"place":"D-bunker-1"}`:               "D-bunker-1",
		`{"place":"הבית שמצפון לפסל"}`:         "F-house-1",
		`{"place":"north of Foxtrot"}`:         "N of F 120",
		`{"place":"200 metres east of Delta"}`: "E of D 200",
		`{"place":"the south bridge"}`:         "bridge-south",
		`{"place":"Foxtrot"}`:                  "F",
		`{"point":"F"}`:                        "F", // the older name of the argument still works
	} {
		tool(t, rm, viper1, ToolHold, args)
		if o := order(); o.Place != want {
			t.Errorf("hold %s: the order goes to %q, want %q", args, o.Place, want)
		}
	}
	// Words that fit several landmarks are answered with the choices, so the squad can ask.
	_, err := rm.Tool(viper1, ToolHold, json.RawMessage(`{"place":"the house at Foxtrot"}`))
	if !errors.Is(err, ErrWhichPlace) || !strings.Contains(err.Error(), "the house north of Foxtrot (F-house-1)") || !strings.Contains(err.Error(), "F-house-4") {
		t.Fatalf("an unclear place: %v", err)
	}
	if _, err := rm.Tool(viper1, ToolHold, json.RawMessage(`{"place":"the lighthouse"}`)); !errors.Is(err, sim.ErrNoPoint) {
		t.Fatalf("a place the map does not have: %v", err)
	}
	// The id of something another part of the game put on the map goes straight through.
	rm.View(func(s *sim.Sim) {
		s.Places = append(s.Places, func(id string) (sim.Place, bool) {
			return sim.Place{Kind: sim.PlaceStructure, ID: "works-1", X: 300, Y: 480}, id == "works-1"
		})
	})
	tool(t, rm, viper1, ToolHold, `{"place":"works-1"}`)
	if o := order(); o.Place != "works-1" {
		t.Fatalf("hold at a structure: the order goes to %q", o.Place)
	}
	// "here" still holds the ground the squad stands on.
	tool(t, rm, viper1, ToolHold, `{"place":"here"}`)
	if o := order(); o.Place != "" || o.Kind != sim.OrderHold {
		t.Fatalf("hold here: %+v", o)
	}
	// Repair is a squad leader's tool; whether the squad can do it is the simulation's call.
	if _, err := rm.Tool(viper1, ToolRepair, json.RawMessage(`{"place":"the south bridge"}`)); !errors.Is(err, sim.ErrNoRepair) {
		t.Fatalf("commandos repairing a bridge: %v", err)
	}
	if _, err := rm.Tool(anvil, ToolRepair, json.RawMessage(`{"place":"the south bridge"}`)); !errors.Is(err, sim.ErrNotYours) { // the operator mends structures
		t.Fatalf("the operator repairing a bridge: %v", err)
	}
}

func TestLeadersAreToldAboutTheGroundAndCallsNameLandmarks(t *testing.T) {
	rm := newRoom(t, Config{})
	hammer := join(t, rm, 0, RoleHammer, 0)
	viper1 := join(t, rm, 0, RoleSquad, 1)
	drain(t, viper1)
	if _, err := rm.Say(hammer, "Viper 1, take cover in the bunker at Delta"); err != nil {
		t.Fatal(err)
	}
	got := radioFrames(drain(t, viper1))
	if len(got) != 1 || !reflect.DeepEqual(got[0].Landmarks, []string{"D-bunker-1"}) || !reflect.DeepEqual(got[0].Points, []string{"D"}) {
		t.Fatalf("the call reached the squad as %+v", got)
	}
	res, err := rm.Tool(viper1, ToolReport, nil)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(res)
	var report struct {
		Landmarks []sim.NearbyLandmark
	}
	if err := json.Unmarshal(b, &report); err != nil {
		t.Fatal(err)
	}
	by := map[string]sim.NearbyLandmark{}
	for _, l := range report.Landmarks {
		by[l.ID] = l
	}
	bunker, grove, span := by["D-bunker-1"], by["A-grove-1"], by["bridge-south"]
	if bunker.Name != "the bunker north of Delta" || bunker.Kind != "bunker" || bunker.Room != rules.LandmarkKinds["bunker"].Garrison || bunker.Cover != rules.LandmarkKinds["bunker"].GarrisonCover {
		t.Errorf("the bunker is reported as %+v", bunker)
	}
	if grove.Kind != "grove" || grove.Cover != rules.LandmarkKinds["grove"].Cover || grove.Room != 0 {
		t.Errorf("the grove is reported as %+v", grove)
	}
	if span.Kind != "bridge" || span.Name != "the south bridge" {
		t.Errorf("the south bridge is reported as %+v", span)
	}
}
