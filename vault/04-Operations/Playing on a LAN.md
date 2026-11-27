---
title: Playing on a LAN
description: "Two people on the same network can play one match against each other with make play-lan."
type: how-to
status: current
tags:
  - type/how-to
  - status/current
  - agent/CLD
  - origin/mixed
  - area/operations
  - topic/ops
  - topic/lan
  - topic/multiplayer
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Seats, Tokens and Trust]]"
  - "[[Key Handling]]"
  - "[[Where Agents Run]]"
  - "[[Running, Deploying and Testing]]"
  - "[[Running Locally]]"
  - "[[Playing in Public]]"
  - "[[Rooms, Hub and Lobby]]"
  - "[[Lobby Page]]"
  - "[[HTTP API]]"
paths:
  - docs/FRIEND-MATCH.md
  - Makefile
  - docker-compose.yml
  - server/room/hub.go
---

# Playing on a LAN

Two people on the same network can play one match against each other with `make play-lan`. There are no accounts and no matchmaking, and the traffic is not encrypted; this note gives the steps and what is and is not protected, from `docs/FRIEND-MATCH.md` checked against the code.

## Steps

1. On the machine that runs the game: `make play-lan`. It binds the server to every interface (`CALLSIGN_BIND=0.0.0.0`), sets the share address from this machine's network address (`LAN_IP`, detected, or given as `LAN_IP=...`) and prints the address to share.
2. Open the game there, choose **A friend on this network**, pick a side and a match length, and press **Make the match**. The lobby shows a five-character join code and a link.
3. The friend opens the link, or opens the address and types the code, and takes the other side.
4. Both press **Ready**; the match starts for both at that moment.
5. After the result either can press **Play again**; the rematch starts when both are ready.

## What happens when

| Event | Result |
|---|---|
| A player reloads the page | they sit back down in their seat; the browser remembers the seat per match |
| A player leaves mid-match | their squads keep their last orders and their fireteams keep fighting; the other player is told; their operator and squad leaders stop thinking about twenty seconds later and start again when the player returns |
| Leave pressed before the start | the seat is given back |
| Nobody is in a match for ten minutes | the server drops it (`-idle`) |

## Protected

- Each side's commander is whoever holds that seat's random token; without it nobody can transmit as that side, see its map or restart the match.
- A side is sent only its own radio net, its own fog of war and its own deployments.
- Spectators see both sides, so they are let in only when the maker ticks **Let others watch**.
- The agent host and the relay show the server the agent key, made fresh by `make play` on every run.
- Only one program runs a side's agents at a time; the commander's own browser outranks the agents on the server machine.
- A player's AI key is stored encrypted on the relay under a player token and never returned.

Details: [[Seats, Tokens and Trust]], [[Key Handling]], [[Where Agents Run]].

## Not protected

- **No encryption.** Plain HTTP: anyone who can read the network can read both sides' radio and the seat tokens, and with a token can take over a seat. A key typed into the AI dialog can be read on its way to the relay.
- **The join code is not a password.** Anyone on the network who learns it can take the free seat first.
- **Voice.** Browsers allow the microphone only on https or `localhost`, so a friend on another machine can type orders but cannot speak them.
- **Whose AI.** A side whose player stored their own key thinks in that player's browser on that key; a side without one thinks with whatever is configured on the machine that runs the game.

## Where the document and the code differ

`docs/FRIEND-MATCH.md` says in its LAN section that the server "does not slow guessing down". The code now throttles wrong join codes on any address: 40 a minute for the whole server, then it answers 429 ([[Seats, Tokens and Trust]]). The document's own public section states the 40 a minute figure. The server allows at most 32 matches at once.

## Related

- [[Running, Deploying and Testing]]
- [[Running Locally]]
- [[Playing in Public]]
- [[Rooms, Hub and Lobby]]
- [[Seats, Tokens and Trust]]
- [[Lobby Page]]
- [[HTTP API]]
