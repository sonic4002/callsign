---
title: Placement and Production Queues
description: "A structure stands on a chosen spot that the server checks, and units are made one at a time in a line at the structure that makes them, then walk out of its door to a rally point."
type: concept
status: current
tags:
  - type/concept
  - status/current
  - agent/CLD
  - origin/mixed
  - area/gameplay
  - topic/game-design
  - topic/structures
  - topic/production
created: 2026-11-26
updated: 2026-11-27
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Places on the Radio]]"
  - "[[Build Bar]]"
  - "[[Power]]"
  - "[[Direct Acts]]"
  - "[[Agent Tools]]"
  - "[[Initiative - Orders, Fight and Purse]]"
  - "[[Enemy Bot]]"
  - "[[Game Overview]]"
  - "[[Structures and Build Tree]]"
  - "[[Navigation]]"
paths:
  - server/sim/placement.go
  - server/sim/queue.go
  - server/sim/structures.go
  - shared/rules.json
  - docs/specs/2026-11-24-bases-harvest-maps.md
---

# Placement and Production Queues

A structure stands on a chosen spot that the server checks, and units are made one at a time in a line at the structure that makes them, then walk out of its door to a rally point. These rules came with the second and third waves of the bases spec (addenda 1 and 3 of `docs/specs/2026-11-24-bases-harvest-maps.md`).

## Where a base structure may stand

`CanPlace` in `server/sim/placement.go` refuses a spot with a reason, or accepts it.

| Rule | Value |
|---|---|
| Distance from the side's headquarters | within `match.baseRadius` = 300, or |
| Distance from a finished base structure of its own | within `match.baseReach` = 180 |
| Dockyard | must have water right beside its footprint; its allowed ground stretches to the shore nearest the headquarters plus `dockMargin` = 160 |
| Ground | open land: not water, ice or mountain, not on a map building |
| Clear of a landmark's centre | footprint + 34 |
| Clear of another structure's footprint | footprint + 12 |
| Clear of a fence segment | footprint + 6 |
| Clear of the edge of a gold field | footprint + 10 |
| Clear of the map edge | footprint + 20 |

When an order names no spot (the scripted enemy, or an operator told only what to build), `SiteFor` picks one: the first fitting place of the standing base layout (`baseSlots`, ten offsets around a western headquarters, mirrored for the east), a refinery nearest a gusher, a dockyard on the nearest shore. A build order can also give an exact spot as an offset from a point, or name a place to build near; see [[Places on the Radio]]. A new structure clears the ruins it is built over.

## Where a defence or a fence may stand

`canPlaceWork`: on the side's own ground, meaning within `match.buildRadius` = 340 of its headquarters, of a structure of its own (not a fence or a tech building) or of a point it owns; on open land; 70 clear of either headquarters; 6 clear of another structure.

A fence is bought as a run of segments (Barrier Wall 6 x 50, Wire Fence 8 x 50). A run can lie four ways (`FenceRuns`: north to south, east to west and the two diagonals). `CanPlaceRun` judges the whole run: a run that would cross water or a structure is refused whole; nothing is built short. In the page the ghost can be turned and each segment shows green or red by the server's rule ([[Build Bar]]).

## Production lines

`server/sim/queue.go`:

- A unit is made by a standing structure of the role it `requires`, of its own design. A captured barracks makes the units of the faction that built it.
- Each structure makes one unit at a time; the rest wait in line. `match.queueLimit` = 5 units may wait at one structure.
- A purchase goes to the structure with the shortest line, then the nearest to the headquarters, then the oldest (`producer`). A second structure of a role is a second line.
- The gold is spent at purchase. `cancel` takes the last unit of a kind out of its line and gives back all the gold for one still waiting, or the unbuilt share for the one being made.
- A line whose structure falls or changes hands is lost (event `deploy_lost`).
- On low power, building and deploying advance on half the ticks ([[Power]]).
- A finished unit comes out at the door on the structure's south face (walkers and drivers), on the pad (aircraft) or on the water beside it (boats) (`exitOf`), then goes to the rally place.

`deploySeconds` in the unit tables is the time the unit takes once it is first in line.

## Rally points

`CmdRally` sets where new units gather: for every structure of the side, or for one. The written place `home` (`RallyDefault`) puts them back beside their structure, each in its own spot a short way out of the door. A structure built later inherits the side's rally point. The place may be a named point, a landmark, a bridge, a tech building, or any spot on open ground written as an offset from the nearest point ("S60 W80 of B"); since 2026-11-27 the page sends that form when the player taps open ground while setting a rally point.

## Who may do these things

The commander builds, buys, cancels, sells, repairs and sets rally points directly from the page ([[Direct Acts]], [[Build Bar]]). The operator has tools for the same when ordered by radio or holding the purse ([[Agent Tools]], [[Initiative - Orders, Fight and Purse]]). The scripted enemy builds through the same commands ([[Enemy Bot]]).

## Related

- [[Game Overview]]
- [[Structures and Build Tree]]
- [[Power]]
- [[Build Bar]]
- [[Direct Acts]]
- [[Places on the Radio]]
- [[Navigation]]
