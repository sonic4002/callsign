// Package radio is the command net's procedure: who a transmission is for, who sent it,
// how it ends, and which procedure words and map points it carries. All of it is plain
// code over the callsign tables in the rules, in Hebrew and English. No model is involved.
package radio

import (
	"errors"
	"sort"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"callsign/shared"
)

const (
	Player   = "player"
	Operator = "operator"
	Squad    = "squad"
	All      = "all"
)

const (
	Over = "over" // done talking, reply expected
	Out  = "out"  // done talking, no reply expected
)

// Station is one voice on the net.
type Station struct {
	Kind  string `json:"kind"`
	Class string `json:"class,omitempty"` // for squads: infantry, vehicle, naval, air
	Num   int    `json:"num,omitempty"`
}

// Key is a stable id for the station, the same in both languages.
func (s Station) Key() string {
	if s.Kind == Squad {
		return s.Class + "-" + strconv.Itoa(s.Num)
	}
	return s.Kind
}

// Parsed is a transmission taken apart.
type Parsed struct {
	To       []Station
	From     *Station // nil when the sender did not say "this is …"
	Body     string   // the message without the call and the ending word
	End      string   // Over, Out or empty
	Lang     string   // "en" or "he"
	Prowords []string // procedure words found in the body, by their rules key
	Points   []string // map point ids the body mentions, in order
	// Landmarks are the ids of the landmarks and bridges the body clearly names.
	Landmarks []string
}

var (
	ErrOverAndOut = errors.New(`end with "Over" or with "Out", never both`)
	ErrNoSender   = errors.New(`say who you are after "this is"`)
	ErrEmpty      = errors.New("nothing to send")
)

type word struct {
	text string // lower case
	key  string
}

type fixedName struct {
	text string
	st   Station
}

// Net knows the callsigns, procedure words and place names of one rules file.
type Net struct {
	r       *shared.Rules
	fixed   []fixedName // Hammer, Anvil, All stations in both languages, longest first
	classes []word      // Viper, צפע … longest first; key is the unit class
	numbers []word      // one, שתיים … longest first; key is the digit
	markers [2]string   // "this is", "כאן"
	over    []string
	out     []string
	pro     []word       // procedure word spellings, longest first
	places  []word       // place names and aliases, longest first; key is the point id
	named   []namedPlace // landmarks and bridges by name
}

func NewNet(r *shared.Rules) *Net {
	n := &Net{r: r}
	add := func(t shared.Text, st Station) {
		n.fixed = append(n.fixed, fixedName{lower(t.En), st}, fixedName{lower(t.He), st})
	}
	add(r.Callsigns.Player, Station{Kind: Player})
	add(r.Callsigns.Operator, Station{Kind: Operator})
	add(r.Callsigns.AllStations, Station{Kind: All})
	sort.SliceStable(n.fixed, func(i, j int) bool { return len(n.fixed[i].text) > len(n.fixed[j].text) })

	for _, class := range sortedKeys(r.Callsigns.Classes) {
		t := r.Callsigns.Classes[class]
		n.classes = append(n.classes, word{lower(t.En), class}, word{lower(t.He), class})
	}
	byLength(n.classes)

	for i, spellings := range numberWords {
		for _, s := range spellings {
			n.numbers = append(n.numbers, word{s, strconv.Itoa(i + 1)})
		}
	}
	byLength(n.numbers)

	n.markers = [2]string{lower(r.Radio.Marker.En), lower(r.Radio.Marker.He)}
	n.over = []string{lower(r.Radio.Over.En), lower(r.Radio.Over.He)}
	n.out = []string{lower(r.Radio.Out.En), lower(r.Radio.Out.He)}

	for _, key := range sortedKeys(r.Radio.Prowords) {
		w := r.Radio.Prowords[key]
		for _, s := range append(append([]string{}, w.En...), w.He...) {
			n.pro = append(n.pro, word{lower(s), key})
		}
	}
	byLength(n.pro)

	for _, p := range r.Map.Points {
		for _, s := range append([]string{p.Callsign.En, p.Callsign.He, p.Name.En, p.Name.He}, p.Aliases...) {
			n.places = append(n.places, word{lower(s), p.ID})
		}
	}
	byLength(n.places)
	n.initPlaces()
	return n
}

// numberWords[i] spells i+1. Squads are called by number, typed or spoken.
var numberWords = [][]string{
	{"one", "אחת", "אחד"},
	{"two", "שתיים", "שתים", "שניים"},
	{"three", "שלוש", "שלושה"},
	{"four", "ארבע", "ארבעה"},
	{"five", "חמש", "חמישה"},
	{"six", "שש", "שישה"},
	{"seven", "שבע", "שבעה"},
	{"eight", "שמונה"},
	{"nine", "תשע", "תשעה"},
	{"ten", "עשר", "עשרה"},
	{"eleven"},
	{"twelve"},
}

// Name is the station's callsign in a language.
func (n *Net) Name(st Station, lang string) string {
	c := &n.r.Callsigns
	switch st.Kind {
	case Player:
		return c.Player.In(lang)
	case Operator:
		return c.Operator.In(lang)
	case All:
		return c.AllStations.In(lang)
	}
	return c.Classes[st.Class].In(lang) + " " + strconv.Itoa(st.Num)
}

// Resolve turns a written callsign such as "Viper 2" or "צפע 2" into a station.
func (n *Net) Resolve(name string) (Station, bool) {
	s := lower(strings.TrimSpace(name))
	st, rest, ok := n.station(s)
	if !ok || strings.TrimSpace(rest) != "" {
		return Station{}, false
	}
	return st, true
}

// Parse takes a transmission apart. Text with no call at the front is still a message:
// it comes back with no addressee and the caller decides who gets it.
func (n *Net) Parse(text string) (Parsed, error) { return n.parse(text, false) }

// ParseRelaxed is Parse for a player who drops the procedure: a callsign at the front
// addresses the message even with nothing after it but the order ("Viper 1 attack Delta").
func (n *Net) ParseRelaxed(text string) (Parsed, error) { return n.parse(text, true) }

func (n *Net) parse(text string, relaxed bool) (Parsed, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return Parsed{}, ErrEmpty
	}
	low := lower(text)
	if len(low) != len(text) {
		text = low // rare letters change size in lower case; keep the two aligned
	}

	var p Parsed
	pos := 0
	for {
		at := pos + skip(low[pos:], " \t,")
		if len(p.To) > 0 {
			switch rest := low[at:]; {
			case strings.HasPrefix(rest, "and "):
				at += 4
			case strings.HasPrefix(rest, "&"):
				at += 1 + skip(rest[1:], " ")
			case strings.HasPrefix(rest, "ו"):
				at += len("ו")
			}
		}
		st, rest, ok := n.station(low[at:])
		if !ok {
			break
		}
		p.To = append(p.To, st)
		pos = len(low) - len(rest)
	}

	body := pos
	at := pos + skip(low[pos:], separators)
	marker := -1
	for i, m := range n.markers {
		if strings.HasPrefix(low[at:], m) && boundary(low[at+len(m):]) {
			marker = i
			at += len(m)
		}
	}
	switch {
	case marker >= 0:
		at += skip(low[at:], separators)
		st, rest, ok := n.station(low[at:])
		if !ok {
			return Parsed{}, ErrNoSender
		}
		p.From = &st
		body = len(low) - len(rest)
	case len(p.To) > 0 && (relaxed || skip(low[pos:], " \t") < skip(low[pos:], separators)):
		// "Viper 2, hold Foxtrot": a call without "this is" still counts.
	default:
		p.To, body = nil, 0
	}
	body += skip(low[body:], separators)

	end, cut, err := n.ending(low[body:])
	if err != nil {
		return Parsed{}, err
	}
	p.End = end
	p.Body = strings.TrimRight(text[body:body+cut], separators)
	lowBody := lower(p.Body)
	p.Prowords = n.prowords(lowBody)
	p.Points = n.FindPoints(lowBody)
	p.Landmarks = n.FindLandmarks(lowBody)
	switch {
	case marker == 1:
		p.Lang = "he"
	case marker == 0:
		p.Lang = "en"
	case strings.IndexFunc(text, func(r rune) bool { return unicode.Is(unicode.Hebrew, r) }) >= 0:
		p.Lang = "he"
	default:
		p.Lang = "en"
	}
	return p, nil
}

const separators = " \t\n,.:;-–—"

// station reads one callsign from the front of lower-case text.
func (n *Net) station(s string) (Station, string, bool) {
	for _, f := range n.fixed {
		if strings.HasPrefix(s, f.text) && boundary(s[len(f.text):]) {
			return f.st, s[len(f.text):], true
		}
	}
	for _, c := range n.classes {
		if !strings.HasPrefix(s, c.text) {
			continue
		}
		rest := s[len(c.text):]
		rest = rest[skip(rest, " \t-#"):]
		digits := 0
		for digits < len(rest) && rest[digits] >= '0' && rest[digits] <= '9' {
			digits++
		}
		if digits > 0 && digits <= 2 && boundary(rest[digits:]) {
			if num, _ := strconv.Atoi(rest[:digits]); num > 0 {
				return Station{Kind: Squad, Class: c.key, Num: num}, rest[digits:], true
			}
		}
		for _, w := range n.numbers {
			if strings.HasPrefix(rest, w.text) && boundary(rest[len(w.text):]) {
				num, _ := strconv.Atoi(w.key)
				return Station{Kind: Squad, Class: c.key, Num: num}, rest[len(w.text):], true
			}
		}
	}
	return Station{}, s, false
}

// ending finds the closing Over or Out and returns how much of the body comes before it.
func (n *Net) ending(low string) (end string, cut int, err error) {
	trimmed := strings.TrimRight(low, separators+"!")
	strip := func(words []string) (int, bool) {
		for _, w := range words {
			if strings.HasSuffix(trimmed, w) && boundaryBefore(trimmed[:len(trimmed)-len(w)]) {
				return len(trimmed) - len(w), true
			}
		}
		return 0, false
	}
	at, ok := strip(n.out)
	if !ok {
		// Hebrew glues "and" onto the next word: עבור וסוף.
		for _, w := range n.out {
			if glued := "ו" + w; strings.HasSuffix(trimmed, glued) && boundaryBefore(trimmed[:len(trimmed)-len(glued)]) {
				at, ok = len(trimmed)-len(glued), true
			}
		}
	}
	if ok {
		// "over and out" in any spelling: an Over just before the Out.
		before := strings.TrimRight(trimmed[:at], separators+"&")
		before = strings.TrimRight(strings.TrimSuffix(before, "and"), separators)
		for _, w := range n.over {
			if strings.HasSuffix(before, w) && boundaryBefore(before[:len(before)-len(w)]) {
				return "", 0, ErrOverAndOut
			}
		}
		return Out, at, nil
	}
	if at, ok := strip(n.over); ok {
		return Over, at, nil
	}
	return "", len(low), nil
}

// prowords lists the procedure words in a body. Longer spellings are matched first and
// taken out, so "רות, יבוצע" is Wilco and not also Roger.
func (n *Net) prowords(low string) []string {
	work := []byte(low)
	found := map[string]bool{}
	for _, w := range n.pro {
		for from := 0; ; {
			i := strings.Index(string(work[from:]), w.text)
			if i < 0 {
				break
			}
			i += from
			from = i + len(w.text)
			if boundaryBefore(string(work[:i])) && boundary(string(work[from:])) {
				found[w.key] = true
				for j := i; j < from; j++ {
					work[j] = ' '
				}
			}
		}
	}
	return sortedKeys(found)
}

// BareAck reports whether a body is an acknowledgement and nothing else: Roger or Wilco
// in either language, with no word beside them. "Wilco, moving to Golf" is not one.
func (n *Net) BareAck(body string) bool {
	work := []byte(lower(body))
	found := false
	for _, w := range n.pro {
		if w.key != "roger" && w.key != "wilco" {
			continue
		}
		for from := 0; ; {
			i := strings.Index(string(work[from:]), w.text)
			if i < 0 {
				break
			}
			i += from
			from = i + len(w.text)
			if boundaryBefore(string(work[:i])) && boundary(string(work[from:])) {
				found = true
				for j := i; j < from; j++ {
					work[j] = ' '
				}
			}
		}
	}
	return found && strings.Trim(string(work), separators+"!") == ""
}

// hebrewPrefixes are the one-letter words Hebrew glues to the front of a noun
// (in, to, from, the, and, as, that), so "בפסל" still names Foxtrot.
const hebrewPrefixes = "בלמהוכש"

// FindPoints returns the ids of the map points a text mentions, in the order they appear.
// Bare letters never count: "a" is a word long before it is point A.
func (n *Net) FindPoints(text string) []string {
	ids, _ := n.findPoints(text)
	return ids
}

// findPoints is FindPoints that also returns the text, in lower case, with every point
// name it found blanked out, for whoever reads the words around them.
func (n *Net) findPoints(text string) ([]string, string) {
	work := []byte(lower(text))
	type hit struct {
		at int
		id string
	}
	var hits []hit
	for _, w := range n.places {
		for from := 0; ; {
			i := strings.Index(string(work[from:]), w.text)
			if i < 0 {
				break
			}
			i += from
			from = i + len(w.text)
			if !boundary(string(work[from:])) {
				continue
			}
			before := string(work[:i])
			if r, _ := utf8.DecodeRuneInString(w.text); unicode.Is(unicode.Hebrew, r) {
				for k := 0; k < 2; k++ {
					last, size := utf8.DecodeLastRuneInString(before)
					if size == 0 || !strings.ContainsRune(hebrewPrefixes, last) {
						break
					}
					if boundaryBefore(before[:len(before)-size]) {
						before = before[:len(before)-size]
						break
					}
					before = before[:len(before)-size]
				}
			}
			if !boundaryBefore(before) {
				continue
			}
			hits = append(hits, hit{i, w.key})
			for j := i; j < from; j++ {
				work[j] = ' '
			}
		}
	}
	sort.SliceStable(hits, func(i, j int) bool { return hits[i].at < hits[j].at })
	var ids []string
	for _, h := range hits {
		if len(ids) == 0 || ids[len(ids)-1] != h.id {
			ids = append(ids, h.id)
		}
	}
	return ids, string(work)
}

// ResolvePoint accepts a point id ("F") or any of its names and returns the id.
func (n *Net) ResolvePoint(s string) (string, bool) {
	s = strings.TrimSpace(s)
	if p := n.r.PointByID(strings.ToUpper(s)); p != nil {
		return p.ID, true
	}
	if ids := n.FindPoints(s); len(ids) == 1 {
		return ids[0], true
	}
	return "", false
}

// Compose writes a transmission in proper procedure:
//
//	Hammer, this is Viper 2. Wilco. Out.
//	פטיש, כאן צפע 2, רות, יבוצע, סוף.
//
// The body may be free text. A call or an ending the writer put in by habit is dropped,
// because Compose adds the right ones itself.
func (n *Net) Compose(lang string, from Station, to []Station, body, end string) (string, error) {
	if len(to) == 0 || (end != Over && end != Out) {
		return "", errors.New("a transmission needs an addressee and must end with over or out")
	}
	inner, err := n.Parse(body)
	if err != nil {
		return "", err
	}
	if inner.From != nil {
		body = inner.Body
	} else {
		// No call to drop. Names at the front belong to the message ("Viper 1, take Golf").
		body = strings.TrimSpace(body)
		_, cut, _ := n.ending(lower(body))
		if cut <= len(body) {
			body = body[:cut]
		}
	}
	body = strings.TrimRight(body, separators)
	if body == "" {
		return "", ErrEmpty
	}
	names := make([]string, len(to))
	for i, st := range to {
		names[i] = n.Name(st, lang)
	}
	endWord := n.r.Radio.Over.In(lang)
	if end == Out {
		endWord = n.r.Radio.Out.In(lang)
	}
	asked := strings.HasSuffix(body, "?") || strings.HasSuffix(body, "!")
	if lang == "he" {
		sep := ", "
		if asked {
			sep = " "
		}
		return list(names, " ו") + ", " + n.r.Radio.Marker.He + " " + n.Name(from, lang) +
			", " + body + sep + endWord + ".", nil
	}
	if !asked {
		body += "."
	}
	return list(names, " and ") + ", " + n.r.Radio.Marker.En + " " + n.Name(from, lang) +
		". " + body + " " + endWord + ".", nil
}

// list joins callsigns the way they are spoken: "Viper 1, Viper 2 and Rhino 1".
func list(names []string, and string) string {
	if len(names) == 1 {
		return names[0]
	}
	return strings.Join(names[:len(names)-1], ", ") + and + names[len(names)-1]
}

func lower(s string) string { return strings.ToLower(s) }

// skip counts the leading bytes of s that are in set.
func skip(s, set string) int { return len(s) - len(strings.TrimLeft(s, set)) }

// boundary reports whether a word can end here: the text stops or a non-letter follows.
func boundary(rest string) bool {
	r, size := utf8.DecodeRuneInString(rest)
	return size == 0 || !(unicode.IsLetter(r) || unicode.IsDigit(r))
}

// boundaryBefore reports whether a word can start here.
func boundaryBefore(before string) bool {
	r, size := utf8.DecodeLastRuneInString(before)
	return size == 0 || !(unicode.IsLetter(r) || unicode.IsDigit(r))
}

func byLength(ws []word) {
	sort.SliceStable(ws, func(i, j int) bool { return len(ws[i].text) > len(ws[j].text) })
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
