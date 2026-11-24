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
	Standard = "standard" // take rigs and points, then press the enemy HQ; buys the moment it can
	Rush     = "rush"     // one squad on the home rig, everything else at the enemy HQ
	Normal   = "normal"   // Standard, but it buys at a human pace, fields fewer squads and attacks later
	Easy     = "easy"     // slower and smaller again, and it leaves the enemy HQ alone for a long while
)

// pace is how hard a style presses: seconds between purchases, the most squads it fields,
// and the second of the match before which it holds ground instead of going for the HQ.
type pace struct{ buyEvery, squads, attackAfter int }

var paces = map[string]pace{
	Normal: {buyEvery: 14, squads: 8, attackAfter: 150},
	Easy:   {buyEvery: 26, squads: 5, attackAfter: 300},
}

type Player struct {
	Side  int
	Style string
	R     *shared.Rules

	lastBuy int // tick of the last purchase, for the styles that pace themselves
}

// Act looks at what its side can see and returns the commands it wants this turn.
// It only ever reads the fogged snapshot, the same one a human player gets.
func (p *Player) Act(snap sim.Snapshot) []sim.Command {
	var cmds []sim.Command
	enemyHQ := p.R.HQPoint(1 - p.Side).ID
	plan := p.infantryPlan()
	slow, paced := paces[p.Style]
	// Until its attack time a paced bot sends its spare squads to hold the middle of the map.
	target, push := enemyHQ, sim.CmdAttack
	if paced && snap.Tick < slow.attackAfter*p.R.TickRate {
		target, push = p.nearest("point", 1), sim.CmdHold
	}
	infantry, naval, vehicles := 0, 0, 0
	for _, sq := range snap.Squads {
		want := sim.Command{Side: p.Side, Squad: sq.ID}
		switch sq.Class {
		case "naval":
			naval++
			want.Kind, want.Point = sim.CmdHold, p.seaRig()
		case "vehicle":
			vehicles++
			want.Kind, want.Point = push, target
		default:
			if infantry < len(plan) {
				want.Kind, want.Point = sim.CmdHold, plan[infantry]
			} else {
				want.Kind, want.Point = push, target
			}
			infantry++
		}
		if want.Point != "" && (sq.Order.Kind != want.Kind || sq.Order.Point != want.Point) {
			cmds = append(cmds, want)
		}
	}

	// Squads on their way count as already there, or the bot would buy them twice.
	for _, d := range snap.Deploying {
		switch d.Class {
		case "naval":
			naval++
		case "vehicle":
			vehicles++
		default:
			infantry++
		}
	}
	if len(snap.Squads)+len(snap.Deploying) >= p.R.Match.PopulationCap {
		return cmds
	}
	if paced && (len(snap.Squads)+len(snap.Deploying) >= slow.squads || (p.lastBuy > 0 && snap.Tick-p.lastBuy < slow.buyEvery*p.R.TickRate)) {
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
		p.lastBuy = snap.Tick + 1
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
