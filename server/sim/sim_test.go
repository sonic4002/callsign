package sim_test

import (
	"errors"
	"math"
	"testing"

	"callsign/server/bot"
	"callsign/server/sim"
	"callsign/shared"
)

var rules = shared.MustLoad()

func newSim(t *testing.T, seed uint64) *sim.Sim {
	t.Helper()
	s, err := sim.New(rules, sim.Config{Seed: seed, Factions: [2]string{"aegis", "ashfall"}})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func must(t *testing.T, s *sim.Sim, c sim.Command) *sim.Squad {
	t.Helper()
	sq, err := s.Apply(c)
	if err != nil {
		t.Fatalf("%+v: %v", c, err)
	}
	return sq
}

// fielded steps the match until a bought squad has reached the field.
func fielded(s *sim.Sim, sq *sim.Squad) *sim.Squad {
	for sq.Deploying() && !s.Over {
		s.Step()
	}
	return sq
}

// run steps the match for a number of seconds and returns every event.
func run(s *sim.Sim, seconds float64) []sim.Event {
	var all []sim.Event
	for i := 0; i < int(seconds*float64(rules.TickRate)); i++ {
		all = append(all, s.Step()...)
	}
	return all
}

func has(events []sim.Event, kind string, side int) bool {
	for _, e := range events {
		if e.Kind == kind && e.Side == side {
			return true
		}
	}
	return false
}

func owner(s *sim.Sim, id string) int {
	for _, p := range s.Points {
		if p.ID == id {
			return p.Owner
		}
	}
	return -2
}

// playMatch runs a whole match between two scripted players and checks the rules hold
// on every tick. It returns the state hash sampled once a second.
func playMatch(t *testing.T, seed uint64, styles [2]string) (*sim.Sim, []uint64) {
	t.Helper()
	s := newSim(t, seed)
	players := [2]*bot.Player{
		{Side: 0, Style: styles[0], R: rules},
		{Side: 1, Style: styles[1], R: rules},
	}
	var trace []uint64
	for !s.Over {
		if s.Tick > s.LengthTicks() {
			t.Fatalf("seed %d: match ran past its timer", seed)
		}
		if s.Tick%rules.TickRate == 0 {
			for _, p := range players {
				for _, c := range p.Act(s.Snapshot(p.Side)) {
					if _, err := s.Apply(c); err != nil {
						t.Fatalf("seed %d tick %d: scripted command %+v refused: %v", seed, s.Tick, c, err)
					}
				}
			}
			trace = append(trace, s.Hash())
		}
		s.Step()
		checkInvariants(t, s)
	}
	return s, append(trace, s.Hash())
}

func checkInvariants(t *testing.T, s *sim.Sim) {
	t.Helper()
	alive := [2]int{}
	for side := 0; side < 2; side++ {
		if s.Gold(side) < 0 {
			t.Fatalf("tick %d: side %d has negative gold", s.Tick, side)
		}
	}
	for _, sq := range s.Squads {
		if !sq.Alive {
			continue
		}
		alive[sq.Side]++
		domain := rules.Factions[s.Sides[sq.Side].Faction].Units[sq.Unit].Domain
		for _, tm := range sq.Teams {
			if tm.Members == 0 {
				continue
			}
			if math.IsNaN(tm.X) || math.IsNaN(tm.Y) || tm.X < 0 || tm.X > rules.Map.Width || tm.Y < 0 || tm.Y > rules.Map.Height {
				t.Fatalf("tick %d: squad %d left the map at %.1f,%.1f", s.Tick, sq.ID, tm.X, tm.Y)
			}
			if domain != "air" && (tm.Y >= rules.Map.WaterY) != (domain == "sea") {
				t.Fatalf("tick %d: squad %d (%s) is in the wrong domain at y=%.1f", s.Tick, sq.ID, sq.Unit, tm.Y)
			}
			if tm.Stress < 0 || tm.Stress > 1 || tm.HP <= 0 {
				t.Fatalf("tick %d: squad %d team has stress %.2f hp %.1f", s.Tick, sq.ID, tm.Stress, tm.HP)
			}
		}
	}
	for side, n := range alive {
		if n > rules.Match.PopulationCap {
			t.Fatalf("tick %d: side %d has %d squads, over the cap", s.Tick, side, n)
		}
	}
}

func TestFullMatchesBetweenScriptedPlayers(t *testing.T) {
	pairs := [][2]string{{bot.Standard, bot.Standard}, {bot.Standard, bot.Rush}, {bot.Rush, bot.Standard}}
	wins := map[int]int{}
	for seed := uint64(1); seed <= 4; seed++ {
		for _, styles := range pairs {
			s, _ := playMatch(t, seed, styles)
			if !s.Over || (s.Reason != "timer" && s.Reason != "hq_destroyed") {
				t.Fatalf("seed %d %v: match did not finish properly: over=%v reason=%q", seed, styles, s.Over, s.Reason)
			}
			wins[s.Winner]++
			t.Logf("seed %d %-8s vs %-8s: winner %2d by %-12s at %3ds, points %d–%d, gold %d–%d",
				seed, styles[0], styles[1], s.Winner, s.Reason, s.Tick/rules.TickRate,
				s.PointsHeld(0), s.PointsHeld(1), s.Gold(0), s.Gold(1))
		}
	}
	t.Logf("wins by side: %v", wins)
}

func TestSameSeedSameMatch(t *testing.T) {
	styles := [2]string{bot.Standard, bot.Rush}
	_, a := playMatch(t, 7, styles)
	_, b := playMatch(t, 7, styles)
	if len(a) != len(b) {
		t.Fatalf("same seed gave matches of different length: %d and %d seconds", len(a), len(b))
	}
	for i := range a {
		if a[i] != b[i] {
			t.Fatalf("same seed diverged at second %d", i)
		}
	}
	_, c := playMatch(t, 8, styles)
	if a[len(a)-1] == c[len(c)-1] {
		t.Fatal("a different seed gave the identical match; the seed is not reaching combat")
	}
}

func TestHQWellPaysGold(t *testing.T) {
	s := newSim(t, 1)
	run(s, 10)
	want := rules.Match.StartGold + 10*rules.Rigs["hq"].Income
	if s.Gold(0) != want || s.Gold(1) != want {
		t.Fatalf("gold after 10s = %d and %d, want %d", s.Gold(0), s.Gold(1), want)
	}
}

func TestInfantryCapturesLandRig(t *testing.T) {
	s := newSim(t, 1)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: 1, Point: "B"})
	events := run(s, 40)
	if owner(s, "B") != 0 {
		t.Fatalf("Bravo owner = %d, want side 0", owner(s, "B"))
	}
	if !has(events, sim.EvArrived, 0) || !has(events, sim.EvCaptured, 0) {
		t.Fatalf("missing arrived or captured event in %+v", events)
	}
	if got, want := s.Income(0), rules.Rigs["hq"].Income+rules.Rigs["landRig"].Income; got != want {
		t.Fatalf("income = %d, want %d", got, want)
	}
}

func TestSeaRigNeedsANavalSquad(t *testing.T) {
	s := newSim(t, 1)
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdHold, Squad: 1, Point: "S"}); !errors.Is(err, sim.ErrUnreachable) {
		t.Fatalf("infantry to the sea rig: err = %v, want ErrUnreachable", err)
	}
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "tank"}); err != nil {
		t.Fatalf("buying a tank with %d gold: %v", s.Gold(0), err)
	}
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "patrolBoat"}); !errors.Is(err, sim.ErrNoGold) {
		t.Fatalf("second purchase: err = %v, want ErrNoGold", err)
	}
	run(s, 25)
	boat := fielded(s, must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "patrolBoat"}))
	if cs := s.Callsign(boat); cs.En != "Shark 1" || cs.He != "כריש 1" {
		t.Fatalf("boat callsign = %+v", cs)
	}
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdHold, Squad: boat.ID, Point: "F"}); !errors.Is(err, sim.ErrUnreachable) {
		t.Fatalf("boat to the town: err = %v, want ErrUnreachable", err)
	}
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: boat.ID, Point: "S"})
	run(s, 40)
	if owner(s, "S") != 0 {
		t.Fatalf("Sierra owner = %d, want side 0", owner(s, "S"))
	}
}

func TestCommandsAreChecked(t *testing.T) {
	s := newSim(t, 1)
	cases := []struct {
		c    sim.Command
		want error
	}{
		{sim.Command{Side: 0, Kind: sim.CmdMove, Squad: 3, Point: "F"}, sim.ErrNoSquad}, // squad 3 is the enemy's
		{sim.Command{Side: 0, Kind: sim.CmdMove, Squad: 1, Point: "Q"}, sim.ErrNoPoint},
		{sim.Command{Side: 0, Kind: sim.CmdMove, Squad: 1}, sim.ErrNoPoint},
		{sim.Command{Side: 0, Kind: sim.CmdAttack, Squad: 1, Contact: 3}, sim.ErrNoContact}, // not in sight
		{sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "militia"}, sim.ErrNoUnit},            // other faction's unit
		{sim.Command{Side: 0, Kind: sim.CmdUpgrade, Squad: 3}, sim.ErrNoSquad},
		{sim.Command{Side: 0, Kind: "nuke"}, sim.ErrBadCommand},
	}
	for _, tc := range cases {
		if _, err := s.Apply(tc.c); !errors.Is(err, tc.want) {
			t.Errorf("%+v: err = %v, want %v", tc.c, err, tc.want)
		}
	}
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdUpgrade, Squad: 1})
	if s.Squad(1).Tier != 2 || s.Gold(0) != 0 {
		t.Fatalf("after upgrade: tier %d gold %d, want tier 2 gold 0", s.Squad(1).Tier, s.Gold(0))
	}
}

func TestPopulationCap(t *testing.T) {
	s := newSim(t, 1)
	run(s, 200) // HQ well alone: plenty of gold
	for i := 2; i < rules.Match.PopulationCap; i++ {
		must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "commandos"})
	}
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "commandos"}); !errors.Is(err, sim.ErrPopCap) {
		t.Fatalf("buy past the cap: err = %v, want ErrPopCap", err)
	}
}

func TestFogHidesTheEnemyUntilContact(t *testing.T) {
	s := newSim(t, 1)
	s.Step()
	if n := len(s.Snapshot(0).Contacts); n != 0 {
		t.Fatalf("side 0 sees %d contacts across the map at the start", n)
	}
	if n := len(s.Snapshot(sim.Spectator).Squads); n != 4 {
		t.Fatalf("spectator sees %d squads, want 4", n)
	}
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: 1, Point: "F"})
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdHold, Squad: 3, Point: "F"})
	events := run(s, 30)
	if !has(events, sim.EvContact, 0) || !has(events, sim.EvContact, 1) {
		t.Fatal("two squads met at Foxtrot and neither side got a contact event")
	}
	for _, e := range events {
		if e.Kind == sim.EvContact && e.Side == 0 && e.Contact != 3 {
			t.Fatalf("side 0 contact names squad %d, want 3", e.Contact)
		}
	}
}

// Nerve has to be readable from behaviour alone: a pinned team stops firing and stops
// advancing, and a team left in peace steadies again.
func TestNerveShowsInBehaviour(t *testing.T) {
	s := newSim(t, 3)
	for _, id := range []int{1, 2} {
		must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: id, Point: "F"})
	}
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdAttack, Squad: 3, Point: "F"})

	sawShaken, sawPinned, sawPinnedEvent := false, false, false
	for i := 0; i < 120*rules.TickRate && s.Squad(3) != nil; i++ {
		// Teams act on the nerve they had when the tick began.
		pinned := map[*sim.Team]bool{}
		for _, sq := range s.Squads {
			for j := range sq.Teams {
				tm := &sq.Teams[j]
				if tm.Members == 0 {
					continue
				}
				switch s.Nerve(tm) {
				case sim.Shaken:
					sawShaken = true
				case sim.Pinned:
					sawPinned, pinned[tm] = true, true
				}
			}
		}
		for _, e := range s.Step() {
			sawPinnedEvent = sawPinnedEvent || e.Kind == sim.EvPinned
		}
		for tm := range pinned {
			if tm.Action == sim.ActFire || tm.Action == sim.ActAdvance {
				t.Fatalf("tick %d: a pinned team chose %q", s.Tick, tm.Action)
			}
		}
	}
	if !sawShaken || !sawPinned || !sawPinnedEvent {
		t.Fatalf("a squad attacking two dug-in squads never broke: shaken=%v pinned=%v event=%v",
			sawShaken, sawPinned, sawPinnedEvent)
	}
	if s.Squad(3) != nil {
		t.Fatal("one militia squad survived two minutes against two commando squads")
	}

	run(s, 40) // the shooting is over
	for _, id := range []int{1, 2} {
		sq := s.Squad(id)
		if sq == nil {
			continue
		}
		for j := range sq.Teams {
			if tm := &sq.Teams[j]; tm.Members > 0 && s.Nerve(tm) != sim.Steady {
				t.Fatalf("squad %d team %d still %s 40s after the fight", id, j, s.Nerve(tm))
			}
		}
	}
}

func TestDestroyingTheHQWins(t *testing.T) {
	s := newSim(t, 1)
	// The defenders are sent off to the far corner; the attackers walk in.
	for _, id := range []int{3, 4} {
		must(t, s, sim.Command{Side: 1, Kind: sim.CmdMove, Squad: id, Point: "K"})
	}
	run(s, 15)
	for _, id := range []int{1, 2} {
		must(t, s, sim.Command{Side: 0, Kind: sim.CmdAttack, Squad: id, Point: "Z"})
	}
	events := run(s, 120)
	if !s.Over || s.Winner != 0 || s.Reason != "hq_destroyed" {
		t.Fatalf("over=%v winner=%d reason=%q hq=%v", s.Over, s.Winner, s.Reason, s.Snapshot(sim.Spectator).HQ)
	}
	if !has(events, sim.EvHQUnderAttack, 1) || !has(events, sim.EvMatchEnd, 0) || !has(events, sim.EvMatchEnd, 1) {
		t.Fatal("missing hq_under_attack or match_end events")
	}
	if s.Step() != nil {
		t.Fatal("the match kept stepping after it ended")
	}
}

// A longer reach buys the first shots, not a free win: troops that are being shot by
// something they cannot hit close the distance instead of standing there.
func TestReachIsNotAFreeWin(t *testing.T) {
	s := newSim(t, 1)
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdHold, Squad: 3, Point: "F"})
	tank := fielded(s, must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "tank"}))
	run(s, 30) // the militia are dug in at Foxtrot before the tanks roll
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdAttack, Squad: tank.ID, Point: "F"})
	run(s, 60)
	full := rules.Factions["aegis"].Units["tank"].HP * 2
	hp := 0.0
	for _, tm := range tank.Teams {
		hp += math.Max(0, tm.HP)
	}
	if hp == full {
		t.Fatalf("tanks outranging the defenders of Foxtrot took no damage in a minute (militia left: %v)", s.Squad(3) != nil)
	}

	// The same at sea, with both squads ordered to hold the rig.
	s = newSim(t, 2)
	boats := [2]*sim.Squad{
		must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "patrolBoat"}),
		must(t, s, sim.Command{Side: 1, Kind: sim.CmdBuy, Unit: "speedboat"}),
	}
	for side, b := range boats {
		fielded(s, b)
		must(t, s, sim.Command{Side: side, Kind: sim.CmdHold, Squad: b.ID, Point: "S"})
	}
	run(s, 45)
	for side, b := range boats {
		alive, fullCrew := b.Strength()
		hurt := alive < fullCrew
		for _, tm := range b.Teams {
			hurt = hurt || (tm.Members > 0 && tm.HP < rules.Factions[s.Sides[side].Faction].Units[b.Unit].HP)
		}
		if !hurt {
			t.Fatalf("side %d's boats fought for the sea rig without taking a hit", side)
		}
	}
}

// Neither faction may run away with the scripted matches, whichever side of the map it
// starts on. Before tuning, Aegis won nine in ten.
func TestFactionsAreRoughlyEven(t *testing.T) {
	const seeds, limit = 8, 0.75
	wins := map[string]int{}
	games := 0
	for _, factions := range [][2]string{{"aegis", "ashfall"}, {"ashfall", "aegis"}} {
		for seed := uint64(1); seed <= seeds; seed++ {
			s, err := sim.New(rules, sim.Config{Seed: seed, Factions: factions})
			if err != nil {
				t.Fatal(err)
			}
			players := [2]*bot.Player{{Side: 0, Style: bot.Standard, R: rules}, {Side: 1, Style: bot.Standard, R: rules}}
			for !s.Over {
				if s.Tick%rules.TickRate == 0 {
					for _, p := range players {
						for _, c := range p.Act(s.Snapshot(p.Side)) {
							if _, err := s.Apply(c); err != nil {
								t.Fatalf("seed %d: scripted command %+v refused: %v", seed, c, err)
							}
						}
					}
				}
				s.Step()
			}
			games++
			if s.Winner != sim.NoSide {
				wins[factions[s.Winner]]++
			}
		}
	}
	t.Logf("%d games: %v", games, wins)
	for faction, n := range wins {
		if share := float64(n) / float64(games); share > limit {
			t.Fatalf("%s won %d of %d scripted matches (%.0f%%), over the %.0f%% limit", faction, n, games, 100*share, 100*limit)
		}
	}
}

// A unit that can be shot from beyond its own sight never learns what is killing it and
// cannot answer, so sight covers every direct-fire enemy weapon. Indirect fire (a weapon
// with a minimum range) may outreach sight: its shot gives it away instead, see
// TestFiringGivesTheShooterAway.
func TestEveryUnitSeesAsFarAsItCanBeShot(t *testing.T) {
	for mine, f := range rules.Factions {
		for theirs, g := range rules.Factions {
			if mine == theirs {
				continue
			}
			for id, u := range f.Units {
				for enemyID, e := range g.Units {
					if e.MinRange == 0 && u.Sight < e.Range {
						t.Errorf("%s %s sees %.0f but %s %s shoots %.0f", mine, id, u.Sight, theirs, enemyID, e.Range)
					}
				}
			}
		}
	}
}

// Buying starts a deployment: the gold is gone and the place under the cap is taken at
// once, the squad reaches the field when its time is up, and not a tick sooner.
func TestBoughtSquadsDeploy(t *testing.T) {
	s := newSim(t, 1)
	tank := rules.Factions["aegis"].Units["tank"]
	ticks := int(tank.DeploySeconds * float64(rules.TickRate))
	gold := s.Gold(0)
	sq := must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "tank"})
	if !sq.Deploying() || sq.Alive || s.Squad(sq.ID) != nil || s.Gold(0) != gold-tank.Cost || s.Population(0) != 3 {
		t.Fatalf("just bought: deploying %v alive %v gold %d population %d", sq.Deploying(), sq.Alive, s.Gold(0), s.Population(0))
	}
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdHold, Squad: sq.ID, Point: "F"}); !errors.Is(err, sim.ErrNoSquad) {
		t.Fatalf("order to a squad still on its way: err = %v, want ErrNoSquad", err)
	}
	snap := s.Snapshot(0)
	if len(snap.Deploying) != 1 || snap.Deploying[0].Callsign.En != "Rhino 1" || snap.Deploying[0].TicksLeft != ticks || snap.Deploying[0].TicksTotal != ticks || len(snap.Squads) != 2 {
		t.Fatalf("snapshot while deploying: %+v, %d squads", snap.Deploying, len(snap.Squads))
	}
	if d := s.Snapshot(1).Deploying; len(d) != 0 {
		t.Fatalf("the enemy is shown our deployment: %+v", d)
	}
	var events []sim.Event
	for i := 0; i < ticks-1; i++ {
		events = append(events, s.Step()...)
	}
	if sq.Alive || s.Snapshot(0).Deploying[0].TicksLeft != 1 {
		t.Fatalf("one tick early: alive %v, %+v", sq.Alive, s.Snapshot(0).Deploying)
	}
	events = append(events, s.Step()...)
	if !sq.Alive || s.Squad(sq.ID) != sq || len(sq.Teams) != tank.Teams || len(s.Snapshot(0).Deploying) != 0 || s.Population(0) != 3 {
		t.Fatalf("on time: alive %v teams %d deploying %+v", sq.Alive, len(sq.Teams), s.Snapshot(0).Deploying)
	}
	started, fielded := -1, -1
	for _, e := range events {
		if e.Squad == sq.ID && e.Kind == sim.EvDeploying {
			started = e.Tick
		}
		if e.Squad == sq.ID && e.Kind == sim.EvSquadSpawned {
			fielded = e.Tick
		}
	}
	if started != 1 || fielded != ticks {
		t.Fatalf("events: deploying at tick %d, spawned at tick %d, want 1 and %d", started, fielded, ticks)
	}
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: sq.ID, Point: "F"})
}

// Squads on their way hold their place under the population cap.
func TestCapCountsDeployingSquads(t *testing.T) {
	s := newSim(t, 1)
	run(s, 200)
	for i := 2; i < rules.Match.PopulationCap; i++ {
		if sq := must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "commandos"}); !sq.Deploying() {
			t.Fatal("a bought squad was fielded at once")
		}
	}
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "commandos"}); !errors.Is(err, sim.ErrPopCap) {
		t.Fatalf("buy past the cap while squads deploy: err = %v, want ErrPopCap", err)
	}
	run(s, 10)
	if n := len(s.Snapshot(0).Squads); n != rules.Match.PopulationCap {
		t.Fatalf("%d squads on the field after deploying, want %d", n, rules.Match.PopulationCap)
	}
}

// Deployments are part of the match state: two runs agree tick by tick, and a run that
// bought a squad differs from one that did not from the moment of the purchase.
func TestDeploymentIsDeterministicAndHashed(t *testing.T) {
	a, b := newSim(t, 7), newSim(t, 7)
	for _, s := range []*sim.Sim{a, b} {
		must(t, s, sim.Command{Side: 1, Kind: sim.CmdBuy, Unit: "militia"})
	}
	for i := 0; i < 80; i++ {
		a.Step()
		b.Step()
		if a.Hash() != b.Hash() {
			t.Fatalf("tick %d: two runs of the same purchase disagree", a.Tick)
		}
	}
	d, e := newSim(t, 7), newSim(t, 7)
	must(t, d, sim.Command{Side: 1, Kind: sim.CmdBuy, Unit: "militia"})
	must(t, e, sim.Command{Side: 1, Kind: sim.CmdBuy, Unit: "militia"})
	d.Step()
	e.Step()
	e.Step()
	d.Step()
	if d.Hash() != e.Hash() {
		t.Fatal("same ticks, different hash")
	}
	d.Step()
	if d.Hash() == e.Hash() {
		t.Fatal("a deployment one tick further along hashes the same")
	}
	// A new match starts with nothing on its way.
	if n := len(newSim(t, 7).Snapshot(1).Deploying); n != 0 {
		t.Fatalf("a new match starts with %d deployments", n)
	}
}

// The enemy a new player meets has to be beatable. A relentless scripted Aegis stands in
// for a competent player here: it must beat the paced styles clearly, and the easier the
// style the more clearly.
func TestPacedEnemiesAreBeatable(t *testing.T) {
	const seeds = 12
	wins := map[string]int{}
	for _, style := range []string{bot.Easy, bot.Normal, bot.Standard} {
		for seed := uint64(1); seed <= seeds; seed++ {
			if s, _ := playMatch(t, seed, [2]string{bot.Standard, style}); s.Winner == 0 {
				wins[style]++
			}
		}
	}
	t.Logf("relentless Aegis won, of %d: %v", seeds, wins)
	if wins[bot.Easy] < seeds*9/10 || wins[bot.Normal] < seeds*3/4 || wins[bot.Easy] < wins[bot.Normal] {
		t.Fatalf("paced enemies are not clearly beatable: %v of %d", wins, seeds)
	}
}

// place moves every team of a squad to one spot, for staging a fight.
func place(sq *sim.Squad, x, y float64) {
	for i := range sq.Teams {
		sq.Teams[i].X, sq.Teams[i].Y = x+float64(i)*6, y
	}
}

func buyFielded(t *testing.T, s *sim.Sim, side int, unit string) *sim.Squad {
	t.Helper()
	cost := rules.Factions[s.Sides[side].Faction].Units[unit].Cost
	for s.Gold(side) < cost { // nobody has orders yet, so waiting for the well changes nothing else
		s.Step()
	}
	return fielded(s, must(t, s, sim.Command{Side: side, Kind: sim.CmdBuy, Unit: unit}))
}

func TestAirUnitsCrossLandAndSea(t *testing.T) {
	s := newSim(t, 1)
	heli := buyFielded(t, s, 0, "helicopter")
	if got := s.Callsign(heli); got.En != "Hawk 1" || got.He != "בז 1" {
		t.Fatalf("callsign = %+v", got)
	}
	// It may be sent to a sea point and to a land point alike, and it gets there.
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdMove, Squad: heli.ID, Point: "S"})
	run(s, 25)
	sierra := rules.PointByID("S")
	if x, y := heli.Center(); math.Hypot(x-sierra.X, y-sierra.Y) > 60 || y < rules.Map.WaterY {
		t.Fatalf("the helicopter is at %.0f,%.0f, not over Sierra", x, y)
	}
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdMove, Squad: heli.ID, Point: "D"})
	// Ground and sea units keep their own element.
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdMove, Squad: 1, Point: "S"}); !errors.Is(err, sim.ErrUnreachable) {
		t.Fatalf("infantry sent to sea: %v", err)
	}
}

func TestHelicopterTakesTheSeaRigAndDronesCannot(t *testing.T) {
	s := newSim(t, 1)
	heli := buyFielded(t, s, 0, "helicopter")
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: heli.ID, Point: "S"})
	run(s, 40)
	if owner(s, "S") != 0 {
		t.Fatalf("Sierra owner = %d after a helicopter held it", owner(s, "S"))
	}

	s = newSim(t, 1)
	drones := buyFielded(t, s, 1, "fpvSwarm")
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdHold, Squad: drones.ID, Point: "S"})
	run(s, 40)
	if owner(s, "S") != sim.NoSide {
		t.Fatalf("Sierra owner = %d: a drone swarm cannot hold ground", owner(s, "S"))
	}
}

// The tank's gun cannot be brought to bear on aircraft; the technical's machine gun can.
func TestWhoCanShootAtAircraft(t *testing.T) {
	duel := func(shooterSide int, shooter string) (heliHP float64) {
		s := newSim(t, 3)
		heli := buyFielded(t, s, 1-shooterSide, map[int]string{0: "helicopter", 1: "fpvSwarm"}[1-shooterSide])
		gun := buyFielded(t, s, shooterSide, shooter)
		place(heli, 800, 300)
		place(gun, 800, 400)
		must(t, s, sim.Command{Side: shooterSide, Kind: sim.CmdHold, Squad: gun.ID})
		must(t, s, sim.Command{Side: 1 - shooterSide, Kind: sim.CmdHold, Squad: heli.ID})
		before := 0.0
		for i := range heli.Teams {
			before += heli.Teams[i].HP
		}
		run(s, 8)
		after := 0.0
		for i := range heli.Teams {
			if heli.Teams[i].Members > 0 {
				after += heli.Teams[i].HP
			}
		}
		return before - after
	}
	if lost := duel(1, "technical"); lost <= 0 {
		t.Fatal("a technical did no damage to a helicopter in range")
	}
	if lost := duel(0, "tank"); lost != 0 {
		t.Fatalf("a tank damaged aircraft (%.0f hp)", lost)
	}
}

// An RPG goes through armor that shrugs off rifle fire, and is poor against infantry.
func TestRPGTeamIsAnAntiArmorWeapon(t *testing.T) {
	rpg := rules.Factions["ashfall"].Units["rpgTeam"]
	militia := rules.Factions["ashfall"].Units["militia"]
	tank := rules.Factions["aegis"].Units["tank"]
	commandos := rules.Factions["aegis"].Units["commandos"]
	perHit := func(u, target shared.Unit) float64 {
		return u.Damage * u.Against(target.Class) * (1 - target.Armor*(1-u.Pierce))
	}
	if perHit(rpg, tank) < 4*perHit(militia, tank) {
		t.Fatalf("rpg does %.1f to a tank per hit, militia %.1f", perHit(rpg, tank), perHit(militia, tank))
	}
	if perHit(rpg, commandos) >= perHit(rpg, tank) {
		t.Fatalf("rpg does %.1f to infantry and %.1f to a tank", perHit(rpg, commandos), perHit(rpg, tank))
	}

	// In the field: a rocket team, half the size of a militia cell, hurts a tank squad half
	// again as much.
	damage := func(unit string) float64 {
		s := newSim(t, 5)
		tanks := buyFielded(t, s, 0, "tank")
		shooters := buyFielded(t, s, 1, unit)
		place(tanks, 800, 300)
		place(shooters, 800, 440)
		must(t, s, sim.Command{Side: 1, Kind: sim.CmdHold, Squad: shooters.ID})
		run(s, 10)
		left := 0.0
		for i := range tanks.Teams {
			if tanks.Teams[i].Members > 0 {
				left += tanks.Teams[i].HP
			}
		}
		return 2*tank.HP - left
	}
	if r, m := damage("rpgTeam"), damage("militia"); r < 1.5*m {
		t.Fatalf("in 10 s rpg teams did %.0f to tanks, militia %.0f", r, m)
	}
}

// The rocket launcher reaches far, cannot hit what is close, and backs away from it.
func TestRocketLauncherFiresFarAndNotClose(t *testing.T) {
	launcher := rules.Factions["aegis"].Units["rocketLauncher"]
	stage := func(gap float64) (s *sim.Sim, rockets, enemy *sim.Squad) {
		s = newSim(t, 2)
		rockets = buyFielded(t, s, 0, "rocketLauncher")
		enemy = s.Squads[2] // an Ashfall militia cell
		spotter := s.Squads[0]
		place(rockets, 400, 400)
		place(enemy, 400+gap, 400)
		place(spotter, 400+gap-200, 300) // eyes on the target, out of its reach
		must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: rockets.ID})
		must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: spotter.ID})
		must(t, s, sim.Command{Side: 1, Kind: sim.CmdHold, Squad: enemy.ID})
		return
	}
	hp := func(sq *sim.Squad) (total float64) {
		for i := range sq.Teams {
			if sq.Teams[i].Members > 0 {
				total += sq.Teams[i].HP
			}
		}
		return
	}

	s, rockets, enemy := stage(launcher.Range - 60)
	before := hp(enemy)
	run(s, 15)
	if hp(enemy) >= before {
		t.Fatal("the launcher did not hit a spotted target at long range")
	}
	if x, _ := rockets.Center(); math.Abs(x-400) > 30 {
		t.Fatalf("the launcher left its post (x=%.0f) though it could fire from it", x)
	}

	s, rockets, enemy = stage(launcher.MinRange - 60)
	s.Squads[0].Teams[0].X = 100 // the spotter is not needed: the enemy is in plain sight
	run(s, 6)
	if x, _ := rockets.Center(); x >= 400 {
		t.Fatalf("the launcher stayed at x=%.0f with an enemy inside its minimum range", x)
	}
}

// A weapon that outreaches the enemy's sight is seen when it fires, so it can be hunted.
func TestFiringGivesTheShooterAway(t *testing.T) {
	s := newSim(t, 2)
	rockets := buyFielded(t, s, 0, "rocketLauncher")
	enemy := s.Squads[2]
	place(rockets, 300, 300)
	place(enemy, 300+rules.Factions["aegis"].Units["rocketLauncher"].Range-40, 300)
	place(s.Squads[0], 520, 200)
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: rockets.ID})
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdHold, Squad: enemy.ID})
	seen := func() bool {
		for _, c := range s.Snapshot(1).Contacts {
			if c.ID == rockets.ID {
				return true
			}
		}
		return false
	}
	if seen() {
		t.Fatal("the launcher is seen before it has fired")
	}
	fired := false
	for i := 0; i < 15*rules.TickRate && !fired; i++ {
		s.Step()
		fired = seen()
	}
	if !fired {
		t.Fatal("the launcher fired from beyond the enemy's sight and was never seen")
	}
	// It fades from view again once it stops firing.
	place(enemy, 1500, 700)
	place(s.Squads[3], 1500, 700)
	run(s, rules.Match.RevealSeconds+6)
	if seen() {
		t.Fatal("the launcher is still seen long after its last shot")
	}
}

func TestScriptedPlayersBuyTheNewUnits(t *testing.T) {
	bought := map[string]bool{}
	for seed := uint64(1); seed <= 3; seed++ {
		s, _ := playMatch(t, seed, [2]string{bot.Standard, bot.Standard})
		for _, sq := range s.Squads {
			bought[sq.Unit] = true
		}
	}
	for _, unit := range []string{"helicopter", "rocketLauncher", "fpvSwarm", "rpgTeam"} {
		if !bought[unit] {
			t.Errorf("no scripted player bought %s in three matches", unit)
		}
	}
}
