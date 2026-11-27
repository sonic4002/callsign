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
updated: 2026-11-26
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
