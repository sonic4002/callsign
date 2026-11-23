// Package bot is a scripted player with no AI model behind it. Headless tests play whole
// matches with it, and the server can field it as the enemy in a live match.
package bot

import (
	"math"
	"sort"

	"callsign/server/sim"
	"callsign/shared"
)

const (
	Standard = "standard" // take rigs and points, then press the enemy HQ
	Rush     = "rush"     // one squad on the home rig, everything else at the enemy HQ
)

type Player struct {
	Side  int
	Style string
	R     *shared.Rules
}

// Act looks at what its side can see and returns the commands it wants this turn.
// It only ever reads the fogged snapshot, the same one a human player gets.
func (p *Player) Act(snap sim.Snapshot) []sim.Command {
	var cmds []sim.Command
	enemyHQ := p.R.HQPoint(1 - p.Side).ID
	plan := p.infantryPlan()
	infantry, naval, vehicles := 0, 0, 0
	for _, sq := range snap.Squads {
		want := sim.Command{Side: p.Side, Squad: sq.ID}
		switch sq.Class {
		case "naval":
			naval++
			want.Kind, want.Point = sim.CmdHold, p.seaRig()
		case "vehicle":
			vehicles++
			want.Kind, want.Point = sim.CmdAttack, enemyHQ
		default:
			if infantry < len(plan) {
				want.Kind, want.Point = sim.CmdHold, plan[infantry]
			} else {
				want.Kind, want.Point = sim.CmdAttack, enemyHQ
			}
			infantry++
		}
		if want.Point != "" && (sq.Order.Kind != want.Kind || sq.Order.Point != want.Point) {
			cmds = append(cmds, want)
		}
	}

	if len(snap.Squads) >= p.R.Match.PopulationCap {
		return cmds
	}
	buy := ""
	switch {
	case p.Style == Rush:
		buy = "infantry"
	case naval == 0:
		buy = "naval"
	case infantry < 5:
		buy = "infantry"
	case vehicles < 2:
		buy = "vehicle"
	default:
		buy = "infantry"
	}
	if id, u := p.unitOf(snap.Faction, buy); id != "" && snap.Gold >= u.Cost {
		cmds = append(cmds, sim.Command{Side: p.Side, Kind: sim.CmdBuy, Unit: id})
	}
	return cmds
}

// infantryPlan lists the points the first infantry squads hold, in order.
func (p *Player) infantryPlan() []string {
	if p.Style == Rush {
		return []string{p.nearest("landRig", 0)}
	}
	return []string{p.nearest("landRig", 0), p.nearest("point", 1), p.nearest("point", 0), p.nearest("point", 2)}
}

// nearest returns the n-th closest point of a kind to this side's HQ.
func (p *Player) nearest(kind string, n int) string {
	hq := p.R.HQPoint(p.Side)
	var pts []shared.Point
	for _, pt := range p.R.Map.Points {
		if pt.Kind == kind {
			pts = append(pts, pt)
		}
	}
	sort.SliceStable(pts, func(i, j int) bool {
		return math.Hypot(pts[i].X-hq.X, pts[i].Y-hq.Y) < math.Hypot(pts[j].X-hq.X, pts[j].Y-hq.Y)
	})
	if n >= len(pts) {
		return ""
	}
	return pts[n].ID
}

func (p *Player) seaRig() string { return p.nearest("seaRig", 0) }

// unitOf finds the faction's unit of a class. Unit ids are sorted so the pick never
// depends on map order.
func (p *Player) unitOf(faction, class string) (string, shared.Unit) {
	units := p.R.Factions[faction].Units
	ids := make([]string, 0, len(units))
	for id := range units {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		if units[id].Class == class {
			return id, units[id]
		}
	}
	return "", shared.Unit{}
}
