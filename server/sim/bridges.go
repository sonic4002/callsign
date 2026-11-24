package sim

import (
	"math"

	"callsign/shared"
)

type sharedBridge = shared.Bridge

// BridgeState is one bridge in a match. Standing, its deck is ground; fallen, it is
// water until engineers bring it back.
type BridgeState struct {
	*shared.Bridge
	HP       float64
	Standing bool

	dmg      float64 // damage taken in the tick being resolved
	by       [2]bool // which sides shot at it this tick
	lastWarn [2]int  // tick each side was last warned that it is under attack
}

func (s *Sim) initBridges() {
	for i := range s.R.Map.Bridges {
		b := &s.R.Map.Bridges[i]
		s.Bridges = append(s.Bridges, BridgeState{Bridge: b, HP: b.HP, Standing: true, lastWarn: [2]int{never, never}})
	}
}

// Share is the bridge's hit points as a share of a new one.
func (b *BridgeState) Share() float64 { return math.Max(0, b.HP/b.Bridge.HP) }

// inDanger reports whether the bridge stands but is close to falling.
func (b *BridgeState) inDanger(s *Sim) bool {
	return b.Standing && b.Share() < s.R.BridgeRules.DangerShare
}

// mid is the middle of the deck.
func (b *BridgeState) mid() (float64, float64) {
	return (b.From[0] + b.To[0]) / 2, (b.From[1] + b.To[1]) / 2
}

// distTo is the distance from a position to the nearest part of the deck's centre line.
func (b *BridgeState) distTo(x, y float64) float64 {
	ax, ay, bx, by := b.From[0], b.From[1], b.To[0], b.To[1]
	t := ((x-ax)*(bx-ax) + (y-ay)*(by-ay)) / ((bx-ax)*(bx-ax) + (by-ay)*(by-ay))
	t = math.Max(0, math.Min(1, t))
	return math.Hypot(x-ax-t*(bx-ax), y-ay-t*(by-ay))
}

// ends are the two places on the banks just off the deck, where troops stand to shoot
// at a bridge or to mend it.
func (b *BridgeState) ends() [2][2]float64 {
	ax, ay, bx, by := b.From[0], b.From[1], b.To[0], b.To[1]
	l := math.Hypot(bx-ax, by-ay)
	ux, uy := (bx-ax)/l, (by-ay)/l
	return [2][2]float64{{ax - ux*30, ay - uy*30}, {bx + ux*30, by + uy*30}}
}

// nearEnd is the end of the bridge nearest to a position that a squad there can walk to.
func (s *Sim) nearEnd(b *BridgeState, sq *Squad) (float64, float64) {
	cx, cy := sq.Center()
	ends := b.ends()
	best, bd := 0, math.MaxFloat64
	for i, e := range ends {
		x, y := s.nav.snapXY(navGround, e[0], e[1])
		d := dist(cx, cy, x, y)
		if !s.Reachable(sq, x, y) {
			d += 1e6 // the far bank is no use to a squad cut off from it
		}
		if d < bd {
			best, bd = i, d
		}
	}
	return s.nav.snapXY(navGround, ends[best][0], ends[best][1])
}

// bridgeAt returns the bridge whose deck is under (x, y), or nil.
func (s *Sim) bridgeAt(x, y float64) *BridgeState {
	if i := s.nav.bridge[s.nav.index(x, y)]; i > 0 {
		return &s.Bridges[i-1]
	}
	return nil
}

func (s *Sim) bridgeByID(id string) (int, *BridgeState) {
	for i := range s.Bridges {
		if s.Bridges[i].ID == id {
			return i, &s.Bridges[i]
		}
	}
	return -1, nil
}

// resolveBridges applies the tick's damage to the bridges, warns whoever is on or near
// one under fire, and brings down the ones with nothing left.
func (s *Sim) resolveBridges(live []*teamRef) {
	warn := int(s.R.BridgeRules.WarnSeconds * float64(s.R.TickRate))
	for i := range s.Bridges {
		b := &s.Bridges[i]
		if b.dmg == 0 {
			continue
		}
		if b.Standing {
			b.HP = math.Max(0, b.HP-b.dmg)
			for side := 0; side < 2; side++ {
				if s.Tick-b.lastWarn[side] > warn && s.usesBridge(side, i, live) {
					b.lastWarn[side] = s.Tick
					s.emit(Event{Side: side, Kind: EvBridgeUnderAttack, Place: b.ID, Point: s.nearestPoint(b.mid())})
				}
			}
			if b.HP <= 0 {
				s.collapse(i, live)
			}
		}
		b.dmg, b.by = 0, [2]bool{}
	}
}

// usesBridge reports whether a side has ground troops on a bridge, beside it, or on
// their way across it.
func (s *Sim) usesBridge(side, bridge int, live []*teamRef) bool {
	b := &s.Bridges[bridge]
	for _, tr := range live {
		if tr.sq.Side != side || tr.u.Domain != "land" || tr.t.Members == 0 {
			continue
		}
		if b.distTo(tr.t.X, tr.t.Y) <= b.Width/2+60 {
			return true
		}
		for _, p := range tr.t.path {
			if int(s.nav.bridge[s.nav.index(p[0], p[1])]) == bridge+1 {
				return true
			}
		}
	}
	return false
}

// collapse brings a bridge down. Every land unit standing on the deck is lost with it.
func (s *Sim) collapse(bridge int, live []*teamRef) {
	b := &s.Bridges[bridge]
	b.Standing, b.HP = false, 0
	var lost [2]int
	for _, tr := range live {
		if tr.t.Members == 0 || tr.u.Domain != "land" || int(s.nav.bridge[s.nav.index(tr.t.X, tr.t.Y)]) != bridge+1 {
			continue
		}
		tr.t.Members, tr.t.HP, tr.t.In = 0, 0, ""
		lost[tr.sq.Side]++
		s.teamLost(tr)
	}
	s.nav.ver++
	mx, my := b.mid()
	for side := 0; side < 2; side++ {
		// A side learns of it when it lost troops there, brought it down, or sees it go.
		if lost[side] > 0 || b.by[side] || s.InSight(side, mx, my) {
			s.emit(Event{Side: side, Kind: EvBridgeFell, Place: b.ID, Point: s.nearestPoint(mx, my), Count: lost[side]})
		}
	}
}

// repairBridges lets squads ordered to repair a bridge mend it: each fireteam standing
// at an end, not shooting and not being shot at, adds its unit's repair rate.
func (s *Sim) repairBridges(live []*teamRef) {
	quiet := int(s.R.Nerve.QuietSeconds * float64(s.R.TickRate))
	for _, tr := range live {
		sq := tr.sq
		if sq.Order.Kind != OrderRepair || sq.Order.bridge == 0 || tr.u.RepairPerSecond <= 0 || tr.t.Members == 0 {
			continue // a repair order may also be on a structure (sell.go)
		}
		b := &s.Bridges[sq.Order.bridge-1]
		if tr.plan.act == ActFire || s.Tick-tr.t.lastShot <= quiet {
			continue
		}
		ends := b.ends()
		near := math.Min(dist(tr.t.X, tr.t.Y, ends[0][0], ends[0][1]), dist(tr.t.X, tr.t.Y, ends[1][0], ends[1][1]))
		if near > s.R.BridgeRules.RepairRadius {
			continue
		}
		tr.t.Action = ActRepair
		b.HP = math.Min(b.Bridge.HP, b.HP+tr.u.RepairPerSecond*s.dt)
		if !b.Standing && b.Share() >= s.R.BridgeRules.StandShare {
			b.Standing = true
			s.nav.ver++
			mx, my := b.mid()
			for side := 0; side < 2; side++ {
				if side == sq.Side || s.InSight(side, mx, my) {
					s.emit(Event{Side: side, Kind: EvBridgeRepaired, Place: b.ID, Squad: squadIf(side == sq.Side, sq.ID), Point: s.nearestPoint(mx, my)})
				}
			}
		}
	}
	// A bridge made whole again needs no more work: the squad holds where it stands.
	for _, sq := range s.Squads {
		if sq.Alive && sq.Order.Kind == OrderRepair && sq.Order.bridge != 0 && s.Bridges[sq.Order.bridge-1].HP >= s.Bridges[sq.Order.bridge-1].Bridge.HP {
			x, y := sq.Center()
			sq.Order = Order{Kind: OrderHold, X: x, Y: y, Tick: s.Tick, arrived: true}
		}
	}
}

func squadIf(cond bool, id int) int {
	if cond {
		return id
	}
	return 0
}
