---
title: Strike Aircraft
description: "Strike aircraft are squads of planes that stand at an airbase, fly a sortie to bomb a target or look at a place, and come home to be armed again."
type: concept
status: current
tags:
  - type/concept
  - status/current
  - agent/CLD
  - origin/code
  - area/gameplay
  - topic/game-design
  - topic/units
  - topic/air
created: 2026-11-26
updated: 2026-11-27
agent: CLD
origin: code
confidence: medium
related:
  - "[[Structures and Build Tree]]"
  - "[[Rule Brain]]"
  - "[[Enemy Bot]]"
  - "[[Sorties]]"
  - "[[Game Overview]]"
  - "[[Units - Aegis]]"
  - "[[Units - Ashfall]]"
  - "[[Callsigns]]"
  - "[[Operator - Anvil]]"
paths:
  - shared/rules.json
  - shared/rules.go
  - server/sim/sortie.go
  - server/sim/sortie_test.go
  - agents/aircraft.mjs
  - client/aircraft.js
---

# Strike Aircraft

Strike aircraft are squads of planes that stand at an airbase, fly a sortie to bomb a target or look at a place, and come home to be armed again. Aegis has the strike jet and Ashfall the prop bomber; both were added on 2026-11-26 (commits `315ee23`, `5fc59d5`, `5b2fb13`, `c7c5b1a`, `93bcdfd`, `d3b799c`).

## The two units

| | Strike jet | Prop bomber |
|---|---|---|
| id | `strikeJet` | `propBomber` |
| Hebrew | מטוס תקיפה | מפציץ מדחף |
| Faction | Aegis | Ashfall |
| Made by | airbase (Airbase) | airbase (Launch Yard) |
| Cost | 500 | 450 |
| Deploy seconds | 10 | 8 |
| Planes in a squad (`teams`) | 2 | 3 |
| hp per plane | 150 | 130 |
| Armor | 0.2 | 0.05 |
| Speed | 160 | 120 |
| Sight | 300 | 300 |
| Bombs per plane per sortie (`bombs`) | 2 | 1 |
| Damage of one bomb at the middle of its blast | 100 | 135 |
| `blastRadius` | 60 | 55 |
| `rearmSeconds` | 14 | 10 |
| `evade` | 0.75 | 0.75 |
| `vs` | air 0, infantry 0.5, hq 0.3, structure 2, fence 2 | the same |
| Callsign class | `comet`: Comet / שביט | the same |
| `noCapture` | true | true |

A unit is a strike aircraft when `bombs > 0` (`Unit.Strike()` in `shared/rules.go`).

## Four planes to an airbase

An airbase holds four planes (`planes` on the airbase structure, with a pad for each in `pads`), by the owner's order of 2026-11-27 ("limit each airfield to 4 airplanes"). A squad's planes each take a pad: two strike-jet squads fill an Airbase, and one prop-bomber squad of three fills a Launch Yard (a second squad of three does not fit beside it). A squad is made only at an airbase with pads free for all its planes; with none, the purchase is refused ("every airbase is full of planes: build another"). Helicopters and drone swarms take no pad. Planes whose airbase falls are taken in by another airbase even over its number, rather than lost, and stand in a second row behind its pads; that airbase makes no new planes while it is over.

## How a sortie goes

The states are `parked`, `out`, `back` and `rearming` (`server/sim/sortie.go`).

1. A new squad comes out of its airbase and parks on the apron, armed, with no order. Each squad has a corner of the apron by its number.
2. An **attack** order on anything its bombs can hurt sends it out. A **move** order is a flight over the place and back (the squad reports `overhead` with the number of enemy squads in its sight). A **hold** with no place, or a move to its own airbase or headquarters, sends it home. It refuses to hold a place and refuses repair and other ground-only orders.
3. It flies straight to the target, spread out (`wingSpace = 2.2` times a ground formation), and closes up over the last 260 map units (`closeUp`). The first plane to arrive is the squad arriving: all planes drop in that one tick.
4. A bomb hits everything of the enemy's inside its blast, seen or not, less toward the edge: fireteams (not aircraft), structures, fences, the headquarters, and the bridge or building the order named. Cover and walls reduce it as they reduce a shot.
5. It flies home and is `rearming` for `rearmSeconds`, then `parked` again (event `rearmed`).
6. An attack order stands after a pass when the target can be destroyed and is still there, and, for an enemy squad, still in sight (`strikeAgain`).

## What can stop one

- In flight a strike aircraft slips `evade` (75%) of the shots that squads fire at it. On the ground it slips none, and defences are not fooled (`evades`).
- The Aegis Flak Battery and the Ashfall Rocket Nest fire only at aircraft (their `vs` is 0 against infantry, vehicle and naval). See [[Structures and Build Tree]].
- A strike squad flies from its own airbase while that stands and is its side's, else from the nearest other one that could have made it. With no airbase left to land at the squad is lost, with the reason `no_airbase` (`ditch`).
- Strike aircraft cannot hurt other aircraft (`vs.air` 0) and cannot capture points.

## How it is commanded

Strike squads are ordinary radio stations with the callsign Comet N / שביט N. Their leaders, Anvil, both brains and both languages know them (`agents/aircraft.mjs`). A rule-brain Anvil that runs the fight sends a strike squad standing armed at any enemy squad in sight that bombs can hurt, nearest the base first; when nothing is known to bomb it sends the squad over the enemy headquarters to look, at most once in two and a half minutes (commit `d3b799c`; the exact conditions are in `agents/rule-operator.mjs`, see [[Rule Brain]]). The scripted enemy does not buy strike aircraft: it has no plan for sorties (commit `315ee23`), see [[Enemy Bot]]. The page shows them on the pad, in the air, their bombs, in the roster and on the build card (`client/aircraft.js`).

The flight model in code detail is in [[Sorties]].

## Related

- [[Game Overview]]
- [[Units - Aegis]]
- [[Units - Ashfall]]
- [[Sorties]]
- [[Structures and Build Tree]]
- [[Callsigns]]
- [[Operator - Anvil]]
