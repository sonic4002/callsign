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
}

type OrderView struct {
	Kind    string  `json:"kind"`
	Point   string  `json:"point,omitempty"`
	Contact int     `json:"contact,omitempty"`
	Place   string  `json:"place,omitempty"`   // a structure id, when the order is on one
	Capture float64 `json:"capture,omitempty"` // an engineer squad's takeover, 0…1
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
}

type PointView struct {
	ID       string  `json:"id"`
	Owner    int     `json:"owner"`
	CapSide  int     `json:"capSide"`
	Progress float64 `json:"progress"` // 0…1 toward capture by CapSide
	Visible  bool    `json:"visible"`  // in sight now; otherwise the rest is as last seen
}

type Snapshot struct {
	Tick      int           `json:"tick"`
	TimeLeft  int           `json:"timeLeft"` // seconds
	Side      int           `json:"side"`
	Faction   string        `json:"faction,omitempty"`
	Gold      int           `json:"gold"`
	Income    int           `json:"income"`
	HQ        [2]float64    `json:"hq"`            // headquarters health 0…1, by side; the enemy's as last seen
	Fog       *FogView      `json:"fog,omitempty"` // absent for spectators, who see everything
	Points    []PointView   `json:"points"`
	Squads    []SquadView   `json:"squads"`
	Deploying []DeployView  `json:"deploying"` // own squads bought and on their way, oldest first
	Contacts  []ContactView `json:"contacts"`
	// Structures are this side's own and the other side's as last seen. ForeignUnits are
	// the other factions' units this side can buy through structures it has captured.
	Structures   []StructureView `json:"structures"`
	ForeignUnits []string        `json:"foreignUnits,omitempty"`
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
		Deploying: []DeployView{},
		Contacts:  []ContactView{},
	}
	if side != Spectator {
		snap.Faction = s.Sides[side].Faction
		snap.Gold = s.Gold(side)
		snap.Income = s.Income(side)
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
	for _, sq := range s.Squads {
		if sq.Deploying() && (side == Spectator || sq.Side == side) {
			snap.Deploying = append(snap.Deploying, DeployView{
				ID: sq.ID, Side: sq.Side, Callsign: s.Callsign(sq), Unit: sq.Unit, Class: sq.unit.Class,
				TicksLeft: sq.DeployTicks, TicksTotal: sq.DeployTotal,
			})
		}
		if !sq.Alive {
			continue
		}
		if side == Spectator || sq.Side == side {
			snap.Squads = append(snap.Squads, s.squadView(sq))
		} else if s.visible(sq) {
			snap.Contacts = append(snap.Contacts, s.contactView(sq))
		}
	}
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
			v.Teams = append(v.Teams, TeamView{
				X: round1(t.X), Y: round1(t.Y), Members: t.Members, Nerve: s.Nerve(t), Action: t.Action,
			})
		}
	}
	return v
}

func (s *Sim) contactView(sq *Squad) ContactView {
	v := ContactView{ID: sq.ID, Side: sq.Side, Unit: sq.Unit, Class: sq.unit.Class}
	var x, y float64
	for i := range sq.Teams {
		if t := &sq.Teams[i]; t.Members > 0 && t.Spotted {
			v.Teams = append(v.Teams, TeamView{X: round1(t.X), Y: round1(t.Y), Members: t.Members})
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
	for _, sq := range s.Squads {
		put(uint64(sq.ID))
		put(uint64(sq.Tier))
		put(uint64(sq.DeployTicks))
		h.Write([]byte(sq.Order.Kind))
		h.Write([]byte(sq.Order.Point))
		for i := range sq.Teams {
			t := &sq.Teams[i]
			f(t.X)
			f(t.Y)
			f(t.HP)
			f(t.Stress)
			put(uint64(t.Members))
			put(uint64(t.Cooldown))
			put(uint64(int64(t.lastFire)))
		}
	}
	s.hashStructures(put, f)
	return h.Sum64()
}
