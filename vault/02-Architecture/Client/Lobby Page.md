---
title: Lobby Page
description: "The lobby is the #overlay card of the page: before a match it is the start screen, the form that makes a match, the join box and the waiting room; after a match it is the result screen."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/mixed
  - area/architecture
  - topic/client
  - topic/lobby
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Sound, Music and Effects]]"
  - "[[Match Rules and Winning]]"
  - "[[Enemy Bot]]"
  - "[[Maps]]"
  - "[[Rule Brain]]"
  - "[[Fast Brain - Jev]]"
  - "[[HTTP API]]"
  - "[[Rooms, Hub and Lobby]]"
  - "[[Seats, Tokens and Trust]]"
  - "[[Playing on a LAN]]"
paths:
  - client/index.html
  - client/debug.js
  - client/lobby.js
  - client/places.js
  - docs/FRIEND-MATCH.md
---

# Lobby Page

The lobby is the `#overlay` card of the page: before a match it is the start screen, the form that makes a match, the join box and the waiting room; after a match it is the result screen. It talks to the server through the small HTTP helpers in `client/lobby.js` and then opens the WebSocket.

## What the overlay shows, by situation

| Situation | Shown | Main button (`#start`) |
|---|---|---|
| No `?room` in the address | "Learn to command" (`#learn`), the new-match form (`#lobby-new`), the join-by-code form (`#lobby-join`) | "Take command" (bot) or "Make the match" (friend) |
| `?room` of a friend match, no seat held | The room's code, seats, and the free seat | "Take <faction>" or "Watch" (when watching is allowed) |
| Seated in a friend match, phase `lobby` | Code, share link with Copy, pace, a small map picture with the options, the seats coloured by state | "Ready" / "Not ready" |
| Match being played | Overlay hidden | — |
| Match over | Title won / lost / draw and the reason (`over.hq_destroyed`, `over.timer`, `over.timer_hq`, `over.timer_force`) | "Play again" (sends `restart`) |

Against the scripted enemy nobody else has to agree: `readyUp()` sends `{type:"ready"}` as soon as the greeting arrives, so the match starts on the one press that made it. When a headquarters fell, the result card waits for the finale ([[Sound, Music and Effects]]).

## The new-match form

| Choice | Field | Values | Remembered in `localStorage` |
|---|---|---|---|
| Opponent | `opponent` | `bot`, `friend` | no |
| Enemy level | `bot` | `easy`, `normal`, `standard`; from the server's `levels` | `callsign.level` |
| Side | `side` | `0`, `1`, `-1` (random); labels show the faction | no |
| Map | `map` | One card per map with a `drawMiniMap` picture, name, size and point count | `callsign.map` |
| Starting gold | `startGold` | The server's presets (`startGolds`) or "other" typed, clamped to `goldLimits` | `callsign.startGold` |
| Length | `length` | 5, 10, 15, 20, 25, 30 minutes plus the server's usual; picking a map sets that map's own `lengthSeconds` | no |
| Pace | `speed` | `relaxed`, `normal`, `fast` (from the server's `speeds`) | `callsign.speed` |
| Anvil holds the purse | `purse` | checkbox | no |
| Anvil's initiative | `anvil` | 1, 2, 3 | no |
| Fast brain | `fast` | checkbox | no |
| Let others watch | `watch` | checkbox, friend matches only | no |
| Host password | `hostKey` | shown only when the server says `locked` | `callsign.hostkey` (after it worked) |

The less often changed choices (gold, length, pace, purse, Anvil level, fast brain, watch) sit in a folded `<details>` whose summary states the current values in one line. What each choice means in the game: [[Match Rules and Winning]], [[Enemy Bot]], [[Maps]], [[Rule Brain]], [[Fast Brain - Jev]].

## HTTP calls (`client/lobby.js`)

| Function | Request | Use |
|---|---|---|
| `serverInfo()` | `GET /api/server` | What the server offers: factions, levels, speeds, maps, gold presets and limits, `share`, `locked`, `stt` |
| `createRoom(options, hostKey)` | `POST /api/rooms`, header `X-Callsign-Host` when a password is given | Makes a match and seats its maker |
| `roomInfo(code)` | `GET /api/rooms/<code>` | Looks at a room this browser has no seat in |
| `takeSeat(code, side?)` | `POST /api/rooms/<code>/seat` | Takes the free seat |

A failed step is worded in the page language by HTTP status: 404 no such match, 409 full, 503 busy, 403 on a locked server host-only, 429 too many guesses. The server side is described in [[HTTP API]] and [[Rooms, Hub and Lobby]].

## Seats

- A seat is `{side, token}` kept under `callsign.seat.<room>` (`saveSeat` / `savedSeat` / `forgetSeat`); a reload sits back down with it. Tokens and trust: [[Seats, Tokens and Trust]].
- The page is built around its side (`?side=`), so a seat on the other side reloads the page at `pageFor({room, side})`.
- `connect()` opens `/ws?side=&role=&room=&token=`. A close with code 1008 is a refusal (`turnedAway`): "no such match" returns to the start screen with the reason; "hold that seat" forgets the stale seat and looks the room up again; "spectators" says watching is not allowed. Any other close shows the no-server notice and retries every second.
- Leave (before the start) sends `{type:"leave"}` and forgets the seat. Exit (in a match) asks once, and on a second press within 4 s sends `leave`, forgets the seat and returns to the start screen.
- The other commander going offline or coming back mid-match is written to the log (`lobby.left` / `lobby.back`).

## Share link and local-only note

`shareLink(room, share)` is `<share or page origin>/?room=<code>`; the server's own idea of its address wins because a page opened as `localhost` cannot know what other machines call it. When the page is on `localhost` and the server gave no share address, the waiting room adds a note naming `make play-lan` ([[Playing on a LAN]]). The waiting room always states that a match on the local network is unprotected (`lobby.unprotected`).

## Other things the start screen does

- Fetches `/shared/rules.json` so the battlefield is drawn behind the card and the map cards have names before any greeting.
- Fetches the speech model for the page language (`voice.prepare(lang)`) with its progress in `#lobby-voice`, unless the server transcribes ([[In-Browser Recognition]], [[Server Whisper]]).
- Lists the music credits in a folded `#credits` ([[Licences and Credits]]).
- `?learn` or the "Learn to command" button starts the first lesson: `createRoom({opponent:"bot", bot:"tutorial", length:0})`, which never needs the host password ([[Help and Tutorial Page]]).

## Related

- [[Client]]
- [[Page Layout]]
- [[Rooms, Hub and Lobby]]
- [[HTTP API]]
- [[Seats, Tokens and Trust]]
- [[Playing on a LAN]]
- [[Playing in Public]]
