---
title: HTTP API
description: "The game server answers a small set of HTTP routes from one mux: the lobby's JSON API, two internal routes for its own services, static files, and reverse proxies that put the speech, listening ..."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/mixed
  - area/architecture
  - topic/server
  - topic/protocol
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Seats, Tokens and Trust]]"
  - "[[WebSocket Frames]]"
  - "[[Rooms, Hub and Lobby]]"
  - "[[Server Whisper]]"
  - "[[Where Agents Run]]"
  - "[[Model Relay]]"
  - "[[Ranks and Brain Tiers]]"
  - "[[Server Architecture]]"
  - "[[Server Flags]]"
  - "[[Lobby Page]]"
paths:
  - server/cmd/callsign/main.go
  - server/room/hub.go
  - server/room/listen.go
  - docs/FRIEND-MATCH.md
---

# HTTP API

The game server answers a small set of HTTP routes from one mux: the lobby's JSON API, two internal routes for its own services, static files, and reverse proxies that put the speech, listening and relay services behind the same origin. This note lists every route as `main.go` and `Hub.Routes` register them.

## Routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET (upgrade) | `/ws` | per role; see [[Seats, Tokens and Trust]] | the WebSocket of a room ([[WebSocket Frames]]) |
| GET | `/api/server` | none | what the lobby can offer before any room exists |
| POST | `/api/rooms` | `X-Callsign-Host: <host password>` when the server is locked (not for a lesson) | make a match and seat its maker |
| GET | `/api/rooms/{code}` | none (the code) | a match's lobby |
| POST | `/api/rooms/{code}/seat` | none (the code) | take a seat |
| POST | `/stt/transcribe` | `X-Callsign-Seat: <seat token>` in a room with seats | pass a commander's recording to the listening service; only registered with `-stt` |
| GET | `/internal/rooms` | `Authorization: Bearer <agent key>` when a key is set | for the agent host: which rooms and sides need agents |
| GET | `/internal/tier` | the same, plus `X-Callsign-Seat` in a room with seats | for the model relay: a squad's brain tier |
| GET | `/shared/rules.json` | none | the rules file, with the default map as `map` |
| GET | `/assets/...` | none | generated art and audio, read-only (`-assets`) |
| GET, HEAD | `/agents/<module>` | none | the agent runtime's browser modules, from a fixed allow list |
| any | `/tts/...` | none | reverse proxy to the speech service, prefix stripped; only with `-tts` |
| any | `/relay/...` | the relay's own | reverse proxy to the model relay, path kept; only with `-relay` |
| GET | `/` and everything else | none | the page (`-client` directory) |

Every response carries `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, so the page's in-browser speech recogniser may use WebAssembly threads. `.webmanifest` is served as `application/manifest+json`. JSON answers are `no-store`. JSON request bodies are capped at 1 KiB (`readJSON`). The server's `ReadHeaderTimeout` is 5 s and it shuts down within 2 s of SIGINT or SIGTERM.

## `GET /api/server`

Returns: `factions` (side 0, side 1), `bot` (a scripted enemy exists), `levels` (`easy`, `normal`, `standard`), `level` (the one the lobby starts on), `length`, `startGolds` (1000, 2500, 5000, 10000), `startGold`, `goldLimits` ([400, 20000]), `speeds` (name and factor), `speed`, `maps` (id, name, width, height, number of points, length), `share` (the address others reach the server at), `open` (the open room exists), `locked` (making a match needs the host password), `stt` (the server transcribes speech).

## `POST /api/rooms`

Body: `{"opponent":"bot"|"friend","side":0|1|-1,"length":<seconds>,"watch":bool,"bot":"easy"|"normal"|"standard","speed":"relaxed"|"normal"|"fast","purse":bool,"map":"<id>","startGold":<n>,"anvil":1|2|3,"fast":bool}`. Only `opponent` is required; limits are in [[Rooms, Hub and Lobby]].

| Status | When |
|---|---|
| 201 | `{"room","side","token","share","lobby"}`; `share` is `<share address>/?room=<code>`, empty when the server does not know its address |
| 400 | an option out of range, or a body that is not the expected JSON |
| 403 | the host password is needed and was not shown |
| 503 | the server is running as many matches (or lessons) as it can |

## `GET /api/rooms/{code}` and `POST /api/rooms/{code}/seat`

- `GET` returns `{"share","lobby"}`.
- `POST` takes `{"side":0|1}` or `{}` for whichever seat is free, and returns `{"room","side","token","share","lobby"}`; 409 when the seat is taken.
- An unknown code: 404, or 429 once more than 40 wrong codes were tried on the server in the minute.

## `POST /stt/transcribe`

`/stt/transcribe?room=<code>&side=<0|1>&lang=he|en&hints=<words>` with the recording as the body. The server checks the seat, the sender's rate and the size (403, 429 with `Retry-After`, 413), then forwards to the listening service's `/transcribe` with only `lang` and `hints`, without the seat header or cookies. 502 when the service does not answer (the page then falls back to its own recogniser). The response-header timeout toward the service is 20 s. Details in [[Seats, Tokens and Trust]] and [[Server Whisper]].

## `GET /internal/rooms`

Returns `{"rooms":[{"room":"<code>","sides":[0,1]}, ...]}`, sorted by code: the sides whose commander is connected or left less than 20 s ago. The open room is listed under the empty code. Lesson rooms are never listed. The Node agent host polls this; see [[Where Agents Run]].

## `GET /internal/tier`

`/internal/tier?room=<code>&side=<0|1>&squad=<id>`; squad 0 is the operator. Returns `{"tier":<n>,"operator":bool,"seated":bool}`. In a room with seats the `X-Callsign-Seat` token must hold that side's seat (403 otherwise): "a thought is only ever paid for by the commander it serves". `seated` tells the relay whether a seat stood behind the answer; what is paid for with the game's own key is only done for a seat. 404 for an unknown room or squad. See [[Model Relay]] and [[Ranks and Brain Tiers]].

## `/agents/` allow list

Only these files of `agents/` are served, as JavaScript: `agent.mjs`, `link.mjs`, `tools.mjs`, `prompts.mjs`, `host.mjs`, `brain-relay.mjs`, `brain-rule.mjs`, `brain-jev.mjs`, `rule-grammar.mjs`, `rule-leader.mjs`, `rule-operator.mjs`, `rule-phrases.mjs`, `worker.mjs`, `bases.mjs`, `power.mjs`, `telemetry.mjs`, `heroes.mjs`, `aircraft.mjs`. The Node-only brains, the tests and the package files are not.

## Differences from `docs/FRIEND-MATCH.md`

- The doc's body for `POST /api/rooms` lists `opponent`, `side`, `length`, `watch` and `bot`; the code also takes `speed`, `purse`, `map`, `startGold`, `anvil` and `fast`.
- The doc gives `/internal/tier` as returning `{"tier":1|2|3,"operator":false}`; the code also returns `seated`, and returns tier 0 for the operator.
- The relay's own routes under `/relay/v1/` are described in the doc and belong to the relay, not this server: see [[Model Relay]].

## Related

- [[Server Architecture]]
- [[WebSocket Frames]]
- [[Rooms, Hub and Lobby]]
- [[Seats, Tokens and Trust]]
- [[Server Flags]]
- [[Lobby Page]]
- [[Text to Speech Service]]
- [[Service Worker and Install]]
