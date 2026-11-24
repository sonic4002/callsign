package sim_test

import (
	"math"
	"testing"

	"callsign/server/sim"
	"callsign/shared"
)

// openSim is a match some way into its opening, with gold to build: the headquarters, a
// refinery and a barracks stand, and no power structure yet.
func openSim(t *testing.T, gold int) *sim.Sim {
	t.Helper()
	s, err := sim.New(rules, sim.Config{Seed: 1, Factions: [2]string{"aegis", "ashfall"}, Base: []string{"refinery", "barracks"}, StartGold: gold})
	if err != nil {
		t.Fatal(err)
	}
	s.Step()
	return s
}

// build starts a structure and waits until it stands.
func build(t *testing.T, s *sim.Sim, side int, structure string) (seconds float64) {
	t.Helper()
	if _, err := s.Apply(sim.Command{Side: side, Kind: sim.CmdBuild, Structure: structure}); err != nil {
		t.Fatalf("building %s: %v", structure, err)
	}
	role := structure
	if def, ok := rules.Factions[s.Sides[side].Faction].Structures[structure]; ok {
		role = def.Role
	}
	start := s.Tick
	for i := 0; i < 2000; i++ {
		s.Step()
		done := true
		for _, st := range s.Snapshot(side).Structures {
			if st.Side == side && st.Role == role && st.Building < 1 {
				done = false
			}
		}
		if done {
			break
		}
	}
	seconds = float64(s.Tick-start) / float64(rules.TickRate)
	s.Step() // the side's power is reckoned at the start of a tick
	return seconds
}

func countEvents(events []sim.Event, kind string, side int) int {
	n := 0
	for _, e := range events {
		if e.Kind == kind && e.Side == side {
			n++
		}
	}
	return n
}

// structureOf returns a side's own structure of a role as the simulation holds it.
func structureOf(s *sim.Sim, side int, role string) *sim.Structure {
	for _, st := range s.Structures {
		if st.Side == side && !st.Ruin && st.Def().Role == role {
			return st
		}
	}
	return nil
}

func TestTheHeadquartersPowersTheOpeningAndNoMore(t *testing.T) {
	s := openSim(t, 5000)
	hq := rules.Factions["aegis"].Structures["commandPost"].Power
	refinery, barracks := rules.Factions["aegis"].Structures["refinery"], rules.Factions["aegis"].Structures["barracks"]
	if hq < -(refinery.Power + barracks.Power) {
		t.Fatalf("the headquarters supplies %v, less than a refinery and a barracks use", hq)
	}
	if p := s.Snapshot(0).Power; p.Supply != int(hq) || p.Use != int(-(refinery.Power+barracks.Power)) || p.Low {
		t.Fatalf("power at the start: %+v", p)
	}

	// The works takes the side past what the headquarters supplies: said once.
	var events []sim.Event
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "works"}); err != nil {
		t.Fatal(err)
	}
	events = append(events, run(s, rules.Factions["aegis"].Structures["vehicleWorks"].BuildSeconds+3)...)
	if p := s.Snapshot(0).Power; !p.Low || p.Use <= p.Supply {
		t.Fatalf("with a works and no power structure the side should be short: %+v", p)
	}
	if n := countEvents(events, sim.EvLowPower, 0); n != 1 {
		t.Fatalf("low power was said %d times, want once", n)
	}
	if countEvents(events, sim.EvLowPower, 1) != 0 || s.Snapshot(1).Power.Low {
		t.Fatal("the other side heard of it, or is short of power itself")
	}

	// Short of power, a structure goes up at the share of the usual speed the rules give.
	plant := rules.Factions["aegis"].Structures["powerPlant"]
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "power"}); err != nil {
		t.Fatal(err)
	}
	start := s.Tick
	for i := 0; i < 1000 && !s.Has(0, shared.RolePower); i++ {
		events = append(events, s.Step()...)
	}
	took := float64(s.Tick-start) / float64(rules.TickRate)
	if want := plant.BuildSeconds / rules.Match.LowPowerFactor; math.Abs(took-want) > 0.3 {
		t.Fatalf("on low power the plant took %.1f s, want about %.1f", took, want)
	}
	events = append(events, run(s, 1)...)
	if p := s.Snapshot(0).Power; p.Low || p.Supply != int(hq+plant.Power) {
		t.Fatalf("with a power plant: %+v", p)
	}
	if n := countEvents(events, sim.EvPowerRestored, 0); n != 1 {
		t.Fatalf("power restored was said %d times, want once", n)
	}
	// With power, the next one goes up at the usual speed.
	radar := rules.Factions["aegis"].Structures["radar"]
	if took := build(t, s, 0, "radar"); math.Abs(took-radar.BuildSeconds) > 0.3 {
		t.Fatalf("with power the radar took %.1f s, want %.1f", took, radar.BuildSeconds)
	}
}

func TestLowPowerHalvesDeployment(t *testing.T) {
	s := openSim(t, 5000)
	u := rules.Factions["aegis"].Units["commandos"]
	usual := fielded(s, must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "commandos"}))
	_ = usual
	start := s.Tick
	sq := must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "commandos"})
	fielded(s, sq)
	if took := float64(s.Tick-start) / float64(rules.TickRate); math.Abs(took-u.DeploySeconds) > 0.2 {
		t.Fatalf("with power a squad deployed in %.1f s, want %.1f", took, u.DeploySeconds)
	}
	build(t, s, 0, "works") // now the side is short of power
	if !s.LowPower(0) {
		t.Fatal("the side should be short of power")
	}
	start = s.Tick
	fielded(s, must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "commandos"}))
	if took, want := float64(s.Tick-start)/float64(rules.TickRate), u.DeploySeconds/rules.Match.LowPowerFactor; math.Abs(took-want) > 0.3 {
		t.Fatalf("on low power a squad deployed in %.1f s, want about %.1f", took, want)
	}
}

func TestAPoweredDefenceStopsOnLowPowerAndResumes(t *testing.T) {
	s := newSim(t, 1) // a full base: power to spare
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "sentryGun", Place: "base:front"}); err != nil {
		t.Fatal(err)
	}
	gun := own(s, 0, shared.RoleDefence)
	for _, sq := range s.Squads {
		if sq.Side == 0 {
			place(sq, 100, 60) // the gun is alone
		}
	}
	run(s, rules.Factions["aegis"].Structures["sentryGun"].BuildSeconds+1)
	if s.LowPower(0) {
		t.Fatalf("a full base with one gun should have power: %+v", s.Snapshot(0).Power)
	}
	target := s.Squad(3)
	hits := func(seconds float64) int {
		place(target, gun.X+200, gun.Y)
		for i := range target.Teams {
			target.Teams[i].Members, target.Teams[i].HP = 3, 1e6 // it can be hit for ever
		}
		before := target.Teams[0].HP + target.Teams[1].HP + target.Teams[2].HP + target.Teams[3].HP
		run(s, seconds)
		after := target.Teams[0].HP + target.Teams[1].HP + target.Teams[2].HP + target.Teams[3].HP
		return int(before - after)
	}
	if hits(8) == 0 {
		t.Fatal("with power the gun never hurt the squad in front of it")
	}
	// The power structure is sold: the side is short, and the gun falls silent.
	plant := structureOf(s, 0, shared.RolePower)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdSell, Place: plant.PlaceID()})
	events := run(s, 1)
	if !has(events, sim.EvLowPower, 0) || !s.LowPower(0) {
		t.Fatalf("without its power plant the side should be short: %+v", s.Snapshot(0).Power)
	}
	if n := hits(8); n != 0 {
		t.Fatalf("on low power the gun still did %d damage", n)
	}
	// Both sides are shown it standing dark: its owner, and the enemy that has it in sight.
	for side := 0; side < 2; side++ {
		if st := seen(s, side, gun.ID); st == nil || !st.Dark {
			t.Fatalf("side %d should be shown the gun dark: %+v", side, st)
		}
	}
	if st := own(s, 0, shared.RolePower); st != nil && st.Dark {
		t.Fatal("a structure that supplies power is never dark")
	}
	// Power back, it fires again.
	wealth(s, 0, 200)
	build(t, s, 0, "power")
	if s.LowPower(0) {
		t.Fatalf("with a new power plant: %+v", s.Snapshot(0).Power)
	}
	if hits(8) == 0 {
		t.Fatal("with power back the gun stayed silent")
	}
}

func TestTheRadarNeedsItsStructureAndPower(t *testing.T) {
	s := openSim(t, 5000)
	if s.Snapshot(0).Radar {
		t.Fatal("a side with no radar structure has its mini map")
	}
	if !s.Snapshot(sim.Spectator).Radar {
		t.Fatal("a spectator sees everything")
	}
	// The airbase needs the radar, the radar needs the works.
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "radar"}, sim.ErrNeedsStructure, "Vehicle Works")
	build(t, s, 0, "power")
	build(t, s, 0, "works")
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "airbase"}, sim.ErrNeedsStructure, "Radar Station")
	build(t, s, 0, "radar")
	if !s.Snapshot(0).Radar || s.Snapshot(1).Radar {
		t.Fatal("the radar stands and has power: its side, and only its side, has the mini map")
	}
	build(t, s, 0, "airbase")
	// Short of power the radar stops, and comes back with power.
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdSell, Place: structureOf(s, 0, shared.RolePower).PlaceID()})
	run(s, 1)
	if s.Snapshot(0).Radar {
		t.Fatalf("on low power the radar still works: %+v", s.Snapshot(0).Power)
	}
	build(t, s, 0, "power")
	run(s, 1)
	if !s.Snapshot(0).Radar {
		t.Fatal("with power back the radar stays dark")
	}
	// Lost for good when the structure falls.
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdSell, Place: structureOf(s, 0, shared.RoleRadar).PlaceID()})
	if run(s, 1); s.Snapshot(0).Radar {
		t.Fatal("the radar structure is gone and the mini map is still on")
	}
}

func TestAUnitMayNeedMoreThanTheStructureThatMakesIt(t *testing.T) {
	r := shared.MustLoad()
	f := r.Factions["aegis"]
	u := f.Units["commandos"]
	u.Needs = []string{shared.RoleRadar} // as a hero would
	f.Units["commandos"] = u
	s, err := sim.New(r, sim.Config{Seed: 1, Factions: [2]string{"aegis", "ashfall"}, Base: []string{"power", "refinery", "barracks", "works"}, StartGold: 5000})
	if err != nil {
		t.Fatal(err)
	}
	s.Step()
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "commandos"}); err == nil || !contains(err.Error(), "Radar Station") {
		t.Fatalf("a unit that needs the radar was bought without it: %v", err)
	}
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "radar"}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 400 && !s.Has(0, shared.RoleRadar); i++ {
		s.Step()
	}
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "commandos"}); err != nil {
		t.Fatalf("with the radar standing: %v", err)
	}
}

func contains(s, part string) bool {
	for i := 0; i+len(part) <= len(s); i++ {
		if s[i:i+len(part)] == part {
			return true
		}
	}
	return false
}

func TestSellingGivesHalfBackAndTakesTheUnlocks(t *testing.T) {
	s := newSim(t, 1)
	works := structureOf(s, 0, shared.RoleWorks)
	cost := works.Def().Cost
	before := s.Gold(0)
	x, y := works.X, works.Y
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdSell, Place: works.PlaceID()}); err != nil {
		t.Fatal(err)
	}
	if got, want := s.Gold(0)-before, int(math.Round(float64(cost)*rules.Match.SellShare)); got != want {
		t.Fatalf("selling a works that cost %d gave %d gold, want %d", cost, got, want)
	}
	events := run(s, 0.2)
	if !has(events, sim.EvStructureSold, 0) || has(events, sim.EvStructureSold, 1) {
		t.Fatal("the seller, and only the seller, should hear of the sale")
	}
	if own(s, 0, shared.RoleWorks) != nil || seen(s, 0, works.PlaceID()) != nil {
		t.Fatal("a sold structure leaves nothing behind")
	}
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "tank"}, sim.ErrNeedsStructure, "Vehicle Works")
	// What cannot be sold: the headquarters, the enemy's, the same thing twice.
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdSell, Place: "A"}, sim.ErrNotYours, "")
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdSell, Place: structureOf(s, 1, shared.RoleWorks).PlaceID()}, sim.ErrBadPlace, "") // never seen
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdSell, Place: works.PlaceID()}, sim.ErrBadPlace, "")
	// The ground is free again.
	wealth(s, 0, cost)
	build(t, s, 0, "works")
	if st := structureOf(s, 0, shared.RoleWorks); st == nil || st.X != x || st.Y != y {
		t.Fatalf("the new works should stand where the sold one did: %+v", st)
	}
}

func TestRepairCostsGoldInProportionAndStopsWhenWhole(t *testing.T) {
	s := newSim(t, 1)
	works := structureOf(s, 0, shared.RoleWorks)
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdRepair, Place: works.PlaceID()}, sim.ErrNotDamaged, "")
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdRepair, Place: structureOf(s, 1, shared.RoleWorks).PlaceID()}, sim.ErrBadPlace, "") // never seen
	wealth(s, 0, 600)
	works.HP = works.Def().HP / 2
	want := s.RepairCost(works)
	if exact := float64(works.Def().Cost) * rules.Match.RepairCostShare / 2; math.Abs(float64(want)-exact) > 1 {
		t.Fatalf("half a works costs %d to mend, want about %.0f", want, exact)
	}
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdRepair, Place: works.PlaceID()})
	if st := seen(s, 0, works.PlaceID()); st == nil || !st.Repairing {
		t.Fatalf("the works should show as being mended: %+v", st)
	}
	// Income goes on while the mending is paid for; it is taken out of the reckoning.
	gold, start := s.Gold(0), s.Tick
	var events []sim.Event
	for i := 0; i < 600 && works.Repairing; i++ {
		events = append(events, s.Step()...)
	}
	seconds := float64(s.Tick-start) / float64(rules.TickRate)
	paid := gold + int(seconds*float64(rules.Match.HQTrickle)) - s.Gold(0)
	if works.HP != works.Def().HP || !has(events, sim.EvStructureRepaired, 0) {
		t.Fatalf("the works should be whole again: %v of %v", works.HP, works.Def().HP)
	}
	if math.Abs(float64(paid-want)) > 12 { // the haulers' gold comes in lumps
		t.Fatalf("mending took %d gold, want about %d", paid, want)
	}
	if wantSeconds := 0.5 / rules.Match.RepairPerSecond; math.Abs(seconds-wantSeconds) > 0.5 {
		t.Fatalf("mending half a structure took %.1f s, want about %.1f", seconds, wantSeconds)
	}
	if st := seen(s, 0, works.PlaceID()); st.Repairing || st.HP != 1 {
		t.Fatalf("after the mending: %+v", st)
	}
}

func TestRepairStopsWhenTheGoldRunsOut(t *testing.T) {
	// No haulers and nothing in the bank: the trickle cannot pay for three at once.
	s, err := sim.New(rules, sim.Config{Seed: 1, Factions: [2]string{"aegis", "ashfall"}, Base: []string{"power", "barracks", "works", "radar"}, StartGold: 5})
	if err != nil {
		t.Fatal(err)
	}
	s.Step()
	var rate float64
	for _, role := range []string{shared.RoleBarracks, shared.RoleWorks, shared.RoleRadar} {
		st := structureOf(s, 0, role)
		st.HP = 1
		rate += float64(st.Def().Cost) * rules.Match.RepairCostShare * rules.Match.RepairPerSecond
		must(t, s, sim.Command{Side: 0, Kind: sim.CmdRepair, Place: st.PlaceID()})
	}
	if rate <= float64(rules.Match.HQTrickle) {
		t.Skipf("three repairs cost %.1f gold a second, no more than the trickle", rate)
	}
	events := run(s, 20)
	stopped := false
	for _, e := range events {
		stopped = stopped || (e.Kind == sim.EvRepairStopped && e.Side == 0 && e.Reason == "gold")
	}
	if !stopped {
		t.Fatal("with no gold left a repair should stop and say why")
	}
	if s.Gold(0) < 0 {
		t.Fatalf("mending took the side into debt: %d", s.Gold(0))
	}
}

func TestEngineersMendTheirOwnStructureAndAreUsedUp(t *testing.T) {
	s := newSim(t, 1)
	works := structureOf(s, 0, shared.RoleWorks)
	engineers := buyFielded(t, s, 0, "engineers")
	commandos := s.Squad(1)
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdRepair, Squad: engineers.ID, Place: works.PlaceID()}, sim.ErrNotDamaged, "")
	works.HP = works.Def().HP * 0.2
	refused(t, s, sim.Command{Side: 0, Kind: sim.CmdRepair, Squad: commandos.ID, Place: works.PlaceID()}, sim.ErrNotEngineers, "")
	place(engineers, works.X+works.Def().Footprint+30, works.Y)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdRepair, Squad: engineers.ID, Place: works.PlaceID()})
	gold := s.Gold(0)
	var events []sim.Event
	for i := 0; i < 600 && engineers.Alive; i++ {
		events = append(events, s.Step()...)
	}
	if engineers.Alive || works.HP != works.Def().HP {
		t.Fatalf("the engineers should have gone in and made the works whole: alive=%v hp=%v", engineers.Alive, works.HP)
	}
	if !has(events, sim.EvStructureRepaired, 0) {
		t.Fatal("the owner should hear that the works is whole")
	}
	if s.Gold(0) < gold {
		t.Fatal("engineers mend for nothing")
	}
}

// Every defence outranges every weapon it can hit back at, except the siege unit each
// army has for breaking defences. Without this, riflemen shot a gun down from beyond
// its reach.
func TestOnlySiegeUnitsOutrangeDefences(t *testing.T) {
	reach := func(u shared.Unit) float64 { return math.Max(u.Range, u.SiegeRange) }
	for owner, f := range rules.Factions {
		for id, d := range f.Structures {
			if d.Role != shared.RoleDefence {
				continue
			}
			if d.Sight < d.Range {
				t.Errorf("%s sees %v and reaches %v: it cannot use its range", id, d.Sight, d.Range)
			}
			if d.Power >= 0 {
				t.Errorf("%s uses no power: every defence is a powered one", id)
			}
			for enemy, e := range rules.Factions {
				if enemy == owner {
					continue
				}
				siege := false
				for uid, u := range e.Units {
					if d.Against(u.Class) == 0 || u.Against(shared.TargetStructure) == 0 {
						continue // it cannot hit this unit, or this unit cannot hurt it
					}
					if u.Siege && reach(u) > d.Range {
						siege = true
						continue
					}
					if reach(u) > d.Range {
						t.Errorf("%s (%s) reaches %v, farther than the %s's %v, and is no siege unit", uid, enemy, reach(u), id, d.Range)
					}
				}
				ground := d.Against("infantry") > 0 || d.Against("vehicle") > 0
				if ground && !siege {
					t.Errorf("%s has no siege unit that outranges the %s (%v)", enemy, id, d.Range)
				}
			}
		}
	}
}

func TestASiegeUnitBreaksADefenceFromBeyondItsReach(t *testing.T) {
	s := newSim(t, 1)
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "sentryGun", Place: "base:front"}); err != nil {
		t.Fatal(err)
	}
	run(s, rules.Factions["aegis"].Structures["sentryGun"].BuildSeconds+1)
	gun := structureOf(s, 0, shared.RoleDefence)
	for _, sq := range s.Squads {
		place(sq, 100, 60) // nobody else is about
	}
	rockets := buyFielded(t, s, 1, "rpgTeam")
	u := rules.Factions["ashfall"].Units["rpgTeam"]
	place(rockets, gun.X+gun.Def().Range+25, gun.Y) // beyond the gun, inside the rockets' siege range
	place(s.Squad(3), gun.X+255, gun.Y+40)          // a spotter: the rockets reach farther than they see
	if gun.Def().Range+25+18 > u.SiegeRange {
		t.Fatalf("the rocket team's siege range %v leaves no room beyond the gun's %v", u.SiegeRange, gun.Def().Range)
	}
	s.Step()
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdAttack, Squad: rockets.ID, Place: gun.PlaceID()})
	for i := 0; i < 1500 && !gun.Ruin; i++ {
		s.Step()
	}
	if !gun.Ruin {
		t.Fatalf("the rocket team never brought the gun down: %v of %v left", gun.HP, gun.Def().HP)
	}
	if alive, full := rockets.Strength(); alive != full {
		t.Fatalf("the gun hit a squad beyond its reach: %d of %d left", alive, full)
	}
	// An enemy structure a side has seen is still not its own to sell or mend.
	refused(t, s, sim.Command{Side: 1, Kind: sim.CmdSell, Place: gun.PlaceID()}, sim.ErrNotYours, "")
	// Riflemen at the same distance can do nothing to a gun.
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "sentryGun", Place: "base:front"}); err != nil {
		t.Fatal(err)
	}
	run(s, rules.Factions["aegis"].Structures["sentryGun"].BuildSeconds+1)
	gun = structureOf(s, 0, shared.RoleDefence)
	if rules.Factions["ashfall"].Units["militia"].Range >= gun.Def().Range {
		t.Fatal("riflemen reach as far as the gun")
	}
}

func TestTheOpeningIsBuiltInTheRulesOrderWithPowerWhenNeeded(t *testing.T) {
	s, err := sim.New(rules, sim.Config{Seed: 1, Factions: [2]string{"aegis", "ashfall"}, StartGold: 20000})
	if err != nil {
		t.Fatal(err)
	}
	s.Step()
	var got []string
	for i := 0; i < 12; i++ {
		role := s.NextInOpening(0)
		if role == "" {
			break
		}
		got = append(got, role)
		build(t, s, 0, role)
		if s.LowPower(0) {
			t.Fatalf("building by the opening ran the side short of power after %v: %+v", got, s.Snapshot(0).Power)
		}
	}
	want := rules.Match.Opening
	if len(got) < len(want) {
		t.Fatalf("the opening built %v, want at least %v", got, want)
	}
	for i, role := range want {
		if got[i] != role {
			t.Fatalf("the opening built %v, want it to begin %v", got, want)
		}
	}
}
