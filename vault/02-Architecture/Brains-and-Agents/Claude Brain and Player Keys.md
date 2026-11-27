---
title: Claude Brain and Player Keys
description: "Language models think for a side in two ways: through the model relay on the player's own key (the shipped path, any of four providers), or directly from the agent host on the owner's key (only ..."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/mixed
  - area/architecture
  - topic/brains
  - topic/claude
  - topic/relay
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Model Relay]]"
  - "[[Where Agents Run]]"
  - "[[Private Machine Guard]]"
  - "[[Subscription Brain]]"
  - "[[Key Handling]]"
  - "[[AI Brains and Model Relay]]"
  - "[[Fast Brain - Jev]]"
  - "[[Ranks and Brain Tiers]]"
  - "[[Seats, Tokens and Trust]]"
  - "[[Decision - Model Relay]]"
paths:
  - agents/brain-relay.mjs
  - agents/brain-claude.mjs
  - agents/worker.mjs
  - agents/main.mjs
  - agents/test/relay.test.mjs
  - client/brains/host.js
  - client/brains/settings.js
  - client/brains/policy.js
  - relay/relay.go
  - shared/models.json
  - docs/FRIEND-MATCH.md
---

# Claude Brain and Player Keys

Language models think for a side in two ways: through the model relay on the **player's own key** (the shipped path, any of four providers), or directly from the agent host on the **owner's key** (only on a machine marked private). Either way the model chosen for a squad follows its brain tier.

## Path 1: the relay brain (player's key)

`relayBrain` in `agents/brain-relay.mjs`. The agent never holds the key and never names a model.

```
POST /relay/v1/think
Authorization: Bearer <player token>
X-Callsign-Seat: <seat token>
{ room, side, role, squad, system, tools, messages }
  -> { content, stop_reason, usage: { input_tokens, output_tokens }, model, provider }
  or { error: { code, message } }
```

The relay asks the game server for the squad's tier, picks the model for the provider of the stored key, and calls the provider ([[Model Relay]]).

### How a player sets it up

1. The **AI** button opens the dialog (`client/brains/settings.js`): a provider list and a key box.
2. The page asks the relay for a player token once (`POST /relay/v1/player`) and keeps it in `localStorage` under `callsign.player`.
3. The key is sent once (`PUT /relay/v1/key`), and the input is cleared whether or not the relay took it. Afterwards the page only ever sees the provider and the key's last four characters.
4. `BrowserAgents.sync()` starts a browser host (rank 2) whose Workers think through the relay. It takes the side from the server machine's agents ([[Where Agents Run]]).

A relay brain runs only when the player holds a **seat in a lobby match**: the relay spends a key only for a seat the game server confirms.

### Failures

| Code | Meaning | What happens |
|---|---|---|
| `rate_limited`, `provider_error`, `unreachable` | passing trouble | retried up to 2 times, backing off 500 ms doubling, at most 5 s, honouring `Retry-After`; then the wake is skipped |
| `no_key`, `bad_key`, `not_your_seat` | only the player can fix it | the browser stops its agents, the side goes back to the server's agents, and the key is not tried again until it is changed or removed (commit `6dd5d93`) |
| `bad_request` | the relay did not accept the request | the wake is skipped |

A skipped wake costs nothing in the match: the squad keeps its last order and the fireteams fight on. One request times out after 45 s. A warning line is written at most once per 20 s per kind (`Throttle`).

The dialog also shows what the match has cost so far: thoughts, input and output tokens (`Usage`).

### Models by tier

From `shared/models.json` (the relay is its only reader):

| Tier | Effort | anthropic | openrouter | openai | gemini |
|---|---|---|---|---|---|
| 1 Recruit | low | `claude-haiku-5-5` | `anthropic/claude-haiku-5.5` | `gpt-6-luna` | `gemini-3.5-flash-lite` |
| 2 Sergeant | medium | `claude-sonnet-5-5` | `anthropic/claude-sonnet-5.5` | `gpt-6.2-sol` | `gemini-4-hydrogen` |
| 3 Veteran | high | `claude-opus-5-5` | `anthropic/claude-opus-5.5` | `gpt-6.2-astra` | `gemini-4-carbon` |
| operator | medium | `claude-opus-5-5` | `anthropic/claude-opus-5.5` | `gpt-6.2-astra` | `gemini-4-carbon` |

`maxTokens` is 4096 for every answer. The file's own comment calls these "starting points for balancing".

## Path 2: the Claude brain (owner's key, private machine)

`claudeBrain` in `agents/brain-claude.mjs` calls Anthropic directly from the Node agent host with `CALLSIGN_ANTHROPIC_KEY`. It is selected by `makeBrain` in `agents/main.mjs` only when `CALLSIGN_PRIVATE=1` ([[Private Machine Guard]]).

- Models: tier 1 `claude-haiku-5-5`, tier 2 `claude-sonnet-5-5`, tier 3 `claude-opus-5-5`; operator `claude-opus-5-5` or `CALLSIGN_OPERATOR_MODEL`.
- Effort: low / medium / high by tier, medium for the operator. `max_tokens` 4096. Prompt caching on (`cache_control: ephemeral`).
- Non-Haiku models are called with the server-side fallback beta so a declined request can be handed to another model; a `refusal` stop reason ends the wake.
- `check()` makes one tiny call at start. If the key is rejected and the brain was not asked for by name (`CALLSIGN_BRAIN`), the host falls back to the rule brain (commit `9b6a294`).

The file's header still describes this as the Phase 0 arrangement to be replaced by the relay; today both exist, and this one serves a side whose player has stored no key, on the owner's machine.

## Which is used for a side

- Player stored a key and sits in a lobby match: path 1, in the player's browser.
- Otherwise: whatever the server machine's host runs. That is the rule brain, unless the machine is private and has a key (path 2) or a subscription token ([[Subscription Brain]]).

## Key safety in one line

The key goes up once, is stored encrypted on the relay, is never returned, and is spent only when the same call carries the token of a seat the game server confirms. Details: [[Key Handling]]. Over plain HTTP (LAN play) the key can be read on the network on its way up, like everything else (`docs/FRIEND-MATCH.md`).

## Tests

`agents/test/relay.test.mjs` uses `agents/fake-relay.mjs`, a stand-in relay that answers every thought with the rule brain: the brain sends the seat and never a key; transient failures retry; a browser-ranked host takes the side and gives it back.

## Related

- [[AI Brains and Model Relay]]
- [[Model Relay]]
- [[Key Handling]]
- [[Where Agents Run]]
- [[Private Machine Guard]]
- [[Subscription Brain]]
- [[Fast Brain - Jev]]
- [[Ranks and Brain Tiers]]
- [[Seats, Tokens and Trust]]
- [[Decision - Model Relay]]
