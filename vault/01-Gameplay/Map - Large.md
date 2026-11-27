---
title: Map - Large
description: "Mountain Passes is the large map, second in size to Great Moat."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/code
  - area/gameplay
  - topic/game-design
  - topic/maps
created: 2026-11-26
updated: 2026-11-27
agent: CLD
origin: code
confidence: medium
related:
  - "[[Game Overview]]"
  - "[[Maps]]"
  - "[[Map - Small]]"
  - "[[Map - Medium]]"
  - "[[Map - Huge]]"
  - "[[Terrain, Cover and Bridges]]"
  - "[[Map Point Letters]]"
  - "[[Places on the Radio]]"
  - "[[Tech Buildings]]"
  - "[[Economy]]"
paths:
  - shared/rules.json
  - tools/mapgen.py
  - shared/rules.go
---

# Map - Large

Mountain Passes is the large map. It was the largest until Great Moat ([[Map - Huge]]) was added on 2026-11-27. A mountain range splits it, crossed by passes (Glacier, Middle pass, South gap), with four bridges in the south and a lake rig. All data below is the `maps.large` block of `shared/rules.json`, which `tools/mapgen.py` writes (`make maps`); nothing in it is edited by hand.

## Size and clock

| field | value |
|---|---|
| name | Mountain Passes / מעברי ההרים |
| width x height (map units) | 5200 x 3200 |
| terrain cell | 40 |
| default match length | 1500 s (25 min) |
| pace (multiplier on all movement) | 2 |

The west side (side 0) holds Alpha, the east side (side 1) holds Zulu. The map is drawn on its west half and mirrored, so neither side starts better.

## Points

| id | callsign EN | callsign HE | name EN | name HE | kind | owner at start | x | y |
|---|---|---|---|---|---|---|---|---|
| A | Alpha | אלף | West HQ | המפקדה המערבית | hq | side 0 (west) | 360 | 1880 |
| Z | Zulu | זאב | East HQ | המפקדה המזרחית | hq | side 1 (east) | 4840 | 1880 |
| B | Bravo | בועז | North-west field | השדה הצפון-מערבי | landRig | nobody | 800 | 760 |
| K | Kilo | כרמל | North-east field | השדה הצפון-מזרחי | landRig | nobody | 4400 | 760 |
| D | Delta | דוד | South-west field | השדה הדרום-מערבי | landRig | nobody | 760 | 2800 |
| H | Hotel | הגר | South-east field | השדה הדרום-מזרחי | landRig | nobody | 4440 | 2800 |
| L | Lima | לאה | West village | הכפר המערבי | point | nobody | 1900 | 1760 |
| M | Mike | משה | East village | הכפר המזרחי | point | nobody | 3300 | 1760 |
| T | Tango | תמר | West fort | המבצר המערבי | point | nobody | 1900 | 600 |
| Y | Yankee | יואב | East fort | המבצר המזרחי | point | nobody | 3300 | 600 |
| N | November | נשר | Glacier | הקרחון | point | nobody | 2600 | 120 |
| G | Golf | גימל | Middle pass | המעבר האמצעי | point | nobody | 2600 | 960 |
| F | Foxtrot | פסל | Town | העיירה | point | nobody | 2600 | 1760 |
| V | Victor | ואו | South gap | הפרצה הדרומית | point | nobody | 2600 | 2140 |
| S | Sierra | סמך | Lake rig | אסדת האגם | seaRig | nobody | 2600 | 2600 |

## Gushers and gold fields

| at point | x | y | gold per second | field radius | field cap | gold at start |
|---|---|---|---|---|---|---|
| A | 720 | 1690 | 12 | 90 | 1500 | 1000 |
| Z | 4480 | 1690 | 12 | 90 | 1500 | 1000 |
| B | 800 | 760 | 12 | 90 | 1500 | 1000 |
| K | 4400 | 760 | 12 | 90 | 1500 | 1000 |
| D | 760 | 2800 | 8 | 70 | 1000 | 600 |
| H | 4440 | 2800 | 8 | 70 | 1000 | 600 |
| G | 2600 | 960 | 18 | 70 | 2400 | 1000 |
| F | 2600 | 1760 | 18 | 70 | 2400 | 1000 |

## Bridges

| id | English | Hebrew | from | to | width | hp |
|---|---|---|---|---|---|---|
| `bridge-far-west` | the far west bridge | הגשר המערבי הרחוק | 560, 2280 | 560, 2400 | 80 | 900 |
| `bridge-far-east` | the far east bridge | הגשר המזרחי הרחוק | 4640, 2280 | 4640, 2400 | 80 | 900 |
| `bridge-west` | the west bridge | הגשר המערבי | 1720, 2280 | 1720, 2400 | 80 | 900 |
| `bridge-east` | the east bridge | הגשר המזרחי | 3480, 2280 | 3480, 2400 | 80 | 900 |

## Tech buildings

| id | kind | English | Hebrew | x | y |
|---|---|---|---|---|---|
| `tech-assay-w` | `tech_goldworks` | the assay office north-east of Tango | בית הבוחן מצפון-מזרח לתמר | 2180 | 400 |
| `tech-assay-e` | `tech_goldworks` | the assay office north-west of Yankee | בית הבוחן מצפון-מערב ליואב | 3020 | 400 |
| `tech-clinic-w` | `tech_clinic` | the clinic east of Lima | המרפאה ממזרח ללאה | 2200 | 1800 |
| `tech-clinic-e` | `tech_clinic` | the clinic west of Mike | המרפאה ממערב למשה | 3000 | 1800 |
| `tech-garage-w` | `tech_garage` | the service yard east of Delta | המוסך ממזרח לדוד | 1500 | 2720 |
| `tech-garage-e` | `tech_garage` | the service yard west of Hotel | המוסך ממערב להגר | 3700 | 2720 |

## Terrain and landmarks

- Terrain grid: 130 columns x 80 rows of 40-unit cells: 8906 land, 734 water, 580 mountain, 180 ice.
- Landmarks: 113 (5 bunker, 34 grove, 23 house, 27 rocks, 16 ruin, 8 wall). Each has an id such as `B-ruin-1` and a name in both languages such as "the ruin north-west of Bravo" / "החורבה מצפון-מערב לבועז".

## Related

- [[Game Overview]]
- [[Maps]]
- [[Map - Small]]
- [[Map - Medium]]
- [[Terrain, Cover and Bridges]]
- [[Map Point Letters]]
- [[Places on the Radio]]
- [[Tech Buildings]]
- [[Economy]]
