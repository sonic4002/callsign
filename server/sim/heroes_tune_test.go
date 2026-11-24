package sim_test

import (
	"os"
	"strconv"
	"testing"

	"callsign/server/bot"
	"callsign/server/sim"
	"callsign/shared"
)

// scriptedGames plays relentless against relentless from both ends for a number of seeds
// under a set of rules and returns the wins by faction and how many games a fallen
// headquarters ended.
func scriptedGames(t *testing.T, r *shared.Rules, seeds int) (wins map[string]int, byHQ int) {
	t.Helper()
	wins = map[string]int{}
	for _, factions := range [][2]string{{"aegis", "ashfall"}, {"ashfall", "aegis"}} {
		for seed := uint64(1); seed <= uint64(seeds); seed++ {
			s, err := sim.New(r, sim.Config{Seed: seed, Factions: factions})
			if err != nil {
				t.Fatal(err)
			}
			players := [2]*bot.Player{{Side: 0, Style: bot.Standard, R: r}, {Side: 1, Style: bot.Standard, R: r}}
			for !s.Over {
				if s.Tick%r.TickRate == 0 {
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
			if s.Winner != sim.NoSide {
				wins[factions[s.Winner]]++
			}
			for _, sq := range s.Squads {
				if sq.Rank > 0 {
					wins["ranked "+factions[sq.Side]+" "+sq.Unit]++
				}
				if sq.Unit == "sentinel" || sq.Unit == "oracle" {
					wins["fielded "+sq.Unit]++
				}
			}
			if s.Reason == "hq_destroyed" {
				byHQ++
			}
		}
	}
	return wins, byHQ
}

// TestHeroBalanceProbe is the balance run for heroes, ranks and crushing, with each of
// them taken out in turn to see what it is worth. It runs only when HEROES_TUNE names the
// number of seeds (100 gives the 200 games of the balance target).
func TestHeroBalanceProbe(t *testing.T) {
	seeds, _ := strconv.Atoi(os.Getenv("HEROES_TUNE"))
	if seeds <= 0 {
		t.Skip("set HEROES_TUNE=<seeds> to run the hero balance probe")
	}
	variants := []struct {
		name string
		edit func(r *shared.Rules)
	}{
		{"as shipped", func(r *shared.Rules) {}},
		{"no heroes", func(r *shared.Rules) {
			for _, f := range r.Factions {
				for id, u := range f.Units {
					if u.Hero {
						delete(f.Units, id)
					}
				}
			}
		}},
		{"no ranks", func(r *shared.Rules) { r.Ranks = nil }},
		{"no crushing", func(r *shared.Rules) {
			for _, f := range r.Factions {
				for id, u := range f.Units {
					u.Crushes = false
					f.Units[id] = u
				}
			}
		}},
	}
	variants = append(variants, struct {
		name string
		edit func(r *shared.Rules)
	}{"none of it", func(r *shared.Rules) {
		for _, v := range variants[1:4] {
			v.edit(r)
		}
	}})
	only := os.Getenv("HEROES_VARIANT")
	for _, v := range variants {
		if only != "" && only != v.name {
			continue
		}
		r := shared.MustLoad()
		v.edit(r)
		wins, byHQ := scriptedGames(t, r, seeds)
		t.Logf("%-12s %d games: aegis %d, ashfall %d, %d by a fallen headquarters", v.name, 2*seeds, wins["aegis"], wins["ashfall"], byHQ)
		t.Logf("  %v", wins)
	}
}
