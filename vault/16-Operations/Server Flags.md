---
title: Server Flags
description: "The game server (server/cmd/callsign) and the model relay (relay/cmd/relay) are configured by command-line flags; docker-compose.yml fills most of them from environment variables."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/code
  - area/operations
  - topic/ops
  - topic/flags
  - topic/configuration
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Sim Loop and Determinism]]"
  - "[[Environment Variables]]"
  - "[[Model Relay]]"
  - "[[Operations]]"
  - "[[Docker Compose Services]]"
  - "[[Server Architecture]]"
  - "[[HTTP API]]"
paths:
  - server/cmd/callsign/main.go
  - relay/cmd/relay/main.go
  - docker-compose.yml
---

# Server Flags

The game server (`server/cmd/callsign`) and the model relay (`relay/cmd/relay`) are configured by command-line flags; `docker-compose.yml` fills most of them from environment variables. This note lists every flag with its default.

## Game server

| Flag | Default | Meaning |
|---|---|---|
| `-addr` | `127.0.0.1:8080` | address to listen on (`:8080` in compose) |
| `-seed` | 1 | match seed; the same seed and orders replay the same match |
| `-length` | 0 | match length in seconds; 0 uses the rules (the map's) default |
| `-bot` | `easy` | scripted player for side 1: `easy`, `normal`, `standard` (relentless), `rush`, or empty for none |
| `-west` | `aegis` | faction of side 0 |
| `-east` | `ashfall` | faction of side 1 |
| `-client` | `client` | directory of the page |
| `-assets` | `assets` | directory of generated art and audio, served read-only at `/assets/` |
| `-agents` | `agents` | directory of the agent runtime; only its browser modules are served, read-only, at `/agents/` |
| `-speed` | 1 | run the clock this many times faster than real time (whole number, at least 1) |
| `-tts` | empty | address of the speech service, passed on at `/tts/`; empty for none |
| `-stt` | empty | address of the listening service for seated commanders at `/stt/`; empty means the page recognises speech in the browser |
| `-relay` | empty | address of the model relay, passed on at `/relay/`; empty for none |
| `-anvil-level` | 3 | initiative of the rule-brain operator in a match that sets none: 1 orders only, 2 also the economy when it holds the purse, 3 also the fight when handed it |
| `-fast-brain` | false | squads without a player's key take orders through the relay's fast decision model unless a match says otherwise |
| `-base` | empty | start every match with these base structures standing, by role (`refinery,barracks`); for tests of what comes after the opening |
| `-full-base` | false | start every match with every base structure standing |
| `-host-key` | env `CALLSIGN_HOST_KEY` | password needed to make a match, for a server strangers can reach |
| `-agent-key` | env `CALLSIGN_AGENT_KEY` | secret the server's agent host and relay show; with it set, commanders need seat tokens |
| `-share` | env `CALLSIGN_SHARE` | address other machines reach the server at, for the join link |
| `-idle` | 10 minutes | drop a match nobody has been in for this long |

What the server does besides flags, from `main.go`:

- Serves the page from `-client`, the rules at `/shared/rules.json` (every map, with `map` set to the default one), assets, and the browser's agent modules from an allow list (`browserModules`).
- Sends `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on everything, so the page's speech recogniser can use WebAssembly threads.
- Logs a warning when it runs without an agent key: anyone who can reach it may join any side as an agent.

`-speed` is the whole server's clock for tests and differs from a room's speed option (relaxed, normal, fast), which the lobby sets per match ([[Sim Loop and Determinism]]).

## Model relay

| Flag | Default | Meaning |
|---|---|---|
| `-addr` | `127.0.0.1:8090` | address to listen on |
| `-game` | `http://127.0.0.1:8080/internal/tier` | the game server's tier endpoint |
| `-data` | `.relay-data` | directory of the encrypted key store |
| `-origins` | empty | origins allowed to call the relay directly; pages served by the game server need none |
| `-max-keys` | 10000 | most keys the store will hold |
| `-jev-daily-usd` | 2 | most the fast brain may spend on the game's key in one day (UTC); negative for no ceiling |
| `-jev-per-minute` | 1200 | most fast-brain decisions a minute across all players |
| `-jev-seat-per-minute` | 60 | most fast-brain decisions a minute for one player |
| `-jev-model` | empty | decision model id; empty takes the pinned one from `shared/models.json` |

The relay also reads `CALLSIGN_RELAY_MASTER_KEY`, `CALLSIGN_JEV_KEY`, `CALLSIGN_PRIVATE` and `CALLSIGN_AGENT_KEY` from its environment ([[Environment Variables]], [[Model Relay]]).

## Related

- [[Operations]]
- [[Environment Variables]]
- [[Docker Compose Services]]
- [[Server Architecture]]
- [[HTTP API]]
- [[Model Relay]]
