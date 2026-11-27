---
title: Power
description: "Every structure either supplies power or uses it, and a side that uses more than it supplies is on low power."
type: concept
status: current
tags:
  - type/concept
  - status/current
  - agent/CLD
  - origin/code
  - area/gameplay
  - topic/game-design
  - topic/power
  - topic/structures
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Base Cues]]"
  - "[[Enemy Bot]]"
  - "[[Rule Brain]]"
  - "[[Game Overview]]"
  - "[[Structures and Build Tree]]"
  - "[[Radar and Fog of War]]"
  - "[[Placement and Production Queues]]"
  - "[[Balance]]"
paths:
  - server/sim/power.go
  - server/sim/power_test.go
  - server/sim/queue.go
  - server/sim/structures.go
  - shared/rules.json
  - client/power.js
  - agents/power.mjs
---

# Power

Every structure either supplies power or uses it, and a side that uses more than it supplies is on low power. Low power halves the speed of building and deploying, silences defences and turns the radar off.

## Supply and use

`powerOf` in `server/sim/power.go` adds up a side's standing structures. The headquarters is a map point, so its share comes from its rules entry.

| Structure role | Aegis | Ashfall |
|---|---|---|
| headquarters | +30 | +30 |
| power | +100 (Power Plant, cost 140) | +100 (Generator Yard, cost 130) |
| barracks | -10 | -10 |
| refinery | -15 | -15 |
| works | -20 | -20 |
| radar | -20 | -20 |
| dockyard | -15 | -15 |
| airbase | -20 | -20 |
| each defence | -10 | -10 |
| fence | 0 | 0 |

A structure counts only while it stands (built and not destroyed). A side may have 3 power structures (`match.powerStructures`).

## What low power does

| Effect | Code |
|---|---|
| Construction and deployment advance on half the ticks (`match.lowPowerFactor` = 0.5, carried as a debt so the half is exact) | `powerStep`, read in `construct` and `deploy` |
| Defences do not fire | `defencesFire` skips a defence that is not `powered` |
| The radar gives no mini map | `Radar` |
| One event when it starts (`low_power`, with how much is missing) and one when it ends (`power_restored`, with how much is to spare) | `powerStep` |

`powered(st)` is false for any structure that uses power on a side that is short. The page shows supply and use (on a phone, a bolt and two numbers) from the snapshot's `PowerView {supply, use, low}`, and Anvil announces the two events as [[Base Cues]].

## The opening follows power

`NextInOpening` gives the role a base should grow by next, following `match.opening` (power, refinery, barracks, works, radar, airbase), but puts power first whenever the next structure would leave the side short. The scripted enemy and an operator holding the purse both build by it ([[Enemy Bot]], [[Rule Brain]]).

## History

Power came in the third wave of the bases spec (addendum 3, commit `327ba88`, 2026-11-24). The Power Plant's cost was tuned to 140 to keep the factions even on all three maps (commit `b8d0d5d`).

## Related

- [[Game Overview]]
- [[Structures and Build Tree]]
- [[Radar and Fog of War]]
- [[Placement and Production Queues]]
- [[Base Cues]]
- [[Balance]]
