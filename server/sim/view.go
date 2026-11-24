package sim

import (
	"encoding/binary"
	"hash/fnv"
	"math"

	"callsign/shared"
)

// Spectator asks Snapshot for everything, with no fog. Tests and replays use it.
const Spectator = -1

type TeamView struct {
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
	Members int     `json:"members"`
	Nerve   string  `json:"nerve,omitempty"`  // own teams only
	Action  string  `json:"action,omitempty"` // own teams only
	// Cover is the multiplier on hits the team takes from the cover it is in, when it
	// is in any (own teams only). In is the building it is inside.
	Cover float64 `json:"cover,omitempty"`
	In    string  `json:"in,omitempty"`
}

type OrderView struct {
	Kind    string  `json:"kind"`
	Point   string  `json:"point,omitempty"`
	Contact int     `json:"contact,omitempty"`
	Place   string  `json:"place,omitempty"`   // the landmark, bridge, structure or offset the order named
	Capture float64 `json:"capture,omitempty"` // an engineer squad's takeover, 0…1
}

// GarrisonView is who is inside a building, as far as the viewer knows.
type GarrisonView struct {
	Side  int `json:"side"`
	Teams int `json:"teams"`
}

// LandmarkView is a landmark whose state is no longer what the map says: a damaged or
// fallen building, or one with a garrison. Untouched landmarks are not listed.
type LandmarkView struct {
	ID       string        `json:"id"`
	Kind     string        `json:"kind"`               // "rubble" once fallen
	HP       float64       `json:"hp"`                 // share 0…1
	Garrison *GarrisonView `json:"garrison,omitempty"` // absent when empty or not known
	Visible  bool          `json:"visible"`            // in sight now; otherwise as last seen
}

// BridgeView is a bridge as the viewer last saw it.
type BridgeView struct {
	ID       string  `json:"id"`
	HP       float64 `json:"hp"` // share 0…1
	Standing bool    `json:"standing"`
	Visible  bool    `json:"visible"`
}

type SquadView struct {
	ID       int         `json:"id"`
	Side     int         `json:"side"`
	Callsign shared.Text `json:"callsign"`
	Unit     string      `json:"unit"`
	Class    string      `json:"class"`
	Tier     int         `json:"tier"`
	X        float64     `json:"x"`
	Y        float64     `json:"y"`
	Near     string      `json:"near"` // nearest map point
	Alive    int         `json:"alive"`
	Full     int         `json:"full"`
	Order    OrderView   `json:"order"`
	Teams    []TeamView  `json:"teams"`
	Contacts []int       `json:"contacts"`
}

// ContactView is an enemy squad as the other side sees it: only the teams in sight.
type ContactView struct {
	ID    int        `json:"id"`
	Side  int        `json:"side"`
	Unit  string     `json:"unit"`
	Class string     `json:"class"`
	X     float64    `json:"x"`
	Y     float64    `json:"y"`
	Near  string     `json:"near"`
	Teams []TeamView `json:"teams"`
}

// DeployView is a bought squad that has not reached the field yet.
type DeployView struct {
	ID         int         `json:"id"`
	Side       int         `json:"side"`
	Callsign   shared.Text `json:"callsign"` // the name it will answer to
	Unit       string      `json:"unit"`
	Class      string      `json:"class"`
	TicksLeft  int         `json:"ticksLeft"`
	TicksTotal int         `json:"ticksTotal"`
	// From is the structure it comes out of, "" for none. Line is its place in that
	// structure's line (0 is being made now), and TicksAhead what the ones before it
	// still need: only the first in a line counts down.
	From       string `json:"from,omitempty"`
	Line       int    `json:"line"`
	TicksAhead int    `json:"ticksAhead"`
}

type PointView struct {
	ID       string  `json:"id"`
	Owner    int     `json:"owner"`
	CapSide  int     `json:"capSide"`
	Progress float64 `json:"progress"` // 0…1 toward capture by CapSide
	Visible  bool    `json:"visible"`  // in sight now; otherwise the rest is as last seen
}

type Snapshot struct {
	Tick      int            `json:"tick"`
	TimeLeft  int            `json:"timeLeft"` // seconds
	Side      int            `json:"side"`
	Faction   string         `json:"faction,omitempty"`
	Gold      int            `json:"gold"`
	Income    int            `json:"income"`        // gold per minute, over the last minute
	Power     PowerView      `json:"power"`         // what the side's structures supply and use
	Radar     bool           `json:"radar"`         // the mini map is on: a radar structure stands and has power
	HQ        [2]float64     `json:"hq"`            // headquarters health 0…1, by side; the enemy's as last seen
	Fog       *FogView       `json:"fog,omitempty"` // absent for spectators, who see everything
	Points    []PointView    `json:"points"`
	Landmarks []LandmarkView `json:"landmarks"` // only the ones that differ from the map
	Bridges   []BridgeView   `json:"bridges"`
	Squads    []SquadView    `json:"squads"`
	Deploying []DeployView   `json:"deploying"` // own squads bought and on their way, oldest first
	Contacts  []ContactView  `json:"contacts"`
	// Structures are this side's own and the other side's as last seen. ForeignUnits are
	// the other factions' units this side can buy through structures it has captured.
	Structures   []StructureView `json:"structures"`
	ForeignUnits []string        `json:"foreignUnits,omitempty"`
	Fields       []FieldView     `json:"fields"`  // every gold field; out of sight, as last seen
	Haulers      []HaulerView    `json:"haulers"` // own haulers, then enemy ones as last seen
	Over         bool            `json:"over"`
	Winner       int             `json:"winner"`
	Reason       string          `json:"reason,omitempty"`
}

// Snapshot is the match as one side may see it. Enemy squads appear only as contacts,
// and only the teams currently in sight. Points and the enemy headquarters are as the
// side last saw them. Spectator sees everything as it is.
func (s *Sim) Snapshot(side int) Snapshot {
	snap := Snapshot{
		Tick:      s.Tick,
		TimeLeft:  (s.lengthTicks - s.Tick) / s.R.TickRate,
		Side:      side,
		Over:      s.Over,
		Winner:    s.Winner,
		Reason:    s.Reason,
		Squads:    []SquadView{},
		Landmarks: []LandmarkView{},
		Bridges:   []BridgeView{},
		Deploying: []DeployView{},
		Contacts:  []ContactView{},
	}
	if side != Spectator {
		snap.Faction = s.Sides[side].Faction
		snap.Gold = s.Gold(side)
		snap.Income = s.Income(side)
		snap.Power, snap.Radar = s.Power(side), s.Radar(side)
	} else {
		snap.Radar = true // a spectator sees everything
	}
	for i := range s.Sides {
		snap.HQ[i] = math.Max(0, s.Sides[i].HQHP/s.R.HQ.HP)
	}
	need := s.R.Match.CaptureSeconds * float64(s.R.TickRate)
	for i := range s.Points {
		p := &s.Points[i]
		v := PointView{ID: p.ID, Owner: p.Owner, CapSide: p.CapSide, Progress: float64(p.CapTicks) / need, Visible: true}
		if side != Spectator {
			m := s.Sides[side].points[i]
			v = PointView{ID: p.ID, Owner: m.Owner, CapSide: m.CapSide, Progress: float64(m.CapTicks) / need, Visible: m.Visible}
		}
		snap.Points = append(snap.Points, v)
	}
	if side != Spectator {
		snap.HQ[1-side] = s.Sides[side].enemyHQ
		cols, rows := s.fogSize()
		snap.Fog = &FogView{Cell: FogCell, Cols: cols, Rows: rows, Seen: append([]byte{}, s.Sides[side].explored...)}
	}
	snap.Structures = s.structureViews(side)
	if side != Spectator {
		snap.ForeignUnits = s.ForeignUnits(side)
	}
	s.viewMap(&snap, side)
	for _, sq := range s.Squads {
		if sq.Deploying() && (side == Spectator || sq.Side == side) {
			from, pos, ahead := s.lineView(sq)
			snap.Deploying = append(snap.Deploying, DeployView{
				ID: sq.ID, Side: sq.Side, Callsign: s.Callsign(sq), Unit: sq.Unit, Class: sq.unit.Class,
				TicksLeft: sq.DeployTicks, TicksTotal: sq.DeployTotal,
				From: from, Line: pos, TicksAhead: ahead,
			})
		}
		if !sq.Alive {
			continue
		}
		if sq.haul != nil {
			// A hauler is not a squad. An enemy one in sight is still a contact, so that it
			// can be named and attacked like any other.
			if side != Spectator && sq.Side != side && s.visible(sq) {
				snap.Contacts = append(snap.Contacts, s.contactView(sq))
			}
			continue
		}
		if side == Spectator || sq.Side == side {
			snap.Squads = append(snap.Squads, s.squadView(sq))
		} else if s.visible(sq) {
			snap.Contacts = append(snap.Contacts, s.contactView(sq))
		}
	}
	s.snapHaul(&snap, side)
	return snap
}

func (s *Sim) squadView(sq *Squad) SquadView {
	x, y := sq.Center()
	alive, full := sq.Strength()
	v := SquadView{
		ID: sq.ID, Side: sq.Side, Callsign: s.Callsign(sq), Unit: sq.Unit, Class: sq.unit.Class,
		Tier: sq.Tier, X: round1(x), Y: round1(y), Near: s.nearestPoint(x, y),
		Alive: alive, Full: full,
		Order:    OrderView{Kind: sq.Order.Kind, Point: sq.Order.Point, Contact: sq.Order.Contact, Place: sq.Order.Place, Capture: s.CaptureProgress(sq)},
		Contacts: append([]int{}, sq.Contacts...),
	}
	for i := range sq.Teams {
		if t := &sq.Teams[i]; t.Members > 0 {
			tv := TeamView{X: round1(t.X), Y: round1(t.Y), Members: t.Members, Nerve: s.Nerve(t), Action: t.Action, In: t.In}
			if t.Cover > 0 && t.Cover < 1 {
				tv.Cover = t.Cover
			}
			v.Teams = append(v.Teams, tv)
		}
	}
	return v
}

func (s *Sim) contactView(sq *Squad) ContactView {
	v := ContactView{ID: sq.ID, Side: sq.Side, Unit: sq.Unit, Class: sq.unit.Class}
	var x, y float64
	for i := range sq.Teams {
		if t := &sq.Teams[i]; t.Members > 0 && t.Spotted {
			v.Teams = append(v.Teams, TeamView{X: round1(t.X), Y: round1(t.Y), Members: t.Members, In: t.In})
			x, y = x+t.X, y+t.Y
		}
	}
	n := float64(len(v.Teams))
	v.X, v.Y = round1(x/n), round1(y/n)
	v.Near = s.nearestPoint(x/n, y/n)
	return v
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }

// Hash folds the whole match state into one number. Two runs that agree on every hash
// played the same match.
func (s *Sim) Hash() uint64 {
	h := fnv.New64a()
	var buf [8]byte
	put := func(v uint64) {
		binary.LittleEndian.PutUint64(buf[:], v)
		h.Write(buf[:])
	}
	f := func(v float64) { put(math.Float64bits(v)) }
	put(uint64(s.Tick))
	put(uint64(int64(s.Winner)))
	for i := range s.Sides {
		put(uint64(s.Sides[i].goldUnit))
		f(s.Sides[i].HQHP)
		f(s.Sides[i].Destroyed)
		h.Write(s.Sides[i].explored)
		f(s.Sides[i].enemyHQ)
		for _, m := range s.Sides[i].points {
			put(uint64(int64(m.Owner)))
			put(uint64(int64(m.CapSide)))
			put(uint64(m.CapTicks))
		}
	}
	for i := range s.Points {
		put(uint64(int64(s.Points[i].Owner)))
		put(uint64(s.Points[i].CapTicks))
	}
	for i := range s.Bridges {
		f(s.Bridges[i].HP)
		put(uint64(bit(s.Bridges[i].Standing)))
	}
	for i := range s.Landmarks {
		f(s.Landmarks[i].HP)
		h.Write([]byte(s.Landmarks[i].Kind))
	}
	for i := range s.Sides {
		for _, m := range s.Sides[i].lands {
			f(m.HP)
			put(uint64(int64(m.GSide)))
			put(uint64(m.GTeams))
		}
		for _, m := range s.Sides[i].bridges {
			f(m.HP)
			put(uint64(bit(m.Standing)))
		}
	}
	for _, sq := range s.Squads {
		put(uint64(sq.ID))
		put(uint64(sq.Tier))
		put(uint64(sq.DeployTicks))
		put(uint64(sq.From))
		h.Write([]byte(sq.Order.Kind))
		h.Write([]byte(sq.Order.Point))
		h.Write([]byte(sq.Order.Place))
		for i := range sq.Teams {
			t := &sq.Teams[i]
			f(t.X)
			f(t.Y)
			f(t.HP)
			f(t.Stress)
			put(uint64(t.Members))
			put(uint64(t.Cooldown))
			put(uint64(int64(t.lastFire)))
			h.Write([]byte(t.In))
		}
	}
	s.hashStructures(put, f)
	s.hashTech(put)
	s.hashPower(put, f)
	s.hashHaul(put, f)
	return h.Sum64()
}

func bit(v bool) int {
	if v {
		return 1
	}
	return 0
}

// viewMap adds the landmarks and bridges to a snapshot: as they are for a spectator, as
// last seen for a side.
func (s *Sim) viewMap(snap *Snapshot, side int) {
	for i := range s.Landmarks {
		l := &s.Landmarks[i]
		m := landmarkMemory{Kind: l.Kind, HP: s.landmarkShare(l), GSide: NoSide, Visible: true}
		if side == Spectator {
			m.GSide, m.GTeams = s.garrison(l.ID)
		} else {
			m = s.Sides[side].lands[i]
		}
		if m.Kind == l.Landmark.Kind && m.HP >= 1 && m.GSide == NoSide {
			continue
		}
		v := LandmarkView{ID: l.ID, Kind: m.Kind, HP: round3(m.HP), Visible: m.Visible}
		if m.GSide != NoSide {
			v.Garrison = &GarrisonView{Side: m.GSide, Teams: m.GTeams}
		}
		snap.Landmarks = append(snap.Landmarks, v)
	}
	for i := range s.Bridges {
		b := &s.Bridges[i]
		v := BridgeView{ID: b.ID, HP: round3(b.Share()), Standing: b.Standing, Visible: true}
		if side != Spectator {
			m := s.Sides[side].bridges[i]
			v = BridgeView{ID: b.ID, HP: round3(m.HP), Standing: m.Standing, Visible: m.Visible}
		}
		snap.Bridges = append(snap.Bridges, v)
	}
}

func round3(v float64) float64 { return math.Round(v*1000) / 1000 }

// NearbyLandmark is a landmark as a squad leader is told about it.
type NearbyLandmark struct {
	ID       string        `json:"id"`
	Name     string        `json:"name"` // English; the Hebrew name is in the rules
	Kind     string        `json:"kind"`
	Cover    float64       `json:"cover"`
	Garrison *GarrisonView `json:"garrison,omitempty"`
	Room     int           `json:"room,omitempty"` // fireteams a building still has room for
}

// LandmarksNear lists what a squad leader should know about the ground: the landmarks
// in sight of its squad and those close to every map point, with who holds each building
// as far as its side knows. Bridges come with them, as kind "bridge".
func (s *Sim) LandmarksNear(sq *Squad) []NearbyLandmark {
	const aroundPoint = 150
	out := []NearbyLandmark{}
	cx, cy := sq.Center()
	near := func(x, y float64) bool {
		if dist(cx, cy, x, y) <= sq.unit.Sight {
			return true
		}
		for i := range s.Points {
			if dist(s.Points[i].X, s.Points[i].Y, x, y) <= aroundPoint {
				return true
			}
		}
		return false
	}
	for i := range s.Landmarks {
		l := &s.Landmarks[i]
		if !near(l.X, l.Y) {
			continue
		}
		m := s.Sides[sq.Side].lands[i]
		k := s.R.LandmarkKinds[m.Kind]
		v := NearbyLandmark{ID: l.ID, Name: l.Name.En, Kind: m.Kind, Cover: k.Cover}
		if k.Garrison > 0 {
			v.Cover, v.Room = k.GarrisonCover, k.Garrison
			if m.GSide != NoSide {
				v.Garrison = &GarrisonView{Side: m.GSide, Teams: m.GTeams}
				v.Room = max(0, k.Garrison-m.GTeams)
				if m.GSide != sq.Side {
					v.Room = 0
				}
			}
		}
		out = append(out, v)
	}
	// Every bridge, wherever it is: there are few, and a fallen one changes every plan.
	for i := range s.Bridges {
		b := &s.Bridges[i]
		m := s.Sides[sq.Side].bridges[i]
		kind := "bridge"
		if !m.Standing {
			kind = "fallen bridge"
		}
		out = append(out, NearbyLandmark{ID: b.ID, Name: b.Name.En, Kind: kind, Cover: round3(m.HP)})
	}
	return out
}
