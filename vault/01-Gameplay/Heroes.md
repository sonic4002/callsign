---
title: Heroes
description: "Each faction has one hero: a squad of a single exceptional soldier, of which only one may be alive at a time."
type: concept
status: current
tags:
  - type/concept
  - status/current
  - agent/CLD
  - origin/code
  - area/gameplay
  - topic/game-design
  - topic/heroes
  - topic/units
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Agent Tools]]"
  - "[[Game Overview]]"
  - "[[Units - Aegis]]"
  - "[[Units - Ashfall]]"
  - "[[Callsigns]]"
  - "[[Radar and Fog of War]]"
  - "[[Ranks and Brain Tiers]]"
  - "[[Balance]]"
  - "[[Base Cues]]"
paths:
  - shared/rules.json
  - shared/rules.go
  - server/sim/hero.go
  - server/sim/heroes_test.go
  - server/sim/heroes_tune_test.go
  - server/bot/hero.go
  - agents/heroes.mjs
  - client/heroes.js
---

# Heroes

Each faction has one hero: a squad of a single exceptional soldier, of which only one may be alive at a time. Aegis has the Sentinel, who is unseen until close and sets demolition charges; Ashfall has the Oracle, who passes for a bystander, takes over enemy vehicles and frightens the troops around it.

## Common rules

| Rule | Value |
|---|---|
| Made by | the barracks; also `needs` the works and the radar standing |
| Cost | 500 each |
| Deploy seconds | 15 |
| One alive at a time | `heroAllowed` refuses a second while the first lives or is on its way |
| Brain tier when fielded | 2 (`startTier`) |
| Captures points | no (`noCapture`) |
| Announced | both sides are told when a hero takes the field and when one falls (`hero_fielded`, `hero_fell`); the other side learns only what it is |

## The Sentinel (Aegis)

| Field | Value |
|---|---|
| id / Hebrew | `sentinel` / זקיף |
| Callsign | Ghost / רפאים |
| hp | 150 |
| Speed / range / sight | 31 / 280 / 320 |
| Rifle | damage 45, cooldown 20 ticks, accuracy 0.85 |
| `vs` | vehicle 0.12, naval 0.12, air 0.2, hauler 0.3, hq 0.05, structure 0.03, fence 0.1 |
| `stealth` | 95: an enemy sees it only from this close, or after it fires; a defence sees it at the defence's range |
| `charges` | 2 |
| `chargeDamage` | 1,200 to a structure or a bridge; a headquarters takes 30% (`chargeVsHQ`) |
| `plantSeconds` / `fuseSeconds` | 3 beside the target / 5 |

Order `plant` (`CmdPlant`): walk to an enemy structure or a bridge and set a charge. The charge burns down and its damage lands with the tick's other damage (`burn`). Events: `charge_planted`, `charge_blew`. To set one on a headquarters it stands 80 from its middle (`hqStandoff`).

## The Oracle (Ashfall)

| Field | Value |
|---|---|
| id / Hebrew | `oracle` / חוזה |
| Callsign | Raven / עורב |
| hp | 220 |
| Speed / range / sight | 33 / 150 / 280 |
| Weapon | damage 16, cooldown 7 ticks, accuracy 0.6 |
| `vs` | air 0.3, hq 0.05, structure 0.1, fence 0.3 |
| `disguise` | 85: enemy fireteams do not fire on it from farther than this, until it fires |
| `seizeRadius` / `seizeSeconds` | 240 / 3 |
| `dread` / `dreadRadius` | 0.17 stress a second on enemy fireteams within 185 |

Order `seize` (`CmdSeize`): close with an enemy vehicle squad and take it over. The hero works from `seizeRadius / 2` = 120 (`seizeReach`), near enough to hold the squad afterwards. A seized squad changes side and takes a number of its new side, so it has a callsign there; it is held only while the hero lives and stays within reach, and goes back when the grip is lost (`grip`, `release`; reasons `seized`, `returned`). A disguised hero on its way keeps its weapon down (`holdsFire`).

## Behaviour and brains

- A hero on its task keeps going under fire unless pinned, and goes inside only the building it was sent to (commit `a1686c2`).
- Hero squads are radio stations like any squad. Their leaders' tools and prompts are in `agents/heroes.mjs` ([[Agent Tools]]).
- The scripted enemy fields a hero only at its hardest level, and not again for 150 seconds after one falls (`heroEvery` in `server/bot/hero.go`; "the gentle levels never do").
- The page shows hero portraits and the charges (`client/heroes.js`, `assets/sprites/portraits`).

## Tuning

Commit `52b255d` tuned the hero numbers over 200 scripted games on the small map (100 seeds from each end, the relentless enemy fielding its hero): Aegis 96, Ashfall 104. That took the Sentinel's rifle down to 45 a shot, the Oracle up to 220 health with dread 0.17 within 185, and the rank bonuses down. The probe is `server/sim/heroes_tune_test.go`, run with `HEROES_TUNE=<seeds>`.

## Related

- [[Game Overview]]
- [[Units - Aegis]]
- [[Units - Ashfall]]
- [[Callsigns]]
- [[Radar and Fog of War]]
- [[Ranks and Brain Tiers]]
- [[Balance]]
- [[Base Cues]]
