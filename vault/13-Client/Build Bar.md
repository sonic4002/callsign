---
title: Build Bar
description: "The build bar is the panel with two tabs, Structures and Reinforcements, that sits under the map on a desktop and opens as a sheet on a phone."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/code
  - area/client
  - topic/client
  - topic/build
  - topic/placement
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Mobile Layout]]"
  - "[[Structures and Build Tree]]"
  - "[[Power]]"
  - "[[Placement and Production Queues]]"
  - "[[Direct Acts]]"
  - "[[Selection and Map Orders]]"
  - "[[Decision - Direct Build and Buy]]"
  - "[[Client]]"
  - "[[Page Layout]]"
  - "[[Radio versus Direct Acts]]"
paths:
  - client/debug.js
  - client/bases.js
  - client/placement.js
  - client/power.js
  - client/heroes.js
  - client/map.js
  - client/index.html
  - client/testdata/placement-small.json
  - client/testdata/radio-calls.json
---

# Build Bar

The build bar is the panel with two tabs, Structures and Reinforcements, that sits under the map on a desktop and opens as a sheet on a phone. Pressing a structure puts a ghost on the map to place; pressing a unit buys it at once; both go to the server as direct acts, not radio calls.

## Where it sits

`#build-panel` is one element. `seatBuildPanel()` in `debug.js` moves it under the map (class `under-map`, before `#radio`) unless the phone media query matches, in which case it stays in the sidebar and is the "build" sheet ([[Mobile Layout]]). As a bar, both tabs have one fixed height and one card size in a row that scrolls sideways, so switching tabs moves nothing else (commit cfcd2a8). The tab last used is kept in `localStorage` `callsign.buildTab`; it opens on Structures the first time, "since nothing can be bought before something is built". Each tab carries a badge: structures going up, units on their way.

## Structure cards (`structureCards` in `client/bases.js`)

One card per structure of the player's faction except the headquarters. Each shows an icon (painted, or code-drawn by `drawIcon`), name, `cost · build seconds`, a power tag (`+100` / `−20`, from `powerFigure`), how many the side has, and one line of "why".

| Card state | Meaning | Pressable |
|---|---|---|
| `ready` | Can be started; the line says what it unlocks or does | yes |
| `poor` | Not enough gold | no |
| `rising` | One of this kind is going up; the card fills and shows a percentage | no |
| `needs` | A required structure does not stand; names it | no |
| `busy` | Another structure of the same group (base, or defence/fence) is still going up | no |
| `full` | A cap is reached: `match.powerStructures` power structures, `match.baseCap` base structures, `match.defenceCap` defences, or `match.fenceRuns` fence runs | no |

Extra marks: class `next` on the card whose role equals `state.opening` — the structure a base usually builds next, worked out by the game; class `requested` while a radio call asking Anvil to build it is unanswered; a "would run short of power" warning (`wouldRunShort`). The numbers behind these are in [[Structures and Build Tree]] and [[Power]].

## Unit cards

One card per unit of the faction, plus any unit a captured structure lets this side build (`state.foreignUnits`). Each shows the unit drawn by `drawUnit`, its name and cost.

| Mark | Meaning |
|---|---|
| Padlock + "needs <structure>" (`locked`) | `unitLock`: the unit's `requires` role has no **finished** structure of this side. A hero is locked by `heroLock` while one is already fielded. A locked card takes no press, on the page and on the server |
| Disabled | Not enough gold, or no room: squads + deploying against `match.populationCap`; haulers against `match.haulerCap` |
| Rising fill + seconds left | The first of this unit to come out, wherever it is made (`unitLine`); the wait is its own time plus the line ahead (`ticksAhead + ticksLeft`) |
| Count bubble | How many of this unit are in line: on their way, plus asked for by radio and not yet answered |
| `×` beside the card | Shown while one is in a line: `act("cancel", {unit})` takes the last one back out |

A press sends `{type:"act", name:"buy", args:{unit}}`: the unit joins the line of the structure that makes it. Queue rules are in [[Placement and Production Queues]].

### "Requested" by radio

Buying and building can still be asked of Anvil by voice or text. `noteBuy` watches every transmitted call for buy/build words in both languages and marks the named unit or structure as requested (or every unit, `"*"`, when the call named none) until a `deploying` or `structure_started` event answers it, Anvil says Negative or Say again, the net refuses the call, or 25 s pass.

## Placing a structure

Pressing a structure card calls `startPlacing`: a ghost appears on the map on the nearest ground that will take it, and the `#placer` panel opens.

- The ground the structure may stand on is tinted in 20-metre cells: green where it fits, red where something is in the way, bare where it is too far from the base (`tint`, cached by `tintKey` until the base changes).
- `canPlace` answers `""` or a reason shown in words: `edge`, `far`, `ground`, `shore` (a dockyard away from water), `room`. It mirrors `server/sim/placement.go`; both are held to one table, `client/testdata/placement-small.json`, by tests on each side. The server still decides.
- Under a mouse the ghost follows the pointer and a click on green ground confirms. Under a finger a tap moves the ghost and the panel's **Build here** button confirms.
- The panel shows the spot as the radio would say it ("140 metres north and 60 metres east of Alpha", `spotWords`), a power warning, and Cancel. Escape, or a press outside the map, the panel and the build sheet, puts the ghost away.
- Confirming re-checks the spot, then sends `{type:"act", name:"build", args:{structure, place, run}}` with `place` in the simulation's form (`N140 E60 of A`, `spotForm`). A refusal comes back on the card ([[Direct Acts]]).

### Walls and fences

A structure with role `fence` is placed as a run of `def.segments` segments centred on the spot. It can lie four ways (`RUNS`): `ns`, `nesw`, `ew`, `nwse` (the server's names, `sim.FenceRuns`). Turning: the panel's Turn button, the `R` key (also `ר`), or the mouse wheel while placing. Each segment is drawn green or red by the ground it would stand on (`runSegments`, mirroring the server's `CanPlaceRun`); the run's middle must be on the side's own ground, the other segments only need good ground. The chosen run is sent in the `run` argument (commit 6f52f1e).

## Rally point

The Reinforcements tab shows where new squads gather (`#rally-place`) and a Set button. `startRally()` then waits for a press on a named point, a tech building, a landmark or a bridge (`placeRally`); open ground asks for nothing. It sends `act("rally", {place, structure})`; "Home" sends `place:"home"`. A structure's own rally point is set from its menu ([[Selection and Map Orders]]). A chosen rally point is drawn on the map as a flag in the side's colour.

## The radio wording is kept

Before 2026-11-24 every button here wrote a radio call to Anvil. The calls are no longer written by the page, but `client/testdata/radio-calls.json` keeps them (`call.buy`, `call.buildSpot`, `call.buildRun`, `call.cancel`, `call.rally…`, `call.sell`, `call.repairStructure`) and `client/i18n.test.mjs` runs each through the rule-brain operator in both languages, so saying them still works. Why it changed: [[Decision - Direct Build and Buy]].

## Related

- [[Client]]
- [[Page Layout]]
- [[Selection and Map Orders]]
- [[Structures and Build Tree]]
- [[Placement and Production Queues]]
- [[Power]]
- [[Direct Acts]]
- [[Radio versus Direct Acts]]
- [[Decision - Command Sidebar]]
