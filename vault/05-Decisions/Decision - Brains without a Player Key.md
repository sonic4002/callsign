---
title: Decision - Brains without a Player Key
description: "The default brain is a rule brain that needs no AI at all, so anyone can play for free."
type: decision
status: current
tags:
  - type/decision
  - status/current
  - agent/CLD
  - origin/mixed
  - area/decisions
  - topic/brains
  - topic/keys
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Rule Brain]]"
  - "[[Command Grammar]]"
  - "[[Fast Brain - Jev]]"
  - "[[Model Relay]]"
  - "[[Seats, Tokens and Trust]]"
  - "[[Private Machine Guard]]"
  - "[[Open Questions]]"
  - "[[Locked Decisions]]"
  - "[[Claude Brain and Player Keys]]"
  - "[[Decision - Model Relay]]"
paths:
  - CLAUDE.md
  - docs/research/2026-11-24-jev-decision-model.md
  - agents/brain-rule.mjs
  - agents/brain-jev.mjs
  - relay/decide.go
  - .env.example
---

# Decision - Brains without a Player Key

The default brain is a rule brain that needs no AI at all, so anyone can play for free. A fast decision model (Jev) takes orders on the game's own key held by the relay, and language models stay on the player's key for Anvil and the higher tiers.

## The decision as written

> **Brains without a player key** (owner, 2026-11-24): the default brain is a rule brain that needs no AI at all (fixed sentences in both languages, several skill levels), so anyone can play for free. Jev (TypeSafe's decision model) is the fast brain for order-taking and runs on the game's own key, held by the relay (`CALLSIGN_JEV_KEY`), never sent to a browser; this is the one exception to "the player's own key". Language models (Claude and the others) stay on the player's key and are for Anvil and higher tiers.

| | |
|---|---|
| Date | 2026-11-24 (commit `2585634` wrote it into `CLAUDE.md`) |
| Decided by | the owner |
| Replaced | the plan's rule that every brain is a language model on the player's own key; and the "scripted brain" that was only a fallback when no key worked (`9b6a294`) |

## The reason recorded

- "So anyone can play for free" (`CLAUDE.md`).
- For Jev, the research note (`docs/research/2026-11-24-jev-decision-model.md`) laid out three ways to pay: the player brings a TypeSafe key, the player's OpenRouter key, or the game pays. Section 6: "The owner chose option 3 of section 4: the game pays, with one TypeSafe key held by the relay." The note's argument for it: at about 0.006 cents a decision it is affordable, and it removes the key from the tier-1 experience; its cost: it changes the locked rule that the player's key pays, and all players share one organisation's rate limit.

## What was built

| Piece | Commit | Note |
|---|---|---|
| The rule brain: a command grammar in both languages, fixed phrases from `rules.json`, three levels of initiative | `d8f07d5` | [[Rule Brain]], [[Command Grammar]] |
| Jev as a decision provider in the relay, behind a seat check, two rate limits, a size cap and a daily ceiling | `46fd49f` | [[Fast Brain - Jev]], [[Model Relay]] |
| The fast brain: grammar first, Jev for what the grammar did not match; a lobby choice of it and of Anvil's initiative | `2cc0a92` | [[Fast Brain - Jev]] |
| The game's key is spent only for a seat | `6c6247d` | [[Seats, Tokens and Trust]] |
| The owner's keys are used only on a machine marked private | `342712f` (2026-11-26) | [[Private Machine Guard]] |

## How the code stands

Matches the decision. Defaults: `CALLSIGN_FAST_BRAIN=false`, so a match uses the rule brain unless its maker or the server turns the fast brain on; the daily ceiling defaults to 2 dollars. Whether the fast brain should be on by default is listed in [[Open Questions]].

## Related

- [[Locked Decisions]]
- [[Rule Brain]]
- [[Fast Brain - Jev]]
- [[Claude Brain and Player Keys]]
- [[Decision - Model Relay]]
- [[Private Machine Guard]]
- [[Open Questions]]
