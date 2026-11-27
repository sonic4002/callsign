package sim

import (
	"errors"
	"fmt"
	"hash"
	"math"
	"slices"

	"callsign/shared"
)

// Super power events emitted to sides (and synced to clients).
const (
	EvSuperReady    = "super_ready"    // Unit is power id
	EvSuperLaunched = "super_launched" // Unit is power id, Point is nearest point
	EvSuperIncoming = "super_incoming" // Enemy launched a super power! Unit is power id, Point is nearest point ("" if out of sight)
)

var (
	ErrSuperPowersOff = errors.New("super powers are disabled in this match")
	ErrSuperLocked    = errors.New("build the super weapons complex first")
	ErrSuperUnknown   = errors.New("unknown super power")
	ErrSuperLimit     = errors.New("super power selection count mismatch")
	ErrSuperNotReady  = errors.New("super power is still recharging")
	ErrSuperNoPower   = errors.New("super weapons complex is offline or unpowered")
	ErrSuperTarget    = errors.New("invalid super power target")
)

// ParseSuperPowers parses a lobby/config super-power setting:
//   "0" / "off" -> 0 (disabled)
//   "1".."4"    -> 1..4 chosen powers per player (normal cooldowns)
//   ""          -> default "2"
//   "all"       -> all powers unlocked automatically with fast test recharge
func ParseSuperPowers(raw string, total int) (limit int, fast bool, norm string, ok bool) {
	switch raw {
	case "", "2":
		return 2, false, "2", true
	case "0", "off":
		return 0, false, "0", true
	case "1":
		return 1, false, "1", true
	case "3":
		return 3, false, "3", true
	case "4":
		return 4, false, "4", true
	case "all":
		if total <= 0 {
			total = 15
		}
		return total, true, "all", true
	default:
		return 0, false, "", false
	}
}

// TargetXY is one target coordinate in map units.
type TargetXY struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// SubImpact is one discrete sub-detonation (bolt, drone dive, shell, SCUD, cruise missile)
// planned deterministically by the server so the client animates it in exact sync.
type SubImpact struct {
	X           float64 `json:"x"`
	Y           float64 `json:"y"`
	StartX      float64 `json:"startX,omitempty"`
	StartY      float64 `json:"startY,omitempty"`
	LaunchTick  int     `json:"launchTick,omitempty"`
	ImpactTick  int     `json:"impactTick"`
	Intercepted bool    `json:"intercepted,omitempty"`
	Done        bool    `json:"-"`
}

// SuperStrike is one active or recently-completed super power launch.
type SuperStrike struct {
	ID         int
	Power      string
	Side       int
	StartTick  int
	ImpactTick int
	EndTick    int
	X, Y       float64
	X2, Y2     float64
	Targets    []TargetXY
	SubImpacts []SubImpact
	Seed       uint32
	Detonated  bool
	hqDealt    [2]float64
}

// Crater is a permanent scorched impact crater left on the battlefield.
type Crater struct {
	ID   int     `json:"id"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	R    float64 `json:"r"`
	Tick int     `json:"tick"`
	Kind string  `json:"kind"` // "kinetic", "nuke", "artillery", "scud", "tunnel", "moab", "cruise", "scorch"
	seen [2]bool
}

// Decoy is one holographic phantom unit spawned by Phantom Signal.
type Decoy struct {
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	Unit string  `json:"unit"`
}

// Hazard is a persistent battlefield zone (fallout, drifting chemical cloud, napalm corridor,
// cyber blackout dome, EMP ring, molten laser trench, or radio spoof broadcast).
type Hazard struct {
	ID        int     `json:"id"`
	Kind      string  `json:"kind"` // "fallout", "chemical", "napalm", "cyber", "emp", "trench", "spoof"
	Side      int     `json:"side"`
	X         float64 `json:"x"`
	Y         float64 `json:"y"`
	X2        float64 `json:"x2,omitempty"`
	Y2        float64 `json:"y2,omitempty"`
	R         float64 `json:"r"`
	StartTick int     `json:"startTick"`
	EndTick   int     `json:"endTick"`
	VX        float64 `json:"vx,omitempty"`
	VY        float64 `json:"vy,omitempty"`
	Decoys    []Decoy `json:"decoys,omitempty"`
	Visible   bool    `json:"visible"`
}

// sideSuper tracks one side's chosen super powers and cooldowns.
type sideSuper struct {
	chosen     []string
	readyTick  []int  // aligned with chosen; tick when power is ready (relative before armed)
	totalTicks []int  // total ticks of the current charge cycle (initial or cooldown)
	readyFired []bool // whether EvSuperReady was emitted for the current cycle
	armed      bool   // whether a superweapon complex has stood for this side
	autoFilled bool
}

// SuperSlotView is one chosen super power slot in a client snapshot.
type SuperSlotView struct {
	ID            string `json:"id"`
	ReadyTick     int    `json:"readyTick"`
	CooldownTicks int    `json:"cooldownTicks"`
	Ready         bool   `json:"ready"`
}

// SuperPowerView is a side's super-power state in a client snapshot.
type SuperPowerView struct {
	Limit            int             `json:"limit"`
	Fast             bool            `json:"fast,omitempty"`
	HasBuilding      bool            `json:"hasBuilding"`
	BuildingReady    bool            `json:"buildingReady"`
	BuildingProgress float64         `json:"buildingProgress"`
	Powered          bool            `json:"powered"`
	Chosen           []string        `json:"chosen"`
	Slots            []SuperSlotView `json:"slots"`
}

// SuperStrikeView is a serialized strike for client rendering & SFX.
type SuperStrikeView struct {
	ID         int         `json:"id"`
	Power      string      `json:"power"`
	Side       int         `json:"side"`
	StartTick  int         `json:"startTick"`
	ImpactTick int         `json:"impactTick"`
	EndTick    int         `json:"endTick"`
	X          float64     `json:"x"`
	Y          float64     `json:"y"`
	X2         float64     `json:"x2,omitempty"`
	Y2         float64     `json:"y2,omitempty"`
	Targets    []TargetXY  `json:"targets,omitempty"`
	SubImpacts []SubImpact `json:"subImpacts,omitempty"`
	Seed       uint32      `json:"seed"`
}

func (s *Sim) initSuperPowers(setting string) {
	limit, fast, norm, ok := ParseSuperPowers(setting, len(s.R.SuperPowers))
	if !ok {
		limit, fast, norm = 2, false, "2"
	}
	s.superLimit = limit
	s.superFast = fast
	s.superMode = norm
}

// SuperSetting returns the normalized lobby super-power setting ("0", "1".."4", "all").
func (s *Sim) SuperSetting() string { return s.superMode }

func (s *Sim) superStructure(side int) *Structure {
	for _, st := range s.Structures {
		if st.Side == side && !st.Ruin && !st.Gone && st.def.Role == shared.RoleSuperweapon {
			return st
		}
	}
	return nil
}

func (s *Sim) cooldownTicksFor(sp shared.SuperPower) int {
	if s.superFast {
		return 20 * s.R.TickRate // 20s fast recharge in "all" test mode
	}
	return sp.CooldownSeconds * s.R.TickRate
}

func (s *Sim) initialTicksFor(sp shared.SuperPower) int {
	if s.superFast {
		return 0 // immediately ready to test in "all" mode!
	}
	return sp.InitialSeconds * s.R.TickRate
}

func (s *Sim) wantedSuperCount() int {
	if s.superLimit <= 0 {
		return 0
	}
	return min(s.superLimit, len(s.R.SuperPowers))
}

// ValidateSuperPowers checks whether `side` may choose `ids` right now without mutating state.
func (s *Sim) ValidateSuperPowers(side int, ids []string) ([]string, error) {
	if s.Over {
		return nil, ErrOver
	}
	if side != 0 && side != 1 {
		return nil, ErrBadCommand
	}
	if s.superLimit <= 0 {
		return nil, ErrSuperPowersOff
	}
	if s.superFast {
		out := make([]string, 0, len(s.R.SuperPowers))
		for _, sp := range s.R.SuperPowers {
			out = append(out, sp.ID)
		}
		return out, nil
	}
	want := s.wantedSuperCount()
	ss := &s.supers[side]
	if len(ss.chosen) == want {
		// Allow idempotent re-submission when rebuilding with the same already-chosen powers.
		if slices.Equal(ss.chosen, ids) {
			return append([]string{}, ss.chosen...), nil
		}
		return nil, fmt.Errorf("%w: super powers are already locked in for this match", ErrSuperLimit)
	}
	seen := map[string]bool{}
	clean := make([]string, 0, len(ids))
	for _, id := range ids {
		if seen[id] {
			return nil, fmt.Errorf("%w: duplicate super power %q", ErrSuperLimit, id)
		}
		if _, ok := s.R.SuperPowerDef(id); !ok {
			return nil, fmt.Errorf("%w: %q", ErrSuperUnknown, id)
		}
		seen[id] = true
		clean = append(clean, id)
	}
	if len(clean) != want {
		return nil, fmt.Errorf("%w: choose exactly %d super power(s), got %d", ErrSuperLimit, want, len(clean))
	}
	return clean, nil
}

// SelectSuperPowers chooses a side's super powers (must match the match's exact allowed count).
// Can be called when starting the super-weapon building or once it stands (e.g., after capture).
func (s *Sim) SelectSuperPowers(side int, ids []string) ([]string, error) {
	clean, err := s.ValidateSuperPowers(side, ids)
	if err != nil {
		return nil, err
	}
	if s.superFast {
		s.fillAllSuperPowers(side)
		return append([]string{}, s.supers[side].chosen...), nil
	}
	ss := &s.supers[side]
	if len(ss.chosen) == len(clean) && slices.Equal(ss.chosen, clean) {
		return append([]string{}, ss.chosen...), nil
	}
	st := s.superStructure(side)
	readyNow := st != nil && st.Standing()
	ss.chosen = clean
	ss.readyTick = make([]int, len(clean))
	ss.totalTicks = make([]int, len(clean))
	ss.readyFired = make([]bool, len(clean))
	if readyNow {
		ss.armed = true
		for i, id := range clean {
			sp, _ := s.R.SuperPowerDef(id)
			initT := s.initialTicksFor(sp)
			ss.readyTick[i] = s.Tick + initT
			ss.totalTicks[i] = max(1, initT)
			ss.readyFired[i] = ss.readyTick[i] <= s.Tick
		}
	} else {
		for i, id := range clean {
			sp, _ := s.R.SuperPowerDef(id)
			initT := s.initialTicksFor(sp)
			ss.readyTick[i] = initT // relative until building finishes
			ss.totalTicks[i] = max(1, initT)
		}
	}
	return append([]string{}, ss.chosen...), nil
}

func (s *Sim) fillAllSuperPowers(side int) {
	ss := &s.supers[side]
	if ss.autoFilled && len(ss.chosen) == len(s.R.SuperPowers) {
		return
	}
	ss.chosen = make([]string, 0, len(s.R.SuperPowers))
	ss.readyTick = make([]int, 0, len(s.R.SuperPowers))
	ss.totalTicks = make([]int, 0, len(s.R.SuperPowers))
	ss.readyFired = make([]bool, 0, len(s.R.SuperPowers))
	for _, sp := range s.R.SuperPowers {
		ss.chosen = append(ss.chosen, sp.ID)
		ss.readyTick = append(ss.readyTick, s.Tick)
		ss.totalTicks = append(ss.totalTicks, max(1, s.cooldownTicksFor(sp)))
		ss.readyFired = append(ss.readyFired, true)
	}
	ss.armed = true
	ss.autoFilled = true
}

// onSuperStructureBuilt initializes or re-arms super-power cooldowns when a side's super weapon
// complex finishes construction or is captured standing.
func (s *Sim) onSuperStructureBuilt(side int) {
	if s.superLimit <= 0 {
		return
	}
	if s.superFast {
		s.fillAllSuperPowers(side)
		for _, id := range s.supers[side].chosen {
			s.emit(Event{Side: side, Kind: EvSuperReady, Unit: id})
			break // announce once so radio doesn't spam 15 lines
		}
		return
	}
	ss := &s.supers[side]
	if len(ss.chosen) == 0 {
		return // waiting for commander to choose powers via picker
	}
	wasArmed := ss.armed
	ss.armed = true
	for i, id := range ss.chosen {
		sp, ok := s.R.SuperPowerDef(id)
		if !ok {
			continue
		}
		initT := s.initialTicksFor(sp)
		want := s.Tick + initT
		if !wasArmed || ss.readyTick[i] < want {
			// Initial build, or rebuilding a destroyed/sold complex: never skip an active longer
			// cooldown, and always take at least initialTicksFor(sp) to arm a newly built silo.
			ss.readyTick[i] = want
			ss.totalTicks[i] = max(1, initT)
			ss.readyFired[i] = ss.readyTick[i] <= s.Tick
		}
	}
}

// FireSuperPower launches a ready super power at the chosen target(s).
func (s *Sim) FireSuperPower(side int, powerID string, x, y, x2, y2 float64, targets []TargetXY) (*SuperStrike, error) {
	if s.Over {
		return nil, ErrOver
	}
	if side != 0 && side != 1 {
		return nil, ErrBadCommand
	}
	if s.superLimit <= 0 {
		return nil, ErrSuperPowersOff
	}
	st := s.superStructure(side)
	if st == nil || !st.Standing() {
		return nil, ErrSuperLocked
	}
	if !s.powered(st) {
		return nil, ErrSuperNoPower
	}
	if s.superFast {
		s.fillAllSuperPowers(side)
	}
	sp, ok := s.R.SuperPowerDef(powerID)
	if !ok {
		return nil, ErrSuperUnknown
	}
	ss := &s.supers[side]
	idx := slices.Index(ss.chosen, powerID)
	if idx < 0 {
		return nil, ErrSuperUnknown
	}
	if s.Tick < ss.readyTick[idx] {
		return nil, ErrSuperNotReady
	}

	inMap := func(px, py float64) bool {
		return !math.IsNaN(px) && !math.IsNaN(py) && !math.IsInf(px, 0) && !math.IsInf(py, 0) &&
			px >= 0 && py >= 0 && px <= s.R.Map.Width && py <= s.R.Map.Height
	}
	clamp := func(v, hi float64) float64 {
		return math.Max(12, math.Min(hi-12, v))
	}

	var cleanTargets []TargetXY
	if sp.Cursor == shared.CursorMulti3 {
		if len(targets) == 0 {
			if !inMap(x, y) {
				return nil, fmt.Errorf("%w: target is outside the map", ErrSuperTarget)
			}
			cx, cy := clamp(x, s.R.Map.Width), clamp(y, s.R.Map.Height)
			cleanTargets = []TargetXY{{cx, cy}, {clamp(cx+70, s.R.Map.Width), cy}, {clamp(cx-70, s.R.Map.Width), cy}}
		} else {
			for i := 0; i < len(targets) && i < 3; i++ {
				if !inMap(targets[i].X, targets[i].Y) {
					return nil, fmt.Errorf("%w: target %d is outside the map", ErrSuperTarget, i+1)
				}
				cleanTargets = append(cleanTargets, TargetXY{clamp(targets[i].X, s.R.Map.Width), clamp(targets[i].Y, s.R.Map.Height)})
			}
			for len(cleanTargets) < 3 {
				last := cleanTargets[len(cleanTargets)-1]
				cleanTargets = append(cleanTargets, last)
			}
		}
		x, y = cleanTargets[0].X, cleanTargets[0].Y
	} else {
		if !inMap(x, y) {
			return nil, fmt.Errorf("%w: target is outside the map", ErrSuperTarget)
		}
		x, y = clamp(x, s.R.Map.Width), clamp(y, s.R.Map.Height)
	}

	// Subterranean breach must land on walkable land (not open sea or mountain).
	if powerID == "tunnelAmbush" && s.R.Map.TerrainAt(x, y) != 'L' {
		return nil, fmt.Errorf("%w: subterranean breach must target open land", ErrSuperTarget)
	}

	// Normalize line/strip endpoints so they match the power's length.
	if sp.Cursor == shared.CursorLine || sp.Cursor == shared.CursorStrip {
		if math.IsNaN(x2) || math.IsNaN(y2) || math.IsInf(x2, 0) || math.IsInf(y2, 0) || (x2 == 0 && y2 == 0) {
			dx, dy := s.towardEnemy(side, x, y)
			x2, y2 = x+dx*sp.Length, y+dy*sp.Length
		}
		dx, dy := x2-x, y2-y
		d := math.Hypot(dx, dy)
		if d < 20 {
			dx, dy = s.towardEnemy(side, x, y)
			d = 1
		}
		span := sp.Length
		if span <= 0 {
			span = 260
		}
		x2 = clamp(x+dx/d*span, s.R.Map.Width)
		y2 = clamp(y+dy/d*span, s.R.Map.Height)
	} else {
		x2, y2 = 0, 0
	}

	delayTicks := int(math.Round(sp.DelaySeconds * float64(s.R.TickRate)))
	durTicks := int(math.Round(sp.DurationSeconds * float64(s.R.TickRate)))
	impactTick := s.Tick + delayTicks
	endTick := impactTick + durTicks

	s.superStrikeN++
	strike := &SuperStrike{
		ID:         s.superStrikeN,
		Power:      sp.ID,
		Side:       side,
		StartTick:  s.Tick,
		ImpactTick: impactTick,
		EndTick:    endTick,
		X:          round1(x),
		Y:          round1(y),
		X2:         round1(x2),
		Y2:         round1(y2),
		Targets:    cleanTargets,
		Seed:       s.rng.Uint32(),
	}

	// Pre-plan deterministic sub-impacts for multi-strike powers so the client renders exact
	// synchronized trajectories and impacts!
	s.planSubImpacts(strike, sp)

	// Start recharge cycle.
	cd := s.cooldownTicksFor(sp)
	ss.readyTick[idx] = s.Tick + cd
	ss.totalTicks[idx] = max(1, cd)
	ss.readyFired[idx] = false

	s.SuperStrikes = append(s.SuperStrikes, strike)

	pt := s.nearestPoint(x, y)
	s.emit(Event{Side: side, Kind: EvSuperLaunched, Unit: sp.ID, Point: pt})

	// Warn the enemy only when fog of war allows it (or global strategic launch detection
	// for ICBM/orbital superweapons, without leaking an unseen target point!).
	other := 1 - side
	if sp.ID != "radioSpoof" {
		if s.strikeInSight(other, strike) {
			s.emit(Event{Side: other, Kind: EvSuperIncoming, Unit: sp.ID, Point: pt})
		} else if sp.ID == "tacticalNuke" || sp.ID == "rodOfGod" {
			s.emit(Event{Side: other, Kind: EvSuperIncoming, Unit: sp.ID})
		}
	}
	return strike, nil
}

func (s *Sim) planSubImpacts(st *SuperStrike, sp shared.SuperPower) {
	switch sp.ID {
	case "artilleryFirestorm":
		n := max(1, sp.Count)
		dur := max(1, st.EndTick-st.ImpactTick)
		for i := 0; i < n; i++ {
			ang := s.rng.Float64() * 2 * math.Pi
			r := math.Sqrt(s.rng.Float64()) * sp.Radius * 0.92
			sx := math.Max(16, math.Min(s.R.Map.Width-16, st.X+math.Cos(ang)*r))
			sy := math.Max(16, math.Min(s.R.Map.Height-16, st.Y+math.Sin(ang)*r))
			t := st.ImpactTick + (i*dur)/n + s.rng.IntN(max(1, dur/n))
			st.SubImpacts = append(st.SubImpacts, SubImpact{
				X: round1(sx), Y: round1(sy),
				LaunchTick: max(st.StartTick, t-14),
				ImpactTick: t,
			})
		}
	case "scudSalvo":
		n := max(1, sp.Count)
		dur := max(1, st.EndTick-st.ImpactTick)
		for i := 0; i < n; i++ {
			ang := (float64(i)/float64(n))*2*math.Pi + (s.rng.Float64()-0.5)*0.8
			r := (0.2 + 0.72*s.rng.Float64()) * sp.Radius
			sx := math.Max(18, math.Min(s.R.Map.Width-18, st.X+math.Cos(ang)*r))
			sy := math.Max(18, math.Min(s.R.Map.Height-18, st.Y+math.Sin(ang)*r))
			t := st.ImpactTick + (i*dur)/n
			st.SubImpacts = append(st.SubImpacts, SubImpact{
				X: round1(sx), Y: round1(sy),
				LaunchTick: max(st.StartTick, t-34),
				ImpactTick: t,
			})
		}
	case "lightningStorm":
		n := max(1, sp.Count)
		dur := max(1, st.EndTick-st.ImpactTick)
		for i := 0; i < n; i++ {
			t := st.ImpactTick + (i*dur)/n + s.rng.IntN(max(1, dur/(n*2)))
			ang := s.rng.Float64() * 2 * math.Pi
			r := math.Sqrt(s.rng.Float64()) * sp.Radius * 0.9
			st.SubImpacts = append(st.SubImpacts, SubImpact{
				X:          round1(math.Max(16, math.Min(s.R.Map.Width-16, st.X+math.Cos(ang)*r))),
				Y:          round1(math.Max(16, math.Min(s.R.Map.Height-16, st.Y+math.Sin(ang)*r))),
				LaunchTick: t,
				ImpactTick: t,
			})
		}
	case "droneSwarm":
		n := max(1, sp.Count)
		dur := max(1, st.EndTick-st.ImpactTick)
		for i := 0; i < n; i++ {
			t := st.ImpactTick + 8 + (i*(dur-10))/n
			ang := s.rng.Float64() * 2 * math.Pi
			r := math.Sqrt(s.rng.Float64()) * sp.Radius * 0.85
			st.SubImpacts = append(st.SubImpacts, SubImpact{
				X:          round1(math.Max(16, math.Min(s.R.Map.Width-16, st.X+math.Cos(ang)*r))),
				Y:          round1(math.Max(16, math.Min(s.R.Map.Height-16, st.Y+math.Sin(ang)*r))),
				LaunchTick: st.StartTick,
				ImpactTick: t,
			})
		}
	case "cruiseMissiles":
		// Launch from nearest map sea/side edge toward each of the 3 targets.
		for i, tgt := range st.Targets {
			sx, sy := s.cruiseOrigin(st.Side, tgt.X, tgt.Y, i)
			travel := int(math.Round(math.Max(22, dist(sx, sy, tgt.X, tgt.Y)/230*float64(s.R.TickRate))))
			launch := st.StartTick + i*7
			impact := launch + travel
			if impact > st.EndTick {
				st.EndTick = impact
			}
			st.SubImpacts = append(st.SubImpacts, SubImpact{
				X: tgt.X, Y: tgt.Y, StartX: round1(sx), StartY: round1(sy),
				LaunchTick: launch, ImpactTick: impact,
			})
		}
		if len(st.SubImpacts) > 0 {
			st.ImpactTick = st.SubImpacts[0].ImpactTick
		}
	}
}

func (s *Sim) cruiseOrigin(side int, tx, ty float64, idx int) (float64, float64) {
	if side == 0 {
		return 10, math.Max(40, math.Min(s.R.Map.Height-40, ty+float64(idx-1)*120))
	}
	return s.R.Map.Width - 10, math.Max(40, math.Min(s.R.Map.Height-40, ty+float64(idx-1)*120))
}

// stepSuperPowers advances cooldowns, active strikes, sub-impacts and lingering hazards.
func (s *Sim) stepSuperPowers(live []*teamRef) {
	if s.superLimit <= 0 {
		return
	}
	// 1. Cooldown progression: hold recharge timers whenever the complex is missing, rising,
	// unpowered or EMP/cyber disabled so selling/destroying never cheats cooldowns!
	for side := 0; side < 2; side++ {
		st := s.superStructure(side)
		ss := &s.supers[side]
		if st != nil && st.Standing() && s.superFast && !ss.autoFilled {
			s.fillAllSuperPowers(side)
		}
		if st == nil || !st.Standing() || !s.powered(st) {
			if ss.armed {
				for i := range ss.readyTick {
					if ss.readyTick[i] > s.Tick {
						ss.readyTick[i]++
					}
				}
			}
			continue
		}
		for i, id := range ss.chosen {
			if !ss.readyFired[i] && s.Tick >= ss.readyTick[i] {
				ss.readyFired[i] = true
				s.emit(Event{Side: side, Kind: EvSuperReady, Unit: id})
			}
		}
	}

	// 2. Step active strikes.
	keep := s.SuperStrikes[:0]
	for _, st := range s.SuperStrikes {
		sp, ok := s.R.SuperPowerDef(st.Power)
		if !ok {
			continue
		}
		s.stepStrike(st, sp, live)
		// Keep completed strikes in Snapshot for 4 seconds so clients finish animating them.
		if s.Tick <= st.EndTick+4*s.R.TickRate {
			keep = append(keep, st)
		}
	}
	s.SuperStrikes = keep

	// 3. Step active hazards (fallout, drifting chemical cloud, napalm fire, cyber dome, EMP, spoof).
	keepH := s.Hazards[:0]
	for i := range s.Hazards {
		h := &s.Hazards[i]
		if s.Tick > h.EndTick {
			continue
		}
		s.stepHazard(h, live)
		keepH = append(keepH, *h)
	}
	s.Hazards = keepH
}

func airborne(tr *teamRef) bool {
	return tr.u.Domain == "air" && (tr.sq.sortie == nil || !tr.sq.sortie.grounded())
}

func (s *Sim) stepStrike(st *SuperStrike, sp shared.SuperPower, live []*teamRef) {
	switch sp.ID {
	case "rodOfGod":
		if !st.Detonated && s.Tick >= st.ImpactTick {
			st.Detonated = true
			s.applyBlast(st, st.X, st.Y, sp.Radius, sp.CoreRadius, sp.Damage, sp.StructureDamage, sp.Stress, 0.25, 0.25, live, true, false, true)
			s.addCrater(st.X, st.Y, sp.CraterRadius, "kinetic")
		}

	case "tacticalNuke":
		if !st.Detonated && s.Tick >= st.ImpactTick {
			st.Detonated = true
			s.applyBlast(st, st.X, st.Y, sp.Radius, sp.CoreRadius, sp.Damage, sp.StructureDamage, sp.Stress, 0.30, 0.30, live, true, true, true)
			s.addCrater(st.X, st.Y, sp.CraterRadius, "nuke")
			s.addHazard(Hazard{
				Kind: "fallout", Side: st.Side, X: st.X, Y: st.Y, R: sp.Radius * 0.85,
				StartTick: s.Tick, EndTick: st.EndTick,
			})
		}

	case "chemicalStrike":
		if !st.Detonated && s.Tick >= st.ImpactTick {
			st.Detonated = true
			dx, dy := s.towardEnemy(st.Side, st.X, st.Y)
			s.addHazard(Hazard{
				Kind: "chemical", Side: st.Side, X: st.X, Y: st.Y, R: sp.Radius,
				StartTick: s.Tick, EndTick: st.EndTick,
				VX: dx * 3.8, VY: dy*3.8 + 1.4,
			})
		}

	case "lightningStorm":
		for i := range st.SubImpacts {
			sub := &st.SubImpacts[i]
			if sub.Done || s.Tick < sub.ImpactTick {
				continue
			}
			sub.Done = true
			if tx, ty, found := s.pickMetalTarget(st.Side, st.X, st.Y, sp.Radius, live); found {
				sub.X, sub.Y = round1(tx), round1(ty)
			}
			s.applyBlast(st, sub.X, sub.Y, sp.CoreRadius, sp.CoreRadius*0.5, sp.Damage, sp.StructureDamage, sp.Stress, 0.06, 0.18, live, false, false, true)
			if i%2 == 0 {
				s.addCrater(sub.X, sub.Y, 16, "scorch")
			}
			for _, b := range s.Structures {
				if b.Side != st.Side && !b.Ruin && dist(b.X, b.Y, sub.X, sub.Y) <= sp.CoreRadius+b.def.Footprint {
					if b.disabledUntil < s.Tick+6*s.R.TickRate {
						b.disabledUntil = s.Tick + 6*s.R.TickRate
					}
				}
			}
		}

	case "droneSwarm":
		for i := range st.SubImpacts {
			sub := &st.SubImpacts[i]
			if sub.Done || s.Tick < sub.ImpactTick {
				continue
			}
			sub.Done = true
			if tx, ty, found := s.pickDroneTarget(st.Side, st.X, st.Y, sp.Radius, live); found {
				sub.X, sub.Y = round1(tx), round1(ty)
			}
			s.applyBlast(st, sub.X, sub.Y, sp.CoreRadius, sp.CoreRadius*0.5, sp.Damage, sp.StructureDamage, sp.Stress, 0.03, 0.12, live, false, false, false)
			if i%3 == 0 {
				s.addCrater(sub.X, sub.Y, 13, "scorch")
			}
		}

	case "cyberBlackout":
		if !st.Detonated && s.Tick >= st.ImpactTick {
			st.Detonated = true
			s.addHazard(Hazard{
				Kind: "cyber", Side: st.Side, X: st.X, Y: st.Y, R: sp.Radius,
				StartTick: s.Tick, EndTick: st.EndTick,
			})
		}

	case "orbitalLaser":
		if s.Tick >= st.ImpactTick && s.Tick <= st.EndTick {
			if !st.Detonated {
				st.Detonated = true
				s.addHazard(Hazard{
					Kind: "trench", Side: st.Side, X: st.X, Y: st.Y, X2: st.X2, Y2: st.Y2, R: sp.Width * 0.5,
					StartTick: st.ImpactTick, EndTick: st.EndTick + 25*s.R.TickRate,
				})
			}
			span := math.Max(1, float64(st.EndTick-st.ImpactTick))
			k := math.Max(0, math.Min(1, float64(s.Tick-st.ImpactTick)/span))
			bx := st.X + (st.X2-st.X)*k
			by := st.Y + (st.Y2-st.Y)*k
			tickDmg := sp.Damage * s.dt * 1.4
			tickStruct := sp.StructureDamage * s.dt * 1.4
			s.applyBlast(st, bx, by, sp.Radius, sp.Radius*0.5, tickDmg, tickStruct, sp.Stress*s.dt, 0.04, 0.22, live, true, false, true)
		}

	case "thermobaricMoab":
		if !st.Detonated && s.Tick >= st.ImpactTick {
			st.Detonated = true
			// Instantly clears every garrisoned building & flattens sandbags inside radius!
			for _, tr := range live {
				if tr.t.Members > 0 && tr.t.In != "" && dist(tr.t.X, tr.t.Y, st.X, st.Y) <= sp.Radius {
					s.leave(tr)
					tr.t.dmg += tr.t.HP + 100 // vacuum overpressure clears garrison
					tr.t.hits++
				}
			}
			for i := range s.Landmarks {
				l := &s.Landmarks[i]
				if l.Kind != Rubble && l.HP > 0 && dist(l.X, l.Y, st.X, st.Y) <= sp.Radius {
					if l.Kind == Sandbags {
						l.dmg += l.HP + 500
					} else {
						l.dmg += sp.StructureDamage * 0.65
					}
				}
			}
			s.applyBlast(st, st.X, st.Y, sp.Radius, sp.CoreRadius, sp.Damage, sp.StructureDamage, sp.Stress, 0.20, 0.20, live, true, false, true)
			s.addCrater(st.X, st.Y, sp.CraterRadius, "moab")
		}

	case "empPulse":
		if !st.Detonated && s.Tick >= st.ImpactTick {
			st.Detonated = true
			until := st.EndTick
			s.addHazard(Hazard{
				Kind: "emp", Side: st.Side, X: st.X, Y: st.Y, R: sp.Radius,
				StartTick: s.Tick, EndTick: until,
			})
			for _, tr := range live {
				if tr.t.Members <= 0 || tr.sq.Side == st.Side || dist(tr.t.X, tr.t.Y, st.X, st.Y) > sp.Radius {
					continue
				}
				switch tr.u.Class {
				case "air":
					if airborne(tr) {
						// EMP crashes airborne aircraft straight out of the sky!
						tr.t.dmg += tr.t.HP + 200
						tr.t.hits++
					}
					tr.t.stunUntil = until
				case "vehicle", "naval", shared.HaulerClass:
					tr.t.stunUntil = until
					tr.t.Stress = math.Min(1, tr.t.Stress+sp.Stress)
				default:
					tr.t.Stress = math.Min(1, tr.t.Stress+sp.Stress*0.6)
				}
			}
			for _, b := range s.Structures {
				if b.Side != st.Side && !b.Ruin && dist(b.X, b.Y, st.X, st.Y) <= sp.Radius+b.def.Footprint {
					if b.disabledUntil < until {
						b.disabledUntil = until
					}
				}
			}
		}

	case "napalmRun":
		if !st.Detonated && s.Tick >= st.ImpactTick {
			st.Detonated = true
			s.addHazard(Hazard{
				Kind: "napalm", Side: st.Side, X: st.X, Y: st.Y, X2: st.X2, Y2: st.Y2, R: sp.Width * 0.5,
				StartTick: s.Tick, EndTick: st.EndTick,
			})
			steps := max(4, sp.Count)
			for i := 0; i < steps; i++ {
				k := float64(i) / float64(steps-1)
				px := st.X + (st.X2-st.X)*k
				py := st.Y + (st.Y2-st.Y)*k
				s.applyBlast(st, px, py, sp.Width*0.65, sp.Width*0.35, 110, 90, sp.Stress, 0.05, 0.15, live, false, false, false)
			}
		}

	case "artilleryFirestorm":
		for i := range st.SubImpacts {
			sub := &st.SubImpacts[i]
			if sub.Done || s.Tick < sub.ImpactTick {
				continue
			}
			sub.Done = true
			s.applyBlast(st, sub.X, sub.Y, sp.CoreRadius, sp.CoreRadius*0.45, sp.Damage, sp.StructureDamage, sp.Stress, 0.04, 0.20, live, true, false, false)
			if i%3 == 0 {
				s.addCrater(sub.X, sub.Y, sp.CraterRadius, "artillery")
			} else if i%2 == 1 {
				s.addCrater(sub.X, sub.Y, 17, "scorch")
			}
		}

	case "scudSalvo":
		for i := range st.SubImpacts {
			sub := &st.SubImpacts[i]
			if sub.Done || s.Tick < sub.ImpactTick {
				continue
			}
			sub.Done = true
			s.applyBlast(st, sub.X, sub.Y, sp.CoreRadius, sp.CoreRadius*0.5, sp.Damage, sp.StructureDamage, sp.Stress, 0.08, 0.24, live, true, false, true)
			s.addCrater(sub.X, sub.Y, sp.CraterRadius, "scud")
		}

	case "tunnelAmbush":
		if !st.Detonated && s.Tick >= st.ImpactTick {
			st.Detonated = true
			s.applyBlast(st, st.X, st.Y, sp.Radius, sp.CoreRadius, sp.Damage, sp.StructureDamage, sp.Stress, 0.18, 0.18, live, true, false, false)
			s.addCrater(st.X, st.Y, sp.CraterRadius, "tunnel")
			// Deploy instant ambush force directly at the breach (bounded near pop cap so sandbox cannot spawn unbounded units).
			units := []string{"militia", "sappers"}
			if s.Sides[st.Side].Faction == "aegis" {
				units = []string{"commandos", "engineers"}
			}
			pop := 0
			for _, o := range s.Squads {
				if o.Side == st.Side && o.haul == nil && (o.Alive || o.Deploying()) {
					pop++
				}
			}
			for k, uid := range units {
				if pop >= s.R.Match.PopulationCap+4 {
					break
				}
				if _, ok := s.faction(st.Side).Units[uid]; !ok {
					continue
				}
				sq := s.raise(st.Side, uid)
				s.fieldAt(sq, st.X+float64(k*24-12), st.Y+float64(k*16-8))
				pop++
			}
		}

	case "radioSpoof":
		if !st.Detonated && s.Tick >= st.ImpactTick {
			st.Detonated = true
			n := max(6, sp.Count)
			decoys := make([]Decoy, 0, n)
			unitPool := []string{"tank", "commandos", "rocketLauncher"}
			if s.Sides[st.Side].Faction == "ashfall" {
				unitPool = []string{"technical", "militia", "rpgTeam"}
			}
			for i := 0; i < n; i++ {
				ang := float64(i)/float64(n)*2*math.Pi + s.rng.Float64()*0.4
				r := (0.25 + 0.65*s.rng.Float64()) * sp.Radius
				decoys = append(decoys, Decoy{
					X:    round1(math.Max(20, math.Min(s.R.Map.Width-20, st.X+math.Cos(ang)*r))),
					Y:    round1(math.Max(20, math.Min(s.R.Map.Height-20, st.Y+math.Sin(ang)*r))),
					Unit: unitPool[i%len(unitPool)],
				})
			}
			s.addHazard(Hazard{
				Kind: "spoof", Side: st.Side, X: st.X, Y: st.Y, R: sp.Radius,
				StartTick: s.Tick, EndTick: st.EndTick, Decoys: decoys,
			})
		}

	case "cruiseMissiles":
		for i := range st.SubImpacts {
			sub := &st.SubImpacts[i]
			if sub.Done || s.Tick < sub.LaunchTick {
				continue
			}
			// Check AA interception along flight path when passing over powered enemy AA.
			if !sub.Intercepted && s.Tick < sub.ImpactTick && s.Tick > sub.LaunchTick+3 {
				span := math.Max(1, float64(sub.ImpactTick-sub.LaunchTick))
				k := float64(s.Tick-sub.LaunchTick) / span
				mx := sub.StartX + (sub.X-sub.StartX)*k
				my := sub.StartY + (sub.Y-sub.StartY)*k
				for _, b := range s.Structures {
					if b.Side != st.Side && b.def.Role == shared.RoleDefence && s.powered(b) && b.def.Against("air") >= 0.8 {
						if dist(b.X, b.Y, mx, my) <= b.def.Range*0.65 && s.rng.Float64() < 0.045 {
							sub.Intercepted = true
							sub.X, sub.Y = round1(mx), round1(my)
							sub.ImpactTick = s.Tick
							sub.Done = true
							break
						}
					}
				}
			}
			if !sub.Done && s.Tick >= sub.ImpactTick {
				sub.Done = true
				s.applyBlast(st, sub.X, sub.Y, sp.Radius, sp.CoreRadius, sp.Damage, sp.StructureDamage, sp.Stress, 0.09, 0.24, live, true, false, false)
				s.addCrater(sub.X, sub.Y, sp.CraterRadius, "cruise")
			}
		}
	}
}

func (s *Sim) fieldAt(sq *Squad, x, y float64) {
	u := sq.unit
	sq.Alive = true
	sq.Teams = make([]Team, 0, u.Teams)
	for i := 0; i < u.Teams; i++ {
		ox := float64((i%2)*2-1) * 14
		oy := float64((i/2)*2-1) * 14
		tx, ty := s.nav.snapXY(navGround, x+ox, y+oy)
		tx, ty = s.room(sq, nil, tx, ty)
		sq.Teams = append(sq.Teams, Team{
			X: tx, Y: ty, prevX: tx, prevY: ty,
			HP: u.HP * float64(u.Members), Members: u.Members,
			Action: ActIdle, lastShot: never, lastFire: never, Cover: 1,
		})
	}
	s.emit(Event{Side: sq.Side, Kind: EvSquadSpawned, Squad: sq.ID, Unit: sq.Unit, Point: s.nearestPoint(x, y)})
}

func (s *Sim) stepHazard(h *Hazard, live []*teamRef) {
	switch h.Kind {
	case "fallout":
		for _, tr := range live {
			if tr.t.Members <= 0 || airborne(tr) || dist(tr.t.X, tr.t.Y, h.X, h.Y) > h.R {
				continue
			}
			mult := 1.0
			if tr.u.Class == "vehicle" || tr.u.Class == shared.HaulerClass {
				mult = 0.25
			}
			tr.t.dmg += 26 * mult * s.dt
			tr.t.hits++
			tr.t.Stress = math.Min(1, tr.t.Stress+0.09*s.dt)
		}
	case "chemical":
		h.X = round1(math.Max(20, math.Min(s.R.Map.Width-20, h.X+h.VX*s.dt)))
		h.Y = round1(math.Max(20, math.Min(s.R.Map.Height-20, h.Y+h.VY*s.dt)))
		for _, tr := range live {
			if tr.t.Members <= 0 || airborne(tr) || dist(tr.t.X, tr.t.Y, h.X, h.Y) > h.R {
				continue
			}
			if tr.u.Class == "infantry" {
				// Flushes garrisoned infantry out onto open ground and rapidly melts them!
				if tr.t.In != "" {
					s.leave(tr)
				}
				tr.t.dmg += 38 * s.dt
				tr.t.hits++
				tr.t.Stress = math.Min(1, tr.t.Stress+0.25*s.dt)
			} else if tr.u.Class == "vehicle" || tr.u.Class == shared.HaulerClass {
				tr.t.Stress = math.Min(1, tr.t.Stress+0.05*s.dt)
			}
		}
	case "napalm":
		for _, tr := range live {
			if tr.t.Members <= 0 || airborne(tr) {
				continue
			}
			if pointSegDist(tr.t.X, tr.t.Y, h.X, h.Y, h.X2, h.Y2) <= h.R {
				mult := 1.0
				if tr.u.Class == "vehicle" || tr.u.Class == shared.HaulerClass {
					mult = 0.45
				}
				tr.t.dmg += 42 * mult * s.dt
				tr.t.hits++
				tr.t.Stress = math.Min(1, tr.t.Stress+0.18*s.dt)
			}
		}
		for _, b := range s.Structures {
			if !b.Ruin && pointSegDist(b.X, b.Y, h.X, h.Y, h.X2, h.Y2) <= h.R+b.def.Footprint {
				mult := 1.0
				if b.Side == h.Side {
					mult = 0.35
				}
				b.dmg += 28 * mult * s.dt
				b.hit = true
			}
		}
	case "cyber":
		// Continuously disables enemy structures/radar/turrets/production and exposes stealth inside dome.
		for _, b := range s.Structures {
			if b.Side != h.Side && !b.Ruin && dist(b.X, b.Y, h.X, h.Y) <= h.R+b.def.Footprint {
				if b.disabledUntil < s.Tick+4 {
					b.disabledUntil = s.Tick + 4
				}
			}
		}
		for _, tr := range live {
			if tr.t.Members > 0 && tr.sq.Side != h.Side && dist(tr.t.X, tr.t.Y, h.X, h.Y) <= h.R {
				if tr.t.revealedUntil < s.Tick+4 {
					tr.t.revealedUntil = s.Tick + 4
				}
				tr.t.Stress = math.Min(1, tr.t.Stress+0.06*s.dt)
			}
		}
	case "spoof":
		// Drains enemy squad nerve inside the psy-ops broadcast zone.
		for _, tr := range live {
			if tr.t.Members > 0 && tr.sq.Side != h.Side && dist(tr.t.X, tr.t.Y, h.X, h.Y) <= h.R {
				tr.t.Stress = math.Min(1, tr.t.Stress+0.12*s.dt)
			}
		}
	}
}

func (s *Sim) applyBlast(st *SuperStrike, x, y, radius, core, unitDmg, structDmg, stress, hqHitCap, hqTotalCap float64, live []*teamRef, hitBridges, friendlyFire, hitAir bool) {
	if radius <= 0 {
		return
	}
	attacker := st.Side
	falloff := func(d float64) float64 {
		if d <= core {
			return 1
		}
		if d >= radius {
			return 0
		}
		return 0.2 + 0.8*(1-(d-core)/math.Max(1, radius-core))
	}
	for _, tr := range live {
		if tr.t.Members <= 0 || (!hitAir && airborne(tr)) {
			continue
		}
		if !friendlyFire && tr.sq.Side == attacker && unitDmg > 0 {
			if d := dist(tr.t.X, tr.t.Y, x, y); d <= radius {
				f := falloff(d) * 0.35
				tr.t.dmg += unitDmg * f * (1 - tr.u.Armor*0.35)
				tr.t.hits++
				tr.t.Stress = math.Min(1, tr.t.Stress+stress*f*0.5)
			}
			continue
		}
		if d := dist(tr.t.X, tr.t.Y, x, y); d <= radius {
			f := falloff(d)
			tr.t.dmg += unitDmg * f * (1 - tr.u.Armor*0.25)
			tr.t.hits++
			tr.t.Stress = math.Min(1, tr.t.Stress+stress*f)
		}
	}
	if structDmg > 0 {
		for _, b := range s.Structures {
			if b.Ruin || b.Gone {
				continue
			}
			d := dist(b.X, b.Y, x, y) - b.def.Footprint
			if b.def.Role == shared.RoleFence {
				d = segDist(x, y, b.AX, b.AY, b.BX, b.BY)
			}
			if d <= radius {
				f := falloff(math.Max(0, d))
				if !friendlyFire && b.Side == attacker {
					f *= 0.35
				}
				b.dmg += structDmg * f
				b.hit = true
			}
		}
		for i := range s.Landmarks {
			l := &s.Landmarks[i]
			if l.Kind == Rubble || l.Kind == SandbagsFlat || l.HP <= 0 {
				continue
			}
			if d := dist(l.X, l.Y, x, y); d <= radius {
				l.dmg += structDmg * falloff(d)
			}
		}
		if hitBridges {
			for i := range s.Bridges {
				br := &s.Bridges[i]
				if !br.Standing {
					continue
				}
				if d := pointSegDist(x, y, br.From[0], br.From[1], br.To[0], br.To[1]); d <= radius {
					br.dmg += structDmg * falloff(d)
					br.by[attacker] = true
				}
			}
		}
		// HQ damage capped both per sub-hit and across the entire strike so no single super
		// power (nor a pair of default super powers) can snipe a healthy HQ by itself.
		for side := 0; side < 2; side++ {
			if !friendlyFire && side == attacker {
				continue
			}
			hq := s.R.HQPoint(side)
			if d := dist(hq.X, hq.Y, x, y); d <= radius+40 {
				raw := structDmg * falloff(math.Max(0, d-40))
				hitCap := s.R.HQ.HP * hqHitCap
				if raw > hitCap {
					raw = hitCap
				}
				rem := s.R.HQ.HP*hqTotalCap - st.hqDealt[side]
				if rem < 0 {
					rem = 0
				}
				if raw > rem {
					raw = rem
				}
				if raw > 0 {
					st.hqDealt[side] += raw
					s.Sides[side].HQHP -= raw
					if s.Tick-s.Sides[side].hqAlarm > 15*s.R.TickRate {
						s.Sides[side].hqAlarm = s.Tick
						s.emit(Event{Side: side, Kind: EvHQUnderAttack, Point: hq.ID})
					}
				}
			}
		}
	}
}

func (s *Sim) pickMetalTarget(attacker int, x, y, radius float64, live []*teamRef) (float64, float64, bool) {
	bestScore := 0.0
	var bx, by float64
	for _, tr := range live {
		if tr.t.Members <= 0 || tr.sq.Side == attacker || dist(tr.t.X, tr.t.Y, x, y) > radius {
			continue
		}
		sc := 1.0
		switch tr.u.Class {
		case "air":
			sc = 4.0
		case "vehicle", "naval":
			sc = 3.0
		}
		sc += s.rng.Float64() * 1.5
		if sc > bestScore {
			bestScore, bx, by = sc, tr.t.X, tr.t.Y
		}
	}
	for _, b := range s.Structures {
		if b.Side == attacker || b.Ruin || dist(b.X, b.Y, x, y) > radius {
			continue
		}
		sc := 2.0
		if b.def.Role == shared.RolePower || b.def.Role == shared.RoleRadar || b.def.Role == shared.RoleSuperweapon {
			sc = 4.2
		}
		sc += s.rng.Float64() * 1.5
		if sc > bestScore {
			bestScore, bx, by = sc, b.X, b.Y
		}
	}
	return bx, by, bestScore > 0
}

func (s *Sim) pickDroneTarget(attacker int, x, y, radius float64, live []*teamRef) (float64, float64, bool) {
	var cand []*teamRef
	for _, tr := range live {
		if tr.t.Members > 0 && !airborne(tr) && tr.sq.Side != attacker && dist(tr.t.X, tr.t.Y, x, y) <= radius {
			cand = append(cand, tr)
		}
	}
	if len(cand) == 0 {
		return 0, 0, false
	}
	pick := cand[s.rng.IntN(len(cand))]
	return pick.t.X, pick.t.Y, true
}

func (s *Sim) addCrater(x, y, r float64, kind string) {
	if r <= 0 {
		return
	}
	s.craterN++
	c := Crater{ID: s.craterN, X: round1(x), Y: round1(y), R: round1(r), Tick: s.Tick, Kind: kind}
	for side := 0; side < 2; side++ {
		if s.areaInSight(side, c.X, c.Y, c.R) {
			c.seen[side] = true
		}
	}
	s.Craters = append(s.Craters, c)
	if len(s.Craters) > 160 {
		s.Craters = s.Craters[len(s.Craters)-160:]
	}
}

func (s *Sim) observeCraters(side int) {
	for i := range s.Craters {
		c := &s.Craters[i]
		if !c.seen[side] && s.areaInSight(side, c.X, c.Y, c.R) {
			c.seen[side] = true
		}
	}
}

func (s *Sim) addHazard(h Hazard) {
	s.hazardN++
	h.ID = s.hazardN
	s.Hazards = append(s.Hazards, h)
}

func pointSegDist(px, py, ax, ay, bx, by float64) float64 {
	dx, dy := bx-ax, by-ay
	l2 := dx*dx + dy*dy
	if l2 < 1e-6 {
		return dist(px, py, ax, ay)
	}
	t := math.Max(0, math.Min(1, ((px-ax)*dx+(py-ay)*dy)/l2))
	return dist(px, py, ax+t*dx, ay+t*dy)
}

func (s *Sim) areaInSight(side int, x, y, r float64) bool {
	if side == Spectator {
		return true
	}
	if r < 0 {
		r = 0
	}
	hq := s.R.HQPoint(side)
	if dist(x, y, hq.X, hq.Y) <= s.R.HQ.Sight+r {
		return true
	}
	for i := range s.Points {
		if p := &s.Points[i]; p.Owner == side && dist(x, y, p.X, p.Y) <= s.R.Match.PointSight+r {
			return true
		}
	}
	for _, st := range s.Structures {
		if st.Side == side && st.Standing() && st.def.Sight > 0 && dist(x, y, st.X, st.Y) <= st.def.Sight+r {
			return true
		}
	}
	for _, sq := range s.Squads {
		if !sq.Alive || sq.Side != side {
			continue
		}
		for i := range sq.Teams {
			if t := &sq.Teams[i]; t.Members > 0 && dist(x, y, t.X, t.Y) <= sq.unit.Sight+r {
				return true
			}
		}
	}
	return false
}

func (s *Sim) segInSight(side int, ax, ay, bx, by, r float64) bool {
	if side == Spectator {
		return true
	}
	if r < 0 {
		r = 0
	}
	hq := s.R.HQPoint(side)
	if pointSegDist(hq.X, hq.Y, ax, ay, bx, by) <= s.R.HQ.Sight+r {
		return true
	}
	for i := range s.Points {
		if p := &s.Points[i]; p.Owner == side && pointSegDist(p.X, p.Y, ax, ay, bx, by) <= s.R.Match.PointSight+r {
			return true
		}
	}
	for _, st := range s.Structures {
		if st.Side == side && st.Standing() && st.def.Sight > 0 && pointSegDist(st.X, st.Y, ax, ay, bx, by) <= st.def.Sight+r {
			return true
		}
	}
	for _, sq := range s.Squads {
		if !sq.Alive || sq.Side != side {
			continue
		}
		for i := range sq.Teams {
			if t := &sq.Teams[i]; t.Members > 0 && pointSegDist(t.X, t.Y, ax, ay, bx, by) <= sq.unit.Sight+r {
				return true
			}
		}
	}
	return false
}

func (s *Sim) cruiseSubVisible(side int, sub SubImpact, blastR float64) bool {
	if side == Spectator {
		return true
	}
	if s.Tick >= sub.ImpactTick {
		return s.areaInSight(side, sub.X, sub.Y, blastR)
	}
	if s.Tick >= sub.LaunchTick {
		span := math.Max(1, float64(sub.ImpactTick-sub.LaunchTick))
		k := math.Max(0, math.Min(1, float64(s.Tick-sub.LaunchTick)/span))
		mx := sub.StartX + (sub.X-sub.StartX)*k
		my := sub.StartY + (sub.Y-sub.StartY)*k
		return s.areaInSight(side, mx, my, 40)
	}
	return false
}

func (s *Sim) strikeInSight(side int, st *SuperStrike) bool {
	if side == Spectator || st.Side == side {
		return true
	}
	sp, ok := s.R.SuperPowerDef(st.Power)
	if !ok {
		return false
	}
	if sp.Cursor == shared.CursorLine || sp.Cursor == shared.CursorStrip {
		return s.segInSight(side, st.X, st.Y, st.X2, st.Y2, max(sp.Radius, sp.Width*0.5))
	}
	if st.Power == "cruiseMissiles" {
		for _, sub := range st.SubImpacts {
			if s.cruiseSubVisible(side, sub, sp.Radius) {
				return true
			}
		}
		return false
	}
	return s.areaInSight(side, st.X, st.Y, sp.Radius)
}

func (s *Sim) hazardInSight(side int, h *Hazard) bool {
	if side == Spectator || h.Side == side {
		return true
	}
	if h.Kind == "napalm" || h.Kind == "trench" {
		return s.segInSight(side, h.X, h.Y, h.X2, h.Y2, h.R)
	}
	return s.areaInSight(side, h.X, h.Y, h.R)
}

// snapSuperPowers writes super power state, active strikes, craters and hazards into Snapshot,
// strictly filtered by fog of war for enemy strikes, craters and hazards.
func (s *Sim) snapSuperPowers(snap *Snapshot, side int) {
	if side != Spectator {
		st := s.superStructure(side)
		ss := &s.supers[side]
		v := &SuperPowerView{
			Limit:  s.superLimit,
			Fast:   s.superFast,
			Chosen: append([]string{}, ss.chosen...),
			Slots:  make([]SuperSlotView, 0, len(ss.chosen)),
		}
		if st != nil {
			v.HasBuilding = true
			v.BuildingReady = st.Standing()
			v.Powered = s.powered(st)
			if st.BuildTotal > 0 {
				v.BuildingProgress = 1 - float64(st.BuildTicks)/float64(st.BuildTotal)
			} else {
				v.BuildingProgress = 1
			}
		}
		for i, id := range ss.chosen {
			sp, ok := s.R.SuperPowerDef(id)
			if !ok {
				continue
			}
			cd := s.cooldownTicksFor(sp)
			if i < len(ss.totalTicks) && ss.totalTicks[i] > 0 {
				cd = ss.totalTicks[i]
			}
			rt := ss.readyTick[i]
			if !ss.armed {
				rt = s.Tick + rt
			}
			ready := v.BuildingReady && v.Powered && ss.armed && s.Tick >= rt
			v.Slots = append(v.Slots, SuperSlotView{
				ID: id, ReadyTick: rt, CooldownTicks: cd, Ready: ready,
			})
		}
		snap.SuperPowers = v
	}

	for _, st := range s.SuperStrikes {
		if !s.strikeInSight(side, st) {
			continue
		}
		sv := SuperStrikeView{
			ID: st.ID, Power: st.Power, Side: st.Side,
			StartTick: st.StartTick, ImpactTick: st.ImpactTick, EndTick: st.EndTick,
			X: st.X, Y: st.Y, X2: st.X2, Y2: st.Y2,
			Seed: st.Seed,
		}
		if side == Spectator || st.Side == side {
			if len(st.Targets) > 0 {
				sv.Targets = append([]TargetXY{}, st.Targets...)
			}
			if len(st.SubImpacts) > 0 {
				sv.SubImpacts = append([]SubImpact{}, st.SubImpacts...)
			}
		} else if st.Power == "cruiseMissiles" {
			sp, _ := s.R.SuperPowerDef(st.Power)
			for _, sub := range st.SubImpacts {
				if s.cruiseSubVisible(side, sub, sp.Radius) {
					sv.SubImpacts = append(sv.SubImpacts, sub)
				}
			}
			if len(sv.SubImpacts) == 0 {
				continue
			}
		} else if len(st.SubImpacts) > 0 {
			sv.SubImpacts = append([]SubImpact{}, st.SubImpacts...)
		}
		snap.SuperStrikes = append(snap.SuperStrikes, sv)
	}

	for _, c := range s.Craters {
		if side == Spectator || c.seen[side] {
			snap.Craters = append(snap.Craters, c)
		}
	}

	for i := range s.Hazards {
		h := &s.Hazards[i]
		inSight := s.hazardInSight(side, h)
		// Phantom Signal ("spoof") broadcasts false blips onto the enemy's radar even outside
		// visual sight, while ground holograms are drawn only when Visible is true.
		if side != Spectator && h.Side != side && !inSight && h.Kind != "spoof" {
			continue
		}
		hv := *h
		hv.Visible = side == Spectator || h.Side == side || inSight
		if len(h.Decoys) > 0 {
			hv.Decoys = append([]Decoy{}, h.Decoys...)
		}
		snap.Hazards = append(snap.Hazards, hv)
	}
}

func (s *Sim) hashSuperPowers(h hash.Hash64, put func(uint64), f func(float64)) {
	put(uint64(s.superLimit))
	put(uint64(bit(s.superFast)))
	put(uint64(s.superStrikeN))
	put(uint64(s.craterN))
	put(uint64(s.hazardN))
	for side := range s.supers {
		ss := &s.supers[side]
		put(uint64(bit(ss.armed)) | uint64(bit(ss.autoFilled)<<1))
		put(uint64(len(ss.chosen)))
		for i, id := range ss.chosen {
			h.Write([]byte(id))
			put(uint64(int64(ss.readyTick[i])))
			if i < len(ss.totalTicks) {
				put(uint64(int64(ss.totalTicks[i])))
			}
			put(uint64(bit(ss.readyFired[i])))
		}
	}
	put(uint64(len(s.SuperStrikes)))
	for _, st := range s.SuperStrikes {
		put(uint64(st.ID))
		h.Write([]byte(st.Power))
		put(uint64(st.Side))
		put(uint64(st.StartTick))
		put(uint64(st.ImpactTick))
		put(uint64(st.EndTick))
		f(st.X)
		f(st.Y)
		f(st.X2)
		f(st.Y2)
		put(uint64(st.Seed))
		put(uint64(bit(st.Detonated)))
		f(st.hqDealt[0])
		f(st.hqDealt[1])
		for _, t := range st.Targets {
			f(t.X)
			f(t.Y)
		}
		for _, sub := range st.SubImpacts {
			f(sub.X)
			f(sub.Y)
			f(sub.StartX)
			f(sub.StartY)
			put(uint64(sub.LaunchTick))
			put(uint64(sub.ImpactTick))
			put(uint64(bit(sub.Intercepted)) | uint64(bit(sub.Done)<<1))
		}
	}
	put(uint64(len(s.Craters)))
	for _, c := range s.Craters {
		put(uint64(c.ID))
		f(c.X)
		f(c.Y)
		f(c.R)
		put(uint64(c.Tick))
		h.Write([]byte(c.Kind))
		put(uint64(bit(c.seen[0])) | uint64(bit(c.seen[1])<<1))
	}
	put(uint64(len(s.Hazards)))
	for _, hz := range s.Hazards {
		put(uint64(hz.ID))
		h.Write([]byte(hz.Kind))
		put(uint64(hz.Side))
		f(hz.X)
		f(hz.Y)
		f(hz.X2)
		f(hz.Y2)
		f(hz.R)
		put(uint64(hz.StartTick))
		put(uint64(hz.EndTick))
		f(hz.VX)
		f(hz.VY)
		for _, d := range hz.Decoys {
			f(d.X)
			f(d.Y)
			h.Write([]byte(d.Unit))
		}
	}
}
