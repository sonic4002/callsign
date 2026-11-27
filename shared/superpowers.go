package shared

import "fmt"

// Cursor shapes for aiming super powers on the battlefield canvas.
const (
	CursorCircle        = "circle"        // radius + crosshair (+ optional core ring)
	CursorWindCircle    = "windCircle"    // dashed hazard radius + downwind drift arrow
	CursorScatterCircle = "scatterCircle" // outer dispersion ring + probable sub-impacts
	CursorLine          = "line"          // click-and-drag beam path
	CursorStrip         = "strip"         // click-and-drag directional flight corridor
	CursorMulti3        = "multi3"        // 3 sequential precision crosshairs
)

// SuperPower defines one strategic or tactical super weapon in rules.json.
type SuperPower struct {
	ID              string  `json:"id"`
	Name            Text    `json:"name"`
	About           Text    `json:"about"`
	Faction         string  `json:"faction"`         // "aegis", "ashfall" or "any" (flavour badge; all selectable)
	Cursor          string  `json:"cursor"`          // CursorCircle, CursorWindCircle, CursorScatterCircle, CursorLine, CursorStrip, CursorMulti3
	Color           string  `json:"color"`           // primary tactical accent hex colour
	CooldownSeconds int     `json:"cooldownSeconds"` // normal recharge time between uses
	InitialSeconds  int     `json:"initialSeconds"`  // initial charge time after structure finishes (normal mode)
	DelaySeconds    float64 `json:"delaySeconds"`    // telegraph / warning / descent time before main impact
	DurationSeconds float64 `json:"durationSeconds"` // active hazard/storm/sweep/jamming duration (0 for instant)
	Radius          float64 `json:"radius"`          // primary blast/effect radius in map units
	CoreRadius      float64 `json:"coreRadius,omitempty"`
	Length          float64 `json:"length,omitempty"` // beam or carpet strip length
	Width           float64 `json:"width,omitempty"`  // beam or carpet strip width
	Damage          float64 `json:"damage,omitempty"`
	StructureDamage float64 `json:"structureDamage,omitempty"`
	Stress          float64 `json:"stress,omitempty"` // direct nerve impact (0..1)
	CraterRadius    float64 `json:"craterRadius,omitempty"`
	Count           int     `json:"count,omitempty"` // sub-strikes (bolts, drones, shells, missiles)
}

// SuperPowerDef returns the definition of a super power by id, if any.
func (r *Rules) SuperPowerDef(id string) (SuperPower, bool) {
	for _, sp := range r.SuperPowers {
		if sp.ID == id {
			return sp, true
		}
	}
	return SuperPower{}, false
}

func (r *Rules) checkSuperPowers() error {
	seen := map[string]bool{}
	for _, sp := range r.SuperPowers {
		if sp.ID == "" || seen[sp.ID] {
			return fmt.Errorf("superPower %q is empty or defined twice", sp.ID)
		}
		seen[sp.ID] = true
		if sp.Name.En == "" || sp.Name.He == "" || sp.About.En == "" || sp.About.He == "" {
			return fmt.Errorf("superPower %s needs name and about in both languages", sp.ID)
		}
		if sp.CooldownSeconds <= 0 || sp.DelaySeconds < 0 || sp.DurationSeconds < 0 || sp.Radius <= 0 {
			return fmt.Errorf("superPower %s has invalid timing or radius", sp.ID)
		}
		switch sp.Cursor {
		case CursorCircle, CursorWindCircle, CursorScatterCircle, CursorLine, CursorStrip, CursorMulti3:
		default:
			return fmt.Errorf("superPower %s has unknown cursor %q", sp.ID, sp.Cursor)
		}
	}
	return nil
}
