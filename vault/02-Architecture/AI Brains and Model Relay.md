---
title: AI Brains and Model Relay
description: "Callsign supports three brain layers so anyone can play for free while players who bring an API key unlock full LLM mission command—without pay-to-win cheating."
type: overview
status: current
tags:
  - type/overview
  - status/current
  - agent/AGY
  - origin/mixed
  - area/architecture
  - topic/architecture
  - topic/ai
  - topic/relay
  - topic/jev
created: 2026-11-26
updated: 2026-11-27
agent: AGY
origin: mixed
confidence: medium
related:
  - "[[Home]]"
  - "[[Locked Decisions]]"
  - "[[System Architecture]]"
  - "[[Chain of Command and Autonomy]]"
paths:
  - agents/brain-rule.mjs
  - agents/rule-grammar.mjs
  - shared/rules.json
  - agents/brain-jev.mjs
  - relay/decide.go
  - docs/research/2026-11-24-jev-decision-model.md
  - agents/brain-relay.mjs
  - shared/models.json
  - agents/main.mjs
  - agents/agent.mjs
  - agents/host.mjs
  - agents/worker.mjs
  - agents/brain-claude.mjs
  - agents/brain-subscription.mjs
  - relay/relay.go
  - client/brains/host.js
  - client/brains/policy.js
  - CLAUDE.md
  - docs/PLAN.html
---

# AI Brains and Model Relay

Callsign supports three brain layers so anyone can play for free while players who bring an API key unlock full LLM mission command—without pay-to-win cheating.

## The Three Brain Layers

### 1. Rule Brain (Free Default — `agents/brain-rule.mjs`)
- Requires **zero API keys** and runs at zero latency/cost.
- Bilingual grammar (`agents/rule-grammar.mjs`) parses English & Hebrew orders, map points, described landmarks, build/buy/sell/rally/haul/fortify/capture/repair/plant/seize orders, and answers with fixed radio procedure phrases (`shared/rules.json` → `radio.brain`).
- Supports configurable initiative levels (`CALLSIGN_ANVIL_LEVEL=1..3`) for Anvil.

### 2. Jev Fast Decision Brain (`agents/brain-jev.mjs`, `relay/decide.go`)
- Uses TypeSafe AI's **System One** classifier (`jev-1.14.0`, `POST https://api.typesafe.ai/v1/systemone`).
- **Pipeline**: Rule grammar reads every order first; only paraphrases or damaged STT orders that the grammar cannot place go to Jev, which selects from a closed list of valid squad actions with calibrated probabilities (threshold `0.67`; below threshold asks *"Say again"*).
- **Measured Performance** (`docs/research/2026-11-24-jev-decision-model.md`, 150 orders across EN/HE):
  - Grammar alone: `92%` right, `0` wrong actions.
  - Grammar → Jev: **`95%` right (`142/150`), `0` wrong actions**, `~222 ms` median browser round-trip, `~$0.00007` per decision.
- **Key Guard**: Runs on `CALLSIGN_JEV_KEY` **only** when `CALLSIGN_PRIVATE=1` marks the owner's own machine. Production servers refuse owner keys.

### 3. LLM Brains (BYOK — `agents/brain-relay.mjs`, `relay/`)
Players connect **OpenRouter**, **Anthropic**, **OpenAI**, or **Gemini** via their own API key. Keys are stored encrypted on disk in `.relay-data/` under a signed player token and never returned to the browser.

## Tier-to-Model Mapping (`shared/models.json`)
The relay queries `GET /internal/tier` on the game server using the player's seat token before every AI call—the browser can never spoof a stronger tier.

| Tier | Upgrade Cost | Effort | Anthropic | OpenRouter | OpenAI | Gemini |
|---|---|---|---|---|---|---|
| **Tier 1 · Recruit** (טירון) | Included | `low` | `claude-haiku-5-5` | `anthropic/claude-haiku-5.5` | `gpt-6-luna` | `gemini-3.5-flash-lite` |
| **Tier 2 · Sergeant** (סמל) | 300 gold | `medium` | `claude-sonnet-5-5` | `anthropic/claude-sonnet-5.5` | `gpt-6.2-sol` | `gemini-4-hydrogen` |
| **Tier 3 · Veteran** (ותיק) | 800 gold | `high` | `claude-opus-5-5` | `anthropic/claude-opus-5.5` | `gpt-6.2-astra` | `gemini-4-carbon` |
| **Operator (Anvil)** | — | `medium` | `claude-opus-5-5` | `anthropic/claude-opus-5.5` | `gpt-6.2-astra` | `gemini-4-carbon` |

## Related Notes
- [[Home]]
- [[Locked Decisions]]
- [[System Architecture]]
- [[Chain of Command and Autonomy]]

---

## In detail

Every station on a side's radio net except the player is an agent: one operator (Anvil / סדן) and one leader per squad. An agent is a small loop that sleeps until the net or the match wakes it, asks a *brain* what to do, and acts only through the game tools the server checks.

### The parts

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

### The five brains

All brains have the same shape: `think({ agent, system, tools, messages, wake, rules })` returns Anthropic-style content blocks (`text`, `tool_use`). The agent loop does not know which one it has.

| Brain (`name`) | File | Needs | Who pays | Used for | Note |
|---|---|---|---|---|---|
| `rule` | `agents/brain-rule.mjs` | nothing | nobody | The default: squads and Anvil with no AI | [[Rule Brain]], [[Command Grammar]] |
| `jev` | `agents/brain-jev.mjs` | relay with `CALLSIGN_JEV_KEY`, a seat | the game's own key | Squads' order-taking; Anvil stays on the rule brain | [[Fast Brain - Jev]] |
| `relay` | `agents/brain-relay.mjs` | player's key stored on the relay, a seat | the player | Language models for Anvil and squads, model chosen by tier | [[Claude Brain and Player Keys]] |
| `claude` | `agents/brain-claude.mjs` | `CALLSIGN_ANTHROPIC_KEY` and `CALLSIGN_PRIVATE=1` | the owner | Owner's own machine: the agent host calls Anthropic directly | [[Claude Brain and Player Keys]] |
| `subscription` | `agents/brain-subscription.mjs` | `CALLSIGN_CLAUDE_TOKEN` and `CALLSIGN_PRIVATE=1` | the owner's subscription | Test rig through Claude Code print mode | [[Subscription Brain]] |

`tiered()` in `agents/brain-jev.mjs` joins two brains: tier-1 squads on the fast brain, everything else on the relay brain.

### Which brain plays

1. **On the server machine** (`agents/main.mjs`, `makeBrain`): `CALLSIGN_BRAIN` if set, else `subscription` when a subscription token is present, else `claude` when an API key is present, else `rule`. Anything but `rule` is refused unless `CALLSIGN_PRIVATE=1` ([[Private Machine Guard]]). A key that fails its start-up check falls back to `rule` unless the brain was asked for by name.
2. **In the player's browser** (`client/brains/policy.js`, `wanted`): `rule` in the first lesson or when the player ticked "run here"; `relay` when the relay holds a key for this player and the player has a seat; `jev` when the match has the fast brain on, the relay offers it, and the player has a seat; otherwise nothing runs in the browser.
3. **Who wins**: the game server lets one host run a side. The commander's browser (rank 2) outranks the server machine's host (rank 1). See [[Where Agents Run]].

So with no keys anywhere, every squad and Anvil run on the rule brain on the server machine, and the game is fully playable for free.

### Differs from the docs

- Differs from `CLAUDE.md` ("Agents ... run as Web Workers in the player's browser"): agents run in the browser only when the browser has a reason (a key, the fast brain, the lesson). Otherwise a Node process on the server machine runs them.
- Differs from `CLAUDE.md` (tools "`radio`, `move`, `hold`, `attack`, `report`, `buy` (operator only)"): the code has many more tools. See [[Agent Tools]].
- Differs from `CLAUDE.md` / `docs/PLAN.html` (open league MCP endpoint): no MCP endpoint exists in `server/`, `relay/` or `agents/`. Not built.
- Differs from `docs/PLAN.html` ("Connect in one click through OpenRouter"): the AI dialog takes a pasted key for one of four providers; there is no OAuth sign-in.
- `agents/main.mjs` still carries the comment "a player's own key will come in through here" on `Director.brainFor`; the player's key actually arrives through the browser host and the relay.

### Related

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
- [[Radio Net and Bilingual Procedure]]
- [[Decision - Brains without a Player Key]]
- [[Decision - Agents and Tools]]
- [[Decision - Model Relay]]
- [[Decision - Open League]]
