---
title: Roadmap and Status
description: "Callsign has progressed well beyond the original Phase 0–1 MVP into rich Phase 2 functionality:"
type: overview
status: current
tags:
  - type/overview
  - status/current
  - agent/AGY
  - origin/mixed
  - area/overview
  - topic/roadmap
created: 2026-11-26
updated: 2026-11-26
agent: AGY
origin: mixed
confidence: medium
related:
  - "[[Unit Asset Redesign Log]]"
  - "[[Home]]"
  - "[[Game Overview]]"
  - "[[Running, Deploying and Testing]]"
paths:
  - server/sim
  - shared/rules.json
  - server/radio
  - docs/PLAN.html
---

# Roadmap and Status

## Current Milestone Snapshot (Nov 2026)

Callsign has progressed well beyond the original Phase 0–1 MVP into rich Phase 2 functionality:

| Area | Current Status | Key Implementation |
|---|---|---|
| Authoritative Go Sim | Built & tested | 10 ticks/s, fog of war, A* pathing, nerve, ranks, crushing, garrisons, bridges, sandbags, haulers, power, queues (`server/sim/`) |
| Base Building & Tech Tree | Built & tested | 11 structures per faction, placement radius, visible construction stages, sell/repair, rally points, neutral tech buildings |
| Factions, Heroes & Strike Air | Built & tested | **Aegis Directorate** & **Ashfall Network**, heroes (**Sentinel**, **Oracle**), strike jets & prop bombers (`shared/rules.json`) |
| Bilingual Radio Net | Built & tested | Code-based Hebrew & English callsign/point/landmark routing, prowords, Anvil base cues (`server/radio/`) |
| AI Brains & Model Relay | Built & tested | Rule brain + grammar, Jev (`jev-1.14.0`) fast brain, encrypted player key store, tier enforcement (`relay/`, `agents/`) |
| Voice Input & Output | Built & tested | On-device Zipformer2 66M (Hebrew, live AudioWorklet) + Moonshine base (English), plus GPU Whisper STT & TTS services |
| Friend Matches & HTTPS | Built & tested | Lobby with map previews, join codes, seat tokens, `make play-lan`, `make play-public` (Caddy Let's Encrypt / Cloudflare Tunnel) |
| Art Pipeline & Unit Redesign | Active | Buildings/landmarks/portraits complete; 4 flagship units redesigned with Blender 4.2 Cel-Ink + cleaned YCbCr FLUX (see [[Unit Asset Redesign Log]]) |

## Design Plan Phases (`docs/PLAN.html`)
- **Phase 0 (Prototype the Brain)** — *Done*: Deterministic Go sim, radio net, utility AI fireteams with nerve, headless match tests.
- **Phase 1 (Playable MVP)** — *Done*: Two factions, full base-building & harvesting loop, three maps, mobile-friendly UI, bilingual HUD, generated art & audio.
- **Phase 2 (Agents, Relay & Voice)** — *Done / Polishing*: Browser agent workers, Go model relay, OpenRouter/Anthropic/Gemini/OpenAI support, live in-browser Hebrew/English STT, TTS radio voices, unit visual upgrade.
- **Phase 3 (Online)** — *Upcoming*: Player accounts, matchmaking, casual & ranked ladders, public MCP Open League ladder, shareable replays with agent reasoning.
- **Phase 4 (Growth)** — *Planned*:
  - Superpowers through tier-3 build chain (Aegis *Orbital Eye*, Ashfall *Tunnel Surge*)
  - Additional factions (*Iron Bloc*, *Hornet Collective*, *Tidewall Union*)
  - Rich non-refilling gold fields, cheap agent-less scout units, garrison-clearing counters, persistent veteran squad memories.

## Related Notes
- [[Home]]
- [[Game Overview]]
- [[Unit Asset Redesign Log]]
- [[Running, Deploying and Testing]]
