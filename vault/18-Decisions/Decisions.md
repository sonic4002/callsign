---
title: Decisions
description: "CLAUDE.md holds the project's locked decisions: the things an agent or a contributor must ask the owner before changing."
type: hub
status: current
tags:
  - type/hub
  - status/current
  - agent/CLD
  - origin/docs
  - area/decisions
  - topic/decision
created: 2026-11-26
updated: 2026-11-27
agent: CLD
origin: docs
confidence: medium
related:
  - "[[Decision - Go Game Server]]"
  - "[[Decision - Model Relay]]"
  - "[[Decision - Client Stack]]"
  - "[[Decision - Command Sidebar]]"
  - "[[Decision - Direct Build and Buy]]"
  - "[[Decision - Brains without a Player Key]]"
  - "[[Decision - Agents and Tools]]"
  - "[[Decision - Fireteams]]"
  - "[[Decision - Open League]]"
  - "[[Decision - Economy]]"
paths:
  - CLAUDE.md
  - docs/PLAN.html
  - docs/specs/2026-11-24-bases-harvest-maps.md
  - docs/research/2026-11-24-jev-decision-model.md
  - docs/research/2026-11-24-classic-rts-play.md
---

# Decisions

`CLAUDE.md` holds the project's locked decisions: the things an agent or a contributor must ask the owner before changing. This hub has one note per locked decision, each with the decision as written, its date, the owner's reason where one is recorded, what it replaced, and how the code stands against it today.

## Locked decisions

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

## Undecided

- [[Open Questions]]: what the documents and commits leave open.

## How decisions are changed

`CLAUDE.md`: "Ask before changing a locked decision above." Two were changed by the owner on 2026-11-24, and both changes are recorded in the file with the owner's words: direct build and buy ("no need to wait for anvil to approve it, its a waste of time") and the rule brain as the default with Jev on the game's own key.

Where the code and a locked decision differ, the difference is listed in [[Plan versus Code]]; the decision text in `CLAUDE.md` has not been edited to match in those cases.

## Other design choices recorded outside `CLAUDE.md`

| Choice | Where |
|---|---|
| Keep the radio as the way to act; no drag-selection, control groups or click-to-move | `docs/research/2026-11-24-classic-rts-play.md` ("Do not do"); since loosened by tap-to-order, see [[Decision - Command Sidebar]] |
| No uncapped unit counts with one agent each | the same document |
| The owner's keys are used only on a machine marked private | commit `342712f`, [[Private Machine Guard]] |
| A bridge is destroyed only on Hammer's order: tried and reverted | commits `8e72697`, `dc4e4a8` and their reverts; [[Terrain, Cover and Bridges]] |

## Related

- [[Reference Map]]
- [[Open Questions]]
- [[Plan versus Code]]
- [[Project Log]]
- [[The Idea]]
