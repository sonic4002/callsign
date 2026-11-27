---
title: Enemy Bot
description: "The scripted enemy is plain Go code in server/bot that plays a side with no agents and no model: it reads the same fogged snapshot a human gets and returns simulation commands."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/code
  - area/game-design
  - topic/game-design
  - topic/bot
  - topic/enemy
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Power]]"
  - "[[Game Design]]"
  - "[[Balance]]"
  - "[[First Lesson]]"
  - "[[Match Rules and Winning]]"
  - "[[Rooms, Hub and Lobby]]"
  - "[[Rule Brain]]"
  - "[[Server Flags]]"
paths:
  - server/bot/bot.go
  - server/bot/base.go
  - server/bot/hero.go
  - server/room/hub.go
  - server/room/room.go
  - server/sim/terrain_test.go
  - docker-compose.yml
---

# Enemy Bot

The scripted enemy is plain Go code in `server/bot` that plays a side with no agents and no model: it reads the same fogged snapshot a human gets and returns simulation commands. It is the opponent in a match "against the scripted enemy", the player on both sides of the balance tests, and the enemy of the first lesson.

## Levels

| Style | Lobby name | Offered in the lobby | Purchases | Most squads | Attacks the enemy headquarters | Haulers kept | Hero |
|---|---|---|---|---|---|---|---|
| `easy` | easy | yes (the server default, `-bot=easy`) | one every 26 s | 5 | after 300 s; until then spare squads hold the middle | 1 | never |
| `normal` | normal | yes | one every 14 s | 8 | after 150 s | up to 2 | never |
| `standard` | relentless | yes | the moment it can | population cap (12) | from the start | up to 3 | yes, at most one per 150 s |
| `rush` | - | no, a server flag only: "a test opponent, not a difficulty" | the moment it can | cap | from the start: one squad on the home rig, everything else at the enemy headquarters | up to 2 | no |
| `tutorial` | - | no, the lesson's enemy | never buys | - | stands still until released, then sends its first squad at the land rig nearest the learner | - | no |

The numbers are `paces` in `server/bot/bot.go` and `haulersWanted`. The three structures every base opens with do not use up a paced level's turn to buy: "an easy enemy is slow to field squads, not slow to exist".

`CALLSIGN_BOT` (compose) or `-bot` sets the server's usual level; set but empty plays with no scripted enemy. The match's maker can choose the level per match in the lobby (`BotLevels`).

## What it does each turn

`Player.Act(snapshot)` returns the commands it wants. In order:

1. **Orders for the squads it has.** The first line-infantry squads hold a fixed list of points (`infantryPlan`: the nearest land rig, then the second-nearest, nearest and third-nearest plain points). Boats hold the sea rig. Aircraft are the reserve: they attack the enemy squad nearest home that they can hurt, else wait over the forward point. Armour, specialists and spare infantry press the target (the enemy headquarters, or the middle of the map before a paced level's attack time). A hero waits at the forward point and goes out for its own work (plant or seize).
2. **Raids** (`raid`). On normal and relentless the second line-vehicle squad attacks the enemy's refinery, or else what makes its units. On relentless the first one hunts any enemy hauler in sight, and for 45 seconds in every 150 attacks the enemy's home field.
3. **Economy first.** A lost hauler is replaced before anything else, unless an armed enemy is within 450 of its headquarters (`besieged`).
4. **Base upkeep** (`upkeep` in `base.go`). The base grows by the opening the game works out (`Snapshot.Opening`, see [[Power]]): power, refinery and barracks at once, rebuilt first when they fall; works, radar and airbase when the next unit wanted needs them or when there is gold to spare beyond a reserve of 300. A structure under two thirds of its strength is mended when the side is rich. Once armour is out, one defence goes up at the front. It sells nothing and sets no rally point.
5. **Buying.** A naval squad first if it has none, then line infantry up to 5, line vehicles up to 2, one line air squad, two specialists, then a hero when its level fields one. The "line" unit of a class is the cheapest of that class.

It never buys strike aircraft: it has no plan for sorties (commit `315ee23`). It only ever issues commands through `Sim.Apply`, so everything it does is checked like a player's.

## Tests that hold it

`TestEveryEnemyLevelPlaysTheWholeGameOnEveryMap` in `server/sim/terrain_test.go`: every level, on every map, from a bare headquarters, builds a refinery and a barracks, raises at least a third squad and takes a point, with no command of its refused on the way.

## History

- 2026-11-23: a scripted player ships with the first simulation (`7249ffe`).
- 2026-11-24: easy and normal levels that buy at a human pace (`2bc06de`); the level chosen per match in the lobby (`54d3946`); it keeps its base in power (`a78660e`); it follows the opening the game works out and mends when rich (`07bb92a`).

## Related

- [[Game Design]]
- [[Balance]]
- [[First Lesson]]
- [[Match Rules and Winning]]
- [[Rooms, Hub and Lobby]]
- [[Rule Brain]]
- [[Server Flags]]
