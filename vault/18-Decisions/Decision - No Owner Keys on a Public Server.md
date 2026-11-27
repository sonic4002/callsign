---
title: Decision - No Owner Keys on a Public Server
description: "A public server holds none of the owner's AI keys; a Claude key, Claude token or Jev key is used only where CALLSIGN_PRIVATE=1 marks the owner's own machine."
type: decision
status: current
tags:
  - type/decision
  - status/current
  - agent/CLD
  - origin/mixed
  - area/decisions
  - topic/keys
  - topic/production
created: 2026-11-27
updated: 2026-11-27
agent: CLD
origin: mixed
confidence: high
related:
  - "[[Decisions]]"
  - "[[Private Machine Guard]]"
  - "[[Decision - Brains without a Player Key]]"
  - "[[Decision - Model Relay]]"
  - "[[Key Handling]]"
  - "[[Fast Brain - Jev]]"
  - "[[Environment Variables]]"
  - "[[Open Questions]]"
paths:
  - CLAUDE.md
  - agents/main.mjs
  - relay/cmd/relay/main.go
  - docker-compose.yml
  - .env.example
decided: 2026-11-26
---

# Decision - No Owner Keys on a Public Server

Production runs the rule brain for free and language models only on each player's own key. A key of the owner's is used only on a machine explicitly marked as the owner's own.

## The decision as written

> **A public server holds none of the owner's keys** (owner, 2026-11-26: "Production must not hold any key of mine. Only users' keys if they want"): production runs the rule brain for free and language models only on each player's own key. A Claude key, Claude token or Jev key of the owner's is used only where `CALLSIGN_PRIVATE=1` marks the owner's own machine; anywhere else the agents host and the relay refuse it. So Jev on the game's key is for the owner's machine only until credits are sold.

| | |
|---|---|
| Date | 2026-11-26 |
| Decided by | the owner |
| Replaced | the wider reading of [[Decision - Brains without a Player Key]], under which the game's own Jev key could run anywhere |

## Why

A Claude key or token set on a public server would be spent by every visitor's squads, with no per-player limit. The guard makes a key set by mistake harmless.

## How the code stands

- **Agents host** (`agents/main.mjs`, `makeBrain`): with a server-side Claude key or token set but `CALLSIGN_PRIVATE` not `1`, it logs that the key is not used and plays the rule brain.
- **Relay** (`relay/cmd/relay/main.go`): the Jev key from `CALLSIGN_JEV_KEY` is dropped unless `CALLSIGN_PRIVATE=1`; the fast brain is then off.
- **Players' own keys** are unaffected: they go through the relay as before ([[Key Handling]]).
- A public server still needs `CALLSIGN_RELAY_MASTER_KEY`, which is not an AI key: it encrypts the players' stored keys.

The agents-host path has a unit test (`agents/test/units.test.mjs`). The relay path has no test of its own.

## What it leaves open

Selling AI credits would bring a server-side key back, metered per player; see [[Open Questions]].
