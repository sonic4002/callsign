---
title: Friend Matches and Security Model
description: "Reference: docs/FRIEND-MATCH.md."
type: overview
status: current
tags:
  - type/overview
  - status/current
  - agent/AGY
  - origin/docs
  - area/operations
  - topic/operations
  - topic/security
  - topic/multiplayer
created: 2026-11-26
updated: 2026-11-27
agent: AGY
origin: docs
confidence: medium
related:
  - "[[Home]]"
  - "[[Locked Decisions]]"
  - "[[AI Brains and Model Relay]]"
  - "[[Running, Deploying and Testing]]"
paths:
  - docs/FRIEND-MATCH.md
---

# Friend Matches and Security Model

Reference: `docs/FRIEND-MATCH.md`. Two players can play head-to-head via LAN (`make play-lan`) or over public HTTPS (`make play-public`) using a 5-character join code and share link.

## Match Lifecycle
1. Maker configures opponent (`bot` or `friend`), faction, map (`small` / `medium` / `large`), starting gold, speed, and match length.
2. Friend opens the share URL (or enters the join code) and takes the open seat.
3. Both press **Ready** to launch; reloading the page restores the seat from browser storage.
4. Mid-match disconnects keep squads on their last orders and server fireteams fighting; agents pause after ~20s and resume on reconnect. Idle rooms expire after 10 minutes.

## What Is Protected
- **Seat Tokens**: Random per-seat secret issued only to the commander's browser. Required to transmit radio calls, view that side's fogged map, or restart.
- **Strict Side Isolation**: Each side only receives its own radio net, fog of war, and production queues. Spectators are allowed only when explicitly enabled in the lobby.
- **Agent & Relay Authentication**: `make play` generates a fresh `CALLSIGN_AGENT_KEY` per run; browser agents carrying a seat token outrank server-side agents.
- **Encrypted BYOK Storage**: Player AI keys are encrypted at rest in `.relay-data/` under a signed player token and never returned to the browser. Every relay `/think` call verifies the seat token and squad tier with the game server.
- **Public Server Host Protection**:
  - Public servers (`CALLSIGN_HOST_KEY`) require the host password to **create** new matches (joining by link/code stays open).
  - Wrong join codes are rate-limited (`40/min` globally).
  - **Zero Owner Keys in Production**: Unless `CALLSIGN_PRIVATE=1` is set on the owner's machine, neither the relay nor agent host will use owner API keys.

## Known Trade-offs (Pre-Account Phase)
- `make play-lan` runs plain HTTP (unencrypted LAN traffic; browser microphone restricted to `localhost` or `https`). Use `make play-public` for encrypted HTTPS and mobile microphone access.
- A 5-character join code is a convenience room locator, not a high-entropy password—only share links with intended players.

## Key HTTP / WebSocket Endpoints
- `POST /api/rooms` · `GET /api/rooms/<code>` · `POST /api/rooms/<code>/seat` · `GET /api/server`
- `WS /ws?room=<code>&side=<0|1>&role=hammer&token=<seat>`
- `GET /internal/rooms` · `GET /internal/tier` (Bearer `CALLSIGN_AGENT_KEY`)
- `/relay/v1/player` · `/relay/v1/key` · `/relay/v1/think` · `/relay/v1/decide`

## Related Notes
- [[Home]]
- [[Locked Decisions]]
- [[AI Brains and Model Relay]]
- [[Running, Deploying and Testing]]

---

## In detail

One focused note per subject, written from the code:

- [[Playing on a LAN]] — Two people on the same network can play one match against each other with make play-lan.
- [[Playing in Public]] — make play-public puts the game on an https address of the owner's own domain, so a friend anywhere can join and the microphone works on phones.
- [[Seats, Tokens and Trust]] — There are no accounts: a commander is whoever holds the random token of a seat, and the server's own services prove themselves with one shared secret, the agent key.
- [[Key Handling]] — There are three kinds of secret around the brains: a player's AI key (stored encrypted on the relay), the tokens that say who may use it (player token, seat token), and the server's own secrets ...
- [[Private Machine Guard]] — CALLSIGNPRIVATE=1 marks the owner's own machine.
