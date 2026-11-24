"""Run with `make tts-test` (python -m unittest, no models needed)."""
import json
import pathlib
import unittest

from pronounce import TABLE, fix

RULES = json.loads((pathlib.Path(__file__).parent.parent / "shared" / "rules.json").read_text(encoding="utf-8"))
RULES.setdefault("map", RULES["maps"]["small"])  # the default map, as the server sends it


class Pronounce(unittest.TestCase):
    def test_names_get_the_table_reading_and_keep_their_prefix(self):
        text = "פטיש, כאן קרנף אחת. מחזיקים בסמך ובאלף, תוקפים את זאב. עבור."
        heard = "<he>patˈiʃ, kˈan kaʁnˈaf ʔaχˈat. maχzikˈim besˈemaχ ubeʔˈelef, tokfˈim ʔˈet zˈeʔev. ʔavˈuʁ.</he>"
        self.assertEqual(
            fix(text, text, heard, "he"),
            "<he>patˈiʃ, kˈan kaʁnˈaf ʔaχˈat. maχzikˈim besˈameχ ubeʔˈalef, tokfˈim ʔˈet zeʔˈev. ʔavˈoʁ.</he>",
        )

    def test_over_is_fixed_only_as_the_closing_word(self):
        text = "מבקש סיוע עבור צפע שתיים, עבור."
        heard = "<he>mevakˈeʃ sijˈua ʔavˈuʁ tsˈefa ʃtˈajim, ʔavˈuʁ.</he>"
        self.assertEqual(fix(text, text, heard, "he"), "<he>mevakˈeʃ sijˈua ʔavˈuʁ tsˈefa ʃtˈajim, ʔavˈoʁ.</he>")

    def test_say_again_and_stand_by(self):
        text = "פטיש, כאן כריש אחת, אמור שנית, עבור."
        heard = "<he>patˈiʃ, kˈan kaʁˈiʃ ʔaχˈat, ʔamˈoʁ ʃenˈit, ʔavˈoʁ.</he>"
        self.assertIn("ʔemˈoʁ ʃenˈit", fix(text, text, heard, "he"))
        self.assertIn("ʔamˈoʁ lˈo", fix("אמור לו", "אמור לו", "<he>ʔamˈoʁ lˈo</he>", "he"))
        text = "פטיש, כאן צפע שתיים, המתן, סוף."
        self.assertIn("hamtˈen,", fix(text, text, "<he>patˈiʃ, kˈan tsˈefa ʃtˈajim, hamtˈan, sˈof.</he>", "he"))

    def test_a_spelled_out_number_is_not_taken_for_a_name(self):
        written = "יש 1000 זהב, מחזיקים באלף."
        prepared = "יש אלף זהב, מחזיקים באלף."
        heard = "<he>jˈeʃ ʔˈelef zahˈav, maχzikˈim beʔˈelef.</he>"
        self.assertEqual(fix(written, prepared, heard, "he"), heard)

    def test_text_that_does_not_line_up_is_left_alone(self):
        self.assertEqual(fix("סמך", "סמך", "<he>sˈemaχ sˈemaχ</he>", "he"), "<he>sˈemaχ sˈemaχ</he>")
        self.assertEqual(fix("Hold Sierra", "Hold Sierra", "<en>hˈoʊld siˈɛɹə</en>", "en"), "<en>hˈoʊld siˈɛɹə</en>")

    def test_foreign_words_keep_their_tags_and_do_not_break_the_line_up(self):
        text = "מגע ליד Foxtrot, עבור"
        heard = "<he>maɡˈa lejˈad fˈɑːkstɹɑːt , ʔavˈuʁ</he>"
        self.assertEqual(fix(text, text, heard, "he"), "<he>maɡˈa lejˈad fˈɑːkstɹɑːt, ʔavˈoʁ</he>")

    def test_every_hebrew_callsign_and_point_is_in_the_table(self):
        names = [p["callsign"]["he"] for m in RULES["maps"].values() for p in m["points"]]
        # The landmark words too, but for "בית": it is read two ways (bayit, and beit in
        # "בית זיקוק"), and the reader tells them apart better than a table can.
        names += [k["word"]["he"] for k in RULES["landmarkKinds"].values() if k["word"]["he"] != "בית"]
        names += [c["he"] for c in RULES["callsigns"]["classes"].values()]
        names += [RULES["callsigns"]["player"]["he"], RULES["callsigns"]["operator"]["he"]]
        self.assertEqual([w for n in names for w in n.split() if w not in TABLE["he"]], [])


if __name__ == "__main__":
    unittest.main()
