---
title: Bodies and Collision
description: "Every fireteam, vehicle, boat and aircraft takes up room: a circle whose radius comes from the rules, and two bodies never end a tick closer than their radii added."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/code
  - area/architecture
  - topic/server
  - topic/sim
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Navigation]]"
  - "[[Balance]]"
  - "[[Server Architecture]]"
  - "[[Sim Loop and Determinism]]"
  - "[[Sorties]]"
  - "[[Tests and Headless Matches]]"
  - "[[Fireteams and Nerve]]"
  - "[[Terrain, Cover and Bridges]]"
  - "[[Economy]]"
  - "[[Heroes]]"
paths:
  - server/sim/bodies.go
  - server/sim/crush.go
  - server/sim/nav.go
  - server/sim/bodies_test.go
  - server/sim/crowd_bench_test.go
  - server/sim/crossing_test.go
  - shared/rules.json
  - shared/rules.go
---

# Bodies and Collision

Every fireteam, vehicle, boat and aircraft takes up room: a circle whose radius comes from the rules, and two bodies never end a tick closer than their radii added. Friends make way for each other, enemies block (one fireteam on a bridge holds it), and all of it is a pure function of the match so far, so it does not break determinism.

## Sizes (from `shared/rules.json`, `match.body`)

| Class | Body radius (map units) |
|---|---|
| infantry | 8 |
| vehicle | 14 |
| naval | 14 |
| air | 10 |
| hauler | 15 |

A unit may set its own `body`; none does at present (`Rules.BodyOf` falls back to the class). The rules loader refuses a unit that takes up no room.

| Other value | Rule | Value |
|---|---|---|
| Standoff between enemies | `match.bodyStandoff` | 26 |
| Crush radius | `match.crushRadius` | 13 |
| Crush interval | `match.crushSeconds` | 1.5 s |
| Body lookup grid cell | `bodyCell` in `bodies.go` | 64 |

## Who takes room against whom

- Three layers (`layerOf`): ground, water, air. What walks or drives shares the ground; boats share the water; aircraft keep apart only from other aircraft. Different layers never meet.
- A team inside a building takes no room, and a squad still being deployed has no team on the map.
- A crushing vehicle is not stopped by enemy infantry on the ground: it drives over them (`runsDown`). It is the one pair that may overlap. Only the Aegis tank has `crushes: true`.
- Enemies on the ground or water are kept the standoff farther apart than touching (`apart`), "so nobody squeezes past an enemy".
- A hero and a hauler ("one man or one truck holds no ground") neither keep the standoff nor are kept at it; their bodies still block like any other (`holdsGround`).

## Friends make way

| Situation | What happens | Constant |
|---|---|---|
| Walking into a standing friend | the friend steps aside (sideways off the walker's line, or ahead in a narrow passage), then stands aside a moment before going back to its post; a pinned team stays down | `yieldTicks` 5 |
| Behind a friend going the same way | follows in file; overtakes after waiting | `followTicks` 5 |
| Two friends block each other with no room | they change places | `swapAfter` 10 ticks |

## When the way is taken (`Sim.step`)

1. Try the step; if free, take it.
2. If a standing friend is there, ask it to make way and try again.
3. Otherwise try to go round at 25, 50 and 75 degrees, first on the side the body is not on (dead ahead: to the right, "as on a road"), and keep to that side. Only a step that brings the team nearer its goal is taken, so a team "does not circle what it cannot pass" and does not jitter.
4. Otherwise close up (half or a quarter step) and wait.

While waiting:

| After | What the team does | Constant |
|---|---|---|
| 5 ticks blocked by an enemy | fights: even ordered to move, it shoots what is in range for the next 2 s rather than push | `heldAfter` 5 |
| 15 ticks blocked by an enemy | finds its path again around the bodies standing still in its way | `detourAfter` 15 |
| 40 ticks blocked by friends | the same, counting the friends too | `detourAfterFriend` 40 |
| a way round was found | keeps to it for 8 s after it was last found | `detourSeconds` 8 |
| none was found | looks again after 3 s; meanwhile stays and waits | `detourRetry` 3 |

The detour works by closing, for that one path search, the navigation cells within reach of bodies standing still (`shutBodies`); see [[Navigation]]. "Another bridge, the long way about" is what this finds.

## Where teams end up (spots)

A team ordered to a place claims the spot it will stand on (`Sim.post`). The oldest claim wins; a team whose slot is claimed or stood on takes the nearest free spot around it, searched in up to 8 rings (`postRings`) with 2 units of slack between bodies (`postSlack`). A team kept from the last steps to its spot for 15 ticks (`settleAfter`) stands where it is, and that becomes its spot. So every team sent to one point has a spot of its own, and a late squad stays at the crowd's edge.

`Sim.settle` is "the last word on overlap for the tick": a team put down on top of another (out of a building, out of a structure's door, off ground a structure took) goes to the nearest free place; of two, the one raised later moves. Squads behind cover and at a door stand shoulder to shoulder (`huddle`).

## Haulers in their lanes

A hauler's body is the largest. Friends standing in its lane make way for it like for anyone; it follows a friend going its way; enemies it goes round (it keeps no standoff, so it passes as near as touching) and, with no way round, it waits. Its places at a gold field and at a drop-off are spots like a squad's: when taken, it loads or unloads from the nearest free one. Commit `918b96c` wrote this rule down; `TestHaulersGetThroughTroopsStandingOnTheirLane` holds it.

## Crushing (`crush.go`)

After the teams have moved, for every crushing vehicle that moved this tick: sandbags in its path are flattened (whoever built them); enemy infantry about to be run down step aside if they can (a pinned team cannot); those it reaches in the open lose a man. Men inside a building, behind standing sandbags or in a grove are safe. The side is told with an event once per pass.

## Order of movement

Teams move one at a time, in the order they were raised on even ticks and reversed on odd ticks, "so neither side always gets the contested step" (`Sim.Step`).

## Speed (`Sim.stride`)

Per tick: unit `speed` / 10, times the map's `pace`, times the terrain's speed factor for land units not on a bridge, times 0.6 when shaken or 0.15 when pinned.

## Tests

| Test | Holds |
|---|---|
| `TestSquadsSentToOnePointEachFindASpot` | spots |
| `TestAnEnemyOnABridgeHoldsItUntilItIsDestroyedOrLeaves` | the standoff |
| `TestASquadGoesRoundAHeldBridgeWhenThereIsAnotherWay` | detours |
| `TestFriendsPassEachOtherInACorridorOneCellWide` | swapping |
| `TestATankDrivesOverInfantryAndALightVehicleGoesRoundThem` | crushing |
| `TestTeamsInsideABuildingTakeNoRoom` | garrisons |
| `TestNoBodiesOverlapInScriptedMatches` | no overlap over whole matches (`Sim.Overlap` in `export_test.go`) |
| `TestACrowdNeverOverlapsAndIsTheSameEveryTime` | twice the population cap a side, of every unit, sent to one point; same result every run |
| `TestAnArmyCrossesEveryMapWithoutAJam`, `TestAFullArmyLeavesItsBaseAndCrossesEveryMap`, `TestBoatsSailTheNarrowWaterOfEveryMap` | every real map |
| `BenchmarkCrowdTick` | the cost of one tick with 24 squads a side at one point |

## History

Bodies came late, on 2026-11-24: commit `148a5d7` ("fireteams, vehicles, boats and aircraft no longer stand on one another"), then `b7f5192` (held up by an enemy a team fights and looks for another way; crowds settle), `918b96c` (haulers), `82fe88b` (an army, a flotilla and a gold lane tried on every map; the small map's town widened). Tests that used to stack teams on one spot now stand them side by side. Balance was retuned afterwards (`6de14c7`); see [[Balance]].

## Related

- [[Server Architecture]]
- [[Sim Loop and Determinism]]
- [[Navigation]]
- [[Sorties]]
- [[Tests and Headless Matches]]
- [[Fireteams and Nerve]]
- [[Terrain, Cover and Bridges]]
- [[Economy]]
- [[Heroes]]
