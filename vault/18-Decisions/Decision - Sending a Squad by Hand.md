---
title: Decision - Sending a Squad by Hand
description: "Selecting a squad and tapping the map gives it a move, hold or attack order at once on the server; the squad answers Wilco by code with no model call."
type: decision
status: current
tags:
  - type/decision
  - status/current
  - agent/CLD
  - origin/mixed
  - area/decisions
  - topic/orders
  - topic/direct-acts
created: 2026-11-27
updated: 2026-11-27
agent: CLD
origin: mixed
confidence: high
related:
  - "[[Decisions]]"
  - "[[Radio versus Direct Acts]]"
  - "[[Direct Acts]]"
  - "[[Selection and Map Orders]]"
  - "[[Decision - Command Sidebar]]"
  - "[[Decision - Direct Build and Buy]]"
  - "[[Places on the Radio]]"
  - "[[Net Language]]"
paths:
  - CLAUDE.md
  - server/room/act.go
  - server/room/act_test.go
  - server/room/tools.go
  - client/debug.js
  - agents/agent.mjs
decided: 2026-11-26
---

# Decision - Sending a Squad by Hand

A squad the player selects and sends by tapping the map obeys in the same server tick. This is the one exception to "orders to squads go by radio".

## The decision as written

> **Sending a squad by hand** (owner, 2026-11-26: "apply the task immediately and make the unit response with יבוצע סוף ... no need the whole radio recognition cycle"): selecting a squad and tapping the map gives it a move, hold or attack order at once on the server, and the squad answers "Wilco, out" by code with no model call. Every other order to a squad, and anything spoken or typed, is still a radio call that its leader reads.

| | |
|---|---|
| Date | 2026-11-26 |
| Decided by | the owner |
| Replaced | "Orders to squads go only by radio" in [[Decision - Command Sidebar]], for these three orders |

## Why

A tapped move first went out as a radio call that the squad's leader had to read and act on: three to six seconds with a language model, and the leader could misread the spot. The owner wanted the tap to act at once.

## How the code stands

- **Server** (`server/room/act.go`, `directOrder`): the `act` frame named `order` takes `{squad, order, place | contact}`. Only the side's commander may send it, only for a living squad of that side, and only `move`, `hold` or `attack`; anything else is refused with the reason. The order is applied by the same code a squad leader's tool call uses.
- **The answer:** the squad transmits "Wilco" / "יבוצע" with "Out" / "סוף", composed by the server in the commander's language and marked as an acknowledgement.
- **Whose squad:** it is marked as ordered by Hammer by name, so the operator plans around it and it reports to Hammer ([[Command Net and Squad Net]]).
- **Agents** (`agents/agent.mjs`): the side is told in a `direct` frame that wakes nobody; the squad's own leader notes whose order it is on.
- **Page** (`client/debug.js`): a tap on open ground with a squad selected sends `move` to the exact spot; the move, hold and attack buttons of the map menu use the same path. Capture, repair, plant, dig in and cover stay radio calls.

Covered by `TestTheCommanderSendsASquadByHandAndItAnswersWilco`. The open-ground tap was checked on the running game on 2026-11-26; the menu buttons were not pressed there.
