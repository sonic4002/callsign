---
title: Backlog
description: "What the documents plan or suggest and the code does not have."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/mixed
  - area/known-flaws-and-backlog
  - topic/flaws
  - topic/backlog
  - topic/roadmap
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Decision - Open League]]"
  - "[[Superpowers]]"
  - "[[Decision - Client Stack]]"
  - "[[Known Flaws]]"
  - "[[Decision - Command Sidebar]]"
  - "[[Known Flaws and Backlog]]"
  - "[[Plan versus Code]]"
  - "[[Open Questions]]"
  - "[[Decisions]]"
  - "[[Project Log]]"
paths:
  - docs/PLAN.html
  - docs/specs/2026-11-24-bases-harvest-maps.md
  - docs/research/2026-11-24-classic-rts-play.md
  - docs/research/2026-11-24-jev-decision-model.md
  - stt/eval/RESULTS.md
  - tts/NOTICE.md
  - CLAUDE.md
---

# Backlog

What the documents plan or suggest and the code does not have. Nothing here is a commitment: the items are copied from the plan's roadmap, the spec's "out of scope" list, the research notes' "do next" lists and the evaluation notes, with the source of each.

## The plan's roadmap against the code

`docs/PLAN.html`, section Kilo:

| Phase | Plan | State |
|---|---|---|
| 0 | Server simulation, text orders, one operator, utility-AI fireteams with nerve, rigs | done (2026-11-23) |
| 1 | Playable client on a phone, one map, two factions, gold economy, brain tiers, Claude only, both languages, first art | done in substance, though not as a Phaser client, and with three maps |
| 2 | Browser agent runtime, model relay with tier control, OpenRouter sign-in plus Claude, Gemini and OpenAI keys, voice in and out in both languages, radio phrase library | mostly done: no one-click OpenRouter sign-in; voices come from a local speech service, not a pre-recorded phrase library |
| 3 | Matchmaking, ranked and casual ladders, the MCP open league, replays with agent reasoning, two more maps | not built, except the maps |
| 4 | More factions, superpowers, naval maps, sound and voice packs, tournaments | not built |

## Online

| Item | Source |
|---|---|
| Accounts, matchmaking, ladders | plan, Phase 3; spec, out of scope |
| The open league over MCP | [[Decision - Open League]] |
| Replays, with the agents' reasoning shown; a one-tap clip | plan, sections Kilo and Oscar |
| Persistent data (the plan names Postgres and Redis) | plan, section India |
| Showing the expected AI cost of a match before it starts | plan, section Papa |
| Two relays behind a load balancer | plan, section Lima |

## Game

| Item | Source |
|---|---|
| Superpowers and a lab-role structure as a third tier | [[Superpowers]]; research note, "Do next" |
| More than two factions; commander levels | plan; spec, out of scope |
| Veterans with memory across matches | plan, section Oscar |
| A rich field kind worth double that does not refill, in contested ground | research note, "Do next" |
| Walls that own units path around, with deliberate gaps | the same |
| A cheap, fast scout with no leader agent, attached to the commander | the same |
| A counter that empties a garrison without destroying the building | the same |
| A second mode for one unit per faction, entered by a "deploy" order | the same |
| Sub-faction choice (one unique unit or perk) in the lobby | the same |
| Line-of-sight blocking by buildings or mountains, height, destructible groves and rocks | spec, out of scope |
| A map editor and random map generation | spec, out of scope |
| A plan for sorties for the scripted enemy | commit `315ee23` |
| Playing without an operator; a match with no timer | plan, room options |
| Weather, ammo, fireteam personality | plan, section Charlie |
| Radio silence and jamming as mechanics; squad nets one can listen to per squad; an enemy net | plan, section Quebec |

## Brains

| Item | Source |
|---|---|
| A larger test of the fast brain on recorded orders in both languages, to set the threshold | Jev research note, section 5 |
| Jev as the first step of every tier, with the language model only for what Jev is unsure of ("a second step and was not tested") | the same |
| Cross-vendor win rates per tier | `shared/models.json`; plan, section Lima |
| One-click OpenRouter sign-in | plan |
| A desktop app for local models | plan ("optional later") |

## Client

| Item | Source |
|---|---|
| The Phaser / TypeScript port, if still wanted | [[Decision - Client Stack]] |
| Sidebar tabs in four groups; ghost polish; a production progress line under each structure on the map | research note, "Do next" |
| A credits screen | `assets/audio/CREDITS.md` |
| Browser-driven tests of the page and the phone layout | [[Known Flaws]] |

## Speech

| Item | Source |
|---|---|
| Recordings of real players, and measurement on real phones | `stt/eval/RESULTS.md` |
| Recording levels, a voice detector in front of the Hebrew recogniser, larger Hebrew models: not tried | the same |
| The browser's built-in recognition (Web Speech API): researched, not wired in | the same |
| Pre-recorded radio phrases served as files, in place of the live speech service | plan; `tts/NOTICE.md` |
| Native-speaker review of the Hebrew procedure and voices | plan, sections Mike and November |

## Art and sound

| Item | Source |
|---|---|
| Generated sound effects, per-faction voice lines and sound sets | plan, section November |
| Terrain tile sets per biome | the same |

## Explicitly not to be done

From the research note's "Do not do": drag-selection, control groups or click-to-move (since loosened by tap-to-order, see [[Decision - Command Sidebar]]); uncapped unit counts with one agent each; build-then-place; permanent shroud in place of fog; losing the headquarters as a mere setback; any names, designs, sounds or art of an existing game.

## Related

- [[Known Flaws and Backlog]]
- [[Known Flaws]]
- [[Plan versus Code]]
- [[Open Questions]]
- [[Decisions]]
- [[Project Log]]
