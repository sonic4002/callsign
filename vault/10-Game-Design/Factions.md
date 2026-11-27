---
title: Factions
description: "The game has two factions, Aegis Directorate and Ashfall Network, defined under factions in shared/rules.json."
type: concept
status: current
tags:
  - type/concept
  - status/current
  - agent/CLD
  - origin/mixed
  - area/game-design
  - topic/game-design
  - topic/factions
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Units - Aegis]]"
  - "[[Units - Ashfall]]"
  - "[[Structures and Build Tree]]"
  - "[[Server Flags]]"
  - "[[Prompts]]"
  - "[[Game Design]]"
  - "[[Heroes]]"
  - "[[Strike Aircraft]]"
  - "[[Balance]]"
  - "[[Plan versus Code]]"
paths:
  - shared/rules.json
  - docs/PLAN.html
  - server/sim/terrain_test.go
---

# Factions

The game has two factions, Aegis Directorate and Ashfall Network, defined under `factions` in `shared/rules.json`. Each has its own units and its own structure for every role, with different names and numbers; the rules of play are the same for both.

## The two factions

| | Aegis | Ashfall |
|---|---|---|
| id | `aegis` | `ashfall` |
| English name | Aegis Directorate | Ashfall Network |
| Hebrew name | מנהלת אגיס | רשת אפר |
| Starting squads (`startUnits`) | 2 x `commandos` | 2 x `militia` |
| Character in the numbers | Fewer, stronger, dearer: a commando squad is 3 teams of 2 at 66 hp each | More, weaker, faster to make: a militia cell is 4 teams of 3 at 50 hp each |
| Headquarters | Command Post / מוצב הפיקוד | The Den / המאורה |
| Hero | Sentinel / זקיף (stealth, demolition charges) | Oracle / חוזה (disguise, seizes vehicles, dread) |
| Strike aircraft | Strike jet / מטוס תקיפה | Prop bomber / מפציץ מדחף |
| Hauler | Ore crawler / זחל כרייה | Gold truck / משאית זהב |
| Siege unit | Precision rocket launcher | Rocket team |
| Engineers | Combat engineers / הנדסה קרבית | Sappers / חבלנים |

Full tables: [[Units - Aegis]], [[Units - Ashfall]], [[Structures and Build Tree]].

## Unit line-up by class

| Class | Aegis | Ashfall |
|---|---|---|
| infantry | commandos, engineers, sentinel (hero) | militia, rpgTeam, sappers, oracle (hero) |
| vehicle | tank, rocketLauncher | technical |
| naval | patrolBoat | speedboat |
| air | helicopter, strikeJet | fpvSwarm, propBomber |
| hauler | crawler | dumpTruck |

## Which side plays which faction

A match has two sides, 0 (west, headquarters at Alpha) and 1 (east, headquarters at Zulu). The factions of the two sides are set for the whole server by its `-west` and `-east` flags (default `aegis` and `ashfall`, see [[Server Flags]]) and passed to every room as `HubConfig.Factions`; the lobby reports them as `factions` but offers no choice of faction. So with the defaults the west side is always Aegis and the east side Ashfall, and a player picks a faction by picking a side. The balance test plays both pairings from both ends.

## Captured structures and foreign units

A structure that is `capturable` can be taken by enemy engineers. A captured production structure makes the units of the faction that built it (`makes` in `server/sim/queue.go`, `ForeignUnits` in `server/sim/structures.go`), so a side can field squads that are not of its own design.

## Differs from the plan

`docs/PLAN.html` describes doctrines ("Fewer soldiers, sharper eyes" / "They can't hit what they can't find"), a per-faction doctrine prompt and agent bias, a longer unit list (recon drones, interceptor dome, tunnels, traps, decoys) and three later factions (Iron Bloc, Hornet Collective, Tidewall Union). The plan also says Ashfall has no air; in the code Ashfall has the drone swarm and the prop bomber. Whether prompts differ by faction is covered in [[Prompts]]. The later factions are not in the code.

## Related

- [[Game Design]]
- [[Units - Aegis]]
- [[Units - Ashfall]]
- [[Structures and Build Tree]]
- [[Heroes]]
- [[Strike Aircraft]]
- [[Balance]]
- [[Plan versus Code]]
