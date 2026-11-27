---
title: Decision - Go Game Server
description: "The game server is written in Go and is the single authority for a match."
type: decision
status: current
tags:
  - type/decision
  - status/current
  - agent/CLD
  - origin/mixed
  - area/decisions
  - topic/server
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Decision - Rules Data]]"
  - "[[Sim Loop and Determinism]]"
  - "[[Radar and Fog of War]]"
  - "[[Fireteams and Nerve]]"
  - "[[Enemy Bot]]"
  - "[[Where Agents Run]]"
  - "[[HTTP API]]"
  - "[[Decisions]]"
  - "[[Server Architecture]]"
  - "[[Decision - Model Relay]]"
paths:
  - CLAUDE.md
  - docs/PLAN.html
  - go.mod
  - server/cmd/callsign/main.go
  - shared/rules.json
---

# Decision - Go Game Server

The game server is written in Go and is the single authority for a match. It runs the simulation at 10 ticks a second, serves WebSockets, routes the radio, and runs no AI.

## The decision as written

> **Game server:** Go. Authoritative simulation (10 ticks/s), WebSockets, radio routing. Owns all truth: gold, units, fog of war. Runs no AI.

| | |
|---|---|
| Date | 2026-11-23 (first commit, `e21e0cb`) |
| Decided by | the plan (`docs/PLAN.html`, section India and the Decisions table) |
| Replaced | nothing; Node.js was the alternative considered |

## The reason recorded

`docs/PLAN.html` compares Go and Node for the server: compiled simulation across all cores, small memory per match, short garbage-collector pauses, one static binary. The cost named is that code cannot be shared with the client, answered by sharing the rules as JSON data ([[Decision - Rules Data]]).

## How the code stands

- `go.mod`: module `callsign`, Go 1.27.4, one dependency (`github.com/coder/websocket`).
- `tickRate` is 10 in `shared/rules.json`.
- The server holds all truth and sends each side only what it may see ([[Sim Loop and Determinism]], [[Radar and Fog of War]]).
- "Runs no AI" holds for the server process itself. Three things sit beside it: fireteams and the scripted enemy are plain code inside the server ([[Fireteams and Nerve]], [[Enemy Bot]]); the agent host that `make play` starts on the same machine runs brains, as a separate process ([[Where Agents Run]]); and the server proxies the relay and the speech services at one origin ([[HTTP API]]).

## Related

- [[Decisions]]
- [[Server Architecture]]
- [[Decision - Model Relay]]
- [[Decision - Rules Data]]
- [[Plan versus Code]]
