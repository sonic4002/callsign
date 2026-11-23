package sim

import "math"

// plan is what one fireteam does this tick.
type plan struct {
	act    string
	target *teamRef
	hq     bool // fire at the enemy headquarters
	x, y   float64
}

// trackContacts keeps attack orders pointed at where their contact was last seen, and
// turns them into a hold once the contact is destroyed.
func (s *Sim) trackContacts() {
	for _, sq := range s.Squads {
		if !sq.Alive || sq.Order.Contact == 0 {
			continue
		}
		c := s.Squads[sq.Order.Contact-1]
		if !c.Alive {
			x, y := sq.Center()
			sq.Order = Order{Kind: OrderHold, X: x, Y: y, Tick: s.Tick}
			continue
		}
		var x, y, n float64
		for i := range c.Teams {
			if t := &c.Teams[i]; t.Members > 0 && t.Spotted {
				x, y, n = x+t.X, y+t.Y, n+1
			}
		}
		if n > 0 {
			sq.Order.X, sq.Order.Y = x/n, y/n
		}
	}
}

// decide is the fireteam's utility AI. Every option gets a score from what the team can
// sense right now, and the best score wins. The order sets what the team is trying to do;
// nerve changes how well it does it, never whether it obeys once it steadies.
//
//	fire      0.55  +0.30 order is hold or attack   +0.20 no order (self-defence)
//	                -0.10 order is move             +0.15 target inside half range
//	                -0.15 shaken                    -0.90 pinned
//	advance   0.50  +0.40 order is move             +0.10 order is attack
//	                +0.20 order is hold, no target  -0.10 under fire
//	                -0.20 shaken (-0.30 more under fire)   -0.70 pinned
//	cover     0.20  +0.25 under fire   +0.20 shaken   +0.60 pinned
//	fall back 0.10  +0.45 shaken and outnumbered
//	                +0.30 under fire with nothing in range and nowhere to go
func (s *Sim) decide(tr *teamRef, live []*teamRef) plan {
	sq, t, u := tr.sq, tr.t, tr.u
	order := sq.Order.Kind
	nerve := s.Nerve(t)

	var target, wanted *teamRef
	targetD, wantedD, nearest := math.MaxFloat64, math.MaxFloat64, math.MaxFloat64
	friends, enemies := 0, 0
	for _, o := range live {
		d := dist(t.X, t.Y, o.t.X, o.t.Y)
		if o.sq.Side == sq.Side {
			if d <= 250 {
				friends++
			}
			continue
		}
		if !o.t.Spotted {
			continue
		}
		if d <= 250 {
			enemies++
		}
		nearest = math.Min(nearest, d)
		if d > u.Range {
			continue
		}
		if d < targetD {
			target, targetD = o, d
		}
		if order == OrderAttack && o.sq.ID == sq.Order.Contact && d < wantedD {
			wanted, wantedD = o, d
		}
	}
	if wanted != nil {
		target, targetD = wanted, wantedD
	}
	enemyHQ := s.R.HQPoint(1 - sq.Side)
	hq := target == nil && (order == OrderAttack || order == OrderHold) &&
		dist(t.X, t.Y, enemyHQ.X, enemyHQ.Y) <= u.Range
	canFire := target != nil || hq

	var destX, destY float64
	needMove := false
	if order != OrderNone {
		destX, destY = sq.Order.X, sq.Order.Y
		if sq.Order.Contact == 0 {
			ox, oy := formation(tr.slot, u.Teams)
			destX, destY = destX+ox, destY+oy
		}
		destX, destY = s.clamp(u.Domain, destX, destY)
		needMove = dist(t.X, t.Y, destX, destY) > 2
	}

	quiet := int(s.R.Nerve.QuietSeconds * float64(s.R.TickRate))
	underFire := s.Tick-t.lastShot <= quiet
	shaken, pinned := nerve == Shaken, nerve == Pinned
	outnumbered := float64(enemies) > 1.5*float64(friends)

	cover := 0.2 + b(underFire, 0.25) + b(shaken, 0.2) + b(pinned, 0.6)
	best := plan{act: ActCover}
	score := cover

	if canFire {
		v := 0.55 + b(order == OrderHold || order == OrderAttack, 0.3) + b(order == OrderNone, 0.2) -
			b(order == OrderMove, 0.1) + b(target != nil && targetD <= u.Range/2, 0.15) -
			b(shaken, 0.15) - b(pinned, 0.9)
		if v > score {
			best, score = plan{act: ActFire, target: target, hq: hq}, v
		}
	}
	if needMove {
		v := 0.5 + b(order == OrderMove, 0.4) + b(order == OrderAttack, 0.1) +
			b(order == OrderHold && !canFire, 0.2) - b(underFire, 0.1) -
			b(shaken, 0.2) - b(shaken && underFire, 0.3) - b(pinned, 0.7)
		if v > score {
			best, score = plan{act: ActAdvance, x: destX, y: destY}, v
		}
	}
	if nearest < math.MaxFloat64 || underFire {
		v := 0.1 + b(shaken && outnumbered, 0.45) + b(underFire && !canFire && !needMove, 0.3)
		if v > score {
			home := s.R.HQPoint(sq.Side)
			x, y := s.clamp(u.Domain, home.X, home.Y)
			best, score = plan{act: ActFallBack, x: x, y: y}, v
		}
	}
	if best.act == ActCover && !underFire && nearest == math.MaxFloat64 && nerve == Steady {
		best.act = ActIdle
	}
	return best
}

func b(cond bool, v float64) float64 {
	if cond {
		return v
	}
	return 0
}
