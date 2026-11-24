package sim

import "math"

// plan is what one fireteam does this tick.
type plan struct {
	act    string
	target *teamRef
	hq     bool // fire at the enemy headquarters
	x, y   float64

	obj   *objRef // fire at a bridge or a building
	enter int     // index+1 of the building the team means to go inside
	leave bool    // come out of the building it is in
}

// objRef names a thing on the map that can be shot at and is no fireteam.
type objRef struct {
	bridge   int // index+1
	landmark int // index+1
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

// trackObjects turns an attack on a bridge that has fallen, or on a building that has,
// into a hold: there is nothing left to shoot at.
func (s *Sim) trackObjects() {
	for _, sq := range s.Squads {
		if !sq.Alive || sq.Order.Kind != OrderAttack {
			continue
		}
		gone := (sq.Order.bridge > 0 && !s.Bridges[sq.Order.bridge-1].Standing) ||
			(sq.Order.landmark > 0 && s.Landmarks[sq.Order.landmark-1].Kind == Rubble)
		if gone {
			x, y := sq.Center()
			sq.Order = Order{Kind: OrderHold, X: x, Y: y, Tick: s.Tick}
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
//	                +0.40 order is hold and the point is still far
//	                -0.20 shaken (-0.30 more under fire)   -0.70 pinned
//	cover     0.20  +0.25 under fire   +0.20 shaken   +0.60 pinned
//	fall back 0.10  +0.45 shaken and outnumbered
//	                +0.60 an enemy inside the weapon's minimum range and nothing to shoot
//	                +0.30 under fire with nothing in range and nowhere to go
//
// Cover is part of where a team goes, not a score of its own. Ordered to hold, a team
// takes the cover its post offers: inside a building with room for it, or close in
// behind a grove, rocks or a wall. And a team leaves a building that is about to fall.
func (s *Sim) decide(tr *teamRef, live []*teamRef) plan {
	sq, t, u := tr.sq, tr.t, tr.u
	order := sq.Order.Kind
	if order == OrderRepair {
		order = OrderHold // engineers at a bridge fight like any squad holding ground
	}
	nerve := s.Nerve(t)

	var target, wanted, closest *teamRef
	targetD, wantedD, nearest, reach := math.MaxFloat64, math.MaxFloat64, math.MaxFloat64, math.MaxFloat64
	tooClose := false // an enemy stands inside this weapon's minimum range
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
		if d < nearest {
			nearest = d
		}
		// What this weapon cannot hurt is no target, and nothing to close with.
		if u.Against(o.u.Class) == 0 {
			continue
		}
		if d < u.MinRange {
			tooClose = true
			continue
		}
		if d < reach {
			closest, reach = o, d
		}
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
	hq := target == nil && (order == OrderAttack || order == OrderHold) && u.Against("hq") > 0 &&
		dist(t.X, t.Y, enemyHQ.X, enemyHQ.Y) <= u.Range
	// An attack order on a bridge or a building means that thing: once it is in range
	// the team shoots at it, whoever else is about.
	var obj *objRef
	if order == OrderAttack && u.Against("structure") > 0 {
		if i := sq.Order.bridge; i > 0 && s.Bridges[i-1].Standing {
			if d := s.Bridges[i-1].distTo(t.X, t.Y); d <= u.Range && d >= u.MinRange {
				obj = &objRef{bridge: i}
			}
		}
		if i := sq.Order.landmark; i > 0 && s.kindOf(&s.Landmarks[i-1]).Garrison > 0 {
			if d := dist(t.X, t.Y, s.Landmarks[i-1].X, s.Landmarks[i-1].Y); d <= u.Range && d >= u.MinRange {
				obj = &objRef{landmark: i}
			}
		}
	}
	if obj != nil {
		target, hq = nil, false
	}
	canFire := target != nil || hq || obj != nil

	var destX, destY float64
	needMove := false
	enter, leave := 0, false
	if order != OrderNone {
		destX, destY = sq.Order.X, sq.Order.Y
		if sq.Order.Contact == 0 {
			ox, oy := formation(tr.slot, u.Teams, sq.Side)
			destX, destY = destX+ox, destY+oy
		}
		// Take the cover the post offers, or the landmark the order named.
		if cx, cy, lm := s.coverSpot(tr, destX, destY); lm >= 0 && (sq.Order.Contact == 0) && (sq.Order.Kind != OrderAttack || sq.Order.landmark == 0) {
			destX, destY = cx, cy
			if l := &s.Landmarks[lm]; cx == l.X && cy == l.Y {
				enter = lm + 1
			}
		}
		destX, destY = s.clamp(u.Domain, destX, destY)
	}
	if t.In != "" {
		_, in := s.landmarkByID(t.In)
		if in == nil || enter == 0 || s.Landmarks[enter-1].ID != t.In || s.failing(in) {
			leave = true
		} else {
			destX, destY = t.X, t.Y // inside, and meant to be
		}
	}
	quiet := int(s.R.Nerve.QuietSeconds * float64(s.R.TickRate))
	underFire := s.Tick-t.lastShot <= quiet
	slotX, slotY := destX, destY
	squadUnderFire := false // the squad answers as one, not one team at a time
	for i := range sq.Teams {
		squadUnderFire = squadUnderFire || (sq.Teams[i].Members > 0 && s.Tick-sq.Teams[i].lastShot <= quiet)
	}

	// An enemy in sight but out of reach must not get free shots. Attackers close with
	// it. Defenders being shot step out to meet it, but never farther from their post
	// than their own weapon reaches.
	if target == nil && closest != nil {
		ex, ey := closest.t.X, closest.t.Y
		switch {
		case order == OrderAttack && sq.Order.Contact == 0:
			destX, destY = s.clamp(u.Domain, ex, ey)
		case order == OrderHold && squadUnderFire && dist(t.X, t.Y, slotX, slotY) <= s.R.Match.HoldRadius+u.Range:
			gap := dist(slotX, slotY, ex, ey)
			if step := gap - 0.9*u.Range; step > 0 && step <= u.Range {
				destX, destY = s.clamp(u.Domain, slotX+(ex-slotX)/gap*step, slotY+(ey-slotY)/gap*step)
			}
		}
	}
	if order != OrderNone {
		needMove = dist(t.X, t.Y, destX, destY) > 2
	}
	t.atPost = order != OrderNone && !needMove
	// A squad told to hold a point gets there first; on the way it fights only what is
	// close or already shooting at it.
	enRoute := order == OrderHold && dist(t.X, t.Y, slotX, slotY) > s.R.Match.HoldRadius+u.Range
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
			best, score = plan{act: ActFire, target: target, hq: hq, obj: obj}, v
		}
	}
	if needMove {
		v := 0.5 + b(order == OrderMove, 0.4) + b(order == OrderAttack, 0.1) +
			b(order == OrderHold && !canFire, 0.2) + b(enRoute, 0.4) - b(underFire, 0.1) -
			b(shaken, 0.2) - b(shaken && underFire, 0.3) - b(pinned, 0.7)
		if v > score {
			best, score = plan{act: ActAdvance, x: destX, y: destY}, v
		}
	}
	if nearest < math.MaxFloat64 || underFire {
		v := 0.1 + b(shaken && outnumbered, 0.45) + b(underFire && !canFire && !needMove, 0.3) +
			b(tooClose && !canFire, 0.6)
		if v > score {
			home := s.R.HQPoint(sq.Side)
			x, y := s.clamp(u.Domain, home.X, home.Y)
			best, score = plan{act: ActFallBack, x: x, y: y}, v
		}
	}
	if best.act == ActCover && !underFire && nearest == math.MaxFloat64 && nerve == Steady {
		best.act = ActIdle
	}
	best.enter, best.leave = enter, leave
	return best
}

func b(cond bool, v float64) float64 {
	if cond {
		return v
	}
	return 0
}
