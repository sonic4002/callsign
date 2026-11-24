package radio

import "testing"

func TestLocalizePutsNamesIntoTheNetLanguage(t *testing.T) {
	n := net
	for _, tc := range []struct{ lang, in, want string }{
		{"he", "אבדן כבד, נשארה חוליה אחת, נסוג לדלתא, עבור.", "אבדן כבד, נשארה חוליה אחת, נסוג לדוד, עבור."},
		{"he", "נסוג ל Delta", "נסוג ל דוד"},
		{"he", "מגע בפוקסטרוט, Viper 2 מחזיק בבראבו", "מגע בפסל, צפע 2 מחזיק בבועז"},
		{"he", "מטרה 11 יצאה מטווח, מחזיקים את גימל", "מטרה 11 יצאה מטווח, מחזיקים את גימל"},
		{"he", "Target 4 ליד Kilo, קילומטר צפונה", "מטרה 4 ליד כרמל, קילומטר צפונה"},
		{"he", "המלון בהוטל", "המלון בהגר"},
		{"en", "Holding דוד with צפע 2", "Holding Delta with Viper 2"},
		{"en", "Contact near Delta, a deltawing overhead", "Contact near Delta, a deltawing overhead"},
	} {
		if got := n.Localize(tc.in, tc.lang); got != tc.want {
			t.Errorf("%s %q:\n got  %q\n want %q", tc.lang, tc.in, got, tc.want)
		}
	}
}
