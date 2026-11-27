---
title: Decision - Fireteams
description: "Fireteams are run by plain utility AI on the server with no language model, and carry one 'nerve' value with three states that is shown through behaviour only."
type: decision
status: current
tags:
  - type/decision
  - status/current
  - agent/CLD
  - origin/mixed
  - area/decisions
  - topic/fireteams
  - topic/nerve
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Fireteams and Nerve]]"
  - "[[Settings]]"
  - "[[Known Flaws]]"
  - "[[Plan versus Code]]"
  - "[[Decisions]]"
  - "[[Sim Loop and Determinism]]"
  - "[[Decision - Go Game Server]]"
paths:
  - CLAUDE.md
  - docs/PLAN.html
  - server/sim/ai.go
  - shared/rules.json
---

# Decision - Fireteams

Fireteams are run by plain utility AI on the server with no language model, and carry one "nerve" value with three states that is shown through behaviour only. There is no fatigue.

## The decision as written

> **Fireteams:** plain utility AI on the server, no LLM. One "nerve" value (steady / shaken / pinned) shown through behavior only. No fatigue.

| | |
|---|---|
| Date | 2026-11-23 (`e21e0cb`); built in the first simulation commit (`7249ffe`) |
| Decided by | the plan (`docs/PLAN.html`, sections Bravo and Charlie) |
| Replaced | in the plan itself: fatigue ("a hidden bar to manage, too slow for a 10-minute match") and a separate morale stat (merged into nerve) were dropped on purpose |

## The reason recorded

From the plan: only the middle two layers of the chain of command use language models, "which keeps cost and latency sane even with hundreds of units on the map"; fireteams score their options every tick from local conditions and act at once, "free and instant". Nerve was to be tested in Phase 0: "If players can't read it at a glance, it goes too."

## How the code stands

Matches. `decide` in `server/sim/ai.go` scores fire, advance, cover and fall back; stress thresholds are 0.35 (shaken) and 0.70 (pinned). Details and numbers: [[Fireteams and Nerve]].

Two small points:

- "Shown through behavior only": the page has a "Show nerve (debug)" setting that displays it, a leftover of the debug page ([[Settings]], [[Known Flaws]]).
- The plan's other fireteam inputs (ammo, weather, personality) are not in the code ([[Plan versus Code]]).

## Related

- [[Decisions]]
- [[Fireteams and Nerve]]
- [[Sim Loop and Determinism]]
- [[Decision - Go Game Server]]
