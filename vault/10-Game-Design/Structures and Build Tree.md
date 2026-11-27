---
title: Structures and Build Tree
description: "Structures are what a side builds: base structures that unlock units, defences that fire on their own, and fences that stop ground units."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/mixed
  - area/game-design
  - topic/game-design
  - topic/structures
  - topic/build-tree
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Power]]"
  - "[[Economy]]"
  - "[[Radar and Fog of War]]"
  - "[[Tech Buildings]]"
  - "[[Navigation]]"
  - "[[Units - Aegis]]"
  - "[[Units - Ashfall]]"
  - "[[Placement and Production Queues]]"
  - "[[Build Bar]]"
  - "[[Direct Acts]]"
paths:
  - shared/rules.json
  - shared/structures.go
  - server/sim/structures.go
  - server/sim/placement.go
  - server/sim/sell.go
  - docs/specs/2026-11-24-bases-harvest-maps.md
---

# Structures and Build Tree

Structures are what a side builds: base structures that unlock units, defences that fire on their own, and fences that stop ground units. Each faction has its own structure for every role, and the build tree is expressed in roles: a structure `requires` roles to stand, and a unit `requires` the role that makes it.

## Roles

| Role | What it is for | Aegis | Ashfall |
|---|---|---|---|
| `hq` | Headquarters. A map point, not a structure; losing it loses the match | Command Post | The Den |
| `power` | Supplies power ([[Power]]) | Power Plant | Generator Yard |
| `barracks` | Makes infantry | Barracks | Safehouse |
| `refinery` | Where haulers unload; brings the first hauler ([[Economy]]) | Refinery | Smelter |
| `works` | Makes vehicles and more haulers | Vehicle Works | Chop Shop |
| `radar` | Turns the mini map on; needed by the airbase and the hero ([[Radar and Fog of War]]) | Radar Station | Listening Post |
| `dockyard` | Makes boats; must stand on a shore | Dockyard | Boat Shed |
| `airbase` | Makes aircraft; home of strike aircraft | Airbase | Launch Yard |
| `defence` | Fires on its own | Sentry Gun, Flak Battery | Gun Nest, Rocket Nest |
| `fence` | A run of segments that blocks enemy ground units | Barrier Wall | Wire Fence |
| `tech` | Belongs to no army; stands on the map from the start ([[Tech Buildings]]) | - | - |

`shared.BaseRoles` (the order a base grows in for layout) is power, barracks, refinery, works, radar, dockyard, airbase. The opening the scripted players follow is `match.opening`: power, refinery, barracks, works, radar, airbase.

## The tree

```
(nothing) ── power
(nothing) ── refinery          brings one free hauler when finished
(nothing) ── barracks ──┬── works ──┬── radar ── airbase
                        │           └── (Aegis) flak battery
                        ├── dockyard
                        └── defences (sentry gun; Ashfall gun nest and rocket nest)
(nothing) ── fence
hero: made by the barracks, also needs works and radar standing
```

Units by the role that makes them:

| Role | Aegis units | Ashfall units |
|---|---|---|
| barracks | commandos, engineers, sentinel (hero) | militia, rpgTeam, sappers, oracle (hero) |
| works | tank, rocketLauncher, crawler (hauler) | technical, dumpTruck (hauler) |
| dockyard | patrolBoat | speedboat |
| airbase | helicopter, strikeJet | fpvSwarm, propBomber |

Note that the `unlocks` lists in the rules do not name the haulers or the heroes; the unit's own `requires` (and `needs`) is what `mayBuy` checks.

## Aegis structures

| id | English | Hebrew | role | cost | build s | hp | armor | requires (roles) | unlocks (unit ids) | footprint | sight | power | capturable |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `commandPost` | Command Post | מוצב הפיקוד | hq | 0 | 0 | 3000 | 0.5 | - | - | 60 | 300 | 30 | no |
| `powerPlant` | Power Plant | תחנת כוח | power | 140 | 5 | 700 | 0.3 | - | - | 44 | 180 | 100 | yes |
| `barracks` | Barracks | מגורי הלוחמים | barracks | 200 | 8 | 900 | 0.3 | - | commandos, engineers | 40 | 180 | -10 | yes |
| `refinery` | Refinery | בית הזיקוק | refinery | 400 | 12 | 1100 | 0.3 | - | - | 46 | 180 | -15 | yes |
| `vehicleWorks` | Vehicle Works | מפעל הרכב | works | 240 | 10 | 1200 | 0.4 | barracks | tank, rocketLauncher | 48 | 180 | -20 | yes |
| `radar` | Radar Station | תחנת מכ״ם | radar | 280 | 9 | 800 | 0.3 | works | - | 42 | 260 | -20 | yes |
| `dockyard` | Dockyard | המספנה | dockyard | 220 | 8 | 900 | 0.3 | barracks | patrolBoat | 44 | 180 | -15 | yes |
| `airbase` | Airbase | בסיס האוויר | airbase | 300 | 12 | 1000 | 0.3 | radar | helicopter, strikeJet | 54 | 180 | -20 | yes |
| `sentryGun` | Sentry Gun | תותח זקיף | defence | 150 | 6 | 420 | 0.5 | barracks | - | 16 | 310 | -10 | no |
| `flakBattery` | Flak Battery | סוללת נ״מ | defence | 200 | 8 | 380 | 0.4 | works | - | 18 | 320 | -10 | no |
| `barrierWall` | Barrier Wall | חומת מגן | fence | 80 | 5 | 520 | 0.6 | - | - | 8 | 0 | - | no |

| defence or fence | range | damage | cooldown ticks | accuracy | `vs` | segments x segment length |
|---|---|---|---|---|---|---|
| `sentryGun` | 290 | 20 | 6 | 0.65 | air 0.3 | - |
| `flakBattery` | 300 | 34 | 8 | 0.7 | infantry 0, vehicle 0, naval 0 | - |
| `barrierWall` | - | - | - | - | - | 6 x 50 |

## Ashfall structures

| id | English | Hebrew | role | cost | build s | hp | armor | requires (roles) | unlocks (unit ids) | footprint | sight | power | capturable |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `den` | The Den | המאורה | hq | 0 | 0 | 3000 | 0.5 | - | - | 60 | 300 | 30 | no |
| `generatorYard` | Generator Yard | חצר הגנרטורים | power | 130 | 5 | 550 | 0.2 | - | - | 44 | 180 | 100 | yes |
| `safehouse` | Safehouse | בית המסתור | barracks | 150 | 4 | 750 | 0.2 | - | militia, rpgTeam, sappers | 40 | 180 | -10 | yes |
| `smelter` | Smelter | המתכה | refinery | 360 | 9 | 950 | 0.2 | - | - | 46 | 180 | -15 | yes |
| `chopShop` | Chop Shop | המוסך | works | 290 | 12 | 1000 | 0.3 | barracks | technical | 48 | 180 | -20 | yes |
| `listeningPost` | Listening Post | עמדת ההאזנה | radar | 280 | 9 | 650 | 0.2 | works | - | 42 | 260 | -20 | yes |
| `boatShed` | Boat Shed | סככת הסירות | dockyard | 250 | 10 | 760 | 0.2 | barracks | speedboat | 44 | 180 | -15 | yes |
| `launchYard` | Launch Yard | חצר השיגור | airbase | 400 | 14 | 700 | 0.2 | radar | fpvSwarm, propBomber | 50 | 180 | -20 | yes |
| `gunNest` | Gun Nest | קן מקלעים | defence | 120 | 5 | 330 | 0.35 | barracks | - | 16 | 300 | -10 | no |
| `rocketNest` | Rocket Nest | קן טילים | defence | 170 | 6 | 300 | 0.3 | barracks | - | 18 | 300 | -10 | no |
| `wireFence` | Wire Fence | גדר תיל | fence | 50 | 3 | 260 | 0.1 | - | - | 6 | 0 | - | no |

| defence or fence | range | damage | cooldown ticks | accuracy | `vs` | segments x segment length |
|---|---|---|---|---|---|---|
| `gunNest` | 280 | 13 | 4 | 0.55 | air 0.5 | - |
| `rocketNest` | 290 | 46 | 14 | 0.65 | infantry 0, vehicle 0, naval 0 | - |
| `wireFence` | - | - | - | - | - | 8 x 50 |

## Rules that apply to every structure

| Rule | Value | Where |
|---|---|---|
| A match starts with | the headquarters alone (`match.startStructures` is empty) | `initStructures` |
| Going up at once | one base structure, and one defence or fence beside it | `build` |
| Base structures a side may have | 10 (`match.baseCap`); a second one of a role is allowed and adds a production line | `build`, `server/sim/queue.go` |
| Power structures a side may have | 3 (`match.powerStructures`) | `build` |
| Defences a side may have | 6 (`match.defenceCap`) | `buildDefence` |
| Fence runs a side may have | 4 (`match.fenceRuns`) | `buildFence` |
| Health when work begins | 30% (`buildStartHP`), rising to full as it is built | `construct` |
| Sell | gives back 50% of cost (`match.sellShare`); a fence is sold a segment at a time; the headquarters cannot be sold | `server/sim/sell.go` |
| Paid repair | mends 5% of full health a second (`repairPerSecond`); a full repair from nothing costs 40% of cost (`repairCostShare`); stops when gold runs out | `server/sim/sell.go` |
| Repair by engineers | free, over time, standing by the structure; the engineers are not used up | commit `7fbe24b` |
| Capture by engineers | an engineer squad beside a `capturable` enemy structure, not under fire, for its `captureSeconds` (Aegis 8, Ashfall 6) takes it; the squad stays inside and is gone | `engineers` |
| Low power | defences stop firing, building and deploying run at half speed, the radar is off | [[Power]] |

A structure closes the ground it stands on to everybody; a fence closes its line to the other side only, so its owner's troops are never walled in ([[Navigation]]). Defences can be outranged only by siege units ([[Units - Aegis]], [[Units - Ashfall]]).

Where a structure may stand, and how units queue at it, is in [[Placement and Production Queues]]. How the commander builds (pressing a card and placing a ghost, with no agent in between) is in [[Build Bar]] and [[Direct Acts]].

## Related

- [[Game Design]]
- [[Placement and Production Queues]]
- [[Power]]
- [[Economy]]
- [[Tech Buildings]]
- [[Units - Aegis]]
- [[Units - Ashfall]]
- [[Decision - Direct Build and Buy]]
- [[Base Cues]]
