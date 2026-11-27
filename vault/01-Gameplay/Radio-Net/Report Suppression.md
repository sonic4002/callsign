---
title: Report Suppression
description: "The net stays quiet by code: one squad reports what several squads meet, a bare Roger from the operator to a squad is not sent, and each base cue has a gap before it may repeat."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/code
  - area/gameplay
  - topic/radio
  - topic/traffic
  - topic/server
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Agent Loop]]"
  - "[[Base Cues]]"
  - "[[Radio Console]]"
  - "[[Radio Net and Bilingual Procedure]]"
  - "[[Traffic Levels]]"
  - "[[Command Net and Squad Net]]"
  - "[[Initiative - Orders, Fight and Purse]]"
  - "[[Squad Leaders]]"
paths:
  - server/room/traffic.go
  - server/room/traffic_test.go
  - server/room/room.go
  - server/room/cues.go
  - server/room/tools.go
  - shared/rules.json
  - agents/agent.mjs
  - client/cues.js
---

# Report Suppression

The net stays quiet by code: one squad reports what several squads meet, a bare Roger from the operator to a squad is not sent, and each base cue has a gap before it may repeat. All of it lives in `server/room/traffic.go` and `server/room/cues.go` and uses only what the room already knows; no model decides what is a duplicate.

## The windows

From `shared/rules.json` → `radio.traffic` (seconds; converted to ticks at 10 ticks per second by `Room.seconds`):

| Key | Seconds | Meaning |
|---|---|---|
| `reportWindow` | 45 | Squads of one side that meet the same enemy or reach the same place inside this window share one report |
| `eventSeconds` | 20 | A squad's line counts as being about the event that woke its leader for this long |
| `answerSeconds` | 30 | A line to Hammer within this time of Hammer's call to that station (or to all stations) is the answer |

## One report per event

What the room remembers per side (`traffic` struct):

| Map | Holds |
|---|---|
| `pending` | squad id → the event its leader was last woken by (kind, shared key, tick) |
| `noticed` | shared key → which squad met it first, and when |
| `called` | station key → tick of Hammer's last call to it |
| `hammers` | squads Hammer ordered by name |

Shared keys (`noticeOf`): `contact:<enemy squad id>` for a contact, `at:<structure | place | point>` for arriving or going inside. Losses, being pinned, digging in and the like are a squad's own affair and have no key, so they are never suppressed.

### Step 1: the event (`heardEvent`, called from `Room.Tick`)

When the simulation emits an event for a squad:

1. It is stored in `pending` for that squad.
2. If it has a key and another squad of the side was first with that key within `reportWindow`, the event frame sent to the side carries `"known": true`.
3. For a contact, every *other* enemy the squad has in sight is also recorded under this squad as first, so squads moving together meet a group together and one report covers it.
4. A squad Hammer ordered by name is never told `known`.

An agent that receives a `known` event is told in its wake: "Another squad has already reported this on the net: act if you need to, and do not report it again." A leader whose thinking costs money skips a `known` contact altogether (`agents/agent.mjs`; see [[Agent Loop]]).

### Step 2: the transmission (`classify`)

If a squad transmits anyway while its pending event is fresh (within `eventSeconds`), has a key, and another squad was first inside `reportWindow`, the line is dropped: `not sent: another squad has already reported this`. Exception: a squad that is Hammer's, speaking to Hammer, is never dropped.

A dropped line is not an error. `transmit` returns `ErrDropped`, and the `radio` tool answers `{"sent":"","dropped":"<reason>"}`.

### What ends an event's news

`noteCall`: when Hammer or the operator calls a squad by name, that squad's pending event is deleted — what it says next answers the call. A call to All stations clears every squad's pending event.

## The operator's bare Roger

A transmission from the operator whose body is only Roger or Wilco (`Net.BareAck`), and that is not addressed to Hammer or All stations, is dropped: `not sent: a report needs no acknowledgement`. The reason in the code: the squad's leader would be woken just to read it.

A bare acknowledgement that does go out (a squad's "Wilco, out") is kind `ack`, level 3 — or `answer`, level 1, when it answers Hammer's call. Agents do not wake for a line of kind `ack` (`agents/agent.mjs`).

## Base cue gaps

Each base cue has a `gap` in seconds; `Room.cue` drops a repeat of the same cue to the same side inside it. A base under fire says so once in 30 seconds, not with every shell. The gaps are listed in [[Base Cues]].

## Suppression on the page

Separate from the server, the page keeps the log short (`client/cues.js`):

| Mechanism | Rule |
|---|---|
| Folding (`foldLog`) | Events of the same kind following one another within `FOLD_TICKS` = 150 ticks (15 s) become one line with a count. Base cues lying between them do not break the run |
| One line per piece of news (`cued`) | When a base cue tells of an event, the page does not write its own line for the same event |
| Phone strip (`stripPick`) | Of the last 10 lines, radio addressed to the player first, then other radio, then system lines |

See [[Radio Console]].

## Not suppressed

- Anything Hammer sends.
- A squad's own-affair reports (losses, pinned).
- Reports to Hammer from Hammer's own squads.
- The same thing met again after `reportWindow` has passed: the later squad becomes "first".

## History

- `d205abc` (2026-11-25) introduced kinds, nets, levels, one report per event and the dropped Roger.
- `fb0c10a` (2026-11-25): the operator sums a fight up for Hammer once and is not woken per squad or by a bare Wilco; a squad stays quiet about what another met first.
- `075c6e0` (2026-11-24), earlier and agent-side: "an enemy the net just heard named is not reported again".
- `7078ad4`: an end-to-end test that a squad says once where it is.

## Related

- [[Radio Net and Bilingual Procedure]]
- [[Traffic Levels]]
- [[Command Net and Squad Net]]
- [[Base Cues]]
- [[Initiative - Orders, Fight and Purse]]
- [[Agent Loop]]
- [[Squad Leaders]]
- [[Radio Console]]
