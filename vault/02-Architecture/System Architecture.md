---
title: System Architecture
description: "Callsign separates deterministic simulation, AI billing/routing, voice services, and browser UI into clean services orchestrated via docker-compose.yml."
type: overview
status: current
tags:
  - type/overview
  - status/current
  - agent/AGY
  - origin/code
  - area/architecture
  - topic/architecture
  - topic/go
  - topic/docker
created: 2026-11-26
updated: 2026-11-26
agent: AGY
origin: code
confidence: medium
related:
  - "[[Home]]"
  - "[[Locked Decisions]]"
  - "[[AI Brains and Model Relay]]"
  - "[[Voice Pipeline (STT and TTS)]]"
  - "[[Running, Deploying and Testing]]"
paths:
  - server/sim
  - server/room
  - server/radio
  - server/bot
  - shared/models.json
  - client/voice
---

# System Architecture

Callsign separates deterministic simulation, AI billing/routing, voice services, and browser UI into clean services orchestrated via `docker-compose.yml`.

```mermaid
flowchart LR
  subgraph Browser["Player Browser / PWA (client/)"]
    UI["Isometric Canvas Map + Radio HUD + Voice"]
    STT_W["On-Device STT Worker (Zipformer2 / Moonshine)"]
    AG["Browser Agent Workers (optional BYOK)"]
  end

  UI -- "WebSocket /ws + REST /api" --> GS["Game Server (Go, :8080)\n10 Hz Sim + Fog + Radio Net"]
  GS -- "WS events + radio" --> HOST["Agent Host (Node, agents/)\nRule / Jev / LLM Workers"]
  HOST -- "Game tools + radio" --> GS
  HOST -. "POST /think or /decide" .-> RL["Model Relay (Go, :8090)\nTier Enforcement + Encrypted Keys"]
  AG -. "via /relay/v1/" .-> RL
  RL -. "GET /internal/tier" .-> GS
  RL -. "Player API Key" .-> LLM["Anthropic / OpenAI / Gemini / OpenRouter / TypeSafe"]
  GS -. "Optional GPU STT" .-> STT["STT Service (Whisper, :5003)"]
  GS -. "Optional TTS" .-> TTS["TTS Service (BlueV3, :5002)"]
  MCP["Open League External Agents (MCP)"] -- "Tools" --> GS
```

## Repository Layout

| Directory | Language / Runtime | Responsibility |
|---|---|---|
| `server/sim/` | Go | Authoritative deterministic simulation (`10 ticks/s`), pathing, fog of war, combat, economy, structures, heroes, sorties. |
| `server/room/` | Go | Multi-room hub, lobbies, seat tokens, WebSocket fan-out, command authorization, Anvil cues, traffic prioritization. |
| `server/radio/` | Go | Bilingual callsign, map-point, landmark, and proword parser & router. |
| `server/bot/` | Go | Built-in scripted opponent (`easy`, `normal`, `standard`/`relentless`, `rush`). |
| `relay/` | Go | Encrypted player API key store (`.relay-data/`), model selection from `shared/models.json`, chat & Jev decision proxying. |
| `shared/` | Go + JSON | `rules.json` (game balance/maps/radio) and `models.json` (tier-to-model mapping). |
| `agents/` | Node.js / ESM | Agent runtime (`agent.mjs`), prompts, tools, rule brain (`brain-rule.mjs`, `rule-grammar.mjs`), Jev brain (`brain-jev.mjs`), relay/Claude brains. |
| `client/` | Vanilla JS + CSS + PWA | Isometric canvas renderer (`art.js`, `map.js`, `terrain.js`), mobile & RTL HUD, service worker (`sw.js`), on-device voice (`client/voice/`). |
| `stt/` & `tts/` | Python (Docker) | Optional GPU Whisper transcription service (`callsign-stt`) and radio voice synthesis service (`callsign-tts`). |
| `art/` | Python (Blender + ComfyUI) | Offline sprite pipelines (`units.py`, `props.py`, `paint.py`, `generate.py`, `sheet.py`). |

## Key Engineering Properties
- **Determinism**: Same random seed + commands produces identical state hashes across all three maps, verified in `server/sim/` tests.
- **Prompt Injection Defense**: Agents never receive enemy free-text—only structured fog-filtered game snapshots and their own side's radio traffic.
- **Resilience**: If a player backgrounds their phone or the relay goes down, squads keep executing their last orders and server fireteam AI keeps fighting.

## Related Notes
- [[Home]]
- [[Locked Decisions]]
- [[AI Brains and Model Relay]]
- [[Voice Pipeline (STT and TTS)]]
- [[Running, Deploying and Testing]]
