package sim

import (
	"errors"
	"fmt"
	"math"

	"callsign/shared"
)

// Gold is collected. A gusher throws gold into the field around it; haulers drive out,
// load, and bring it back to a drop-off, where it becomes gold the side can spend.
//
// A hauler is a squad of one unarmed vehicle with no leader agent. It runs on its own
// utility AI below, does not count toward the squad population cap, and never appears in
// a side's list of squads: it has its own list in the snapshot.

// What a hauler is doing. Players see these words.
const (
	HaulOut       = "out"       // driving to a field
	HaulLoading   = "loading"   // standing in the field, filling up
	HaulReturning = "returning" // bringing its load home
	HaulUnloading = "unloading" // emptying at the drop-off
	HaulFleeing   = "fleeing"   // under fire, running for home
	HaulWaiting   = "waiting"   // at the drop-off with no field worth driving to
)

const (
	EvHaulerAttacked = "hauler_attacked"
	EvHaulerLost     = "hauler_lost"

	CmdHaul = "haul"

	// HaulAuto as a field tells haulers to choose for themselves again.
	HaulAuto = "auto"

	// HaulerIDBase is where hauler ids start: the first hauler raised is HaulerIDBase+1.
	HaulerIDBase = 1000
)

var (
	ErrNoField   = errors.New("no such gold field")
	ErrNoHauler  = errors.New("no such hauler on your side")
	ErrHaulerCap = errors.New("hauler cap reached")
)

// How the hauler AI reads danger, in seconds.
const (
	haulFleeSeconds   = 8   // a hauler shot at keeps running this long after the last shot
	haulAlarmSeconds  = 20  // at most one "hauler attacked" event per hauler in this time
	fieldDangerSecs   = 30  // a field where a hauler was shot at is avoided this long
	fieldThreatRadius = 260 // an armed enemy seen this close to a gusher makes its field dangerous now
	haulWorthLoading  = 20  // gold a field must hold before a hauler drives out for it
	haulShare         = 0.6 // of its capacity: what a field must hold for each hauler working it before another joins
	haulEnemySide     = 60  // a field this much nearer the enemy headquarters than home is left alone
)

// FieldState is the gold lying around one gusher.
type FieldState struct {
	*shared.Gusher
	Gold float64
}

// haul is the working state of one hauler.
type haul struct {
	State    string
	Load     float64 // gold on board
	Assigned string  // gusher id the operator sent it to, "" to choose for itself
	Field    string  // gusher id it is working now, "" when none
	work     int     // ticks spent unloading
	alarm    int     // tick of its last "attacked" event
}

// fieldMemory is a field as a side last saw it.
type fieldMemory struct {
	Gold    float64
	Visible bool
	danger  int // tick until which this side treats the field as under fire
}

// haulerMemory is an enemy hauler as a side last saw it.
type haulerMemory struct {
	ID      int
	Unit    string
	X, Y    float64
	Load    float64 // share of its capacity
	State   string
	Visible bool
}

// incomeWindow is how many seconds the income figure looks back over.
const incomeWindow = 60

func (s *Sim) initHaul(startGold int) {
	for i := range s.R.Gushers {
		g := &s.R.Gushers[i]
		s.Fields = append(s.Fields, FieldState{Gusher: g, Gold: g.StartGold})
	}
	for side := range s.Sides {
		sd := &s.Sides[side]
		sd.goldUnit = int64(startGold) * int64(s.R.TickRate)
		sd.fields = make([]fieldMemory, len(s.Fields))
		for i := range s.Fields {
			sd.fields[i] = fieldMemory{Gold: s.Fields[i].Gold, danger: never}
		}
		if id, _ := s.R.HaulerOf(sd.Faction); id != "" {
			for n := 0; n < s.R.Match.StartHaulers; n++ {
				s.field(s.raise(side, id))
			}
		}
	}
}

// IsHauler reports whether a squad is a gold hauler.
func (sq *Squad) IsHauler() bool { return sq.haul != nil }

// Haulers counts a side's haulers, on the field or on their way.
func (s *Sim) Haulers(side int) int {
	n := 0
	for _, sq := range s.Squads {
		if sq.Side == side && sq.haul != nil && (sq.Alive || sq.Deploying()) {
			n++
		}
	}
	return n
}

// dropoff is a place a side's haulers unload at.
type dropoff struct{ X, Y float64 }

// dropoffs lists where a side's haulers may unload. Today that is the headquarters; a
// refinery, once structures exist, is added here and nowhere else.
func (s *Sim) dropoffs(side int) []dropoff {
	hq := s.R.HQPoint(side)
	return []dropoff{{hq.X, hq.Y}}
}

// haulerAllowed says whether a side may buy a hauler now. A hauler needs a refinery;
// until structures exist every side counts as having one. This is the only place the
// requirement is checked.
func (s *Sim) haulerAllowed(side int) error { return nil }

// unloadSpot is where a hauler stops at a drop-off: just off it, toward the middle of
// the map, so that haulers do not park on top of the building. (Moving this spot moves
// the scripted balance a great deal: re-run the 200 games after touching it.)
func (s *Sim) unloadSpot(d dropoff, id int) (float64, float64) {
	inward := 1.0
	if d.X > s.R.Map.Width/2 {
		inward = -1
	}
	return s.clamp("land", d.X+inward*62, d.Y+34+float64(id%3)*16)
}

// nearestDropoff is the drop-off a hauler at (x, y) heads for.
func (s *Sim) nearestDropoff(side int, x, y float64) dropoff {
	sites := s.dropoffs(side)
	best := sites[0]
	for _, d := range sites[1:] {
		if dist(x, y, d.X, d.Y) < dist(x, y, best.X, best.Y) {
			best = d
		}
	}
	return best
}

// loadSpot is where a hauler stands in a field: each hauler has its own place on a ring
// around the gusher.
func (s *Sim) loadSpot(f *FieldState, id int) (float64, float64) {
	a := float64(id) * 2.399963 // the golden angle keeps neighbours apart
	r := f.FieldRadius * 0.55
	return s.clamp("land", f.X+r*math.Cos(a), f.Y+r*math.Sin(a)*0.8)
}

func (s *Sim) fieldIndex(id string) int {
	for i := range s.Fields {
		if s.Fields[i].ID == id {
			return i
		}
	}
	return -1
}

// fieldDangerous reports whether a side knows a field to be under fire: one of its
// haulers was shot at there a moment ago, or it sees an armed enemy beside the gusher.
func (s *Sim) fieldDangerous(side, i int, live []*teamRef) bool {
	if s.Tick <= s.Sides[side].fields[i].danger {
		return true
	}
	f := &s.Fields[i]
	for _, o := range live {
		if o.sq.Side != side && o.t.Spotted && o.u.Damage > 0 && dist(o.t.X, o.t.Y, f.X, f.Y) <= fieldThreatRadius {
			return true
		}
	}
	return false
}

// workers counts a side's other haulers that work a field now.
func (s *Sim) workers(side int, field string, but *Squad) int {
	n := 0
	for _, sq := range s.Squads {
		if sq != but && sq.haul != nil && sq.Alive && sq.Side == side && sq.haul.Field == field &&
			(sq.haul.State == HaulOut || sq.haul.State == HaulLoading) {
			n++
		}
	}
	return n
}

// chooseField picks the field a hauler works: the one it was sent to, or else the nearest
// field, not known to be under fire, that holds enough gold for this hauler on top of
// the side's haulers already working it. When no field has that much, the one with the
// most gold a hauler is taken. -1 is none.
func (s *Sim) chooseField(tr *teamRef, live []*teamRef) int {
	h, side := tr.sq.haul, tr.sq.Side
	if i := s.fieldIndex(h.Assigned); i >= 0 {
		return i
	}
	near, nd := -1, math.MaxFloat64
	rich, most := -1, 0.0
	for i := range s.Fields {
		f := &s.Fields[i]
		if f.Gold < haulWorthLoading || s.fieldDangerous(side, i, live) {
			continue
		}
		home := s.nearestDropoff(side, f.X, f.Y)
		// A field on the enemy's doorstep is not one to drive to unasked.
		if enemy := s.R.HQPoint(1 - side); dist(f.X, f.Y, enemy.X, enemy.Y)+haulEnemySide < dist(f.X, f.Y, home.X, home.Y) {
			continue
		}
		crew := float64(1 + s.workers(side, f.ID, tr.sq))
		if each := f.Gold / crew; each > most {
			rich, most = i, each
		}
		if f.Gold < haulShare*tr.u.Capacity*crew {
			continue // not enough here for one more
		}
		if d := dist(tr.t.X, tr.t.Y, f.X, f.Y) + dist(f.X, f.Y, home.X, home.Y); d < nd {
			near, nd = i, d
		}
	}
	if near >= 0 {
		return near
	}
	return rich
}

// keepField reports whether a hauler that chose its own field should stay with it: the
// field is still safe, and there is gold to drive for, or to finish loading.
func (s *Sim) keepField(tr *teamRef, live []*teamRef) bool {
	h := tr.sq.haul
	i := s.fieldIndex(h.Field)
	if i < 0 || s.fieldDangerous(tr.sq.Side, i, live) {
		return false
	}
	if h.State == HaulLoading {
		return s.Fields[i].Gold >= 1 || h.Load > 0
	}
	return s.Fields[i].Gold >= haulWorthLoading
}

// haulPlan is the hauler's utility AI: where it drives this tick. It also moves the
// hauler from one working state to the next.
func (s *Sim) haulPlan(tr *teamRef, live []*teamRef) plan {
	sq, t, h := tr.sq, tr.t, tr.sq.haul
	rate := s.R.TickRate
	home := s.nearestDropoff(sq.Side, t.X, t.Y)
	hx, hy := s.unloadSpot(home, sq.ID)
	atHome := dist(t.X, t.Y, hx, hy) <= 3

	if s.Tick-t.lastShot <= haulFleeSeconds*rate {
		// Under fire: run for home, and remember that the field is not safe.
		if h.State != HaulFleeing {
			if i := s.fieldIndex(h.Field); i >= 0 {
				s.Sides[sq.Side].fields[i].danger = s.Tick + fieldDangerSecs*rate
			}
			if s.Tick-h.alarm > haulAlarmSeconds*rate {
				h.alarm = s.Tick
				s.emit(Event{Side: sq.Side, Kind: EvHaulerAttacked, Hauler: sq.ID, Point: s.nearestPoint(t.X, t.Y), Field: h.Field})
			}
		}
		h.State, h.Field = HaulFleeing, ""
		if atHome {
			return plan{act: ActCover}
		}
		return plan{act: ActFallBack, x: hx, y: hy}
	}

	if h.State == HaulFleeing || h.State == "" {
		h.State = HaulOut
		if h.Load > 0 {
			h.State = HaulReturning
		}
	}
	if h.State == HaulWaiting && s.Tick%rate == sq.ID%rate {
		h.State = HaulOut // look again once a second
	}
	if h.State == HaulOut || h.State == HaulLoading {
		// A hauler stays with the field it chose until it is unsafe or empty; one that
		// was sent somewhere goes there whatever it finds.
		i := s.fieldIndex(h.Field)
		if h.Assigned != "" || !s.keepField(tr, live) {
			i = s.chooseField(tr, live)
		}
		switch {
		case i < 0 && h.Load > 0:
			h.State, h.Field = HaulReturning, ""
		case i < 0:
			h.State, h.Field = HaulWaiting, ""
		default:
			f := &s.Fields[i]
			if h.Field != f.ID {
				h.State, h.Field = HaulOut, f.ID
			}
			fx, fy := s.loadSpot(f, sq.ID)
			if dist(t.X, t.Y, fx, fy) > 3 {
				h.State = HaulOut
				return plan{act: ActAdvance, x: fx, y: fy}
			}
			h.State = HaulLoading
			return plan{act: ActIdle}
		}
	}
	switch h.State {
	case HaulReturning:
		if !atHome {
			return plan{act: ActAdvance, x: hx, y: hy}
		}
		h.State, h.work = HaulUnloading, 0
	case HaulWaiting:
		if !atHome {
			return plan{act: ActAdvance, x: hx, y: hy}
		}
	}
	return plan{act: ActIdle}
}

// haulWork runs the economy for one tick: gushers fill their fields, haulers load and
// unload, and the headquarters adds its trickle. Haulers are served in id order.
func (s *Sim) haulWork() {
	for i := range s.Fields {
		f := &s.Fields[i]
		f.Gold = math.Min(f.FieldCap, f.Gold+f.RatePerSecond*s.dt)
	}
	for _, sq := range s.Squads {
		h := sq.haul
		if h == nil || !sq.Alive {
			continue
		}
		u := sq.unit
		switch h.State {
		case HaulLoading:
			i := s.fieldIndex(h.Field)
			if i < 0 {
				h.State = HaulOut
				continue
			}
			f := &s.Fields[i]
			take := math.Min(math.Min(u.Capacity/u.LoadSeconds*s.dt, f.Gold), u.Capacity-h.Load)
			f.Gold -= take
			h.Load += take
			// Full, or the field has run dry under it: take home what it has.
			if h.Load >= u.Capacity-1e-9 || (f.Gold < 1 && h.Load >= u.Capacity*0.25) {
				h.State = HaulReturning
			}
		case HaulUnloading:
			h.work++
			if float64(h.work) >= u.UnloadSeconds*float64(s.R.TickRate) {
				s.earn(sq.Side, int64(math.Round(h.Load*float64(s.R.TickRate))))
				// Each trip starts with a fresh look at the fields.
				h.Load, h.State, h.work, h.Field = 0, HaulOut, 0, ""
			}
		}
	}
	for side := range s.Sides {
		s.earn(side, int64(s.R.Match.HQTrickle+s.rigIncome(side)))
	}
	if (s.Tick+1)%s.R.TickRate == 0 {
		for side := range s.Sides {
			sd := &s.Sides[side]
			sd.earnedAt = (sd.earnedAt + 1) % incomeWindow
			sd.earned[sd.earnedAt] = 0
			if sd.earnedSecs < incomeWindow {
				sd.earnedSecs++
			}
		}
	}
}

// earn adds gold (in gold × tick rate) to a side and to its income figure.
func (s *Sim) earn(side int, units int64) {
	sd := &s.Sides[side]
	sd.goldUnit += units
	sd.earned[sd.earnedAt] += units
}

// rigIncome is the gold per second a side's captured rigs pump on their own.
func (s *Sim) rigIncome(side int) int {
	total := 0
	for i := range s.Points {
		if s.Points[i].Owner == side {
			total += s.R.Rigs[s.Points[i].Kind].Income
		}
	}
	return total
}

// Income is a side's gold per minute, measured over the last minute of the match. In the
// first minute it is scaled up from the seconds played so far.
func (s *Sim) Income(side int) int {
	sd := &s.Sides[side]
	var sum int64
	for _, v := range sd.earned {
		sum += v
	}
	secs := sd.earnedSecs
	if secs < 5 {
		// Too early to measure: what the side makes standing still.
		return (s.R.Match.HQTrickle + s.rigIncome(side)) * 60
	}
	sum -= sd.earned[sd.earnedAt] // the second still running is not a whole one
	return int(math.Round(float64(sum) / float64(s.R.TickRate) * 60 / float64(secs)))
}

// haulerLost reports a destroyed hauler to both sides.
func (s *Sim) haulerLost(tr *teamRef) {
	sq := tr.sq
	sq.Alive = false
	near := s.nearestPoint(tr.t.X, tr.t.Y)
	s.emit(Event{Side: sq.Side, Kind: EvHaulerLost, Hauler: sq.ID, Point: near, Count: int(math.Round(sq.haul.Load))})
	s.emit(Event{Side: 1 - sq.Side, Kind: EvEnemyDestroyed, Contact: sq.ID, Point: near})
}

// buyHauler is buy for a hauler: it has its own cap and needs a refinery.
func (s *Sim) buyHauler(c Command, u shared.Unit) error {
	if err := s.haulerAllowed(c.Side); err != nil {
		return err
	}
	if s.Haulers(c.Side) >= s.R.Match.HaulerCap {
		return fmt.Errorf("%w: %d of %d", ErrHaulerCap, s.Haulers(c.Side), s.R.Match.HaulerCap)
	}
	return nil
}

// haulCommand sends a side's haulers to a field, or lets them choose again ("auto"). With
// a hauler id only that one is told. It returns the first hauler told.
func (s *Sim) haulCommand(c Command) (*Squad, error) {
	if c.Field != HaulAuto && s.fieldIndex(c.Field) < 0 {
		return nil, fmt.Errorf("%w: %q", ErrNoField, c.Field)
	}
	assigned := c.Field
	if assigned == HaulAuto {
		assigned = ""
	}
	var first *Squad
	for _, sq := range s.Squads {
		if sq.haul == nil || sq.Side != c.Side || !(sq.Alive || sq.Deploying()) || (c.Hauler != 0 && sq.ID != c.Hauler) {
			continue
		}
		sq.haul.Assigned = assigned
		// A hauler that is filling up elsewhere finishes its trip from the new field.
		if sq.haul.State == HaulLoading || sq.haul.State == HaulOut || sq.haul.State == HaulWaiting {
			sq.haul.State, sq.haul.Field = HaulOut, "" // choose again, or go where it was sent
		}
		if first == nil {
			first = sq
		}
	}
	if first == nil {
		return nil, ErrNoHauler
	}
	return first, nil
}

// observeHaul updates what a side remembers of the fields and of the enemy's haulers.
func (s *Sim) observeHaul(side int) {
	sd := &s.Sides[side]
	for i := range s.Fields {
		f, m := &s.Fields[i], &sd.fields[i]
		m.Visible = s.InSight(side, f.X, f.Y)
		if m.Visible {
			m.Gold = f.Gold
		}
	}
	// Forget an enemy hauler when the place it was last seen is in sight and it is not there.
	kept := sd.haulers[:0]
	for _, m := range sd.haulers {
		sq := s.SquadAny(m.ID)
		m.Visible = sq.Alive && s.visible(sq)
		if !m.Visible && s.InSight(side, m.X, m.Y) {
			continue
		}
		kept = append(kept, m)
	}
	sd.haulers = kept
	for _, sq := range s.Squads {
		if sq.haul == nil || sq.Side == side || !sq.Alive || !s.visible(sq) {
			continue
		}
		t := &sq.Teams[0]
		seen := haulerMemory{ID: sq.ID, Unit: sq.Unit, X: t.X, Y: t.Y, Load: sq.haul.Load / sq.unit.Capacity, State: sq.haul.State, Visible: true}
		found := false
		for i := range sd.haulers {
			if sd.haulers[i].ID == sq.ID {
				sd.haulers[i], found = seen, true
			}
		}
		if !found {
			sd.haulers = append(sd.haulers, seen)
		}
	}
}

// FieldView is a field as a side sees it: the gold in it as a share of its cap.
type FieldView struct {
	Gusher  string  `json:"gusher"`
	Gold    float64 `json:"gold"`    // 0…1 of the field's cap
	Visible bool    `json:"visible"` // in sight now; otherwise as last seen
}

// HaulerView is a hauler: a side's own, or an enemy one as last seen.
type HaulerView struct {
	ID       int         `json:"id"`
	Side     int         `json:"side"`
	Callsign shared.Text `json:"callsign"`
	Unit     string      `json:"unit"`
	State    string      `json:"state"`
	Load     float64     `json:"load"`            // 0…1 of its capacity
	Field    string      `json:"field,omitempty"` // gusher it works
	Assigned string      `json:"assigned,omitempty"`
	HP       float64     `json:"hp"` // 0…1
	X        float64     `json:"x"`
	Y        float64     `json:"y"`
	Visible  bool        `json:"visible"` // own haulers always; an enemy one only while in sight
}

func (s *Sim) haulerView(sq *Squad) HaulerView {
	t, h := &sq.Teams[0], sq.haul
	return HaulerView{
		ID: sq.ID, Side: sq.Side, Callsign: s.Callsign(sq), Unit: sq.Unit, State: h.State,
		Load: round2(h.Load / sq.unit.Capacity), Field: h.Field, Assigned: h.Assigned,
		HP: round2(math.Max(0, t.HP/sq.unit.HP)), X: round1(t.X), Y: round1(t.Y), Visible: true,
	}
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

// snapHaul fills in the fields and haulers of a snapshot.
func (s *Sim) snapHaul(snap *Snapshot, side int) {
	snap.Fields, snap.Haulers = []FieldView{}, []HaulerView{}
	for i := range s.Fields {
		f := &s.Fields[i]
		v := FieldView{Gusher: f.ID, Gold: round2(f.Gold / f.FieldCap), Visible: true}
		if side != Spectator {
			m := s.Sides[side].fields[i]
			v.Gold, v.Visible = round2(m.Gold/f.FieldCap), m.Visible
		}
		snap.Fields = append(snap.Fields, v)
	}
	for _, sq := range s.Squads {
		if sq.haul != nil && sq.Alive && (side == Spectator || sq.Side == side) {
			snap.Haulers = append(snap.Haulers, s.haulerView(sq))
		}
	}
	if side == Spectator {
		return
	}
	for _, m := range s.Sides[side].haulers {
		sq := s.SquadAny(m.ID)
		snap.Haulers = append(snap.Haulers, HaulerView{
			ID: m.ID, Side: sq.Side, Callsign: s.Callsign(sq), Unit: m.Unit, State: m.State,
			Load: round2(m.Load), X: round1(m.X), Y: round1(m.Y), Visible: m.Visible,
		})
	}
}

// hashHaul folds the economy into the state hash.
func (s *Sim) hashHaul(put func(uint64), f func(float64)) {
	for i := range s.Fields {
		f(s.Fields[i].Gold)
	}
	for _, sq := range s.Squads {
		if h := sq.haul; h != nil {
			put(uint64(len(h.State)))
			for _, b := range []byte(h.State + "|" + h.Assigned + "|" + h.Field) {
				put(uint64(b))
			}
			f(h.Load)
			put(uint64(h.work))
			put(uint64(int64(h.alarm)))
		}
	}
	for i := range s.Sides {
		sd := &s.Sides[i]
		for _, m := range sd.fields {
			f(m.Gold)
			put(uint64(int64(m.danger)))
		}
		for _, m := range sd.haulers {
			put(uint64(m.ID))
			f(m.X)
			f(m.Y)
		}
		for _, v := range sd.earned {
			put(uint64(v))
		}
		put(uint64(sd.earnedAt))
	}
}
