---
title: Server Architecture
description: "The game server is one Go program (server/cmd/callsign) that holds a hub of rooms, each room one match with its own deterministic simulation, radio nets and connected clients."
type: hub
status: current
tags:
  - type/hub
  - status/current
  - agent/CLD
  - origin/code
  - area/server
  - topic/server
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Model Relay]]"
  - "[[Playing in Public]]"
  - "[[Sim Loop and Determinism]]"
  - "[[Rooms, Hub and Lobby]]"
  - "[[Seats, Tokens and Trust]]"
  - "[[WebSocket Frames]]"
  - "[[HTTP API]]"
  - "[[Direct Acts]]"
  - "[[Bodies and Collision]]"
  - "[[Navigation]]"
paths:
  - server/cmd/callsign/main.go
  - server/room/room.go
  - server/room/hub.go
  - server/sim/sim.go
  - server/radio/radio.go
  - server/bot/bot.go
  - shared/rules.go
  - shared/structures.go
  - go.mod
  - tools/parsecalls/main.go
---

# Server Architecture

The game server is one Go program (`server/cmd/callsign`) that holds a hub of rooms, each room one match with its own deterministic simulation, radio nets and connected clients. It owns all truth (gold, units, fog of war) and runs no AI model: agents and people reach it only through WebSocket frames and a few HTTP routes.

## Packages

| Package | Path | What it does |
|---|---|---|
| `main` | `server/cmd/callsign` | Flags, the HTTP mux, static files (page, `/assets/`, `/agents/`), reverse proxies to the speech service (`/tts/`), the listening service (`/stt/`) and the model relay (`/relay/`) |
| `room` | `server/room` | The hub of rooms, the lobby, seats and tokens, the WebSocket endpoint, game tools with role checks, the commander's direct acts, radio traffic rules, base cues, agent telemetry |
| `sim` | `server/sim` | The match itself: one `Sim` per match, advanced by `Step()`; commands go in through `Apply`, a fogged `Snapshot(side)` comes out |
| `radio` | `server/radio` | Parsing and composing radio calls in both languages, callsign and place matching (no model involved) |
| `bot` | `server/bot` | The scripted enemy: `bot.Player.Act(snapshot)` returns `sim.Command`s |
| `shared` | `shared` | `rules.json` loaded and checked (`shared.Load`, `Rules.ForMap`, `shared.JSONFor`), structure definitions, the model table for the relay |
| `tools/parsecalls` | `tools/parsecalls` | A small command that reads radio calls exactly as the net does; it made `agents/test/fixtures/orders.json` |

The module is `callsign`, Go 1.27.4, with one dependency: `github.com/coder/websocket`.

## How the parts fit

1. `main` loads the rules, builds a `room.Hub` (`room.NewHub`) and mounts its routes.
2. The page makes a match with `POST /api/rooms`; the hub creates a `Room` with a join code and a seed and starts its ticking goroutine (`Room.Run`).
3. Everyone connects to `/ws?room=<code>`; `Room.Enter` checks who they may be, `Room.Join` greets them with a `hello` frame.
4. Each tick `Room.Tick` lets the scripted enemy act (once a match second), calls `sim.Step()`, sends events, and every second tick sends each side its own `state` snapshot.
5. Agents act only through `tool` frames (`Room.Tool`); the commander talks with `radio` frames and acts by hand with `act` frames (`Room.Act`).

A room holds one mutex (`Room.mu`); every frame handler and the tick take it, so the simulation is only ever touched by one goroutine at a time.

## What the server does not do

- It runs no language model. Agents think elsewhere (the Node agent host or the player's browser) and reach models only through the relay; see [[Model Relay]].
- It keeps nothing on disk: no accounts, no saved matches. A room nobody is in is dropped after `-idle` (10 minutes by default).
- It serves the page over plain HTTP; https is put in front by other services (see [[Playing in Public]]).

## Notes in this area

- [[Sim Loop and Determinism]]: the tick, the order of steps, the seed, snapshots and fog.
- [[Rooms, Hub and Lobby]]: join codes, lobby options, ready and rematch, the lesson room.
- [[Seats, Tokens and Trust]]: seat tokens, the agent key, the host password, the trusting mode.
- [[WebSocket Frames]]: every frame in both directions.
- [[HTTP API]]: every route of the mux.
- [[Direct Acts]]: the commander's build, buy, cancel, sell, repair, rally and tap-to-order.
- [[Bodies and Collision]]: how units take room.
- [[Navigation]]: the grid and the path search.
- [[Sorties]]: how strike aircraft fly.
- [[Tests and Headless Matches]]: how whole matches are simulated in tests.

## Related

- [[Reference Map]]
- [[Server Flags]]
- [[Radio Routing]]
- [[Enemy Bot]]
- [[Agent Tools]]
- [[Where Agents Run]]
- [[Decision - Go Game Server]]
- [[Decision - Rules Data]]
