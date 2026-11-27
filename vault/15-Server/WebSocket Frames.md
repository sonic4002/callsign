---
title: WebSocket Frames
description: "Everything live between the server and a client is a JSON text frame on one WebSocket at /ws, each frame an object with a type."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/mixed
  - area/server
  - topic/server
  - topic/protocol
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Seats, Tokens and Trust]]"
  - "[[Agent Tools]]"
  - "[[Direct Acts]]"
  - "[[Command Net and Squad Net]]"
  - "[[Traffic Levels]]"
  - "[[Server Architecture]]"
  - "[[HTTP API]]"
  - "[[Rooms, Hub and Lobby]]"
  - "[[Sim Loop and Determinism]]"
  - "[[Agent Loop]]"
paths:
  - server/room/ws.go
  - server/room/room.go
  - server/room/act.go
  - server/room/lobby.go
  - server/room/command.go
  - server/room/telemetry.go
  - server/room/host.go
  - server/room/tools.go
  - server/sim/command.go
  - server/sim/view.go
  - docs/FRIEND-MATCH.md
---

# WebSocket Frames

Everything live between the server and a client is a JSON text frame on one WebSocket at `/ws`, each frame an object with a `type`. This note lists every frame type in both directions as the code has them (`inbound` and `Room.handle` in `server/room/ws.go`, and every `"type"` the room sends).

## Connecting

```
/ws?room=<code>&side=<0|1>&role=<role>&squad=<id>&state=<0|1>&host=<id>&rank=<n>&token=<seat token>&key=<agent key>
```

| Parameter | Meaning |
|---|---|
| `room` | join code; empty means the open room (only on a server without an agent key) |
| `side` | 0 or 1 |
| `role` | `hammer` (default), `anvil`, `squad`, `spectator`, `host` |
| `squad` | the squad id, for `role=squad` |
| `state` | `0` to receive no `state` frames (agents that only read reports); anything else: receive them |
| `host` | the id of the agent host a connection belongs to; required for `role=host`, and for agents when an agent key is set |
| `rank` | a host's claimed rank; used only when no agent key is set |
| `token`, `key` | proof: a seat token, or the server's agent key |

A refused connection is accepted and then closed with status `StatusPolicyViolation` and the reason as text (for example "no such match", "you do not hold that seat"), so a page can read why. Who may take which role is in [[Seats, Tokens and Trust]].

Each client has an outgoing queue of 512 frames; a client that cannot keep up is dropped rather than stalling the match (`Room.send`).

## Client to server

| `type` | Who may send | Fields | What it does | Answer |
|---|---|---|---|---|
| `radio` | `hammer` | `text`, `strict` (1 relaxed, default; 2 standard; 3 strict) | Hammer's transmission, routed by callsign (`Room.SayAt`) | a `radio` frame to the side; or `refused` with `text` and `reason` |
| `tool` | `anvil`, `squad` | `id`, `name`, `args` | one game tool (`Room.Tool`) | `result` with the same `id` |
| `act` | `hammer` | `id`, `name` (`build`, `buy`, `cancel`, `sell`, `repair`, `rally`, `order`), `args` | the commander's own hand (`Room.Act`) | `acted` with the same `id`; and a `direct` frame to the side on success |
| `lang` | `hammer` | `text`: `"he"` or `"en"` | the language the commander's page is in (`Room.SetLang`) | `netlang` to the side; or `refused` |
| `ready` | `hammer` | `ready` (bool; absent means true) | ready or not ready in the lobby | `lobby` to everyone; or `refused` |
| `leave` | `hammer`, before the start, in a room with seats | none | gives the seat back (`Room.Stand`) | `lobby`; the side's connections are closed |
| `lesson` | `hammer`, in a lesson room | none | lets the lesson's enemy move (`Room.Release`) | nothing; or `refused` |
| `telemetry` | `anvil`, `squad` | `telemetry`: one JSON object, at most 4096 bytes | what the agent says about itself (`Room.Report`); relayed unread | nothing; a `telemetry` frame to that side's commanders |
| `restart` | `hammer` | none | a new match in the room (`Room.Restart`) | `hello` to everyone again; or `refused` |

Anything else, or a frame that is not JSON, gets `{"type":"refused","reason":...}`. `spectator` and `host` connections may send nothing that is accepted.

Tool names and their arguments (the `toolArgs` struct) are in [[Agent Tools]]; act names and arguments in [[Direct Acts]]. Telemetry is rate-limited per connection: a burst of 8, one more every 50 ms; a flooding agent is silently not relayed.

## Server to client

| `type` | Sent to | Fields | When |
|---|---|---|---|
| `hello` | the joining client; everyone again after a restart; a host again when its standing changes | `match`, `side`, `role`, `faction`, `rules` (the whole rules file with this room's map as `map`), `state` (snapshot), `log` (the side's radio log so far), `lobby`, `command` (`{mode, buy}`), `netlang`, `station` (the client's own callsign, for hammer, anvil, squad), `active` (hosts only), `agents` (hammer only: last telemetry per station) | on join |
| `state` | clients that want state; per side, or the spectator view | `state`: a `sim.Snapshot` | every second tick, and at the end |
| `event` | the event's side, and spectators | `event` (a `sim.Event`), `callsign` (the squad's name, or the name it had before it changed hands), `known: true` when another squad already has this to report | as the simulation raises them |
| `radio` | the side, and spectators | `message`: `seq`, `tick`, `from`, `to`, `lang`, `text`, `body`, `end`, `prowords`, `points`, `landmarks`, `final`, `cue`, `kind`, `net`, `level` | every transmission the net carries, base cues and the sign-off included |
| `lobby` | everyone in the room | `lobby`: a `LobbyView` | on every change of seats, readiness or phase |
| `command` | the side, and spectators | `command`: `{mode: "orders" or "fight", buy: bool}` | when who has the initiative or the purse changes |
| `direct` | the side, and spectators | `act`, `tick`, `result`, `lang` | after a successful `act`; tells the side's agents without waking them |
| `netlang` | the side, and spectators | `lang` | after a `lang` frame |
| `telemetry` | that side's `hammer` connections only | `agent`: `{squad, station, online, gone, telemetry}`; or `ended: true` | an agent reported, left, its squad was lost, or the match ended |
| `result` | the caller | `id`, `ok`, and `data` or `error` | answer to `tool` |
| `acted` | the caller | `id`, `act`, `ok`, and `data` or `error` | answer to `act` |
| `refused` | the caller | `reason`, sometimes `text` | a frame that was not accepted |

"The side, and spectators" is `Room.broadcast`: every connection whose side matches (commander, operator, squad leaders, hosts) plus every spectator.

### Event kinds (`event.kind`)

From `server/sim/command.go`: `deploying`, `squad_spawned`, `squad_lost`, `enemy_destroyed`, `losses`, `contact`, `pinned`, `arrived`, `captured`, `point_lost`, `hq_under_attack`, `upgraded`, `match_end`, `garrisoned`, `building_fell`, `bridge_under_attack`, `bridge_fell`, `bridge_repaired`. From `server/sim/sortie.go`: `strike`, `overhead`, `rearmed`. Other files of the simulation define more (structures, haulers, heroes, crushing, ranks); the full list was not compiled for this note.

Event fields: `tick`, `side`, `kind`, `squad`, `hauler`, `field`, `unit`, `contact`, `point`, `place`, `count`, `structure`, `owner`, `winner`, `reason`, `was`.

### Radio message kinds, nets and levels

`kind` is one of `order`, `answer`, `ask`, `cue`, `loss`, `contact`, `objective`, `notice`, `status`, `ack`; `net` is `command` or `squad`; `level` is the least traffic level of the commander's page that shows and speaks the line. An agent may tag its own line only as `contact`, `objective`, `loss`, `status` or `ack`. See [[Command Net and Squad Net]] and [[Traffic Levels]].

## Order of frames a client can rely on

- `hello` is always the first frame, and carries the whole log, so a late joiner or a reloaded page catches up without replay.
- After `restart`, squad-leader connections are closed (their squads are gone) and everyone else gets a new `hello` with a higher `match`.
- At the end of a match the operator's sign-off arrives as a `radio` frame with `final: true`, then `lobby` with `phase: "over"`, then the last `state`.

## Differences from the docs

- `docs/FRIEND-MATCH.md` lists only `lobby`, `ready` and `leave` as "frames added"; the comment at the top of `ws.go` lists six inbound types. The code handles nine inbound types (the table above): `act`, `lang` and `lesson` are in neither list.
- The role comments in `room.go` ("hammer: radio only", "anvil: radio, report, buy") are older than the code: Hammer also has `act`, and each agent role has more tools ([[Agent Tools]]).

## Related

- [[Server Architecture]]
- [[HTTP API]]
- [[Seats, Tokens and Trust]]
- [[Rooms, Hub and Lobby]]
- [[Direct Acts]]
- [[Sim Loop and Determinism]]
- [[Agent Tools]]
- [[Agent Loop]]
- [[Agent Telemetry]]
- [[Radio Routing]]
- [[Base Cues]]
