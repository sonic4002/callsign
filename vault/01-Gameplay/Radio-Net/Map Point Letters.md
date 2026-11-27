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
updated: 2026-11-26
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
  - tools/mapgen.py
  - CLAUDE.md
---

# Map Point Letters

Map points are named by letters that exist in both the NATO alphabet and the IDF spelling alphabet, so each point has one English word and one Hebrew word that start with the "same" letter. The point's id is the Latin letter; the names are in `shared/rules.json` under each map's `points`.

## The fifteen letters in use

| Id | English | Hebrew | Small | Medium | Large |
|---|---|---|---|---|---|
| A | Alpha | אלף | yes | yes | yes |
| B | Bravo | בועז | yes | yes | yes |
| G | Golf | גימל | yes | yes | yes |
| D | Delta | דוד | yes | yes | yes |
| H | Hotel | הגר | yes | yes | yes |
| V | Victor | ואו | – | yes | yes |
| Z | Zulu | זאב | yes | yes | yes |
| Y | Yankee | יואב | – | yes | yes |
| K | Kilo | כרמל | yes | yes | yes |
| L | Lima | לאה | – | yes | yes |
| M | Mike | משה | – | yes | yes |
| N | November | נשר | yes | yes | yes |
| S | Sierra | סמך | yes | yes | yes |
| F | Foxtrot | פסל | yes | yes | yes |
| T | Tango | תמר | yes | yes | yes |

Small has 11 points, medium and large 15 each.

## Never ר

A point's Hebrew name never starts with ר (the IDF word for it, רות, is the procedure word Roger). `server/radio/radio_test.go` checks every point of the rules for this, and that every point has names in both languages. There is no "Romeo" point; tests use "Romeo" as the example of an unknown place.

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

Map sizes and what stands at each point are in [[Maps]], [[Map - Small]], [[Map - Medium]] and [[Map - Large]].

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

See [[Net Language]].

## Differences from the docs

- `KICKOFF.md` describes one blank map with points A, B, G, D, H, F, K, S, Z. The code has three maps and six more letters (T, N, L, M, Y, V).
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
- [[Decision - Language and Radio]]
- [[Glossary]]
