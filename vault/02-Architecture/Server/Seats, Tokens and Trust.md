---
title: Seats, Tokens and Trust
description: "There are no accounts: a commander is whoever holds the random token of a seat, and the server's own services prove themselves with one shared secret, the agent key."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/mixed
  - area/architecture
  - topic/server
  - topic/security
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[WebSocket Frames]]"
  - "[[Agent Tools]]"
  - "[[Playing in Public]]"
  - "[[Server Whisper]]"
  - "[[Sim Loop and Determinism]]"
  - "[[Agent Telemetry]]"
  - "[[Server Architecture]]"
  - "[[Rooms, Hub and Lobby]]"
  - "[[HTTP API]]"
  - "[[Key Handling]]"
paths:
  - server/room/lobby.go
  - server/room/hub.go
  - server/room/host.go
  - server/room/listen.go
  - server/room/ws.go
  - server/cmd/callsign/main.go
  - docs/FRIEND-MATCH.md
---

# Seats, Tokens and Trust

There are no accounts: a commander is whoever holds the random token of a seat, and the server's own services prove themselves with one shared secret, the agent key. Three secrets exist (seat token, agent key, host password), each guarding a different thing; without an agent key the server runs in a trusting mode meant for one machine only.

## The three secrets

| Secret | Made by | Shown as | Guards |
|---|---|---|---|
| Seat token | `Room.Sit`: 16 random bytes in hex, one per seat | `token=` on `/ws`; `X-Callsign-Seat` header on `/internal/tier` and `/stt/transcribe` | commanding a side, seeing its fog and net, running its agents from the browser |
| Agent key | the operator of the server (`-agent-key` or `CALLSIGN_AGENT_KEY`; `make play` makes a fresh one per run) | `key=` on `/ws`; `Authorization: Bearer` on `/internal/*` | connecting as an agent or host without a seat token; the internal routes |
| Host password | `-host-key` or `CALLSIGN_HOST_KEY` | `X-Callsign-Host` header on `POST /api/rooms` | making a match on a server strangers can reach |

All three are compared with `subtle.ConstantTimeCompare`. A `LobbyView` or `SeatView` never carries a token.

## Who may connect as what (`Room.check`)

| Role | Room with seats (made in the lobby) | Open room (no agent key) |
|---|---|---|
| `hammer` | must hold that side's seat token, else `ErrNoSeat` | anyone |
| `spectator` | only when the maker ticked Watch, else `ErrNoWatching`; a seat token does not help | anyone |
| `host` | agent key (rank 1, `RankServer`) or that side's seat token (rank 2, `RankBrowser`), else `ErrNotAgent` | anyone; rank is whatever it claims |
| `anvil`, `squad` | the same proof as a host, and must name a `host=` id (`ErrNoHost`) that is the side's active host (`ErrNotActiveHost`) | anyone; an agent naming no host is not managed by one |

Rules that follow from the code:

- A host's rank is decided by what it showed, not by what it asked for: the `rank=` query value is overwritten whenever an agent key is set.
- The commander's own browser outranks the agents the server runs for them.
- Every agent must belong to a host "so that a side is never run twice".
- A `squad` role must name a living squad of that side (`Room.Join`).
- The role still limits what a connection may do after it is in: only `hammer` may send `radio`, `act`, `ready`, `leave`, `restart`, `lang` and `lesson` frames; only `anvil` and `squad` may call tools, each its own list. See [[WebSocket Frames]] and [[Agent Tools]].

## The trusting mode

With no agent key (`-agent-key` empty and `CALLSIGN_AGENT_KEY` unset):

- the hub keeps the open room: `/ws` with no `room` lands in it, there are no seats, anyone may command either side, and the first Hammer starts the clock;
- in rooms made in the lobby, commanders still need seat tokens, but any connection may join any side as an agent or host;
- `/internal/rooms` and `/internal/tier` answer anyone.

The server logs at start: "no agent key, so anyone who can reach this server may join any side as an agent; keep it on this machine". Tests and the Node end-to-end tests use this mode.

## The host password

When `HostKey` is set, `POST /api/rooms` answers 403 (`ErrHostOnly`) unless the `X-Callsign-Host` header matches. Reason in the code: every match runs agents on the host's machine. Joining by code never needs it, and a lesson is exempt (it runs no agents there). `GET /api/server` reports `locked: true`. Added in commit `5569f7d` with `make play-public`; see [[Playing in Public]].

## Slowed guessing of join codes

`Hub.wrongCode` counts wrong codes over the whole server: after 40 in one minute (`guessesPerMinute`) further wrong codes get 429 (`ErrGuessing`) until the minute rolls over. It applies to `GET /api/rooms/<code>` and `POST /api/rooms/<code>/seat`. A WebSocket to an unknown room is closed with `ErrNoRoom` and is not counted. The code comment puts the code space at "about 33 million" (31 symbols, 5 places: 28.6 million exactly).

Differs from `docs/FRIEND-MATCH.md`: its "Not protected" section still says the server "does not slow guessing down", while its public-address section says wrong codes are slowed. The code always slows them, on any address.

## The listening service's own guard (`listen.go`)

`POST /stt/transcribe` exists only when the server was started with `-stt`. A recording is passed on only when:

- `room` and `side` name a live room, and in a room with seats `X-Callsign-Seat` holds that side's seat;
- the sender's address has calls left: a bucket of 8 (`listenBurst`) refilling one every 3 s (`listenEvery`); otherwise 429 with `Retry-After`;
- the body is at most 15 s of 16 kHz 16-bit mono plus a header (`listenBody` = 481,024 bytes); otherwise 413.

The sender's address is the connection's own, except when the connection comes from a loopback or private address: then the last entry of `X-Forwarded-For` is used (the server's own https front writes it). The seat header and cookies are stripped before the request goes on, and recordings are not logged. See [[Server Whisper]].

## What a side can and cannot learn

- A side is sent only its own radio log, its own fogged snapshot and its own deployments ([[Sim Loop and Determinism]]).
- Agent telemetry goes to that side's commander connections only: not the other side, not spectators, not other agents ([[Agent Telemetry]]).
- Spectators see both sides, which is why a seat token never opens the spectator view.

## Not protected

Taken from `docs/FRIEND-MATCH.md` and consistent with the code: the game server speaks plain HTTP (tokens travel in the query string of `/ws`), so on a network where traffic can be read a seat can be taken over; the join code is not a password, and whoever has it can take the free seat first.

## Related

- [[Server Architecture]]
- [[Rooms, Hub and Lobby]]
- [[HTTP API]]
- [[WebSocket Frames]]
- [[Key Handling]]
- [[Private Machine Guard]]
- [[Model Relay]]
- [[Where Agents Run]]
- [[Environment Variables]]
- [[Playing on a LAN]]
- [[Playing in Public]]
