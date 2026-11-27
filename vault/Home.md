---
title: Home
description: "A browser & mobile real-time strategy game where every squad is an AI agent, commanded by voice or text over a real military radio net, in Hebrew and English."
type: hub
status: current
tags:
  - type/hub
  - status/current
  - agent/AGY
  - origin/docs
  - area/home
  - topic/moc
  - topic/home
created: 2026-11-26
updated: 2026-11-27
agent: AGY
origin: docs
confidence: medium
related:
  - "[[Game Overview]]"
  - "[[Locked Decisions]]"
  - "[[Roadmap and Status]]"
  - "[[Chain of Command and Autonomy]]"
  - "[[Radio Net and Bilingual Procedure]]"
  - "[[Factions and Units]]"
  - "[[Base Building and Economy]]"
  - "[[Maps, Terrain and Places]]"
  - "[[System Architecture]]"
  - "[[AI Brains and Model Relay]]"
paths:
  - CLAUDE.md
---

# Callsign · אות קריאה

> A browser & mobile real-time strategy game where every squad is an AI agent, commanded by voice or text over a real military radio net, in Hebrew and English.

Open this folder (`callsign/vault`) as an Obsidian vault to browse the game's design, rules, architecture, art pipeline, and operations.

---

## 00 · Overview & Governance
- [[Game Overview]] — Core concept, design pillars, and how a match plays out.
- [[Locked Decisions]] — Non-negotiable architectural and gameplay rules (sourced from `CLAUDE.md`).
- [[Roadmap and Status]] — Phase 0 → Phase 4 roadmap and current build status.

## 01 · Gameplay & Rules
- [[Chain of Command and Autonomy]] — 4-layer hierarchy (Hammer → Anvil → Squad Leaders → Fireteams), nerve, and veterancy ranks.
- [[Radio Net and Bilingual Procedure]] — Hebrew & English radio procedure, prowords, NATO/IDF phonetic points, and callsigns.
- [[Factions and Units]] — Complete roster and stats for **Aegis Directorate** and **Ashfall Network** (including heroes and strike aircraft).
- [[Base Building and Economy]] — Tech tree, power, production queues, rally points, haulers, gushers, sell/repair, and neutral tech buildings.
- [[Super Powers]] — All 15 strategic and tactical super weapons, Strategic Command & Black-Site Silo complexes, lobby allowances (`Off / 1..4 / All`), and custom targeting cursors.
- [[Maps, Terrain and Places]] — The three mirrored maps (*Twin Bridges*, *Frozen Lake*, *Mountain Passes*), terrain rules, cover, garrisons, bridges, and descriptive Places.

## 02 · Architecture & AI
- [[System Architecture]] — Go game server (10 ticks/s), Go model relay, browser client, Web Worker agents, and MCP Open League.
- [[AI Brains and Model Relay]] — Rule brain, Jev (`jev-1.14.0`) fast decision brain, LLM tiers (`models.json`), and key custody/privacy boundaries.
- [[Voice Pipeline (STT and TTS)]] — On-device Zipformer2 (Hebrew) & Moonshine (English) STT, GPU Whisper STT, and TTS radio voices.

## 03 · Art & Audio
- [[Art Direction and Sprite Pipeline]] — Isometric 3/4 hand-painted pixel-art style (`STYLE.md`), FLUX.2 klein 4B buildings, Blender + FLUX units, and audio.
- [[Unit Asset Redesign Log]] — Upgraded Blender 4.2 Freestyle cel-ink + cleaned YCbCr FLUX pipeline, flagship prototypes, and backup/rollback locations.

## 04 · Operations
- [[Running, Deploying and Testing]] — Docker-only workflow (`make play`, `make play-lan`, `make play-public`, `make test`, balance & cost benchmarks).
- [[Friend Matches and Security Model]] — Join codes, seat tokens, LAN vs HTTPS/Cloudflare Tunnel hosting, and threat boundaries.

## 05 · Decisions
- [[Locked Decisions]] — Every locked decision, with one note per decision giving its date, the owner's reason and how the code stands.
- [[Open Questions]] — What the documents and the commits leave undecided.

## 06 · Status & Reference
- [[Known Flaws]], [[Backlog]] and [[Plan versus Code]] — What is broken, what is waiting, and where the documents and the code differ.
- [[Project Log]] — Dated history of the project.
- [[Glossary]] — Every project term, callsign and Hebrew/English pair.

Each note above ends with an **In detail** section that links to the focused notes on its subject.

## About this vault
- [[Index]] — Generated table of every note with a one-line description.
- [[Conventions]] — The vault contract: folders, frontmatter, tags, rules.
- [[Agent Handoff]] — Where an agent starts and which notes to load.
