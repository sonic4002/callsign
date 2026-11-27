---
title: Agent Handoff
description: "Read first when working in the vault as an agent: where to start, which notes to load for each area, and the ground rules."
type: meta
status: current
tags:
  - type/meta
  - status/current
  - agent/CLD
  - origin/mixed
  - area/meta
  - topic/vault
created: 2026-11-27
updated: 2026-11-27
agent: CLD
origin: mixed
confidence: high
related:
  - "[[Conventions]]"
  - "[[Index]]"
  - "[[Home]]"
  - "[[Reference Map]]"
  - "[[Decisions]]"
  - "[[Known Flaws]]"
  - "[[Open Questions]]"
  - "[[Plan versus Code]]"
paths:
  - CLAUDE.md
  - vault/CLAUDE.md
---

# Agent Handoff

Read this first. It tells an agent how to use the vault without loading all of it.

## Where to start

1. [[Index]]: one line per note with its type and description. Open only the notes the task needs.
2. [[Home]] for the overview notes, [[Reference Map]] for the focused ones.
3. [[Conventions]] before creating or restructuring a note.

## Which notes to load

| Working on | Load |
|---|---|
| Units, structures, numbers, balance | [[Game Design]], then [[Units - Aegis]], [[Units - Ashfall]], [[Structures and Build Tree]], [[Balance]] |
| The radio net, what the player hears | [[Radio Net]], [[Traffic Levels]], [[Command Net and Squad Net]], [[Radio versus Direct Acts]] |
| Agents, brains, keys | [[Brains and Agents]], [[Agent Tools]], [[Rule Brain]], [[Model Relay]], [[Private Machine Guard]] |
| The page | [[Client]], [[Selection and Map Orders]], [[Build Bar]], [[Mobile Layout]] |
| Voice in or out | [[Speech]], [[In-Browser Recognition]], [[Pronunciation Table]] |
| The server | [[Server Architecture]], [[WebSocket Frames]], [[Direct Acts]], [[Tests and Headless Matches]] |
| Running and releasing | [[Operations]], [[Make Targets]], [[Environment Variables]], [[Staging and Releasing]] |
| Art | [[Art and Assets]], [[Art Pipeline]], [[Licences and Credits]] |
| Changing a rule of the project | [[Decisions]] and the decision's own note; ask the owner before changing a locked decision |
| What is broken or undecided | [[Known Flaws]], [[Backlog]], [[Open Questions]], [[Plan versus Code]] |

## Ground rules

- The repository's `CLAUDE.md` holds the locked decisions and wins over the vault. If the vault differs, fix the vault.
- The code wins over every document. A note's `paths` say what to re-read to check it.
- `confidence: medium` means written from the code or documents but not re-checked by running anything. Raise it to `high` only after checking.
- No secrets and no people in the vault ([[Conventions]]). Environment variables are named, never quoted.
- The live game is served from the repository's main checkout: changing the vault never needs a restart, and nothing here is a reason to restart anything.
- When work changes how the game behaves, update the focused note, bump its `updated`, and regenerate the [[Index]] if its description changed.
