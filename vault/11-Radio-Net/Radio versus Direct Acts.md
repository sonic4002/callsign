---
title: Radio versus Direct Acts
description: "Most of the game is commanded by voice or text on the radio, but some things the commander does by hand, at once, with no agent in between: building, buying, cancelling, selling, repairing, ..."
type: concept
status: current
tags:
  - type/concept
  - status/current
  - agent/CLD
  - origin/mixed
  - area/radio-net
  - topic/radio
  - topic/direct-acts
  - topic/client
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Base Cues]]"
  - "[[Traffic Levels]]"
  - "[[Procedure Words]]"
  - "[[Initiative - Orders, Fight and Purse]]"
  - "[[Places on the Radio]]"
  - "[[Radio Net]]"
  - "[[Direct Acts]]"
  - "[[Selection and Map Orders]]"
  - "[[Build Bar]]"
  - "[[Decision - Direct Build and Buy]]"
paths:
  - server/room/act.go
  - server/room/act_test.go
  - server/room/ws.go
  - server/room/command.go
  - client/debug.js
  - agents/agent.mjs
  - CLAUDE.md
---

# Radio versus Direct Acts

Most of the game is commanded by voice or text on the radio, but some things the commander does by hand, at once, with no agent in between: building, buying, cancelling, selling, repairing, setting a rally point, and — since 2026-11-26 — sending a selected squad to move, hold or attack by tapping the map. This note says which is which and how the hand-made acts still show up on the net.

## The split

| Thing | By hand (`act` frame) | By radio |
|---|---|---|
| Build a structure | Yes: `build` | Also: ask Anvil |
| Buy a unit | Yes: `buy` | Also: ask Anvil |
| Upgrade a squad's leader | No: refused, "an upgrade is asked of the operator on the radio" | Yes, to Anvil (the page's upgrade button composes and transmits that call) |
| Cancel the last unit in a line | Yes: `cancel` | Also |
| Sell a structure | Yes: `sell` | Also |
| Repair a structure (for gold) | Yes: `repair` | Also |
| Set a rally point | Yes: `rally` | Also |
| Squad: move, hold, attack | Yes: `order` with `squad`, `order`, and a place or contact | Yes |
| Squad: anything else (cover, fall back, capture, repair, dig in, plant a charge, seize, report…) | No: "a squad is sent by hand to move, hold or attack; "<x>" is asked on the radio" | Yes |
| Hand over the fight, the purse | No (the page's switch transmits the fixed phrases) | Yes |
| Send haulers to a field | No | Yes, to Anvil |

Constants `ActBuild`, `ActBuy`, `ActCancel`, `ActSell`, `ActRepair`, `ActRally`, `ActOrder` in `server/room/act.go`.

## How a direct act runs (`Room.Act`)

1. The page sends `{"type":"act","id":n,"name":"<act>","args":{...}}`.
2. Only a commander's seat may act, and only for its own side (`ErrNotCommander`: "only a side's commander builds and buys from the panel"); never after the match is over.
3. The room sets `rm.direct` and calls the *same* functions the operator's tools use (`toolBuild`, `toolBuy`, `toolCancel`, `toolSell`, `toolMend`, `toolRally`), so the checks are the game's own: gold, the build tree, placement, power, caps, the production line. With `direct` set, `mayBuy` needs no leave and announces nothing.
4. The answer goes to that client as `{"type":"acted","id":n,"act":...,"ok":true|false,"data"|"error"}`. A refusal is shown on the card or button it came from, and as a warning line in the log.
5. On success the whole side gets `{"type":"direct","act":...,"tick":...,"result":...,"lang":...}`.

## How the net learns of it

A direct act is not a transmission and wakes nobody.

- **The `direct` frame.** The page ignores it (it reads the state). The operator's agent keeps a line about it in its picture of recent traffic (the last 8 lines), without being woken (`agents/agent.mjs`). The frame also carries the commander's language, so the agents write in it.
- **Base cues.** The operator's cue announces the structure or the squad when it is *ready* ("Construction complete: …", "Viper 3 in the field"), as for anything else. See [[Base Cues]].
- **The page's own lines.** That something was started or bought is written in the log at Full traffic only (`structure_started`, `deploying` in `client/nets.js`). See [[Traffic Levels]].

## A squad sent by hand (`directOrder`)

Selecting a squad and tapping open ground, or choosing move / hold / attack in the map menu (`BY_HAND` in `client/debug.js`):

1. The order is applied in the same tick through `orderSquad`, the function the squad's own tools use.
2. The squad is marked as Hammer's own (`traffic.hammers`): the operator plans around it and it reports to Hammer.
3. The squad acknowledges **by code**, with no thought of its leader's: "Hammer, this is Viper 2. Wilco. Out." / "פטיש, כאן צפע 2, יבוצע, סוף." — a real radio message, sent with the tag `ack` (in English it is classified `ack`; for the Hebrew body see the caveat in [[Procedure Words]]).
4. The squad's leader agent, on the `direct` frame, notes that its commander is Hammer and adds the order to its traffic, unwoken.

So a by-hand order produces exactly one line on the net (the Wilco); the order itself is never transmitted as text.

## What still goes only by radio, and why

`CLAUDE.md` (locked decision "Command sidebar", 2026-11-24): "Orders to squads go only by radio; the sidebar's order buttons only compose radio calls." The code now differs for the three plain orders: the comment in `act.go` records "owner, 2026-11-26" for sending a squad by hand, and commit `9e56316` implemented it. Everything else a squad can be told is still a radio call, and the menu items that are not in `BY_HAND` still compose and transmit a call (`order()` in `client/debug.js`).

Differs from `CLAUDE.md`: the "Command sidebar" decision has not been updated for tap-to-order.

## Radio paths that remain for the same things

Asking Anvil on the radio to build or buy still works: Anvil's `build` and `buy` tools run under the initiative rules (an order from Hammer in the last 90 seconds, or the purse). See [[Initiative - Orders, Fight and Purse]]. A place for a structure can be said as an exact spot ("140 metres north and 60 east of Alpha"); see [[Places on the Radio]].

## History

| Date | Commit | Change |
|---|---|---|
| 2026-11-24 | `0959327` | A squad, a place and an action picked on the map are transmitted at once (as a radio call) |
| 2026-11-24 | `5f6c920`, `9a9e5b5`, `5317c8b` | The owner's decision: building and buying from the panel act at once; the room's `act` path; Anvil is told and announces readiness |
| 2026-11-26 | `c2d99ae`, `9e56316` | Tap open ground to send the selected squad; it obeys at once and answers Wilco by code |

The owner's recorded reason for direct build and buy: "no need to wait for anvil to approve it, its a waste of time" (`CLAUDE.md`).

## Related

- [[Radio Net]]
- [[Direct Acts]]
- [[Initiative - Orders, Fight and Purse]]
- [[Base Cues]]
- [[Traffic Levels]]
- [[Selection and Map Orders]]
- [[Build Bar]]
- [[Decision - Direct Build and Buy]]
- [[Decision - Command Sidebar]]
- [[WebSocket Frames]]
