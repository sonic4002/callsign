package sim_test

import (
	"math"
	"testing"

	"callsign/server/sim"
	"callsign/shared"
)

// Bodies take room, so a narrow place can jam. These tests march a whole army, sail a
// flotilla and work a gold lane on every map, and fail when it takes much longer than
// the distance explains.

// gusherNear is the gold field nearest a spot.
func gusherNear(r *shared.Rules, x, y float64) *shared.Gusher {
	best, bd := 0, math.MaxFloat64
	for i, g := range r.Map.Gushers {
		if d := math.Hypot(g.X-x, g.Y-y); d < bd {
			best, bd = i, d
		}
	}
	return &r.Map.Gushers[best]
}

// arrive steps the match until every living team of the squads is within reach of a spot,
// and returns the seconds it took, or -1 after the limit.
func arrive(s *sim.Sim, squads []*sim.Squad, x, y, reach float64, limit int) int {
	for sec := 0; sec <= limit; sec++ {
		there := true
		for _, sq := range squads {
			for i := range sq.Teams {
				if tm := &sq.Teams[i]; sq.Alive && tm.Members > 0 && math.Hypot(tm.X-x, tm.Y-y) > reach {
					there = false
				}
			}
		}
		if there {
			return sec
		}
		run(s, 1)
	}
	return -1
}

// The ways across each map: a bridge, a ford or a pass an army is marched through.
var crossings = map[string][]string{
	"small":  {"bridge-west", "bridge-south", "G"},
	"medium": {"bridge-north-west", "bridge-west", "N"},
	"large":  {"N", "G", "F", "bridge-far-west"},
	"huge":   {"bridge-west", "G", "N", "bridge-far-west"},
}

var armies = map[string][]string{
	"aegis":   {"commandos", "commandos", "commandos", "commandos", "engineers", "tank", "tank", "tank", "rocketLauncher", "rocketLauncher"},
	"ashfall": {"militia", "militia", "militia", "militia", "sappers", "technical", "technical", "technical", "rpgTeam", "rpgTeam"},
}

func TestAnArmyCrossesEveryMapWithoutAJam(t *testing.T) {
	for _, id := range rules.MapIDs() {
		for _, way := range crossings[id] {
			for _, faction := range []string{"aegis", "ashfall"} {
				other := map[string]string{"aegis": "ashfall", "ashfall": "aegis"}[faction]
				s, r := simOn(t, rules, id, sim.Config{Seed: 7, StartGold: 20000, Factions: [2]string{faction, other}})
				// Twelve squads, the most a side fields: infantry, armour and the long guns
				// together. Ashfall's army is the harder one to move: it has half as many teams again.
				army := []*sim.Squad{s.Squad(1), s.Squad(2)}
				for _, unit := range armies[faction] {
					army = append(army, buyFielded(t, s, 0, unit))
				}
				// The enemy's two squads are taken off the map: this is about room, not a fight.
				for _, sq := range s.Squads {
					if sq.Side == 1 {
						sq.Alive = false
					}
				}
				slowest := math.MaxFloat64
				for _, sq := range army {
					u := r.Factions[faction].Units[sq.Unit]
					slowest = math.Min(slowest, u.Speed*r.Map.Pace*r.TerrainKinds["I"].Speed)
				}
				hq, there := r.HQPoint(0), r.HQPoint(1)
				// Past the crossing, the army gathers on open ground short of the enemy base.
				goal := gusherNear(r, there.X, there.Y)
				mid, err := s.ResolvePlace(way)
				if err != nil {
					t.Fatalf("%s: %v", id, err)
				}
				legs := math.Hypot(mid.X-hq.X, mid.Y-hq.Y) + math.Hypot(goal.X-mid.X, goal.Y-mid.Y)
				limit := int(2*legs/slowest) + 60
				for _, sq := range army {
					must(t, s, sim.Command{Side: 0, Kind: sim.CmdMove, Squad: sq.ID, Place: way})
				}
				first := arrive(s, army, mid.X, mid.Y, 260, limit)
				for _, sq := range army {
					must(t, s, sim.Command{Side: 0, Kind: sim.CmdMove, Squad: sq.ID, Place: "field-" + goal.ID})
				}
				second := arrive(s, army, goal.X, goal.Y, 260, limit)
				t.Logf("%s by %s, %s: twelve squads at the crossing after %d s and across after %d s more (limit %d s for %.0f of ground)", id, way, faction, first, second, limit, legs)
				if first < 0 || second < 0 || first+second > limit {
					t.Errorf("%s by %s: the %s army jammed: %d s to the crossing, %d s beyond it, limit %d s", id, way, faction, first, second, limit)
					for _, sq := range army {
						for i := range sq.Teams {
							if tm := &sq.Teams[i]; tm.Members > 0 && math.Hypot(tm.X-goal.X, tm.Y-goal.Y) > 260 {
								t.Logf("  %s %d team %d is at (%.0f, %.0f), %s", sq.Unit, sq.ID, i, tm.X, tm.Y, tm.Action)
							}
						}
					}
				}
			}
		}
	}
}

func TestBoatsSailTheNarrowWaterOfEveryMap(t *testing.T) {
	for _, id := range rules.MapIDs() {
		s, r := simOn(t, rules, id, sim.Config{Seed: 7, StartGold: 20000})
		var boats []*sim.Squad
		for i := 0; i < 4; i++ {
			boats = append(boats, buyFielded(t, s, 0, "patrolBoat"))
		}
		for _, sq := range s.Squads {
			if sq.Side == 1 {
				sq.Alive = false
			}
		}
		x0, y0 := boats[0].Center()
		rig := r.PointByID("S")
		// To the rig, and on to the water off the enemy's own shore: the whole length of
		// the river on the maps that have one.
		there := r.HQPoint(1)
		far := [2]float64{r.Map.Width - x0, y0}
		speed := r.Factions["aegis"].Units["patrolBoat"].Speed * r.Map.Pace
		for leg, to := range [][2]float64{{rig.X, rig.Y}, far} {
			from := [2]float64{x0, y0}
			if leg == 1 {
				from = [2]float64{rig.X, rig.Y}
			}
			limit := int(2.2*(math.Abs(to[0]-from[0])+math.Abs(to[1]-from[1]))/speed) + 40
			for _, sq := range boats {
				c := sim.Command{Side: 0, Kind: sim.CmdMove, Squad: sq.ID, Point: "S"}
				if leg == 1 {
					c = sim.Command{Side: 0, Kind: sim.CmdMove, Squad: sq.ID, Place: offsetOf(there, to)}
				}
				must(t, s, c)
			}
			took := arrive(s, boats, to[0], to[1], 220, limit)
			t.Logf("%s: four boats, leg %d: %d s (limit %d s)", id, leg+1, took, limit)
			if took < 0 {
				t.Errorf("%s: the boats jammed on leg %d: not there after %d s", id, leg+1, limit)
			}
		}
	}
}

// offsetOf writes a position as an exact offset from a point ("S120 W300 of Z").
func offsetOf(p *shared.Point, to [2]float64) string {
	ns, ew := "S", "E"
	dx, dy := math.Round(to[0]-p.X), math.Round(to[1]-p.Y)
	if dy < 0 {
		ns, dy = "N", -dy
	}
	if dx < 0 {
		ew, dx = "W", -dx
	}
	return ns + itoa(int(dy)) + " " + ew + itoa(int(dx)) + " of " + p.ID
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	out := ""
	for ; n > 0; n /= 10 {
		out = string(rune('0'+n%10)) + out
	}
	return out
}

// Troops standing on the lane between a refinery and its field slow the haulers down a
// little, never to a stop.
func TestHaulersGetThroughTroopsStandingOnTheirLane(t *testing.T) {
	for _, id := range rules.MapIDs() {
		earned := func(crowd bool) int {
			s, r := simOn(t, rules, id, sim.Config{Seed: 7, StartGold: 3000})
			unit, _ := r.HaulerOf("aegis")
			for i := 0; i < 2; i++ {
				must(t, s, sim.Command{Side: 0, Kind: sim.CmdBuy, Unit: unit})
			}
			hq := r.HQPoint(0)
			field := gusherNear(r, hq.X, hq.Y)
			if crowd {
				squads := []*sim.Squad{s.Squad(1), s.Squad(2)}
				for _, u := range []string{"commandos", "commandos", "tank", "tank"} {
					squads = append(squads, buyFielded(t, s, 0, u))
				}
				for _, sq := range squads {
					must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: sq.ID, Place: "field-" + field.ID})
				}
			}
			run(s, 60)
			before := s.Gold(0)
			run(s, 180)
			return s.Gold(0) - before
		}
		free, crowded := earned(false), earned(true)
		t.Logf("%s: three haulers bring %d gold in three minutes on a clear lane, %d with six squads standing in the field", id, free, crowded)
		if float64(crowded) < 0.7*float64(free) {
			t.Errorf("%s: troops on the lane cut the haul from %d to %d", id, free, crowded)
		}
	}
}
