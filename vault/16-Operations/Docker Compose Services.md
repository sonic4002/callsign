---
title: Docker Compose Services
description: "docker-compose.yml defines the seven services that make play and its variants start."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/code
  - area/operations
  - topic/ops
  - topic/docker
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[HTTP API]]"
  - "[[Seats, Tokens and Trust]]"
  - "[[Fast Brain - Jev]]"
  - "[[Server Whisper]]"
  - "[[Playing in Public]]"
  - "[[Speech]]"
  - "[[Operations]]"
  - "[[Make Targets]]"
  - "[[Environment Variables]]"
  - "[[Server Flags]]"
paths:
  - docker-compose.yml
  - Makefile
  - tools/Caddyfile
  - Dockerfile.dev
---

# Docker Compose Services

`docker-compose.yml` defines the seven services that `make play` and its variants start. Three always run (game server, agent host, model relay); four are behind profiles and start only when wanted and possible.

## Services

| Service | Image | Profile | Command | Reached how |
|---|---|---|---|---|
| `server` | `callsign-dev` | always | `go run ./server/cmd/callsign -addr=:8080 -seed -bot -tts=http://tts:5002 -stt -relay=http://relay:8090 -fast-brain -anvil-level` | host port 8080, bound to `CALLSIGN_BIND` (default this machine only) |
| `agents` | `callsign-dev` | always | `node agents/main.mjs` | no port; dials the server at `ws://server:8080/ws` |
| `relay` | `callsign-dev` | always | `go run ./relay/cmd/relay -addr=:8090 -game=http://server:8080/internal/tier -data=/data -jev-daily-usd` | no port of its own; only through the game server at `/relay/` |
| `tts` | `callsign-tts` | `voice` | `python /src/tts/server.py --cache=/cache` | through the game server at `/tts/` |
| `stt` | `callsign-stt` | `listen` | `python /src/stt/server.py` | only by the game server, on the internal `listen` network |
| `tunnel` | `cloudflare/cloudflared:2026.11.2` | `public` | `tunnel --no-autoupdate run` | dials out; carries the public https name to `server` |
| `https` | `caddy:2.11.9-alpine` | `https` | Caddy with `tools/Caddyfile` | host port 443; reverse proxy to `server:8080` |

All services run as the calling user (`CALLSIGN_UID`:`CALLSIGN_GID`) with `HOME=/tmp` and `init: true`.

## Wiring worth knowing

- **One origin.** The page talks only to the game server, which proxies `/tts/` and `/relay/` and passes recordings on to the listening service. See [[HTTP API]].
- **The agent key.** `server`, `agents` and `relay` all get `CALLSIGN_AGENT_KEY`; `make play` makes a new one each run. Empty leaves the server trusting every agent, which is only safe on this machine ([[Seats, Tokens and Trust]]).
- **The fast-brain key stays with the relay.** The `agents` service reads `.env` (`env_file`) for its own settings, and the compose file then sets `CALLSIGN_JEV_KEY` to empty for it: "the game's own key for the fast brain belongs to the relay alone". Only the `relay` service is given it ([[Fast Brain - Jev]]).
- **Read-only source.** The repository is mounted `.:/src:ro` into every service. Writable mounts are `./assets/voice-cache` (spoken lines), `./.relay-data` (the encrypted key store), `./.caddy-data` (the certificate) and the external `callsign-gocache` volume.
- **The listening service has no way out.** The `listen` network is `internal: true`; the `stt` service is on that network only and is given the GPU (`nvidia.com/gpu=all`). The game server is on both networks ([[Server Whisper]]).
- **Public profiles.** `tunnel` gets `CALLSIGN_TUNNEL_TOKEN`; `https` gets `CALLSIGN_DOMAIN`, the capability to bind port 443, and `restart: unless-stopped` ([[Playing in Public]]).

## When the optional profiles start

| Profile | `make play` adds it when |
|---|---|
| `voice` | the `callsign-tts` image exists and `assets/models/bluev3/onnx/vocoder.onnx` is present |
| `listen` | the `callsign-stt` image exists, both Whisper models are present and `nvidia-smi` works; only then is `CALLSIGN_STT` set to `http://stt:5003` |
| `public` | `make play-public` with a tunnel token in `.env` |
| `https` | `make play-public` without a tunnel token |

Without `voice` the page falls back to the browser's own voice; without `listen` the page recognises speech in the browser ([[Speech]]).

## Related

- [[Operations]]
- [[Make Targets]]
- [[Environment Variables]]
- [[Server Flags]]
- [[Model Relay]]
- [[Where Agents Run]]
