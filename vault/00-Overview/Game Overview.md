---
title: Game Overview
description: "Callsign (אות קריאה) combines the fast base-building RTS feel of Command & Conquer: Generals and Red Alert 2 with voice-driven command inspired by Tom Clancy's EndWar—upgraded with real AI agents ..."
type: overview
status: current
tags:
  - type/overview
  - status/current
  - agent/AGY
  - origin/docs
  - area/overview
  - topic/design
created: 2026-11-26
updated: 2026-11-26
agent: AGY
origin: docs
confidence: medium
related:
  - "[[Radio Net and Bilingual Procedure]]"
  - "[[AI Brains and Model Relay]]"
  - "[[Chain of Command and Autonomy]]"
  - "[[Base Building and Economy]]"
  - "[[Home]]"
  - "[[Locked Decisions]]"
  - "[[Roadmap and Status]]"
  - "[[Factions and Units]]"
paths:
  - CLAUDE.md
  - docs/PLAN.html
  - docs/specs/2026-11-24-bases-harvest-maps.md
---

# Game Overview

**Callsign (אות קריאה)** combines the fast base-building RTS feel of *Command & Conquer: Generals* and *Red Alert 2* with voice-driven command inspired by *Tom Clancy's EndWar*—upgraded with real AI agents and authentic military radio procedure in both **Hebrew** and **English**.

> *"Anvil, this is Hammer. Viper 2 holds Foxtrot, drones over Kilo, nobody pushes until the artillery is up. Over."*
> *"צפע 2, כאן פטיש, תחזיקו את פסל, עבור."*

## Design Pillars
1. **Command, Not Micro-Clicks**: Skill comes from strategic intent, positioning, economy protection, and how clearly you brief your operator (**Anvil**) and squad leaders.
2. **Authentic Bilingual Radio**: Hebrew and English are first-class citizens—every menu, callsign, map point, and radio proword works natively in both languages (and mixed calls like *"תחזיקו את Foxtrot"* are valid). See [[Radio Net and Bilingual Procedure]].
3. **Quick, Complete Matches**: 10–25 minute skirmishes playable on desktop or mobile browsers (installable PWA, nothing to install).
4. **Fair & Free-to-Play by Default**:
   - Everyone can play for free using the built-in **Rule Brain** (no AI key needed).
   - Players who want LLM-driven squads bring their own API key (OpenRouter, Anthropic, Gemini, or OpenAI).
   - **No pay-to-win**: Smarter squad brains (Tiers 1–3) are bought exclusively with in-game **gold** during the match, enforced by the [[AI Brains and Model Relay|Model Relay]].
5. **Alive Battlefield**: Fireteams run deterministic utility AI with a single **nerve** state (`steady` / `shaken` / `pinned`), seek cover, garrison buildings, and earn **veterancy ranks** (`Seasoned` / `Elite`). See [[Chain of Command and Autonomy]].

## Core Match Loop
1. **Open the Base**: Start with only your HQ and two starting infantry squads; build Power → Refinery (includes a free hauler) → Barracks → Works → Radar → Airbase / Dockyard. See [[Base Building and Economy]].
2. **Harvest & Contest Gold**: Automated haulers gather gold from refilling **gusher** fields; contest map points, neutral tech buildings, bridges, and the rich sea rig.
3. **Command Over the Net**: Issue spoken or typed orders to **Anvil** or directly to any squad, or tap-order a selected squad on the map for instant tactical movement (`Wilco, out`).
4. **Upgrade & Escalate**: Spend gold on new squads, defences, heroes (**Sentinel** / **Oracle**), strike aircraft, and higher squad brain tiers.
5. **Win Condition**: Destroy the enemy HQ (`Alpha` / `Zulu`), or hold more map points when the match timer expires.

## Source Documents
- `CLAUDE.md` — Locked decisions and repository layout
- `docs/PLAN.html` — Original comprehensive game design plan
- `docs/specs/2026-11-24-bases-harvest-maps.md` — Base-building, economy, maps, heroes, and 10 classic RTS mechanics spec

## Related Notes
- [[Home]]
- [[Locked Decisions]]
- [[Roadmap and Status]]
- [[Factions and Units]]
