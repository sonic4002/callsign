---
title: Decision - Direct Build and Buy
description: "Building a structure and buying a unit are the player's own act: pressing the card starts it at once on the server with no agent in between."
type: decision
status: current
tags:
  - type/decision
  - status/current
  - agent/CLD
  - origin/mixed
  - area/decisions
  - topic/build
  - topic/radio
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Direct Acts]]"
  - "[[WebSocket Frames]]"
  - "[[Traffic Levels]]"
  - "[[Base Cues]]"
  - "[[Initiative - Orders, Fight and Purse]]"
  - "[[Agent Tools]]"
  - "[[Decision - Command Sidebar]]"
  - "[[Locked Decisions]]"
  - "[[Build Bar]]"
  - "[[Radio versus Direct Acts]]"
paths:
  - CLAUDE.md
  - server/room/act.go
  - server/room/build.go
  - client/debug.js
---

# Decision - Direct Build and Buy

Building a structure and buying a unit are the player's own act: pressing the card starts it at once on the server with no agent in between. The net logs it and Anvil is told, so it can report when the thing is ready.

## The decision as written

> **Building and buying are the player's own act** (changed 2026-11-24 by the owner: "no need to wait for anvil to approve it, its a waste of time"): pressing a structure or a unit starts it at once on the server, with no agent in between. The net logs it, and Anvil is told so it can report when it is ready. Anvil can still build and buy when ordered by radio or when it holds the purse.

| | |
|---|---|
| Date | 2026-11-24 (commit `5f6c920` wrote it into `CLAUDE.md`) |
| Decided by | the owner |
| Owner's reason | "no need to wait for anvil to approve it, its a waste of time" |
| Replaced | the earlier rule that the build buttons composed a radio call to Anvil, who then built or bought with its tools and answered |

## What was built

- Commit `9a9e5b5`: the room lets the commander build, buy, cancel, sell, repair and set rally points directly.
- Commit `5317c8b`: the page and the agents follow: the panel acts at once with no call; Anvil is told and announces when it is ready.
- The commander's `act` frame carries the act; the side's agents get a `direct` frame that tells them without waking them ([[Direct Acts]], [[WebSocket Frames]]).
- What the net shows of it depends on the traffic level: that something was started is said at Full only; "ready" comes as a base cue ([[Traffic Levels]], [[Base Cues]]).

## What stays with Anvil

Anvil can still build and buy when ordered by radio, or on its own when it holds the purse ([[Initiative - Orders, Fight and Purse]]). Its tools for that are unchanged ([[Agent Tools]]).

## Later step in the same direction

On 2026-11-26 plain orders given on the map (move, hold, attack) also became direct acts (commit `9e56316`). That change is not written into `CLAUDE.md`; see [[Decision - Command Sidebar]].

## Related

- [[Locked Decisions]]
- [[Direct Acts]]
- [[Build Bar]]
- [[Radio versus Direct Acts]]
- [[Decision - Command Sidebar]]
- [[Operator - Anvil]]
