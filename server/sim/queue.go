package sim

import (
	"errors"
	"fmt"
	"math"

	"callsign/shared"
)

// Production. A unit is made by a structure of its side: infantry by a barracks,
// vehicles and haulers by a works, boats by a dockyard, aircraft by an airbase. Each
// structure makes one unit at a time; what is bought while it is busy waits in line. The
// finished unit comes out of the structure and goes to its rally place. When the
// structure falls, or changes hands, everything in its line is lost with it.

const (
	CmdCancel = "cancel" // Unit: take the last one of that unit out of its line ("" for the last of any)
	CmdRally  = "rally"  // Place: where new units gather; Structure: for that one only, "" for all

	EvDeployLost      = "deploy_lost"      // Squad, Unit, Structure: its structure fell before it came out
	EvDeployCancelled = "deploy_cancelled" // Squad, Unit; Count is the gold given back
	EvRallySet        = "rally_set"        // Place ("" for back beside the structure), Structure ("" for all)
)

var (
	ErrLineFull     = errors.New("the line is full")
	ErrNothingDue   = errors.New("nothing of that kind is waiting to come out")
	ErrNoProducer   = errors.New("no structure of yours makes units")
	ErrRallyNowhere = errors.New("units cannot gather there")
)

// rallyPoint is where a structure's units gather.
type rallyPoint struct {
	Place string
	X, Y  float64
}

// RallyDefault is the written place that puts a rally point back beside its structure.
const RallyDefault = "home"

// makes reports whether a structure can make a unit: it stands, it is the role the unit
// needs, and the unit is one of its own design's (a captured barracks makes the units of
// the faction that built it).
func (s *Sim) makes(st *Structure, side int, unitID string, u *shared.Unit) bool {
	if st.Side != side || !st.Standing() || u.Requires == "" || st.def.Role != u.Requires {
		return false
	}
	_, ok := s.R.Factions[st.Faction].Units[unitID]
	return ok
}

// line lists the squads waiting at a structure, the one being made first.
func (s *Sim) line(id int) []*Squad {
	var out []*Squad
	for _, sq := range s.Squads {
		if sq.From == id && sq.DeployTicks > 0 {
			out = append(out, sq)
		}
	}
	return out
}

// producer chooses the structure that makes a unit: the one with the shortest line, of
// those the nearest to the headquarters, of those the oldest. nil when none can.
func (s *Sim) producer(side int, unitID string, u *shared.Unit) *Structure {
	hq := s.R.HQPoint(side)
	var best *Structure
	bn, bd := 0, 0.0
	for _, st := range s.Structures {
		if !s.makes(st, side, unitID, u) {
			continue
		}
		n, d := len(s.line(st.ID)), dist(st.X, st.Y, hq.X, hq.Y)
		if best == nil || n < bn || (n == bn && d < bd) {
			best, bn, bd = st, n, d
		}
	}
	return best
}

// enqueue puts a raised squad in the line of the structure that makes it and reports how
// many ticks it has to wait there. A unit that needs no structure goes to the field by
// the headquarters as before, in its own time.
func (s *Sim) enqueue(sq *Squad, ticks int) (ahead int, err error) {
	sq.DeployTicks, sq.DeployTotal = ticks, ticks
	st := s.producer(sq.Side, sq.Unit, sq.unit)
	if st == nil {
		return 0, nil
	}
	line := s.line(st.ID)
	for _, w := range line {
		if w != sq {
			ahead += w.DeployTicks
		}
	}
	sq.From = st.ID
	return ahead, nil
}

// lineRoom checks, before anything is spent, that the structure that would make a unit
// has room in its line.
func (s *Sim) lineRoom(side int, unitID string, u *shared.Unit) error {
	st := s.producer(side, unitID, u)
	if st == nil {
		return nil
	}
	if n := len(s.line(st.ID)); n >= s.R.Match.QueueLimit {
		return fmt.Errorf("%w at the %s: %d are waiting", ErrLineFull, st.def.Name.En, n)
	}
	return nil
}

// deploy moves production on by a tick. At each structure only the first in line is
// being made; the rest wait. A line whose structure no longer stands, or stands for the
// other side, is lost.
func (s *Sim) deploy() {
	busy := map[int]bool{}
	for _, sq := range s.Squads {
		if sq.DeployTicks == 0 {
			continue
		}
		if sq.From != 0 {
			st := s.structure(sq.From)
			if st == nil || !st.Standing() || st.Side != sq.Side {
				sq.DeployTicks = 0
				s.unraise(sq)
				s.emit(Event{Side: sq.Side, Kind: EvDeployLost, Squad: sq.ID, Unit: sq.Unit, Structure: "s" + fmt.Sprint(sq.From)})
				continue
			}
			if busy[sq.From] {
				continue // waiting behind the one being made
			}
			busy[sq.From] = true
			if st.disabledUntil > s.Tick {
				continue // Cyber Blackout / EMP disables production at this structure
			}
		}
		if !s.power[sq.Side].works {
			continue // the side is short of power: this tick the line stands still (power.go)
		}
		if sq.DeployTicks--; sq.DeployTicks == 0 {
			s.field(sq)
		}
	}
}

// unraise takes back the callsign number of a squad that never reached the field, when
// it was the last one given out, so that the next squad of its class takes it.
func (s *Sim) unraise(sq *Squad) {
	sd := &s.Sides[sq.Side]
	if sd.nextNum[sq.unit.CallClass()] == sq.Num {
		sd.nextNum[sq.unit.CallClass()]--
	}
}

// cancel takes the last unit of a kind out of its line and gives back the gold not yet
// spent on it: all of it for a unit still waiting, the unbuilt share for the one being made.
func (s *Sim) cancel(c Command) (*Squad, error) {
	var sq *Squad
	for i := len(s.Squads) - 1; i >= 0 && sq == nil; i-- {
		if w := s.Squads[i]; w.Side == c.Side && w.DeployTicks > 0 && (c.Unit == "" || w.Unit == c.Unit) {
			sq = w
		}
	}
	if sq == nil {
		return nil, ErrNothingDue
	}
	refund := sq.unit.Cost
	if sq.DeployTicks < sq.DeployTotal {
		refund = int(math.Floor(float64(sq.unit.Cost) * float64(sq.DeployTicks) / float64(sq.DeployTotal)))
	}
	sq.DeployTicks = 0
	s.unraise(sq)
	s.Sides[c.Side].goldUnit += int64(refund) * int64(s.R.TickRate)
	s.emit(Event{Side: c.Side, Kind: EvDeployCancelled, Squad: sq.ID, Unit: sq.Unit, Count: refund})
	return sq, nil
}

// exitOf is where a unit comes out of its structure: at the door on its south face for
// what walks or drives, on the pad for what flies, on the water beside it for a boat.
func (s *Sim) exitOf(st *Structure, u *shared.Unit) (float64, float64) {
	switch u.Domain {
	case "air":
		return st.X, st.Y
	case "sea":
		return s.nav.snapXY(navWater, st.X, st.Y)
	}
	// The door is on the south face. When the ground there is a pocket shut in by water or
	// by other structures, the unit comes out on the first side that leads to the rest of
	// the map: a squad must never be made where it can go nowhere.
	hq := s.R.HQPoint(st.Side)
	home := s.groundRegion(hq.X, hq.Y)
	out, in := st.def.Footprint+14, s.inward(st.Side)
	for _, d := range [][2]float64{{-12, out}, {in * out, 0}, {-in * out, 0}, {0, -out}} {
		if x, y := s.nav.snapXY(navGround, st.X+d[0], st.Y+d[1]); s.groundRegion(x, y) == home {
			return x, y
		}
	}
	return s.nav.snapXY(navGround, st.X-12, st.Y+out)
}

// groundRegion is the number of the connected stretch of ground a position lies on.
func (s *Sim) groundRegion(x, y float64) int32 {
	n := s.nav
	return n.regions(navGround)[n.snap(navGround, n.index(x, y))]
}

// rallyBeside is where a structure's units gather when nobody chose a place: a short
// way out of the door, each in its own spot so that they do not stand in a heap.
func (s *Sim) rallyBeside(st *Structure, sq *Squad) (float64, float64) {
	ex, ey := s.exitOf(st, sq.unit)
	in := s.inward(st.Side)
	col, row := float64((sq.Num-1)%3), float64(((sq.Num-1)/3)%2)
	switch sq.unit.Domain {
	case "air":
		return ex + in*(90+col*44), ey + 90 + row*44
	case "sea":
		return s.nav.snapXY(navWater, ex+in*(70+col*44), ey+50+row*40)
	}
	// Straight out of the door when the ground there joins the rest of the map; beside
	// the structure, toward the middle of the map, when it does not.
	for _, d := range [][2]float64{{in * col * 46, 84 + row*44}, {in * (70 + col*40), 30 + row*40}, {in * (70 + col*40), -30 - row*40}} {
		if x, y := s.nav.snapXY(navGround, ex+d[0], ey+d[1]); s.groundRegion(x, y) == s.groundRegion(ex, ey) && dist(x, y, ex+d[0], ey+d[1]) < 2*NavCell {
			return x, y
		}
	}
	return ex, ey
}

// comeOut puts a finished squad at its structure's exit and sends it to the rally place.
// It reports false when the squad has no structure to come out of.
func (s *Sim) comeOut(sq *Squad) bool {
	st := s.structure(sq.From)
	if st == nil {
		return false
	}
	u := sq.unit
	ex, ey := s.exitOf(st, u)
	for i := 0; i < u.Teams; i++ {
		ox, oy, _ := s.huddle(u, i, sq.Side) // out of the door shoulder to shoulder
		x, y := s.clamp(u.Domain, ex+ox, ey+oy)
		x, y = s.room(sq, nil, x, y) // beside whoever stands at the door, not on them
		sq.Teams = append(sq.Teams, Team{
			X: x, Y: y, HP: u.HP * float64(u.Members), Members: u.Members,
			Action: ActIdle, lastShot: never, lastFire: never, Cover: 1,
		})
	}
	sq.Alive, sq.DeployTicks = true, 0
	if sq.haul != nil {
		return true // a hauler goes to work by itself
	}
	if sq.sortie != nil {
		s.park(sq, st) // a strike aircraft stands at its airbase, armed, until it is given a target
		return true
	}
	// A chosen rally place is an order like any other, so the squad holds there and its
	// leader reports in. When the unit cannot get there it gathers beside the structure.
	if r := st.rally; r != nil {
		if _, err := s.order(Command{Side: sq.Side, Kind: CmdHold, Squad: sq.ID, Place: r.Place}); err == nil {
			return true
		}
	}
	x, y := s.rallyBeside(st, sq)
	sq.Order = Order{Kind: OrderMove, X: x, Y: y, Tick: s.Tick, rally: true}
	return true
}

// setRally is the rally command: new units of every structure, or of one, gather at a
// place from now on. RallyDefault puts them back beside their structure.
func (s *Sim) setRally(c Command) error {
	var r *rallyPoint
	if c.Place != "" && c.Place != RallyDefault {
		pl, err := s.resolveFor(c.Side, c.Place)
		if err != nil {
			return err
		}
		// One's own structure or a tech building (a place on the map, whoever holds it);
		// never the enemy's.
		if pl.Base != "" || (pl.Structure != nil && pl.Structure.Side != c.Side && pl.Structure.def.Role != shared.RoleTech) {
			return fmt.Errorf("%w: %q", ErrRallyNowhere, c.Place)
		}
		r = &rallyPoint{pl.ID, pl.X, pl.Y}
	}
	only := 0
	if c.Structure != "" {
		pl, err := s.resolveFor(c.Side, c.Structure)
		if err != nil || pl.Structure == nil || pl.Structure.Side != c.Side || !pl.Structure.def.Base() {
			return fmt.Errorf("%w: %q is not a structure of yours that makes units", ErrNoProducer, c.Structure)
		}
		only = pl.Structure.ID
	}
	n := 0
	for _, st := range s.Structures {
		if st.Side != c.Side || st.Ruin || !st.def.Base() || (only != 0 && st.ID != only) {
			continue
		}
		st.rally = nil
		if r != nil {
			st.rally = &rallyPoint{r.Place, r.X, r.Y}
		}
		n++
	}
	if only == 0 {
		s.Sides[c.Side].rally = r // structures built later take it too
	} else if n == 0 {
		return ErrNoProducer
	}
	place := ""
	if r != nil {
		place = r.Place
	}
	ev := Event{Side: c.Side, Kind: EvRallySet, Place: place}
	if only != 0 {
		ev.Structure = "s" + fmt.Sprint(only)
	}
	s.emit(ev)
	return nil
}

// RallyView is a structure's rally place as its owner sees it.
type RallyView struct {
	Place string  `json:"place"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
}

// lineView fills in where a deploying squad stands in its line: the structure it comes
// out of, its place in the line (0 is being made now) and the ticks of those ahead of it.
func (s *Sim) lineView(sq *Squad) (from string, pos, ahead int) {
	if sq.From == 0 {
		return "", 0, 0
	}
	for _, w := range s.line(sq.From) {
		if w == sq {
			break
		}
		pos++
		ahead += w.DeployTicks
	}
	return "s" + fmt.Sprint(sq.From), pos, ahead
}

// LineOf is lineView for the room, which tells an operator how long a purchase will take.
func (s *Sim) LineOf(sq *Squad) (from string, pos, ahead int) { return s.lineView(sq) }
