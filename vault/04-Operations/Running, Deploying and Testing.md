---
title: Running, Deploying and Testing
description: "Everything in Callsign runs inside Docker containers (zero host toolchain dependencies, clean --rm execution)."
type: overview
status: current
tags:
  - type/overview
  - status/current
  - agent/AGY
  - origin/code
  - area/operations
  - topic/operations
  - topic/docker
  - topic/testing
created: 2026-11-26
updated: 2026-11-27
agent: AGY
origin: code
confidence: medium
related:
  - "[[Home]]"
  - "[[System Architecture]]"
  - "[[Friend Matches and Security Model]]"
  - "[[Unit Asset Redesign Log]]"
paths:
  - server/sim
  - server/room
  - server/radio
  - tts/test_pronounce.py
  - stt/test_server.py
  - Makefile
  - docker-compose.yml
  - Dockerfile.dev
  - .env.example
  - docs/FRIEND-MATCH.md
  - server/cmd/callsign/main.go
---

# Running, Deploying and Testing

Everything in Callsign runs inside **Docker containers** (zero host toolchain dependencies, clean `--rm` execution).

## Docker Images

| Image | Purpose | Build Command |
|---|---|---|
| `callsign-dev` | Go game server, Go model relay, Node agent host & test runner | `make image` |
| `callsign-blender` | Blender 4.2 (`bpy`) CPU sprite sheet & prop renderer | `make art-units-image` |
| `callsign-art` | ComfyUI + PyTorch + FLUX.2 klein 4B (RTX 5070 Ti GPU) | `make art-image` |
| `callsign-tts` | BlueV3 ONNX radio voice synthesis service | `make tts-image` |
| `callsign-stt` | GPU faster-whisper Hebrew/English transcription service | `make stt-image` |

## Starting & Stopping the Game

```sh
# Local play on http://localhost:8080 (auto-enables TTS & GPU STT if images + models exist)
make play

# Open to local LAN for a friend match (plain HTTP; see Friend Matches note)
make play-lan

# Public HTTPS on your domain (requires CALLSIGN_PUBLIC_URL in .env)
# Uses Cloudflare Tunnel if CALLSIGN_TUNNEL_TOKEN is set, else Caddy Let's Encrypt on :443
make play-public

# Stop all profiles cleanly
make stop
```

## Full Verification Suite

| Command | What It Checks |
|---|---|
| `make test` | `go vet ./...`, `go test ./...` (`server/sim`, `server/room`, `server/radio`, `relay`), `go build`, and `node --test` (all client, agent, i18n, manifest, voice grammar/pipeline tests — 261+ tests). |
| `make relay-test` | `go test -race -count=1 ./relay/... ./shared/...` with fake providers (network off). |
| `make voice-test` | Real on-device ONNX Hebrew Zipformer2 & Ozen-v1 transcription tests (`CALLSIGN_VOICE_MODELS=1`). |
| `make tts-test` | TTS pronunciation unit tests (`tts/test_pronounce.py`). |
| `make stt-test` | STT HTTP service validation unit tests (`stt/test_server.py`). |
| `make stt-quiet` | Verifies silence/hiss/hum/clicks transcribe empty on GPU Whisper. |
| `make balance` | Runs `200` headless scripted matches per map (`SEEDS=100` each side) to verify 45%–55% faction parity. |
| `make cost` | Measures single-core tick CPU time, snapshot payload sizes, and economy gold/min rates. |

## Art Pipeline Commands
```sh
make art-units                                     # Render all Blender units & props
make art-paint UNITS="tank commandos"              # Run FLUX paint pass on RTX 5070 Ti
make art-sheet                                     # Generate art-sheet.png, stages, leaving, powered
```

## Related Notes
- [[Home]]
- [[System Architecture]]
- [[Friend Matches and Security Model]]
- [[Unit Asset Redesign Log]]

---

## In detail

This hub covers building, testing and running the game: everything runs in Docker images through `make`, and nothing is installed on the host or at run time. It lists the make targets, the compose services, the environment variables and flags, and the three ways to run (this machine, the local network, a public https address).

### Notes

- [[Make Targets]]: every `make` target and what it does.
- [[Docker Compose Services]]: the services `make play` starts and how they are wired.
- [[Environment Variables]]: every `CALLSIGN_*` name and its meaning (never values).
- [[Server Flags]]: the game server's and the relay's command-line flags.
- [[Running Locally]]: first run, tests, optional voices and listening.
- [[Playing on a LAN]]: `make play-lan`, what is and is not protected.
- [[Playing in Public]]: `make play-public` over a tunnel or a home address with a certificate.
- [[Staging and Releasing]]: the `next` branch and what a release touches.

### The short version

```sh
make image      # once, and again when go.mod, go.sum or agents/package-lock.json change
make test       # go vet, go test ./..., then the Node tests, with the network off
make play       # game server + agent host + relay; open http://localhost:8080
make stop
```

### Principles the build files state

- Everything runs in the `callsign-dev` image (Go 1.27.4 and Node 24, with every Go module and npm package already downloaded). Tests run with `--network none`.
- The repository is mounted read-only into the running services (`.:/src:ro`).
- Secrets live in `.env`, which is git-ignored; `.env.example` lists the names. `make play` makes a fresh agent key for every run.
- Optional parts start only when their image and models are present: radio voices (`voice` profile), server-side listening (`listen` profile, needs a GPU).
- The game server binds to this machine only unless `make play-lan` or `make play-public` opens it.

### Related

- [[Home]]
- [[Server Architecture]]
- [[Model Relay]]
- [[Voice Pipeline (STT and TTS)]]
- [[Art Pipeline]]
- [[Tests and Headless Matches]]
- [[Seats, Tokens and Trust]]
