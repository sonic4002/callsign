package bot

import (
	"math"

	"callsign/server/sim"
	"callsign/shared"
)

// The scripted player's hero. It buys its army's one hero late, once the base and the
// line squads are out, and uses what makes it a hero: the marksman sets a charge on the
// nearest enemy structure it can see, the infiltrator takes over the nearest enemy
// vehicle squad. With nothing of the kind in sight a hero goes with the main push.

// anyUnit finds a unit by id in whichever faction has it: a side may field a squad that is
// not of its own design.
func (p *Player) anyUnit(id string) (shared.Unit, bool) {
	for _, f := range p.R.Factions {
		if u, ok := f.Units[id]; ok {
			return u, true
		}
	}
	return shared.Unit{}, false
}

func (p *Player) isHero(id string) bool {
	u, ok := p.anyUnit(id)
	return ok && u.Hero
}

// heroID is the faction's hero, or "".
func (p *Player) heroID(faction string) string {
	for _, id := range sortedIDs(p.R.Factions[faction].Units) {
		if p.R.Factions[faction].Units[id].Hero {
			return id
		}
	}
	return ""
}

// wantsHero reports whether this style fields a hero now: the gentle levels never do, and
// a hero that fell is not replaced for a while.
func (p *Player) wantsHero(snap sim.Snapshot) bool {
	return p.Style == Standard && (p.lastHero == 0 || snap.Tick-p.lastHero >= heroEvery*p.R.TickRate)
}

// heroEvery is the least time between two heroes of one scripted player, in seconds.
const heroEvery = 150

// heroOrder is what a hero should be doing now, given where the main push is going.
func (p *Player) heroOrder(snap sim.Snapshot, sq sim.SquadView, push, target string) sim.Command {
	u, _ := p.anyUnit(sq.Unit)
	want := sim.Command{Side: p.Side, Squad: sq.ID, Kind: push, Point: target}
	if sq.Hero == nil {
		return want
	}
	switch {
	case u.ChargeDamage > 0 && sq.Hero.Charges > 0:
		// Already on its way to plant: leave it at it.
		if sq.Order.Kind == sim.OrderPlant {
			return sim.Command{}
		}
		best, bd := "", math.MaxFloat64
		for _, st := range snap.Structures {
			if st.Side == p.Side || st.Ruin || !st.Visible || st.Role == shared.RoleFence {
				continue
			}
			if d := math.Hypot(st.X-sq.X, st.Y-sq.Y); d < bd && d <= 500 {
				best, bd = st.ID, d
			}
		}
		if best != "" {
			return sim.Command{Side: p.Side, Squad: sq.ID, Kind: sim.CmdPlant, Place: best}
		}
	case u.SeizeRadius > 0 && sq.Hero.Seized == 0:
		if sq.Order.Kind == sim.OrderSeize {
			return sim.Command{}
		}
		best, bd := 0, math.MaxFloat64
		for _, c := range snap.Contacts {
			if c.Class != "vehicle" {
				continue
			}
			if d := math.Hypot(c.X-sq.X, c.Y-sq.Y); d < bd && d <= 450 {
				best, bd = c.ID, d
			}
		}
		if best != 0 {
			return sim.Command{Side: p.Side, Squad: sq.ID, Kind: sim.CmdSeize, Contact: best}
		}
	}
	return want
}
