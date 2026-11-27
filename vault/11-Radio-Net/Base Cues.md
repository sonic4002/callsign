---
title: Base Cues
description: "Base cues are short fixed lines the operator 'says' about the base on its own: construction complete, not enough gold, our base is under attack."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/code
  - area/radio-net
  - topic/radio
  - topic/cues
  - topic/operator
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Traffic Levels]]"
  - "[[Radio versus Direct Acts]]"
  - "[[Net Language]]"
  - "[[Radio Net]]"
  - "[[Report Suppression]]"
  - "[[Command Net and Squad Net]]"
  - "[[Operator - Anvil]]"
  - "[[Structures and Build Tree]]"
  - "[[Power]]"
  - "[[Heroes]]"
paths:
  - shared/rules.json
  - shared/rules.go
  - server/room/cues.go
  - server/room/cues_test.go
  - server/room/tools.go
  - server/room/room.go
  - client/cues.js
  - agents/agent.mjs
---

# Base Cues

Base cues are short fixed lines the operator "says" about the base on its own: construction complete, not enough gold, our base is under attack. The server writes them from `shared/rules.json` (`radio.cues`) in the net's language and sends them in Anvil's name to that side's commander; no model is asked and no agent is woken.

## How a cue is sent (`Room.cue`)

1. An event from the simulation (or a refused purchase) is mapped to a cue key by `cueOf` / `cueRefusal`.
2. If the same cue was sent to that side less than its `gap` seconds ago, it is dropped.
3. The line is taken in the commander's language (`cueLang`: Hebrew if Hammer's language is `he`, else English) and its `{placeholders}` filled. If a placeholder has no value the cue is not sent ("say nothing rather than half of it").
4. `Net.Compose` writes it as "Hammer, this is Anvil. <line>. Out." / "פטיש, כאן סדן, <line>, סוף."
5. It goes into the side's log and is broadcast as a `radio` message with `cue` set to the key, kind `cue`, net `command`, and the cue's level (1 unless it sets its own).

Cues are appended directly, not through `transmit`, so they do not count as the operator calling anyone and are not classified or dropped by the traffic rules.

## The nineteen cues

Gap in seconds; level is the least [[Traffic Levels|traffic level]] that shows it.

| Key | Gap | Level | English | Hebrew |
|---|---|---|---|---|
| `structureReady` | 1 | 1 | Construction complete: {structure} | הבנייה הושלמה: {structure} |
| `newOptions` | 1 | 1 | Construction complete: {structure}. New options available | הבנייה הושלמה: {structure}. נפתחו אפשרויות חדשות |
| `unitReady` | 2 | 1 | {squad} in the field | {squad} בשטח |
| `noGold` | 8 | 1 | Not enough gold | אין מספיק זהב |
| `lowPower` | 20 | 1 | Low power | מחסור בחשמל |
| `powerRestored` | 5 | 2 | Power restored | החשמל חזר |
| `baseUnderAttack` | 30 | 1 | Our base is under attack | הבסיס שלנו מותקף |
| `haulerUnderAttack` | 20 | 2 | {unit} under attack near {point} | מתקיפים את {unit} ליד {point} |
| `haulerLost` | 2 | 1 | We lost {unit} near {point} | איבדנו את {unit} ליד {point} |
| `structureLost` | 2 | 1 | We lost {structure} | איבדנו את {structure} |
| `structureTaken` | 2 | 1 | {structure} is ours | {structure} בידינו |
| `structureSold` | 1 | 1 | {structure} sold | {structure} נמכר |
| `repairStopped` | 10 | 1 | Repairs stopped: not enough gold | התיקון נעצר: אין מספיק זהב |
| `deployLost` | 2 | 1 | We lost a {unit} with the structure that was making it | איבדנו {unit} עם המבנה שייצר אותו |
| `queueFull` | 8 | 1 | The line is full | התור מלא |
| `heroReady` | 1 | 1 | {hero} is in the field | {hero} בשטח |
| `heroFallen` | 1 | 1 | {hero} is down | {hero} נפל |
| `enemyHero` | 1 | 1 | Warning: enemy hero in the field: {hero} | אזהרה: גיבור אויב בשטח: {hero} |
| `enemyHeroFallen` | 1 | 2 | The enemy's {hero} is down | {hero} של האויב נפל |

`Rules.validate` requires every cue to have a line in both languages, a gap of zero or more and a level of at most 3.

## What triggers each

From `cueOf` in `server/room/cues.go`:

| Cue | Trigger |
|---|---|
| `structureReady` | `structure_built` for a structure that unlocks nothing |
| `newOptions` | `structure_built` for a structure whose definition has `unlocks` |
| `unitReady` | A squad spawned after the first second of the match (starting squads are not news), and not a hero |
| `heroReady` / `enemyHero` | A hero takes the field: the owner hears its name and callsign, the other side hears what it is |
| `heroFallen` / `enemyHeroFallen` | A hero falls, same split |
| `baseUnderAttack` | `hq_under_attack` or `structure_attacked` |
| `haulerUnderAttack` | `hauler_attacked`; {unit} is the hauler's unit name, {point} the nearest point's callsign |
| `haulerLost` | A hauler is lost |
| `structureLost` | One of the side's own structures falls; or a structure is captured from the side; or a tech building is lost (`tech_lost`) |
| `structureTaken` | The side captures a structure |
| `noGold` | A `buy` or `build` tool call refused with `sim.ErrNoGold` (`cueRefusal`) |
| `queueFull` | A `buy` or `build` tool call refused with `sim.ErrLineFull` |
| `lowPower`, `powerRestored`, `structureSold`, `repairStopped`, `deployLost` | By name: the cue lists the simulation event kinds in its `events` field (`low_power`, `power_restored`, `structure_sold`, `repair_stopped`, `deploy_lost`), so a cue can be attached to an event in the rules alone |

Not cued on purpose: an enemy structure falling, and a captured structure that was never the side's and was only "seen" — "the squad that saw it reports it".

`noGold` and `queueFull` come from `Room.Tool`, the agents' path. Whether a refusal of the commander's direct act also raises them: the code in `Room.Act` does not call `cueRefusal`; the page shows the refusal on the card instead (see [[Radio versus Direct Acts]]).

## How agents treat a cue

- The operator's own agent never answers its own voice, and a cue is addressed to Hammer, so no squad is addressed (comment in `cues.go`; commit `361b145`: "a base cue wakes nobody").
- The hauler news belongs to the cue, so the scripted operator no longer repeats it (commit `c18934f`).
- An answer from Anvil's agent is not a cue: only server-written lines carry `cue` (test from commit `61cf6f3`).

## On the page

`client/cues.js`:

- A cue line is marked in the log with a small drawn beacon (`cueMark`), so it is not taken for something the operator's agent decided to say.
- The page does not write its own event line for news a cue already tells (`cued`).
- Cues are spoken by default; the setting `callsign.cueVoice` (`cueVoice`) turns their voice off and leaves them written.

## History

- `ccf7757` (2026-11-24): base cues introduced, "from fixed lines in the net's language".
- `ff514d7`: cues for a sale, a repair stopped for gold, a unit lost with its structure and a full line; each piece of news is one line in the log.
- `8b35479`: the page tells the game its language so the first cues come in it (see [[Net Language]]).
- `5f6c920` / `5317c8b`: with direct build and buy, Anvil is told and its cue announces when the thing is ready.

## Related

- [[Radio Net]]
- [[Traffic Levels]]
- [[Report Suppression]]
- [[Command Net and Squad Net]]
- [[Radio versus Direct Acts]]
- [[Net Language]]
- [[Operator - Anvil]]
- [[Structures and Build Tree]]
- [[Power]]
- [[Heroes]]
- [[Economy]]
