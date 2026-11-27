---
title: Superpowers
description: "Superpowers are planned and locked as a principle, but nothing of them is in the code."
type: concept
status: current
tags:
  - type/concept
  - status/current
  - agent/CLD
  - origin/mixed
  - area/game-design
  - topic/game-design
  - topic/superpowers
  - topic/not-built
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Decision - Economy]]"
  - "[[Structures and Build Tree]]"
  - "[[Game Design]]"
  - "[[Plan versus Code]]"
  - "[[Backlog]]"
  - "[[Open Questions]]"
paths:
  - CLAUDE.md
  - docs/PLAN.html
  - docs/specs/2026-11-24-bases-harvest-maps.md
  - docs/research/2026-11-24-classic-rts-play.md
  - shared/rules.json
---

# Superpowers

Superpowers are planned and locked as a principle, but nothing of them is in the code. This note records what is decided, what the plan proposed, and that the rules file, the simulation, the agents and the page contain no superpower.

## What is locked

`CLAUDE.md`, under Economy: "Superpowers unlock through the build tree plus gold, never by the clock." See [[Decision - Economy]].

## What the plan proposed

`docs/PLAN.html` (section Delta), as starting points, not final numbers:

| Faction | Superpower | Build chain | Building cost | Each launch | Effect |
|---|---|---|---|---|---|
| Aegis | Orbital Eye | HQ, Power plant, Radar, Satellite uplink | 2,500 gold | 1,000 gold, 4 minute recharge | reveals the whole map for 30 seconds and marks every enemy squad |
| Ashfall | Tunnel Surge | HQ, Barracks, Tunnel network, Deep tunnel complex | 2,000 gold | 800 gold, 4 minute recharge | moves three squads through the tunnels to any captured point at once |

The plan also has the enemy warned the moment a superpower building goes up, and puts superpowers in Phase 4 of the roadmap.

## What the code has

- A search of `server/`, `shared/`, `agents/` and `client/` finds no superpower: no structure role, no unit, no command, no radio cue.
- The bases spec lists superpowers as out of scope ("Superpowers remain out of scope here").
- The classic-RTS research note suggests "a lab-role structure as tier 3 when superpowers are built".
- The power plant and radar links of the Aegis chain exist as ordinary structures ([[Structures and Build Tree]]); the satellite uplink and both tunnel structures do not.

## Related

- [[Game Design]]
- [[Decision - Economy]]
- [[Plan versus Code]]
- [[Backlog]]
- [[Open Questions]]
