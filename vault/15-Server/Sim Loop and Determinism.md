---
title: Sim Loop and Determinism
description: "A match is one sim.Sim, advanced one tick at a time by Sim.Step() at 10 ticks per match second (tickRate in shared/rules.json)."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/code
  - area/server
  - topic/server
  - topic/sim
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Maps]]"
  - "[[Agent Tools]]"
  - "[[Direct Acts]]"
  - "[[Navigation]]"
  - "[[Bodies and Collision]]"
  - "[[Tests and Headless Matches]]"
  - "[[Server Architecture]]"
  - "[[Rooms, Hub and Lobby]]"
  - "[[WebSocket Frames]]"
  - "[[Sorties]]"
paths:
  - server/sim/sim.go
  - server/sim/command.go
  - server/sim/view.go
  - server/sim/fog.go
  - server/sim/ai.go
  - server/room/room.go
  - server/room/hub.go
  - server/cmd/callsign/main.go
  - shared/rules.json
---

# Sim Loop and Determinism

A match is one `sim.Sim`, advanced one tick at a time by `Sim.Step()` at 10 ticks per match second (`tickRate` in `shared/rules.json`). The same seed and the same commands at the same ticks replay the same match; real time only decides how fast the ticks come.

## The clock

| Thing | Value | Where |
|---|---|---|
| Ticks per match second | 10 | `tickRate` in `shared/rules.json` |
| Real time per tick, base | `1s / (tickRate * -speed)` | `main.go` (`-speed`, default 1) |
| Room speed `relaxed` | 0.75 match seconds per real second | `room.Speeds` in `hub.go` |
| Room speed `normal` | 1 | same |
| Room speed `fast` | 1.5 | same |
| Bot acts | once per match second (`Tick % TickRate == 0`) | `Room.Tick` |
| `state` frames | every second tick, and on the last one | `Room.Tick` |

`tickEvery(base, speed)` divides the base interval by the factor. Speed changes only real time per tick; the simulation is the same at every speed. Agents think in real time, so a faster match leaves them fewer ticks to react in (comment on `room.Speed`).

**Map pace** is a different thing: `maps.<id>.pace` in the rules multiplies how fast every unit moves on that map (`Sim.stride`, `Sim.fly`), so a bigger map is crossed in about the same time. Values: small 1.3, medium 1.6, large 2. The map also sets the default match length (900, 1200, 1500 seconds); see [[Maps]].

The clock of a room starts when `Room.started` becomes true: when every human seat is ready (rooms with seats), or when the first Hammer joins (the open room). Before that `Room.Tick` returns at once.

## One room tick (`Room.Tick`)

1. Nothing happens if the match has not started or is over.
2. On a whole match second, each scripted player (`bot.Player.Act`) reads its side's snapshot and its commands are applied.
3. `sim.Step()` runs; each returned event is sent to its side as an `event` frame (with `known: true` when another squad already reported the same thing), and passed to the base cues (`cueEvent`).
4. A lost squad's leader connection is dropped.
5. When the match ends: telemetry is forgotten, the operator signs off on each net, the lobby is re-sent.
6. Every second tick (and at the end) each client that asked for state gets its side's snapshot.

## One simulation tick (`Sim.Step`), in order

| # | Call | What it does |
|---|---|---|
| 1 | `powerStep` | each side's power supply and use |
| 2 | `deploy` | production lines count down; finished units come out |
| 3 | `construct` | structures under construction advance |
| 4 | `liveTeams`, `buildBodies` | list this tick's fireteams and file their bodies on the grid |
| 5 | `countGarrisons` | who is inside which building |
| 6 | `spot` | which teams the other side sees; each squad's contacts |
| 7 | `trackContacts`, `trackStructures`, `trackObjects` | attack orders follow their target or turn into a hold when it is gone |
| 8 | `heroOrders` | hero tasks |
| 9 | `sorties` | strike aircraft: arm, send out, turn home |
| 10 | `decide` for every team | the fireteam utility AI picks a plan |
| 11 | `startMoves`, then `move` for every team | one at a time; order reversed on odd ticks |
| 12 | `crush`, `enterBuildings`, `settle` | vehicles run men down; teams go inside; overlaps are resolved |
| 13 | `fire` for every team, `defencesFire`, `heroes`, `strikes` | shooting, defences, hero actions, bombs |
| 14 | `resolveSandbags`, `resolveDamage`, `resolveStructures`, `resolveBuildings`, `resolveBridges` | the tick's damage is applied all at once |
| 15 | `repairBridges`, `trackObjects`, `noteCover` | |
| 16 | `recover` | nerve recovers |
| 17 | `capture` | map points change hands |
| 18 | `engineers`, `techWork`, `repairStructures`, `haulWork`, `fortify`, `rankWork` | engineers, tech buildings, paid repairs, haulers, sandbags, ranks |
| 19 | `squadEvents`, `countGarrisons`, `observe` | events for the sides; fog and last-seen memory updated |
| 20 | `checkEnd`, `Tick++` | win conditions, then the tick number grows |

Events raised by commands between ticks are held in `s.events` and go out with the next `Step`, stamped with its tick.

## Commands

Everything that changes a match goes through `Sim.Apply(Command)` (or `Sim.Build` for structures): move, hold, attack, buy, upgrade, repair, sell, capture, build, haul, cancel, rally, fortify, plant, seize. Each is checked and either done in that call or refused with an error (`ErrNoGold`, `ErrPopCap`, `ErrNoContact`, `ErrUnreachable` and others in `command.go`). Nothing else writes to the simulation. The room decides *who* may send a command (roles, the purse; see [[Agent Tools]] and [[Direct Acts]]); the simulation decides whether the game allows it.

## What keeps it deterministic

- **One seeded generator.** `rand.New(rand.NewPCG(seed, seed ^ 0x9e3779b97f4a7c15))` in `sim.New`. It is drawn from in three places only: whether a shot hits (`sim.go`) and two hit rolls of defences (`structures.go`).
- **Fixed orders.** Squads are kept in the order they were raised; teams move one at a time in that order on even ticks and reversed on odd ticks, so neither side always wins a contested step. Structures are in id order.
- **No clock, no map iteration in the step.** The path search, the nearest-cell search and the body grid visit cells in fixed orders (see [[Navigation]], [[Bodies and Collision]]).
- **Gold is an integer** (`goldUnit`, gold times the tick rate), so income never drifts.
- **Seeds per room.** The hub gives the first room `-seed` and each later room the next number; a rematch in a room uses `Seed + match`.
- **`Sim.Hash()`** folds the whole state (tick, gold, headquarters health, fog, points, bridges, landmarks, squads, sorties and more) into one FNV-64a number. `TestSameSeedSameMatch` plays the same seed twice and compares the hash every second; see [[Tests and Headless Matches]].

The scripted enemy is part of the deterministic picture (it acts on snapshots at fixed ticks). Agents and people are not: their commands arrive in real time.

## Snapshots: what a side is sent

`Sim.Snapshot(side)` is the match as one side may see it:

| Part | Own side | Enemy |
|---|---|---|
| Squads | full `SquadView`: teams, nerve, action, cover, order, contacts, rank, hero, sortie | only as `ContactView`, only the teams in sight now; no nerve or action |
| Haulers | own listed | enemy ones in sight are contacts; otherwise as last seen |
| Points, bridges, landmarks, enemy headquarters health | as they are when in sight | as last seen (`pointMemory`, `bridgeMemory`, `landmarkMemory`) |
| Structures | own | as last seen |
| Gold, income, power, radar, opening, deploying squads | own only | never |
| Fog | `FogView`: a bitset of explored cells, `FogCell` = 40 map units | |
| Charges, blasts | own, and enemy ones in sight | |

`Snapshot(sim.Spectator)` (side -1) has no fog and shows everything; the room sends it only to connections with the `spectator` role. The room builds at most three `state` frames per broadcast (side 0, side 1, spectator) and reuses them.

A team is seen (`Sim.spot`) when an enemy team has it within its unit's `sight`, or a held point or post sees it, or it has fired within `match.revealSeconds` (3 s). Teams inside a building are seen only from `match.garrisonSight` (90) unless they fired; stealthy units only from their `stealth` distance or by a defence.

Events (`sim.Event`) are per side and "never carry what that side cannot see".

## How a match ends (`checkEnd`)

| Case | Winner | `Reason` |
|---|---|---|
| A headquarters at 0 health | the other side (both at once: draw) | `hq_destroyed` |
| Timer runs out, points differ | more map points held | `timer` |
| Level on points | healthier headquarters (by more than 1% of full) | `timer_hq` |
| Level there too | the side that destroyed more (in gold value) | `timer_force` |
| Still level | draw (`NoSide`) | `timer` |

## Related

- [[Server Architecture]]
- [[Rooms, Hub and Lobby]]
- [[WebSocket Frames]]
- [[Bodies and Collision]]
- [[Navigation]]
- [[Sorties]]
- [[Tests and Headless Matches]]
- [[Match Rules and Winning]]
- [[Radar and Fog of War]]
- [[Fireteams and Nerve]]
- [[Enemy Bot]]
