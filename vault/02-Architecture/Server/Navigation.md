---
title: Navigation
description: "Ground units and boats find their way on a grid of 20-unit cells with an A search; aircraft need no grid and fly straight."
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
  - "[[Terrain, Cover and Bridges]]"
  - "[[Bodies and Collision]]"
  - "[[Server Architecture]]"
  - "[[Sim Loop and Determinism]]"
  - "[[Sorties]]"
  - "[[Maps]]"
  - "[[Structures and Build Tree]]"
  - "[[Places on the Radio]]"
  - "[[Tests and Headless Matches]]"
paths:
  - server/sim/nav.go
  - server/sim/bridges.go
  - server/sim/bodies.go
  - server/sim/sim.go
  - server/sim/terrain_test.go
  - server/sim/crossing_test.go
  - shared/rules.json
---

# Navigation

Ground units and boats find their way on a grid of 20-unit cells with an A* search; aircraft need no grid and fly straight. The grid knows the terrain, the bridges, everything built on the map and each side's fences, and every query is a pure function of the match so far.

## The grid

| Thing | Value | Where |
|---|---|---|
| Navigation cell | 20 map units (`NavCell`) | `nav.go` |
| Terrain cell (the map's drawing) | 40 (`maps.<id>.cell`) | `shared/rules.json` |
| Fog cell | 40 (`FogCell`) | `fog.go` |
| Body lookup cell | 64 (`bodyCell`) | `bodies.go` |

The navigation grid is finer than the terrain "so that a fence, a building or a bridge deck can block or open a narrow strip". Its size is the map's width and height divided by 20, rounded up: 140 by 88 cells on the small map, 200 by 124 on the medium, 260 by 160 on the large.

Per cell the `nav` struct keeps: `ground` and `water` (from the terrain kind), `bridge` (which deck covers it), `blocked` (a count of obstacles) and `foe[side]` (a count of the other side's fences). A version number `ver` grows on every change, so cached paths know they are stale.

## Terrain kinds (`terrainKinds` in the rules)

| Letter | Name | Land units | Boats | Speed factor | Note |
|---|---|---|---|---|---|
| `L` | land | yes | no | 1 | |
| `W` | water | no | yes | 1 | |
| `I` | ice | yes | no | 0.6 | gives no cover |
| `M` | mountain | no | no | 1 | closed to everything on the surface |

## Movement modes

| Mode | Used by | May enter |
|---|---|---|
| `navGround` | land units ordered to **move** | land, ice, standing bridges |
| `navCautious` | land units under any other order | the same, but never a bridge about to fall |
| `navWater` | boats (`domain: "sea"`) | water, also under bridges |
| `navGround0/1`, `navCautious0/1` | the two ground modes as side 0 or side 1 uses them | also closed where the other side's fences stand |
| `navAir` (-1) | aircraft (`domain: "air"`) | everything; no grid |

`Sim.modeFor` picks the mode from the unit's domain and its squad's order: "Ordered to move, a squad crosses whatever bridge still stands; otherwise it stays off one about to fall." A bridge is "in danger" below `bridgeRules.dangerShare` (0.35) of its hit points.

## What changes the grid during a match

- **Structures and buildings**: `Sim.SetBlocked(key, x, y, w, h, blocked)` closes the rectangle under them to all land units. Calling it again with the same key moves or removes the obstacle.
- **Fences and walls**: `Sim.SetFenced(key, against, ...)` closes the cells along the segment to one side only: "a fence stops the troops of the side it was built against and nobody else", so its owner is never walled in.
- **Bridges**: a deck cell is passable only while the bridge stands (`BridgeState.Standing`). When a bridge falls its deck is water again, and every land unit standing on it is lost (`collapse`); engineers can bring it back.

Every map's bridges are 80 wide with 900 hit points; see [[Terrain, Cover and Bridges]].

## The path search (`nav.path`)

- A* over the grid with a binary heap (`container/heap`), eight directions (`navSteps`): straight steps cost 1, diagonal steps cost the square root of 2.
- The heuristic is the octile distance to the goal.
- A diagonal step is refused when either of the two cells it would cut between is closed: "no cutting a corner between two blocked cells".
- The start cell always counts as passable, "so a unit standing on something that has just been blocked can still walk off it".
- A goal that is not passable is first snapped to the nearest passable cell (`nav.snap`, rings searched outward in a fixed order).
- When the goal cannot be reached, the path leads to the reachable cell nearest to it (lowest heuristic seen) and reports `reached = false`.
- Working arrays are kept between searches and marked with a search number, so nothing is reallocated per search.

## Steering each tick (`Sim.steer`, `steerOn`)

1. If the unit flies, or the straight line to the target stays on passable cells (`lineClear` visits every cell the line passes through), head straight there.
2. Otherwise use the cached path, recomputing it when it is stale: no path yet, the grid's version changed, the mode changed, the unit was pushed off its path, or the goal changed (at most twice a second).
3. Skip corners that can already be walked past in a straight line (path smoothing).
4. Head for the next corner.

A team that has waited on bodies in its way is steered round them for a while: the cells those bodies keep it out of count as closed for its search (`shutBodies`, with the cells right around the team left open so it can walk away), and that search is repeated every second because bodies move. When that leaves no way, it is steered as ever and waits. See [[Bodies and Collision]].

## Reachability (`Sim.Reachable`)

Before an order is accepted, the simulation checks that the squad could get there: connected regions per mode are labelled by flood fill on demand (`nav.regions`) and two cells can reach each other exactly when their labels match. Aircraft reach everything. For ground units every standing bridge counts, and so does ground behind an enemy fence: "a fence can be shot down, so it never makes a place one that cannot be reached". An unreachable place is refused with `ErrUnreachable` ("that squad cannot reach that place").

## Staying on the map

`Sim.clamp` keeps positions 10 units inside the map's edge and snaps them to the nearest cell of the unit's domain (ground or water); aircraft are only kept inside the edge. `checkInvariants` in the tests fails a match in which a land unit stands where it cannot walk or a boat where it cannot sail.

## Tests

`terrain_test.go`: ground units go round water and over bridges; ice is crossed slowly; a bridge falls with everything on it; engineers bring a bridge back; troops stay off a bridge about to fall; blocked ground is walked round. `crossing_test.go`: an army crosses every map without a jam; boats sail the narrow water of every map. `fit_test.go`: the base layout is open land on every map; haulers cross bridges and fall with them.

## History

- The first maps had no terrain. Terrain, bridges, cover and places came with commit `7236a6b` (2026-11-24).
- `3b6d0e6`: "Structures and fences are on the navigation grid; base sites are open land on every map". Haulers path like any ground unit from then on.
- `532aef2`: three bigger battlefields "each with several ways across".

## Related

- [[Server Architecture]]
- [[Sim Loop and Determinism]]
- [[Bodies and Collision]]
- [[Sorties]]
- [[Terrain, Cover and Bridges]]
- [[Maps]]
- [[Structures and Build Tree]]
- [[Places on the Radio]]
- [[Tests and Headless Matches]]
