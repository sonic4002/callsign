---
title: Economy
description: "There is one resource, gold. Haulers collect it from fields that gushers feed and unload it at a refinery; the headquarters adds a small trickle, the sea rig pays whoever holds it, and an Assay ..."
type: concept
status: current
tags:
  - type/concept
  - status/current
  - agent/CLD
  - origin/mixed
  - area/gameplay
  - topic/game-design
  - topic/economy
  - topic/gold
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Tech Buildings]]"
  - "[[Structures and Build Tree]]"
  - "[[Placement and Production Queues]]"
  - "[[Match Rules and Winning]]"
  - "[[Map - Small]]"
  - "[[Map - Medium]]"
  - "[[Map - Large]]"
  - "[[Balance]]"
  - "[[Units - Aegis]]"
  - "[[Units - Ashfall]]"
paths:
  - server/sim/haul.go
  - server/sim/tech.go
  - server/sim/sell.go
  - shared/rules.json
  - tools/mapgen.py
  - docs/specs/2026-11-24-bases-harvest-maps.md
  - CLAUDE.md
---

# Economy

There is one resource, gold. Haulers collect it from fields that gushers feed and unload it at a refinery; the headquarters adds a small trickle, the sea rig pays whoever holds it, and an Assay Office pays its holder.

## Sources of gold

| Source | Amount | Notes |
|---|---|---|
| Starting gold | 1,000 by default (`match.startGold`) | The lobby offers 1,000, 2,500, 5,000 or 10,000, or a typed amount from 400 to 20,000 (`StartGolds`, `MinStartGold`, `MaxStartGold` in `server/room/hub.go`) |
| Headquarters trickle | 10 gold a second (`match.hqTrickle`) | Every headquarters, always |
| Hauled gold | a load of 320 (Ore crawler) or 250 (Gold truck) | See below |
| Sea rig (point S) | 30 gold a second (`rigs.seaRig.income`) | Captured by naval or air units only |
| Assay Office | 250 once per side, then 3 a second while held | A tech building: [[Tech Buildings]] |
| Selling a structure | 50% of its cost | [[Structures and Build Tree]] |
| Cancelling a unit in line | the gold not yet spent on it | [[Placement and Production Queues]] |

`landRig` and `point` have income 0: holding a land rig or a plain point pays nothing by itself. Points still decide a match on the timer ([[Match Rules and Winning]]) and give sight and ground to build defences on.

## Gushers and fields

A gusher throws gold into the field around it at a steady rate, up to the field's cap. The three sizes are set in `tools/mapgen.py`:

| Kind | gold per second | field radius | field cap | gold at start | Where |
|---|---|---|---|---|---|
| home | 12 | 90 | 1,500 | 1,000 | near a base; "feeds about one and a half haulers" |
| rich | 18 | 70 | 2,400 | 1,000 | contested, in the middle |
| poor | 8 | 70 | 1,000 | 600 | on a side's own ground, out of the way |

Each map's gushers are listed in [[Map - Small]], [[Map - Medium]] and [[Map - Large]]. A gusher is named on the radio by its map point.

## Haulers

| | Ore crawler (Aegis) | Gold truck (Ashfall) |
|---|---|---|
| id | `crawler` | `dumpTruck` |
| Hebrew | זחל כרייה | משאית זהב |
| Cost | 150 | 150 |
| hp / armor | 420 / 0.35 | 300 / 0.15 |
| Speed | 40 | 52 |
| Capacity | 320 | 250 |
| Load / unload seconds | 7 / 3 | 5 / 3 |

- A finished refinery brings one hauler free (`grantHauler`). More haulers are bought and come out of the works (their `requires` role in the rules is `works`; the comment in `buyHauler` that says "needs a refinery" is older than commit `7e3823d`, which moved them to the works). A side may have 4 (`match.haulerCap`), apart from the squad cap.
- Haulers are unarmed, have no leader agent and are not radio stations. They are called Hauler N / מוביל N in reports (ids start at 1000, `HaulerIDBase`).
- They unload at the nearest standing refinery of their side, own or captured, or else at the headquarters (`dropoffs`).

### The hauler's own AI

States: `out`, `loading`, `returning`, `unloading`, `fleeing`, `waiting`. `chooseField` picks the field it was sent to, or else the nearest field not known to be under fire that holds enough gold for it on top of the side's haulers already there.

| Constant | Value | Meaning |
|---|---|---|
| `haulFleeSeconds` | 8 | a hauler shot at keeps running this long after the last shot |
| `haulAlarmSeconds` | 20 | at most one "hauler attacked" event per hauler in this time |
| `fieldDangerSecs` | 30 | a field where a hauler was shot at is avoided this long |
| `fieldThreatRadius` | 260 | an armed enemy seen this close to a gusher makes its field dangerous now |
| `haulWorthLoading` | 20 | gold a field must hold before a hauler drives out for it |
| `haulShare` | 0.6 | share of capacity a field must hold per hauler working it before another joins |
| `haulEnemySide` | 60 | a field this much nearer the enemy headquarters than home is left alone |

A hauler under fire runs to the nearest of its side's drop-offs and standing defences (`refuge`). The `haul` command sends a side's haulers (or one) to a named field, or back to choosing for themselves (`auto`).

## Income figure

`Sim.Income` is gold per minute measured over the last 60 seconds (`incomeWindow`), scaled up during the first minute. The page shows it. `make cost` measures what an undisturbed base makes a minute with one, two and three haulers on each map ([[Balance]]).

## Spending

Units and structures (tables in [[Units - Aegis]], [[Units - Ashfall]], [[Structures and Build Tree]]), brain-tier upgrades at 300 and 800 ([[Ranks and Brain Tiers]]), and paid repairs. Who may spend is the question of the purse: [[Initiative - Orders, Fight and Purse]].

## Differs from the plan

`docs/PLAN.html` has rigs that pump gold on their own (HQ well +10, land rig +15, sea rig +30) with nothing to haul. The owner changed this on 2026-11-24: see [[Decision - Economy]]. The rule kinds are still named `landRig` and `seaRig`.

## Related

- [[Game Overview]]
- [[Decision - Economy]]
- [[Structures and Build Tree]]
- [[Tech Buildings]]
- [[Maps]]
- [[Base Cues]]
- [[Balance]]
