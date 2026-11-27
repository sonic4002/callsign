---
title: Decision - Agents and Tools
description: "The operator (Anvil) and the squad leaders are agents that act only through game tools, and CLAUDE.md says they run as Web Workers in the player's browser."
type: decision
status: current
tags:
  - type/decision
  - status/current
  - agent/CLD
  - origin/mixed
  - area/decisions
  - topic/agents
  - topic/tools
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Where Agents Run]]"
  - "[[Agent Tools]]"
  - "[[Decision - Direct Build and Buy]]"
  - "[[Server Flags]]"
  - "[[Playing in Public]]"
  - "[[Locked Decisions]]"
  - "[[AI Brains and Model Relay]]"
  - "[[Operator - Anvil]]"
  - "[[Squad Leaders]]"
  - "[[Plan versus Code]]"
paths:
  - CLAUDE.md
  - docs/PLAN.html
  - agents/main.mjs
  - agents/tools.mjs
  - client/brains/host.js
  - server/room/tools.go
---

# Decision - Agents and Tools

The operator (Anvil) and the squad leaders are agents that act only through game tools, and `CLAUDE.md` says they run as Web Workers in the player's browser. In the code they act only through tools, but they run on the server machine by default and in the browser only in some cases, and the tool list is much longer than the six named.

## The decision as written

> **Agents:** operator (callsign Anvil) and squad leaders run as Web Workers in the player's browser. They act only through game tools: `radio`, `move`, `hold`, `attack`, `report`, `buy` (operator only).

| | |
|---|---|
| Date | 2026-11-23 (`e21e0cb`) |
| Decided by | the plan (`docs/PLAN.html`, sections Hotel, India and Papa: no install, no hosting cost, works on phones) |
| Replaced | nothing. `KICKOFF.md` allowed "a Node script for now, not the browser yet" for Phase 0 |

## How the code stands

| Part | Code now |
|---|---|
| Act only through tools | yes. The server checks every tool call against the caller's role (`allowed` in `server/room/tools.go`), so a modified browser cannot add gold or units |
| Where they run | by default a Node process on the server machine (`agents/main.mjs`, the `agents` compose service). The player's browser takes a side over, as Web Workers, when the player has stored a key, in a fast-brain match, in the first lesson, or when the player chooses to run them there. One host runs a side at a time and the browser outranks the server machine ([[Where Agents Run]]) |
| The tool list | operator: radio, report, buy, command, build, haul, cancel, rally, sell, repair. Squad leaders: radio, report, move, hold, attack, capture, repair, fortify, plant, seize, by unit kind ([[Agent Tools]]) |
| The commander | also acts without any agent: build, buy and plain orders by hand ([[Decision - Direct Build and Buy]]) |

The same agent modules run in both places: the server serves an allow list of them to the browser at `/agents/` ([[Server Flags]]).

## Why it differs

The Node host is the Phase 0 arrangement that stayed: it lets a match run with no browser-side brain at all, which the rule brain and the scripted tests need. No document records a decision to keep or remove it. It is the reason a public server lets only the host make matches ([[Playing in Public]]).

## Related

- [[Locked Decisions]]
- [[AI Brains and Model Relay]]
- [[Agent Tools]]
- [[Where Agents Run]]
- [[Operator - Anvil]]
- [[Squad Leaders]]
- [[Plan versus Code]]
