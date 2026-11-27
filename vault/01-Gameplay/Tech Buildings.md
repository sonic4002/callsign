---
title: Tech Buildings
description: "Tech buildings belong to no army and stand on the map from the start; whichever side's engineers take one gets what it gives."
type: concept
status: current
tags:
  - type/concept
  - status/current
  - agent/CLD
  - origin/code
  - area/gameplay
  - topic/game-design
  - topic/tech-buildings
  - topic/structures
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Places on the Radio]]"
  - "[[Structures and Build Tree]]"
  - "[[Map - Small]]"
  - "[[Map - Medium]]"
  - "[[Map - Large]]"
  - "[[Game Overview]]"
  - "[[Economy]]"
  - "[[Maps]]"
  - "[[Units - Aegis]]"
  - "[[Units - Ashfall]]"
paths:
  - shared/rules.json
  - shared/structures.go
  - server/sim/tech.go
  - server/sim/tech_test.go
  - tools/mapgen.py
---

# Tech Buildings

Tech buildings belong to no army and stand on the map from the start; whichever side's engineers take one gets what it gives. There are three kinds: one pays gold, one heals infantry, one repairs vehicles (commit `a9bb5cf`, 2026-11-24).

## The three kinds

`techBuildings` in `shared/rules.json`:

| id | English | Hebrew | Effect | Numbers | hp | armor | footprint | sight |
|---|---|---|---|---|---|---|---|---|
| `tech_goldworks` | Assay Office | בית הבוחן | gold | 250 once to each side that takes it (`lump`), then 3 a second while held (`incomePerSecond`) | 900 | 0.35 | 42 | 160 |
| `tech_clinic` | Field Clinic | מרפאת השדה | heal | 4 hit points a second to each infantry fireteam of the holder within 130 | 700 | 0.25 | 44 | 160 |
| `tech_garage` | Service Yard | מוסך השדה | repair | 14 hit points a second to each vehicle of the holder within 140, haulers among them | 800 | 0.35 | 46 | 160 |

Each has a short description in both languages (`about`) and spoken aliases in both ("the mint", "המרפאה", "garage" ...), which the radio's place matching uses ([[Places on the Radio]]).

## How one is taken and held

- Only engineers take them (Combat engineers, Sappers): the capture order, standing beside it, not under fire, for the unit's `captureSeconds` (8 or 6). The squad stays inside and is gone ([[Structures and Build Tree]]).
- The lump of gold is paid once to each side over a match (`techTaken`).
- The side that held it is told when it changes hands (event `tech_lost`). A side that neither held nor took it learns of the change only by seeing it.
- The effect is given each tick while the building stands and is held (`techWork`). Healing and repairs wait for quiet (the nerve quiet time of 2 seconds).
- A tech building has hit points and armor like any structure, but fireteams looking for a structure to shoot on their own skip it (`structureTarget` in `server/sim/structures.go`; commit `4362fc7`: "a building of no army draws no stray fire").
- It is not own ground for building: `ownGround` skips tech buildings.

## Where they are

| Map | Assay Office | Field Clinic | Service Yard |
|---|---|---|---|
| Small (Twin Bridges) | 2 (west and east of Golf) | 2 (west of Delta, east of Hotel) | none |
| Medium (Frozen Lake) | 2 | 2 | 2 |
| Large (Mountain Passes) | 2 | 2 | 2 |

They are mirrored west and east. Positions are in [[Map - Small]], [[Map - Medium]], [[Map - Large]]. On the map and the radio they are called by name, for example "the clinic west of Delta" / "המרפאה ממערב לדוד".

## Related

- [[Game Overview]]
- [[Structures and Build Tree]]
- [[Economy]]
- [[Maps]]
- [[Places on the Radio]]
- [[Units - Aegis]]
- [[Units - Ashfall]]
