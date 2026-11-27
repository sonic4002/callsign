---
title: Fast Brain - Jev
description: "The fast brain is the rule brain with a decision model behind it for the orders its grammar cannot place."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/mixed
  - area/brains-and-agents
  - topic/brains
  - topic/jev
  - topic/fast-brain
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Decision - Brains without a Player Key]]"
  - "[[Command Grammar]]"
  - "[[Private Machine Guard]]"
  - "[[Brains and Agents]]"
  - "[[Rule Brain]]"
  - "[[Model Relay]]"
  - "[[Key Handling]]"
  - "[[Where Agents Run]]"
  - "[[Seats, Tokens and Trust]]"
  - "[[Environment Variables]]"
paths:
  - agents/brain-jev.mjs
  - agents/test/jev.test.mjs
  - relay/decide.go
  - relay/decide_test.go
  - relay/provider/typesafe.go
  - relay/cmd/relay/main.go
  - relay/game.go
  - server/room/hub.go
  - server/room/brains_test.go
  - server/cmd/callsign/main.go
  - client/brains/policy.js
  - shared/models.json
  - docs/research/2026-11-24-jev-decision-model.md
  - .env.example
  - CLAUDE.md
---

# Fast Brain - Jev

The fast brain is the rule brain with a decision model behind it for the orders its grammar cannot place. The model is Jev (TypeSafe): it writes nothing, it picks one option from a list and gives each a probability, in about a quarter of a second, and it runs on the game's own key held by the relay.

It is the one exception to "the player's own key pays" (owner's decision, 2026-11-24; see [[Decision - Brains without a Player Key]]).

## Flow of one order

1. The call is read by the [[Command Grammar]] first. A taught sentence never reaches the model.
2. Only when the grammar returns `unclear`, and the call came from Hammer or Anvil, `optionsFor` lists what this squad could be ordered to do right now: for every reachable point move / hold / attack; up to 8 contacts in sight; up to 4 landmarks the call's words fit; up to 4 enemy structures (attack, and capture for engineers); fall back; take cover; stop here; dig in (if it can); report. At most 62 options plus `say_again`. Only things the squad can do are offered, so the model cannot choose what the game would refuse.
3. The agent posts to the relay: `POST /relay/v1/decide` with `{ room, side, squad, situation, call, question, options }`, the player token as bearer and the seat token in `X-Callsign-Seat`. The call body is cut to 600 characters.
4. `choose(answer, options, threshold)`: if the top option has probability >= **0.67** (`THRESHOLD`, the vendor's example value) it becomes the intent. Otherwise the squad says "Say again", naming up to two options that got >= 0.12 ("Say again: hold Foxtrot or move to Foxtrot?"). If nothing is close, the grammar's own answer stands.
5. The intent is carried out exactly as the grammar's would be (`carryOut` of the rule brain): one tool call and a fixed phrase. **The model never writes on the net.**

Events (contact, pinned, arrived ...), radio checks, calls from other squads and everything Anvil does are settled by code and never use the model. Anvil on the fast brain is the rule brain's operator; the AI view says so (`nameFor`).

## When the relay cannot decide

No key, the day's ceiling, a limit, no network, a timeout (the agent waits **2.5 s**): the squad answers as the rule brain would, without a word about it. After a `decide_off` answer the brain leaves the relay alone for **60 s**.

## What protects the game's key (`relay/decide.go`)

| Guard | Value |
|---|---|
| Player token | must be one the relay signed, as on every route |
| Seat check | the game server must confirm the seat token commands that squad in a live room **with seats** (`Game.Vouch`; `/internal/tier` answers `seated`). The open room of a server without an agent key is never vouched for (commit `6c6247d`) |
| Per-seat rate | 4 in flight, 60 a minute, burst 20 (`-jev-seat-per-minute`) |
| Whole-relay rate | 1200 a minute, burst 120 (`-jev-per-minute`) |
| Request size | body 24 KB; situation 12 KB; call 600 bytes; question 400; 2 to 64 options; option name `[A-Za-z0-9_.:-]{1,48}`; description 300 |
| Daily ceiling | 2 USD a day (UTC) by default (`-jev-daily-usd`, `CALLSIGN_JEV_DAILY_USD`); negative turns it off. Each call is reserved at an estimate (`len(body)/2 + 300` tokens) before it is made and settled afterwards; price assumed 0.042 USD per million input tokens. The day's spend is kept in `jev-spend.json` in the relay's data directory |
| Model | pinned by the relay: `jev-1.14.0` (`shared/models.json`, `decision.typesafe`); a caller cannot name one |
| Address | one fixed provider address in `relay/provider/typesafe.go`; redirects never followed |
| Private guard | the key is used only when `CALLSIGN_PRIVATE=1` ([[Private Machine Guard]]) |
| Timeout | 8 s inside the relay |

Past the ceiling, or with no key, the route answers `decide_off` (HTTP 503). A wrong game key also reads as `decide_off`: nothing a player can do, nothing to tell them. `GET /relay/healthz` says only `decide: { on, model }`.

## Turning it on

| Where | How |
|---|---|
| Relay | `CALLSIGN_JEV_KEY` set and `CALLSIGN_PRIVATE=1`; otherwise the route is off |
| Server default | `-fast-brain` flag (`CALLSIGN_FAST_BRAIN`), default false |
| Per match | the lobby's `fast` option; the maker may turn it on or off whatever the default. A lesson never uses it |
| Test addresses | the page's `?fast` and `?anvil=N` query parameters (commit `077a83b`) |

The fast brain runs **in the player's browser**: `wanted()` in `client/brains/policy.js` returns `"jev"` when the match has `fast`, the relay's health says the route is on, and the player holds a seat. The server machine's Node host never runs it (`agents/main.mjs` knows only `rule`, `claude`, `subscription`).

With a player's key also stored, `tiered({ fast, rest })` gives **tier-1 squads** to the fast brain and keeps the language model for Anvil and tiers 2 and 3.

## Measured

From `docs/research/2026-11-24-jev-decision-model.md` section 6 (150 orders, 148 live decisions, `jev-1.14.0`, threshold 0.67; not re-run for this note):

| | right | "Say again" | acted wrongly |
|---|---|---|---|
| grammar alone | 138 (92%) | 12 | 0 |
| Jev alone | 117 (78%) | 28 | 5 |
| grammar, then Jev | 142 (95%) | 8 | 0 |

Latency as the browser sees it: median 222 ms, nine in ten under 268 ms, worst 777 ms. A request held 34 options and about 1,680 input tokens, about 0.007 US cents.

Caveats the research records: the order set was written by the grammar's author; the damaged orders imitate recogniser errors and are not recordings; the vendor publishes no rate limits or uptime commitment; the threshold should be set on recorded orders from real matches.

## Tests

`agents/test/jev.test.mjs` (taught sentences never reach the model; threshold; fallback; `tiered`), `relay/decide_test.go` (key and pinned model, seat of a live room only, size caps, both rate limits, the ceiling, off without a key).

## Related

- [[Brains and Agents]]
- [[Command Grammar]]
- [[Rule Brain]]
- [[Model Relay]]
- [[Key Handling]]
- [[Private Machine Guard]]
- [[Where Agents Run]]
- [[Seats, Tokens and Trust]]
- [[Environment Variables]]
- [[Decision - Brains without a Player Key]]
- [[Open Questions]]
