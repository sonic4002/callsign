---
title: History
description: "The whole project is four days old on the date of this vault: 319 commits from the evening of 2026-11-23 to the evening of 2026-11-26, read with git log."
type: hub
status: current
tags:
  - type/hub
  - status/current
  - agent/CLD
  - origin/docs
  - area/history
  - topic/history
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: docs
confidence: medium
related:
  - "[[Project Log]]"
  - "[[Decisions]]"
  - "[[Reference Map]]"
  - "[[Staging and Releasing]]"
  - "[[Plan versus Code]]"
paths:
  - CLAUDE.md
  - KICKOFF.md
  - docs/PLAN.html
---

# History

The whole project is four days old on the date of this vault: 319 commits from the evening of 2026-11-23 to the evening of 2026-11-26, read with `git log`. This hub gives the shape of those days and points to the dated log.

## Notes

- [[Project Log]]: a dated log of how the project developed, with commit ids.

## The shape of it

| Day | Commits | What happened |
|---|---|---|
| 2026-11-23 (evening) | 13 | The plan, the locked decisions and the kickoff prompt; Phase 0 built in about an hour: rules, deterministic simulation, radio net, rooms and WebSocket, the agent loop, `make play`, the debug page, first balance |
| 2026-11-24 | 278 | Almost everything else: isometric page and art pipeline, fog, voice in and out, rooms and seats, the relay, phone layout, playing in public, the first lesson, the whole base-building game in three waves (structures, harvesting, maps; placement, queues, heroes; power, radar, tech buildings), direct build and buy, the rule brain and the fast brain, server-side listening, bodies and collision, three bigger maps and rebalancing |
| 2026-11-25 | 7 | The net is made quieter: kinds, two nets, traffic levels, one squad reporting what several meet |
| 2026-11-26 | 21 | The private-machine guard, the streaming Hebrew recogniser in the browser, tap-to-order, strike aircraft, selection by name plate and letting go of a selection |

## How the work was done

- Work was cut along seams for parallel agents, each in its own git worktree and branch, merged back into `main` or the staging branch `next` (42 merge commits). The bases spec says so directly: "The work is cut for parallel agents along these seams, each owning its files."
- Commit subjects are plain sentences saying what changed for the player ("A squad sent by tapping the map obeys at once").
- Several changes are labelled "From a played match": things found by playing and fixed (`075c6e0`, `b22db48`, `402d7a0`).
- Decisions the owner changed are written into `CLAUDE.md` with the owner's words and the date ([[Decisions]]).

## Documents by date

| Date | Document |
|---|---|
| 2026-11-23 | `CLAUDE.md`, `KICKOFF.md`, `docs/PLAN.html` (design plan v0.6) |
| 2026-11-24 | `docs/FRIEND-MATCH.md`; `docs/specs/2026-11-24-bases-harvest-maps.md` and its three addenda; `docs/research/2026-11-24-classic-rts-play.md`; `docs/research/2026-11-24-jev-decision-model.md`; `docs/art/STYLE.md`; the NOTICE and CREDITS files |
| 2026-11-24 to 26 | `stt/eval/RESULTS.md` (listening measurements, extended on the 26th) |
| 2026-11-26 | this vault |

## Related

- [[Reference Map]]
- [[Project Log]]
- [[Decisions]]
- [[Staging and Releasing]]
- [[Plan versus Code]]
