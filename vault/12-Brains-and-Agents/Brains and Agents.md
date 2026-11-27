---
title: Brains and Agents
description: "Every station on a side's radio net except the player is an agent: one operator (Anvil / סדן) and one leader per squad."
type: hub
status: current
tags:
  - type/hub
  - status/current
  - agent/CLD
  - origin/mixed
  - area/brains-and-agents
  - topic/brains
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Agent Loop]]"
  - "[[Operator - Anvil]]"
  - "[[Squad Leaders]]"
  - "[[Agent Tools]]"
  - "[[Where Agents Run]]"
  - "[[Model Relay]]"
  - "[[Key Handling]]"
  - "[[Prompts]]"
  - "[[Agent Telemetry]]"
  - "[[Rule Brain]]"
paths:
  - agents/main.mjs
  - agents/agent.mjs
  - agents/host.mjs
  - agents/worker.mjs
  - agents/brain-rule.mjs
  - agents/brain-jev.mjs
  - agents/brain-relay.mjs
  - agents/brain-claude.mjs
  - agents/brain-subscription.mjs
  - relay/relay.go
  - relay/decide.go
  - client/brains/host.js
  - client/brains/policy.js
  - shared/models.json
  - CLAUDE.md
  - docs/PLAN.html
---

# Brains and Agents

Every station on a side's radio net except the player is an agent: one operator (Anvil / סדן) and one leader per squad. An agent is a small loop that sleeps until the net or the match wakes it, asks a *brain* what to do, and acts only through the game tools the server checks.

## The parts

| Part | What it is | Note |
|---|---|---|
| Agent | The wake / think / act loop, one per station (`agents/agent.mjs`) | [[Agent Loop]] |
| Operator | Anvil, the player's staff officer: base, purchases, tasking | [[Operator - Anvil]] |
| Squad leader | One per squad; moves, holds, attacks, reports | [[Squad Leaders]] |
| Tools | The only way an agent touches the match | [[Agent Tools]] |
| Host | Keeps one agent per station in step with the match | [[Where Agents Run]] |
| Brain | The thing that answers `think()`; five exist | table below |
| Relay | Go service that holds players' keys and makes the AI calls | [[Model Relay]], [[Key Handling]] |
| Prompts | System prompts built from `shared/rules.json` | [[Prompts]] |
| Telemetry | What an agent tells its own commander about itself | [[Agent Telemetry]] |

## The five brains

All brains have the same shape: `think({ agent, system, tools, messages, wake, rules })` returns Anthropic-style content blocks (`text`, `tool_use`). The agent loop does not know which one it has.

| Brain (`name`) | File | Needs | Who pays | Used for | Note |
|---|---|---|---|---|---|
| `rule` | `agents/brain-rule.mjs` | nothing | nobody | The default: squads and Anvil with no AI | [[Rule Brain]], [[Command Grammar]] |
| `jev` | `agents/brain-jev.mjs` | relay with `CALLSIGN_JEV_KEY`, a seat | the game's own key | Squads' order-taking; Anvil stays on the rule brain | [[Fast Brain - Jev]] |
| `relay` | `agents/brain-relay.mjs` | player's key stored on the relay, a seat | the player | Language models for Anvil and squads, model chosen by tier | [[Claude Brain and Player Keys]] |
| `claude` | `agents/brain-claude.mjs` | `CALLSIGN_ANTHROPIC_KEY` and `CALLSIGN_PRIVATE=1` | the owner | Owner's own machine: the agent host calls Anthropic directly | [[Claude Brain and Player Keys]] |
| `subscription` | `agents/brain-subscription.mjs` | `CALLSIGN_CLAUDE_TOKEN` and `CALLSIGN_PRIVATE=1` | the owner's subscription | Test rig through Claude Code print mode | [[Subscription Brain]] |

`tiered()` in `agents/brain-jev.mjs` joins two brains: tier-1 squads on the fast brain, everything else on the relay brain.

## Which brain plays

1. **On the server machine** (`agents/main.mjs`, `makeBrain`): `CALLSIGN_BRAIN` if set, else `subscription` when a subscription token is present, else `claude` when an API key is present, else `rule`. Anything but `rule` is refused unless `CALLSIGN_PRIVATE=1` ([[Private Machine Guard]]). A key that fails its start-up check falls back to `rule` unless the brain was asked for by name.
2. **In the player's browser** (`client/brains/policy.js`, `wanted`): `rule` in the first lesson or when the player ticked "run here"; `relay` when the relay holds a key for this player and the player has a seat; `jev` when the match has the fast brain on, the relay offers it, and the player has a seat; otherwise nothing runs in the browser.
3. **Who wins**: the game server lets one host run a side. The commander's browser (rank 2) outranks the server machine's host (rank 1). See [[Where Agents Run]].

So with no keys anywhere, every squad and Anvil run on the rule brain on the server machine, and the game is fully playable for free.

## Differs from the docs

- Differs from `CLAUDE.md` ("Agents ... run as Web Workers in the player's browser"): agents run in the browser only when the browser has a reason (a key, the fast brain, the lesson). Otherwise a Node process on the server machine runs them.
- Differs from `CLAUDE.md` (tools "`radio`, `move`, `hold`, `attack`, `report`, `buy` (operator only)"): the code has many more tools. See [[Agent Tools]].
- Differs from `CLAUDE.md` / `docs/PLAN.html` (open league MCP endpoint): no MCP endpoint exists in `server/`, `relay/` or `agents/`. Not built.
- Differs from `docs/PLAN.html` ("Connect in one click through OpenRouter"): the AI dialog takes a pasted key for one of four providers; there is no OAuth sign-in.
- `agents/main.mjs` still carries the comment "a player's own key will come in through here" on `Director.brainFor`; the player's key actually arrives through the browser host and the relay.

## Related

- [[Agent Loop]]
- [[Operator - Anvil]]
- [[Squad Leaders]]
- [[Agent Tools]]
- [[Rule Brain]]
- [[Command Grammar]]
- [[Fast Brain - Jev]]
- [[Claude Brain and Player Keys]]
- [[Subscription Brain]]
- [[Where Agents Run]]
- [[Model Relay]]
- [[Key Handling]]
- [[Private Machine Guard]]
- [[Stand By Behaviour]]
- [[Prompts]]
- [[Agent Telemetry]]
- [[Ranks and Brain Tiers]]
- [[Initiative - Orders, Fight and Purse]]
- [[Radio Net]]
- [[Decision - Brains without a Player Key]]
- [[Decision - Agents and Tools]]
- [[Decision - Model Relay]]
- [[Decision - Open League]]
