// Package shared holds the rules data that the server and the client both read.
package shared

import (
	_ "embed"
	"encoding/json"
	"fmt"
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
	Domain        string  `json:"domain"` // land, sea
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
}

type Faction struct {
	Name       Text            `json:"name"`
	StartUnits []string        `json:"startUnits"`
	Units      map[string]Unit `json:"units"`
}

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
		PointSight     float64 `json:"pointSight"` // how far a side sees from a point it holds
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
	Map struct {
		Width  float64 `json:"width"`
		Height float64 `json:"height"`
		WaterY float64 `json:"waterY"` // everything at or below this line is sea
		Points []Point `json:"points"`
	} `json:"map"`
	Rigs      map[string]Rig `json:"rigs"`
	Tiers     []Tier         `json:"tiers"`
	Callsigns struct {
		Player      Text            `json:"player"`
		Operator    Text            `json:"operator"`
		AllStations Text            `json:"allStations"`
		Contact     Text            `json:"contact"` // what an enemy squad in sight is called, before its id
		Classes     map[string]Text `json:"classes"`
	} `json:"callsigns"`
	Factions map[string]Faction `json:"factions"`
	Radio    struct {
		Marker   Text             `json:"marker"`
		Over     Text             `json:"over"`
		Out      Text             `json:"out"`
		SignOff  map[string]Text  `json:"signOff"` // the operator's last word: won, lost, draw
		Prowords map[string]Words `json:"prowords"`
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
	return &r, nil
}

func (r *Rules) check() error {
	if r.TickRate <= 0 {
		return fmt.Errorf("tickRate must be positive")
	}
	hq := map[int]int{}
	seen := map[string]bool{}
	for _, p := range r.Map.Points {
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
		if p.Kind == "seaRig" != (p.Y >= r.Map.WaterY) {
			return fmt.Errorf("point %s: only sea rigs sit in the water", p.ID)
		}
	}
	if hq[0] != 1 || hq[1] != 1 {
		return fmt.Errorf("each side needs exactly one hq point")
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
			if _, ok := r.Callsigns.Classes[u.Class]; !ok {
				return fmt.Errorf("unit %s has unknown class %q", id, u.Class)
			}
			if u.Domain != "land" && u.Domain != "sea" {
				return fmt.Errorf("unit %s has unknown domain %q", id, u.Domain)
			}
			if u.DeploySeconds < 0 {
				return fmt.Errorf("unit %s has a negative deploy time", id)
			}
			if u.Teams <= 0 || u.Members <= 0 || u.HP <= 0 || u.CooldownTicks <= 0 || u.Speed <= 0 {
				return fmt.Errorf("unit %s has a non-positive stat", id)
			}
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

// TierCost is the gold needed to move a squad up to tier, or false if there is no such tier.
func (r *Rules) TierCost(tier int) (int, bool) {
	for _, t := range r.Tiers {
		if t.Tier == tier {
			return t.UpgradeCost, true
		}
	}
	return 0, false
}
