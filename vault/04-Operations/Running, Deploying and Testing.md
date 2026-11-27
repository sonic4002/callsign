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
updated: 2026-11-26
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
