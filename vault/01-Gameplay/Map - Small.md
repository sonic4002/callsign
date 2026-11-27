---
title: Map - Small
description: "Twin Bridges is the smallest map and the default (shared.DefaultMap = 'small')."
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
  - "[[Map - Medium]]"
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

# Map - Small

Twin Bridges is the smallest map and the default (`shared.DefaultMap = "small"`). Two headquarters face each other across a river crossed by three bridges, with a frozen ford in the north and a sea rig in the south. All data below is the `maps.small` block of `shared/rules.json`, which `tools/mapgen.py` writes (`make maps`); nothing in it is edited by hand.

## Size and clock

| field | value |
|---|---|
| name | Twin Bridges / שני הגשרים |
| width x height (map units) | 2800 x 1760 |
| terrain cell | 40 |
| default match length | 900 s (15 min) |
| pace (multiplier on all movement) | 1.3 |

The west side (side 0) holds Alpha, the east side (side 1) holds Zulu. The map is drawn on its west half and mirrored, so neither side starts better.

## Points

| id | callsign EN | callsign HE | name EN | name HE | kind | owner at start | x | y |
|---|---|---|---|---|---|---|---|---|
| A | Alpha | אלף | West HQ | המפקדה המערבית | hq | side 0 (west) | 280 | 960 |
| Z | Zulu | זאב | East HQ | המפקדה המזרחית | hq | side 1 (east) | 2520 | 960 |
| B | Bravo | בועז | West field | השדה המערבי | landRig | nobody | 620 | 720 |
| K | Kilo | כרמל | East field | השדה המזרחי | landRig | nobody | 2180 | 720 |
| D | Delta | דוד | Ridge | הרכס | point | nobody | 900 | 1300 |
| H | Hotel | הגר | Farm | החווה | point | nobody | 1900 | 1300 |
| T | Tango | תמר | West quarry | המחצבה המערבית | point | nobody | 720 | 280 |
| N | November | נשר | East quarry | המחצבה המזרחית | point | nobody | 2080 | 280 |
| G | Golf | גימל | Frozen ford | המעבר הקפוא | point | nobody | 1400 | 340 |
| F | Foxtrot | פסל | Town | העיירה | point | nobody | 1400 | 900 |
| S | Sierra | סמך | Sea rig | האסדה הימית | seaRig | nobody | 1400 | 1640 |

## Gushers and gold fields

| at point | x | y | gold per second | field radius | field cap | gold at start |
|---|---|---|---|---|---|---|
| B | 620 | 720 | 12 | 90 | 1500 | 1000 |
| K | 2180 | 720 | 12 | 90 | 1500 | 1000 |
| D | 900 | 1300 | 8 | 70 | 1000 | 600 |
| H | 1900 | 1300 | 8 | 70 | 1000 | 600 |
| F | 1400 | 900 | 18 | 70 | 2400 | 1000 |

## Bridges

| id | English | Hebrew | from | to | width | hp |
|---|---|---|---|---|---|---|
| `bridge-west` | the west bridge | הגשר המערבי | 1160, 920 | 1280, 920 | 80 | 900 |
| `bridge-east` | the east bridge | הגשר המזרחי | 1640, 920 | 1520, 920 | 80 | 900 |
| `bridge-south` | the south bridge | הגשר הדרומי | 1320, 1360 | 1480, 1360 | 80 | 900 |

## Tech buildings

| id | kind | English | Hebrew | x | y |
|---|---|---|---|---|---|
| `tech-assay-w` | `tech_goldworks` | the assay office west of Golf | בית הבוחן ממערב לגימל | 1200 | 320 |
| `tech-assay-e` | `tech_goldworks` | the assay office east of Golf | בית הבוחן ממזרח לגימל | 1600 | 320 |
| `tech-clinic-w` | `tech_clinic` | the clinic west of Delta | המרפאה ממערב לדוד | 620 | 1370 |
| `tech-clinic-e` | `tech_clinic` | the clinic east of Hotel | המרפאה ממזרח להגר | 2180 | 1370 |

## Terrain and landmarks

- Terrain grid: 70 columns x 44 rows of 40-unit cells: 2202 land, 656 water, 166 mountain, 56 ice.
- Landmarks: 55 (4 bunker, 9 grove, 8 house, 18 rocks, 12 ruin, 4 wall). Each has an id such as `T-ruin-1` and a name in both languages such as "the ruin north of Tango" / "החורבה מצפון לתמר".

## Related

- [[Game Overview]]
- [[Maps]]
- [[Map - Medium]]
- [[Map - Large]]
- [[Terrain, Cover and Bridges]]
- [[Map Point Letters]]
- [[Places on the Radio]]
- [[Tech Buildings]]
- [[Economy]]
