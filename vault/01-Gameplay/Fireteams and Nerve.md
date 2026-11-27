---
title: Fireteams and Nerve
description: "A squad is made of fireteams, and every fireteam is moved and fought by plain utility AI on the server, with no language model."
type: concept
status: current
tags:
  - type/concept
  - status/current
  - agent/CLD
  - origin/mixed
  - area/gameplay
  - topic/game-design
  - topic/fireteams
  - topic/nerve
  - topic/ai
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Terrain, Cover and Bridges]]"
  - "[[Agent Tools]]"
  - "[[Ranks and Brain Tiers]]"
  - "[[Heroes]]"
  - "[[Agent Loop]]"
  - "[[Report Suppression]]"
  - "[[Decision - Fireteams]]"
  - "[[Game Overview]]"
  - "[[Sim Loop and Determinism]]"
  - "[[Bodies and Collision]]"
paths:
  - server/sim/ai.go
  - server/sim/sim.go
  - shared/rules.json
  - CLAUDE.md
---

# Fireteams and Nerve

A squad is made of fireteams, and every fireteam is moved and fought by plain utility AI on the server, with no language model. Each team carries one stress number that the game reads as three nerve states (steady, shaken, pinned), which are shown through behaviour and radio reports and never as a bar.

## The utility AI

`decide` in `server/sim/ai.go` scores four options for each team every tick from what the team can sense, and the best score wins. The squad's order sets what the team is trying to do; nerve changes how well it does it.

| Option | Base | Adjustments |
|---|---|---|
| fire | 0.55 | +0.30 order is hold or attack; +0.20 no order (self-defence); -0.10 order is move; +0.15 target inside half range; -0.15 shaken; -0.90 pinned |
| advance | 0.50 | +0.40 order is move; +0.10 order is attack; +0.20 order is hold with no target; +0.40 order is hold and the point is still far; -0.10 under fire; -0.20 shaken (-0.30 more under fire); -0.70 pinned; -0.60 an enemy body blocks the way and there is something to shoot |
| cover | 0.20 | +0.25 under fire; +0.20 shaken; +0.60 pinned |
| fall back | 0.10 | +0.45 shaken and outnumbered; +0.60 an enemy inside the weapon's minimum range and nothing to shoot; +0.30 under fire with nothing in range and nowhere to go |

The actions a team can be seen doing are `idle`, `fire`, `advance`, `cover`, `fallback` and `repair`. Cover is part of where a team goes: a team ordered to hold takes the cover its post offers (inside a building with room, or behind a grove, rocks or a wall) and leaves a building that is about to fall. See [[Terrain, Cover and Bridges]].

## Orders a squad can hold

`none`, `move`, `hold`, `attack`, `repair`, plus `capture` (engineers), `fortify` (dig in), `plant` and `seize` (heroes) and `return` (strike aircraft). They are set only through `Sim.Apply`; see [[Agent Tools]] for who may give which.

## Nerve

Stress runs from 0 to 1. `Sim.Nerve` reads it as:

| State | Stress | Effect in code |
|---|---|---|
| steady | below 0.35 | none |
| shaken | 0.35 and up (`nerve.shakenAt`) | weapon cooldown x 8/5; chance to hit x 0.75; the score changes above |
| pinned | 0.70 and up (`nerve.pinnedAt`) | the score changes above: it all but stops firing and advancing and seeks cover |

What moves stress (`nerve` in `shared/rules.json`, applied in `resolveDamage`, `teamLost` and `recover`):

| Event | Stress |
|---|---|
| a shot that misses the team | +0.005 |
| a shot that hits | +0.018 |
| a member lost | +0.15 |
| another team of the squad lost | +0.25 to each surviving team |
| the squad kills an enemy team | -0.15 to each of its teams |
| quiet for more than 2 s | -0.04 per second, doubled within 80 units of a steady friendly team |

Gains are multiplied by the unit's `nerveResist` (lower shakes less) and by the squad's rank ([[Ranks and Brain Tiers]]). The Ashfall hero adds dread: stress per second on enemy teams near it ([[Heroes]]). Strike aircraft fly regardless of nerve.

## What the squad leader hears

The simulation raises events for the moments a leader should wake for (`squadEvents`): `contact`, `pinned`, `arrived`, `losses`, `squad_lost`, `captured`, `point_lost` and others listed in `server/sim/command.go`. The leader's brain turns them into radio reports; see [[Agent Loop]] and [[Report Suppression]].

## Differs from the plan

`docs/PLAN.html` lists ammo, health, weather and a personality per fireteam among the inputs, and says veterans shake less. In the code there is no ammo, no weather and no personality; ranks do reduce stress. Fatigue was dropped on purpose in the plan and is not in the code ([[Decision - Fireteams]]).

## Related

- [[Game Overview]]
- [[Decision - Fireteams]]
- [[Sim Loop and Determinism]]
- [[Terrain, Cover and Bridges]]
- [[Bodies and Collision]]
- [[Ranks and Brain Tiers]]
- [[Squad Leaders]]
