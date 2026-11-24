package sim_test

import (
	"encoding/json"
	"os"
	"slices"
	"strconv"
	"testing"
	"time"

	"callsign/server/bot"
	"callsign/server/sim"
)

// What a match costs the server on each map: CALLSIGN_COST=1 plays one scripted match
// per map and logs the time of a tick (mean, 99th percentile, worst), of the two
// snapshots a room sends each tick, and their size. `make cost` runs it on one core.
func TestWhatATickCosts(t *testing.T) {
	if os.Getenv("CALLSIGN_COST") == "" {
		t.Skip("set CALLSIGN_COST=1 (make cost)")
	}
	for _, id := range rules.MapIDs() {
		s, r := simOn(t, rules, id, sim.Config{Seed: 3, Factions: [2]string{"aegis", "ashfall"}, Base: []string{}})
		players := [2]*bot.Player{{Side: 0, Style: bot.Standard, R: r}, {Side: 1, Style: bot.Standard, R: r}}
		var ticks, snaps []time.Duration
		bytes, teams, most := 0, 0, 0
		for !s.Over {
			if s.Tick%r.TickRate == 0 {
				for _, p := range players {
					for _, c := range p.Act(s.Snapshot(p.Side)) {
						if _, err := s.Apply(c); err != nil {
							t.Fatal(err)
						}
					}
				}
			}
			t0 := time.Now()
			s.Step()
			t1 := time.Now()
			n := 0
			for side := 0; side < 2; side++ {
				raw, err := json.Marshal(s.Snapshot(side))
				if err != nil {
					t.Fatal(err)
				}
				n += len(raw)
			}
			ticks, snaps = append(ticks, t1.Sub(t0)), append(snaps, time.Since(t1))
			bytes += n
			live := 0
			for _, sq := range s.Squads {
				if sq.Alive {
					live += len(sq.Teams)
				}
			}
			teams, most = teams+live, max(most, live)
		}
		stat := func(d []time.Duration) (mean, p99, worst time.Duration) {
			slices.Sort(d)
			var sum time.Duration
			for _, v := range d {
				sum += v
			}
			return sum / time.Duration(len(d)), d[len(d)*99/100], d[len(d)-1]
		}
		n := len(ticks)
		tm, tp, tw := stat(ticks)
		sm, sp, sw := stat(snaps)
		t.Logf("%s %vx%v: %d ticks, %d teams on average (most %d); tick %v mean, %v p99, %v worst; two snapshots as JSON %v mean, %v p99, %v worst, %d bytes each on average",
			id, r.Map.Width, r.Map.Height, n, teams/n, most, tm, tp, tw, sm, sp, sw, bytes/n/2)
	}
}

// What a map pays: an undisturbed base with one, two and three haulers on each map, as
// gold a minute over minutes three to six. A gusher too far from the base shows here.
func TestWhatAMapPays(t *testing.T) {
	if os.Getenv("CALLSIGN_COST") == "" {
		t.Skip("set CALLSIGN_COST=1 (make cost)")
	}
	for _, id := range rules.MapIDs() {
		for _, factions := range [][2]string{{"aegis", "ashfall"}, {"ashfall", "aegis"}} {
			line := ""
			for haulers := 1; haulers <= 3; haulers++ {
				s, r := simOn(t, rules, id, sim.Config{Seed: 1, Factions: factions, StartGold: 2000})
				for side := 0; side < 2; side++ {
					unit, _ := r.HaulerOf(factions[side])
					for n := 1; n < haulers; n++ {
						must(t, s, sim.Command{Side: side, Kind: sim.CmdBuy, Unit: unit})
					}
				}
				run(s, 180)
				before := [2]int{s.Gold(0), s.Gold(1)}
				run(s, 180)
				line += " " + []string{"one", "two", "three"}[haulers-1] + ":"
				for side := 0; side < 2; side++ {
					line += " " + factions[side] + " " + strconv.Itoa((s.Gold(side)-before[side])/3)
				}
			}
			t.Logf("%s, gold a minute by haulers:%s", id, line)
		}
	}
}
