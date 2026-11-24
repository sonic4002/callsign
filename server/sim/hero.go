package sim

import (
	"errors"
	"fmt"
	"math"

	"callsign/shared"
)

// Heroes. Each army has one exceptional soldier: a squad of one with its own leader, one
// alive at a time. What makes a hero is in the rules (shared.Unit): a marksman who is seen
// only from close by and plants demolition charges, an infiltrator who passes for a
// bystander, takes over an enemy vehicle squad and frightens whoever is near.

const (
	CmdPlant = "plant"
	CmdSeize = "seize"

	OrderPlant = "plant" // walk to an enemy structure or a bridge and set a charge on it
	OrderSeize = "seize" // close with an enemy vehicle squad and take it over

	EvHeroFielded   = "hero_fielded"   // Unit; Squad for its own side, Contact for the other
	EvHeroFell      = "hero_fell"      // the same
	EvChargePlanted = "charge_planted" // Squad, and Structure or Place: what it is on; Count the fuse in seconds
	EvChargeBlew    = "charge_blew"    // Structure or Place

	// A squad that changes hands is lost to one side and joins the other; the two events
	// carry one of these reasons, so that leaders stop and start with it.
	ReasonSeized   = "seized"
	ReasonReturned = "returned"
)

var (
	ErrHeroInField = errors.New("your hero is already in the field: there is only one")
	ErrNotHero     = errors.New("that squad cannot do that: it takes a hero")
	ErrNoCharges   = errors.New("no demolition charges left")
	ErrNoTarget    = errors.New("a charge goes on an enemy structure or a bridge")
	ErrNotVehicle  = errors.New("only an enemy vehicle squad in sight can be seized")
)

// heroState is what a hero carries and is doing.
type heroState struct {
	Charges int // demolition charges left
	work    int // ticks spent planting, or closing its grip on a vehicle
	Seized  int // id of the squad it holds, or 0
}

// Charge is a demolition charge burning down on a structure or a bridge.
type Charge struct {
	Side      int
	X, Y      float64
	Structure int  // structure id, or 0
	Bridge    int  // index+1, or 0
	HQ        bool // on the enemy headquarters
	Ticks     int  // until it goes off
	Total     int
	Damage    float64
	VsHQ      float64
	By        int // the hero that set it
}

// seizure records a squad a hero holds: where it came from, and the number it had there.
type seizure struct {
	Squad, Hero, From, Num int
}

// HeroView is a hero as its own side sees it.
type HeroView struct {
	Charges int     `json:"charges,omitempty"`
	Work    float64 `json:"work,omitempty"`   // planting or seizing, 0…1
	Seized  int     `json:"seized,omitempty"` // the squad it holds
	HP      float64 `json:"hp"`               // health 0…1
}

// ChargeView is a charge on the map.
type ChargeView struct {
	Side  int     `json:"side"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Left  float64 `json:"left"` // seconds
	Total float64 `json:"total"`
	Place string  `json:"place"` // what it is on
}

// heroAlive reports whether a side has a hero of its own in the field or on its way.
func (s *Sim) heroAlive(side int) bool {
	for _, sq := range s.Squads {
		if sq.unit.Hero && sq.Side == side && (sq.Alive || sq.Deploying()) {
			return true
		}
	}
	return false
}

// heroAllowed refuses a second hero while the first lives.
func (s *Sim) heroAllowed(side int, u *shared.Unit) error {
	if u.Hero && s.heroAlive(side) {
		return ErrHeroInField
	}
	return nil
}

// heroRaised gives a bought hero what it starts with.
func (s *Sim) heroRaised(sq *Squad) {
	u := sq.unit
	if !u.Hero {
		return
	}
	sq.hero = &heroState{Charges: u.Charges}
	if _, ok := s.R.TierCost(u.StartTier); ok && u.StartTier > sq.Tier {
		sq.Tier = u.StartTier
	}
}

// heroFielded tells both sides a hero has taken the field: its own gets the squad, the
// other only what it is.
func (s *Sim) heroFielded(sq *Squad) {
	if !sq.unit.Hero {
		return
	}
	s.emit(Event{Side: sq.Side, Kind: EvHeroFielded, Squad: sq.ID, Unit: sq.Unit})
	s.emit(Event{Side: 1 - sq.Side, Kind: EvHeroFielded, Contact: sq.ID, Unit: sq.Unit})
}

// heroFell tells both sides, and lets go of what the hero held.
func (s *Sim) heroFell(sq *Squad) {
	if !sq.unit.Hero {
		return
	}
	x, y := sq.Center()
	s.emit(Event{Side: sq.Side, Kind: EvHeroFell, Squad: sq.ID, Unit: sq.Unit, Point: s.nearestPoint(x, y)})
	s.emit(Event{Side: 1 - sq.Side, Kind: EvHeroFell, Contact: sq.ID, Unit: sq.Unit, Point: s.nearestPoint(x, y)})
	s.release(sq.ID)
}

// defenceSees reports whether a standing defence of a side has (x, y) inside its range:
// a defence is what finds a soldier nobody else can see.
func (s *Sim) defenceSees(side int, x, y float64) bool {
	for _, st := range s.Structures {
		if st.Side == side && st.def.Role == shared.RoleDefence && st.Standing() && dist(st.X, st.Y, x, y) <= st.def.Range {
			return true
		}
	}
	return false
}

// revealed reports whether a team has fired recently enough to have given itself away.
func (s *Sim) revealed(t *Team) bool {
	return float64(s.Tick-t.lastFire) <= s.R.Match.RevealSeconds*float64(s.R.TickRate)
}

// passesFor reports whether an enemy team at distance d is a disguised figure a fireteam
// has no cause to shoot: too far to be recognised, and it has not fired.
func (s *Sim) passesFor(o *teamRef, d float64) bool {
	return o.u.Disguise > 0 && d > o.u.Disguise && !s.revealed(o.t)
}

// disguised reports whether an enemy squad still passes for a bystander, for the page.
func (s *Sim) disguised(sq *Squad) bool {
	if sq.unit.Disguise <= 0 || len(sq.Teams) == 0 {
		return false
	}
	return !s.revealed(&sq.Teams[0])
}

// holdsFire reports whether a disguised hero on its way to its work keeps its weapon
// down: firing at range would end the disguise for nothing.
func (s *Sim) holdsFire(tr *teamRef, targetD float64) bool {
	k := tr.sq.Order.Kind
	return tr.u.Disguise > 0 && (k == OrderSeize || k == OrderMove) && targetD > tr.u.Disguise
}

// plantOrder sends a hero to set a charge on an enemy structure or a bridge.
func (s *Sim) plantOrder(c Command) (*Squad, error) {
	sq := s.Squad(c.Squad)
	if sq == nil || sq.Side != c.Side {
		return nil, ErrNoSquad
	}
	if sq.hero == nil || sq.unit.ChargeDamage <= 0 {
		return nil, ErrNotHero
	}
	if sq.hero.Charges <= 0 {
		return nil, ErrNoCharges
	}
	place := c.Place
	if place == "" {
		place = c.Point
	}
	pl, err := s.resolveFor(c.Side, place)
	if err != nil {
		return nil, err
	}
	o := Order{Kind: OrderPlant, Tick: s.Tick, Place: pl.ID}
	cx, cy := sq.Center()
	switch {
	case pl.Structure != nil && pl.Structure.Side != c.Side && !pl.Structure.Ruin:
		st := pl.Structure
		o.Structure = st.ID
		// Beside it, on the side the hero comes from.
		tx, ty := st.X, st.Y
		if st.def.Role == shared.RoleFence {
			tx, ty = (st.AX+st.BX)/2, (st.AY+st.BY)/2
		}
		dx, dy := cx-tx, cy-ty
		d := math.Hypot(dx, dy)
		if d < 1 {
			dx, dy, d = 1, 0, 1
		}
		r := st.def.Footprint + 16
		o.X, o.Y = s.nav.snapXY(navGround, tx+dx/d*r, ty+dy/d*r)
	case pl.Kind == PlaceBridge && s.Bridges[pl.bridge-1].Standing:
		o.bridge = pl.bridge
		o.X, o.Y = s.nearEnd(&s.Bridges[pl.bridge-1], sq)
	case pl.Kind == PlacePoint && pl.Point == s.R.HQPoint(1-c.Side).ID:
		// The enemy headquarters: beside its wall, on the side the hero comes from.
		dx, dy := cx-pl.X, cy-pl.Y
		d := math.Hypot(dx, dy)
		if d < 1 {
			dx, dy, d = 1, 0, 1
		}
		o.X, o.Y = s.nav.snapXY(navGround, pl.X+dx/d*hqStandoff, pl.Y+dy/d*hqStandoff)
	default:
		return nil, ErrNoTarget
	}
	if !s.Reachable(sq, o.X, o.Y) {
		return nil, fmt.Errorf("%w: there is no way there on the ground", ErrUnreachable)
	}
	sq.hero.work = 0
	sq.Order = o
	return sq, nil
}

// hqStandoff is how far from a headquarters' middle a hero stands to set a charge on it.
const hqStandoff = 80

// seizeOrder sends a hero to take over an enemy vehicle squad.
func (s *Sim) seizeOrder(c Command) (*Squad, error) {
	sq := s.Squad(c.Squad)
	if sq == nil || sq.Side != c.Side {
		return nil, ErrNoSquad
	}
	if sq.hero == nil || sq.unit.SeizeRadius <= 0 {
		return nil, ErrNotHero
	}
	v := s.Squad(c.Contact)
	if v == nil || v.Side == c.Side || !v.Alive || v.haul != nil || v.unit.Class != "vehicle" || !s.visible(v) {
		return nil, ErrNotVehicle
	}
	sq.hero.work = 0
	x, y := v.Center()
	sq.Order = Order{Kind: OrderSeize, Tick: s.Tick, Contact: v.ID, X: x, Y: y}
	return sq, nil
}

// seizeReach is how near a hero must be to a vehicle to work on it: near enough to hold
// it afterwards, far enough that its crew does not know the bystander.
func seizeReach(u *shared.Unit) float64 { return u.SeizeRadius / 2 }

// heroOrders runs before the fireteams decide. A hero closing on a vehicle stops once it
// is near enough to work, instead of walking under the tracks.
func (s *Sim) heroOrders() {
	for _, sq := range s.Squads {
		if !sq.Alive || sq.hero == nil || sq.Order.Kind != OrderSeize {
			continue
		}
		v := s.SquadAny(sq.Order.Contact)
		if v == nil || !v.Alive || v.Side == sq.Side {
			continue // trackContacts has made, or will make, the order a hold
		}
		hx, hy := sq.Center()
		vx, vy := v.Center()
		if dist(hx, hy, vx, vy) <= seizeReach(sq.unit) {
			sq.Order.X, sq.Order.Y = hx, hy
		}
	}
}

// heroes is the heroes' own work each tick: planting, the charges burning down, the grip
// on a seized squad, and the dread around an infiltrator.
func (s *Sim) heroes(live []*teamRef) {
	for _, sq := range s.Squads {
		if !sq.Alive || sq.hero == nil {
			continue
		}
		t := &sq.Teams[0]
		u := sq.unit
		switch sq.Order.Kind {
		case OrderPlant:
			st := s.structure(sq.Order.Structure)
			gone := (sq.Order.Structure != 0 && (st == nil || st.Ruin || st.Side == sq.Side)) ||
				(sq.Order.bridge > 0 && !s.Bridges[sq.Order.bridge-1].Standing)
			if gone {
				sq.Order = Order{Kind: OrderHold, X: t.X, Y: t.Y, Tick: s.Tick}
				sq.hero.work = 0
				break
			}
			if dist(t.X, t.Y, sq.Order.X, sq.Order.Y) > 14 {
				break
			}
			sq.hero.work++
			if float64(sq.hero.work) < u.PlantSeconds*float64(s.R.TickRate) {
				break
			}
			fuse := int(math.Round(u.FuseSeconds * float64(s.R.TickRate)))
			c := Charge{Side: sq.Side, Structure: sq.Order.Structure, Bridge: sq.Order.bridge, Ticks: fuse, Total: fuse, Damage: u.ChargeDamage, VsHQ: u.ChargeVsHQ, By: sq.ID}
			ev := Event{Side: sq.Side, Kind: EvChargePlanted, Squad: sq.ID, Count: int(math.Ceil(u.FuseSeconds))}
			if st != nil {
				c.X, c.Y = st.X, st.Y
				ev.Structure, ev.Unit = st.PlaceID(), st.Kind
			} else if sq.Order.bridge == 0 {
				hq := s.R.HQPoint(1 - sq.Side)
				c.X, c.Y, c.HQ = hq.X, hq.Y, true
				ev.Place = hq.ID
			} else {
				b := &s.Bridges[sq.Order.bridge-1]
				c.X, c.Y = b.mid()
				ev.Place = b.ID
			}
			ev.Point = s.nearestPoint(c.X, c.Y)
			s.Charges = append(s.Charges, c)
			s.emit(ev)
			sq.hero.Charges--
			sq.hero.work = 0
			sq.Order = Order{Kind: OrderHold, X: t.X, Y: t.Y, Tick: s.Tick}
		case OrderSeize:
			v := s.SquadAny(sq.Order.Contact)
			if v == nil || !v.Alive || v.Side == sq.Side {
				sq.hero.work = 0
				break
			}
			vx, vy := v.Center()
			if dist(t.X, t.Y, vx, vy) > seizeReach(u) {
				sq.hero.work = 0
				break
			}
			sq.hero.work++
			if float64(sq.hero.work) >= u.SeizeSeconds*float64(s.R.TickRate) {
				s.seize(sq, v)
			}
		default:
			sq.hero.work = 0
		}
		// Dread: enemy fireteams near an infiltrator lose their nerve, up to shaken.
		if u.Dread > 0 {
			limit := math.Min(1, s.R.Nerve.ShakenAt+0.12)
			for _, o := range live {
				if o.sq.Side == sq.Side || o.t.Members == 0 || o.sq.haul != nil || o.t.Stress >= limit || dist(t.X, t.Y, o.t.X, o.t.Y) > u.DreadRadius {
					continue
				}
				o.t.Stress = math.Min(limit, o.t.Stress+u.Dread*s.dt*s.rankOf(o.sq).Nerve)
			}
		}
	}
	s.burn()
	s.grip()
}

// burn counts the charges down and sets off the ones whose fuse has run out. The damage
// lands with the tick's other damage, so a charge can be what brings a structure down.
func (s *Sim) burn() {
	kept := s.Charges[:0]
	for _, c := range s.Charges {
		if c.Ticks--; c.Ticks > 0 {
			kept = append(kept, c)
			continue
		}
		ev := Event{Kind: EvChargeBlew, Point: s.nearestPoint(c.X, c.Y)}
		switch {
		case c.HQ:
			s.Sides[1-c.Side].HQHP -= c.Damage * c.VsHQ // a headquarters is built to take it
			ev.Place = s.R.HQPoint(1 - c.Side).ID
		case c.Structure != 0:
			st := s.structure(c.Structure)
			if st == nil || st.Ruin {
				continue
			}
			st.dmg += c.Damage
			st.hit = true
			ev.Structure, ev.Unit = st.PlaceID(), st.Kind
		case c.Bridge > 0:
			b := &s.Bridges[c.Bridge-1]
			if !b.Standing {
				continue
			}
			b.dmg += c.Damage
			b.by[c.Side] = true
			ev.Place = b.ID
		}
		for side := range s.Sides {
			if side == c.Side || c.HQ || s.InSight(side, c.X, c.Y) {
				ev.Side = side
				s.emit(ev)
			}
		}
	}
	s.Charges = kept
}

// seize hands a vehicle squad to the hero's side for as long as the hero holds it. The
// squad takes a number of its new side's, so that its callsign there is its own.
func (s *Sim) seize(h, v *Squad) {
	s.release(h.ID) // one at a time
	from := v.Side
	x, y := v.Center()
	s.seized = append(s.seized, seizure{Squad: v.ID, Hero: h.ID, From: from, Num: v.Num})
	was := s.Callsign(v)
	s.emit(Event{Side: from, Kind: EvSquadLost, Squad: v.ID, Point: s.nearestPoint(x, y), Reason: ReasonSeized, Was: &was})
	sd := &s.Sides[h.Side]
	sd.nextNum[v.unit.CallClass()]++
	s.changeSide(v, h.Side, sd.nextNum[v.unit.CallClass()])
	s.emit(Event{Side: h.Side, Kind: EvSquadSpawned, Squad: v.ID, Point: s.nearestPoint(x, y), Reason: ReasonSeized})
	h.hero.Seized, h.hero.work = v.ID, 0
	hx, hy := h.Center()
	h.Order = Order{Kind: OrderHold, X: hx, Y: hy, Tick: s.Tick}
}

// changeSide moves a squad to a side with a number there. It stands where it is, and
// nobody keeps an order that was about it as an enemy.
func (s *Sim) changeSide(v *Squad, side, num int) {
	v.Side, v.Num = side, num
	x, y := v.Center()
	v.Order = Order{Kind: OrderHold, X: x, Y: y, Tick: s.Tick}
	v.Contacts, v.inContact = v.Contacts[:0], false
	for i := range v.Teams {
		v.Teams[i].path, v.Teams[i].blocked = nil, 0
	}
	for _, sq := range s.Squads {
		if sq.Alive && sq != v && sq.Order.Contact == v.ID {
			cx, cy := sq.Center()
			sq.Order = Order{Kind: OrderHold, X: cx, Y: cy, Tick: s.Tick}
		}
	}
}

// release gives back whatever a hero holds.
func (s *Sim) release(hero int) {
	kept := s.seized[:0]
	for _, z := range s.seized {
		if z.Hero != hero {
			kept = append(kept, z)
			continue
		}
		v := s.SquadAny(z.Squad)
		if h := s.SquadAny(hero); h != nil && h.hero != nil {
			h.hero.Seized = 0
		}
		if v == nil || !v.Alive {
			continue
		}
		x, y := v.Center()
		taker := v.Side
		was := s.Callsign(v)
		s.emit(Event{Side: taker, Kind: EvSquadLost, Squad: v.ID, Point: s.nearestPoint(x, y), Reason: ReasonReturned, Was: &was})
		s.changeSide(v, z.From, z.Num)
		s.emit(Event{Side: z.From, Kind: EvSquadSpawned, Squad: v.ID, Point: s.nearestPoint(x, y), Reason: ReasonReturned})
	}
	s.seized = kept
}

// grip lets go of a seized squad when its hero has fallen or gone too far from it.
func (s *Sim) grip() {
	for _, z := range append([]seizure{}, s.seized...) {
		h, v := s.SquadAny(z.Hero), s.SquadAny(z.Squad)
		if v == nil || !v.Alive {
			s.release(z.Hero) // nothing left to give back; the record goes
			continue
		}
		if h == nil || !h.Alive {
			s.release(z.Hero)
			continue
		}
		hx, hy := h.Center()
		vx, vy := v.Center()
		if dist(hx, hy, vx, vy) > h.unit.SeizeRadius {
			s.release(z.Hero)
		}
	}
}

// SeizedFrom reports the side a squad was taken from, when a hero holds it now.
func (s *Sim) SeizedFrom(id int) (side int, ok bool) {
	for _, z := range s.seized {
		if z.Squad == id {
			return z.From, true
		}
	}
	return 0, false
}

// viewExtras adds to a squad's view what this workstream knows about it.
func (s *Sim) viewExtras(sq *Squad, v *SquadView) {
	if sq.Rank > 0 && sq.Rank <= len(s.R.Ranks) {
		v.Rank = s.R.Ranks[sq.Rank-1].ID
	}
	v.Kills = round3(s.rankProgress(sq))
	v.Dug = sq.Dug
	if sq.Order.Kind == OrderFortify {
		v.Dig = round3(math.Min(1, float64(sq.dig)/math.Max(1, s.R.Match.FortifySeconds*float64(s.R.TickRate))))
	}
	if sq.hero != nil && len(sq.Teams) > 0 {
		h := &HeroView{Charges: sq.hero.Charges, Seized: sq.hero.Seized, HP: round3(math.Max(0, sq.Teams[0].HP/sq.unit.HP))}
		switch sq.Order.Kind {
		case OrderPlant:
			h.Work = round3(float64(sq.hero.work) / math.Max(1, sq.unit.PlantSeconds*float64(s.R.TickRate)))
		case OrderSeize:
			h.Work = round3(float64(sq.hero.work) / math.Max(1, sq.unit.SeizeSeconds*float64(s.R.TickRate)))
		}
		v.Hero = h
	}
}

// snapCharges lists the charges a side may know of: its own, and the ones in its sight.
func (s *Sim) snapCharges(snap *Snapshot, side int) {
	snap.Charges = []ChargeView{}
	for _, z := range s.seized {
		if z.From == side {
			snap.Taken++
		}
	}
	rate := float64(s.R.TickRate)
	for _, c := range s.Charges {
		if side != Spectator && c.Side != side && !s.InSight(side, c.X, c.Y) {
			continue
		}
		v := ChargeView{Side: c.Side, X: round1(c.X), Y: round1(c.Y), Left: round1(float64(c.Ticks) / rate), Total: round1(float64(c.Total) / rate)}
		if st := s.structure(c.Structure); st != nil {
			v.Place = st.PlaceID()
		} else if c.HQ {
			v.Place = s.R.HQPoint(1 - c.Side).ID
		} else if c.Bridge > 0 {
			v.Place = s.Bridges[c.Bridge-1].ID
		}
		snap.Charges = append(snap.Charges, v)
	}
}

// hashHeroes puts what heroes, ranks, sandbags and seizures add to the state into its hash.
func (s *Sim) hashHeroes(put func(uint64), f func(float64)) {
	for _, sq := range s.Squads {
		put(uint64(sq.Side))
		put(uint64(sq.Num))
		put(uint64(sq.Rank))
		f(sq.Kills)
		put(uint64(sq.Dug))
		put(uint64(sq.dig))
		if sq.hero != nil {
			put(uint64(sq.hero.Charges))
			put(uint64(sq.hero.work))
			put(uint64(sq.hero.Seized))
		}
	}
	for _, c := range s.Charges {
		put(uint64(c.Structure))
		put(uint64(c.Bridge))
		put(uint64(c.Ticks))
		f(c.X)
	}
	for _, z := range s.seized {
		put(uint64(z.Squad))
		put(uint64(z.Hero))
	}
	for i := range s.Landmarks {
		if l := &s.Landmarks[i]; l.Built {
			f(l.X)
			f(l.Y)
			f(l.FaceX)
			f(l.FaceY)
			put(uint64(l.By))
		}
	}
}
