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
updated: 2026-11-27
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
  - docs/FRIEND-MATCH.md
  - docs/specs/2026-11-24-bases-harvest-maps.md
  - docs/research/2026-11-24-classic-rts-play.md
  - docs/research/2026-11-24-jev-decision-model.md
  - stt/eval/RESULTS.md
  - CLAUDE.md
  - KICKOFF.md
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

---

## Known flaws and backlog

This area gathers what is known to be wrong, limited, unfinished or out of step: from code comments, documents, test skips, commit messages and from reading the code while writing this vault. Nothing here was found by running the game; items that were read from code but not confirmed by a test say so.

### Notes

- [[Known Flaws]]: defects, limits and stale text, by area, each with its source.
- [[Backlog]]: what is planned or suggested and not built.
- [[Plan versus Code]]: where `docs/PLAN.html`, `CLAUDE.md` and `KICKOFF.md` describe something other than what exists.

### How this was gathered

| Source | What it gave |
|---|---|
| Code markers | there are no `TODO`, `FIXME`, `XXX` or `HACK` markers in the Go, JavaScript or Python sources; flaws are recorded in ordinary comments and documents instead |
| Test skips | three situation-dependent skips in the simulation tests, plus the opt-in probes ([[Tests and Headless Matches]]) |
| Documents | `docs/FRIEND-MATCH.md` ("Not protected"), `stt/eval/RESULTS.md`, the NOTICE files, the "out of scope" and "do next" lists of the spec and the research notes |
| Commit messages | things fixed "from a played match", reverts, and statements such as "balance is not settled in this commit" |
| Reading the code | stale comments, dead code, duplicated rules, a few likely bugs |

### The short list

The items most likely to matter to someone picking the project up:

1. The locked decisions in `CLAUDE.md` no longer describe the client, where agents run, or how squads are ordered ([[Plan versus Code]]).
2. A LAN match is plain HTTP: tokens, radio and a typed AI key can be read on the network ([[Playing on a LAN]]).
3. Nothing persists: no accounts, no saved matches, no ladder ([[Backlog]]).
4. Speech recognition is measured on synthetic voices only, and never on a real phone ([[Recognition Evaluation]]).
5. Several licences must be read, and a credits screen built, before a public release ([[Licences and Credits]]).
6. Only scripted balance is measured ([[Balance]]).

### Related

- [[Home]]
- [[Known Flaws]]
- [[Backlog]]
- [[Plan versus Code]]
- [[Open Questions]]
- [[Locked Decisions]]

---

## History

The whole project is four days old on the date of this vault: 319 commits from the evening of 2026-11-23 to the evening of 2026-11-26, read with `git log`. This hub gives the shape of those days and points to the dated log.

### Notes

- [[Project Log]]: a dated log of how the project developed, with commit ids.

### The shape of it

| Day | Commits | What happened |
|---|---|---|
| 2026-11-23 (evening) | 13 | The plan, the locked decisions and the kickoff prompt; Phase 0 built in about an hour: rules, deterministic simulation, radio net, rooms and WebSocket, the agent loop, `make play`, the debug page, first balance |
| 2026-11-24 | 278 | Almost everything else: isometric page and art pipeline, fog, voice in and out, rooms and seats, the relay, phone layout, playing in public, the first lesson, the whole base-building game in three waves (structures, harvesting, maps; placement, queues, heroes; power, radar, tech buildings), direct build and buy, the rule brain and the fast brain, server-side listening, bodies and collision, three bigger maps and rebalancing |
| 2026-11-25 | 7 | The net is made quieter: kinds, two nets, traffic levels, one squad reporting what several meet |
| 2026-11-26 | 21 | The private-machine guard, the streaming Hebrew recogniser in the browser, tap-to-order, strike aircraft, selection by name plate and letting go of a selection |

### How the work was done

- Work was cut along seams for parallel agents, each in its own git worktree and branch, merged back into `main` or the staging branch `next` (42 merge commits). The bases spec says so directly: "The work is cut for parallel agents along these seams, each owning its files."
- Commit subjects are plain sentences saying what changed for the player ("A squad sent by tapping the map obeys at once").
- Several changes are labelled "From a played match": things found by playing and fixed (`075c6e0`, `b22db48`, `402d7a0`).
- Decisions the owner changed are written into `CLAUDE.md` with the owner's words and the date ([[Locked Decisions]]).

### Documents by date

| Date | Document |
|---|---|
| 2026-11-23 | `CLAUDE.md`, `KICKOFF.md`, `docs/PLAN.html` (design plan v0.6) |
| 2026-11-24 | `docs/FRIEND-MATCH.md`; `docs/specs/2026-11-24-bases-harvest-maps.md` and its three addenda; `docs/research/2026-11-24-classic-rts-play.md`; `docs/research/2026-11-24-jev-decision-model.md`; `docs/art/STYLE.md`; the NOTICE and CREDITS files |
| 2026-11-24 to 26 | `stt/eval/RESULTS.md` (listening measurements, extended on the 26th) |
| 2026-11-26 | this vault |

### Related

- [[Home]]
- [[Project Log]]
- [[Locked Decisions]]
- [[Staging and Releasing]]
- [[Plan versus Code]]
