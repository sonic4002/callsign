---
title: Open Questions
description: "Things the documents, the code and the commit history show as undecided, or decided in one place and contradicted in another."
type: decision
status: current
tags:
  - type/decision
  - status/current
  - agent/CLD
  - origin/mixed
  - area/decisions
  - topic/open
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Fast Brain - Jev]]"
  - "[[Model Relay]]"
  - "[[Claude Brain and Player Keys]]"
  - "[[Decision - Client Stack]]"
  - "[[Decision - Command Sidebar]]"
  - "[[Mobile Layout]]"
  - "[[Speech on Phones]]"
  - "[[Backlog]]"
  - "[[Decision - Open League]]"
  - "[[Decision - Agents and Tools]]"
paths:
  - CLAUDE.md
  - docs/PLAN.html
  - docs/research/2026-11-24-jev-decision-model.md
  - docs/research/2026-11-24-classic-rts-play.md
  - docs/specs/2026-11-24-bases-harvest-maps.md
  - docs/FRIEND-MATCH.md
  - stt/eval/RESULTS.md
  - .env.example
---

# Open Questions

Things the documents, the code and the commit history show as undecided, or decided in one place and contradicted in another. Each entry says what is known and where; none of them is answered here.

## Money and AI

| Question | What is known |
|---|---|
| **Does the game ever sell AI credits, and through which payment provider?** | Nothing in the repository mentions payments, credits for sale or a payment provider. The plan says each player pays on their own key and "revenue later can come from cosmetics or a season pass, never stronger brains". The Jev research note reads the vendor's terms as allowing a game that uses the model internally, and as not allowing calls to be sold on as such ("not legal advice"). Not verified beyond that. |
| **Should the fast brain be on by default?** | `CALLSIGN_FAST_BRAIN` defaults to false; the lobby has a per-match switch. The research note recommends it for tier-1 order-taking "after a larger test on recorded orders in both languages", which has not been done: the 150-order set was written by the grammar's author. The threshold 0.67 is the vendor's example ([[Fast Brain - Jev]]). |
| **What happens when the fast brain's shared limits bite?** | All players share one organisation's rate limit, whose size the vendor does not publish; the daily ceiling defaults to 2 dollars, after which squads quietly use the rule brain ([[Fast Brain - Jev]]). |
| **Which model per tier, per vendor?** | `shared/models.json` calls its table starting points; cross-vendor win rates are not measured ([[Model Relay]]). |
| **One-click OpenRouter sign-in** | In the plan; the dialog takes a pasted key ([[Claude Brain and Player Keys]]). |

## The client

| Question | What is known |
|---|---|
| **Is the Phaser / TypeScript port still wanted?** | `CLAUDE.md` locks "TypeScript + Phaser 3"; the client is plain JavaScript on a canvas; the spec lists the port as out of scope; nothing records dropping it ([[Decision - Client Stack]]). |
| **Do squad orders go only by radio?** | `CLAUDE.md` says so; since 2026-11-26 move, hold and attack on the map go by hand, and the research note argued against click-to-move ([[Decision - Command Sidebar]]). |
| **Does it work on real phones?** | Layout and touch code exist; no measurement on a real phone is in the repository, and the speech evaluation says no phone was used ([[Mobile Layout]], [[Speech on Phones]]). |

## Online (Phase 3 of the plan)

| Question | What is known |
|---|---|
| **Accounts, matchmaking, ladders, replays** | None built. A player is a browser token; nothing persists between matches. The plan names Postgres and Redis; neither is in the repository ([[Backlog]]). |
| **The open league over MCP** | Locked, not built ([[Decision - Open League]]). |
| **Do agents stay on the server machine?** | The Node agent host is the default and the reason only the host makes matches on a public server; the locked decision says agents run in the browser ([[Decision - Agents and Tools]]). |
| **How is the live game deployed?** | Not written down ([[Staging and Releasing]], [[Playing in Public]]). |

## Game design

| Question | What is known |
|---|---|
| **Superpowers** | Principle locked, nothing built, plan numbers are only starting points ([[Superpowers]]). |
| **Bridges: may agents destroy them unasked?** | Two server-side rules were committed and reverted on 2026-11-24; no rule exists now ([[Terrain, Cover and Bridges]]). |
| **Does a brain tier mean anything without a language model?** | With the rule brain and the fast brain the tier picks no model; a rule-brain squad's level is tied to its tier ([[Ranks and Brain Tiers]], [[Rule Brain]]). |
| **Playing without an operator; a match with no timer; a radio-language room option** | In the plan's room options; not in the lobby ([[Match Rules and Winning]]). |
| **Balance between people, and between model brains** | Only scripted balance is measured ([[Balance]]). |
| **More factions; veterans with memory across matches** | In the plan; not built ([[Plan versus Code]]). |

## Speech and art before a public release

| Question | What is known |
|---|---|
| **Radio voices in production** | The speech service is a test rig; the plan was pre-recorded phrases. Its licences need reading before a public release ([[Text to Speech Service]], [[Licences and Credits]]). |
| **A credits screen** | Needed before the CC-BY music and the Hebrew recogniser's credit can ship ([[Licences and Credits]]). |
| **Recognition on real voices** | All scores are from synthetic voices ([[Recognition Evaluation]]). |
| **Native-speaker review of the Hebrew radio procedure** | Asked for in the plan ("reviewed by a native speaker who served"); no record that it happened. |

## Related

- [[Decisions]]
- [[Plan versus Code]]
- [[Backlog]]
- [[Known Flaws]]
- [[The Idea]]
