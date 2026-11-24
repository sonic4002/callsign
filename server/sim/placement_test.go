package sim_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"testing"

	"callsign/server/sim"
	"callsign/shared"
)

// spot finds ground where a side may put a structure, as an exact offset from its
// headquarters point, skipping what `skip` rules out. It returns the written place and
// where that is.
func spot(t *testing.T, s *sim.Sim, side int, kind string, skip func(x, y float64) bool) (string, float64, float64) {
	t.Helper()
	def := rules.Factions[s.Sides[side].Faction].Structures[kind]
	hq := rules.HQPoint(side)
	for dy := -400; dy <= 400; dy += 20 {
		for dx := -400; dx <= 400; dx += 20 {
			x, y := hq.X+float64(dx), hq.Y+float64(dy)
			if s.CanPlace(side, &def, x, y) != nil || (skip != nil && skip(x, y)) {
				continue
			}
			return offset(hq.ID, dx, dy), x, y
		}
	}
	t.Fatalf("no ground for a %s on side %d", kind, side)
	return "", 0, 0
}

// offset writes an exact spot the way an order does: "N140 E60 of A".
func offset(point string, dx, dy int) string {
	ns, ew := fmt.Sprintf("S%d", dy), fmt.Sprintf("E%d", dx)
	if dy < 0 {
		ns = fmt.Sprintf("N%d", -dy)
	}
	if dx < 0 {
		ew = fmt.Sprintf("W%d", -dx)
	}
	return ns + " " + ew + " of " + point
}

func byID(s *sim.Sim, id string) *sim.Structure {
	for _, st := range s.Structures {
		if st.PlaceID() == id {
			return st
		}
	}
	return nil
}

func TestAStructureGoesWhereTheOrderPutsIt(t *testing.T) {
	s := baseSim(t, 1)
	wealth(s, 0, 2000)
	auto, _, _ := s.SiteFor(0, structureDef("aegis", "vehicleWorks"))
	place, x, y := spot(t, s, 0, "vehicleWorks", func(px, _ float64) bool { return math.Abs(px-auto) < 60 })
	before := s.Gold(0)
	if _, err := s.Build(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "vehicleWorks", Place: place}); err != nil {
		t.Fatalf("build at %s: %v", place, err)
	}
	st := own(s, 0, shared.RoleWorks)
	if st == nil || st.X != x || st.Y != y {
		t.Fatalf("the works stands at %+v, want (%v, %v)", st, x, y)
	}
	if got := before - s.Gold(0); got != rules.Factions["aegis"].Structures["vehicleWorks"].Cost {
		t.Fatalf("the works cost %d", got)
	}
}

func structureDef(faction, kind string) *shared.Structure {
	def := rules.Factions[faction].Structures[kind]
	return &def
}

func TestWhereAStructureMayNotGo(t *testing.T) {
	s := baseSim(t, 1)
	wealth(s, 0, 3000)
	gold := s.Gold(0)
	hq := rules.HQPoint(0)
	barracks := own(s, 0, shared.RoleBarracks)
	far := rules.PointByID("F")
	for name, tc := range map[string]struct {
		place string
		want  error
	}{
		"across the map":          {offset(far.ID, 0, 140), sim.ErrTooFar},
		"on the headquarters":     {offset(hq.ID, 40, 0), sim.ErrNoRoom},
		"on top of the barracks":  {offset(hq.ID, int(barracks.X-hq.X)+10, int(barracks.Y-hq.Y)), sim.ErrNoRoom},
		"off the edge of the map": {offset(hq.ID, -int(hq.X)+10, 0), sim.ErrBadGround},
	} {
		_, err := s.Build(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "vehicleWorks", Place: tc.place})
		if !errors.Is(err, tc.want) {
			t.Errorf("%s (%s): err = %v, want %v", name, tc.place, err, tc.want)
		}
	}
	if s.Gold(0) != gold {
		t.Fatalf("a refused structure cost %d gold", gold-s.Gold(0))
	}
	// Water, ice and mountains are never built on, wherever they are.
	works := structureDef("aegis", "vehicleWorks")
	for r, row := range rules.Map.Terrain {
		for c := range row {
			x, y := (float64(c)+0.5)*rules.Map.Cell, (float64(r)+0.5)*rules.Map.Cell
			if rules.Map.TerrainAt(x, y) != 'L' && s.CanPlace(0, works, x, y) == nil {
				t.Fatalf("a works may stand on %q at (%v, %v)", rules.Map.TerrainAt(x, y), x, y)
			}
		}
	}
}

// A base grows outward: a finished structure lets the next one stand farther from the
// headquarters than the headquarters alone allows, and one still going up does not.
func TestTheBaseGrowsFromFinishedStructures(t *testing.T) {
	s := baseSim(t, 1)
	wealth(s, 0, 3000)
	hq := rules.HQPoint(0)
	works := structureDef("aegis", "vehicleWorks")
	// The farthest ground the headquarters allows, on the side away from the map's edge.
	var px, py float64
	best := 0.0
	for dy := -300; dy <= 300; dy += 20 {
		for dx := 0; dx <= 300; dx += 20 {
			x, y := hq.X+float64(dx), hq.Y+float64(dy)
			if d := math.Hypot(float64(dx), float64(dy)); d > best && s.CanPlace(0, works, x, y) == nil {
				px, py, best = x, y, d
			}
		}
	}
	if best < rules.Match.BaseRadius-60 {
		t.Fatalf("no ground near the edge of the base: best %v", best)
	}
	if _, err := s.Build(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "vehicleWorks", Place: offset(hq.ID, int(px-hq.X), int(py-hq.Y))}); err != nil {
		t.Fatal(err)
	}
	// Ground beyond the headquarters' reach, but within reach of the works.
	air := structureDef("aegis", "airbase")
	var qx, qy float64
	found := false
	for dy := -160; dy <= 160 && !found; dy += 20 {
		for dx := 0; dx <= 160 && !found; dx += 20 {
			x, y := px+float64(dx), py+float64(dy)
			beyond := math.Hypot(x-hq.X, y-hq.Y) > rules.Match.BaseRadius+10
			near := math.Hypot(x-px, y-py) <= rules.Match.BaseReach && math.Hypot(x-px, y-py) > works.Footprint+air.Footprint+20
			if beyond && near && errors.Is(s.CanPlace(0, air, x, y), sim.ErrTooFar) {
				qx, qy, found = x, y, true
			}
		}
	}
	if !found {
		t.Skip("this map has no open ground just beyond the base to try")
	}
	run(s, works.BuildSeconds+1)
	if err := s.CanPlace(0, air, qx, qy); err != nil {
		t.Fatalf("with the works finished, ground %v from it is still refused: %v", math.Hypot(qx-px, qy-py), err)
	}
}

func TestASecondStructureOfARoleAndTheBaseCap(t *testing.T) {
	s := baseSim(t, 1)
	wealth(s, 0, 600)
	if _, err := s.Build(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "barracks"}); err != nil {
		t.Fatalf("a second barracks: %v", err)
	}
	n := 0
	for _, st := range s.Snapshot(0).Structures {
		if st.Side == 0 && st.Role == shared.RoleBarracks {
			n++
		}
	}
	if n != 2 {
		t.Fatalf("%d barracks, want 2", n)
	}
	// A place that is only named means "near there".
	run(s, 10)
	wealth(s, 0, 600)
	hq := rules.HQPoint(0)
	st, err := s.Build(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "barracks", Place: hq.ID})
	if err != nil {
		t.Fatalf("a barracks near %s: %v", hq.ID, err)
	}
	if d := math.Hypot(st.X-hq.X, st.Y-hq.Y); d > rules.Match.BaseRadius {
		t.Fatalf("it went %v from the headquarters", d)
	}
	saved := rules.Match.BaseCap
	rules.Match.BaseCap = 4 // refinery, barracks and the two just built
	defer func() { rules.Match.BaseCap = saved }()
	run(s, 10)
	wealth(s, 0, 600)
	if _, err := s.Build(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "barracks"}); !errors.Is(err, sim.ErrBaseFull) {
		t.Fatalf("past the base cap: err = %v", err)
	}
}

func TestADockyardStandsOnTheShore(t *testing.T) {
	s := baseSim(t, 1)
	wealth(s, 0, 2000)
	dock := structureDef("aegis", "dockyard")
	x, y, ok := s.SiteFor(0, dock)
	if !ok {
		t.Fatal("no shore for a dockyard")
	}
	wet := false
	for _, d := range [][2]float64{{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {-1, 1}, {1, -1}, {-1, -1}} {
		wet = wet || rules.Map.TerrainAt(x+d[0]*(dock.Footprint+rules.Map.Cell/2), y+d[1]*(dock.Footprint+rules.Map.Cell/2)) == 'W' ||
			rules.Map.TerrainAt(x+d[0]*rules.Map.Cell, y+d[1]*rules.Map.Cell) == 'W'
	}
	if !wet {
		t.Fatalf("the dockyard's own site (%v, %v) has no water beside it", x, y)
	}
	// Inland, where a barracks may go, a dockyard may not.
	_, bx, by := spot(t, s, 0, "barracks", func(px, py float64) bool { return s.CanPlace(0, dock, px, py) == nil })
	if err := s.CanPlace(0, dock, bx, by); !errors.Is(err, sim.ErrNoShore) {
		t.Fatalf("a dockyard inland: err = %v", err)
	}
}

// Both sides, on every map, have ground for each structure of a full base.
func TestEveryMapHasGroundForAFullBase(t *testing.T) {
	for _, id := range rules.MapIDs() {
		r, err := rules.ForMap(id)
		if err != nil {
			t.Fatal(err)
		}
		s, err := sim.New(r, sim.Config{Seed: 1, Factions: [2]string{"aegis", "ashfall"}, FullBase: true})
		if err != nil {
			t.Fatal(err)
		}
		for side := 0; side < 2; side++ {
			for _, role := range shared.BaseRoles {
				if !s.Has(side, role) {
					t.Errorf("%s: side %d could not place a %s", id, side, role)
				}
			}
		}
	}
}

// The page tints the ground with its own copy of the rule (client/placement.js). Both
// are checked against one table, so they cannot drift apart: UPDATE_PLACEMENT=1 rewrites it.
func TestPlacementMatchesTheTableThePageIsCheckedAgainst(t *testing.T) {
	s := baseSim(t, 1)
	// A point held away from the base, a gun beside it and a fence at home, so the table
	// also covers ground that a held point opens and that small works block.
	wealth(s, 0, 1500)
	for i := range s.Points {
		if s.Points[i].ID == "D" {
			s.Points[i].Owner = 0
		}
	}
	if _, err := s.Build(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "sentryGun", Place: "D"}); err != nil {
		t.Fatal(err)
	}
	run(s, 30)
	if _, err := s.Build(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "barrierWall", Place: "base:north"}); err != nil {
		t.Fatal(err)
	}
	run(s, 30)
	type row struct {
		Kind string `json:"kind"`
		Side int    `json:"side"`
		OK   string `json:"ok"` // one character per spot, row by row: 1 may, 0 may not
	}
	const step = 40.0
	var rows []row
	for _, tc := range []struct {
		kind string
		side int
	}{{"vehicleWorks", 0}, {"dockyard", 0}, {"chopShop", 1}, {"barracks", 0}, {"sentryGun", 0}, {"barrierWall", 0}, {"gunNest", 1}} {
		def := structureDef(s.Sides[tc.side].Faction, tc.kind)
		bits := []byte{}
		for y := step / 2; y < rules.Map.Height; y += step {
			for x := step / 2; x < rules.Map.Width; x += step {
				if s.CanPlaceKind(tc.side, def, x, y) == nil {
					bits = append(bits, '1')
				} else {
					bits = append(bits, '0')
				}
			}
		}
		rows = append(rows, row{tc.kind, tc.side, string(bits)})
	}
	type table struct {
		Step       float64             `json:"step"`
		Points     []sim.PointView     `json:"points"`
		Structures []sim.StructureView `json:"structures"`
		Rows       []row               `json:"rows"`
	}
	snap := s.Snapshot(sim.Spectator)
	got := table{step, snap.Points, snap.Structures, rows}
	const path = "../../client/testdata/placement-small.json"
	if os.Getenv("UPDATE_PLACEMENT") != "" {
		data, _ := json.MarshalIndent(got, "", " ")
		if err := os.MkdirAll("../../client/testdata", 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, append(data, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%v (run with UPDATE_PLACEMENT=1 to write it)", err)
	}
	var want table
	if err := json.Unmarshal(data, &want); err != nil {
		t.Fatal(err)
	}
	for i, r := range want.Rows {
		if i >= len(rows) || rows[i] != r {
			t.Fatalf("placement of %s for side %d no longer matches %s: update the page's rule too, then UPDATE_PLACEMENT=1", r.Kind, r.Side, path)
		}
	}
	any := false
	for _, r := range rows {
		for _, b := range r.OK {
			any = any || b == '1'
		}
	}
	if !any || len(want.Rows) != len(rows) {
		t.Fatal("the table is empty or short")
	}
}
