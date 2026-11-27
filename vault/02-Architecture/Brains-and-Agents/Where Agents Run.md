---
title: Where Agents Run
description: "A side's agents run in one of two places: a Node process on the machine that runs the game (the agents service), or Web Workers in the commander's own browser."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/mixed
  - area/architecture
  - topic/brains
  - topic/hosts
  - topic/workers
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[AI Brains and Model Relay]]"
  - "[[Agent Loop]]"
  - "[[Claude Brain and Player Keys]]"
  - "[[Fast Brain - Jev]]"
  - "[[Model Relay]]"
  - "[[Seats, Tokens and Trust]]"
  - "[[Rooms, Hub and Lobby]]"
  - "[[WebSocket Frames]]"
  - "[[Docker Compose Services]]"
  - "[[First Lesson]]"
paths:
  - agents/host.mjs
  - agents/main.mjs
  - agents/worker.mjs
  - client/brains/host.js
  - client/brains/worker-agent.js
  - client/brains/policy.js
  - server/room/host.go
  - server/room/lobby.go
  - server/room/hub.go
  - server/room/ws.go
  - server/cmd/callsign/main.go
  - docker-compose.yml
  - docs/FRIEND-MATCH.md
  - CLAUDE.md
---

# Where Agents Run

A side's agents run in one of two places: a Node process on the machine that runs the game (the `agents` service), or Web Workers in the commander's own browser. A *host* keeps one agent per station, and the game server lets exactly one host run a side at a time.

## The host

`Host` in `agents/host.mjs` is the same class in both places; only `spawn` differs.

- It opens a **control connection**: `/ws?...&role=host&host=<id>&rank=<n>&state=0`. That connection only listens.
- On `hello` it stops everything, reads `active`, and if active starts Anvil (squad 0) and a leader for every squad in the state.
- On `squad_spawned` it adds a leader; on `squad_lost` it stops that one.
- A new `hello` (a new match, or a change in who runs the side) is a clean slate.
- Each agent joins with the host's id; the server refuses an agent whose host is not the active one (`ErrNotActiveHost`) and one that names no host when an agent key is set (`ErrNoHost`).

## Two places

| | Server machine | Player's browser |
|---|---|---|
| Entry | `agents/main.mjs` (`node agents/main.mjs`, compose service `agents`) | `client/brains/host.js` (`BrowserAgents`) |
| Agents live in | the Node process's own thread | one Web Worker per station (`agents/worker.mjs`, wrapped by `WorkerAgent`) |
| Proves itself with | the agent key (`key=`) | the commander's seat token (`token=`) |
| Rank | `RankServer` = 1 | `RankBrowser` = 2 |
| Brains | `rule`, `claude`, `subscription` | `rule`, `relay`, `jev`, or `relay` + `jev` (`tiered`) |
| Serves | every side a person commands, in every room | this player's own side only |

### Server machine

`Director` polls `GET /internal/rooms` every second (bearer: the agent key) and keeps one `Host` per `room:side` the server lists. The server lists a side when a person holds its seat and is connected, or left less than **20 seconds** ago (`agentGrace`), so a page reload does not cost the squads their leaders. A lesson's room is never listed. With `CALLSIGN_SIDE` set, the process instead serves one side of one room (`CALLSIGN_ROOM`, or the open room).

### Browser

The page serves the agent modules from the game server at `/agents/` (an allow-list in `server/cmd/callsign/main.go`; `agents/test/browser-modules.test.mjs` checks every import is on it). A Worker is started with a `start` message carrying the server address, the seat and a brain spec; it holds the player token and the seat token and never the key. Messages back: `joined`, `log`, `usage`, `trouble`, `stopped`.

`wanted()` in `client/brains/policy.js` decides whether the browser runs anything:

| Condition | Runs |
|---|---|
| the page commands nothing (spectator), or has been hidden over 30 s | nothing |
| the first lesson, or the player chose "run the rule brain here" (`localStorage` `callsign.agents` = `demo`) | `rule` |
| the relay holds a key for this player, and the player has a seat | `relay` |
| the match has the fast brain, the relay offers it, and the player has a seat | `jev` |
| otherwise | nothing: the side is left to the server machine |

## Who outranks whom

`hostOf` in `server/room/host.go`: the active host is the one with the highest rank, and among equals the one that joined first. With an agent key set the server assigns the rank itself from the proof shown (key gives 1, the side's seat token gives 2); what a host claims counts for nothing. Without an agent key (the trusting, this-machine-only mode) a host's rank is whatever it says.

When the active host changes (`rehost`), the old host's agents are disconnected and both hosts are greeted again with their new `active`. A host standing by runs nothing and takes over when the server says so.

So: a player who stores a key, or joins a fast-brain match, takes their side over from the server machine; removing the key, hiding the page for 30 s, or a key the provider refuses hands it back.

## When a player leaves

- Their squads keep their last orders and the fireteams keep fighting.
- Browser agents stop with the page. The server machine's host keeps the side for 20 s, then stands the agents down ("the commander is gone, agents stood down"), and starts them again when the player returns.
- A hidden tab: after 30 s (`HIDDEN_LIMIT_MS`) the browser's agents stand down, because phones freeze hidden pages; they come back when the page is shown.
- If the game server drops a browser host that still means to run, it reconnects after 1.5 s. The Node host retries every second.

## Differs from the docs

Differs from `CLAUDE.md` and `docs/PLAN.html` ("agents run as Web Workers in the player's browser"): the browser path exists, but the default (no key, no fast brain) runs every agent in a Node process on the server machine. This is why a public server only lets its host make matches: every match runs agents on that machine (`docs/FRIEND-MATCH.md`).

## History

`94f65b0` one agent core for Node and the browser, and the host handshake; `e9575e6` one host serves every room; `be0b2fa` a Worker per station; `4605bb9` tokens and the agent key; `e1ccf83` fixed page agents that could not think (a timer called as a method).

## Related

- [[AI Brains and Model Relay]]
- [[Agent Loop]]
- [[Claude Brain and Player Keys]]
- [[Fast Brain - Jev]]
- [[Model Relay]]
- [[Seats, Tokens and Trust]]
- [[Rooms, Hub and Lobby]]
- [[WebSocket Frames]]
- [[Docker Compose Services]]
- [[First Lesson]]
- [[Decision - Agents and Tools]]
