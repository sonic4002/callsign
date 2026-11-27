---
title: Balance
description: "Balance between the two factions is measured by playing whole scripted matches headless: the scripted enemy on both sides, each pairing from both ends of the map, over many seeds."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/code
  - area/gameplay
  - topic/game-design
  - topic/balance
  - topic/testing
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Enemy Bot]]"
  - "[[Sim Loop and Determinism]]"
  - "[[Units - Aegis]]"
  - "[[Units - Ashfall]]"
  - "[[Structures and Build Tree]]"
  - "[[Game Overview]]"
  - "[[Tests and Headless Matches]]"
  - "[[Make Targets]]"
  - "[[Maps]]"
  - "[[Heroes]]"
paths:
  - server/sim/terrain_test.go
  - server/sim/sim_test.go
  - server/sim/tune_test.go
  - server/sim/heroes_tune_test.go
  - server/sim/cost_test.go
  - Makefile
  - shared/rules.json
---

# Balance

Balance between the two factions is measured by playing whole scripted matches headless: the scripted enemy on both sides, each pairing from both ends of the map, over many seeds. This note says how it is measured, what the limits are, and what the commit history records about the numbers; no fresh measurement was run for this note.

## How it is measured

| Tool | What it runs | Pass limit |
|---|---|---|
| `make test` (ordinary suite) | `TestFactionsAreRoughlyEvenOnEveryMap`: 4 seeds per pairing per map | no faction over 80% of the games on a map |
| `make balance` | the same test with `CALLSIGN_BALANCE=100` (`SEEDS` sets it): 200 scripted games per map, 100 seeds from each end; several minutes | no faction over 55% |
| `CALLSIGN_BALANCE_MAP=<id>` | limits the run to one map, while tuning | - |
| `TUNE=<games per orientation> go test -run TestTune -v` | a balance probe run by hand on the small map (`TUNE_FULL` starts with a full base) | none, it reports |
| `HEROES_TUNE=<seeds>` | the hero balance probe (`heroes_tune_test.go`) | none, it reports |
| `make cost` | with `CALLSIGN_COST=1`, on one core: the time of a tick and of the two snapshots a room sends, their size, and the gold an undisturbed base makes a minute with one, two and three haulers | none, it logs |

A small-map check of 8 seeds at a 75% limit also runs in `server/sim/sim_test.go`. The test logs, per map, the wins per faction, how many ended by a fallen headquarters, and how each match ended.

Both sides are played by the `standard` (relentless) scripted player; see [[Enemy Bot]]. Because a match is deterministic for a seed, a result can be replayed exactly ([[Sim Loop and Determinism]]).

## What the history records

| Date | Commit | Finding and change |
|---|---|---|
| 2026-11-23 | `d431fdb` | first balance of Aegis and Ashfall for scripted matches, with regression tests |
| 2026-11-24 | `63c303e` | after the new opening (headquarters alone): Ashfall's safehouse and smelter go up faster and cost less; 100:100 over 200 scripted games |
| 2026-11-24 | `effe887` | each map gets its own length and pace so medium and large matches are decided instead of drawn; militia health 41, accuracy 0.46 evens the small map over 200 games |
| 2026-11-24 | `b8d0d5d` | Power Plant costs 140: the factions stay even on all three maps |
| 2026-11-24 | `fea002b` | Ashfall's militia take 3.5 seconds to make |
| 2026-11-24 | `52b255d` | heroes, ranks and crushing tuned on 200 games on the small map: Aegis 96, Ashfall 104 |
| 2026-11-24 | `6de14c7` | with bodies taking room and the bigger maps, scripted matches went to Aegis about four in five on every map. Cost, body size, pace, economy and rifle range moved nothing; strength per squad did: militia damage 9 to 12 and hp 41 to 50, drone swarm hp 28 to 40, rocket team range 210 to 240, technical hp 290 to 330 and range 200 to 220. Result over 200 games a map: Aegis 54.5% on the small map, 54.0% on the medium |
| 2026-11-24 | `0902aab` | the large map went to Ashfall three times in four (Aegis 50, Ashfall 150). The map was changed, not the units: the range now ends above the town and the point Victor moves from the far south shore into the open gap south of it. Over 200 scripted games after the change: Aegis 103, Ashfall 97 |

So the last recorded figures are: small map Aegis 54.5%, medium 54.0% (`6de14c7`), large Aegis 103 to Ashfall 97 (`0902aab`). The strike aircraft (2026-11-26) do not move these numbers, because the scripted player does not buy them (`315ee23`).

## Things that are sensitive

- The hauler's unload spot: "Moving this spot moves the scripted balance a great deal: re-run the 200 games after touching it" (`unloadSpot` in `server/sim/haul.go`).
- Bodies and the bigger maps changed balance more than any stat change before them (`6de14c7`).
- Scripted balance is not balance between people or between language-model brains; nothing in the repository measures those.

## Where the numbers live

All unit, structure and match numbers are in `shared/rules.json` ([[Units - Aegis]], [[Units - Ashfall]], [[Structures and Build Tree]]). `docs/PLAN.html` called its own numbers "starting points for balancing, not final"; they have since changed.

## Related

- [[Game Overview]]
- [[Enemy Bot]]
- [[Tests and Headless Matches]]
- [[Make Targets]]
- [[Maps]]
- [[Heroes]]
- [[Known Flaws]]
