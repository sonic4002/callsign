---
title: Radar and Fog of War
description: "The server keeps, for each side, the ground it has ever seen and what it last knew of points, landmarks, bridges, structures, fields and enemy haulers; a side is only ever sent that."
type: concept
status: current
tags:
  - type/concept
  - status/current
  - agent/CLD
  - origin/code
  - area/gameplay
  - topic/game-design
  - topic/fog
  - topic/radar
  - topic/sight
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Places on the Radio]]"
  - "[[Seats, Tokens and Trust]]"
  - "[[Map Rendering]]"
  - "[[Structures and Build Tree]]"
  - "[[Heroes]]"
  - "[[Game Overview]]"
  - "[[Power]]"
  - "[[Sim Loop and Determinism]]"
  - "[[Terrain, Cover and Bridges]]"
paths:
  - server/sim/fog.go
  - server/sim/view.go
  - server/sim/power.go
  - server/sim/sim.go
  - server/sim/hero.go
  - shared/rules.json
  - client/fog.js
---

# Radar and Fog of War

The server keeps, for each side, the ground it has ever seen and what it last knew of points, landmarks, bridges, structures, fields and enemy haulers; a side is only ever sent that. The radar structure is separate from sight: it turns the commander's mini map on and is a step in the build tree.

## What a side sees

`InSight` is true for a position within sight of the side's headquarters, a point it holds, any of its living teams, or (through `structureSees`) its standing structures.

| Source of sight | Radius |
|---|---|
| Headquarters | 300 (`hq.sight`) |
| A point the side holds | 220 (`match.pointSight`) |
| A unit | its `sight` (170 for haulers up to 320 for the helicopter and the Sentinel) |
| A structure | its `sight` (180 for most, 260 radar, about 300 to 320 defences) |

`spot` in `server/sim/sim.go` decides which enemy teams are seen:

- A team that has fired is given away for 3 seconds (`match.revealSeconds`).
- A team inside a building is seen only from within 90 (`match.garrisonSight`), or after it fires.
- A stealthy unit (the Sentinel, `stealth` 95) is seen only from that close until it fires; a defence sees it at its range (`defenceSees`).
- A disguised unit (the Oracle, `disguise` 85) is not fired on from farther than that until it fires.

Enemy squads in sight are named Target N / מטרה N on the map and in orders ([[Places on the Radio]]).

## What a side remembers

Fog is a grid of 40-unit cells (`FogCell`). `reveal` marks every cell whose centre lies within a sight radius as explored, for good. The snapshot carries the explored grid as a bitset (`FogView`), and "last seen" memories:

| Thing | Memory |
|---|---|
| Map points | owner as last seen; a side always knows a point it holds, and so learns when it is lost |
| Enemy headquarters | health 0 to 1 as last seen |
| Landmarks and bridges | state as last seen; who is inside a building only from close by or when they fire |
| Enemy structures | as last seen (`structMemory`) |
| Gold fields | gold as last seen, and whether the side has seen the field at all |
| Enemy haulers | as last seen |

Events never carry what a side cannot see (`Event` in `server/sim/command.go`). Spectators see everything, and are let in only when the match's maker allows watching ([[Seats, Tokens and Trust]]).

The page draws three states from this: never seen, seen before, in sight now ([[Map Rendering]]).

## Radar

`Sim.Radar(side)` is true when a radar structure of the side stands and the side is not on low power. The snapshot's `radar` flag tells the page whether the mini map is on.

| | Aegis | Ashfall |
|---|---|---|
| Structure | Radar Station / תחנת מכ״ם | Listening Post / עמדת ההאזנה |
| Cost | 280 | 280 |
| Requires | works | works |
| Power | -20 | -20 |
| Sight | 260 | 260 |

Besides the mini map, the radar role is what the airbase `requires` and one of the two extra roles a hero `needs` ([[Structures and Build Tree]], [[Heroes]]). The radar does not widen sight beyond its own 260.

## Related

- [[Game Overview]]
- [[Power]]
- [[Structures and Build Tree]]
- [[Heroes]]
- [[Map Rendering]]
- [[Sim Loop and Determinism]]
- [[Terrain, Cover and Bridges]]
