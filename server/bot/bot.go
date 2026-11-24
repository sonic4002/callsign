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

	lastBuy int // tick of the last purchase or structure, for the styles that pace themselves
}

// Act looks at what its side can see and returns the commands it wants this turn.
// It only ever reads the fogged snapshot, the same one a human player gets.
func (p *Player) Act(snap sim.Snapshot) []sim.Command {
	var cmds []sim.Command
	enemyHQ := p.R.HQPoint(1 - p.Side).ID
	plan := p.infantryPlan()
	// The line units are the cheapest of each class; anything dearer is a specialist.
	line := map[string]string{}
	for _, class := range []string{"infantry", "vehicle", "naval", "air"} {
		line[class], _ = p.unitOf(snap.Faction, class)
	}
	slow, paced := paces[p.Style]
	// Until its attack time a paced bot sends its spare squads to hold the middle of the map.
	target, push := enemyHQ, sim.CmdAttack
	if paced && snap.Tick < slow.attackAfter*p.R.TickRate {
		target, push = p.nearest("point", 1), sim.CmdHold
	}
	infantry, naval, vehicles, air, special := 0, 0, 0, 0, 0
	count := func(class, unit string) {
		switch {
		case class == "air":
			air++
		case unit != line[class]:
			special++
		case class == "naval":
			naval++
		case class == "vehicle":
			vehicles++
		default:
			infantry++
		}
	}
	for _, sq := range snap.Squads {
		want := sim.Command{Side: p.Side, Squad: sq.ID}
		switch {
		case sq.Class == "naval":
			want.Kind, want.Point = sim.CmdHold, p.seaRig()
		case sq.Class == "infantry" && sq.Unit == line["infantry"] && infantry < len(plan):
			want.Kind, want.Point = sim.CmdHold, plan[infantry]
		case sq.Class == "air":
			// Aircraft are the reserve: they hunt the enemy squad nearest to home that
			// they can hurt, and wait over the forward point when none is in sight.
			want.Kind, want.Point = sim.CmdHold, plan[min(1, len(plan)-1)]
			if c := p.prey(snap, sq.Unit); c != 0 {
				want = sim.Command{Side: p.Side, Squad: sq.ID, Kind: sim.CmdAttack, Contact: c}
			}
		default:
			// Armour, specialists and spare infantry press the enemy headquarters.
			want.Kind, want.Point = push, target
		}
		count(sq.Class, sq.Unit)
		if want.Contact != 0 {
			if sq.Order.Kind != want.Kind || sq.Order.Contact != want.Contact {
				cmds = append(cmds, want)
			}
		} else if want.Point != "" && (sq.Order.Kind != want.Kind || sq.Order.Point != want.Point) {
			cmds = append(cmds, want)
		}
	}

	// Squads on their way count as already there, or the bot would buy them twice.
	for _, d := range snap.Deploying {
		count(d.Class, d.Unit)
	}
	if len(snap.Squads)+len(snap.Deploying) >= p.R.Match.PopulationCap {
		return cmds
	}
	if paced && (len(snap.Squads)+len(snap.Deploying) >= slow.squads || (p.lastBuy > 0 && snap.Tick-p.lastBuy < slow.buyEvery*p.R.TickRate)) {
		return cmds
	}
	// What the base needs whatever is bought next (base.go).
	if step := p.upkeep(snap, vehicles); step.build != nil {
		p.lastBuy = snap.Tick + 1
		return append(cmds, *step.build)
	} else if step.wait {
		return cmds
	}
	buy := line["infantry"]
	switch {
	case p.Style == Rush:
	case naval == 0:
		buy = line["naval"]
	case infantry < 5:
	case vehicles < 2:
		buy = line["vehicle"]
	case air == 0 && line["air"] != "":
		buy = line["air"]
	case special < 2:
		if id := p.specialist(snap.Faction, line); id != "" {
			buy = id
		}
	}
	u, ok := p.R.Factions[snap.Faction].Units[buy]
	if !ok {
		return cmds
	}
	// The wanted unit needs a structure that does not stand: build it, or save for it.
	if !p.canBuy(snap, buy) {
		if step := p.raise(snap, u.Requires, 0); step.build != nil {
			p.lastBuy = snap.Tick + 1
			cmds = append(cmds, *step.build)
		}
		return cmds
	}
	if snap.Gold >= u.Cost {
		cmds = append(cmds, sim.Command{Side: p.Side, Kind: sim.CmdBuy, Unit: buy})
		p.lastBuy = snap.Tick + 1
	}
	return cmds
}

// prey picks the enemy squad in sight nearest to this side's headquarters that a unit's
// weapon can hurt, or 0. The lowest id breaks a tie.
func (p *Player) prey(snap sim.Snapshot, unit string) int {
	u := p.R.Factions[snap.Faction].Units[unit]
	hq := p.R.HQPoint(p.Side)
	best, bd := 0, math.MaxFloat64
	for _, c := range snap.Contacts {
		if u.Against(c.Class) == 0 {
			continue
		}
		if d := math.Hypot(c.X-hq.X, c.Y-hq.Y); d < bd {
			best, bd = c.ID, d
		}
	}
	return best
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

// unitOf finds the faction's line unit of a class: the cheapest one. Unit ids are sorted
// so the pick never depends on map order.
func (p *Player) unitOf(faction, class string) (string, shared.Unit) {
	units := p.R.Factions[faction].Units
	best := ""
	for _, id := range sortedIDs(units) {
		if units[id].Class == class && !units[id].Engineer() && (best == "" || units[id].Cost < units[best].Cost) {
			best = id
		}
	}
	return best, units[best]
}

// specialist finds the faction's first unit that is not the line unit of its class.
func (p *Player) specialist(faction string, line map[string]string) string {
	units := p.R.Factions[faction].Units
	for _, id := range sortedIDs(units) {
		if u := units[id]; line[u.Class] != id && !u.Engineer() {
			return id
		}
	}
	return ""
}

func sortedIDs(units map[string]shared.Unit) []string {
	ids := make([]string, 0, len(units))
	for id := range units {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}
