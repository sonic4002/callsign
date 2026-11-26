// Package shared holds the rules data that the server and the client both read.
package shared

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"sort"
	"sync"
)

//go:embed rules.json
var RulesJSON []byte

// Text is one string in both game languages.
type Text struct {
	En string `json:"en"`
	He string `json:"he"`
}

// In returns the text in lang ("he" or anything else for English).
func (t Text) In(lang string) string {
	if lang == "he" {
		return t.He
	}
	return t.En
}

// Words is a list of accepted spellings per language. The first one is canonical.
type Words struct {
	En []string `json:"en"`
	He []string `json:"he"`
}

type Point struct {
	ID       string   `json:"id"`
	Kind     string   `json:"kind"` // hq, landRig, seaRig, point
	Owner    int      `json:"owner"`
	X        float64  `json:"x"`
	Y        float64  `json:"y"`
	Callsign Text     `json:"callsign"`
	Name     Text     `json:"name"`
	Aliases  []string `json:"aliases"`
}

type Rig struct {
	Income    int      `json:"income"` // gold per second
	CaptureBy []string `json:"captureBy"`
}

type Tier struct {
	Tier        int    `json:"tier"`
	Name        Text   `json:"name"`
	UpgradeCost int    `json:"upgradeCost"`
	ModelClass  string `json:"modelClass"`
}

type Unit struct {
	Name          Text    `json:"name"`
	Class         string  `json:"class"`  // infantry, vehicle, naval, air
	Domain        string  `json:"domain"` // land, sea, air (air moves over both)
	Cost          int     `json:"cost"`
	DeploySeconds float64 `json:"deploySeconds"` // from the purchase until the squad stands at the HQ
	Teams         int     `json:"teams"`
	Members       int     `json:"members"`
	HP            float64 `json:"hp"` // per member
	Armor         float64 `json:"armor"`
	Speed         float64 `json:"speed"` // map units per second
	Range         float64 `json:"range"`
	Sight         float64 `json:"sight"`
	Damage        float64 `json:"damage"`
	CooldownTicks int     `json:"cooldownTicks"`
	Accuracy      float64 `json:"accuracy"`
	NerveResist   float64 `json:"nerveResist"` // multiplier on stress gained; lower shakes less
	// MinRange is how close a target may be: an indirect-fire weapon cannot hit inside it.
	MinRange float64 `json:"minRange,omitempty"`
	// Pierce is the share of the target's armor this weapon ignores (0 none, 1 all).
	Pierce float64 `json:"pierce,omitempty"`
	// Vs scales damage by the target's class, or "hq" for a headquarters. A target not
	// listed takes full damage; one at 0 cannot be engaged at all.
	Vs map[string]float64 `json:"vs,omitempty"`
	// A hauler collects gold: how much it carries and how long loading and unloading take.
	Capacity      float64 `json:"capacity,omitempty"`
	LoadSeconds   float64 `json:"loadSeconds,omitempty"`
	UnloadSeconds float64 `json:"unloadSeconds,omitempty"`
	// NoCapture marks a unit that cannot hold ground, whatever its class.
	NoCapture bool `json:"noCapture,omitempty"`
	// Requires is the role of the structure a side must have standing to buy this unit.
	Requires string `json:"requires,omitempty"`
	// Needs are further roles that must stand as well (a hero needs the radar): the
	// structure in Requires is the one that makes the unit, these only allow it.
	Needs []string `json:"needs,omitempty"`
	// Siege marks the unit a faction breaks defences with: the only kind allowed to reach
	// farther than a defence does. SiegeRange, when set, is its reach against structures
	// and fences alone; its reach against units stays Range.
	Siege      bool    `json:"siege,omitempty"`
	SiegeRange float64 `json:"siegeRange,omitempty"`
	// Engineers: how fast they mend, and how long they need beside an enemy structure to
	// take it over. A unit with CaptureSeconds is an engineer.
	RepairPerSecond float64 `json:"repairPerSecond,omitempty"`
	CaptureSeconds  float64 `json:"captureSeconds,omitempty"`

	// Callsign is the callsign class the unit answers to when it is not its Class: a
	// hero is infantry and is called Ghost or Raven. Empty means the class.
	Callsign string `json:"callsign,omitempty"`
	// Hero marks the one exceptional soldier of an army: a squad of one, one alive at a
	// time. StartTier is the brain tier it is fielded with. What it needs beside
	// Requires is in Needs.
	Hero      bool `json:"hero,omitempty"`
	StartTier int  `json:"startTier,omitempty"`
	// Stealth: an enemy sees the unit only from this close, or after it has fired.
	Stealth float64 `json:"stealth,omitempty"`
	// Demolition charges: how many it carries, what one does to a structure or a bridge,
	// how long the fuse burns, and how long planting takes beside the target.
	Charges      int     `json:"charges,omitempty"`
	ChargeDamage float64 `json:"chargeDamage,omitempty"`
	// ChargeVsHQ is the share of a charge's damage a headquarters takes.
	ChargeVsHQ   float64 `json:"chargeVsHQ,omitempty"`
	FuseSeconds  float64 `json:"fuseSeconds,omitempty"`
	PlantSeconds float64 `json:"plantSeconds,omitempty"`
	// Disguise: enemy fireteams do not fire on the unit from farther than this, until it fires.
	Disguise float64 `json:"disguise,omitempty"`
	// Seizing an enemy vehicle squad: how near the unit must come and stay, and how long it takes.
	SeizeRadius  float64 `json:"seizeRadius,omitempty"`
	SeizeSeconds float64 `json:"seizeSeconds,omitempty"`
	// Dread is the stress per second its presence puts on enemy fireteams within DreadRadius.
	Dread       float64 `json:"dread,omitempty"`
	DreadRadius float64 `json:"dreadRadius,omitempty"`
	// Body is the radius of the room one of the unit's teams takes up on the map, when
	// it is not its class's (Match.Body).
	Body float64 `json:"body,omitempty"`
	// Crushes marks a heavy vehicle that kills infantry it drives through in the open.
	Crushes bool `json:"crushes,omitempty"`
	// A strike aircraft (server/sim/sortie.go): Bombs is what each plane carries on a
	// sortie, 0 for every other unit. Damage is what one bomb does at the middle of its
	// blast, BlastRadius how far the blast reaches, and RearmSeconds how long the squad
	// stands at its airbase after a strike before it can fly again.
	// Evade is the share of the shots squads fire at it in flight that its speed makes
	// miss; defences are not fooled.
	Bombs        int     `json:"bombs,omitempty"`
	BlastRadius  float64 `json:"blastRadius,omitempty"`
	RearmSeconds float64 `json:"rearmSeconds,omitempty"`
	Evade        float64 `json:"evade,omitempty"`
}

// Strike reports whether squads of this unit are strike aircraft: they fly sorties from
// an airbase and hold no ground.
func (u *Unit) Strike() bool { return u.Bombs > 0 }

// CallClass is the callsign class a squad of this unit answers to.
func (u *Unit) CallClass() string {
	if u.Callsign != "" {
		return u.Callsign
	}
	return u.Class
}

// Rank is a standing a squad earns by what it destroys: Kills is the worth of its kills in
// multiples of its own cost. Accuracy multiplies its chance to hit, Nerve the stress it
// takes, and HealPerSecond is the share of a member's health its teams regain out of combat.
type Rank struct {
	ID            string  `json:"id"`
	Name          Text    `json:"name"`
	Kills         float64 `json:"kills"`
	Accuracy      float64 `json:"accuracy"`
	Nerve         float64 `json:"nerve"`
	HealPerSecond float64 `json:"healPerSecond"`
}

// Engineer reports whether squads of this unit can take over structures.
func (u Unit) Engineer() bool { return u.CaptureSeconds > 0 }

// Against is the damage multiplier of this unit's weapon on a target class, or on "hq".
func (u *Unit) Against(class string) float64 {
	if v, ok := u.Vs[class]; ok {
		return v
	}
	return 1
}

// HaulerClass is the class of the unarmed vehicles that collect gold. They have no leader
// agent and no radio callsign, and do not count toward the squad population cap.
const HaulerClass = "hauler"

// Gusher is a gold source. It throws gold up into the field around it at a steady rate,
// up to the field's cap; haulers collect it from the field.
type Gusher struct {
	ID            string  `json:"id"`
	Point         string  `json:"point"` // the map point it is named after on the radio
	X             float64 `json:"x"`
	Y             float64 `json:"y"`
	RatePerSecond float64 `json:"ratePerSecond"`
	FieldRadius   float64 `json:"fieldRadius"`
	FieldCap      float64 `json:"fieldCap"`
	StartGold     float64 `json:"startGold"` // gold lying in the field when the match starts
}

type Faction struct {
	Name       Text                 `json:"name"`
	StartUnits []string             `json:"startUnits"`
	Units      map[string]Unit      `json:"units"`
	Structures map[string]Structure `json:"structures"`
}

// TerrainKind is one letter of a map's terrain grid.
type TerrainKind struct {
	Name    string  `json:"name"`
	Ground  bool    `json:"ground,omitempty"`  // land units walk on it
	Water   bool    `json:"water,omitempty"`   // boats sail on it
	Speed   float64 `json:"speed"`             // multiplier on the speed of whoever crosses it
	NoCover bool    `json:"noCover,omitempty"` // nothing standing on it is in cover
}

// LandmarkKind is what a kind of landmark does for the troops at it.
type LandmarkKind struct {
	Word          Text    `json:"word"`
	Cover         float64 `json:"cover"`                   // multiplier on hits taken from behind it
	CoverRadius   float64 `json:"coverRadius"`             // how close a fireteam must stand
	Garrison      int     `json:"garrison,omitempty"`      // fireteams it holds inside; 0 for none
	GarrisonCover float64 `json:"garrisonCover,omitempty"` // multiplier on hits taken inside, from any side
	HP            float64 `json:"hp,omitempty"`            // of a building; at zero it falls
	Size          float64 `json:"size,omitempty"`          // side of the ground it blocks, for buildings
	// Arc is the width in degrees of the front a position built to face one way covers
	// (sandbags); 0 for landmarks that cover by standing between shooter and target.
	Arc float64 `json:"arc,omitempty"`
}

// Landmark is something on the map that belongs to no side.
type Landmark struct {
	ID      string  `json:"id"`
	Kind    string  `json:"kind"`
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
	Near    string  `json:"near"`    // the nearest map point
	Bearing string  `json:"bearing"` // from that point: N, NE, E, SE, S, SW, W, NW
	Name    Text    `json:"name"`
}

// Bridge spans water between two banks. Standing, it is ground.
type Bridge struct {
	ID    string     `json:"id"`
	Name  Text       `json:"name"`
	From  [2]float64 `json:"from"`
	To    [2]float64 `json:"to"`
	Width float64    `json:"width"`
	HP    float64    `json:"hp"`
}

// Map is one battlefield. Terrain is a grid of Cell-sized squares, one letter each, row
// by row from the north; the letters are the keys of Rules.TerrainKinds.
type Map struct {
	ID     string  `json:"id"`
	Name   Text    `json:"name"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
	Cell   float64 `json:"cell"`
	// LengthSeconds is how long a match on this map lasts when nobody chose a length: a
	// bigger map takes longer to cross. 0 uses the match default.
	LengthSeconds int `json:"lengthSeconds,omitempty"`
	// Pace multiplies how fast everything moves on this map, so that a bigger map does
	// not turn a match into a long walk. 0 means 1.
	Pace      float64    `json:"pace,omitempty"`
	Terrain   []string   `json:"terrain"`
	Points    []Point    `json:"points"`
	Gushers   []Gusher   `json:"gushers"`
	Bridges   []Bridge   `json:"bridges"`
	Landmarks []Landmark `json:"landmarks"`
	// TechBuildings are the buildings of no army on this map, mirrored west and east.
	TechBuildings []TechSite `json:"techBuildings"`
}

// TerrainAt is the terrain letter at a position; off the map counts as mountain.
func (m *Map) TerrainAt(x, y float64) byte {
	if x < 0 || y < 0 || x >= m.Width || y >= m.Height {
		return 'M'
	}
	return m.Terrain[int(y/m.Cell)][int(x/m.Cell)]
}

// DefaultMap is the map a match is played on when nobody chose one.
const DefaultMap = "small"

type Rules struct {
	Version  int `json:"version"`
	TickRate int `json:"tickRate"`
	Match    struct {
		LengthSeconds  int     `json:"lengthSeconds"`
		StartGold      int     `json:"startGold"`
		PopulationCap  int     `json:"populationCap"`
		CaptureSeconds float64 `json:"captureSeconds"`
		CaptureRadius  float64 `json:"captureRadius"`
		HoldRadius     float64 `json:"holdRadius"`
		PointSight     float64 `json:"pointSight"`    // how far a side sees from a point it holds
		HQTrickle      int     `json:"hqTrickle"`     // gold per second every headquarters makes on its own
		HaulerCap      int     `json:"haulerCap"`     // haulers a side may have, apart from the squad cap
		RevealSeconds  float64 `json:"revealSeconds"` // how long firing gives a team away to the enemy
		// Bases (structures.go): the roles every side starts with besides its headquarters,
		// how far from its own ground a side may place a defence or a fence, and how many.
		StartStructures []string `json:"startStructures"`
		BuildRadius     float64  `json:"buildRadius"`
		DefenceCap      int      `json:"defenceCap"`
		FenceRuns       int      `json:"fenceRuns"`
		// Placing base structures (placement.go): how far from its headquarters a side may
		// put one (BaseRadius), how far from another finished base structure of its own
		// (BaseReach), and how many it may have (BaseCap). BuildRadius above is the same
		// for defences and fences, which may also go up beside a point the side holds.
		BaseRadius float64 `json:"baseRadius"`
		BaseReach  float64 `json:"baseReach"`
		BaseCap    int     `json:"baseCap"`
		// QueueLimit is how many units may wait in line at one structure (queue.go).
		QueueLimit int `json:"queueLimit"`
		// Power (sim/power.go): how many power structures a side may have, and how fast a
		// side on low power builds and deploys, as a share of the usual speed.
		PowerStructures int     `json:"powerStructures"`
		LowPowerFactor  float64 `json:"lowPowerFactor"`
		// Selling a structure gives back SellShare of its cost. Repairing one from nothing
		// would cost RepairCostShare of its cost, and mends RepairPerSecond of it a second.
		SellShare       float64 `json:"sellShare"`
		RepairCostShare float64 `json:"repairCostShare"`
		RepairPerSecond float64 `json:"repairPerSecond"`
		// Opening is the order a base usually grows in, by role: what the scripted player
		// and an operator with the purse build next.
		Opening []string `json:"opening"`
		// Sandbags: how long a squad digs, and how many positions one squad may build.
		FortifySeconds float64 `json:"fortifySeconds"`
		SandbagLimit   int     `json:"sandbagLimit"`
		// Crushing: how near a heavy vehicle's path must pass, and the least time between
		// two men of one fireteam going under.
		CrushRadius  float64 `json:"crushRadius"`
		CrushSeconds float64 `json:"crushSeconds"`
		// Body is the room a fireteam, a vehicle, a boat or an aircraft takes up on the
		// map, as a radius per unit class (a unit's own `body` wins): two bodies never
		// stand closer than their radii added. BodyStandoff is how much farther apart
		// than that two enemy bodies on the ground or on the water are kept, so that
		// nobody squeezes past an enemy: one fireteam standing on a bridge holds it.
		Body         map[string]float64 `json:"body"`
		BodyStandoff float64            `json:"bodyStandoff"`
		// GarrisonSight is how close an enemy must be to see a fireteam inside a building.
		GarrisonSight float64 `json:"garrisonSight"`
		// GarrisonDamageShare is the share of the damage aimed at a garrison that the building takes too.
		GarrisonDamageShare float64 `json:"garrisonDamageShare"`
		// CoverSeek is how far from its post a holding fireteam will go for cover.
		CoverSeek float64 `json:"coverSeek"`
	} `json:"match"`
	HQ struct {
		HP    float64 `json:"hp"`
		Sight float64 `json:"sight"`
	} `json:"hq"`
	Nerve struct {
		ShakenAt          float64 `json:"shakenAt"`
		PinnedAt          float64 `json:"pinnedAt"`
		PerMiss           float64 `json:"perMiss"`
		PerHit            float64 `json:"perHit"`
		PerMemberLost     float64 `json:"perMemberLost"`
		PerTeamLost       float64 `json:"perTeamLost"`
		RecoverPerSecond  float64 `json:"recoverPerSecond"`
		RecoverNearSteady float64 `json:"recoverNearSteady"`
		ReliefOnKill      float64 `json:"reliefOnKill"`
		QuietSeconds      float64 `json:"quietSeconds"`
	} `json:"nerve"`
	TerrainKinds  map[string]TerrainKind  `json:"terrainKinds"`
	LandmarkKinds map[string]LandmarkKind `json:"landmarkKinds"`
	BridgeRules   struct {
		DangerShare  float64 `json:"dangerShare"`  // below this share of its hit points troops will not start across unless ordered to move
		StandShare   float64 `json:"standShare"`   // a fallen bridge stands again once repaired to this share
		RepairRadius float64 `json:"repairRadius"` // how close to an end a repairing fireteam must stand
		WarnSeconds  float64 `json:"warnSeconds"`  // least time between two warnings about one bridge
	} `json:"bridgeRules"`
	// Maps are the battlefields on offer. Map is the one this copy of the rules plays on:
	// the default after loading, the room's choice after ForMap.
	Maps      map[string]*Map `json:"maps"`
	Map       Map             `json:"map"`
	Rigs      map[string]Rig  `json:"rigs"`
	Tiers     []Tier          `json:"tiers"`
	Ranks     []Rank          `json:"ranks"` // earned standings, lowest first
	Callsigns struct {
		Player      Text            `json:"player"`
		Operator    Text            `json:"operator"`
		AllStations Text            `json:"allStations"`
		Contact     Text            `json:"contact"` // what an enemy squad in sight is called, before its id
		Hauler      Text            `json:"hauler"`  // what a hauler is called, before its number; not a radio station
		Classes     map[string]Text `json:"classes"`
	} `json:"callsigns"`
	Factions map[string]Faction `json:"factions"`
	// TechBuildings are the kinds of building that belong to no army (see RoleTech).
	TechBuildings map[string]Structure `json:"techBuildings"`
	Radio         struct {
		Marker  Text            `json:"marker"`
		Over    Text            `json:"over"`
		Out     Text            `json:"out"`
		SignOff map[string]Text `json:"signOff"` // the operator's last word: won, lost, draw
		// What Hammer says to hand the operator the fight ("give") or to take it back
		// ("take"), and how the net announces a purchase the operator made on its own.
		Command     map[string]Words `json:"command"`
		OwnPurchase map[string]Text  `json:"ownPurchase"`
		// Cues are the fixed lines the operator says about the base by itself (see
		// server/room/cues.go): the words in both languages, the least seconds between
		// two of a kind, and the events raised elsewhere that call for it.
		Cues map[string]Cue `json:"cues"`
		// Traffic is how the net keeps itself quiet (server/room/traffic.go): for how many
		// seconds a second squad's report of the same thing is dropped, for how long after
		// its event a squad's line counts as the report of it, for how long after Hammer's
		// call a station's line counts as the answer, and the least "radio traffic" level
		// of the commander's page (1 quiet, 2 normal, 3 full) at which each kind of line
		// is shown and spoken.
		Traffic struct {
			ReportWindow  float64        `json:"reportWindow"`
			EventSeconds  float64        `json:"eventSeconds"`
			AnswerSeconds float64        `json:"answerSeconds"`
			Levels        map[string]int `json:"levels"`
		} `json:"traffic"`
		// Brain is everything the rule brain says on the net (agents/brain-rule.mjs): each
		// line in both languages, with as many wordings in one as in the other, so that
		// squads do not all sound alike. {name} is filled in; {b_name}, {l_name} and
		// {m_name} put the Hebrew letter in front of it.
		Brain map[string]Words `json:"brain"`
		// SpelledOut lists, per English point callsign, how it gets written in Hebrew
		// letters by mistake ("דלתא" for Delta); the net puts the Hebrew callsign instead.
		SpelledOut map[string][]string `json:"spelledOut"`
		Prowords   map[string]Words    `json:"prowords"`
	} `json:"radio"`
}

// Load parses and checks the embedded rules.
func Load() (*Rules, error) { return Parse(RulesJSON) }

// MustLoad is Load for program start and tests.
func MustLoad() *Rules {
	r, err := Load()
	if err != nil {
		panic(err)
	}
	return r
}

func Parse(data []byte) (*Rules, error) {
	var r Rules
	if err := json.Unmarshal(data, &r); err != nil {
		return nil, fmt.Errorf("rules: %w", err)
	}
	if err := r.check(); err != nil {
		return nil, fmt.Errorf("rules: %w", err)
	}
	r.Map = *r.Maps[DefaultMap]
	return &r, nil
}

// ForMap returns these rules set to play on one of the maps. The copy shares everything
// but the choice of map with the original.
func (r *Rules) ForMap(id string) (*Rules, error) {
	if id == "" {
		id = DefaultMap
	}
	m, ok := r.Maps[id]
	if !ok {
		return nil, fmt.Errorf("no such map %q", id)
	}
	c := *r
	c.Map = *m
	return &c, nil
}

// MapIDs lists the maps, smallest first.
func (r *Rules) MapIDs() []string {
	ids := make([]string, 0, len(r.Maps))
	for id := range r.Maps {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool {
		a, b := r.Maps[ids[i]], r.Maps[ids[j]]
		if a.Width*a.Height != b.Width*b.Height {
			return a.Width*a.Height < b.Width*b.Height
		}
		return ids[i] < ids[j]
	})
	return ids
}

var jsonFor sync.Map // map id → the rules file with "map" set to that map

// JSONFor is the rules file as clients read it: the embedded file plus "map", the map
// being played. Clients never have to look a map up by id.
func JSONFor(id string) ([]byte, error) {
	if id == "" {
		id = DefaultMap
	}
	if b, ok := jsonFor.Load(id); ok {
		return b.([]byte), nil
	}
	var all map[string]json.RawMessage
	if err := json.Unmarshal(RulesJSON, &all); err != nil {
		return nil, err
	}
	var maps map[string]json.RawMessage
	if err := json.Unmarshal(all["maps"], &maps); err != nil {
		return nil, err
	}
	raw, ok := maps[id]
	if !ok {
		return nil, fmt.Errorf("no such map %q", id)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	m["id"], _ = json.Marshal(id)
	all["map"], _ = json.Marshal(m)
	b, err := json.Marshal(all)
	if err != nil {
		return nil, err
	}
	jsonFor.Store(id, b)
	return b, nil
}

// Cue is one fixed line of the operator's. {structure}, {squad}, {unit} and {point} in a
// line are filled in with names in the language it is said in.
// TrafficKinds are the kinds a transmission can be, each with a level in radio.traffic.
var TrafficKinds = []string{"order", "answer", "ask", "cue", "loss", "contact", "objective", "notice", "status", "ack"}

type Cue struct {
	Line   Text     `json:"line"`
	Gap    float64  `json:"gap"`              // seconds before the same cue may be said again
	Events []string `json:"events,omitempty"` // event kinds, by name, that call for it
	Level  int      `json:"level,omitempty"`  // the least radio traffic level that shows it; 0 is 1, always
}

// BodyOf is the radius of the room one team of a unit takes up on the map.
func (r *Rules) BodyOf(u *Unit) float64 {
	if u.Body > 0 {
		return u.Body
	}
	return r.Match.Body[u.Class]
}

func (r *Rules) check() error {
	if r.TickRate <= 0 {
		return fmt.Errorf("tickRate must be positive")
	}
	if r.Match.BodyStandoff < 0 {
		return fmt.Errorf("bodyStandoff must not be negative")
	}
	if _, ok := r.Maps[DefaultMap]; !ok {
		return fmt.Errorf("maps need a %q map", DefaultMap)
	}
	for id, m := range r.Maps {
		m.ID = id
		if err := r.checkMap(m); err != nil {
			return fmt.Errorf("map %s: %w", id, err)
		}
	}
	if err := r.checkTech(); err != nil {
		return err
	}
	for name, cue := range r.Radio.Cues {
		if cue.Line.En == "" || cue.Line.He == "" || cue.Gap < 0 {
			return fmt.Errorf("cue %s needs a line in both languages and a gap", name)
		}
	}
	tr := r.Radio.Traffic
	if tr.ReportWindow <= 0 || tr.EventSeconds <= 0 || tr.AnswerSeconds <= 0 {
		return fmt.Errorf("radio.traffic needs a report window, event seconds and answer seconds")
	}
	for _, kind := range TrafficKinds {
		if l := tr.Levels[kind]; l < 1 || l > 3 {
			return fmt.Errorf("radio.traffic.levels needs a level from 1 to 3 for %q", kind)
		}
	}
	for name, cue := range r.Radio.Cues {
		if cue.Level < 0 || cue.Level > 3 {
			return fmt.Errorf("cue %s has a level outside 1 to 3", name)
		}
	}
	for name, w := range r.Radio.Brain {
		if len(w.En) == 0 || len(w.En) != len(w.He) {
			return fmt.Errorf("brain line %s needs the same number of wordings in both languages", name)
		}
	}
	if len(r.Tiers) == 0 || r.Tiers[0].Tier != 1 {
		return fmt.Errorf("tiers must start at tier 1")
	}
	for name, f := range r.Factions {
		if len(f.Units) == 0 {
			return fmt.Errorf("faction %s has no units", name)
		}
		for _, u := range f.StartUnits {
			if _, ok := f.Units[u]; !ok {
				return fmt.Errorf("faction %s starts with unknown unit %q", name, u)
			}
		}
		for id, u := range f.Units {
			if _, ok := r.Callsigns.Classes[u.Class]; !ok && u.Class != HaulerClass {
				return fmt.Errorf("unit %s has unknown class %q", id, u.Class)
			}
			if _, ok := r.Callsigns.Classes[u.CallClass()]; !ok && u.Class != HaulerClass {
				return fmt.Errorf("unit %s has unknown callsign %q", id, u.Callsign)
			}
			if u.Hero && (u.Teams != 1 || u.Members != 1) {
				return fmt.Errorf("hero %s must be a squad of one", id)
			}
			if u.Class == HaulerClass && (u.Capacity <= 0 || u.LoadSeconds <= 0 || u.UnloadSeconds <= 0 || u.Teams != 1 || u.Members != 1) {
				return fmt.Errorf("hauler %s needs a capacity, load and unload times, and one vehicle", id)
			}
			if u.Domain != "land" && u.Domain != "sea" && u.Domain != "air" {
				return fmt.Errorf("unit %s has unknown domain %q", id, u.Domain)
			}
			if u.DeploySeconds < 0 {
				return fmt.Errorf("unit %s has a negative deploy time", id)
			}
			if u.Bombs < 0 || (u.Strike() && (u.Domain != "air" || u.Requires == "" || !u.NoCapture || u.BlastRadius <= 0 || u.RearmSeconds <= 0 || u.Against("air") != 0)) || u.Evade < 0 || u.Evade >= 1 {
				return fmt.Errorf("strike aircraft %s must fly, come from a structure, hold no ground, hit nothing in the air, and have a blast radius and a rearm time", id)
			}
			if u.MinRange < 0 || u.MinRange >= u.Range || u.Pierce < 0 || u.Pierce > 1 {
				return fmt.Errorf("unit %s has a bad minRange or pierce", id)
			}
			for class, v := range u.Vs {
				if _, ok := r.Callsigns.Classes[class]; (!ok && class != "hq" && class != TargetStructure && class != TargetFence && class != HaulerClass) || v < 0 {
					return fmt.Errorf("unit %s: bad vs entry %q", id, class)
				}
			}
			if u.Teams <= 0 || u.Members <= 0 || u.HP <= 0 || u.CooldownTicks <= 0 || u.Speed <= 0 {
				return fmt.Errorf("unit %s has a non-positive stat", id)
			}
			if r.BodyOf(&u) <= 0 || u.Body < 0 {
				return fmt.Errorf("unit %s takes up no room: its class %q needs a body radius", id, u.Class)
			}
		}
		if err := r.checkStructures(name, &f); err != nil {
			return err
		}
	}
	return nil
}

func (r *Rules) checkMap(m *Map) error {
	if m.Cell <= 0 || m.Width <= 0 || m.Height <= 0 {
		return fmt.Errorf("needs a size and a cell")
	}
	cols, rows := int(m.Width/m.Cell), int(m.Height/m.Cell)
	if float64(cols)*m.Cell != m.Width || float64(rows)*m.Cell != m.Height || len(m.Terrain) != rows {
		return fmt.Errorf("terrain must be %d rows of %d cells", rows, cols)
	}
	for i, row := range m.Terrain {
		if len(row) != cols {
			return fmt.Errorf("terrain row %d has %d cells, want %d", i, len(row), cols)
		}
		for _, k := range row {
			if _, ok := r.TerrainKinds[string(k)]; !ok {
				return fmt.Errorf("terrain row %d: unknown kind %q", i, k)
			}
		}
	}
	hq := map[int]int{}
	seen := map[string]bool{}
	for _, p := range m.Points {
		if seen[p.ID] {
			return fmt.Errorf("point %s defined twice", p.ID)
		}
		seen[p.ID] = true
		if _, ok := r.Rigs[p.Kind]; !ok {
			return fmt.Errorf("point %s has unknown kind %q", p.ID, p.Kind)
		}
		if p.Callsign.En == "" || p.Callsign.He == "" || p.Name.En == "" || p.Name.He == "" {
			return fmt.Errorf("point %s needs a callsign and a name in both languages", p.ID)
		}
		if p.Kind == "hq" {
			if p.Owner != 0 && p.Owner != 1 {
				return fmt.Errorf("hq %s needs owner 0 or 1", p.ID)
			}
			hq[p.Owner]++
		}
		if k := r.TerrainKinds[string(m.TerrainAt(p.X, p.Y))]; (p.Kind == "seaRig") != k.Water || (p.Kind != "seaRig" && !k.Ground) {
			return fmt.Errorf("point %s: sea rigs sit in the water and everything else on the ground", p.ID)
		}
	}
	if hq[0] != 1 || hq[1] != 1 {
		return fmt.Errorf("each side needs exactly one hq point")
	}
	for _, l := range m.Landmarks {
		if seen[l.ID] {
			return fmt.Errorf("landmark %s defined twice", l.ID)
		}
		seen[l.ID] = true
		if _, ok := r.LandmarkKinds[l.Kind]; !ok {
			return fmt.Errorf("landmark %s has unknown kind %q", l.ID, l.Kind)
		}
		if l.Name.En == "" || l.Name.He == "" {
			return fmt.Errorf("landmark %s needs a name in both languages", l.ID)
		}
	}
	for _, b := range m.Bridges {
		if seen[b.ID] {
			return fmt.Errorf("bridge %s defined twice", b.ID)
		}
		seen[b.ID] = true
		if b.HP <= 0 || b.Width <= 0 || b.From == b.To || b.Name.En == "" || b.Name.He == "" {
			return fmt.Errorf("bridge %s needs hit points, a width, two ends and a name", b.ID)
		}
	}
	gushers := map[string]bool{}
	for _, g := range m.Gushers {
		named := false
		for _, p := range m.Points {
			named = named || p.ID == g.Point
		}
		if gushers[g.ID] || !named {
			return fmt.Errorf("gusher %s is defined twice or names no map point", g.ID)
		}
		gushers[g.ID] = true
		if g.RatePerSecond < 0 || g.FieldRadius <= 0 || g.FieldCap <= 0 || g.StartGold < 0 || g.StartGold > g.FieldCap || m.TerrainAt(g.X, g.Y) != 'L' {
			return fmt.Errorf("gusher %s has a bad rate, field or place", g.ID)
		}
	}
	return nil
}

// PointByID returns the map point with that id, or nil.
func (r *Rules) PointByID(id string) *Point {
	for i := range r.Map.Points {
		if r.Map.Points[i].ID == id {
			return &r.Map.Points[i]
		}
	}
	return nil
}

// HQPoint returns the headquarters point of a side.
func (r *Rules) HQPoint(side int) *Point {
	for i := range r.Map.Points {
		if p := &r.Map.Points[i]; p.Kind == "hq" && p.Owner == side {
			return p
		}
	}
	return nil
}

// HaulerOf returns the id and stats of a faction's hauler, or "" when it has none. Unit ids
// are tried in order, so the answer never depends on map order.
func (r *Rules) HaulerOf(faction string) (string, Unit) {
	units := r.Factions[faction].Units
	ids := make([]string, 0, len(units))
	for id := range units {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		if units[id].Class == HaulerClass {
			return id, units[id]
		}
	}
	return "", Unit{}
}

// GusherByID returns the gusher with that id, or nil.
func (r *Rules) GusherByID(id string) *Gusher {
	for i := range r.Map.Gushers {
		if r.Map.Gushers[i].ID == id {
			return &r.Map.Gushers[i]
		}
	}
	return nil
}

// TierCost is the gold needed to move a squad up to tier, or false if there is no such tier.
func (r *Rules) TierCost(tier int) (int, bool) {
	for _, t := range r.Tiers {
		if t.Tier == tier {
			return t.UpgradeCost, true
		}
	}
	return 0, false
}
