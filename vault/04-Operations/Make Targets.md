---
title: Make Targets
description: "Every task in the project is a make target that runs inside a Docker image, so the host needs only Docker and make."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/code
  - area/operations
  - topic/ops
  - topic/make
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Balance]]"
  - "[[Maps]]"
  - "[[Model Relay]]"
  - "[[In-Browser Recognition]]"
  - "[[Text to Speech Service]]"
  - "[[Server Whisper]]"
  - "[[Recognition Evaluation]]"
  - "[[Art Pipeline]]"
  - "[[Tests and Headless Matches]]"
  - "[[Service Worker and Install]]"
paths:
  - Makefile
  - Dockerfile.dev
  - art/Dockerfile
  - art/Dockerfile.blender
  - tts/Dockerfile
  - stt/Dockerfile
---

# Make Targets

Every task in the project is a `make` target that runs inside a Docker image, so the host needs only Docker and make. This note lists all of them as they are in the `Makefile` now, grouped as the file groups them.

## Core

| Target | What it does |
|---|---|
| `make image` | Builds the dev image `callsign-dev` from `Dockerfile.dev`. Needed once, and again only when `go.mod`, `go.sum` or `agents/package-lock.json` change. |
| `make test` | With the network off: `go vet ./...`, `go test ./...`, builds the server to `/tmp/callsign`, then `node --test` with `CALLSIGN_BIN` pointing at that binary (the Node end-to-end tests start a real server). |
| `make play` | Makes the image and the build-cache volume if missing, creates `assets/voice-cache` and `.relay-data`, makes a fresh `CALLSIGN_AGENT_KEY`, and runs `docker compose up` with the `voice` and `listen` profiles when their conditions hold. Open `http://localhost:8080`. |
| `make play-lan` | The same with `CALLSIGN_BIND=0.0.0.0` and `CALLSIGN_SHARE` set to this machine's LAN address (`LAN_IP`, detected or given). Prints the address a friend opens. No encryption, no accounts. |
| `make play-public` | The same over https on the owner's own domain. Needs `CALLSIGN_PUBLIC_URL` in `.env`. With `CALLSIGN_TUNNEL_TOKEN` set it adds the `public` profile (Cloudflare Tunnel); without, the `https` profile (Caddy on port 443 with a Let's Encrypt certificate). Prints the address and the host password. |
| `make public-dns` | Runs `tools/public-dns.sh`: points the public name at this home's address with a plain DNS record. Needs `CALLSIGN_CF_TOKEN`. Run again when the home address changes. |
| `make stop` | `docker compose down` with every profile. |
| `make shell` | An interactive shell in the dev image. |

Variables `make play` accepts: `UP_FLAGS` (for example to start in the background, commit `616082d`), `MORE_PROFILES`, `LAN_IP`.

## Balance, cost, maps

| Target | What it does |
|---|---|
| `make balance` | `TestFactionsAreRoughlyEvenOnEveryMap` with `CALLSIGN_BALANCE=$(SEEDS)` (default 100): 200 scripted games per map; several minutes; 60 minute timeout. |
| `make cost` | On one core with `CALLSIGN_COST=1`: `TestWhatATickCosts` and `TestWhatAMapPays`: the time of a tick and of its two snapshots, their size, and the gold a base makes a minute. |
| `make maps` | `python3 tools/mapgen.py`: rewrites the maps in `shared/rules.json`. This one runs on the host's Python. |

See [[Balance]] and [[Maps]].

## Model relay

| Target | What it does |
|---|---|
| `make relay` | Runs the relay alone on `127.0.0.1:8090` beside a game server on port 8080, keys in `.relay-data/`. For working on the relay; `make play` already starts one. |
| `make relay-test` | The relay's and `shared`'s tests with the race detector, network off. Every provider is played by a fake. |

See [[Model Relay]].

## In-browser speech recognition

| Target | What it does |
|---|---|
| `make voice-models` | Downloads the in-browser recognisers (Hebrew and English) and their runtime, about 150 MB, into `assets/models/` and `client/vendor/ort/`; pinned versions checked by SHA-256. `ALL=1` also fetches the older Hebrew recogniser (165 MB). |
| `make voice-test` | Transcribes the test recording with the real models (`CALLSIGN_VOICE_MODELS=1`); needs `voice-models` first. |

See [[In-Browser Recognition]].

## Radio voices (text to speech)

| Target | What it does |
|---|---|
| `make tts-image` | Builds `callsign-tts`: one layer (about 0.6 GB) on top of `callsign-art`, so `make art-image` comes first. |
| `make tts-models` | Downloads the speech models into `assets/models/bluev3`, about 680 MB. |
| `make tts-test` | The pronunciation table's tests; no models, no network. |

`make play` adds the `voice` profile only when the `callsign-tts` image exists and `assets/models/bluev3/onnx/vocoder.onnx` is there. See [[Text to Speech Service]].

## Listening (server-side speech recognition)

| Target | What it does |
|---|---|
| `make stt-image` | Builds `callsign-stt`, about 4.4 GB; stands alone. |
| `make stt-models` | Downloads the two Whisper models into `assets/models/whisper-he` and `whisper-en`, about 3.2 GB, pinned and checked by SHA-256. |
| `make stt-test` | The service's own tests: what it accepts and refuses. No models, GPU or network. |
| `make stt-quiet` | Silence, hiss, hum and clicks through the real models: every one must come back empty. Needs the GPU. |
| `make stt-eval` | Speaks the calls in `stt/eval/calls.json` with the speech service (needs `make play` running with voices), transcribes them with and without hints, and scores. |

`make play` adds the `listen` profile, and tells the game server about the service (`CALLSIGN_STT`), only when the image, both models and a GPU (`nvidia-smi`) are present. See [[Server Whisper]] and [[Recognition Evaluation]].

## Art

| Target | What it does |
|---|---|
| `make art-image` | Builds `callsign-art`: ComfyUI, PyTorch and the clean-up tools. About 13 GB. |
| `make art-models` | Downloads the model weights once into the `callsign-art-models` volume. About 13 GB. |
| `make art` | Network off, GPU: `art/generate.py` (missing candidates), `art/cleanup.py` (rebuild `assets/sprites` from the kept ones), `art/rename_keys.py`. Candidates are chosen by setting `keep` in `art/sprites.json`. |
| `make art-units-image` | Builds `callsign-blender`. About 2.7 GB. |
| `make art-units` | On the CPU, network off: `art/units.py` (unit sheets), `art/props.py` (segments, props, sandbags), `art/rename_keys.py`. The sheets come out plain. |
| `make art-paint` | GPU: `art/paint.py` repaints the rendered unit sheets in the buildings' style; about an hour for all. `UNITS="tank militia"` paints only those. |
| `make art-sheet` | Review pictures of every finished sprite at game size: `art-sheet.png`, `art-stages.png`, `art-leaving.png`, `art-powered.png` in the repository root (git-ignored). |

See [[Art Pipeline]].

## Not a make target

- `python3 tools/mapgen.py --show` draws the maps as text.
- `tools/parsecalls` prints how the net parses radio texts ([[Tests and Headless Matches]]).
- `client/icons/render.mjs` renders the app icons and needs a local Chrome ([[Service Worker and Install]]).

## Related

- [[Running, Deploying and Testing]]
- [[Docker Compose Services]]
- [[Environment Variables]]
- [[Running Locally]]
- [[Tests and Headless Matches]]
