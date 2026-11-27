---
title: Client
description: "The client is one web page (client/index.html) that shows the battlefield, the radio and the base, and sends the commander's calls and direct acts to the game server over one WebSocket."
type: overview
status: current
tags:
  - type/overview
  - status/current
  - agent/CLD
  - origin/mixed
  - area/architecture
  - topic/client
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Decision - Client Stack]]"
  - "[[Open Questions]]"
  - "[[Voice Pipeline (STT and TTS)]]"
  - "[[Where Agents Run]]"
  - "[[Agent Telemetry]]"
  - "[[WebSocket Frames]]"
  - "[[Page Layout]]"
  - "[[Lobby Page]]"
  - "[[Map Rendering]]"
  - "[[Selection and Map Orders]]"
paths:
  - client/index.html
  - client/debug.js
  - client/map.js
  - client/mobile.js
  - client/sw.js
  - client/syntax.test.mjs
  - client/vendor/README.md
  - CLAUDE.md
---

# Client

The client is one web page (`client/index.html`) that shows the battlefield, the radio and the base, and sends the commander's calls and direct acts to the game server over one WebSocket. It is written as plain JavaScript modules that draw on `<canvas>`; it has no build step, no framework and no game engine.

## What it is, and what the instructions say it is

| | `CLAUDE.md` (locked decision) | The code |
|---|---|---|
| Language | TypeScript | Plain JavaScript ES modules (`<script type="module">`); there is no `.ts` file, no `tsconfig`, no bundler |
| Engine | Phaser 3 | None. `client/map.js` draws every frame with the Canvas 2D API. Phaser is not vendored anywhere in the repo |
| Third-party code in the page | — | Only onnxruntime-web for in-browser speech recognition, fetched by `make voice-models` into `client/vendor/ort/` (not committed) |
| Main script name | — | `client/debug.js` (the page grew out of the Phase 0 "debug page" and kept the name) |

Differs from CLAUDE.md: the "TypeScript + Phaser 3" client was never built; see [[Decision - Client Stack]] and [[Open Questions]]. Because nothing is compiled, `client/syntax.test.mjs` runs `node --check` on a module copy of every `.js` file so a stray brace fails `make test` instead of a browser.

The game server serves the page, `/shared/rules.json`, `/assets/` and the agent modules under `/agents/` (the page imports `/agents/bases.mjs` directly).

## Module map

| File | What it holds |
|---|---|
| `index.html` | All markup: stage, sidebar, phone dock, start overlay/lobby, help, settings and AI dialogs. No user-facing text (all by `data-i18n`) |
| `debug.js` | The page script: language, WebSocket frames, radio console, sidebar, build panel, placing, selection and map clicks, lobby, music controls |
| `map.js` | `Scene`: bakes terrain, draws each frame, labels, mini map, `pick()` |
| `iso.js` | The isometric projection and the `Camera` |
| `tiles.js` | Sharp ground tiles for close views (`TileCache`) |
| `terrain.js` | Reads the map grid; code-drawn ground, bridges, landmarks; `drawMiniMap` |
| `fog.js` | Fog of war picture |
| `art.js` | Sprite manifest loading, unit/building drawing, code-drawn fallbacks |
| `bases.js`, `bases-art.js` | Structure cards and locks (pure); structure, fence and icon drawing |
| `placement.js` | Where a structure may stand (mirrors the server), spots and their words, fence runs, production lines |
| `power.js`, `gold.js`, `heroes.js`, `aircraft.js`, `marks.js` | Power/radar/sell/repair, gold fields and haulers, heroes/sandbags/ranks, strike-aircraft roster text, code-drawn rank and icon marks |
| `motion.js`, `fx.js`, `sfx.js`, `music.js`, `finale.js` | Smoothed movement, particle effects, synthesised sounds, music, the fall of a headquarters |
| `nets.js`, `cues.js`, `places.js` | Two nets and traffic level, log folding and cue marks, small place/lobby helpers |
| `lobby.js` | HTTP calls for rooms and seats, seat storage |
| `lesson.js`, `tutorial.js` | The first lesson's steps (data) and its coach (page) |
| `mobile.js`, `mobile.css`, `touch.js` | Phone sheets, keyboard, manifest switch, service-worker registration; gestures |
| `sw.js` | Service worker |
| `speech/`, `voice/` | Spoken radio and speech recognition: see [[Voice Pipeline (STT and TTS)]] |
| `brains/` | Browser-hosted agents, the AI dialog and the live monitor: see [[Where Agents Run]] and [[Agent Telemetry]] |
| `*.test.mjs`, `testdata/` | Node tests of the pure modules; run by `make test` (`node --test`) |

## Frames the page sends and reads

Sent by `debug.js`: `radio` (`{type, text, strict}`), `act` (`{type, id, name, args}`), `lang`, `ready`, `leave`, `restart`, `lesson`. Read in `onFrame`: `hello`, `state`, `lobby`, `command`, `radio`, `acted`, `direct` (ignored by the page), `refused`, `event`, `telemetry`. The full list is in [[WebSocket Frames]].

## Address parameters

`?room=<code>`, `?side=0|1`, `?role=spectator`, `?lang=he|en`, `?help` / `?help=examples`, `?learn`, `?autostart` (with `map`, `gold`, `speed`, `bot`, `fast`, `anvil`; for tests and screenshots), `?sheet=<name>` and `?nosw` (both read by `mobile.js`).

## Notes in this area

- [[Page Layout]] — the regions of the screen
- [[Lobby Page]] — the start overlay, making and joining a match
- [[Map Rendering]] — projection, baking, fog, sprites, depth
- [[Selection and Map Orders]] — selecting and ordering from the map
- [[Build Bar]] — structures, units, placing, rally
- [[Radio Console]] — the log, the two nets, the box
- [[Settings]] — every setting and where it is kept
- [[Mobile Layout]] — phones and large touch screens
- [[Service Worker and Install]] — offline cache, manifest, icons
- [[i18n Rules]] — Hebrew and English strings, RTL
- [[Sound, Music and Effects]] — sfx, music, particles, the finale
- [[Help and Tutorial Page]] — the help window and the first lesson

## Related

- [[Home]]
- [[Server Architecture]]
- [[WebSocket Frames]]
- [[Radio Net and Bilingual Procedure]]
- [[Voice Pipeline (STT and TTS)]]
- [[AI Brains and Model Relay]]
- [[Decision - Client Stack]]
- [[Decision - Command Sidebar]]
