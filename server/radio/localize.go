package radio

import (
	"regexp"
	"sort"
	"strings"
)

// Localize puts the names in a message body into the net's language. A station writing
// Hebrew sometimes names a point or a squad the English way ("נסוג לדלתא", "Delta",
// "Viper 2"); the net says דוד and צפע 2. Only whole names are replaced, and a Hebrew
// prefix letter glued to the front (ל, ב, מ, ה, ו, כ, ש) is kept.
func (n *Net) Localize(body, lang string) string {
	type swap struct{ from, to string }
	var swaps []swap
	other := "en"
	if lang == "en" {
		other = "he"
	}
	for _, p := range n.r.Map.Points {
		swaps = append(swaps, swap{p.Callsign.In(other), p.Callsign.In(lang)})
		if lang == "he" {
			for _, wrong := range n.r.Radio.SpelledOut[p.Callsign.En] {
				swaps = append(swaps, swap{wrong, p.Callsign.He})
			}
		}
	}
	cs := n.r.Callsigns
	for _, t := range cs.Classes {
		swaps = append(swaps, swap{t.In(other), t.In(lang)})
	}
	swaps = append(swaps, swap{cs.Player.In(other), cs.Player.In(lang)}, swap{cs.Operator.In(other), cs.Operator.In(lang)},
		swap{cs.AllStations.In(other), cs.AllStations.In(lang)}, swap{cs.Contact.In(other), cs.Contact.In(lang)})
	// Longest first, so "All stations" is not cut by a shorter name inside it.
	sort.SliceStable(swaps, func(i, j int) bool { return len(swaps[i].from) > len(swaps[j].from) })
	for _, s := range swaps {
		if s.from == "" || s.to == "" || strings.EqualFold(s.from, s.to) {
			continue
		}
		// A name stands alone: no letter of either alphabet right before or after it,
		// except a Hebrew prefix letter before, which stays.
		re := regexp.MustCompile(`(?i)(^|[^\p{L}]|[^\p{L}][לבמהוכש])` + regexp.QuoteMeta(s.from) + `($|[^\p{L}])`)
		for i := 0; i < 2; i++ { // twice: neighbours share a separator
			body = re.ReplaceAllString(body, "${1}"+s.to+"${2}")
		}
	}
	return body
}
