---
title: Decision - Rules Data
description: "Unit stats, costs, the build tree and the tiers live in one shared JSON file, shared/rules.json, which the server and the client both read."
type: decision
status: current
tags:
  - type/decision
  - status/current
  - agent/CLD
  - origin/mixed
  - area/decisions
  - topic/rules
  - topic/data
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Prompts]]"
  - "[[Rule Brain]]"
  - "[[Model Relay]]"
  - "[[Known Flaws]]"
  - "[[Decisions]]"
  - "[[Decision - Go Game Server]]"
  - "[[Game Design]]"
  - "[[Units - Aegis]]"
  - "[[Units - Ashfall]]"
  - "[[Structures and Build Tree]]"
paths:
  - CLAUDE.md
  - shared/rules.json
  - shared/rules.go
  - shared/structures.go
  - shared/models.json
  - shared/models.go
  - server/cmd/callsign/main.go
---

# Decision - Rules Data

Unit stats, costs, the build tree and the tiers live in one shared JSON file, `shared/rules.json`, which the server and the client both read. It is how the Go server and the JavaScript page stay in step without sharing code.

## The decision as written

> **Rules data:** unit stats, costs, build tree, tiers live in one shared JSON file (`shared/rules.json`) read by server and client.

| | |
|---|---|
| Date | 2026-11-23 (`e21e0cb`; the file itself in `e837549`) |
| Decided by | the plan (`docs/PLAN.html`, section India): Go for the server and a browser client cannot share code, so "unit stats, costs and the build tree live in one JSON file both sides read, so the rules never drift apart" |
| Replaced | nothing |

## How the code stands

Matches, and the file holds far more than the decision lists.

| Top-level key | Holds |
|---|---|
| `version`, `tickRate` | 1, and 10 ticks a second |
| `match` | lengths, starting gold, caps, capture and hold radii, base and placement limits, power, sell and repair shares, the opening, sandbags, crushing, body sizes |
| `hq`, `nerve` | headquarters health and sight; the nerve numbers |
| `terrainKinds`, `landmarkKinds`, `bridgeRules` | terrain, cover and bridges |
| `ranks`, `tiers` | earned ranks; brain tiers |
| `maps` | the three maps, written by `tools/mapgen.py` |
| `rigs` | point kinds: who captures them and what they pay |
| `callsigns` | the callsigns in both languages |
| `techBuildings` | the three tech building kinds |
| `factions` | units and structures of both factions |
| `radio` | procedure words, command phrases, traffic levels, base cues, the rule brain's phrase table, spelled-out point names |

How it is read:

- **Server:** embedded in the binary (`//go:embed rules.json` in `shared/rules.go`), parsed and checked at start (`Load`, `check`); a room plays on a copy set to its map (`ForMap`).
- **Page:** fetched from `/shared/rules.json`; the server adds a `map` key holding the map being played (`JSONFor`), so the page never looks a map up by id.
- **Agents:** read the same rules for names, phrases and unit facts ([[Prompts]], [[Rule Brain]]).
- **Tools:** `tools/mapgen.py` rewrites the `maps` block.

A second shared file, `shared/models.json`, holds the tier-to-model table for the relay ([[Model Relay]]).

## One thing the rules do not cover

Placement rules are implemented twice, in `server/sim/placement.go` and in `client/placement.js` for the ghost, and are held together by a shared test table (`client/testdata/placement-small.json`), not by the rules file ([[Known Flaws]]).

## Related

- [[Decisions]]
- [[Decision - Go Game Server]]
- [[Game Design]]
- [[Units - Aegis]]
- [[Units - Ashfall]]
- [[Structures and Build Tree]]
- [[Maps]]
