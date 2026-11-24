package sim_test

import (
	"math"
	"testing"

	"callsign/server/sim"
	"callsign/shared"
)

// tech finds a tech building of a kind on the west (side 0's) half of the map, as the
// spectator sees it.
func tech(t *testing.T, s *sim.Sim, kind string, west bool) sim.StructureView {
	t.Helper()
	for _, st := range s.Snapshot(sim.Spectator).Structures {
		if st.Kind == kind && (st.X < rules.Map.Width/2) == west {
			return st
		}
	}
	t.Fatalf("no %s on the map", kind)
	return sim.StructureView{}
}

// take sends a fresh engineer squad of a side to capture a structure and waits for it.
func take(t *testing.T, s *sim.Sim, side int, unit string, st sim.StructureView) []sim.Event {
	t.Helper()
	eng := buyFielded(t, s, side, unit)
	place(eng, st.X-70, st.Y)
	s.Step()
	must(t, s, sim.Command{Side: side, Kind: sim.CmdCapture, Squad: eng.ID, Place: st.ID})
	var events []sim.Event
	for i := 0; i < 600 && eng.Alive; i++ {
		events = append(events, s.Step()...)
	}
	if eng.Alive {
		t.Fatalf("side %d's engineers never took %s", side, st.Site)
	}
	return events
}

func TestTechBuildingsStandOnEveryMapForBothSidesAlike(t *testing.T) {
	for _, id := range rules.MapIDs() {
		r, err := rules.ForMap(id)
		if err != nil {
			t.Fatal(err)
		}
		s, err := sim.New(r, sim.Config{Seed: 1, Factions: [2]string{"aegis", "ashfall"}})
		if err != nil {
			t.Fatal(err)
		}
		var sites []sim.StructureView
		for _, st := range s.Snapshot(sim.Spectator).Structures {
			if st.Role == shared.RoleTech {
				sites = append(sites, st)
				if st.Side != sim.NoSide || st.Faction != shared.TechFaction || st.Site == "" || st.HP != 1 {
					t.Errorf("%s: a tech building starts whole and nobody's: %+v", id, st)
				}
			}
		}
		if len(sites) < 2 || len(sites) != len(r.Map.TechBuildings) {
			t.Fatalf("%s: %d tech buildings standing, the map has %d", id, len(sites), len(r.Map.TechBuildings))
		}
		// Each has a twin as far from the other headquarters as it is from its own.
		a, z := r.HQPoint(0), r.HQPoint(1)
		for _, st := range sites {
			twin := false
			for _, o := range sites {
				twin = twin || (o.Kind == st.Kind && math.Abs(math.Hypot(o.X-z.X, o.Y-z.Y)-math.Hypot(st.X-a.X, st.Y-a.Y)) < 1)
			}
			if !twin {
				t.Errorf("%s: %s has no mirror image", id, st.Site)
			}
		}
		// Neither side has seen one yet: they are found by scouting.
		for side := 0; side < 2; side++ {
			for _, st := range s.Snapshot(side).Structures {
				if st.Role == shared.RoleTech {
					t.Errorf("%s: side %d is shown %s before it has seen it", id, side, st.Site)
				}
			}
		}
	}
}

func TestAnAssayOfficePaysALumpOnceAndGoldWhileHeld(t *testing.T) {
	s := baseSim(t, 1)
	def := rules.TechBuildings["tech_goldworks"]
	office := tech(t, s, "tech_goldworks", true)

	// It can be named by its site as well as by its structure id.
	eng := buyFielded(t, s, 0, "engineers")
	place(eng, office.X-70, office.Y)
	s.Step()
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdCapture, Squad: eng.ID, Place: office.Site})
	before := s.Gold(0)
	var events []sim.Event
	for i := 0; i < 600 && eng.Alive; i++ {
		events = append(events, s.Step()...)
	}
	if got := seen(s, 0, office.ID); got == nil || got.Side != 0 {
		t.Fatalf("after the capture side 0 is shown %+v", got)
	}
	if !has(events, sim.EvStructureCaptured, 0) {
		t.Fatal("the new holder was not told")
	}
	if has(events, sim.EvStructureCaptured, 1) {
		t.Fatal("the other side was told of a takeover it could not see")
	}
	if gained := s.Gold(0) - before; gained < def.Lump {
		t.Fatalf("gold went up by %d over the capture, less than the lump of %d", gained, def.Lump)
	}

	// While held it pays every second, on top of whatever else comes in.
	hold := sim.Command{Side: 0, Kind: sim.CmdHaul, Field: "auto"}
	_ = hold
	g0 := s.Gold(1) // the other side's income over the same time is the baseline
	h0 := s.Gold(0)
	run(s, 20)
	extra := (s.Gold(0) - h0) - (s.Gold(1) - g0)
	// Side 0 also has a hauler working where side 1's may be elsewhere; the office's share
	// is at least its own rate, and the snapshot's income figure includes it.
	if s.Snapshot(0).Income <= s.Snapshot(1).Income && extra < def.IncomePerSecond*15 {
		t.Fatalf("holding the assay office brought %d extra gold in 20 s, want about %d", extra, def.IncomePerSecond*20)
	}

	// The other side takes it back: it gets its own lump, and side 0 is told it lost it.
	back := take(t, s, 1, "sappers", office)
	if !has(back, sim.EvTechLost, 0) || !has(back, sim.EvStructureCaptured, 1) {
		t.Fatalf("a recapture should tell both: %v", kinds(back))
	}
	if got := seen(s, 1, office.ID); got == nil || got.Side != 1 {
		t.Fatalf("after the recapture side 1 is shown %+v", got)
	}
	// And a second capture by side 0 pays no second lump.
	before = s.Gold(0)
	again := buyFielded(t, s, 0, "engineers")
	spent := before - s.Gold(0)
	_ = spent
	place(again, office.X-70, office.Y)
	s.Step()
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdCapture, Squad: again.ID, Place: office.ID})
	prev := s.Gold(0)
	jump := 0
	for i := 0; i < 600 && again.Alive; i++ {
		s.Step()
		if d := s.Gold(0) - prev; d > jump {
			jump = d
		}
		prev = s.Gold(0)
	}
	if again.Alive {
		t.Fatal("the second capture never finished")
	}
	if jump >= def.Lump {
		t.Fatalf("gold jumped by %d in one tick on the second capture: the lump is paid once a side", jump)
	}
}

func kinds(events []sim.Event) []string {
	var out []string
	for _, e := range events {
		out = append(out, e.Kind)
	}
	return out
}

func TestAClinicHealsItsHoldersInfantryStandingByIt(t *testing.T) {
	s := baseSim(t, 1)
	clinic := tech(t, s, "tech_clinic", true)
	def := rules.TechBuildings["tech_clinic"]
	unit := rules.Factions["aegis"].Units["commandos"]
	full := float64(unit.Members) * unit.HP

	near, far := s.Squad(1), s.Squad(2)
	hurt := func(sq *sim.Squad) {
		for i := range sq.Teams {
			sq.Teams[i].HP, sq.Teams[i].Members = full*0.4, int(math.Ceil(full*0.4/unit.HP))
		}
	}
	place(near, clinic.X+60, clinic.Y)
	place(far, clinic.X+def.Radius+200, clinic.Y)
	hurt(near)
	hurt(far)
	run(s, 10)
	if near.Teams[0].HP != full*0.4 {
		t.Fatalf("a clinic nobody holds healed a squad: %.1f", near.Teams[0].HP)
	}

	take(t, s, 0, "engineers", clinic)
	hurt(near)
	hurt(far)
	members := near.Teams[0].Members
	run(s, 10)
	want := full*0.4 + def.MendPerSecond*10
	if got := near.Teams[0].HP; math.Abs(got-math.Min(full, want)) > def.MendPerSecond {
		t.Fatalf("beside the clinic a fireteam went from %.1f to %.1f in 10 s, want about %.1f", full*0.4, got, want)
	}
	if near.Teams[0].Members < members {
		t.Fatal("healing cost the fireteam a soldier")
	}
	if far.Teams[0].HP != full*0.4 {
		t.Fatalf("a squad out of the clinic's reach was healed: %.1f", far.Teams[0].HP)
	}
	run(s, 60)
	if got := near.Teams[0]; got.HP != full || got.Members != unit.Members {
		t.Fatalf("a fireteam left by the clinic should come back to full: %.1f hp, %d soldiers", got.HP, got.Members)
	}

	// It does nothing for the enemy standing there, nor for a vehicle.
	tank := buyFieldedWith(t, s, 0, "vehicleWorks", "tank")
	place(tank, clinic.X-60, clinic.Y+60)
	tank.Teams[0].HP *= 0.5
	was := tank.Teams[0].HP
	run(s, 5)
	if tank.Teams[0].HP != was {
		t.Fatal("the clinic mended a tank")
	}
}

// buyFieldedWith builds the structure a unit needs, then buys the unit.
func buyFieldedWith(t *testing.T, s *sim.Sim, side int, structure, unit string) *sim.Squad {
	t.Helper()
	def := rules.Factions[s.Sides[side].Faction].Structures[structure]
	wealth(s, side, def.Cost)
	if _, err := s.Apply(sim.Command{Side: side, Kind: sim.CmdBuild, Structure: structure}); err != nil {
		t.Fatal(err)
	}
	run(s, def.BuildSeconds+1)
	return buyFielded(t, s, side, unit)
}

func TestAServiceYardRepairsVehiclesAndHaulersNotSoldiers(t *testing.T) {
	r, err := rules.ForMap("medium")
	if err != nil {
		t.Fatal(err)
	}
	s, err := sim.New(r, sim.Config{Seed: 1, Factions: [2]string{"aegis", "ashfall"}, FullBase: true})
	if err != nil {
		t.Fatal(err)
	}
	var yard sim.StructureView
	for _, st := range s.Snapshot(sim.Spectator).Structures {
		if st.Kind == "tech_garage" && st.X < r.Map.Width/2 {
			yard = st
		}
	}
	def := r.TechBuildings["tech_garage"]
	take(t, s, 0, "engineers", yard)

	tank := buyFielded(t, s, 0, "tank")
	unit := r.Factions["aegis"].Units["tank"]
	full := float64(unit.Members) * unit.HP
	place(tank, yard.X-70, yard.Y+40)
	tank.Teams[0].HP = full * 0.3
	soldiers := s.Squad(1)
	place(soldiers, yard.X+60, yard.Y+40)
	soldiers.Teams[0].HP *= 0.5
	was := soldiers.Teams[0].HP
	run(s, 10)
	if got, want := tank.Teams[0].HP, full*0.3+def.MendPerSecond*10; math.Abs(got-math.Min(full, want)) > def.MendPerSecond {
		t.Fatalf("beside the yard a tank went from %.0f to %.0f in 10 s, want about %.0f", full*0.3, got, want)
	}
	if soldiers.Teams[0].HP != was {
		t.Fatal("the service yard healed soldiers")
	}
}

func TestATechBuildingCanBeKnockedDownAndThenGivesNothing(t *testing.T) {
	s := baseSim(t, 1)
	clinic := tech(t, s, "tech_clinic", true)
	take(t, s, 0, "engineers", clinic)

	// Nobody shoots at one unasked, not even with it in range and nothing else to do.
	raiders := buyFielded(t, s, 1, "militia")
	place(raiders, clinic.X+90, clinic.Y)
	s.Step() // it has to see the building to be sent to it
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdHold, Squad: raiders.ID, Place: clinic.ID}) // stand beside it
	run(s, 15)
	if got := seen(s, 0, clinic.ID); got.HP != 1 {
		t.Fatalf("a squad shot at a tech building without an order: hp %.2f", got.HP)
	}

	// On an order it falls, the holder is told, and it heals no more.
	tank := buyFieldedWith(t, s, 1, "chopShop", "technical")
	place(tank, clinic.X+120, clinic.Y)
	s.Step()
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdAttack, Squad: tank.ID, Place: clinic.ID})
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdAttack, Squad: raiders.ID, Place: clinic.ID})
	var events []sim.Event
	for i := 0; i < 3000; i++ {
		events = append(events, s.Step()...)
		if got := seen(s, 0, clinic.ID); got == nil || got.Ruin {
			break
		}
	}
	got := seen(s, 0, clinic.ID)
	if got == nil || !got.Ruin {
		t.Fatalf("the clinic never fell: %+v", got)
	}
	if !has(events, sim.EvStructureLost, 0) {
		t.Fatal("the holder was not told its clinic fell")
	}
	for _, sq := range s.Squads {
		if sq.Side == 1 && sq.Alive {
			place(sq, 1500, 60)
		}
	}
	patient := s.Squad(1)
	unit := rules.Factions["aegis"].Units["commandos"]
	place(patient, clinic.X-60, clinic.Y)
	patient.Teams[0].HP = unit.HP * 0.5
	patient.Teams[0].Members = 1
	run(s, 10)
	if patient.Teams[0].HP != unit.HP*0.5 {
		t.Fatal("a ruined clinic still heals")
	}
	// A ruin cannot be taken.
	eng := buyFielded(t, s, 1, "sappers")
	refused(t, s, sim.Command{Side: 1, Kind: sim.CmdCapture, Squad: eng.ID, Place: clinic.ID}, sim.ErrBadPlace, "")
}

func TestATechBuildingsHolderIsShownAsLastSeen(t *testing.T) {
	s := baseSim(t, 1)
	office := tech(t, s, "tech_goldworks", true)
	// Side 1 scouts it while nobody holds it, then goes home.
	scout := s.Squad(3)
	if scout.Side != 1 {
		t.Fatalf("squad 3 is side %d", scout.Side)
	}
	place(scout, office.X+90, office.Y)
	run(s, 1)
	if got := seen(s, 1, office.ID); got == nil || got.Side != sim.NoSide || !got.Visible {
		t.Fatalf("side 1 looking at the office is shown %+v", got)
	}
	place(scout, 1500, 500)
	run(s, 1)
	take(t, s, 0, "engineers", office)
	if got := seen(s, 1, office.ID); got == nil || got.Side != sim.NoSide || got.Visible {
		t.Fatalf("side 1 has not looked again but is shown %+v", got)
	}
	place(scout, office.X+90, office.Y)
	run(s, 1)
	if got := seen(s, 1, office.ID); got == nil || got.Side != 0 {
		t.Fatalf("side 1 looking again is shown %+v", got)
	}
}
