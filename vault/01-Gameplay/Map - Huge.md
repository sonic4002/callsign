---
title: Map - Huge
description: "Great Moat is the largest map: a river from edge to edge with a town on an island in its middle, 21 points and six bridges."
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
created: 2026-11-27
updated: 2026-11-27
agent: CLD
origin: code
confidence: medium
related:
  - "[[Game Overview]]"
  - "[[Maps]]"
  - "[[Map - Small]]"
  - "[[Map - Medium]]"
  - "[[Map - Large]]"
  - "[[Terrain, Cover and Bridges]]"
  - "[[Map Point Letters]]"
  - "[[Places on the Radio]]"
  - "[[Tech Buildings]]"
  - "[[Hints and Tidy Step]]"
paths:
  - shared/rules.json
  - tools/mapgen.py
  - shared/rules.go
  - server/sim/terrain_test.go
  - server/sim/crossing_test.go
  - client/voice/normalize.js
---

# Map - Huge

Great Moat is the largest map and the only one with 21 points, which is every letter a point may have ([[Map Point Letters]]). A river runs from the west edge to the east edge; in its middle it is the south side of a moat round an island with a town on it. All data below is the `maps.huge` block of `shared/rules.json`, which `tools/mapgen.py` writes (`make maps`); nothing in it is edited by hand. It was added on 2026-11-27.

## Size and clock

| field | value |
|---|---|
| name | Great Moat / החפיר הגדול |
| width x height (map units) | 6800 x 4200 |
| terrain cell | 40 |
| default match length | 1800 s (30 min) |
| pace (multiplier on all movement) | 2.5 |

The west side (side 0) holds Alpha, the east side (side 1) holds Zulu, 5920 apart. The map is drawn on its west half and mirrored, so neither side starts better. 30 minutes is the longest match the lobby accepts; the pace is set so that crossing the map takes about as long as on [[Map - Large]] (width over pace: 2720 against 2600).

## The ground

- **The river** runs along the whole map two thirds of the way down, with a harbour below each base for its dockyard. At each edge its mouth turns south to the sea, so boats sail from one base to the other round the south, and up the river into the moat.
- **The island** in the middle (1520 x 1200) has the town (Foxtrot) and the richest gold field. The moat is river on its south side, water on its west and east sides, and water frozen in the middle on its north side.
- **The north country** has a mountain range with one pass on each side (Quebec, Charlie), the glacier behind it (November), and the north road between the range and the moat, where the mine is (Golf).
- **The south country** lies between the river and the sea and is reached only over bridges. It has a poor field near each end (Delta, Hotel), an orchard with another (Oscar, Echo) and the lighthouse on the shore in the middle (Victor). The sea rig (Sierra) is off that shore.

## Routes between the headquarters

1. Straight through the island: the west bridge, the west gate (Whiskey), the town, the east gate (X-ray), the east bridge.
2. The north road between the range and the moat, past the mine. From it the island can be entered over the frozen moat with no bridge.
3. Behind the range, over the glacier: the longest and the slowest (ice), out of sight of the island.
4. Through the south country: the far west bridge by the base, along the shore past the lighthouse, and the far east bridge; or onto the island by its south-west and south-east bridges.

With every bridge down the bases are still joined by the north road, and with the ice gone they are still joined by land: the generator checks both.

## Points

| id | callsign EN | callsign HE | name EN | name HE | kind | owner at start | x | y |
|---|---|---|---|---|---|---|---|---|
| A | Alpha | אלף | West HQ | המפקדה המערבית | hq | side 0 (west) | 440 | 2160 |
| Z | Zulu | זאב | East HQ | המפקדה המזרחית | hq | side 1 (east) | 6360 | 2160 |
| B | Bravo | בועז | North-west field | השדה הצפון-מערבי | landRig | nobody | 900 | 880 |
| K | Kilo | כרמל | North-east field | השדה הצפון-מזרחי | landRig | nobody | 5900 | 880 |
| D | Delta | דוד | South-west field | השדה הדרום-מערבי | landRig | nobody | 900 | 3320 |
| H | Hotel | הגר | South-east field | השדה הדרום-מזרחי | landRig | nobody | 5900 | 3320 |
| L | Lima | לאה | West village | הכפר המערבי | point | nobody | 1720 | 2100 |
| M | Mike | משה | East village | הכפר המזרחי | point | nobody | 5080 | 2100 |
| T | Tango | תמר | West fort | המבצר המערבי | point | nobody | 1860 | 620 |
| Y | Yankee | יואב | East fort | המבצר המזרחי | point | nobody | 4940 | 620 |
| Q | Quebec | קורח | West pass | המעבר המערבי | point | nobody | 2700 | 660 |
| C | Charlie | צפורה | East pass | המעבר המזרחי | point | nobody | 4100 | 660 |
| O | Oscar | עין | West orchard | הפרדס המערבי | point | nobody | 2140 | 3320 |
| E | Echo | חוה | East orchard | הפרדס המזרחי | point | nobody | 4660 | 3320 |
| W | Whiskey | שמיר | West gate | השער המערבי | point | nobody | 2860 | 1960 |
| X | X-ray | טיח | East gate | השער המזרחי | point | nobody | 3940 | 1960 |
| N | November | נשר | Glacier | הקרחון | point | nobody | 3400 | 160 |
| G | Golf | גימל | Mine | המכרה | point | nobody | 3400 | 1040 |
| F | Foxtrot | פסל | Town | העיירה | point | nobody | 3400 | 1960 |
| V | Victor | ואו | Lighthouse | המגדלור | point | nobody | 3400 | 3560 |
| S | Sierra | סמך | Sea rig | האסדה הימית | seaRig | nobody | 3400 | 4020 |

Eight pairs mirror each other (A/Z, B/K, D/H, L/M, T/Y, Q/C, O/E, W/X) and five points stand on the middle line (N, G, F, V, S). X-ray is also found when written "xray" or "x ray".

## Gushers and gold fields

| at point | x | y | gold per second | field radius | field cap | gold at start |
|---|---|---|---|---|---|---|
| A | 800 | 1980 | 12 | 90 | 1500 | 1000 |
| Z | 6000 | 1980 | 12 | 90 | 1500 | 1000 |
| B | 900 | 880 | 12 | 90 | 1500 | 1000 |
| K | 5900 | 880 | 12 | 90 | 1500 | 1000 |
| D | 900 | 3320 | 8 | 70 | 1000 | 600 |
| H | 5900 | 3320 | 8 | 70 | 1000 | 600 |
| O | 2140 | 3320 | 8 | 70 | 1000 | 600 |
| E | 4660 | 3320 | 8 | 70 | 1000 | 600 |
| F | 3400 | 1960 | 18 | 70 | 2400 | 1000 |
| G | 3400 | 1040 | 18 | 70 | 2400 | 1000 |
| V | 3400 | 3560 | 18 | 70 | 2400 | 1000 |

11 gushers, 134 gold a second in all (the large map has 8 and 100): a home field by each headquarters and one up north (12 a second), two poor fields for each side in the south country (8), and three rich ones on the middle line (18): the town on the island, the mine on the north road and the lighthouse on the south shore.

## Bridges

| id | English | Hebrew | from | to | width | hp |
|---|---|---|---|---|---|---|
| `bridge-far-west` | the far west bridge | הגשר המערבי הרחוק | 1000, 2560 | 1000, 2680 | 80 | 900 |
| `bridge-far-east` | the far east bridge | הגשר המזרחי הרחוק | 5800, 2560 | 5800, 2680 | 80 | 900 |
| `bridge-west` | the west bridge | הגשר המערבי | 2520, 1960 | 2640, 1960 | 80 | 900 |
| `bridge-east` | the east bridge | הגשר המזרחי | 4280, 1960 | 4160, 1960 | 80 | 900 |
| `bridge-south-west` | the south-west bridge | הגשר הדרום-מערבי | 3000, 2560 | 3000, 2680 | 80 | 900 |
| `bridge-south-east` | the south-east bridge | הגשר הדרום-מזרחי | 3800, 2560 | 3800, 2680 | 80 | 900 |

## Tech buildings

| id | kind | English | Hebrew | x | y |
|---|---|---|---|---|---|
| `tech-assay-w` | `tech_goldworks` | the assay office north-west of Quebec | בית הבוחן מצפון-מערב לקורח | 2300 | 300 |
| `tech-assay-e` | `tech_goldworks` | the assay office north-east of Charlie | בית הבוחן מצפון-מזרח לצפורה | 4500 | 300 |
| `tech-clinic-w` | `tech_clinic` | the clinic east of Lima | המרפאה ממזרח ללאה | 2280 | 2060 |
| `tech-clinic-e` | `tech_clinic` | the clinic west of Mike | המרפאה ממערב למשה | 4520 | 2060 |
| `tech-garage-w` | `tech_garage` | the service yard east of Delta | המוסך ממזרח לדוד | 1500 | 3260 |
| `tech-garage-e` | `tech_garage` | the service yard west of Hotel | המוסך ממערב להגר | 5300 | 3260 |

## Terrain and landmarks

- Terrain grid: 170 columns x 105 rows of 40-unit cells: 13654 land, 2792 water, 1026 mountain, 378 ice.
- Landmarks: 205 (11 bunker, 60 grove, 47 house, 44 rocks, 26 ruin, 17 wall). Each has an id such as `Q-grove-1` and a name in both languages such as "the grove north of Quebec" / "החורשה מצפון לקורח".
- `python3 tools/mapgen.py --show` draws the map as text, with points, gushers, bridges, tech buildings and landmarks marked.

## What the tests play on it

- Every test that goes over the maps (`rules.MapIDs()`) covers it: terrain kinds and mirroring, the base layout, tech buildings, whole scripted matches with a determinism check, balance, the three enemy levels, bodies never overlapping, an army and boats crossing, haulers.
- `TestEverythingOnEveryMapIsMirrored` and `TestEveryPointCanBeReachedByWhatMayTakeItOnEveryMap` (`server/sim/terrain_test.go`) were added with it: every point, gusher, landmark, bridge and tech building has its mirror image, and each point is reached from both bases by each class that may take it.
- The crossings an army is marched through (`server/sim/crossing_test.go`): the west bridge, Golf, November and the far west bridge.
- In the suite's eight scripted matches (four seeds, each faction on each side) Aegis won four and Ashfall four, all on the clock. A whole match on it takes about ten seconds of test time.

## The six letters only this map uses

Quebec / קורח, Charlie / צפורה, Oscar / עין, Echo / חוה, Whiskey / שמיר, X-ray / טיח. Their names are short and lie close to ordinary words, which the tidy step had to be taught: see [[Map Point Letters]] and [[Hints and Tidy Step]].

## Related

- [[Game Overview]]
- [[Maps]]
- [[Map - Small]]
- [[Map - Medium]]
- [[Map - Large]]
- [[Terrain, Cover and Bridges]]
- [[Map Point Letters]]
- [[Places on the Radio]]
- [[Tech Buildings]]
- [[Hints and Tidy Step]]
- [[Economy]]
