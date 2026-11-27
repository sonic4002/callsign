---
title: Traffic Levels
description: "'Radio traffic' is a page setting with three levels — Quiet, Normal, Full — that decides how much of the command net the commander is shown and hears."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/code
  - area/radio-net
  - topic/radio
  - topic/traffic
  - topic/settings
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Command Net and Squad Net]]"
  - "[[Base Cues]]"
  - "[[Report Suppression]]"
  - "[[Radio Net]]"
  - "[[Settings]]"
  - "[[Radio Console]]"
  - "[[Text to Speech Service]]"
paths:
  - shared/rules.json
  - shared/rules.go
  - server/room/traffic.go
  - server/room/cues.go
  - client/nets.js
  - client/cues.js
  - client/debug.js
  - client/i18n/en.json
  - client/i18n/he.json
---

# Traffic Levels

"Radio traffic" is a page setting with three levels — Quiet, Normal, Full — that decides how much of the command net the commander is shown and hears. The server stamps every message with the least level that shows it; the page filters. Nothing is withheld from the wire.

## The setting

| Level | English | Hebrew | What it shows |
|---|---|---|---|
| 1 | Quiet | שקט | Only what needs the commander, and the answers to their own orders |
| 2 | Normal (default) | רגיל | Also one line for each new contact and each objective reached |
| 3 | Full | מלא | Everything, including the squad net's lines |

The label is "Radio traffic" / "עומס ברשת". It is kept in the browser's `localStorage` under `callsign.traffic` (`client/nets.js`); anything else stored there falls back to Normal. The voice follows it: only lines the command net shows are spoken (`heard`).

Help text in the page: "A squad you ordered yourself always reports to you." / "כיתה שקיבלה פקודה ישירות ממך תמיד מדווחת לך."

## Level by kind of line

From `shared/rules.json` → `radio.traffic.levels`. `Rules.validate` requires a level from 1 to 3 for every kind.

| Kind | Level | Shown at |
|---|---|---|
| `order` | 1 | Quiet, Normal, Full |
| `answer` | 1 | Quiet, Normal, Full |
| `ask` | 1 | Quiet, Normal, Full |
| `cue` | 1 | Quiet, Normal, Full (unless the cue sets its own level) |
| `loss` | 1 | Quiet, Normal, Full |
| `contact` | 2 | Normal, Full |
| `objective` | 2 | Normal, Full |
| `notice` | 3 | Full |
| `status` | 3 | Full |
| `ack` | 3 | Full |

Overrides in code (`classify`):

- Any line not addressed to Hammer or All stations is on the squad net with level 3, whatever its kind.
- A line to Hammer from a squad Hammer ordered by name is level 1, whatever its kind.
- The sign-off at the end of a match is level 1.

The kinds are explained in [[Command Net and Squad Net]].

## Level by base cue

A cue uses the `cue` level (1) unless it has a `level` of its own in `radio.cues` (`Room.cueLevel`):

| Cue | Level |
|---|---|
| `powerRestored` | 2 |
| `haulerUnderAttack` | 2 |
| `enemyHeroFallen` | 2 |
| every other cue | 1 |

See [[Base Cues]].

## The timing values

Also in `radio.traffic`, in seconds:

| Key | Value | Used for |
|---|---|---|
| `reportWindow` | 45 | Several squads meeting the same thing inside this window make one report (see [[Report Suppression]]) |
| `eventSeconds` | 20 | How long the event that woke a squad counts as what its next line is about |
| `answerSeconds` | 30 | How long after Hammer's call a station's line to Hammer counts as the answer |

## The page's own event lines

The log also has lines the page writes itself from `event` frames. `eventLevels` in `client/nets.js` gives their levels; an event not listed is shown always (level 1).

| Level | Events |
|---|---|
| 2 Normal | `enemy_destroyed`, `structure_lost_theirs`, `structure_repaired`, `building_fell`, `bridge_under_attack`, `bridge_repaired`, `charge_planted`, `charge_blew`, `promoted` |
| 3 Full | `upgraded`, `deploying`, `structure_started`, `garrisoned`, `fortified`, `crushed` |

The reasoning in the code comment: that something was *started or bought* is said at Full only, because the build panel and squad list show it and the operator's cue says when it is ready — otherwise an operator buying on its own would fill the net (commits `402d7a0`, `7ba7cb4`, `0411844`, from a played match on 2026-11-25).

## Why it exists

Commit `d205abc` (2026-11-25): "every line has a kind, a net and a level; one squad reports what several meet; the operator's bare Roger to a squad is not sent." Before it, every agent line reached the commander's log and voice.

## Related

- [[Radio Net]]
- [[Command Net and Squad Net]]
- [[Report Suppression]]
- [[Base Cues]]
- [[Settings]]
- [[Radio Console]]
- [[Text to Speech Service]]
