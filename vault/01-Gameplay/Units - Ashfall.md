---
title: Units - Ashfall
description: "Every unit the Ashfall Network (רשת אפר) can field, with the numbers in shared/rules.json (factions.ashfall.units) as they are now."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/code
  - area/gameplay
  - topic/game-design
  - topic/units
  - topic/ashfall
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Fireteams and Nerve]]"
  - "[[Structures and Build Tree]]"
  - "[[Placement and Production Queues]]"
  - "[[Tech Buildings]]"
  - "[[Economy]]"
  - "[[Heroes]]"
  - "[[Strike Aircraft]]"
  - "[[Callsigns]]"
  - "[[Game Overview]]"
  - "[[Factions]]"
paths:
  - shared/rules.json
  - shared/rules.go
  - server/sim/sim.go
  - server/sim/command.go
---

# Units - Ashfall

Every unit the Ashfall Network (רשת אפר) can field, with the numbers in `shared/rules.json` (`factions.ashfall.units`) as they are now. A side starts a match with the squads listed in `startUnits`: `militia`, `militia`.

## How to read the numbers

- A squad is `teams` fireteams of `members` each; `hp` is per member. A vehicle, boat or aircraft is a team of one.
- `speed`, `range` and `sight` are in map units (a terrain cell is 40). Speed is per second, before the map's pace.
- `cooldown ticks` is the wait between shots; the server runs 10 ticks a second (`tickRate`).
- A shot hits with `accuracy` times the shooter's rank, cover, range fall-off (the last 40% of the range) and other factors in `fire` in `server/sim/sim.go`; a hit does `damage x vs[target class] x (1 - target armor x (1 - pierce))`.
- `vs` scales damage by target class (`infantry`, `vehicle`, `naval`, `air`, `hauler`), `hq`, `structure` and `fence`. A class not listed takes full damage; 0 means the unit cannot engage it at all.
- `nerveResist` multiplies the stress the unit takes; lower shakes less. See [[Fireteams and Nerve]].
- "made by" is the role of the structure that must stand; see [[Structures and Build Tree]]. Units queue at that structure: [[Placement and Production Queues]].
- Cost is gold. The squad population cap is 12 squads a side (`match.populationCap`); haulers have their own cap of 4 (`match.haulerCap`).

## Table

| id | English | Hebrew | class | made by (role) | cost | deploy s | teams x members | hp per member | armor |
|---|---|---|---|---|---|---|---|---|---|
| `sappers` | Sappers | חבלנים | infantry | barracks | 130 | 3 | 1 x 4 | 36 | 0 |
| `militia` | Militia cell | חוליית מיליציה | infantry | barracks | 100 | 3.5 | 4 x 3 | 50 | 0 |
| `technical` | Technical | טנדר חמוש | vehicle | works | 250 | 3.5 | 3 x 1 | 330 | 0.25 |
| `speedboat` | Speedboat | סירה מהירה | naval | dockyard | 250 | 4 | 3 x 1 | 190 | 0.1 |
| `fpvSwarm` | Drone swarm | נחיל רחפנים | air | airbase | 150 | 3.5 | 4 x 2 | 40 | 0 |
| `propBomber` | Prop bomber | מפציץ מדחף | air | airbase | 450 | 8 | 3 x 1 | 130 | 0.05 |
| `rpgTeam` | Rocket team | חוליית טילי כתף | infantry | barracks | 150 | 2.5 | 2 x 3 | 32 | 0 |
| `dumpTruck` | Gold truck | משאית זהב | hauler | works | 150 | 5 | 1 x 1 | 300 | 0.15 |
| `oracle` | Oracle | חוזה | infantry | barracks (also needs works, radar) | 500 | 15 | 1 x 1 | 220 | 0 |

| id | speed | range | sight | damage | cooldown ticks | accuracy | nerveResist | domain |
|---|---|---|---|---|---|---|---|---|
| `sappers` | 31 | 130 | 265 | 7 | 9 | 0.45 | 0.85 | land |
| `militia` | 30 | 160 | 265 | 12 | 8 | 0.46 | 0.8 | land |
| `technical` | 48 | 220 | 265 | 28 | 6 | 0.5 | 0.8 | land |
| `speedboat` | 52 | 185 | 265 | 21 | 6 | 0.5 | 0.9 | sea |
| `fpvSwarm` | 90 | 70 | 265 | 25 | 14 | 0.6 | 0.2 | air |
| `propBomber` | 120 | 55 | 300 | 135 | 10 | 1 | 0 | air |
| `rpgTeam` | 30 | 240 | 265 | 55 | 22 | 0.55 | 0.8 | land |
| `dumpTruck` | 52 | 1 | 170 | 0 | 10 | 0 | 0 | land |
| `oracle` | 33 | 150 | 280 | 16 | 7 | 0.6 | 0.3 | land |

| id | damage multipliers by target (`vs`) | special fields |
|---|---|---|
| `sappers` | air 0.3, structure 0.2, fence 2 | `noCapture` true, `repairPerSecond` 30, `captureSeconds` 6 |
| `militia` | air 0.4, structure 0.25, fence 0.5 | - |
| `technical` | structure 0.5, fence 0.8 | - |
| `speedboat` | air 0.6, structure 0.5, fence 0.5 | - |
| `fpvSwarm` | air 0.5, hq 0.2, structure 0.7, fence 0.5 | `noCapture` true |
| `propBomber` | air 0, infantry 0.5, hq 0.3, structure 2, fence 2 | `callsign` "comet", `bombs` 1, `blastRadius` 55, `rearmSeconds` 10, `evade` 0.75, `noCapture` true |
| `rpgTeam` | infantry 0.18, air 0.5, hq 0.3, structure 1.1, fence 0.8 | `siege` true, `siegeRange` 340, `pierce` 0.8 |
| `dumpTruck` | none listed | `capacity` 250, `loadSeconds` 5, `unloadSeconds` 3, `noCapture` true |
| `oracle` | air 0.3, hq 0.05, structure 0.1, fence 0.3 | `callsign` "raven", `hero` true, `startTier` 2, `disguise` 85, `seizeRadius` 240, `seizeSeconds` 3, `dread` 0.17, `dreadRadius` 185, `noCapture` true |

## Notes on the special fields

- `siege` / `siegeRange`: the faction's unit for breaking defences; only a siege unit may outrange a defence. `siegeRange` applies against structures and fences only.
- `minRange`: an indirect-fire weapon cannot hit a target closer than this.
- `noCapture`: the unit cannot take a map point, whatever its class.
- `repairPerSecond`, `captureSeconds`: engineers. They mend structures and bridges and take over enemy structures and [[Tech Buildings]].
- `capacity`, `loadSeconds`, `unloadSeconds`: a hauler. See [[Economy]].
- `hero`, `startTier`, `stealth`, `charges`, `chargeDamage`, `chargeVsHQ`, `fuseSeconds`, `plantSeconds`, `disguise`, `seizeRadius`, `seizeSeconds`, `dread`, `dreadRadius`: the hero. See [[Heroes]].
- `bombs`, `blastRadius`, `rearmSeconds`, `evade`: a strike aircraft. See [[Strike Aircraft]].
- `crushes`: a heavy vehicle that runs infantry down in the open (`server/sim/crush.go`).
- `callsign`: the callsign class when it is not the unit class (heroes and strike aircraft). See [[Callsigns]].

## Related

- [[Game Overview]]
- [[Factions]]
- [[Units - Aegis]]
- [[Structures and Build Tree]]
- [[Strike Aircraft]]
- [[Heroes]]
- [[Balance]]
- [[Ranks and Brain Tiers]]
