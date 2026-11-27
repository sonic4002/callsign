---
title: Sorties
description: "A sortie is one flight of a strike-aircraft squad: out from its airbase, one pass over the target with the whole bomb load, home, and rearming before it can go again."
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
  - topic/aircraft
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Server Architecture]]"
  - "[[Sim Loop and Determinism]]"
  - "[[Strike Aircraft]]"
  - "[[Units - Aegis]]"
  - "[[Units - Ashfall]]"
  - "[[Bodies and Collision]]"
  - "[[Navigation]]"
  - "[[Structures and Build Tree]]"
  - "[[Enemy Bot]]"
  - "[[Callsigns]]"
paths:
  - server/sim/sortie.go
  - server/sim/sortie_test.go
  - server/sim/command.go
  - server/sim/sim.go
  - server/sim/view.go
  - shared/rules.json
---

# Sorties

A sortie is one flight of a strike-aircraft squad: out from its airbase, one pass over the target with the whole bomb load, home, and rearming before it can go again. The model lives in `server/sim/sortie.go`; a fixed-wing squad holds no ground, cannot wait in the air, captures nothing and is in nobody's way.

## The two aircraft (`shared/rules.json`)

| | Strike jet (Aegis) | Prop bomber (Ashfall) |
|---|---|---|
| Unit id | `strikeJet` | `propBomber` |
| Hebrew name | מטוס תקיפה | מפציץ מדחף |
| Callsign | Comet / שביט | Comet / שביט |
| Needs | an airbase (`requires: "airbase"`) | an airbase |
| Cost | 500 | 450 |
| Deploy | 10 s | 8 s |
| Planes (teams x members) | 2 x 1 | 3 x 1 |
| Hit points per plane | 150 | 130 |
| Armor | 0.2 | 0.05 |
| Speed | 160 | 120 |
| Sight | 300 | 300 |
| Bombs per plane | 2 | 1 |
| Damage per bomb | 100 | 135 |
| Blast radius | 60 | 55 |
| Rearm | 14 s | 10 s |
| Evade (in flight) | 0.75 | 0.75 |
| Damage against: air / infantry / headquarters / structure / fence | 0 / 0.5 / 0.3 / 2 / 2 | 0 / 0.5 / 0.3 / 2 / 2 |
| `noCapture` | true | true |

A unit is a strike aircraft when it has `bombs`; such a squad carries a `sortie` beside its order. Speed is multiplied by the map's `pace` like everything else.

## States

| State | Meaning | Leaves it when |
|---|---|---|
| `parked` | at its airbase, armed | it gets an attack (with bombs on) or a move: `out` |
| `out` | flying to its target | it dropped, flew over, or lost its reason to fly: `back` |
| `back` | flying home | all planes are on their pad slots: `rearming` if bombs were spent, else `parked`; or `out` again if given a new target with bombs still on |
| `rearming` | at its airbase, being armed | `rearmSeconds` pass: `parked`, and a `rearmed` event |

`Sim.sorties()` moves the state on each tick before the planes decide where to fly; `Sim.strikes()` does what happens on arrival, after movement and firing.

## Orders a strike squad takes (`sortieOrder`)

| Order | What it means |
|---|---|
| attack a contact | fly at an enemy squad in sight; refused if its bombs cannot hit that class (`ErrNoBombTarget`) or the contact is not in sight |
| attack a place | an enemy structure, a bridge, a building, the enemy headquarters, or open ground |
| move to a place | a flight over the place and back with nothing dropped, "to look"; raises an `overhead` event with the number of enemy squads in its sight |
| hold with no place | "stop": fly home (`OrderReturn`) |
| move or hold at its own airbase or home headquarters point | fly home; naming an airbase makes it the squad's base from now on |
| hold at any other place | refused: `ErrNoLoiter` ("a strike aircraft cannot hold ground or wait in the air: give it a target, or send it back to base") |
| repair | refused |
| attack one of its own structures | refused |

## The flight

- **On the pad.** Each squad stands on a corner of its airbase's apron by its number (`padSlot`, 36 units out, four corners), so two squads of one base do not stand in a heap.
- **Spread out.** Planes stand and fly 2.2 times as far apart as a ground squad's formation (`wingSpace`), and close up over the last 260 units to the target (`closeUp`) so the bombs fall together.
- **Straight lines.** `Sim.fly` moves a plane straight toward its plan at full speed; nothing on the ground or in the air is in its way, and "its nerve never slows it".
- **The drop.** The first plane to reach its place is the squad arriving: every plane drops in that one tick, at the place it was flying to. All bombs are spent in the pass (`Bombs = 0`), a `strike` event is raised with the bomb count, and the squad turns home.
- **Again and again.** After a pass the attack order stands (`strikeAgain`) when the target can be destroyed and is still there: an enemy squad still alive and in sight, a structure not yet a ruin, a bridge still standing, a building with room for a garrison not yet rubble, or the enemy headquarters. An attack on open ground is one pass.
- **Landing.** Home is reached when all planes are on their slots. If bombs were spent the squad rearms; otherwise it is parked at once.

## What a bomb does (`Sim.bomb`)

One plane's load goes off at one place: power = `damage` x `bombs` x planes in the team. Everything of the enemy's inside the blast radius is hit, seen or not, with a share falling from 1 at the centre to 0.4 at the edge (`1 - 0.6 * d / r`):

- fireteams (never aircraft: `vs.air` is 0), reduced by armor, by cover, and by the walls when inside a building (the building takes a share too: `match.garrisonDamageShare`, 0.5);
- structures and fences, by distance to their footprint or segment. A tech building is bombed only on an order naming it: "it is worth more taken than broken";
- the enemy headquarters, when the blast reaches it (with the same headquarters alarm event as ground attacks);
- the bridge or the building the order named, and only that one.

A blast stays in the snapshots for 1.5 s (`strikeSeconds`) so the page can draw and sound it; a side sees its own bombs' blasts and enemy ones in its sight.

## Being shot at

`Sim.evades`: a strike aircraft in flight slips its unit's `evade` share of squad fire, so with 0.75 "three shots in four from soldiers, vehicles and boats miss a plane in the air". On the ground it slips none. Defences are not fooled: the multiplier is applied only to squads' shots (`sim.go`), not to `defencesFire`, so a flak battery is what stops aircraft. The enemy sees parked aircraft as contacts marked `parked`.

## Losing the airbase

An aircraft belongs to an airbase (`sortie.Home`). When that falls, is sold or changes hands, the squad takes the nearest other airbase of its side (`airbaseFor`); if it was on the ground it lifts off for the new one. With none left, aircraft on the ground are lost with the base, and aircraft in the air finish the pass they are on and are lost when they turn for home (`ditch`: a `squad_lost` event with reason `no_airbase`; the loss counts for the enemy's "destroyed" total).

## What the owner sees

`SquadView.sortie` (own squads only): `state`, `bombs` on each plane now, `full` (what a plane carries), `rearm` (0 to 1 while being armed) and `home` (its airbase). Sorties are folded into `Sim.Hash` (`hashSorties`), and `TestSortiesAreTheSameEveryTime` holds them deterministic.

## History

- Commit `315ee23` (2026-11-26) added strike aircraft to the simulation. At that point speed made half of squad fire miss.
- `5b2fb13`, after playing it: the squad drops as one (before, a target that fell to the first plane's bombs turned the order home before the squad had counted its strike); planes stand and fly 2.2 times apart; evade raised so three shots in four miss, because "one flight over two rifle squads cost half a squad of bombers".
- The scripted enemy does not buy strike aircraft: "it has no plan for sorties, so its matches are what they were" (`315ee23`).

## Tests (`server/sim/sortie_test.go`)

Twelve tests, among them: a strike is one pass then home to rearm; a strike on a structure is flown until it falls; what a strike aircraft refuses; a move is a flight over and back with nothing dropped; a squad is lost with its airbase, or takes another; flak and anti-air weapons engage strike aircraft; the two aircraft are a fair match; a strike that destroys its target still spends its bombs; a strike brings down a bridge and then stops.

## Related

- [[Server Architecture]]
- [[Sim Loop and Determinism]]
- [[Strike Aircraft]]
- [[Units - Aegis]]
- [[Units - Ashfall]]
- [[Bodies and Collision]]
- [[Navigation]]
- [[Structures and Build Tree]]
- [[Enemy Bot]]
- [[Callsigns]]
