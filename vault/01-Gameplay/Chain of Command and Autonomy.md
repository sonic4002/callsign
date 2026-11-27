---
title: Chain of Command and Autonomy
description: "Callsign models a real four-tier military hierarchy (mission command / פיקוד משימה): you give strategic intent, while subordinates figure out execution within your orders."
type: overview
status: current
tags:
  - type/overview
  - status/current
  - agent/AGY
  - origin/code
  - area/gameplay
  - topic/gameplay
  - topic/autonomy
  - topic/mission-command
created: 2026-11-26
updated: 2026-11-26
agent: AGY
origin: code
confidence: medium
related:
  - "[[Home]]"
  - "[[Radio Net and Bilingual Procedure]]"
  - "[[AI Brains and Model Relay]]"
  - "[[Factions and Units]]"
paths:
  - shared/rules.json
---

# Chain of Command and Autonomy

Callsign models a real four-tier military hierarchy (**mission command / פיקוד משימה**): you give strategic intent, while subordinates figure out execution within your orders.

## The Four Layers

| Layer | Callsign | Driven By | Responsibilities |
|---|---|---|---|
| **1. Commander (You)** | Hammer / פטיש | Human | Sets strategy, issues voice/text radio orders, builds structures & buys units, overrides any squad directly. |
| **2. Operator** | Anvil / סדן | Agent (Rule or Top LLM) | Tracks the full battlefield, announces base cues, executes complex multi-squad intent, and (when granted command/purse) manages idle squads and economy. |
| **3. Squad Leaders** | Viper, Rhino, Hawk, Shark, Comet, Ghost, Raven | Agent (Rule, Jev, or Tier 1–3 LLM) | Event-driven (wakes on orders, contacts, losses, pinned). Translates orders into game tools (`move`, `hold`, `attack`, `fortify`, `repair`, `capture`, `plant`, `seize`, `radio`). |
| **4. Fireteams** | Soldiers / Vehicles | Deterministic Utility AI (Go server) | Runs every tick (10 Hz) on the server. Handles local target selection, taking nearby cover, abandoning collapsing buildings, dodging armour, and reporting nerve. Free and instant. |

## Obedience & Control Rules
- **You outrank everyone**: Calling any squad directly overrides Anvil; Anvil hears the transmission and leaves that squad under your direct control until you hand the fight back (`"run the fight"` / `"נהל את הקרב"`).
- **Direct Tap-to-Order**: Selecting a squad and tapping the map executes `move`, `hold`, or `attack` immediately on the server with a code-generated *"Wilco, out"* (no model call).
- **Instant Build & Buy**: Clicking a structure or unit in the sidebar starts construction/production immediately without waiting for Anvil's approval.
- **Agent-less Units**: Haulers, base defences, and garrisoned fireteams run pure server utility AI with no leader agent—keeping token costs bounded while fielding larger armies (population cap: **12 squads**).

## Nerve (Morale & Suppression)
A single fireteam value (`0.0` → `1.0`) shown only through behavior and radio tone (never as a UI bar):
- **Steady** (`< 0.35`): Normal movement speed and accuracy.
- **Shaken** (`>= 0.35`): Hugs cover, fires less accurately, tense radio reports.
- **Pinned** (`>= 0.70`): Freezes/crawls, calls *"Pinned at Golf, request support!"*.
- **Triggers (`shared/rules.json`)**: `+0.005` per near miss, `+0.018` per hit, `+0.15` per member lost, `+0.25` per fireteam lost; `-0.15` relief on kill; recovers at `0.04/s` after `2s` quiet (`2×` faster near steady allies).

## Earned Veterancy Ranks
Separate from bought **Brain Tiers** (which improve decision intelligence via model class), squads earn combat ranks through kills:

| Rank | Hebrew | Kill Value Threshold | Accuracy | Nerve Taken | Out-of-Combat Heal |
|---|---|---|---|---|---|
| **Seasoned** | מנוסה | `3×` squad cost | `1.04×` | `0.94×` | — |
| **Elite** | עילית | `6×` squad cost | `1.08×` | `0.88×` | `0.4%/s` |

## Related Notes
- [[Home]]
- [[Radio Net and Bilingual Procedure]]
- [[AI Brains and Model Relay]]
- [[Factions and Units]]
