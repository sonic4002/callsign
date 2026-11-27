---
title: Decision - Economy
description: "There is one resource, gold, and since 2026-11-24 it is harvested: haulers collect it from fields fed by gushers and unload at a refinery, while the headquarters keeps a small trickle and the sea ..."
type: decision
status: current
tags:
  - type/decision
  - status/current
  - agent/CLD
  - origin/mixed
  - area/decisions
  - topic/economy
  - topic/gold
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Economy]]"
  - "[[Structures and Build Tree]]"
  - "[[Superpowers]]"
  - "[[Decisions]]"
  - "[[Plan versus Code]]"
paths:
  - CLAUDE.md
  - docs/PLAN.html
  - docs/specs/2026-11-24-bases-harvest-maps.md
  - docs/research/2026-11-24-classic-rts-play.md
  - server/sim/haul.go
  - shared/rules.json
---

# Decision - Economy

There is one resource, gold, and since 2026-11-24 it is harvested: haulers collect it from fields fed by gushers and unload at a refinery, while the headquarters keeps a small trickle and the sea rig stays a capturable source. Structures unlock units, and superpowers are to unlock through the build tree plus gold, never by the clock.

## The decision as written

> **Economy** (changed 2026-11-24): one resource, gold. Haulers collect it from fields fed by gushers and unload at a refinery; the HQ keeps a small trickle and the sea rig stays a capturable source. Structures unlock units (the build tree). Superpowers unlock through the build tree plus gold, never by the clock. Spec: `docs/specs/2026-11-24-bases-harvest-maps.md`.

| | |
|---|---|
| Date | changed 2026-11-24 (commit `7aa067e`, the spec) |
| Decided by | the owner, through the spec; the owner's own words are not quoted in `CLAUDE.md` for this one |
| Replaced | the original line (2026-11-23): "Oil rigs on land and sea pump gold automatically; HQ well can't be captured." |

## What it replaced

In `docs/PLAN.html` the economy was "pure map control": HQ well +10 gold a second, land rig +15, sea rig +30, a damaged rig at half income, and "nothing to harvest or haul". `KICKOFF.md` asked for exactly that in Phase 0, and the first rules file had it (`e837549`).

## The reason recorded

The spec says it was "written 2026-11-24 from the owner's request"; the request itself is not quoted. Its problem statement: "A match today is squads on an almost empty map. There is nothing to build, so there is no base to defend or to break, and every unit is available from the first second. Gold arrives on its own from rigs, so there is no economy to protect or to raid." Its answer for gold: "haulers drive out, load, and bring it back to a refinery. Haulers can be escorted, ambushed and replaced."

The research note `docs/research/2026-11-24-classic-rts-play.md` followed the same day and fed the third addendum. Both documents state the line kept: the genre's mechanics are used, and no existing game's names, art, sounds or layouts are copied.

## What was built

| Piece | Commit |
|---|---|
| Structures and the build tree, bases, defences, fences, capture, engineers | `67ced19` |
| Gold is harvested: gushers, fields and haulers | `f781619` |
| The match opens with the headquarters alone; a finished refinery brings a hauler; more haulers need the works | `7e3823d` (spec addendum 2) |
| Power, the radar, production queues, rally, sell and repair, ranks, tech buildings, base cues, crushing, defence ranges | spec addendum 3; `327ba88`, `aa5dab8`, `a9bb5cf`, `ccf7757`, `f02c8cb` |

## How the code stands

Matches for gold: [[Economy]], [[Structures and Build Tree]]. The headquarters trickle is 10 a second and the sea rig 30, the same numbers as the plan's HQ well and sea rig; land rigs now pay nothing and are where gold fields lie. The rule kinds are still called `landRig` and `seaRig`.

Superpowers are not built at all, so that sentence is a rule for the future: [[Superpowers]].

## Related

- [[Decisions]]
- [[Economy]]
- [[Structures and Build Tree]]
- [[Superpowers]]
- [[Plan versus Code]]
