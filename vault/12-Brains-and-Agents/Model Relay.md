---
title: Model Relay
description: "The model relay (relay/, Go) is the one place an AI key is used."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/code
  - area/brains-and-agents
  - topic/brains
  - topic/relay
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Fast Brain - Jev]]"
  - "[[Claude Brain and Player Keys]]"
  - "[[Environment Variables]]"
  - "[[Brains and Agents]]"
  - "[[Key Handling]]"
  - "[[Private Machine Guard]]"
  - "[[Seats, Tokens and Trust]]"
  - "[[HTTP API]]"
  - "[[Docker Compose Services]]"
  - "[[Make Targets]]"
paths:
  - relay/relay.go
  - relay/decide.go
  - relay/wire.go
  - relay/limits.go
  - relay/game.go
  - relay/player.go
  - relay/keystore.go
  - relay/cmd/relay/main.go
  - relay/provider/provider.go
  - relay/provider/anthropic.go
  - relay/provider/chat.go
  - relay/provider/gemini.go
  - relay/provider/typesafe.go
  - relay/relay_test.go
  - shared/models.json
  - shared/models.go
  - server/cmd/callsign/main.go
  - server/room/hub.go
  - docker-compose.yml
  - Makefile
---

# Model Relay

The model relay (`relay/`, Go) is the one place an AI key is used. Agents send it a thought with their seat token; it asks the game server which brain tier that squad has, picks the model from `shared/models.json`, and calls the provider with the key the player stored.

Nobody's squad thinks with a stronger model than its gold paid for, and a key never goes back to a browser. The relay keeps no match state: apart from the encrypted key store it remembers nothing, so it can be restarted at any time, and two can run side by side on one key directory.

## Where it sits

- Its own process: `go run ./relay/cmd/relay` (compose service `relay`, port 8090 inside the compose network, **no published port**).
- Reached only through the game server, which reverse-proxies `/relay/` to it when started with `-relay=<url>`. A page of the game is therefore on the same origin as the relay.
- It calls the game server back at `-game` (`/internal/tier`) with the agent key as bearer.

## Routes

| Route | Auth | Purpose |
|---|---|---|
| `POST /relay/v1/player` | none (30 new tokens a minute across all callers) | mint a player token |
| `GET / PUT / DELETE /relay/v1/key` | player token | see (provider + last 4 characters), store, forget the player's key |
| `POST /relay/v1/think` | player token + `X-Callsign-Seat` | one thought on the player's key |
| `POST /relay/v1/decide` | player token + `X-Callsign-Seat` | one decision on the game's own key ([[Fast Brain - Jev]]) |
| `GET /relay/healthz` | none | `{ ok, providers, decide: { on, model } }` |

Every answer carries `X-Request-Id`, `Cache-Control: no-store` and `nosniff`. A call with an `Origin` header is allowed only from the same host or from an origin listed in `-origins`.

## One thought (`think`)

1. Read at most 512 KB and rebuild the request field by field (`parseThink`): unknown fields are refused at the top level and in tools, and dropped inside message blocks. **There is no model, token cap or address in a request**; the relay decides those.
2. Per-seat limit (`limiter.begin`).
3. Ask the game server: `GET /internal/tier?room=&side=&squad=` with the seat token. 403 / 404 mean "not your seat"; the answer is never cached, so an upgrade changes the model on the next thought and a seat that is gone stops thinking at once.
4. Read the stored key for this player; pick `models.providers[<provider>][<tier or "operator">]`, the effort for that tier, and `maxTokens`.
5. Call the provider. On `overloaded`, wait (0.6 to 1.2 s, or what the provider asked, at most 4 s) and try once more.
6. Answer `{ content, stop_reason, usage, model, provider }`.

The whole thought, retry included, has 75 s.

### Request limits (`relay/wire.go`)

| Limit | Value |
|---|---|
| request body | 512 KB |
| system prompt | 64 KB |
| tools | 32, each schema 16 KB |
| messages | 400, each up to 64 blocks |
| one text | 128 KB |
| a kept thinking / state block | 256 KB |

### Rate limits (`relay/limits.go`)

A "seat" here is one player token; all that player's agents share it.

| | `DefaultLimits` (think) | decide (per seat) |
|---|---|---|
| in flight at once | 8 | 4 |
| per minute | 120 | 60 |
| burst | 30 | 20 |
| key reads / writes per minute | 20 | n/a |

At most 50 000 seats are counted at once; a flood of made-up tokens cannot be served because unsigned tokens are refused before anything is counted.

### Error codes

`no_key` (428), `bad_key` (424), `rate_limited` (429, with `Retry-After`), `provider_error` (502 / 503 / 504), `not_your_seat` (401 / 403), `bad_request` (400 / 405 / 413), `decide_off` (503, decide route only).

## Providers (`relay/provider/`)

The game's request shape follows Anthropic's Messages API because the agents were written against it; every other provider is translated to and from it.

| Name | API used | Notes |
|---|---|---|
| `anthropic` | Messages API | effort via `output_config`; thinking, redacted-thinking and fallback blocks go back unchanged; server-side fallback beta except on Haiku |
| `openrouter` | Chat Completions | system role `system`, cap field `max_tokens` |
| `openai` | Chat Completions | system role `developer`, cap field `max_completion_tokens`, strict tool schemas passed on |
| `gemini` | Interactions API, stateless | thought steps and their signatures travel in a `relay_state` block |
| `typesafe` | decision endpoint | a `Decider`, not a `Provider`: options in, one choice with probabilities out |

Each provider can reach **exactly one address**, written into the package. Nothing a caller sends chooses the address, redirects are never followed (a redirect would carry the key's header elsewhere), and no proxy is taken from the environment.

The tier-to-model table is in [[Claude Brain and Player Keys]]. `LoadModels` fails at start if any provider lacks a model for any tier in the rules.

## Logging

One line per thought: request id, the first 8 characters of the seat hash, room, side, role, squad, tier, provider, model, token counts, milliseconds and the outcome. Never what was said, never a key or a token (`TestTheLogSaysWhoAndHowMuchNeverWhat`).

## Flags

`-addr`, `-game`, `-data`, `-origins`, `-max-keys` (10 000), `-jev-daily-usd` (2), `-jev-per-minute` (1200), `-jev-seat-per-minute` (60), `-jev-model`. Environment: `CALLSIGN_RELAY_MASTER_KEY`, `CALLSIGN_AGENT_KEY`, `CALLSIGN_JEV_KEY`, `CALLSIGN_PRIVATE` ([[Environment Variables]]).

## Tests

`make relay-test` runs `go test -race ./relay/... ./shared/...` with the network off; every provider is played by a fake transport. `TestTheWholePathToEachProvider` drives all four end to end.

## Differs from the docs

Differs from `CLAUDE.md` ("calls the provider with the player's own key"): the `decide` route spends the game's own key, the recorded exception. `docs/PLAN.html` also promises one-click OpenRouter sign-in; the relay only takes a pasted key.

## Related

- [[Brains and Agents]]
- [[Key Handling]]
- [[Claude Brain and Player Keys]]
- [[Fast Brain - Jev]]
- [[Private Machine Guard]]
- [[Seats, Tokens and Trust]]
- [[HTTP API]]
- [[Docker Compose Services]]
- [[Make Targets]]
- [[Ranks and Brain Tiers]]
- [[Decision - Model Relay]]
