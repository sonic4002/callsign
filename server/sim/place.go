package sim

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// The kinds of place an order can name.
const (
	PlacePoint     = "point"
	PlaceLandmark  = "landmark"
	PlaceBridge    = "bridge"
	PlaceStructure = "structure"
	PlaceOffset    = "offset"
)

// Place is where an order sends a squad: a map point, a landmark, a bridge, a structure,
// or a spot at a bearing and distance from a point.
type Place struct {
	Kind string
	ID   string // the id of the point, landmark, bridge or structure; for an offset, its written form
	X, Y float64

	Point    string // the map point named, for a point or an offset
	landmark int    // index+1 into the landmarks
	bridge   int    // index+1 into the bridges

	Structure *Structure // set for a structure
	Base      string     // "north", "south", "east" or "west" when the place is a side of one's own base
}

// PlaceFinder lets another part of the game add places of its own, such as structures.
// It returns the place for an id it knows, and false otherwise.
type PlaceFinder func(id string) (Place, bool)

var ErrNoPlace = errors.New("no such place on the map")

// bearings are the eight compass directions as a step on the map: x grows east, y south.
var bearings = map[string][2]float64{
	"N": {0, -1}, "NE": {1, -1}, "E": {1, 0}, "SE": {1, 1}, "S": {0, 1}, "SW": {-1, 1}, "W": {-1, 0}, "NW": {-1, -1},
}

// DefaultOffset is how far "north of Foxtrot" is when no distance is given.
const DefaultOffset = 120

// ResolvePlace turns the written form of a place into the place. The written forms are
// a point id ("F"), a landmark id ("F-house-1"), a bridge id ("bridge-west"), an id a
// PlaceFinder knows, and an offset "<bearing> of <point id> [<metres>]" with the bearing
// one of N, NE, E, SE, S, SW, W, NW. Callers with a commander's own words go through the
// radio net first, which knows the names in both languages and writes these forms.
func (s *Sim) ResolvePlace(text string) (Place, error) {
	text = strings.TrimSpace(text)
	if p := s.pointState(strings.ToUpper(text)); p != nil {
		return Place{Kind: PlacePoint, ID: p.ID, X: p.X, Y: p.Y, Point: p.ID}, nil
	}
	low := strings.ToLower(text)
	for i := range s.Landmarks {
		if l := &s.Landmarks[i]; strings.ToLower(l.ID) == low {
			return Place{Kind: PlaceLandmark, ID: l.ID, X: l.X, Y: l.Y, landmark: i + 1}, nil
		}
	}
	for i := range s.Bridges {
		if b := &s.Bridges[i]; strings.ToLower(b.ID) == low {
			x, y := b.mid()
			return Place{Kind: PlaceBridge, ID: b.ID, X: x, Y: y, bridge: i + 1}, nil
		}
	}
	for _, find := range s.Places {
		if p, ok := find(text); ok {
			return p, nil
		}
	}
	// "<bearing> of <point> [<metres>]"
	if f := strings.Fields(text); (len(f) == 3 || len(f) == 4) && strings.EqualFold(f[1], "of") {
		step, ok := bearings[strings.ToUpper(f[0])]
		p := s.pointState(strings.ToUpper(f[2]))
		metres := float64(DefaultOffset)
		if len(f) == 4 {
			v, err := strconv.ParseFloat(f[3], 64)
			ok = ok && err == nil
			metres = v
		}
		if ok && p != nil && metres >= 20 && metres <= 800 {
			n := math.Hypot(step[0], step[1])
			x := math.Max(10, math.Min(s.R.Map.Width-10, p.X+step[0]/n*metres))
			y := math.Max(10, math.Min(s.R.Map.Height-10, p.Y+step[1]/n*metres))
			id := fmt.Sprintf("%s of %s %d", strings.ToUpper(f[0]), p.ID, int(metres))
			return Place{Kind: PlaceOffset, ID: id, X: x, Y: y, Point: p.ID}, nil
		}
	}
	return Place{}, fmt.Errorf("%w: %q", ErrNoPlace, text)
}

// PlaceField is a gold field, written "field-<gusher id>" ("field-K").
const PlaceField = "field"

// fieldPlace is the finder that makes gold fields places.
func (s *Sim) fieldPlace(id string) (Place, bool) {
	if !strings.HasPrefix(strings.ToLower(id), "field-") {
		return Place{}, false
	}
	for i := range s.R.Map.Gushers {
		if g := &s.R.Map.Gushers[i]; strings.EqualFold(g.ID, id[len("field-"):]) {
			return Place{Kind: PlaceField, ID: "field-" + g.ID, X: g.X, Y: g.Y, Point: g.Point}, true
		}
	}
	return Place{}, false
}

// PlaceBase is a side of one's own base, written "base:north" (also south, east, west,
// front, rear). It only means something for the side that asks, so it is not in
// ResolvePlace; resolveFor knows it.
const PlaceBase = "base"

// resolveFor is ResolvePlace as one side may use it: it also knows the sides of that
// side's own base, and it hides a structure the side has never seen.
func (s *Sim) resolveFor(side int, text string) (Place, error) {
	text = strings.TrimSpace(text)
	if strings.HasPrefix(text, "base:") {
		dir := s.baseSide(side, strings.TrimPrefix(text, "base:"))
		if dir == "" {
			return Place{}, fmt.Errorf("%w: %q", ErrNoPlace, text)
		}
		hq := s.R.HQPoint(side)
		return Place{Kind: PlaceBase, ID: "base:" + dir, X: hq.X, Y: hq.Y, Base: dir}, nil
	}
	pl, err := s.ResolvePlace(text)
	if err != nil {
		return pl, err
	}
	if st := pl.Structure; st != nil && st.Side != side && !st.seen[side].Known {
		return Place{}, fmt.Errorf("%w: %q", ErrNoPlace, text)
	}
	return pl, nil
}

// ResolveFor is resolveFor for the room, which checks an agent's place before a command.
func (s *Sim) ResolveFor(side int, text string) (Place, error) { return s.resolveFor(side, text) }

// PlaceID is where an order goes, as orders and reports show it.
func (o *Order) PlaceID() string {
	if o.Place != "" {
		return o.Place
	}
	return o.Point
}
