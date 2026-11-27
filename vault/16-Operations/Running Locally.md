---
title: Running Locally
description: "How to build, test and play the game on one machine."
type: how-to
status: current
tags:
  - type/how-to
  - status/current
  - agent/CLD
  - origin/mixed
  - area/operations
  - topic/ops
  - topic/local
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Rule Brain]]"
  - "[[Environment Variables]]"
  - "[[Claude Brain and Player Keys]]"
  - "[[Private Machine Guard]]"
  - "[[Docker Compose Services]]"
  - "[[Lobby Page]]"
  - "[[Playing on a LAN]]"
  - "[[Speech on Phones]]"
  - "[[Operations]]"
  - "[[Make Targets]]"
paths:
  - Makefile
  - docker-compose.yml
  - Dockerfile.dev
  - .env.example
  - docs/FRIEND-MATCH.md
  - agents/main.mjs
---

# Running Locally

How to build, test and play the game on one machine. The host needs Docker and make; nothing else is installed, and the plain game needs no AI key at all.

## First run

1. `make image` builds `callsign-dev` (Go and Node with all modules inside). `make play` does this itself if the image is missing.
2. `make test` runs everything with the network off: `go vet`, `go test ./...`, then the Node tests against a freshly built server binary.
3. `make play` starts the game server, the agent host and the model relay.
4. Open `http://localhost:8080`, press **Take command** for a match against the scripted enemy, and transmit as Hammer.
5. `make stop` takes it down.

With no `.env` settings the squads and Anvil think with the rule brain, which needs no AI ([[Rule Brain]]). An empty `.env` file may still be needed, because the `agents` service names it as its `env_file`; whether compose starts without the file is not verified.

## Choosing brains on your own machine

Set these in `.env` (see [[Environment Variables]]; never commit the file):

| Want | Set |
|---|---|
| Claude through the API for the server machine's agents | `CALLSIGN_PRIVATE=1` and `CALLSIGN_ANTHROPIC_KEY` |
| Claude through a subscription, as a test rig | `CALLSIGN_PRIVATE=1` and `CALLSIGN_CLAUDE_TOKEN` |
| The fast brain for order-taking | `CALLSIGN_PRIVATE=1`, `CALLSIGN_JEV_KEY`, and `CALLSIGN_FAST_BRAIN=true` or the lobby switch |
| A player's own key | nothing in `.env`: the player pastes it in the page's AI dialog and it goes to the relay ([[Claude Brain and Player Keys]]) |

The owner's keys are used only when `CALLSIGN_PRIVATE` is exactly `1` ([[Private Machine Guard]]).

## Optional parts

| Part | Build once | Effect |
|---|---|---|
| Radio voices | `make art-image`, `make tts-image`, `make tts-models` | squads and Anvil are heard through the local speech service; otherwise the browser's own voice |
| In-browser listening | `make voice-models` | push-to-talk recognised in the page |
| Server listening | `make stt-image`, `make stt-models`, and a GPU | spoken calls transcribed by Whisper on this machine |
| Art | `make art-image`, `make art-models` (and `make art-units-image`) | regenerate sprites; the finished sprites are already in `assets/` |

`make play` starts the voice and listening services only when their images and models are present ([[Docker Compose Services]]).

## Useful switches

| Switch | Effect |
|---|---|
| `CALLSIGN_BOT=normal make play` | the usual level of the scripted enemy; `CALLSIGN_BOT=` plays with none |
| `CALLSIGN_SEED=7 make play` | another first seed |
| `make play UP_FLAGS=-d` | start in the background |
| Page address parameters | the page accepts parameters such as `lang`, `learn`, `autostart`, `map`, `gold`, `speed`, `bot`, `fast`, `anvil`, `nosw` ([[Lobby Page]]) |

## What is where at run time

| Path | Holds | In git |
|---|---|---|
| `.env` | the owner's secrets | no |
| `.relay-data/` | encrypted player keys and the master key | no |
| `assets/voice-cache/` | lines already spoken by the speech service | no |
| `assets/models/`, `client/vendor/ort/` | fetched model weights and the recogniser runtime | no |
| `assets/raw/` | raw model output of the art pipeline | no |
| `.caddy-data/` | the public certificate and its account key | no |

## The microphone

Browsers allow the microphone only on https or on `localhost`. On this machine at `http://localhost:8080` voice works; from another machine over plain http it does not ([[Playing on a LAN]], [[Speech on Phones]]).

## Related

- [[Operations]]
- [[Make Targets]]
- [[Docker Compose Services]]
- [[Environment Variables]]
- [[Playing on a LAN]]
- [[Playing in Public]]
- [[Tests and Headless Matches]]
