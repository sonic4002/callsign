// Package sim is the authoritative match simulation. It is deterministic: the same
// seed and the same commands on the same ticks always give the same match. It reads no
// clock, runs no goroutines, and never ranges over a map where order could matter.
package sim

import (
	"fmt"
	"math"
	"math/rand/v2"
	"slices"
	"strconv"

	"callsign/shared"
)

const (
	OrderNone   = "none"
	OrderMove   = "move"
	OrderHold   = "hold"
	OrderAttack = "attack"
	OrderRepair = "repair" // stand at a bridge and mend it; fought like a hold
)

const (
	ActIdle     = "idle"
	ActFire     = "fire"
	ActAdvance  = "advance"
	ActCover    = "cover"
	ActFallBack = "fallback"
	ActRepair   = "repair"
)

const (
	Steady = "steady"
	Shaken = "shaken"
	Pinned = "pinned"
)

// NoSide marks a neutral point or a drawn match.
const NoSide = -1

type Config struct {
	Seed          uint64
	Factions      [2]string
	LengthSeconds int // 0 uses the rules default
	// FullBase starts both sides with every base structure standing, so that every unit
	// can be bought from the first second. Tests of other things use it.
	FullBase bool
	// Base starts both sides with these base structures standing, by role, in place of
	// the rules' opening (the headquarters alone). Tests of what comes after the opening
	// use it: a refinery among them has brought its hauler.
	Base      []string
	StartGold int // gold each side starts with; 0 uses the rules default
}

type Side struct {
	ID       int
	Faction  string
	goldUnit int64 // gold × tick rate, so income per tick stays a whole number
	HQHP     float64
	nextNum  map[string]int // next callsign number per unit class
	hqAlarm  int            // tick of the last "HQ under attack" event

	// Fog of war: what this side has seen, and what it last knew.
	explored []byte        // bitset of fog cells seen at any time
	points   []pointMemory // each map point as last seen
	enemyHQ  float64       // enemy headquarters health 0…1 as last seen
	fields   []fieldMemory // each gold field as last seen
	haulers  []haulerMemory

	// Gold earned in each of the last seconds (gold × tick rate), for the income figure.
	earned     [incomeWindow]int64
	earnedAt   int
	earnedSecs int
	lands      []landmarkMemory
	bridges    []bridgeMemory
}

type Order struct {
	Kind    string
	Point   string // map point id, if the order names one
	Contact int    // enemy squad id, for attack orders on a contact
	// Place is the written form of where the order sends the squad, when it named a
	// place: a point, a landmark, a bridge, a structure or an offset from a point.
	Place   string
	X, Y    float64
	Tick    int
	arrived bool
	// Structure is the structure an attack or capture order is on (structures.go).
	Structure int
	work      int // ticks an engineer squad has spent on its capture

	landmark int // index+1 of the landmark named, 0 for none
	bridge   int // index+1 of the bridge named, 0 for none
}

type Team struct {
	X, Y     float64
	HP       float64
	Members  int
	Stress   float64 // 0 calm … 1 broken; nerve is read from this
	Cooldown int
	Action   string
	Spotted  bool // seen by the other side this tick
	lastShot int  // tick this team was last shot at
	lastFire int  // tick this team last fired; firing gives it away for a while
	blocked  int  // id of the fence that stopped this team's last step, or 0

	// In is the id of the building the team is inside, "" when it is in the open.
	In string
	// Cover is the multiplier on hits the team takes from the cover it is in; 1 for none.
	Cover float64

	// The way to where the team is going, when it cannot walk there in a straight line.
	path     [][2]float64
	pathGoal int
	pathVer  int
	pathMode int
	pathTick int
	pathOpen bool // the path gets all the way to where the team is going
	atPost   bool // standing where its orders put it

	// scratch for the tick being resolved
	dmg     float64
	hits    int
	misses  int
	shooter []*Squad
}

type Squad struct {
	ID    int
	Side  int
	Unit  string
	Num   int
	Tier  int
	Alive bool
	Order Order
	Teams []Team
	// Contacts are the enemy squad ids this squad itself can see right now.
	Contacts []int

	// A bought squad is on its way to the field for DeployTicks more ticks; until then it
	// has no teams and is not Alive. DeployTotal is the whole wait, for progress bars.
	DeployTicks int
	DeployTotal int

	unit        *shared.Unit
	haul        *haul // set for a gold hauler, which works on its own and has no leader
	inContact   bool
	lastContact int
	lastPinned  int
}

type PointState struct {
	*shared.Point
	Owner    int
	CapSide  int
	CapTicks int
}

type Sim struct {
	R     *shared.Rules
	Tick  int
	Sides [2]Side
	// Squads is every squad and hauler ever raised, in the order they were raised; dead
	// ones stay with Alive false. A squad's id is not its place in this list: use SquadAny.
	Squads []*Squad
	Points []PointState
	// Structures is everything either side has built, in id order; ruins stay.
	Structures []*Structure
	Fields     []FieldState // the gold lying around each gusher, in rules order
	// Bridges and Landmarks are the map's own, with what has happened to them.
	Bridges   []BridgeState
	Landmarks []LandmarkState
	// Places lets other parts of the game make their own things nameable in orders.
	Places []PlaceFinder
	Over   bool
	Winner int
	Reason string

	squadN, haulerN int // squads and haulers raised so far; ids are counted apart
	nav             *nav
	slots           [2][][2]float64 // where each side's base slots lie on this map (structures.go)
	landIdx         map[string]int  // landmark id → index
	rng             *rand.Rand
	events          []Event
	lengthTicks     int
	dt              float64
}

const never = -1 << 30

func New(r *shared.Rules, cfg Config) (*Sim, error) {
	s := &Sim{
		R:      r,
		Winner: NoSide,
		rng:    rand.New(rand.NewPCG(cfg.Seed, cfg.Seed^0x9e3779b97f4a7c15)),
		dt:     1 / float64(r.TickRate),
	}
	length := cfg.LengthSeconds
	if length <= 0 {
		length = r.Match.LengthSeconds
	}
	s.lengthTicks = length * r.TickRate
	for i := range r.Map.Points {
		p := &r.Map.Points[i]
		s.Points = append(s.Points, PointState{Point: p, Owner: p.Owner, CapSide: NoSide})
	}
	s.initBridges()
	s.initNav()
	s.initLandmarks()
	gold := cfg.StartGold
	if gold <= 0 {
		gold = r.Match.StartGold
	}
	for side := 0; side < 2; side++ {
		f, ok := r.Factions[cfg.Factions[side]]
		if !ok {
			return nil, fmt.Errorf("unknown faction %q", cfg.Factions[side])
		}
		s.Sides[side] = Side{
			ID:       side,
			Faction:  cfg.Factions[side],
			goldUnit: int64(gold) * int64(r.TickRate),
			HQHP:     r.HQ.HP,
			nextNum:  map[string]int{},
			hqAlarm:  never,
		}
		for _, u := range f.StartUnits {
			s.field(s.raise(side, u))
		}
	}
	s.initStructures(cfg.FullBase, cfg.Base)
	startGold := cfg.StartGold
	if startGold <= 0 {
		startGold = r.Match.StartGold
	}
	s.initHaul(startGold)
	// What is built or lies on the ground can be named in an order like the map's own places.
	s.Places = append(s.Places, s.structurePlace, s.fieldPlace)
	s.initFog()
	return s, nil
}

// Gold is the whole gold a side can spend.
func (s *Sim) Gold(side int) int { return int(s.Sides[side].goldUnit / int64(s.R.TickRate)) }

// LengthTicks is the tick the timer runs out on.
func (s *Sim) LengthTicks() int { return s.lengthTicks }

// Squad returns a living squad by id, or nil.
func (s *Sim) Squad(id int) *Squad {
	if sq := s.SquadAny(id); sq != nil && sq.Alive {
		return sq
	}
	return nil
}

// SquadAny returns a squad or hauler by id whether it is alive or not, or nil.
func (s *Sim) SquadAny(id int) *Squad {
	for _, sq := range s.Squads {
		if sq.ID == id {
			return sq
		}
	}
	return nil
}

// Callsign is the squad's radio name in both languages, e.g. Viper 2 / צפע 2.
func (s *Sim) Callsign(sq *Squad) shared.Text {
	c := s.R.Callsigns.Classes[sq.unit.Class]
	if sq.haul != nil {
		c = s.R.Callsigns.Hauler // a name for the player to read; haulers are not on the net
	}
	n := strconv.Itoa(sq.Num)
	return shared.Text{En: c.En + " " + n, He: c.He + " " + n}
}

// Class is the squad's unit class (infantry, vehicle, naval, air).
func (sq *Squad) Class() string { return sq.unit.Class }

// Center is the middle of the squad's living teams.
func (sq *Squad) Center() (x, y float64) {
	n := 0.0
	for i := range sq.Teams {
		if sq.Teams[i].Members > 0 {
			x += sq.Teams[i].X
			y += sq.Teams[i].Y
			n++
		}
	}
	if n == 0 {
		return 0, 0
	}
	return x / n, y / n
}

// Strength is living members and the squad's full size.
func (sq *Squad) Strength() (alive, full int) {
	for i := range sq.Teams {
		alive += sq.Teams[i].Members
	}
	return alive, sq.unit.Teams * sq.unit.Members
}

// Nerve reads a team's stress as the three states players can see in its behaviour.
func (s *Sim) Nerve(t *Team) string {
	switch {
	case t.Stress >= s.R.Nerve.PinnedAt:
		return Pinned
	case t.Stress >= s.R.Nerve.ShakenAt:
		return Shaken
	}
	return Steady
}

// raise creates a squad with its id and callsign number, not yet on the field.
func (s *Sim) raise(side int, unitID string) *Squad {
	u, _ := s.unitFor(side, unitID)
	sd := &s.Sides[side]
	sd.nextNum[u.Class]++
	// Haulers are numbered apart from squads, so that buying one never shifts a squad's id.
	var id int
	if u.Class == shared.HaulerClass {
		s.haulerN++
		id = HaulerIDBase + s.haulerN
	} else {
		s.squadN++
		id = s.squadN
	}
	sq := &Squad{
		ID: id, Side: side, Unit: unitID, Num: sd.nextNum[u.Class],
		Tier: 1, unit: &u,
		Order:       Order{Kind: OrderNone},
		lastContact: never, lastPinned: never,
	}
	if u.Class == shared.HaulerClass {
		sq.haul = &haul{State: HaulOut, alarm: never}
	}
	s.Squads = append(s.Squads, sq)
	return sq
}

// field puts a raised squad beside its headquarters, alive and ready for orders.
func (s *Sim) field(sq *Squad) {
	u, side := sq.unit, sq.Side
	hq := s.R.HQPoint(side)
	inward := 1.0
	if hq.X > s.R.Map.Width/2 {
		inward = -1
	}
	// Squads form up in a column beside the HQ so they do not start on top of each other.
	slot := float64((sq.Num - 1) % 4)
	cx, cy := hq.X+inward*70, hq.Y-90+slot*60
	if u.Domain == "sea" {
		// Boats put in at the water nearest the headquarters, strung out along it.
		cx, cy = s.nav.snapXY(navWater, hq.X, hq.Y)
		cx, cy = s.nav.snapXY(navWater, cx+inward*slot*50, cy+40)
	}
	for i := 0; i < u.Teams; i++ {
		ox, oy := formation(i, u.Teams, side)
		x, y := s.clamp(u.Domain, cx+ox, cy+oy)
		sq.Teams = append(sq.Teams, Team{
			X: x, Y: y, HP: u.HP * float64(u.Members), Members: u.Members,
			Action: ActIdle, lastShot: never, lastFire: never, Cover: 1,
		})
	}
	sq.Alive, sq.DeployTicks = true, 0
	if sq.haul != nil {
		return // no leader joins the net for a hauler
	}
	s.emit(Event{Side: side, Kind: EvSquadSpawned, Squad: sq.ID})
}

// deploy counts down the squads on their way and fields the ones whose time has come.
func (s *Sim) deploy() {
	for _, sq := range s.Squads {
		if sq.DeployTicks == 0 {
			continue
		}
		if sq.DeployTicks--; sq.DeployTicks == 0 {
			s.field(sq)
		}
	}
}

// Deploying reports whether a squad has been bought and has not reached the field yet.
func (sq *Squad) Deploying() bool { return sq.DeployTicks > 0 }

// formation is a team's slot around the squad's position. The shape is mirrored for the
// east side, so both sides meet the enemy with the same teams in front.
func formation(i, n, side int) (float64, float64) {
	if n == 1 {
		return 0, 0
	}
	a := 2 * math.Pi * float64(i) / float64(n)
	x, y := 22*math.Cos(a), 22*math.Sin(a)
	if side == 1 {
		x = -x
	}
	return x, y
}

// clamp keeps a position on the map and on terrain the unit's domain can be on: the
// nearest water for a boat, the nearest walkable ground for a land unit.
func (s *Sim) clamp(domain string, x, y float64) (float64, float64) {
	const edge = 10
	x = math.Max(edge, math.Min(s.R.Map.Width-edge, x))
	y = math.Max(edge, math.Min(s.R.Map.Height-edge, y))
	switch domain {
	case "air":
		return x, y
	case "sea":
		return s.nav.snapXY(navWater, x, y)
	}
	return s.nav.snapXY(navGround, x, y)
}

func (s *Sim) pointState(id string) *PointState {
	for i := range s.Points {
		if s.Points[i].ID == id {
			return &s.Points[i]
		}
	}
	return nil
}

// nearestPoint names the map point closest to a position.
func (s *Sim) nearestPoint(x, y float64) string {
	best, bd := "", math.MaxFloat64
	for i := range s.Points {
		if d := dist(x, y, s.Points[i].X, s.Points[i].Y); d < bd {
			best, bd = s.Points[i].ID, d
		}
	}
	return best
}

func dist(ax, ay, bx, by float64) float64 {
	dx, dy := ax-bx, ay-by
	return math.Sqrt(dx*dx + dy*dy)
}

// teamRef is one living team with its squad and stats, valid for one tick.
type teamRef struct {
	sq   *Squad
	t    *Team
	u    *shared.Unit
	slot int // index of the team inside its squad
	plan plan
}

func (s *Sim) liveTeams() []*teamRef {
	var out []*teamRef
	for _, sq := range s.Squads {
		if !sq.Alive {
			continue
		}
		for i := range sq.Teams {
			if sq.Teams[i].Members > 0 {
				out = append(out, &teamRef{sq: sq, t: &sq.Teams[i], u: sq.unit, slot: i})
			}
		}
	}
	return out
}

// Step advances the match by one tick and returns what happened.
func (s *Sim) Step() []Event {
	if s.Over {
		return nil
	}
	s.deploy()
	s.construct()

	live := s.liveTeams()
	s.countGarrisons()
	s.spot(live)
	s.trackContacts()
	s.trackStructures()
	s.trackObjects()
	for _, tr := range live {
		tr.plan = s.decide(tr, live)
	}
	for _, tr := range live {
		s.move(tr)
	}
	s.enterBuildings(live)
	for _, tr := range live {
		s.fire(tr)
	}
	s.defencesFire(live)
	s.resolveDamage(live)
	s.resolveStructures()
	s.resolveBuildings(live)
	s.resolveBridges(live)
	s.repairBridges(live)
	s.trackObjects()
	s.noteCover(live)
	s.recover(live)
	s.capture(live)
	s.engineers()
	s.haulWork()
	s.squadEvents(live)
	s.countGarrisons()
	s.observe()
	s.checkEnd()
	s.Tick++

	// Events raised by commands since the last tick go out with this one.
	out := s.events
	s.events = nil
	for i := range out {
		out[i].Tick = s.Tick
	}
	return out
}

// spot marks which teams the other side can see, and which enemy squads each squad sees.
func (s *Sim) spot(live []*teamRef) {
	for _, sq := range s.Squads {
		sq.Contacts = sq.Contacts[:0]
	}
	for _, tr := range live {
		enemy := 1 - tr.sq.Side
		// A team that has just fired is seen wherever it is: the shot gives it away.
		fired := float64(s.Tick-tr.t.lastFire) <= s.R.Match.RevealSeconds*float64(s.R.TickRate)
		// Inside a building a team is seen only from close by, or once it has fired.
		hidden := tr.t.In != "" && !fired
		tr.t.Spotted = fired || (!hidden && s.postSees(enemy, tr.t.X, tr.t.Y))
		for _, o := range live {
			d := dist(tr.t.X, tr.t.Y, o.t.X, o.t.Y)
			if o.sq.Side != enemy || d > o.u.Sight || (hidden && d > s.R.Match.GarrisonSight) {
				continue
			}
			tr.t.Spotted = true
			if !slices.Contains(o.sq.Contacts, tr.sq.ID) {
				o.sq.Contacts = append(o.sq.Contacts, tr.sq.ID)
			}
		}
	}
}

func (s *Sim) move(tr *teamRef) {
	t, p := tr.t, tr.plan
	t.Action = p.act
	if (p.act != ActAdvance && p.act != ActFallBack) || t.In != "" {
		return
	}
	speed := tr.u.Speed * s.dt
	if tr.u.Domain == "land" && s.bridgeAt(t.X, t.Y) == nil {
		speed *= s.R.TerrainKinds[string(s.R.Map.TerrainAt(t.X, t.Y))].Speed
	}
	// Around water, mountains and whatever has been built: head for the next corner.
	goalX, goalY := p.x, p.y
	x, y, ok := s.steer(tr, p.x, p.y)
	// With no way through, the fence that closes the way is what stops the team: it goes
	// as near as it can and shoots the fence down (structureTarget).
	if !t.pathOpen {
		if st := s.fenceInTheWay(tr, goalX, goalY); st != nil {
			t.blocked = st.ID
		}
	}
	if !ok {
		return
	}
	p.x, p.y = x, y
	switch s.Nerve(t) {
	case Shaken:
		speed *= 0.6
	case Pinned:
		speed *= 0.15
	}
	d := dist(t.X, t.Y, p.x, p.y)
	nx, ny := p.x, p.y
	if d > speed {
		nx, ny = t.X+(p.x-t.X)/d*speed, t.Y+(p.y-t.Y)/d*speed
	}
	// A hostile fence in the way stops a ground team where it stands.
	if st := s.fenceStops(tr, nx, ny); st != nil {
		t.blocked = st.ID
		return
	}
	t.X, t.Y = nx, ny
	if t.pathOpen {
		t.blocked = 0
	}
}

func (s *Sim) fire(tr *teamRef) {
	t := tr.t
	if t.Cooldown > 0 {
		t.Cooldown--
	}
	if tr.plan.act != ActFire || t.Cooldown > 0 {
		return
	}
	nerve := s.Nerve(t)
	t.lastFire = s.Tick
	t.Cooldown = tr.u.CooldownTicks
	if nerve == Shaken {
		t.Cooldown = tr.u.CooldownTicks * 8 / 5
	}
	if tr.plan.st != nil {
		s.fireAtStructure(tr, tr.plan.st)
		return
	}
	if o := tr.plan.obj; o != nil {
		// A bridge or a building: every round lands, and how hard depends on the weapon.
		dmg := tr.u.Damage * tr.u.Against("structure") * float64(t.Members)
		if o.bridge > 0 {
			s.Bridges[o.bridge-1].dmg += dmg
			s.Bridges[o.bridge-1].by[tr.sq.Side] = true
		} else {
			s.Landmarks[o.landmark-1].dmg += dmg
		}
		return
	}
	if tr.plan.hq {
		enemy := &s.Sides[1-tr.sq.Side]
		enemy.HQHP -= tr.u.Damage * tr.u.Against("hq") * float64(t.Members)
		if s.Tick-enemy.hqAlarm > 20*s.R.TickRate {
			enemy.hqAlarm = s.Tick
			s.emit(Event{Side: enemy.ID, Kind: EvHQUnderAttack, Point: s.R.HQPoint(enemy.ID).ID})
		}
		return
	}
	tgt := tr.plan.target
	chance := tr.u.Accuracy
	if nerve == Shaken {
		chance *= 0.75
	}
	if tgt.plan.act == ActCover {
		chance *= 0.5
	}
	chance *= s.coverAgainst(tgt, t.X, t.Y)
	if tgt.t.In != "" {
		// Rounds fired at a garrison hit its walls too.
		if i, l := s.landmarkByID(tgt.t.In); l != nil {
			s.Landmarks[i].dmg += tr.u.Damage * tr.u.Against("structure") * float64(t.Members) * s.R.Match.GarrisonDamageShare
		}
	}
	// Accuracy falls off over the last 40% of the weapon's range.
	if far := dist(t.X, t.Y, tgt.t.X, tgt.t.Y) / tr.u.Range; far > 0.6 {
		chance *= 1 - 0.75*(far-0.6)
	}
	for i := 0; i < t.Members; i++ {
		if s.rng.Float64() < chance {
			tgt.t.hits++
			tgt.t.dmg += tr.u.Damage * tr.u.Against(tgt.u.Class) * (1 - tgt.u.Armor*(1-tr.u.Pierce))
		} else {
			tgt.t.misses++
		}
	}
	if !slices.Contains(tgt.t.shooter, tr.sq) {
		tgt.t.shooter = append(tgt.t.shooter, tr.sq)
	}
}

// resolveDamage applies the tick's shots at once, so who shoots first never matters.
func (s *Sim) resolveDamage(live []*teamRef) {
	n := &s.R.Nerve
	for _, tr := range live {
		t := tr.t
		if t.hits+t.misses == 0 {
			continue
		}
		t.lastShot = s.Tick
		t.HP -= t.dmg
		left := int(math.Ceil(t.HP / tr.u.HP))
		if left < 0 {
			left = 0
		}
		lost := t.Members - left
		t.Members = left
		t.Stress = math.Min(1, t.Stress+tr.u.NerveResist*
			(float64(t.misses)*n.PerMiss+float64(t.hits)*n.PerHit+float64(lost)*n.PerMemberLost))
		if left == 0 {
			s.teamLost(tr)
		}
		t.dmg, t.hits, t.misses, t.shooter = 0, 0, 0, t.shooter[:0]
	}
}

func (s *Sim) teamLost(tr *teamRef) {
	n := &s.R.Nerve
	left := 0
	for i := range tr.sq.Teams {
		if o := &tr.sq.Teams[i]; o.Members > 0 {
			o.Stress = math.Min(1, o.Stress+tr.u.NerveResist*n.PerTeamLost)
			left++
		}
	}
	// A kill steadies the squads that made it.
	for _, killer := range tr.t.shooter {
		for i := range killer.Teams {
			killer.Teams[i].Stress = math.Max(0, killer.Teams[i].Stress-n.ReliefOnKill)
		}
	}
	x, y := tr.t.X, tr.t.Y
	if tr.sq.haul != nil {
		s.haulerLost(tr)
		return
	}
	if left > 0 {
		s.emit(Event{Side: tr.sq.Side, Kind: EvLosses, Squad: tr.sq.ID, Point: s.nearestPoint(x, y), Count: left})
		return
	}
	tr.sq.Alive = false
	s.emit(Event{Side: tr.sq.Side, Kind: EvSquadLost, Squad: tr.sq.ID, Point: s.nearestPoint(x, y)})
	s.emit(Event{Side: 1 - tr.sq.Side, Kind: EvEnemyDestroyed, Contact: tr.sq.ID, Point: s.nearestPoint(x, y)})
}

// recover lets teams calm down once the shooting stops, faster beside steady friends.
func (s *Sim) recover(live []*teamRef) {
	n := &s.R.Nerve
	quiet := int(n.QuietSeconds * float64(s.R.TickRate))
	steady := make([]bool, len(live))
	for i, tr := range live {
		steady[i] = tr.t.Members > 0 && s.Nerve(tr.t) == Steady
	}
	for _, tr := range live {
		t := tr.t
		if t.Members == 0 || t.Stress == 0 || s.Tick-t.lastShot <= quiet {
			continue
		}
		rate := n.RecoverPerSecond * s.dt
		for j, o := range live {
			if steady[j] && o.t != t && o.sq.Side == tr.sq.Side && dist(t.X, t.Y, o.t.X, o.t.Y) <= 80 {
				rate *= n.RecoverNearSteady
				break
			}
		}
		t.Stress = math.Max(0, t.Stress-rate)
	}
}

// capture moves point ownership: one side alone on a point for long enough takes it.
func (s *Sim) capture(live []*teamRef) {
	need := int(s.R.Match.CaptureSeconds * float64(s.R.TickRate))
	for i := range s.Points {
		p := &s.Points[i]
		by := s.R.Rigs[p.Kind].CaptureBy
		if len(by) == 0 {
			continue
		}
		var present [2]bool
		for _, tr := range live {
			if tr.t.Members > 0 && !tr.u.NoCapture && slices.Contains(by, tr.u.Class) &&
				dist(tr.t.X, tr.t.Y, p.X, p.Y) <= s.R.Match.CaptureRadius {
				present[tr.sq.Side] = true
			}
		}
		switch {
		case present[0] && present[1]:
			// Contested: the count freezes until one side is driven off.
		case present[0] != present[1]:
			side := 0
			if present[1] {
				side = 1
			}
			if side == p.Owner {
				p.CapSide, p.CapTicks = NoSide, 0
				continue
			}
			if p.CapSide != side {
				p.CapSide, p.CapTicks = side, 0
			}
			p.CapTicks++
			if p.CapTicks >= need {
				if p.Owner != NoSide {
					s.emit(Event{Side: p.Owner, Kind: EvPointLost, Point: p.ID})
				}
				p.Owner, p.CapSide, p.CapTicks = side, NoSide, 0
				s.emit(Event{Side: side, Kind: EvCaptured, Point: p.ID})
			}
		default:
			p.CapSide, p.CapTicks = NoSide, 0
		}
	}
}

// squadEvents reports the moments a squad leader should wake up for.
func (s *Sim) squadEvents(live []*teamRef) {
	rate := s.R.TickRate
	for _, sq := range s.Squads {
		if !sq.Alive || sq.haul != nil {
			continue // a hauler has no leader to wake
		}
		if len(sq.Contacts) > 0 {
			if !sq.inContact {
				sq.inContact = true
				c := s.SquadAny(sq.Contacts[0])
				x, y := c.Center()
				s.emit(Event{Side: sq.Side, Kind: EvContact, Squad: sq.ID, Contact: c.ID,
					Point: s.nearestPoint(x, y), Count: len(sq.Contacts)})
			}
			sq.lastContact = s.Tick
		} else if sq.inContact && s.Tick-sq.lastContact > 5*rate {
			sq.inContact = false
		}

		pinned, arrived, alive := false, sq.Order.Kind != OrderNone && !sq.Order.arrived, 0
		cx, cy := sq.Center()
		for i := range sq.Teams {
			t := &sq.Teams[i]
			if t.Members == 0 {
				continue
			}
			alive++
			if s.Nerve(t) == Pinned {
				pinned = true
			}
			if dist(t.X, t.Y, sq.Order.X, sq.Order.Y) > s.R.Match.HoldRadius && t.In == "" && !t.atPost {
				arrived = false
			}
		}
		if pinned && s.Tick-sq.lastPinned > 15*rate {
			sq.lastPinned = s.Tick
			s.emit(Event{Side: sq.Side, Kind: EvPinned, Squad: sq.ID, Point: s.nearestPoint(cx, cy)})
		}
		if arrived && alive > 0 && sq.Order.Contact == 0 {
			sq.Order.arrived = true
			s.emit(Event{Side: sq.Side, Kind: EvArrived, Squad: sq.ID, Point: s.nearestPoint(cx, cy)})
		}
	}
}

// PointsHeld counts the map points a side owns.
func (s *Sim) PointsHeld(side int) int {
	n := 0
	for i := range s.Points {
		if s.Points[i].Owner == side {
			n++
		}
	}
	return n
}

func (s *Sim) checkEnd() {
	dead0, dead1 := s.Sides[0].HQHP <= 0, s.Sides[1].HQHP <= 0
	switch {
	case dead0 && dead1:
		s.end(NoSide, "hq_destroyed")
	case dead0:
		s.end(1, "hq_destroyed")
	case dead1:
		s.end(0, "hq_destroyed")
	case s.Tick+1 >= s.lengthTicks:
		a, b := s.PointsHeld(0), s.PointsHeld(1)
		switch {
		case a > b:
			s.end(0, "timer")
		case b > a:
			s.end(1, "timer")
		default:
			s.end(NoSide, "timer")
		}
	}
}

func (s *Sim) end(winner int, reason string) {
	s.Over, s.Winner, s.Reason = true, winner, reason
	for side := 0; side < 2; side++ {
		s.emit(Event{Side: side, Kind: EvMatchEnd, Winner: &winner, Reason: reason})
	}
}
