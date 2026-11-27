---
title: Decision - Model Relay
description: "Agents never call an AI provider directly: a relay written in Go, in the same repository, looks up the squad's brain tier on the game server, picks the model, and calls the provider with the ..."
type: decision
status: current
tags:
  - type/decision
  - status/current
  - agent/CLD
  - origin/mixed
  - area/decisions
  - topic/relay
  - topic/keys
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Model Relay]]"
  - "[[Key Handling]]"
  - "[[Decision - Brains without a Player Key]]"
  - "[[Fast Brain - Jev]]"
  - "[[Private Machine Guard]]"
  - "[[Claude Brain and Player Keys]]"
  - "[[Decisions]]"
  - "[[Ranks and Brain Tiers]]"
  - "[[Open Questions]]"
paths:
  - CLAUDE.md
  - docs/PLAN.html
  - relay/relay.go
  - relay/decide.go
  - shared/models.json
  - docs/research/2026-11-24-jev-decision-model.md
---

# Decision - Model Relay

Agents never call an AI provider directly: a relay written in Go, in the same repository, looks up the squad's brain tier on the game server, picks the model, and calls the provider with the player's own key. Keys are encrypted at rest and never returned to the browser.

## The decision as written

> **Model relay:** Go, same repo. Agents never call AI directly. The relay looks up the squad's brain tier on the game server, picks the model, and calls the provider with the player's own key (OpenRouter or Claude/Gemini/OpenAI). Keys encrypted at rest, never returned to the browser.

| | |
|---|---|
| Date | 2026-11-23 (`e21e0cb`); built 2026-11-24 (`b166395`, `52e5f6d`, `6b9044f`, `4605bb9`) |
| Decided by | the plan (`docs/PLAN.html`, sections Echo and Papa) |
| Replaced | nothing |

## The reason recorded

Fairness and cost, from the plan: the player pays for their own army's thinking, the game runs no AI, and "nobody's squad thinks smarter than the gold they spent" because the relay, not the agent, chooses the model by tier.

## How the code stands

- The relay exists as described: four provider translators, a tier-to-model table in `shared/models.json`, an encrypted key store, player tokens, a seat check against the game server ([[Model Relay]], [[Key Handling]]).
- **One recorded exception:** the fast brain (Jev) runs on the game's own key held by the relay (`CALLSIGN_JEV_KEY`), through a separate `decide` route with its own limits. `CLAUDE.md` names it as "the one exception to 'the player's own key'" ([[Decision - Brains without a Player Key]], [[Fast Brain - Jev]]).
- **One difference in practice:** on the owner's own machine the agent host can think with the owner's Anthropic key or subscription token directly, without the relay (`agents/brain-claude.mjs`, `agents/brain-subscription.mjs`), only when `CALLSIGN_PRIVATE=1` ([[Private Machine Guard]]). The header of `brain-claude.mjs` still calls this the Phase 0 arrangement.
- The plan's one-click OpenRouter sign-in is not built; the dialog takes a pasted key ([[Claude Brain and Player Keys]]).

## Related

- [[Decisions]]
- [[Model Relay]]
- [[Key Handling]]
- [[Ranks and Brain Tiers]]
- [[Decision - Brains without a Player Key]]
- [[Open Questions]]
