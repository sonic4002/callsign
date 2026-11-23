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
		sea := rules.Factions[s.Sides[sq.Side].Faction].Units[sq.Unit].Domain == "sea"
		for _, tm := range sq.Teams {
			if tm.Members == 0 {
				continue
			}
			if math.IsNaN(tm.X) || math.IsNaN(tm.Y) || tm.X < 0 || tm.X > rules.Map.Width || tm.Y < 0 || tm.Y > rules.Map.Height {
				t.Fatalf("tick %d: squad %d left the map at %.1f,%.1f", s.Tick, sq.ID, tm.X, tm.Y)
			}
			if (tm.Y >= rules.Map.WaterY) != sea {
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
	boat := must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "patrolBoat"})
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
	tank := must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: "tank"})
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
// cannot answer. Until firing gives a shooter away, sight must cover every enemy weapon.
func TestEveryUnitSeesAsFarAsItCanBeShot(t *testing.T) {
	for mine, f := range rules.Factions {
		for theirs, g := range rules.Factions {
			if mine == theirs {
				continue
			}
			for id, u := range f.Units {
				for enemyID, e := range g.Units {
					if u.Sight < e.Range {
						t.Errorf("%s %s sees %.0f but %s %s shoots %.0f", mine, id, u.Sight, theirs, enemyID, e.Range)
					}
				}
			}
		}
	}
}
