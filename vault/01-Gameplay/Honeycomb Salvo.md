---
title: Honeycomb Salvo
description: "The attack helicopter's second weapon: on an order of its own the squad flies in and empties its pods of small missiles over a piece of ground, then waits three minutes to load them again."
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
created: 2026-11-27
updated: 2026-11-27
agent: CLD
origin: code
confidence: medium
related:
  - "[[Units - Aegis]]"
  - "[[Strike Aircraft]]"
  - "[[Direct Acts]]"
  - "[[Selection and Map Orders]]"
  - "[[Rule Brain]]"
  - "[[Agent Tools]]"
paths:
  - shared/rules.json
  - shared/rules.go
  - server/sim/salvo.go
  - server/sim/salvo_test.go
  - server/room/act.go
  - agents/rule-grammar.mjs
  - agents/tools.mjs
  - client/debug.js
  - client/map.js
---

# Honeycomb Salvo

The attack helicopter carries a second weapon beside its gun: pods of small missiles ("Honeycomb missiles", טילי חלת דבש). On an order of its own the squad flies to within range of a place and every helicopter empties its pods over it. The missiles fall scattered across the ground around the place; the pods then take three minutes to load. Added on 2026-11-27 at the owner's request ("add the helicopter another weapon - honeycomb missiles, 3 min reload time, the heli will shoot multiple small missile spread across a territory").

## The numbers (`units.helicopter.salvo` in `shared/rules.json`)

| Field | Value | Meaning |
|---|---|---|
| `missiles` | 8 | from each living helicopter of the squad (a full squad of two fires 16) |
| `damage` | 60 | what one missile does at the middle of its blast |
| `blastRadius` | 34 | how far one missile's blast reaches; at the edge it does 40% |
| `spread` | 110 | the radius of the ground the missiles fall on, evenly |
| `range` | 300 | how near the place the squad flies before it fires |
| `reloadSeconds` | 180 | until it can fire again |
| `flightSeconds` | 1.1 | from pod to ground |

A unit has a salvo when its rules entry has `salvo`; only the helicopter does. A strike aircraft may not have one (the rules check refuses it). The numbers have not been through `make balance`.

## How it runs (`server/sim/salvo.go`)

- `CmdSalvo` / `OrderSalvo`: the target is a place (a point, a landmark, a bridge, a structure, an offset from a point) or an enemy squad in sight. Refused with `ErrNoSalvo` for a unit without one and with `ErrSalvoLoading` (and the seconds left) while the pods load.
- The squad flies toward the place like a move; `Sim.salvos` fires the tick its centre is within `range`. Each missile gets a landing spot from the match's own random source, so the same seed and orders give the same salvo. Missiles leave one tick apart and are kept in `Sim.Rockets` until they land.
- A landing missile is a small `burst`, the same code as a bomb's blast (`sortie.go`): fireteams, structures, fences and the headquarters under it are hit, seen or not, with the helicopter's own `vs` table and the usual armour and cover. Nothing that flies is hit by a blast on the ground. A tech building and a bridge are not hit (a bomb hits those only when its order named them).
- Having fired, the squad holds where it is. `EvSalvo` says so (Squad, Point, Place, Count); `EvSalvoLoaded` when the pods are loaded again.
- Snapshot: an own squad carries `salvo: { ready, wait }`; `rockets` lists the missiles in flight (own, and enemy ones fired from or landing on ground in sight); their blasts are in `blasts` with `kind: "missile"`.

## How it is ordered

- By hand: the squad's roster row has a button with the weapon's name (or the time left while loading). Pressing it puts a ring the size of the spread under the pointer; a press on the map fires there. The orders menu at a point, landmark, enemy or enemy structure also offers it when the pods are loaded. It is a direct act (`order: "salvo"`), answered "Wilco, out" by code like the other by-hand orders. See [[Direct Acts]] and [[Selection and Map Orders]].
- By radio: the rule brain reads "honeycomb", "salvo", "missiles", "rockets", "barrage" and חלת דבש, מטח, טילים, רקטות as the salvo for a squad that has one (`agents/rule-grammar.mjs`), and asks "fire the missiles where?" when no place was named. Model leaders have a `salvo` tool (`agents/tools.mjs`). The squad reports "Missiles away" when it has fired.

## Not done

- The scripted enemy never fires a salvo (Ashfall has no unit with one).
- The operator (Anvil) does not order one on its own.
- Balance has not been measured.

## Related

- [[Units - Aegis]]
- [[Strike Aircraft]]
- [[Direct Acts]]
- [[Selection and Map Orders]]
