package radio

import (
	"math"
	"regexp"
	"sort"
	"strings"
	"unicode"
)

// kindWords are the words a commander uses for each kind of landmark, in both languages.
// "bridge" is not a landmark kind in the rules, but bridges are named the same way.
var kindWords = map[string][]string{
	"house":  {"house", "building", "בית", "בניין"},
	"bunker": {"bunker", "בונקר"},
	"ruin":   {"ruin", "ruins", "חורבה", "חורבות"},
	"grove":  {"grove", "trees", "tree", "wood", "woods", "חורשה", "עצים", "עץ"},
	"rocks":  {"rocks", "rock", "boulders", "סלעים", "סלע"},
	"wall":   {"wall", "חומה", "קיר"},
	"bridge": {"bridge", "גשר"},
}

// bearingWords are the compass words. Two in a row ("north east", "צפון-מזרח") make the
// direction between them.
var bearingWords = map[string]string{
	"north": "N", "צפון": "N", "צפונית": "N", "south": "S", "דרום": "S", "דרומית": "S",
	"east": "E", "מזרח": "E", "מזרחית": "E", "west": "W", "מערב": "W", "מערבית": "W",
	"northeast": "NE", "northwest": "NW", "southeast": "SE", "southwest": "SW",
	"צפונה": "N", "דרומה": "S", "מזרחה": "E", "מערבה": "W",
}

type namedPlace struct {
	id      string
	kind    string
	near    string // nearest map point
	bearing string
	names   []string // lower case, both languages, longest first
}

// initPlaces indexes the landmarks and bridges of the map by what they are called.
func (n *Net) initPlaces() {
	m := &n.r.Map
	add := func(id, kind, near, bearing string, en, he string) {
		en = lower(en)
		names := []string{en, lower(he)}
		if rest, ok := strings.CutPrefix(en, "the "); ok {
			names = append(names, rest)
		}
		sort.SliceStable(names, func(i, j int) bool { return len(names[i]) > len(names[j]) })
		n.named = append(n.named, namedPlace{id, kind, near, bearing, names})
	}
	for _, l := range m.Landmarks {
		add(l.ID, l.Kind, l.Near, l.Bearing, l.Name.En, l.Name.He)
	}
	for _, b := range m.Bridges {
		// A bridge belongs to the map point nearest its middle, and lies at a bearing from it.
		mx, my := (b.From[0]+b.To[0])/2, (b.From[1]+b.To[1])/2
		near, bd := "", math.MaxFloat64
		var px, py float64
		for _, p := range m.Points {
			if d := math.Hypot(p.X-mx, p.Y-my); d < bd {
				near, bd, px, py = p.ID, d, p.X, p.Y
			}
		}
		add(b.ID, "bridge", near, bearingOf(mx-px, my-py), b.Name.En, b.Name.He)
	}
}

var compass = []string{"N", "NE", "E", "SE", "S", "SW", "W", "NW"}

func bearingOf(dx, dy float64) string {
	i := int(math.Round(math.Atan2(dx, -dy)/(math.Pi/4))) % 8
	return compass[(i+8)%8]
}

// words splits lower-case text into its words. Hyphens split too, so "north-east" and
// "צפון-מזרח" come out as two.
func words(low string) []string {
	return strings.FieldsFunc(low, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
}

// stems are the forms a word may stand for: itself, and for Hebrew the word with its
// glued-on one-letter prefixes taken off ("בחורשה" → "חורשה", "שליד" → "ליד").
func stems(w string) []string {
	out := []string{w}
	for k := 0; k < 2; k++ {
		r, size := []rune(w), 0
		if len(r) < 3 || !unicode.Is(unicode.Hebrew, r[0]) || !strings.ContainsRune(hebrewPrefixes, r[0]) {
			break
		}
		size = len(string(r[0]))
		w = w[size:]
		out = append(out, w)
	}
	return out
}

// bearingIn finds the compass direction a text gives, "" for none.
func bearingIn(ws []string) string {
	of := func(w string) string {
		for _, s := range stems(w) {
			if b, ok := bearingWords[s]; ok {
				return b
			}
		}
		return ""
	}
	for i, w := range ws {
		b := of(w)
		if b == "" {
			continue
		}
		if len(b) == 1 && i+1 < len(ws) {
			if c := of(ws[i+1]); len(c) == 1 && (b == "N" || b == "S") && (c == "E" || c == "W") {
				return b + c
			}
		}
		return b
	}
	return ""
}

// FindLandmarks returns the ids of the landmarks and bridges a text clearly names: by
// their own name, or by a kind word beside the name of a map point ("the grove north of
// Foxtrot", "הבית שליד פסל"). When the words fit more than one, all of them come back,
// and whoever reads the message asks which.
func (n *Net) FindLandmarks(text string) []string {
	low := lower(text)
	var ids []string
	add := func(id string) {
		for _, have := range ids {
			if have == id {
				return
			}
		}
		ids = append(ids, id)
	}
	for _, p := range n.named {
		for _, name := range p.names {
			if i := strings.Index(low, name); i >= 0 && boundaryBefore(low[:i]) && boundary(low[i+len(name):]) {
				add(p.id)
				low = low[:i] + strings.Repeat(" ", len(name)) + low[i+len(name):]
				break
			}
		}
	}
	points, rest := n.findPoints(low)
	if len(points) == 0 {
		return ids
	}
	ws := words(rest)
	bearing := bearingIn(ws)
	for _, kind := range sortedKeys(kindWords) {
		said := false
		for _, w := range ws {
			for _, s := range stems(w) {
				for _, k := range kindWords[kind] {
					said = said || s == k
				}
			}
		}
		if !said {
			continue
		}
		for _, point := range points {
			var fit, exact []string
			for _, p := range n.named {
				if p.kind == kind && p.near == point {
					fit = append(fit, p.id)
					if p.bearing == bearing {
						exact = append(exact, p.id)
					}
				}
			}
			if len(exact) > 0 {
				fit = exact
			}
			for _, id := range fit {
				add(id)
			}
		}
	}
	return ids
}

var offsetForm = regexp.MustCompile(`(?i)^(n|ne|e|se|s|sw|w|nw) of ([a-z])( \d+)?$`)
var number = regexp.MustCompile(`\d+`)

// ResolvePlace turns what an agent or a commander wrote for a place into the form the
// simulation reads: a point id, a landmark or bridge id, or "<bearing> of <point>
// [<metres>]". When the words fit several landmarks it returns them as choices and ok
// false, so the caller can ask which.
func (n *Net) ResolvePlace(text string) (place string, choices []string, ok bool) {
	text = strings.TrimSpace(text)
	if text == "" {
		return "", nil, false
	}
	if p := n.r.PointByID(strings.ToUpper(text)); p != nil {
		return p.ID, nil, true
	}
	for _, p := range n.named {
		if strings.EqualFold(p.id, text) {
			return p.id, nil, true
		}
	}
	if m := offsetForm.FindStringSubmatch(text); m != nil && n.r.PointByID(strings.ToUpper(m[2])) != nil {
		return strings.ToUpper(m[1]) + " of " + strings.ToUpper(m[2]) + m[3], nil, true
	}
	switch found := n.FindLandmarks(text); {
	case len(found) == 1:
		return found[0], nil, true
	case len(found) > 1:
		return "", found, false
	}
	points, rest := n.findPoints(lower(text))
	if len(points) != 1 {
		return "", nil, false
	}
	// "140 metres north and 60 east of Alpha": an exact spot, a distance each way.
	if spot, ok := spotIn(words(rest)); ok {
		return spot + " of " + points[0], nil, true
	}
	if b := bearingIn(words(rest)); b != "" {
		place = b + " of " + points[0]
		if d := number.FindString(rest); d != "" {
			place += " " + d
		}
		return place, nil, true
	}
	return points[0], nil, true
}

// PlaceName is what a landmark or bridge is called in a language, or its id when the
// net does not know it.
func (n *Net) PlaceName(id, lang string) string {
	for _, l := range n.r.Map.Landmarks {
		if l.ID == id {
			return l.Name.In(lang)
		}
	}
	for _, b := range n.r.Map.Bridges {
		if b.ID == id {
			return b.Name.In(lang)
		}
	}
	return id
}

// spotIn reads an exact spot from the words around a point's name: two distances, one
// north or south and one east or west, each beside its direction ("140 metres north and
// 60 east", "צפונית 140 ומזרחית 60"). It writes them the way the simulation reads them,
// "N140 E60". Anything else is not a spot: one direction, or two in a row with one
// distance ("140 metres north-east"), stays a bearing.
func spotIn(ws []string) (string, bool) {
	type item struct {
		bearing string
		n       string
	}
	var seq []item
	for _, w := range ws {
		if number.MatchString(w) && number.FindString(w) == w {
			seq = append(seq, item{n: w})
			continue
		}
		for _, st := range stems(w) {
			if b, ok := bearingWords[st]; ok && len(b) == 1 {
				seq = append(seq, item{bearing: b})
				break
			}
		}
	}
	if len(seq) != 4 {
		return "", false
	}
	var parts [2]item
	switch {
	case seq[0].n != "" && seq[1].bearing != "" && seq[2].n != "" && seq[3].bearing != "":
		parts = [2]item{{seq[1].bearing, seq[0].n}, {seq[3].bearing, seq[2].n}}
	case seq[0].bearing != "" && seq[1].n != "" && seq[2].bearing != "" && seq[3].n != "":
		parts = [2]item{{seq[0].bearing, seq[1].n}, {seq[2].bearing, seq[3].n}}
	default:
		return "", false
	}
	vertical := func(b string) bool { return b == "N" || b == "S" }
	if vertical(parts[0].bearing) == vertical(parts[1].bearing) {
		return "", false
	}
	if !vertical(parts[0].bearing) {
		parts[0], parts[1] = parts[1], parts[0]
	}
	return parts[0].bearing + parts[0].n + " " + parts[1].bearing + parts[1].n, true
}
