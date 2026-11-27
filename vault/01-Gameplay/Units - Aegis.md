---
title: Units - Aegis
description: "Every unit the Aegis Directorate (מנהלת אגיס) can field, with the numbers in shared/rules.json (factions.aegis.units) as they are now."
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
  - topic/aegis
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

# Units - Aegis

Every unit the Aegis Directorate (מנהלת אגיס) can field, with the numbers in `shared/rules.json` (`factions.aegis.units`) as they are now. A side starts a match with the squads listed in `startUnits`: `commandos`, `commandos`.

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
| `engineers` | Combat engineers | הנדסה קרבית | infantry | barracks | 150 | 4 | 1 x 3 | 50 | 0 |
| `commandos` | Commandos | קומנדו | infantry | barracks | 100 | 4 | 3 x 2 | 66 | 0 |
| `tank` | Main battle tank | טנק מערכה | vehicle | works | 250 | 7 | 2 x 1 | 450 | 0.6 |
| `patrolBoat` | Patrol boat | סירת סיור | naval | dockyard | 250 | 7 | 2 x 1 | 300 | 0.3 |
| `helicopter` | Attack helicopter | מסוק קרב | air | airbase | 400 | 8 | 2 x 1 | 240 | 0.2 |
| `strikeJet` | Strike jet | מטוס תקיפה | air | airbase | 500 | 10 | 2 x 1 | 150 | 0.2 |
| `rocketLauncher` | Precision rocket launcher | משגר רקטות מדויק | vehicle | works | 300 | 7 | 2 x 1 | 150 | 0.1 |
| `crawler` | Ore crawler | זחל כרייה | hauler | works | 150 | 5 | 1 x 1 | 420 | 0.35 |
| `sentinel` | Sentinel | זקיף | infantry | barracks (also needs works, radar) | 500 | 15 | 1 x 1 | 150 | 0 |

| id | speed | range | sight | damage | cooldown ticks | accuracy | nerveResist | domain |
|---|---|---|---|---|---|---|---|---|
| `engineers` | 30 | 140 | 260 | 8 | 9 | 0.5 | 0.8 | land |
| `commandos` | 29 | 190 | 280 | 15 | 8 | 0.6 | 0.7 | land |
| `tank` | 34 | 260 | 260 | 60 | 25 | 0.7 | 0.5 | land |
| `patrolBoat` | 43 | 230 | 300 | 30 | 10 | 0.6 | 0.6 | sea |
| `helicopter` | 75 | 220 | 320 | 30 | 8 | 0.65 | 0.5 | air |
| `strikeJet` | 160 | 60 | 300 | 100 | 10 | 1 | 0 | air |
| `rocketLauncher` | 30 | 420 | 260 | 150 | 40 | 0.7 | 0.8 | land |
| `crawler` | 40 | 1 | 170 | 0 | 10 | 0 | 0 | land |
| `sentinel` | 31 | 280 | 320 | 45 | 20 | 0.85 | 0.3 | land |

| id | damage multipliers by target (`vs`) | special fields |
|---|---|---|
| `engineers` | air 0.3, structure 0.2, fence 1.5 | `noCapture` true, `repairPerSecond` 40, `captureSeconds` 8 |
| `commandos` | air 0.5, structure 0.25, fence 0.5 | - |
| `tank` | air 0, structure 1, fence 1 | `crushes` true |
| `patrolBoat` | air 0.6, structure 0.6, fence 0.6 | - |
| `helicopter` | structure 0.8, fence 0.8 | - |
| `strikeJet` | air 0, infantry 0.5, hq 0.3, structure 2, fence 2 | `callsign` "comet", `bombs` 2, `blastRadius` 60, `rearmSeconds` 14, `evade` 0.75, `noCapture` true |
| `rocketLauncher` | air 0, hq 0.3, structure 1.6, fence 1.2 | `siege` true, `minRange` 150 |
| `crawler` | none listed | `capacity` 320, `loadSeconds` 7, `unloadSeconds` 3, `noCapture` true |
| `sentinel` | vehicle 0.12, naval 0.12, air 0.2, hauler 0.3, hq 0.05, structure 0.03, fence 0.1 | `callsign` "ghost", `hero` true, `startTier` 2, `stealth` 95, `charges` 2, `chargeDamage` 1200, `chargeVsHQ` 0.3, `fuseSeconds` 5, `plantSeconds` 3, `noCapture` true |

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
- [[Units - Ashfall]]
- [[Structures and Build Tree]]
- [[Strike Aircraft]]
- [[Heroes]]
- [[Balance]]
- [[Ranks and Brain Tiers]]
