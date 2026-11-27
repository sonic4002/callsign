---
title: Terrain, Cover and Bridges
description: "A map is a grid of terrain cells with landmarks standing on it and bridges across its water."
type: concept
status: current
tags:
  - type/concept
  - status/current
  - agent/CLD
  - origin/mixed
  - area/gameplay
  - topic/game-design
  - topic/terrain
  - topic/cover
  - topic/bridges
  - topic/landmarks
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Navigation]]"
  - "[[Fireteams and Nerve]]"
  - "[[Maps]]"
  - "[[Heroes]]"
  - "[[Known Flaws]]"
  - "[[Bodies and Collision]]"
  - "[[Game Overview]]"
  - "[[Places on the Radio]]"
  - "[[Radar and Fog of War]]"
paths:
  - shared/rules.json
  - shared/rules.go
  - server/sim/landmarks.go
  - server/sim/bridges.go
  - server/sim/fortify.go
  - server/sim/crush.go
  - server/sim/sim.go
  - docs/specs/2026-11-24-bases-harvest-maps.md
---

# Terrain, Cover and Bridges

A map is a grid of terrain cells with landmarks standing on it and bridges across its water. Landmarks give fireteams cover, buildings can be garrisoned, squads can dig sandbag positions, and bridges can be shot down, mined and mended.

## Terrain kinds

`terrainKinds` in `shared/rules.json`; one letter per 40-unit cell.

| Letter | Name | Land units | Boats | Speed | Notes |
|---|---|---|---|---|---|
| L | land | yes | no | x 1 | the only ground that can be built on |
| W | water | no | yes | x 1 | a standing bridge's deck counts as ground |
| I | ice | yes | no | x 0.6 | `noCover`: nothing standing on it is in cover |
| M | mountain | no | no | x 1 | off the map also counts as mountain (`TerrainAt`) |

Aircraft move over everything (domain `air`). See [[Navigation]] for how paths are found.

## Landmarks and cover

`landmarkKinds`: `cover` multiplies the chance of a hit on a fireteam behind the landmark (lower is better cover), within `coverRadius`.

| Kind | English / Hebrew | Cover | Radius | Garrison (teams) | Cover inside | hp | Size |
|---|---|---|---|---|---|---|---|
| `house` | house / בית | 0.75 | 46 | 4 | 0.6 | 600 | 40 |
| `bunker` | bunker / בונקר | 0.7 | 44 | 4 | 0.5 | 1,200 | 40 |
| `ruin` | ruin / חורבה | 0.75 | 44 | 3 | 0.7 | 260 | 40 |
| `grove` | grove / חורשה | 0.75 | 56 | - | - | - | - |
| `rocks` | rocks / סלעים | 0.7 | 42 | - | - | - | - |
| `wall` | wall / חומה | 0.7 | 42 | - | - | - | - |
| `rubble` | rubble / הריסות | 0.8 | 42 | - | - | - | - |
| `sandbags` | sandbags / שקי חול | 0.55 | 34 | - | - | 260 | arc 130 degrees |
| `sandbagsFlat` | flattened sandbags / שקי חול הרוסים | 1 (none) | 0 | - | - | - | - |

How cover works (`coverAgainst`, `canUseCover`):

- Behind a landmark, cover works against shooters on the far side, and from any side for a team right in the middle of it. Inside a building it is all round.
- Only a team on foot, standing still, on ground that offers cover benefits.
- A team ordered to hold takes the cover its post offers without being told, going up to `match.coverSeek` = 64 from its post; a squad sent to a landmark uses that one.
- A target that has chosen the `cover` action is hit half as often on top of this ([[Fireteams and Nerve]]).

## Garrisons

- A fireteam enters a building it is heading for when it comes within the entry radius; a building holds 3 or 4 teams of one side.
- A garrison is seen only from within 90 (`match.garrisonSight`) or after it fires.
- Half the damage aimed at a garrison also lands on the building (`match.garrisonDamageShare` = 0.5).
- When a building falls it becomes `rubble`, and whoever was inside is put out, shaken (event `building_fell`). Teams leave a building that is about to fall.

## Sandbags

`server/sim/fortify.go`: the `fortify` order tells an infantry squad to dig in where it stands. A squad at its post and not shot at digs for 6 seconds (`match.fortifySeconds`); the position faces the nearest enemy in sight, or else the nearest point the side does not hold, or else the enemy headquarters, and covers a 130 degree front. One squad may build 2 positions (`match.sandbagLimit`). Rifles do nothing to a position; heavy weapons knock it about, and a heavy vehicle flattens it.

## Crushing

`server/sim/crush.go`: a vehicle with `crushes` (the Aegis tank) that moves through enemy infantry in the open kills a man of a fireteam its path passes within 13 (`match.crushRadius`), at most one per team every 1.5 seconds (`match.crushSeconds`). Infantry step aside if they can; those in a building or other safe place are not run down. The owner is told once per pass (event `crushed`).

## Bridges

Every bridge is 80 wide with 900 hp ([[Maps]]). `bridgeRules`:

| Rule | Value | Meaning |
|---|---|---|
| `dangerShare` | 0.35 | below this share of its hit points, troops will not start across unless ordered to move |
| `standShare` | 0.5 | a fallen bridge stands again once repaired to this share |
| `repairRadius` | 70 | how close to an end a repairing fireteam must stand |
| `warnSeconds` | 15 | least time between two warnings about one bridge |

- Standing, the deck is ground; fallen, it is water until engineers bring it back.
- When a bridge collapses, every land unit on the deck is lost with it (`collapse`). Events: `bridge_under_attack`, `bridge_fell`, `bridge_repaired`.
- Squads ordered to repair a bridge mend it: each fireteam standing at an end, not shooting and not being shot at, adds its unit's `repairPerSecond` (engineers 40, sappers 30).
- A squad shoots a bridge from the bank (commit `1593f14`). The Sentinel can set a charge on one ([[Heroes]]), and a strike aircraft can bomb one.
- Two commits that made the room refuse attacks on a bridge without the commander's own order (`8e72697`, `dc4e4a8`) were both reverted the same evening (`fb7788d`, `a7521f8`). Whether agents avoid bridges is now only a matter of their prompts: see [[Known Flaws]].

## Bodies on a bridge

Bodies take room, and enemy bodies are kept a standoff apart, so one fireteam standing on a bridge holds it: see [[Bodies and Collision]].

## Related

- [[Game Overview]]
- [[Maps]]
- [[Navigation]]
- [[Bodies and Collision]]
- [[Fireteams and Nerve]]
- [[Places on the Radio]]
- [[Radar and Fog of War]]
