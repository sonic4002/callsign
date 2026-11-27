---
title: Subscription Brain
description: "The subscription brain lets the owner test language-model squads without an API key: each thought is one run of Claude Code in print mode, signed in with a Claude subscription token."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/code
  - area/architecture
  - topic/brains
  - topic/test-rig
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Private Machine Guard]]"
  - "[[Agent Telemetry]]"
  - "[[AI Brains and Model Relay]]"
  - "[[Claude Brain and Player Keys]]"
  - "[[Where Agents Run]]"
  - "[[Stand By Behaviour]]"
  - "[[Environment Variables]]"
paths:
  - agents/brain-subscription.mjs
  - agents/main.mjs
  - agents/test/telemetry.test.mjs
  - agents/test/fixtures/claude-code-result.json
  - .env.example
---

# Subscription Brain

The subscription brain lets the owner test language-model squads without an API key: each thought is one run of Claude Code in print mode, signed in with a Claude subscription token. It is slower than the API brain and draws on the subscription's limits, so it is a test rig, not how the game ships.

## When it is used

`makeBrain` in `agents/main.mjs` picks it when `CALLSIGN_CLAUDE_TOKEN` is set, or when `CALLSIGN_ANTHROPIC_KEY` holds a subscription token (recognised by its prefix), or when `CALLSIGN_BRAIN=subscription`. Like every brain that spends the owner's credentials it needs `CALLSIGN_PRIVATE=1` ([[Private Machine Guard]]).

It runs only in the Node agent host on the server machine (it spawns a process); it cannot run in a browser. The relay refuses a subscription token as a player key ("that is a Claude subscription token, not an API key").

## How one thought works

1. The agent's message history is flattened to plain text (`transcript`): wake texts, "You called <tool> <input>", "<tool> returned / was refused: ...".
2. Claude Code is started once (`CALLSIGN_CLAUDE_BIN`, default `claude`) with:
   `-p --model <model> --effort <level> --tools "" --strict-mcp-config --setting-sources "" --no-session-persistence --output-format json --system-prompt <system + tool guide> --json-schema <schema>`.
3. Its own tools are switched off. The model answers with **structured output**: `{ actions: [{ tool, input }] }`, each action checked against that tool's input schema (`actionSchema`).
4. The brain turns the actions into `tool_use` blocks; the agent runs them through the game server as usual.
5. It thinks again only if an action was refused or the model called `report`; otherwise the turn ends without another process.

Isolation: the process runs in an empty temporary directory so it finds no project files or instructions; `ANTHROPIC_API_KEY` and `CALLSIGN_ANTHROPIC_KEY` are removed from its environment so the subscription pays, never a key that happens to be set. A run is killed after 60 s.

## Models

Same table as the Claude brain: tier 1 `claude-haiku-5-5` (effort low), tier 2 `claude-sonnet-5-5` (medium), tier 3 `claude-opus-5-5` (high); operator `claude-opus-5-5` (medium) or `CALLSIGN_OPERATOR_MODEL`.

## What it reports

`reading(res, asked)` takes from Claude Code's JSON result the token counts (cached input included, each request under `iterations`), the model that actually answered, and that model's context window (`modelUsage.contextWindow`). This is the one brain that tells [[Agent Telemetry]] the window directly. `agents/test/fixtures/claude-code-result.json` is a recorded result used by the tests.

## Start-up check

`check()` runs one small call ("Radio check."). If it fails and the brain was not asked for by name, the host logs why and plays the rule brain.

## History

Added in commit `cdccbbb` ("subscription brain for testing, thinking through Claude Code print mode").

## Related

- [[AI Brains and Model Relay]]
- [[Claude Brain and Player Keys]]
- [[Private Machine Guard]]
- [[Where Agents Run]]
- [[Agent Telemetry]]
- [[Stand By Behaviour]]
- [[Environment Variables]]
