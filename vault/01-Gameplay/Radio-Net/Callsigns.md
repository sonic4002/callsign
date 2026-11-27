---
title: Callsigns
description: "Every voice on a side's net has a callsign in English and Hebrew, held in shared/rules.json under callsigns."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/code
  - area/gameplay
  - topic/radio
  - topic/callsigns
  - topic/hebrew
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Operator - Anvil]]"
  - "[[Heroes]]"
  - "[[Strike Aircraft]]"
  - "[[Places on the Radio]]"
  - "[[Hints and Tidy Step]]"
  - "[[Radio Net and Bilingual Procedure]]"
  - "[[Radio Routing]]"
  - "[[Map Point Letters]]"
  - "[[Procedure Words]]"
  - "[[Net Language]]"
paths:
  - shared/rules.json
  - shared/rules.go
  - server/radio/radio.go
  - server/sim/sim.go
  - server/room/room.go
  - client/map.js
---

# Callsigns

Every voice on a side's net has a callsign in English and Hebrew, held in `shared/rules.json` under `callsigns`. Squads are a class word plus a number ("Viper 2" / "צפע 2"); the commander and the operator have fixed names.

## Fixed stations

| Station | English | Hebrew | Station key | Who it is |
|---|---|---|---|---|
| Player | Hammer | פטיש | `player` | The human commander of the side |
| Operator | Anvil | סדן | `operator` | The side's operator agent (see [[Operator - Anvil]]) |
| All stations | All stations | כל התחנות | `all` | Every station on the side's net |

Both sides use the same names; each side has its own net, so there is one Hammer and one Anvil per net.

## Squad callsigns by class

A squad answers to the callsign class of its unit: the unit's `callsign` field in the rules when it has one, otherwise its `class` (`Unit.CallClass` in `shared/rules.go`).

| Callsign class | English | Hebrew | Units that use it |
|---|---|---|---|
| `infantry` | Viper | צפע | Aegis: Combat engineers, Commandos. Ashfall: Sappers, Militia cell, Rocket team |
| `vehicle` | Rhino | קרנף | Aegis: Main battle tank, Precision rocket launcher. Ashfall: Technical |
| `air` | Hawk | בז | Aegis: Attack helicopter. Ashfall: Drone swarm |
| `naval` | Shark | כריש | Aegis: Patrol boat. Ashfall: Speedboat |
| `ghost` | Ghost | רפאים | Aegis hero: Sentinel (see [[Heroes]]) |
| `raven` | Raven | עורב | Ashfall hero: Oracle |
| `comet` | Comet | שביט | Aegis Strike jet, Ashfall Prop bomber (see [[Strike Aircraft]]) |

## Names that are not stations

| Name | English | Hebrew | Meaning |
|---|---|---|---|
| `callsigns.contact` | Target | מטרה | An enemy squad in sight is "Target N", N being its contact id. See [[Places on the Radio]] |
| `callsigns.hauler` | Hauler | מוביל | The name a hauler is shown under ("Hauler 2"). Haulers are not on the net: `Sim.Callsign` gives them this name "for the player to read" only |

## Numbering

- Numbers are per side and per callsign class: `side.nextNum[class]` is incremented for each new squad (`server/sim/sim.go`), so the first infantry squad is Viper 1, the first tank Rhino 1.
- A cancelled purchase that held the latest number gives it back (`server/sim/queue.go`).
- A squad seized by a hero changes side and takes the next number of its class there (`server/sim/hero.go`).
- Haulers are numbered apart from squads so buying one never shifts a squad's id.
- The stable key of a squad station is `<class>-<num>`, for example `infantry-2`, the same in both languages (`Station.Key`).

## How a callsign is recognised

`Net.station` reads one callsign from the front of lower-cased text:

1. The fixed names (both languages, longest first), each followed by a word boundary.
2. A class word, then optional spaces, `-` or `#`, then either one or two digits (greater than zero) or a number word.

Number words understood (`numberWords`):

| n | English | Hebrew |
|---|---|---|
| 1 | one | אחת, אחד |
| 2 | two | שתיים, שתים, שניים |
| 3 | three | שלוש, שלושה |
| 4 | four | ארבע, ארבעה |
| 5 | five | חמש, חמישה |
| 6 | six | שש, שישה |
| 7 | seven | שבע, שבעה |
| 8 | eight | שמונה |
| 9 | nine | תשע, תשעה |
| 10 | ten | עשר, עשרה |
| 11 | eleven | (none) |
| 12 | twelve | (none) |

So "Viper 2", "viper-2", "Viper two", "צפע 2" and "צפע שתיים" are the same station. `Net.Resolve` is the strict form used for the `to` argument of the agents' `radio` tool: the whole string must be one callsign, otherwise `unknown callsign`.

A callsign that is only roughly spelled or heard ("Vyper") is corrected on the page before sending, at strictness level 1 only; the server does no fuzzy matching. See [[Hints and Tidy Step]].

## Checks the room makes

- A squad addressee must be a living squad on the sender's side: otherwise `no station <name> on this net`.
- A station cannot call itself.
- Hammer naming a different sender ("…this is Anvil") is refused: `you are Hammer, not Anvil`.

## Differences from the docs

`CLAUDE.md` lists Hammer, Anvil, Viper, Rhino, Hawk and Shark. The code adds Ghost / רפאים, Raven / עורב and Comet / שביט, plus the non-station names Target / מטרה and Hauler / מוביל.

## Related

- [[Radio Net and Bilingual Procedure]]
- [[Radio Routing]]
- [[Map Point Letters]]
- [[Procedure Words]]
- [[Net Language]]
- [[Units - Aegis]]
- [[Units - Ashfall]]
- [[Squad Leaders]]
- [[Glossary]]
