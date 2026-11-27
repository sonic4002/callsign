---
title: Match Rules and Winning
description: "A match is two sides, west (side 0) and east (side 1), each with a headquarters, played on one of three maps until a headquarters falls or the timer runs out."
type: concept
status: current
tags:
  - type/concept
  - status/current
  - agent/CLD
  - origin/mixed
  - area/gameplay
  - topic/game-design
  - topic/match
  - topic/rules
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Sound, Music and Effects]]"
  - "[[Maps]]"
  - "[[Rooms, Hub and Lobby]]"
  - "[[Lobby Page]]"
  - "[[Net Language]]"
  - "[[Game Overview]]"
  - "[[Economy]]"
  - "[[Structures and Build Tree]]"
  - "[[Enemy Bot]]"
  - "[[Sim Loop and Determinism]]"
paths:
  - server/sim/sim.go
  - server/sim/command.go
  - server/room/hub.go
  - shared/rules.json
  - docs/FRIEND-MATCH.md
---

# Match Rules and Winning

A match is two sides, west (side 0) and east (side 1), each with a headquarters, played on one of three maps until a headquarters falls or the timer runs out. This note gives the opening state, the standing limits and the exact order in which a winner is decided.

## How a match opens

| Thing | Value |
|---|---|
| Headquarters | 3,000 hp, armor 0.5 (`hq.hp`, the faction's `hq` structure); at Alpha (west) and Zulu (east) |
| Structures | the headquarters alone (`match.startStructures` is empty) |
| Squads | the faction's `startUnits`: two commando squads (Aegis) or two militia cells (Ashfall) |
| Gold | 1,000 by default; the lobby offers 1,000 / 2,500 / 5,000 / 10,000 or a typed 400 to 20,000 |
| Brain tier | every squad at tier 1 |

The opening the game teaches and its scripted players follow is power, refinery (which brings the first hauler), barracks, then works, radar, airbase (`match.opening`). Until commit `7e3823d` (2026-11-24) a match started with more than the headquarters.

## Standing limits

| Limit | Value |
|---|---|
| Squads per side, living or deploying (`match.populationCap`) | 12 |
| Haulers per side (`match.haulerCap`) | 4, not counted as squads |
| Heroes alive per side | 1 |
| Base structures / power structures / defences / fence runs | 10 / 3 / 6 / 4 |
| Units waiting at one structure | 5 |
| Tick rate | 10 ticks a second |

## Capturing points

`capture` in `server/sim/sim.go`: a side alone on a point, with a unit of a class that may take it and that is not `noCapture`, within 70 of it (`match.captureRadius`), for 10 seconds (`match.captureSeconds`) takes it. With both sides present the count freezes. Leaving resets it.

| Point kind | Taken by | Pays |
|---|---|---|
| `hq` | nobody | - |
| `landRig` | infantry | 0 |
| `point` | infantry, vehicle | 0 |
| `seaRig` | naval, air | 30 gold a second |

A held point gives sight to 220 and ground to build defences on. A squad ordered to hold stands within `match.holdRadius` = 45 of its post.

## How it ends

`checkEnd` in `server/sim/sim.go`, each tick:

1. Both headquarters at zero: a draw (reason `hq_destroyed`).
2. One headquarters at zero: the other side wins (`hq_destroyed`).
3. The timer runs out:
   1. the side holding more points wins (`timer`);
   2. level on points, the headquarters healthier by more than 1% of full health wins (`timer_hq`);
   3. level there too, the side that destroyed more of the other's, counted in gold, wins (`timer_force`);
   4. otherwise a draw (`timer`).

"Destroyed" (`Side.Destroyed`) counts fallen soldiers and vehicles at their share of the squad's cost, and structures at theirs. The two tie-breaks were added with the bigger maps so that matches are decided instead of drawn (commit `effe887`).

When the match ends Anvil signs off with the result (`radio.signOff`: won, lost, draw) and the page drops all waiting radio; a fallen headquarters is shown as a finale ([[Sound, Music and Effects]]).

## Length and speed

| Setting | Values |
|---|---|
| Default length | the map's: 15, 20 or 25 minutes ([[Maps]]); `match.lengthSeconds` = 600 applies only where a map sets none |
| Chosen length | 120 to 1800 seconds |
| Speed | relaxed (0.75), normal (1), fast (1.5): real time per tick only |
| Lesson | 1800 seconds, no spectators, the small map |

## Options when making a match

`Options` in `server/room/hub.go`: opponent (scripted enemy or a friend), side, length, whether others may watch, the enemy's level, speed, whether the operators hold the purse from the start, the map, starting gold, the rule-brain Anvil's initiative (1 to 3) and whether squads use the fast brain. See [[Rooms, Hub and Lobby]] and [[Lobby Page]].

## After the match

Either player can press Play again; the rematch starts when both are ready. A rematch uses a new seed (`Seed + match number` in `server/room/room.go`).

## Differs from the plan

`docs/PLAN.html` says matches of 10, 15 or 20 minutes "or until one HQ falls", a room option to play without an operator, and a radio language option. In the code a match always has a timer, every side has an operator, and the net follows the language Hammer last used ([[Net Language]]).

## Related

- [[Game Overview]]
- [[Maps]]
- [[Economy]]
- [[Structures and Build Tree]]
- [[Rooms, Hub and Lobby]]
- [[Enemy Bot]]
- [[Sim Loop and Determinism]]
