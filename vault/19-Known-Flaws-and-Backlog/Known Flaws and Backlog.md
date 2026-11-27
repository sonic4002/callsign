---
title: Known Flaws and Backlog
description: "This area gathers what is known to be wrong, limited, unfinished or out of step: from code comments, documents, test skips, commit messages and from reading the code while writing this vault."
type: hub
status: current
tags:
  - type/hub
  - status/current
  - agent/CLD
  - origin/mixed
  - area/known-flaws-and-backlog
  - topic/flaws
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Known Flaws]]"
  - "[[Backlog]]"
  - "[[Plan versus Code]]"
  - "[[Tests and Headless Matches]]"
  - "[[Playing on a LAN]]"
  - "[[Recognition Evaluation]]"
  - "[[Licences and Credits]]"
  - "[[Balance]]"
  - "[[Reference Map]]"
  - "[[Open Questions]]"
paths:
  - docs/FRIEND-MATCH.md
  - docs/PLAN.html
  - docs/specs/2026-11-24-bases-harvest-maps.md
  - docs/research/2026-11-24-classic-rts-play.md
  - docs/research/2026-11-24-jev-decision-model.md
  - stt/eval/RESULTS.md
  - CLAUDE.md
---

# Known Flaws and Backlog

This area gathers what is known to be wrong, limited, unfinished or out of step: from code comments, documents, test skips, commit messages and from reading the code while writing this vault. Nothing here was found by running the game; items that were read from code but not confirmed by a test say so.

## Notes

- [[Known Flaws]]: defects, limits and stale text, by area, each with its source.
- [[Backlog]]: what is planned or suggested and not built.
- [[Plan versus Code]]: where `docs/PLAN.html`, `CLAUDE.md` and `KICKOFF.md` describe something other than what exists.

## How this was gathered

| Source | What it gave |
|---|---|
| Code markers | there are no `TODO`, `FIXME`, `XXX` or `HACK` markers in the Go, JavaScript or Python sources; flaws are recorded in ordinary comments and documents instead |
| Test skips | three situation-dependent skips in the simulation tests, plus the opt-in probes ([[Tests and Headless Matches]]) |
| Documents | `docs/FRIEND-MATCH.md` ("Not protected"), `stt/eval/RESULTS.md`, the NOTICE files, the "out of scope" and "do next" lists of the spec and the research notes |
| Commit messages | things fixed "from a played match", reverts, and statements such as "balance is not settled in this commit" |
| Reading the code | stale comments, dead code, duplicated rules, a few likely bugs |

## The short list

The items most likely to matter to someone picking the project up:

1. The locked decisions in `CLAUDE.md` no longer describe the client, where agents run, or how squads are ordered ([[Plan versus Code]]).
2. A LAN match is plain HTTP: tokens, radio and a typed AI key can be read on the network ([[Playing on a LAN]]).
3. Nothing persists: no accounts, no saved matches, no ladder ([[Backlog]]).
4. Speech recognition is measured on synthetic voices only, and never on a real phone ([[Recognition Evaluation]]).
5. Several licences must be read, and a credits screen built, before a public release ([[Licences and Credits]]).
6. Only scripted balance is measured ([[Balance]]).

## Related

- [[Reference Map]]
- [[Known Flaws]]
- [[Backlog]]
- [[Plan versus Code]]
- [[Open Questions]]
- [[Decisions]]
