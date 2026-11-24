package sim_test

import (
	"os"
	"strconv"
	"testing"

	"callsign/server/bot"
	"callsign/server/sim"
)

// TestTune is a balance probe, run by hand: TUNE=<games per orientation> go test -run TestTune -v
func TestTune(t *testing.T) {
	n, _ := strconv.Atoi(os.Getenv("TUNE"))
	if n == 0 {
		t.Skip("set TUNE=<games per orientation>")
	}
	styleA, styleB := bot.Standard, bot.Standard
	if v := os.Getenv("TUNE_A"); v != "" {
		styleA = v
	}
	if v := os.Getenv("TUNE_B"); v != "" {
		styleB = v
	}
	wins := map[string]int{}
	reasons := map[string]int{}
	structures, lost, squads := 0, 0, 0
	games := 0
	for _, factions := range [][2]string{{"aegis", "ashfall"}, {"ashfall", "aegis"}} {
		for seed := uint64(1); seed <= uint64(n); seed++ {
			s, err := sim.New(rules, sim.Config{Seed: seed, Factions: factions, FullBase: os.Getenv("TUNE_FULL") != ""})
			if err != nil {
				t.Fatal(err)
			}
			players := [2]*bot.Player{{Side: 0, Style: styleA, R: rules}, {Side: 1, Style: styleB, R: rules}}
			for !s.Over {
				if s.Tick%rules.TickRate == 0 {
					for _, p := range players {
						for _, c := range p.Act(s.Snapshot(p.Side)) {
							if _, err := s.Apply(c); err != nil {
								t.Fatalf("seed %d tick %d: %+v refused: %v", seed, s.Tick, c, err)
							}
						}
					}
				}
				s.Step()
			}
			games++
			if s.Winner != sim.NoSide {
				wins[factions[s.Winner]]++
			} else {
				wins["draw"]++
			}
			reasons[s.Reason]++
			for _, st := range s.Structures {
				if st.Def().Role != "fence" {
					structures++
					if st.Ruin {
						lost++
					}
				}
			}
			squads += len(s.Squads)
		}
	}
	t.Logf("%d games: %v reasons %v; structures per side per game %.1f (lost %.1f), squads per side %.1f",
		games, wins, reasons, float64(structures)/float64(2*games), float64(lost)/float64(2*games), float64(squads)/float64(2*games))
}
