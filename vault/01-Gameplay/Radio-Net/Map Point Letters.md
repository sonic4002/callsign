---
title: Map Point Letters
description: "Map points are named by letters that exist in both the NATO alphabet and the IDF spelling alphabet, so each point has one English word and one Hebrew word that start with the 'same' letter."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/mixed
  - area/gameplay
  - topic/radio
  - topic/maps
  - topic/hebrew
created: 2026-11-26
updated: 2026-11-27
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Maps]]"
  - "[[Map - Small]]"
  - "[[Map - Medium]]"
  - "[[Map - Large]]"
  - "[[Net Language]]"
  - "[[Radio Net and Bilingual Procedure]]"
  - "[[Places on the Radio]]"
  - "[[Callsigns]]"
  - "[[Decision - Language and Radio]]"
  - "[[Glossary]]"
paths:
  - shared/rules.json
  - server/radio/radio.go
  - server/radio/radio_test.go
  - server/radio/localize.go
  - server/sim/terrain_test.go
  - client/voice/normalize.js
  - tts/pronounce.json
  - tools/mapgen.py
  - CLAUDE.md
---

# Map Point Letters

Map points are named by letters that exist in both the NATO alphabet and the IDF spelling alphabet, so each point has one English word and one Hebrew word that start with the "same" letter. The point's id is the Latin letter; the names are in `shared/rules.json` under each map's `points`.

## The twenty-one letters in use

| Id | English | Hebrew | Small | Medium | Large | Huge |
|---|---|---|---|---|---|---|
| A | Alpha | אלף | yes | yes | yes | yes |
| B | Bravo | בועז | yes | yes | yes | yes |
| G | Golf | גימל | yes | yes | yes | yes |
| D | Delta | דוד | yes | yes | yes | yes |
| H | Hotel | הגר | yes | yes | yes | yes |
| V | Victor | ואו | – | yes | yes | yes |
| Z | Zulu | זאב | yes | yes | yes | yes |
| Y | Yankee | יואב | – | yes | yes | yes |
| K | Kilo | כרמל | yes | yes | yes | yes |
| L | Lima | לאה | – | yes | yes | yes |
| M | Mike | משה | – | yes | yes | yes |
| N | November | נשר | yes | yes | yes | yes |
| S | Sierra | סמך | yes | yes | yes | yes |
| F | Foxtrot | פסל | yes | yes | yes | yes |
| T | Tango | תמר | yes | yes | yes | yes |
| Q | Quebec | קורח | – | – | – | yes |
| C | Charlie | צפורה | – | – | – | yes |
| O | Oscar | עין | – | – | – | yes |
| E | Echo | חוה | – | – | – | yes |
| W | Whiskey | שמיר | – | – | – | yes |
| X | X-ray | טיח | – | – | – | yes |

Small has 11 points, medium and large 15 each, and huge all 21. `server/sim/terrain_test.go` holds the list (`sharedLetters`) and checks every point of every map against it, letter and both words.

The last six were chosen by the owner for the huge map on 2026-11-27. The code and the pronunciation table have יואב for Yankee; the alphabet table in `docs/PLAN.html` and the owner's note of that day say יונה, and the code was left as it is.

## Never ר

A point's Hebrew name never starts with ר (the IDF word for it, רות, is the procedure word Roger). `server/radio/radio_test.go` checks every point of every map for this, that no point is also a callsign or a procedure word, and that each of its names finds that point and no other. There is no "Romeo" point; tests use "Romeo" as the example of an unknown place.

## What each point is, per map

Every point also has a descriptive name and aliases; all of them route to the same id. A is always the west headquarters (side 0) and Z the east one (side 1).

### Small (2800 x 1760)

| Id | Kind | English name | Hebrew name |
|---|---|---|---|
| A | hq | West HQ | המפקדה המערבית |
| Z | hq | East HQ | המפקדה המזרחית |
| B | landRig | West field | השדה המערבי |
| K | landRig | East field | השדה המזרחי |
| D | point | Ridge | הרכס |
| H | point | Farm | החווה |
| T | point | West quarry | המחצבה המערבית |
| N | point | East quarry | המחצבה המזרחית |
| G | point | Frozen ford | המעבר הקפוא |
| F | point | Town | העיירה |
| S | seaRig | Sea rig | האסדה הימית |

### Medium (4000 x 2480)

| Id | Kind | English name | Hebrew name |
|---|---|---|---|
| A | hq | West HQ | המפקדה המערבית |
| Z | hq | East HQ | המפקדה המזרחית |
| B | landRig | North-west field | השדה הצפון-מערבי |
| K | landRig | North-east field | השדה הצפון-מזרחי |
| D | point | West farm | החווה המערבית |
| H | point | East farm | החווה המזרחית |
| L | point | West village | הכפר המערבי |
| M | point | East village | הכפר המזרחי |
| T | point | West fort | המבצר המערבי |
| Y | point | East fort | המבצר המזרחי |
| N | point | Islet | האי הקטן |
| G | point | Quarry | המחצבה |
| F | point | Town | העיירה |
| V | point | South shore | החוף הדרומי |
| S | seaRig | Sea rig | האסדה הימית |

### Large (5200 x 3200)

| Id | Kind | English name | Hebrew name |
|---|---|---|---|
| A | hq | West HQ | המפקדה המערבית |
| Z | hq | East HQ | המפקדה המזרחית |
| B | landRig | North-west field | השדה הצפון-מערבי |
| K | landRig | North-east field | השדה הצפון-מזרחי |
| D | landRig | South-west field | השדה הדרום-מערבי |
| H | landRig | South-east field | השדה הדרום-מזרחי |
| L | point | West village | הכפר המערבי |
| M | point | East village | הכפר המזרחי |
| T | point | West fort | המבצר המערבי |
| Y | point | East fort | המבצר המזרחי |
| N | point | Glacier | הקרחון |
| G | point | Middle pass | המעבר האמצעי |
| F | point | Town | העיירה |
| V | point | South gap | הפרצה הדרומית |
| S | seaRig | Lake rig | אסדת האגם |

### Huge (6800 x 4200)

| Id | Kind | English name | Hebrew name |
|---|---|---|---|
| A | hq | West HQ | המפקדה המערבית |
| Z | hq | East HQ | המפקדה המזרחית |
| B | landRig | North-west field | השדה הצפון-מערבי |
| K | landRig | North-east field | השדה הצפון-מזרחי |
| D | landRig | South-west field | השדה הדרום-מערבי |
| H | landRig | South-east field | השדה הדרום-מזרחי |
| L | point | West village | הכפר המערבי |
| M | point | East village | הכפר המזרחי |
| T | point | West fort | המבצר המערבי |
| Y | point | East fort | המבצר המזרחי |
| Q | point | West pass | המעבר המערבי |
| C | point | East pass | המעבר המזרחי |
| O | point | West orchard | הפרדס המערבי |
| E | point | East orchard | הפרדס המזרחי |
| W | point | West gate | השער המערבי |
| X | point | East gate | השער המזרחי |
| N | point | Glacier | הקרחון |
| G | point | Mine | המכרה |
| F | point | Town | העיירה |
| V | point | Lighthouse | המגדלור |
| S | seaRig | Sea rig | האסדה הימית |

Map sizes and what stands at each point are in [[Maps]], [[Map - Small]], [[Map - Medium]], [[Map - Large]] and [[Map - Huge]].

## How a point is found in a message

`Net.FindPoints` searches the body for every callsign, name and alias (both languages, longest first):

- The match must end on a word boundary and start on one.
- For a Hebrew name, up to two glued one-letter prefixes are allowed in front of it — ב ל מ ה ו כ ש (in, to, from, the, and, as, that) — so "בפסל" and "לדוד" still name Foxtrot and Delta.
- Bare letters never count in free text: "a" is a word long before it is point A. The id alone is accepted only where a whole argument is a place (`Net.ResolvePoint`, `Net.ResolvePlace`), for example the `place` argument `"F"`.
- The same point named twice in a row is listed once; points come back in the order they appear.

The ids found travel with the radio message as `points`.

## The Hebrew names of NATO words

A Hebrew speaker, or a recogniser, may write the English word in Hebrew letters ("דלתא" for Delta). `radio.spelledOut` lists these wrong spellings per letter, and `Net.Localize` replaces them with the IDF name when the net is in Hebrew:

| English | Hebrew spellings corrected | Becomes |
|---|---|---|
| Alpha | אלפא, אלפה | אלף |
| Bravo | בראבו, ברבו | בועז |
| Golf | גולף | גימל |
| Delta | דלתא, דלתה | דוד |
| Hotel | הוטל | הגר |
| Foxtrot | פוקסטרוט, פוקסטרות | פסל |
| Kilo | קילו | כרמל |
| Sierra | סיירה, סיארה | סמך |
| Zulu | זולו | זאב |
| Lima | לימה | לאה |
| Mike | מייק | משה |
| November | נובמבר | נשר |
| Tango | טנגו | תמר |
| Yankee | יאנקי, ינקי | יואב |
| Victor | ויקטור | ואו |
| Quebec | קוויבק, קוובק, קבק | קורח |
| Charlie | צ'רלי, צרלי | צפורה |
| Oscar | אוסקר | עין |
| Echo | אקו | חוה |
| Whiskey | וויסקי, ויסקי | שמיר |
| X-ray | אקס-ריי, אקס ריי, אקסריי | טיח |

See [[Net Language]].

## The six new names and the words near them

Checked on 2026-11-27, when the six letters of the huge map were added:

- **In the server's matcher** (`Net.FindPoints`) a name must stand as a whole word, so none of the six is found inside another word. No fixed line of the net (cues, the rule brain's sentences) contains one; a test holds that for every map. Hebrew glues up to two prefix letters, so "מעין" (a kind of) would read as "from Oscar": rare on a radio, and left.
- **Two names are ordinary words said the same way.** חוה sounds like חווה (a farm), which is a point's name on the small and medium maps: the huge map has no farm. X-ray has a hyphen: "xray" and "x ray" are aliases of the point.
- **In the page's tidy step** the six lay close to common words of orders: by rough sound נועו (move) and אין (none) were taken for עין, דווח (report) and טווח (range) for טיח, שמרו (guard) for שמיר, קרח (ice) for קורח, six for Whiskey, each and eyes and the assay office for Echo. This was resolved in `client/voice/normalize.js`: a name with a single consonant sound is matched only when it reads the same as the word, and the colliding words of orders and reports are in the list of words that are never places. See [[Hints and Tidy Step]].
- **Left as they were:** Charlie sounds like Sierra and Zulu to the rough matcher ("shore" already became Sierra, and now becomes Charlie), and X-ray like Kilo ("quarry", "carry"). These three-way likenesses existed before between Sierra and Zulu.
- The rule brain (`agents/rule-grammar.mjs`) holds no list of point names: it reads the points the server found. A test gives an order to each of the 21 points in both languages.

## Differences from the docs

- `KICKOFF.md` describes one blank map with points A, B, G, D, H, F, K, S, Z. The code has four maps and twelve more letters (T, N, L, M, Y, V, and Q, C, O, E, W, X on the huge map).
- `CLAUDE.md` gives Foxtrot = פסל, Kilo = כרמל, Sierra = סמך as examples; they match the code.

## Related

- [[Radio Net and Bilingual Procedure]]
- [[Places on the Radio]]
- [[Callsigns]]
- [[Net Language]]
- [[Maps]]
- [[Map - Small]]
- [[Map - Medium]]
- [[Map - Large]]
- [[Map - Huge]]
- [[Hints and Tidy Step]]
- [[Decision - Language and Radio]]
- [[Glossary]]
