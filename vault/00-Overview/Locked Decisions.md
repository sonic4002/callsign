---
title: Locked Decisions
description: "These rules from CLAUDE.md govern all architecture, gameplay, and art work in Callsign."
type: overview
status: current
tags:
  - type/overview
  - status/current
  - agent/AGY
  - origin/mixed
  - area/overview
  - topic/decisions
created: 2026-11-26
updated: 2026-11-27
agent: AGY
origin: mixed
confidence: medium
related:
  - "[[Art Direction and Sprite Pipeline]]"
  - "[[Home]]"
  - "[[Game Overview]]"
  - "[[AI Brains and Model Relay]]"
  - "[[System Architecture]]"
paths:
  - CLAUDE.md
  - shared/models.json
  - shared/rules.json
  - client/i18n/en.json
  - docs/PLAN.html
  - docs/specs/2026-11-24-bases-harvest-maps.md
  - docs/research/2026-11-24-jev-decision-model.md
  - docs/research/2026-11-24-classic-rts-play.md
---

# Locked Decisions

These rules from `CLAUDE.md` govern all architecture, gameplay, and art work in Callsign. Ask the owner before changing any locked decision.

## Core Architecture
- **Game Server (`server/`)**: Go. Authoritative simulation at **10 ticks/s**, WebSockets, deterministic state hashing, fog of war, and code-based radio routing. Owns all truth; runs **no AI**.
- **Model Relay (`relay/`)**: Go, same repo. Agents never call AI providers directly. The relay verifies the seat and squad brain tier against the game server, picks the model from `shared/models.json`, and calls the provider with the player's encrypted key. Keys are encrypted at rest and never returned to the browser.
- **Shared Rules (`shared/rules.json`)**: Single source of truth for unit stats, costs, structures, maps, landmarks, callsigns, radio phrases, and brain tiers—read by both server and client.
- **Browser Client (`client/`)**: Installable web app (PWA) working in Chrome, Safari, and Edge on macOS, Windows, and phones. UI mirrors for Hebrew RTL; **the map never mirrors**.

## Player Control & UX Refinements
- **Command Sidebar** *(2026-11-24)*: Build panel, radar (gated by Radar structure + power), gold counter, and squad roster.
- **Instant Building & Buying** *(2026-11-24)*: Clicking a structure or unit starts production immediately on the server without waiting for Anvil's approval. The net logs it and Anvil reports when ready. Anvil can still build/buy when ordered by radio or granted the purse.
- **Direct Tap-to-Order** *(2026-11-26)*: Selecting a squad and tapping the map applies `move`, `hold`, or `attack` immediately on the server, and the squad answers *"Wilco, out"* / *"רות, יבוצע, סוף"* by code with no model call. All spoken/typed calls and complex orders remain radio transmissions read by the squad leader.

## AI Brains & Key Custody
- **Free Rule Brain Default** *(2026-11-24)*: Built-in bilingual rule brain requires no AI key at all, with multiple initiative/skill levels.
- **Fast Decision Brain (Jev)** *(2026-11-24)*: TypeSafe AI's `jev-1.14.0` serves as the fast order-taking classifier behind the rule grammar (~220 ms median).
- **Zero Owner Keys in Production** *(2026-11-26)*: Public production servers must **never** hold any key of the owner's (Claude, Jev, etc.). Owner keys are refused by both the agent host and relay unless `CALLSIGN_PRIVATE=1` marks the owner's own machine. Public production runs the rule brain for free and LLMs only on each player's own key.
- **Fireteams**: Pure server-side utility AI, no LLM. Single `nerve` value (`steady` / `shaken` / `pinned`) shown via behavior/radio only—no fatigue stat.
- **Open League**: MCP endpoint exposing the same game tools (`radio`, `move`, `hold`, `attack`, `report`, `buy`) so external agents can compete on a separate ladder without tier locks.

## Economy & Language
- **Economy** *(2026-11-24)*: One resource (**gold**), harvested by haulers from gusher fields to refineries; HQ keeps a small trickle (`10/s`) and sea rigs remain capturable (`30/s`). Structures unlock units; superpowers will unlock via the build tree + gold, never by timer.
- **Bilingual Equality**: All UI strings live in `client/i18n/en.json` and `he.json` (missing keys fail tests). Map points use only letters shared by NATO and IDF phonetic alphabets—**never `ר`** (because `רות` means *Roger*). Radio routing is pure code, never an LLM.

## Art
- **Isometric 3/4 View** *(changed from top-down on 2026-11-24)*: Hand-painted pixel-art look, no baked text, commercially licensed open models only (FLUX.2 klein 4B Apache-2.0; 9B is non-commercial and forbidden). See [[Art Direction and Sprite Pipeline]].

## Related Notes
- [[Home]]
- [[Game Overview]]
- [[AI Brains and Model Relay]]
- [[System Architecture]]

---

## One note per decision

`CLAUDE.md` holds the project's locked decisions: the things an agent or a contributor must ask the owner before changing. This hub has one note per locked decision, each with the decision as written, its date, the owner's reason where one is recorded, what it replaced, and how the code stands against it today.

### Locked decisions

| Decision | Date | State of the code |
|---|---|---|
| [[Decision - Go Game Server]] | 2026-11-23 | matches |
| [[Decision - Model Relay]] | 2026-11-23 | matches, with the Jev exception |
| [[Decision - Client Stack]] | 2026-11-23 | **differs**: plain JavaScript on a canvas, no TypeScript, no Phaser |
| [[Decision - Command Sidebar]] | 2026-11-24 | partly out of date: build bar under the map, tap-to-order goes by hand |
| [[Decision - Direct Build and Buy]] | 2026-11-24 (changed by the owner) | matches |
| [[Decision - Brains without a Player Key]] | 2026-11-24 (owner) | matches |
| [[Decision - Agents and Tools]] | 2026-11-23 | **differs**: agents run on the server machine by default; many more tools |
| [[Decision - Fireteams]] | 2026-11-23 | matches |
| [[Decision - Open League]] | 2026-11-23 | **not built** |
| [[Decision - Economy]] | 2026-11-23, changed 2026-11-24 | matches; superpowers not built |
| [[Decision - Rules Data]] | 2026-11-23 | matches |
| [[Decision - Language and Radio]] | 2026-11-23 | matches, with more callsigns and letters than listed |
| [[Decision - Isometric Art]] | 2026-11-24 (changed from top-down) | matches |
| [[Decision - No Owner Keys on a Public Server]] | 2026-11-26 (owner) | matches |
| [[Decision - Sending a Squad by Hand]] | 2026-11-26 (owner) | matches |

Dates are the dates of the commits that wrote each line into `CLAUDE.md` (`e21e0cb`, `6dcfb63`, `4a9ede0`, `7aa067e`, `5f6c920`, `2585634`).

### Undecided

- [[Open Questions]]: what the documents and commits leave open.

### How decisions are changed

`CLAUDE.md`: "Ask before changing a locked decision above." Two were changed by the owner on 2026-11-24, and both changes are recorded in the file with the owner's words: direct build and buy ("no need to wait for anvil to approve it, its a waste of time") and the rule brain as the default with Jev on the game's own key.

Where the code and a locked decision differ, the difference is listed in [[Plan versus Code]]; the decision text in `CLAUDE.md` has not been edited to match in those cases.

### Other design choices recorded outside `CLAUDE.md`

| Choice | Where |
|---|---|
| Keep the radio as the way to act; no drag-selection, control groups or click-to-move | `docs/research/2026-11-24-classic-rts-play.md` ("Do not do"); since loosened by tap-to-order, see [[Decision - Command Sidebar]] |
| No uncapped unit counts with one agent each | the same document |
| The owner's keys are used only on a machine marked private | commit `342712f`, [[Private Machine Guard]] |
| A bridge is destroyed only on Hammer's order: tried and reverted | commits `8e72697`, `dc4e4a8` and their reverts; [[Terrain, Cover and Bridges]] |

### Related

- [[Home]]
- [[Open Questions]]
- [[Plan versus Code]]
- [[Project Log]]
- [[The Idea]]
