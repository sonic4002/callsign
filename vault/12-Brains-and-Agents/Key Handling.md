---
title: Key Handling
description: "There are three kinds of secret around the brains: a player's AI key (stored encrypted on the relay), the tokens that say who may use it (player token, seat token), and the server's own secrets ..."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/mixed
  - area/brains-and-agents
  - topic/brains
  - topic/relay
  - topic/security
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Playing in Public]]"
  - "[[Brains and Agents]]"
  - "[[Model Relay]]"
  - "[[Claude Brain and Player Keys]]"
  - "[[Private Machine Guard]]"
  - "[[Fast Brain - Jev]]"
  - "[[Seats, Tokens and Trust]]"
  - "[[Environment Variables]]"
  - "[[Playing on a LAN]]"
  - "[[Decision - Model Relay]]"
paths:
  - relay/keystore.go
  - relay/player.go
  - relay/relay.go
  - relay/game.go
  - relay/cmd/relay/main.go
  - relay/relay_test.go
  - client/brains/seat.js
  - client/brains/settings.js
  - agents/worker.mjs
  - docker-compose.yml
  - .env.example
  - .gitignore
  - docs/FRIEND-MATCH.md
---

# Key Handling

There are three kinds of secret around the brains: a player's AI key (stored encrypted on the relay), the tokens that say who may use it (player token, seat token), and the server's own secrets (agent key, master key, the game's Jev key). This note says how each is made, stored and checked; it holds no values.

## The secrets

| Secret | Made by | Lives in | Used for |
|---|---|---|---|
| Player's AI key | the player, at a provider | the relay's key store, encrypted | paying for that player's thoughts |
| Player token | the relay (`Mint`) | the browser's `localStorage` (`callsign.player`) | naming the player to the relay; filing the key |
| Seat token | the game server, when a seat is taken | the browser that took the seat | proving who commands a side in one match |
| Agent key (`CALLSIGN_AGENT_KEY`) | `make play`, fresh each run | game server, agent host, relay | the server's own services proving themselves |
| Master key (`CALLSIGN_RELAY_MASTER_KEY`, or `master.key`) | the owner, or the relay on first start | environment, or the relay's data directory | sealing the key store, signing player tokens |
| Game's Jev key (`CALLSIGN_JEV_KEY`) | the owner | the relay's environment only | the fast brain's decisions |

## The key store (`relay/keystore.go`)

- One file per player under `<data>/keys/`, named after `SeatID(token)`: SHA-256 of a fixed prefix plus the player token. The token itself is never written down.
- Sealed with **AES-256-GCM** under the 32-byte master key, with a fresh random nonce per write. The same hash is the authenticated additional data, so a file copied onto another player's name does not open.
- Files are mode 0600, the directory 0700. Every write is a whole temp file renamed into place, and every read goes to disk, so two relays can share one directory.
- At most `-max-keys` keys (default 10 000); a full store answers `ErrStoreFull`.
- A different master key, or a moved or changed file, fails to open with "could not be opened with this master key".

### The master key

`MasterKey(text, dir)`: from `CALLSIGN_RELAY_MASTER_KEY` when set (32 bytes in hex or base64), otherwise from `<data>/master.key`, created with random bytes and mode 0600 on first start (`O_EXCL`, so two relays starting together agree). A `master.key` readable by others is refused. `.relay-data/` is in `.gitignore`.

## Player tokens (`relay/player.go`)

Format: a version prefix, a random 16-byte id, and an HMAC-SHA256 of the id. The signing key is derived from the master key (`TokenKey`), so tokens survive a restart and two relays sharing a store accept each other's. Because tokens are signed, the relay can refuse a made-up one without remembering any.

A player token **alone** only reaches that player's own key: store, replace, forget, and see the provider and the last four characters. If the relay's signing key changes, the browser's token stops working; the page forgets it and asks for a new one (`forgetPlayer`), and the key must be stored again.

## What it takes to spend a key

A thought needs **both** tokens in one call:

1. `Authorization: Bearer <player token>`: a token this relay signed; it selects the stored key.
2. `X-Callsign-Seat: <seat token>`: passed only to the game server, which must confirm that seat commands that side of that room (`/internal/tier`).

The game server's answer is never cached. A seat that is gone stops thinking at once.

For the game's own key the check is stricter: `Vouch` also refuses a room that has no seats (the open room of a server without an agent key), where the game server would let anyone ask.

## What the key store accepts (`checkKey`)

A known provider name; 16 to 512 printable characters with no spaces; and not a Claude subscription token for the `anthropic` provider. Key reads and writes are limited to 20 a minute per player.

## Where a key never is

- Never returned by any route: `GET /relay/v1/key` gives the provider and a hint of the last four characters.
- Never in the page after saving: the input is cleared whether or not the relay took it.
- Never in a Worker: it holds the two tokens only (`agents/worker.mjs`).
- Never in the log: lines carry the first 8 characters of the seat hash and counts.
- Never sent to an address other than the one fixed provider address; redirects are not followed.
- The game's Jev key: the `agents` compose service reads `.env` for its own settings and explicitly blanks `CALLSIGN_JEV_KEY`, so only the relay holds it.

## Known limits

- Over plain HTTP (LAN play) a key typed into the dialog can be read on the network on its way to the relay, like everything else (`docs/FRIEND-MATCH.md`). Use the https ways of [[Playing in Public]].
- There are no accounts. A player is a browser's token: clearing site data loses access to the stored key (it can only be overwritten by storing again under a new token; the old file stays until removed by hand). Not verified whether anything prunes orphaned key files; no such code was found.

## Tests

`relay/relay_test.go`: `TestKeys`, `TestStoredKeysAreBoundToTheirSeatAndTheMasterKey`, `TestPlayerTokens`, `TestOnlyTheSeatHolderThinksForASquad`, `TestACallerCannotNameAModelOrAnAddress`.

## Related

- [[Brains and Agents]]
- [[Model Relay]]
- [[Claude Brain and Player Keys]]
- [[Private Machine Guard]]
- [[Fast Brain - Jev]]
- [[Seats, Tokens and Trust]]
- [[Environment Variables]]
- [[Playing on a LAN]]
- [[Decision - Model Relay]]
