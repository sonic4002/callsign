---
title: Reference Map
description: "This vault describes Callsign (אות קריאה) as the code stood on 2026-11-26: a browser real-time strategy game in which every squad is an AI agent commanded over a military radio net in Hebrew and ..."
type: hub
status: current
tags:
  - type/hub
  - status/current
  - agent/CLD
  - origin/mixed
  - area/meta
  - topic/home
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[The Idea]]"
  - "[[Match Rules and Winning]]"
  - "[[Running Locally]]"
  - "[[Decisions]]"
  - "[[Plan versus Code]]"
  - "[[Glossary]]"
  - "[[Game Design]]"
  - "[[Radio Net]]"
  - "[[Brains and Agents]]"
  - "[[Client]]"
paths:
  - CLAUDE.md
  - docs/PLAN.html
  - shared/rules.json
  - Makefile
---

# Reference Map

This vault describes Callsign (אות קריאה) as the code stood on 2026-11-26: a browser real-time strategy game in which every squad is an AI agent commanded over a military radio net in Hebrew and English. It is a map of the whole project, written from the code and the documents, so that a person or an agent can find their way without reading the code first.

## Start here

| If you want | Read |
|---|---|
| The game in one page | [[The Idea]] |
| What a match is and how it is won | [[Match Rules and Winning]] |
| To run it | [[Running Locally]] |
| What is decided and must not be changed without asking | [[Decisions]] |
| What the old documents get wrong | [[Plan versus Code]] |
| A word you do not know | [[Glossary]] |

## The areas

| # | Area | Hub | What is in it |
|---|---|---|---|
| 1 | Game design | [[Game Design]] | factions, units, structures, economy, power, fog, heroes, maps, the enemy bot, balance |
| 2 | Radio net | [[Radio Net]] | procedure words, callsigns, point letters, routing, the two nets, traffic levels, base cues, initiative |
| 3 | Brains and agents | [[Brains and Agents]] | Anvil and the squad leaders, their tools, the rule brain, the fast brain, the relay, keys |
| 4 | Client | [[Client]] | the page: layout, map, selection and orders, build bar, settings, phone layout, i18n |
| 5 | Speech | [[Speech]] | radio voices, speech recognition on the server and in the browser, the evaluation |
| 6 | Server | [[Server Architecture]] | the simulation, rooms and lobby, frames and routes, direct acts, bodies, sorties, tests |
| 7 | Operations | [[Operations]] | make targets, compose services, environment variables, running on a LAN and in public |
| 8 | Art and assets | [[Art and Assets]] | the style, the pipeline, licences and credits |
| 9 | Decisions | [[Decisions]] | one note per locked decision, and the open questions |
| 10 | Known flaws and backlog | [[Known Flaws and Backlog]] | flaws, limits, what is not built, where the documents and the code differ |
| 11 | History | [[History]] | how the project developed, from `git log` |
| 12 | Glossary | [[Glossary]] | every term, callsign and Hebrew and English pair |

## The system at a glance

```
            the player (Hammer)                    other programs
                   │ page: map, radio, voice             │
                   ▼                                     ▼
 ┌───────────────────────────────────────────────────────────────┐
 │ game server (Go): rooms, radio net, simulation at 10 ticks/s  │
 │ owns all truth; fireteams and the scripted enemy are code     │
 └───────┬───────────────────────┬───────────────────┬───────────┘
         │ events, radio, tools  │ /relay/           │ /tts/  /stt/
         ▼                       ▼                   ▼
 agents: Anvil + squad     model relay (Go):    speech service,
 leaders, on the server    players' keys,       listening service
 machine or in the         tier → model,        (optional)
 player's browser          the fast brain
```

- The server: [[Server Architecture]], [[Sim Loop and Determinism]].
- The agents and where they run: [[Where Agents Run]], [[Agent Loop]].
- The relay: [[Model Relay]]. Speech: [[Speech]].
- The rules everything reads: [[Decision - Rules Data]].

## The repository

| Path | What | Notes |
|---|---|---|
| `server/` | Go game server: `sim`, `room`, `radio`, `bot`, `cmd/callsign` | [[Server Architecture]] |
| `relay/` | Go model relay | [[Model Relay]] |
| `shared/` | `rules.json`, `models.json` and their Go types | [[Decision - Rules Data]] |
| `agents/` | the agent runtime, brains and prompts (Node and browser) | [[Brains and Agents]] |
| `client/` | the page: plain JavaScript modules, i18n, voice, speech | [[Client]] |
| `tts/`, `stt/` | the speech and listening services (Python) | [[Speech]] |
| `art/`, `assets/` | the art pipeline and its results; audio | [[Art and Assets]] |
| `tools/` | map generator, call parser, public-address helpers | [[Maps]], [[Playing in Public]] |
| `docs/` | the plan, the spec, research notes, the style sheet, the friend-match guide | [[History]] |
| `vault/` | this vault | `README` in the vault folder |

## Numbers worth remembering

| | |
|---|---|
| Tick rate | 10 a second |
| Squads per side | 12; haulers 4 |
| Starting gold | 1,000 by default |
| Headquarters | 3,000 hp |
| Maps | 2800 x 1760, 4000 x 2480, 5200 x 3200 |
| Default match length | 15, 20, 25 minutes |
| Brain tier upgrades | 300 and 800 gold |

## How this vault was made, and how far to trust it

Every note lists the files it was written from under `sources:` in its frontmatter, so it can be checked again. Numbers in the unit, structure and map tables were generated from `shared/rules.json`. Where a document and the code disagree, the notes say what the code does. Things that could not be established are marked "not verified". The vault's own `README.md` says how to keep it current.

## Related

- [[Game Design]]
- [[Radio Net]]
- [[Brains and Agents]]
- [[Client]]
- [[Speech]]
- [[Server Architecture]]
- [[Operations]]
- [[Art and Assets]]
- [[Decisions]]
- [[Known Flaws and Backlog]]
- [[History]]
- [[Glossary]]
