---
title: Rooms, Hub and Lobby
description: "The room.Hub holds every match on the server; each room.Room is one match with its own seed, clock, radio nets and seats."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/mixed
  - area/server
  - topic/server
  - topic/lobby
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Seats, Tokens and Trust]]"
  - "[[HTTP API]]"
  - "[[Where Agents Run]]"
  - "[[First Lesson]]"
  - "[[Server Architecture]]"
  - "[[WebSocket Frames]]"
  - "[[Sim Loop and Determinism]]"
  - "[[Lobby Page]]"
  - "[[Enemy Bot]]"
  - "[[Maps]]"
paths:
  - server/room/hub.go
  - server/room/lobby.go
  - server/room/room.go
  - server/room/host.go
  - server/room/hub_test.go
  - server/room/lesson_test.go
  - server/room/speed_test.go
  - docs/FRIEND-MATCH.md
---

# Rooms, Hub and Lobby

The `room.Hub` holds every match on the server; each `room.Room` is one match with its own seed, clock, radio nets and seats. A player makes a room in the lobby with a set of options, shares a five-character join code, and the match starts when every person it waits for has pressed Ready.

## The hub

| Thing | Value | Where |
|---|---|---|
| Most rooms at once | 32 (`HubConfig.MaxRooms` default) | `NewHub` |
| Most lesson rooms at once | 8 (`maxLessons`) | `hub.go` |
| Join code | 5 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (31 symbols; no I, L, O, 0, 1) | `freeCode` |
| Code lookup | any letter case, spaces trimmed | `Hub.Room` |
| Idle drop | a room with no person in it for `-idle` (10 minutes) | `Hub.Sweep` |
| Sweep runs | every `idle/4`, at most every 30 s | `sweepLoop` |
| Seed | first room `-seed`, each later room the next number | `Hub.Create` |
| Agents' grace | 20 s after a commander's last connection closed (`agentGrace`) | `hub.go` |

"A person" means a `hammer` or `spectator` connection; agents alone do not keep a room alive (`Room.anyone`, `Room.quietFor`).

When the hub is full, `POST /api/rooms` answers 503 with `ErrFull`. Lessons count toward the 32 and are capped at 8 because anyone may start one.

**The open room.** A server started without an agent key also has one room with no code and no seats (`Hub.open`), reached by `/ws` with no `room`. Anyone may command a side in it and the first Hammer to join starts its clock. Tests and scripts rely on it. With an agent key set it does not exist. See [[Seats, Tokens and Trust]].

## Lobby options (`room.Options`, the body of `POST /api/rooms`)

| Option | JSON | Values | Default |
|---|---|---|---|
| Opponent | `opponent` | `"bot"` or `"friend"` | required |
| Side | `side` | 0, 1, or -1 for either (random) | -1 |
| Length | `length` | 0, or 120 to 1800 seconds | the map's length (900 / 1200 / 1500), or `-length` |
| Map | `map` | a map id (`small`, `medium`, `large`) | the default map |
| Starting gold | `startGold` | 0, or `MinStartGold` 400 to `MaxStartGold` 20000 | `match.startGold` (1000) |
| Gold presets shown | | `StartGolds` = 1000, 2500, 5000, 10000 | |
| Bot level | `bot` | `easy`, `normal`, `standard` (shown as relentless) | the server's `-bot`, else `easy` |
| Speed | `speed` | `relaxed` 0.75, `normal` 1, `fast` 1.5 | `normal` |
| Watch | `watch` | spectators let in | false |
| Purse | `purse` | the operators may buy on their own from the start | false |
| Anvil level | `anvil` | 1 to 3 (rule-brain operator's initiative) | the server's `-anvil-level` (3) |
| Fast brain | `fast` | true or false (squads take orders through Jev) | the server's `-fast-brain` |

The `rush` bot style is a server flag only, "a test opponent, not a difficulty". A server started with `-bot ""` has no scripted enemy to choose a level of: a "bot" match there has an empty other side.

`GET /api/server` tells the page what is on offer before any room exists (factions, levels, speeds, maps with sizes, gold presets and limits, whether making a match is locked, whether the server transcribes speech). See [[HTTP API]].

## Seats, ready and start

- `Hub.Create` seats the maker (`Room.Sit`) and returns the seat token. A friend takes the other seat with `POST /api/rooms/<code>/seat`.
- Against the bot only one human seat exists; against a friend both sides are human seats.
- A commander sends `{"type":"ready"}`. The match starts when `everyoneReady`: every taken human seat is ready, and against a friend both seats must be taken.
- `{"type":"leave"}` before the start gives the seat back (`Room.Stand`): the token is cleared and that side's other connections (other tabs, its agents) are dropped. After the start the seat stays its commander's.
- A reload keeps the seat: the browser shows the same token again.
- When a commander's last connection closes their squads keep their last orders; the agent host stops serving the side 20 s later (`agentSides`) and starts again when they return.

`LobbyView` (sent as the `lobby` frame and by the HTTP routes) carries: `room`, `opponent`, `length`, `map`, `watch`, `level`, `speed`, `pace`, `purse`, `anvil`, `fast`, `startGold`, `phase` (`lobby`, `playing`, `over`), `match` (counts rematches), two `seats` (`side`, `faction`, `bot`, `taken`, `ready`, `online`) and `tutorial`. It never carries a token.

## Rematch (`Room.Restart`)

Only Hammer may send `{"type":"restart"}`. The room throws the match away, bumps `match` (so the next seed is `Seed + match`), disconnects squad leaders (their squads are gone) and greets everyone else again with `hello`.

- Against the bot, or in the open room: allowed at any time, and the new match starts at once.
- Against a friend: refused while the match is still being fought; after it ends, both seats' `ready` are cleared and the rematch waits in the lobby until both are ready again.

## Who runs a side's agents (`host.go`)

Several agent hosts may connect for one side with `role=host` (the Node host on the server machine, the player's browser). Only one is active: the highest rank (`RankBrowser` 2 over `RankServer` 1), and among equals the first to arrive. The others stand by and take over when it leaves. When the active host changes, the old host's `anvil` and `squad` connections are dropped and both hosts are greeted again; `hello.active` says where each stands. `GET /internal/rooms` (`Hub.AgentWork`) lists the rooms and sides the server's own host should be serving. See [[Where Agents Run]].

## The lesson room

A lesson is made with `opponent: "bot"` and `bot` set to the tutorial style (`bot.Tutorial`):

- length is fixed at 1800 s (`lessonSeconds`), spectators are off, the map is forced to the default (small) one, and the fast brain is off ("a lesson spends nothing");
- it needs no host password even on a locked server, because it runs no agents on the server machine: `AgentWork` skips lesson rooms and the learner's browser runs the squads with the rule brain;
- its enemy stands still until the learner's page sends `{"type":"lesson"}` (`Room.Release` sets `bot.Released`).

See [[First Lesson]].

## Why it is this way

- Rooms, join codes and seats came in commit `98a54c9` "so two people can play one match"; `8f4e9a0` added giving a seat back before the start.
- Per-match bot level: `54d3946`. Per-room speed: `57a8768`. Starting gold: `75554cb`. Map choice: `e7235bd`.
- Bigger maps get more time and a faster pace: `effe887`.

## Related

- [[Server Architecture]]
- [[Seats, Tokens and Trust]]
- [[HTTP API]]
- [[WebSocket Frames]]
- [[Sim Loop and Determinism]]
- [[Lobby Page]]
- [[Enemy Bot]]
- [[Maps]]
- [[First Lesson]]
- [[Initiative - Orders, Fight and Purse]]
- [[Playing on a LAN]]
