---
title: Decision - Command Sidebar
description: "The client has a build panel, a radar (mini map), the gold and a squad roster, and orders to squads go only by radio, with the sidebar's order buttons only composing radio calls."
type: decision
status: current
tags:
  - type/decision
  - status/current
  - agent/CLD
  - origin/mixed
  - area/decisions
  - topic/client
  - topic/radio
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Build Bar]]"
  - "[[Radar and Fog of War]]"
  - "[[Page Layout]]"
  - "[[Direct Acts]]"
  - "[[Selection and Map Orders]]"
  - "[[Radio versus Direct Acts]]"
  - "[[Decision - Direct Build and Buy]]"
  - "[[Open Questions]]"
  - "[[Plan versus Code]]"
  - "[[Decisions]]"
paths:
  - CLAUDE.md
  - client/index.html
  - client/debug.js
  - server/room/act.go
  - docs/research/2026-11-24-classic-rts-play.md
---

# Decision - Command Sidebar

The client has a build panel, a radar (mini map), the gold and a squad roster, and orders to squads go only by radio, with the sidebar's order buttons only composing radio calls. Since 2026-11-26 the second half is no longer true of the code: move, hold and attack given on the map are sent by hand.

## The decision as written

> **Command sidebar** (2026-11-24): the client has a build panel, radar, gold and squad roster. Orders to squads go only by radio; the sidebar's order buttons only compose radio calls.

| | |
|---|---|
| Date | 2026-11-24, as dated in `CLAUDE.md` |
| Came with | the restyle of the page as an RTS screen with a command sidebar (commit `6dcfb63`) |
| Replaced | the Phase 0 debug page: dots on a map, a radio log and a text box |
| Owner's reason | not recorded |

## How the code stands

| Part | Code now |
|---|---|
| Build panel | exists, but since commit `cfcd2a8` (2026-11-24) it is a bar under the map on desktop and a sheet on phones, not part of the sidebar ([[Build Bar]]) |
| Radar | the mini map moved onto the map beside the zoom buttons (`81881ae`), and is dark without a powered radar structure ([[Radar and Fog of War]]) |
| Gold and roster | in the sidebar ([[Page Layout]]) |
| "Orders to squads go only by radio" | **out of date.** Commit `c2d99ae` (2026-11-26) lets a tap on open ground send the selected squad there, and `9e56316` makes it a direct act: the `act` frame with the name `order` carries move, hold or attack, the squad obeys at once and answers "Wilco, out" by code, with no model call ([[Direct Acts]], [[Selection and Map Orders]]) |
| Buttons that still only compose radio calls | cover, capture, dig in, plant, seize, mend, upgrade, handing over the fight and the purse ([[Radio versus Direct Acts]]) |

Building and buying were taken off the radio earlier by the owner's own decision: [[Decision - Direct Build and Buy]].

## What is not recorded

No document records the owner changing this decision for tap-to-order; the text in `CLAUDE.md` is unchanged. The research note of 2026-11-24 argued the other way ("Do not add orders that bypass the net"; no "click-to-move"). This is listed in [[Open Questions]] and [[Plan versus Code]].

## Related

- [[Decisions]]
- [[Decision - Direct Build and Buy]]
- [[Radio versus Direct Acts]]
- [[Selection and Map Orders]]
- [[Page Layout]]
- [[Open Questions]]
