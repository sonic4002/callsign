package radio

import (
	"reflect"
	"testing"
)

func TestFindLandmarks(t *testing.T) {
	cases := []struct {
		text string
		want []string
	}{
		// A kind word beside a point's name, with the bearing when it is given.
		{"Take cover in the house north of Foxtrot", []string{"F-house-1"}},
		{"take cover in the house south of the town", []string{"F-house-4"}},
		{"Hold the bunker at Delta", []string{"D-bunker-1"}},
		{"get into the trees south-west of Delta", []string{"D-grove-1"}},
		{"תפסו מחסה בבית שמצפון לפסל", []string{"F-house-1"}},
		{"היכנסו לבונקר שליד דוד", []string{"D-bunker-1"}},
		{"לחורשה מדרום-מערב לדוד", []string{"D-grove-1"}},
		{"הסלעים ממזרח לבועז", []string{"B-rocks-1"}},
		{"the rocks at Bravo", []string{"B-rocks-1", "B-rocks-2"}},
		// The landmark's own name, exactly as the map gives it.
		{"We are in the grove north of Alpha, no contact", []string{"A-grove-1"}},
		{"אנחנו בחומה ממזרח לאלף", []string{"A-wall-1"}},
		// Without a bearing every landmark of that kind at the point fits.
		{"the house at Foxtrot", []string{"F-house-1", "F-house-2", "F-house-3", "F-house-4"}},
		// Bridges, by name or as "the bridge" at a point.
		{"blow the south bridge", []string{"bridge-south"}},
		{"פוצצו את הגשר המערבי", []string{"bridge-west"}},
		// Nothing clear: a kind word with no point, a point with no kind word.
		{"find a house and stay there", nil},
		{"hold Foxtrot", nil},
		{"Contact north of Golf", nil},
	}
	for _, tc := range cases {
		got := net.FindLandmarks(tc.text)
		if len(got) == 0 {
			got = nil
		}
		if !reflect.DeepEqual(got, tc.want) {
			t.Errorf("%q: landmarks = %v, want %v", tc.text, got, tc.want)
		}
	}
	p, err := net.Parse("Viper 1, this is Hammer. Take cover in the bunker at Delta. Over.")
	if err != nil || !reflect.DeepEqual(p.Landmarks, []string{"D-bunker-1"}) || !reflect.DeepEqual(p.Points, []string{"D"}) {
		t.Fatalf("a parsed call carries landmarks %v and points %v (%v)", p.Landmarks, p.Points, err)
	}
}

func TestResolvePlace(t *testing.T) {
	cases := []struct {
		text    string
		want    string
		choices int
	}{
		{"F", "F", 0},
		{"Foxtrot", "F", 0},
		{"the town", "F", 0},
		{"פסל", "F", 0},
		{"F-house-1", "F-house-1", 0},
		{"bridge-south", "bridge-south", 0},
		{"the south bridge", "bridge-south", 0},
		{"the grove north of Alpha", "A-grove-1", 0},
		{"the bunker at Delta", "D-bunker-1", 0},
		{"הבונקר שליד דוד", "D-bunker-1", 0},
		// An offset from a point: a bearing, and metres when given.
		{"north of Foxtrot", "N of F", 0},
		{"200 metres east of Golf", "E of G 200", 0},
		{"north-east of Delta 150", "NE of D 150", 0},
		{"מצפון לפסל", "N of F", 0},
		{"150 מטר דרומית-מערבית לדוד", "SW of D 150", 0},
		{"N of F 200", "N of F 200", 0},
		// An exact spot: a distance each way, as the page writes it when a structure is placed.
		{"140 metres north and 60 metres east of Alpha", "N140 E60 of A", 0},
		{"60 metres west and 20 metres south of Delta", "S20 W60 of D", 0},
		{"140 מטר צפונית ו-60 מטר מזרחית לאלף", "N140 E60 of A", 0},
		{"80 מטר דרומית ו-40 מטר מערבית לדוד", "S80 W40 of D", 0},
		{"sw of d", "SW of D", 0},
		// More than one landmark fits: the caller is told which, and asks.
		{"the house at Foxtrot", "", 4},
		// Nothing the map knows.
		{"the lighthouse", "", 0},
		{"Romeo", "", 0},
		{"", "", 0},
	}
	for _, tc := range cases {
		got, choices, ok := net.ResolvePlace(tc.text)
		if got != tc.want || len(choices) != tc.choices || ok != (tc.want != "") {
			t.Errorf("%q → %q %v %v, want %q with %d choices", tc.text, got, choices, ok, tc.want, tc.choices)
		}
	}
	if en, he := net.PlaceName("D-bunker-1", "en"), net.PlaceName("D-bunker-1", "he"); en != "the bunker north of Delta" || he != "הבונקר מצפון לדוד" {
		t.Errorf("the bunker is called %q and %q", en, he)
	}
}
