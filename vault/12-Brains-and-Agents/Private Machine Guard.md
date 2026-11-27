---
title: Private Machine Guard
description: "CALLSIGNPRIVATE=1 marks the owner's own machine."
type: concept
status: current
tags:
  - type/concept
  - status/current
  - agent/CLD
  - origin/code
  - area/brains-and-agents
  - topic/brains
  - topic/security
  - topic/ops
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Brains and Agents]]"
  - "[[Key Handling]]"
  - "[[Fast Brain - Jev]]"
  - "[[Claude Brain and Player Keys]]"
  - "[[Subscription Brain]]"
  - "[[Environment Variables]]"
  - "[[Playing in Public]]"
  - "[[Decision - Brains without a Player Key]]"
paths:
  - agents/main.mjs
  - relay/cmd/relay/main.go
  - agents/test/units.test.mjs
  - docker-compose.yml
  - .env.example
---

# Private Machine Guard

`CALLSIGN_PRIVATE=1` marks the owner's own machine. Without it, a server refuses to use any of the owner's own AI credentials, so a key left in the environment of a public server by mistake cannot be spent by visitors.

Added on 2026-11-26 in commit `342712f` ("A server uses its owner's keys only when marked private"). Players' own keys are not affected.

## Exactly what it gates

The check is the literal string `"1"`. Anything else, including unset, is "not private".

| Credential | Read by | Without `CALLSIGN_PRIVATE=1` |
|---|---|---|
| `CALLSIGN_ANTHROPIC_KEY` (Claude brain) | agent host, `makeBrain` in `agents/main.mjs` | not used; the rule brain plays; a line is logged |
| `CALLSIGN_CLAUDE_TOKEN` (subscription brain) | agent host, same function | same |
| `CALLSIGN_BRAIN=claude` / `subscription` asked for by name | agent host | same: forced back to `rule` |
| `CALLSIGN_JEV_KEY` (fast brain) | relay, `relay/cmd/relay/main.go` | treated as empty: the decide route is off and answers `decide_off`; a line is logged |

In the agent host the guard applies to any brain kind other than `rule` / `scripted`, before any key is looked at.

## What it does not gate

- A **player's** key stored on the relay: always usable by that player with a valid seat.
- The rule brain: needs nothing.
- The relay's master key and the agent key: those are the server's plumbing, not spending credentials.
- The lobby's fast-brain option: it can still be ticked, but with the relay's route off the page sees `decide.on = false` and squads use the rule brain.

## Where it is set

`.env.example` puts it first, with the rule: `"1"` only on your own machine; a public server leaves it unset and leaves the owner's keys empty. `docker-compose.yml` passes it to the `relay` service explicitly; the `agents` service gets it through its `env_file`.

## Result on a public server

Unset: every side without a player key runs on the rule brain, the fast brain is off, and the only AI spending possible is each player's own key through the relay.

## Test

`agents/test/units.test.mjs` covers `makeBrain` with and without the mark (changed in the same commit).

## Related

- [[Brains and Agents]]
- [[Key Handling]]
- [[Fast Brain - Jev]]
- [[Claude Brain and Player Keys]]
- [[Subscription Brain]]
- [[Environment Variables]]
- [[Playing in Public]]
- [[Decision - Brains without a Player Key]]
