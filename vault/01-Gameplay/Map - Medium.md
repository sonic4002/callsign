---
title: Map - Medium
description: "Frozen Lake is the middle-sized map."
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
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Game Overview]]"
  - "[[Maps]]"
  - "[[Map - Small]]"
  - "[[Map - Large]]"
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

# Map - Medium

Frozen Lake is the middle-sized map. It has fifteen points, four bridges, a home gold field beside each headquarters and all three kinds of tech building. All data below is the `maps.medium` block of `shared/rules.json`, which `tools/mapgen.py` writes (`make maps`); nothing in it is edited by hand.

## Size and clock

| field | value |
|---|---|
| name | Frozen Lake / האגם הקפוא |
| width x height (map units) | 4000 x 2480 |
| terrain cell | 40 |
| default match length | 1200 s (20 min) |
| pace (multiplier on all movement) | 1.6 |

The west side (side 0) holds Alpha, the east side (side 1) holds Zulu. The map is drawn on its west half and mirrored, so neither side starts better.

## Points

| id | callsign EN | callsign HE | name EN | name HE | kind | owner at start | x | y |
|---|---|---|---|---|---|---|---|---|
| A | Alpha | אלף | West HQ | המפקדה המערבית | hq | side 0 (west) | 360 | 1480 |
| Z | Zulu | זאב | East HQ | המפקדה המזרחית | hq | side 1 (east) | 3640 | 1480 |
| B | Bravo | בועז | North-west field | השדה הצפון-מערבי | landRig | nobody | 460 | 760 |
| K | Kilo | כרמל | North-east field | השדה הצפון-מזרחי | landRig | nobody | 3540 | 760 |
| D | Delta | דוד | West farm | החווה המערבית | point | nobody | 860 | 1900 |
| H | Hotel | הגר | East farm | החווה המזרחית | point | nobody | 3140 | 1900 |
| L | Lima | לאה | West village | הכפר המערבי | point | nobody | 940 | 1480 |
| M | Mike | משה | East village | הכפר המזרחי | point | nobody | 3060 | 1480 |
| T | Tango | תמר | West fort | המבצר המערבי | point | nobody | 1000 | 380 |
| Y | Yankee | יואב | East fort | המבצר המזרחי | point | nobody | 3000 | 380 |
| N | November | נשר | Islet | האי הקטן | point | nobody | 2000 | 360 |
| G | Golf | גימל | Quarry | המחצבה | point | nobody | 2000 | 760 |
| F | Foxtrot | פסל | Town | העיירה | point | nobody | 2000 | 1480 |
| V | Victor | ואו | South shore | החוף הדרומי | point | nobody | 2000 | 1960 |
| S | Sierra | סמך | Sea rig | האסדה הימית | seaRig | nobody | 2000 | 2320 |

## Gushers and gold fields

| at point | x | y | gold per second | field radius | field cap | gold at start |
|---|---|---|---|---|---|---|
| A | 700 | 1250 | 12 | 90 | 1500 | 1000 |
| Z | 3300 | 1250 | 12 | 90 | 1500 | 1000 |
| B | 460 | 760 | 12 | 90 | 1500 | 1000 |
| K | 3540 | 760 | 12 | 90 | 1500 | 1000 |
| D | 860 | 1900 | 8 | 70 | 1000 | 600 |
| H | 3140 | 1900 | 8 | 70 | 1000 | 600 |
| G | 2000 | 760 | 18 | 70 | 2400 | 1000 |
| F | 2000 | 1480 | 18 | 70 | 2400 | 1000 |

## Bridges

| id | English | Hebrew | from | to | width | hp |
|---|---|---|---|---|---|---|
| `bridge-north-west` | the north-west bridge | הגשר הצפון-מערבי | 1280, 800 | 1400, 800 | 80 | 900 |
| `bridge-north-east` | the north-east bridge | הגשר הצפון-מזרחי | 2720, 800 | 2600, 800 | 80 | 900 |
| `bridge-west` | the west bridge | הגשר המערבי | 1160, 1480 | 1280, 1480 | 80 | 900 |
| `bridge-east` | the east bridge | הגשר המזרחי | 2840, 1480 | 2720, 1480 | 80 | 900 |

## Tech buildings

| id | kind | English | Hebrew | x | y |
|---|---|---|---|---|---|
| `tech-assay-w` | `tech_goldworks` | the assay office south-east of Tango | בית הבוחן מדרום-מזרח לתמר | 1120 | 640 |
| `tech-assay-e` | `tech_goldworks` | the assay office south-west of Yankee | בית הבוחן מדרום-מערב ליואב | 2880 | 640 |
| `tech-clinic-w` | `tech_clinic` | the clinic north-west of Foxtrot | המרפאה מצפון-מערב לפסל | 1640 | 1320 |
| `tech-clinic-e` | `tech_clinic` | the clinic north-east of Foxtrot | המרפאה מצפון-מזרח לפסל | 2360 | 1320 |
| `tech-garage-w` | `tech_garage` | the service yard south-east of Delta | המוסך מדרום-מזרח לדוד | 1000 | 1960 |
| `tech-garage-e` | `tech_garage` | the service yard south-west of Hotel | המוסך מדרום-מערב להגר | 3000 | 1960 |

## Terrain and landmarks

- Terrain grid: 100 columns x 62 rows of 40-unit cells: 4110 land, 1290 water, 448 ice, 352 mountain.
- Landmarks: 90 (6 bunker, 26 grove, 17 house, 22 rocks, 9 ruin, 10 wall). Each has an id such as `T-ruin-1` and a name in both languages such as "the ruin west of Tango" / "החורבה ממערב לתמר".

## Related

- [[Game Overview]]
- [[Maps]]
- [[Map - Small]]
- [[Map - Large]]
- [[Terrain, Cover and Bridges]]
- [[Map Point Letters]]
- [[Places on the Radio]]
- [[Tech Buildings]]
- [[Economy]]
