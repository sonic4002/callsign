package radio

import (
	"errors"
	"reflect"
	"testing"

	"callsign/shared"
)

var net = NewNet(shared.MustLoad())

var (
	hammer = Station{Kind: Player}
	anvil  = Station{Kind: Operator}
	all    = Station{Kind: All}
	viper2 = Station{Kind: Squad, Class: "infantry", Num: 2}
	rhino1 = Station{Kind: Squad, Class: "vehicle", Num: 1}
	shark3 = Station{Kind: Squad, Class: "naval", Num: 3}
)

func TestParseRouting(t *testing.T) {
	cases := []struct {
		text string
		to   []Station
		from *Station
		body string
		end  string
		lang string
	}{
		{"Viper 2, this is Hammer. Hold Foxtrot. Over.", []Station{viper2}, &hammer, "Hold Foxtrot", Over, "en"},
		{"צפע 2, כאן פטיש, תחזיקו את פסל, עבור.", []Station{viper2}, &hammer, "תחזיקו את פסל", Over, "he"},
		{"Hammer, this is Viper 2. Wilco. Out.", []Station{hammer}, &viper2, "Wilco", Out, "en"},
		{"פטיש, כאן צפע 2, רות, יבוצע, סוף.", []Station{hammer}, &viper2, "רות, יבוצע", Out, "he"},
		{"viper two this is hammer hold foxtrot over", []Station{viper2}, &hammer, "hold foxtrot", Over, "en"},
		{"צפע שתיים, כאן פטיש, תחזיקו את פסל, עבור", []Station{viper2}, &hammer, "תחזיקו את פסל", Over, "he"},
		{"Viper 2 and Rhino 1, this is Hammer. Take Golf. Over.", []Station{viper2, rhino1}, &hammer, "Take Golf", Over, "en"},
		{"צפע 2 וקרנף 1, כאן פטיש, קחו את גימל, עבור.", []Station{viper2, rhino1}, &hammer, "קחו את גימל", Over, "he"},
		{"Viper 2, Rhino 1 & Shark 3, this is Hammer: status? Over", []Station{viper2, rhino1, shark3}, &hammer, "status?", Over, "en"},
		{"All stations, this is Hammer. Radio silence. Out.", []Station{all}, &hammer, "Radio silence", Out, "en"},
		{"כל התחנות, כאן פטיש, דממת אלחוט, סוף.", []Station{all}, &hammer, "דממת אלחוט", Out, "he"},
		{"Anvil, this is Hammer. Buy two more tanks and upgrade Viper 2. Over.", []Station{anvil}, &hammer, "Buy two more tanks and upgrade Viper 2", Over, "en"},
		{"סדן, כאן פטיש, מה קורה בכרמל? עבור.", []Station{anvil}, &hammer, "מה קורה בכרמל?", Over, "he"},
		// A call without "this is" still routes.
		{"Viper 2, hold Foxtrot", []Station{viper2}, nil, "hold Foxtrot", "", "en"},
		{"צפע 2, תחזיקו את Foxtrot", []Station{viper2}, nil, "תחזיקו את Foxtrot", "", "he"},
		// No call at all: the room hands it to the operator.
		{"What's happening at Kilo?", nil, nil, "What's happening at Kilo?", "", "en"},
		{"Viper 2 is where?", nil, nil, "Viper 2 is where?", "", "en"},
		{"Vipers hold the line", nil, nil, "Vipers hold the line", "", "en"},
		{"This is Hammer. Radio check. Over.", nil, &hammer, "Radio check", Over, "en"},
		// "out" inside the message is not the ending.
		{"Viper 2, this is Hammer. Move out. Over.", []Station{viper2}, &hammer, "Move out", Over, "en"},
		{"Viper-2, this is Hammer, hold Foxtrot, OVER!", []Station{viper2}, &hammer, "hold Foxtrot", Over, "en"},
	}
	for _, tc := range cases {
		p, err := net.Parse(tc.text)
		if err != nil {
			t.Errorf("%q: %v", tc.text, err)
			continue
		}
		if !reflect.DeepEqual(p.To, tc.to) || !reflect.DeepEqual(p.From, tc.from) ||
			p.Body != tc.body || p.End != tc.end || p.Lang != tc.lang {
			t.Errorf("%q:\n got to=%v from=%v body=%q end=%q lang=%q\nwant to=%v from=%v body=%q end=%q lang=%q",
				tc.text, p.To, p.From, p.Body, p.End, p.Lang, tc.to, tc.from, tc.body, tc.end, tc.lang)
		}
	}
}

func TestParseRefuses(t *testing.T) {
	cases := []struct {
		text string
		want error
	}{
		{"Viper 2, this is Hammer. Hold Foxtrot. Over and out.", ErrOverAndOut},
		{"Viper 2, this is Hammer. Hold Foxtrot. Over, out", ErrOverAndOut},
		{"Viper 2, this is Hammer. Hold Foxtrot. Over & Out.", ErrOverAndOut},
		{"צפע 2, כאן פטיש, תחזיקו את פסל, עבור וסוף.", ErrOverAndOut},
		{"צפע 2, כאן פטיש, תחזיקו את פסל, עבור, סוף", ErrOverAndOut},
		{"Viper 2, this is somebody. Hold. Over.", ErrNoSender},
		{"   ", ErrEmpty},
	}
	for _, tc := range cases {
		if _, err := net.Parse(tc.text); !errors.Is(err, tc.want) {
			t.Errorf("%q: err = %v, want %v", tc.text, err, tc.want)
		}
	}
}

func TestProwords(t *testing.T) {
	cases := []struct {
		text string
		want []string
	}{
		{"Hammer, this is Viper 2. Wilco. Out.", []string{"wilco"}},
		{"פטיש, כאן צפע 2, רות, יבוצע, סוף.", []string{"wilco"}}, // not also Roger
		{"פטיש, כאן צפע 2, רות, סוף.", []string{"roger"}},
		{"Hammer, this is Viper 2. Roger. Out.", []string{"roger"}},
		{"Hammer, this is Viper 2. Say again. Over.", []string{"sayAgain"}},
		{"פטיש, כאן צפע 2, אמור שנית, עבור.", []string{"sayAgain"}},
		{"Hammer, this is Viper 2. Stand by.", []string{"standBy"}},
		{"פטיש, כאן צפע 2, המתן.", []string{"standBy"}},
		{"Viper 2, this is Hammer. Correction, hold Golf. Over.", []string{"correction"}},
		{"צפע 2, כאן פטיש, תיקון, תחזיקו את גימל, עבור.", []string{"correction"}},
		{"Hammer, this is Rhino 1. Negative, bridge at Golf is down. Over.", []string{"negative"}},
		{"פטיש, כאן צפע 1, חמש על חמש, סוף.", []string{"fiveByFive"}},
		{"All stations, this is Hammer. Radio check. Over.", []string{"radioCheck"}},
		{"Hammer, this is Viper 2. Rogers farm is clear. Over.", nil}, // whole words only
	}
	for _, tc := range cases {
		p, err := net.Parse(tc.text)
		if err != nil {
			t.Errorf("%q: %v", tc.text, err)
			continue
		}
		if !reflect.DeepEqual(p.Prowords, tc.want) && !(len(p.Prowords) == 0 && len(tc.want) == 0) {
			t.Errorf("%q: prowords = %v, want %v", tc.text, p.Prowords, tc.want)
		}
	}
}

func TestFindPoints(t *testing.T) {
	cases := []struct {
		text string
		want []string
	}{
		{"Hold Foxtrot", []string{"F"}},
		{"hold the town", []string{"F"}},
		{"תחזיקו את פסל", []string{"F"}},
		{"תחזיקו את העיירה", []string{"F"}},
		{"אנחנו בפסל", []string{"F"}},
		{"נעים לגימל ומשם לכרמל", []string{"G", "K"}},
		{"תחזיקו את Foxtrot", []string{"F"}},
		{"Ambush anything crossing Golf, then fall back to the farm", []string{"G", "H"}},
		{"Take the sea rig and the west field", []string{"S", "B"}},
		{"Contact, three vehicles north of Golf", []string{"G"}},
		{"take a look around", nil}, // "a" is not point A
		{"downtown is quiet", nil},
		{"hold", nil},
	}
	for _, tc := range cases {
		got := net.FindPoints(tc.text)
		if !reflect.DeepEqual(got, tc.want) && !(len(got) == 0 && len(tc.want) == 0) {
			t.Errorf("%q: points = %v, want %v", tc.text, got, tc.want)
		}
	}
	for arg, want := range map[string]string{"F": "F", "f": "F", "Foxtrot": "F", "פסל": "F", "the town": "F", "Zulu": "Z"} {
		if got, ok := net.ResolvePoint(arg); !ok || got != want {
			t.Errorf("ResolvePoint(%q) = %q %v, want %q", arg, got, ok, want)
		}
	}
	for _, arg := range []string{"", "Romeo", "Golf or Kilo"} {
		if got, ok := net.ResolvePoint(arg); ok {
			t.Errorf("ResolvePoint(%q) = %q, want no match", arg, got)
		}
	}
}

func TestCompose(t *testing.T) {
	cases := []struct {
		lang string
		from Station
		to   []Station
		body string
		end  string
		want string
	}{
		{"en", viper2, []Station{hammer}, "Wilco", Out, "Hammer, this is Viper 2. Wilco. Out."},
		{"he", viper2, []Station{hammer}, "רות, יבוצע", Out, "פטיש, כאן צפע 2, רות, יבוצע, סוף."},
		// What a model adds by habit is dropped; the net adds the right call and ending.
		{"en", viper2, []Station{hammer}, "Hammer, this is Viper 2. Wilco. Out.", Out, "Hammer, this is Viper 2. Wilco. Out."},
		{"en", viper2, []Station{hammer}, "Wilco, over.", Out, "Hammer, this is Viper 2. Wilco. Out."},
		{"he", viper2, []Station{hammer}, "פטיש, כאן צפע 2, רות, יבוצע, סוף.", Out, "פטיש, כאן צפע 2, רות, יבוצע, סוף."},
		{"en", viper2, []Station{hammer}, "Contact, three vehicles north of Golf", Over, "Hammer, this is Viper 2. Contact, three vehicles north of Golf. Over."},
		{"he", viper2, []Station{hammer}, "מגע, שלושה רכבים צפונית לגימל", Over, "פטיש, כאן צפע 2, מגע, שלושה רכבים צפונית לגימל, עבור."},
		{"en", anvil, []Station{viper2, rhino1}, "Viper 2, take Golf. Rhino 1, cover the bridge", Over, "Viper 2 and Rhino 1, this is Anvil. Viper 2, take Golf. Rhino 1, cover the bridge. Over."},
		{"he", anvil, []Station{viper2, rhino1}, "קחו את גימל", Over, "צפע 2 וקרנף 1, כאן סדן, קחו את גימל, עבור."},
		{"en", anvil, []Station{viper2, rhino1, shark3}, "Report status", Over, "Viper 2, Rhino 1 and Shark 3, this is Anvil. Report status. Over."},
		{"he", anvil, []Station{viper2, rhino1, shark3}, "דווחו מצב", Over, "צפע 2, קרנף 1 וכריש 3, כאן סדן, דווחו מצב, עבור."},
		{"en", anvil, []Station{all}, "Enemy satellite uplink detected", Out, "All stations, this is Anvil. Enemy satellite uplink detected. Out."},
		{"en", anvil, []Station{hammer}, "Which squad?", Over, "Hammer, this is Anvil. Which squad? Over."},
		{"he", anvil, []Station{hammer}, "איזו כיתה?", Over, "פטיש, כאן סדן, איזו כיתה? עבור."},
	}
	for _, tc := range cases {
		got, err := net.Compose(tc.lang, tc.from, tc.to, tc.body, tc.end)
		if err != nil || got != tc.want {
			t.Errorf("Compose(%q):\n got %q (%v)\nwant %q", tc.body, got, err, tc.want)
			continue
		}
		// Whatever the net writes, the net can read back.
		p, err := net.Parse(got)
		if err != nil || !reflect.DeepEqual(p.To, tc.to) || p.From == nil || *p.From != tc.from || p.End != tc.end || p.Lang != tc.lang {
			t.Errorf("round trip of %q: %+v %v", got, p, err)
		}
	}
	if _, err := net.Compose("en", viper2, []Station{hammer}, "Wilco, over and out", Out); !errors.Is(err, ErrOverAndOut) {
		t.Errorf("over and out: err = %v", err)
	}
	if _, err := net.Compose("en", viper2, []Station{hammer}, " . ", Out); !errors.Is(err, ErrEmpty) {
		t.Errorf("empty body: err = %v", err)
	}
	if _, err := net.Compose("en", viper2, nil, "Wilco", Out); err == nil {
		t.Error("no addressee: want an error")
	}
	if _, err := net.Compose("en", viper2, []Station{hammer}, "Wilco", "over and out"); err == nil {
		t.Error("bad ending: want an error")
	}
}

func TestResolveAndName(t *testing.T) {
	for name, want := range map[string]Station{
		"Viper 2": viper2, "viper two": viper2, "צפע 2": viper2, "Hammer": hammer, "סדן": anvil,
		"all stations": all, "כל התחנות": all, "Shark 3": shark3, "כריש 3": shark3,
	} {
		if got, ok := net.Resolve(name); !ok || got != want {
			t.Errorf("Resolve(%q) = %+v %v, want %+v", name, got, ok, want)
		}
	}
	for _, name := range []string{"Viper", "Viper 0", "Wolf 1", "Viper 2 now", ""} {
		if got, ok := net.Resolve(name); ok {
			t.Errorf("Resolve(%q) = %+v, want no match", name, got)
		}
	}
	if got := net.Name(viper2, "he"); got != "צפע 2" {
		t.Errorf("Name = %q", got)
	}
	if viper2.Key() != "infantry-2" || hammer.Key() != "player" {
		t.Errorf("keys: %q %q", viper2.Key(), hammer.Key())
	}
}

// No callsign may sound like a map point, and no point may use ר: "רות" means Roger.
func TestCallsignsAndPointsDoNotCollide(t *testing.T) {
	r := shared.MustLoad()
	for _, p := range r.Map.Points {
		for _, name := range []string{p.Callsign.En, p.Callsign.He} {
			if _, ok := net.Resolve(name + " 1"); ok {
				t.Errorf("point %s (%s) is also a callsign", p.ID, name)
			}
			if pro := net.prowords(lower(name)); len(pro) > 0 {
				t.Errorf("point %s (%s) reads as procedure word %v", p.ID, name, pro)
			}
		}
		if []rune(p.Callsign.He)[0] == 'ר' {
			t.Errorf("point %s uses ר", p.ID)
		}
	}
}
