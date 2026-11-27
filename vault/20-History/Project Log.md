---
title: Project Log
description: "A dated log of how Callsign developed, written from git log (319 commits, 2026-11-23 to 2026-11-26)."
type: log
status: current
tags:
  - type/log
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
  - "[[History]]"
  - "[[Decisions]]"
  - "[[Balance]]"
  - "[[Staging and Releasing]]"
  - "[[Plan versus Code]]"
  - "[[The Idea]]"
paths:
  - CLAUDE.md
  - KICKOFF.md
  - docs/specs/2026-11-24-bases-harvest-maps.md
  - docs/research/2026-11-24-jev-decision-model.md
---

# Project Log

A dated log of how Callsign developed, written from `git log` (319 commits, 2026-11-23 to 2026-11-26). Times are the commits' own local times; each entry names the commits it summarises so it can be checked with `git show <id>`.

## 2026-11-23: Phase 0 in an evening

| Time | What | Commits |
|---|---|---|
| 22:59 | Project instructions, the kickoff prompt and the design plan | `e21e0cb` |
| 23:08 | Dev image; shared rules (factions, units, rigs, tiers, points, radio words); deterministic simulation with fireteam utility AI and a scripted player | `266d7dd`, `e837549`, `7249ffe` |
| 23:14 | The radio net (callsign routing, procedure words, place names in both languages); match room, tools with role checks, WebSocket server | `a5d3017`, `2291703` |
| 23:23 | The agent loop for the operator and squad leaders, with Claude and scripted brains; a `-speed` flag | `0243c5e`, `5179069` |
| 23:28 | `make play`; the debug page: map dots, radio log, a box to transmit as Hammer, in both languages | `c6d7b96`, `642fef1` |
| 23:50 | First balance of Aegis and Ashfall for scripted matches | `d431fdb` |

## 2026-11-24, night and morning: a game to look at and talk to

| Time | What | Commits |
|---|---|---|
| 00:22 to 00:39 | Music; the page restyled as an isometric RTS screen with a command sidebar; the local sprite pipeline and the first isometric sprites. `CLAUDE.md` changes the art from top-down to isometric | `aa1428a`, `6dcfb63`, `4a9ede0` |
| 07:21 to 07:48 | The key is checked at start; the subscription brain as a test rig; fog of war; Blender-rendered units; push-to-talk in Hebrew and English in the browser | `9b6a294`, `cdccbbb`, `c6f062c`, `20f4b20`, `3d82b69` |
| 08:44 to 09:38 | Radio strictness levels and a help window; spoken radio through a local speech service; enemy squads named Target N; a deployment queue; battle effects and synthesised sounds; the net speaks the language Hammer last used | `350e1c0`, `fea5b21`, `4363fac`, `88bddaf`, `1a35e7c`, `e1f3f79` |
| 10:11 to 10:53 | Match end sign-off and the headquarters finale; agent hosts and the handshake; rooms, join codes and seats; browser agents as Workers; the model relay (providers, key store, limits) and its wiring; easy and normal enemy levels; phone layout, touch gestures, installable web app; the lobby and `make play-lan`; two more units per faction | `a30a648`, `7444c92`, `94f65b0`, `98a54c9`, `be0b2fa`, `b166395`, `52e5f6d`, `6b9044f`, `4605bb9`, `2bc06de`, `b8f7e67`, `bcd03ca`, `6bc9611`, `3747e45` |
| 11:17 to 12:15 | Playing in public over https: a tunnel, then a home address with a certificate; a host password | `5569f7d`, `ca32b3d`, `562cc4a`, `fa24fc3` |

## 2026-11-24, afternoon: the base-building game

| Time | What | Commits |
|---|---|---|
| 13:07 to 13:25 | The first lesson; Anvil acts on orders only until handed the fight; match speed per room; relaxed radio sends typed calls as written. **The spec for bases, harvested gold and three maps is written** | `17c0d6e`, `fc00500`, `9b1919d`, `57a8768`, `99e245c`, `7aa067e` |
| 13:30 to 14:14 | Spec addendum 1. First wave: structures and the build tree; Anvil's purse; maps, terrain, bridges, cover and places; harvested gold with gushers, fields and haulers; art for all of it | `c8bbed3`, `67ced19`, `b34261d`, `7236a6b`, `f781619`, `ebdf733` |
| 14:36 to 14:57 | Addendum 2: the match opens with the headquarters alone. Research on the classic base-building RTS; addendum 3. Rebalance after the new opening (100:100 over 200 games) | `e28a2f2`, `7e3823d`, `9467023`, `5f5a308`, `63c303e` |
| 15:02 to 16:36 | Agents report their model, context size and state; the net stops announcing costs; orders picked on the map are transmitted at once; the start screen and offline cache; bigger maps get more time and pace, and the timer gets tie-breaks; the net says names in its own language | `34ac123`, `4aed926`, `0959327`, `b39488c`, `effe887`, `04068d4` |
| 16:43 to 18:02 | Third wave: tech buildings; power, radar, selling and repairing; placement, production lines and rally points; base cues; heroes, sandbags, crushing and earned ranks; merged into the staging game as W2-A, W2-B and W2-C. Hero numbers tuned on 200 games | `a9bb5cf`, `327ba88`, `aa5dab8`, `ccf7757`, `f02c8cb`, `83032ee`, `77a91cb`, `aa8cad5`, `52b255d` |
| 18:05 to 18:52 | One menu for squads and structures; a sidebar that fits a small screen; the lesson and Help follow the new game; Anvil's prompt rewritten as one set; settings behind a gear; agents' lamps in the header; a compass; walls and fences can be turned while placed | `0b69174`, `d607a8e`, `def89ab`, `1dd366c`, `0a9c0e9`, `0d2acb6`, `95b16cb`, `bd1db29`, `6f52f1e` |

## 2026-11-24, evening: brains, listening, bodies, bigger maps

| Time | What | Commits |
|---|---|---|
| 18:57 to 19:11 | **The owner's decision: building and buying act at once.** The build panel becomes a bar under the map; units are locked until their structure stands. A listening service (Whisper on the GPU). Research on the Jev decision model. An art style sheet and a painter for the unit sheets. **The owner's decision: the rule brain is the default and Jev runs on the game's own key.** Two bridge-protection rules committed and reverted | `5f6c920`, `cfcd2a8`, `9a9e5b5`, `5317c8b`, `3f0204e`, `e72765f`, `a8b3e75`, `2585634`, `8e72697`, `dc4e4a8`, `fb7788d`, `a7521f8` |
| 19:14 to 19:54 | Shots and rockets seen in flight; units painted; hints as radio traffic and a test set for listening; **the rule brain** (grammar, fixed phrases, three levels); **Jev in the relay** and **the fast brain**; 150 orders in both languages as tests; the level-3 operator tuned | `1d0cdb1`, `321c6f7`, `c32c4fc`, `568ef99`, `d8f07d5`, `46fd49f`, `2cc0a92`, `6c6247d`, `54cf1f9`, `24865cf` |
| 20:00 to 20:49 | Fixes from played matches; every unit painted; the listening service at 8-bit weights; **bodies take room**; fights staged on a fixed drill ground; `make cost` | `075c6e0`, `b22db48`, `7739d00`, `75fc93f`, `148a5d7`, `b7f5192`, `1744d4f`, `7e72b69` |
| 21:07 to 23:15 | **Three bigger battlefields**; balance with bodies on the new maps (Ashfall strengthened); the large map reshaped | `532aef2`, `82fe88b`, `6de14c7`, `0902aab` |

## 2026-11-25: a quieter net

| Time | What | Commits |
|---|---|---|
| 09:44 to 09:52 | Every line has a kind, a net and a level; one squad reports what several meet; the operator sums a fight up once; the page gets a command net, a squad net and a radio traffic setting that the voice follows | `d205abc`, `fb0c10a`, `df0ee2e` |
| 10:05 to 10:12 | From a played match: the operator's own purchases are told at full traffic only; a squad Hammer ordered by name stays Hammer's; what is logged at which level | `402d7a0`, `cc77d6d`, `7ba7cb4`, `0411844` |

## 2026-11-26: guard, recogniser, tap-to-order, strike aircraft

| Time | What | Commits |
|---|---|---|
| 14:14 | A server uses its owner's keys only when marked private | `342712f` |
| 15:14 to 15:49 | Listening measurements gain an "order understood" column; tidying fixes; agents say "Stand by" only after a long wait; **Hebrew in the browser: a streaming Zipformer that is told the net's names**; push-to-talk streams the recording while it is spoken; a new page version keeps the speech model; the browser harness and what it found | `99d3c52`, `e1c87fd`, `5e2ae00`, `6c48909`, `df32a7e`, `3dfa29f`, `6d23487` |
| 15:58 to 16:08 | **Tap open ground to send the selected squad there; a squad sent by tapping obeys at once**; agents learn the commander's language from the page | `c2d99ae`, `9e56316`, `8830e24` |
| 16:22 to 17:08 | **Strike aircraft**: a jet for Aegis and a prop bomber for Ashfall, in the simulation, the agents, the art and the page; Anvil uses an idle strike squad | `315ee23`, `5fc59d5`, `5b2fb13`, `c7c5b1a`, `93bcdfd`, `d3b799c` |
| 18:32 to 21:49 | A squad's name on the map selects it; Escape, a right click or a second press lets go of the selection | `b88f8e5`, `b02aa9a` |
| later | This vault is written | - |

## Related

- [[History]]
- [[Decisions]]
- [[Balance]]
- [[Staging and Releasing]]
- [[Plan versus Code]]
- [[The Idea]]
