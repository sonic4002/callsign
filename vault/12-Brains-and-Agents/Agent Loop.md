---
title: Agent Loop
description: "Agent in agents/agent.mjs is one station: the operator or one squad leader."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/code
  - area/brains-and-agents
  - topic/brains
  - topic/agents
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Prompts]]"
  - "[[Agent Tools]]"
  - "[[Report Suppression]]"
  - "[[Stand By Behaviour]]"
  - "[[Tests and Headless Matches]]"
  - "[[Brains and Agents]]"
  - "[[Where Agents Run]]"
  - "[[Agent Telemetry]]"
  - "[[Operator - Anvil]]"
  - "[[Squad Leaders]]"
paths:
  - agents/agent.mjs
  - agents/link.mjs
  - agents/tools.mjs
  - agents/test/e2e.test.mjs
  - agents/test/units.test.mjs
---

# Agent Loop

`Agent` in `agents/agent.mjs` is one station: the operator or one squad leader. It sleeps until a radio call or an event wakes it, asks its brain for tool calls in up to six turns, runs them through the game server, and goes back to sleep.

The same file runs unchanged in Node and in a Web Worker; nothing it imports may use a Node-only module.

## Connection

`Link` (`agents/link.mjs`) is one WebSocket to the game server. The agent joins with `role=anvil` or `role=squad&squad=<id>`, `state=0` (no snapshot stream) and its host's id. Frames come in; tool calls go out as `{type:"tool", id, name, args}` and resolve with the matching `{type:"result"}`.

On the `hello` frame (`#greet`) the agent takes the rules, its station, faction, the lobby's Anvil level, the last eight transmissions, and the net language. It builds its system prompt and tool list ([[Prompts]], [[Agent Tools]]). A call made in the last 15 seconds before it joined, and addressed to it, is queued so a commander who orders at once is not met with silence.

## What wakes an agent

| Frame | Squad leader | Operator |
|---|---|---|
| `radio` addressed to it (see `callsFor`) | wake | wake of its own if from Hammer; otherwise read together as "heard" |
| `radio` not addressed to it | ignored | queued as "heard" (the operator hears the whole net) |
| `radio` with `kind: "ack"` (bare Roger / Wilco) | n/a | ignored, stays in traffic |
| `radio` with `cue` (a base cue) | ignored | ignored |
| `event` | `contact`, `pinned`, `losses`, `arrived`, `garrisoned`, `fortified`, `charge_planted`, `crushed`, `strike`, `overhead`, `rearmed`, for its own squad only | `squad_lost`, `point_lost`, `hq_under_attack`, `structure_lost`, `structure_captured`, `structure_attacked`, `structure_built`, `hauler_attacked`, `hauler_lost`, `bridge_under_attack`, `bridge_fell`, `bridge_repaired`, `building_fell`, `low_power`, `power_restored`, `structure_repaired`, `repair_stopped`, `hero_fell` |
| `direct` (Hammer acted by hand) | nobody woken; a leader whose squad was ordered by hand notes it is on Hammer's order | added to traffic as "(no call) Hammer, by hand, ..." |
| `netlang` | sets the net language | same |
| `event` `match_end` | inbox cleared, no more wakes | same |

`callsFor(m, me)`: a transmission is a call for a station when it is addressed to it or to all stations, is not its own, is not a cue, and either ends with Over or comes from Hammer or the operator (those two may end an order with Out).

A `contact` event the net marks `known` (another squad met that enemy first) does not wake a leader whose thought costs a model call; a free brain is still woken and acts in silence. See [[Report Suppression]].

### The quiet timer (operator only)

Every `quietMs` (30 s) `#lookUp` checks whether the operator holds the initiative and has something only it can do: `command.mode === "fight"` with a squad on order `none`, or `command.buy` with gold for the cheapest armed unit and room under the population cap. If so it queues a `quiet` event. An operator on Hammer's orders is never woken by this.

## Queue and pump

- One wake at a time (`busy`). News arriving while thinking is handled in the next wake.
- A wake takes everything in the inbox **up to and including the first radio call**; a second call waits for its own wake. Three purchases asked in a burst are three purchases, each answered (commit `942b473`).
- An operator whose brain costs money gathers non-call items for `gatherMs` (1.5 s) before waking, so eight squads reporting in two seconds are one wake. A call is never held.

## One wake (`#wake`)

1. Call the `report` tool for fresh status. If the squad's tier changed, drop the conversation (new model).
2. Set the language: the net language, else the call's.
3. Push one user message built by `renderWake`: a line per item, the net-language reminder, `Status: {compact JSON}`, and the last eight transmissions.
4. If the call's brain is slow, arm the stand-by timer ([[Stand By Behaviour]]).
5. Up to **6 turns**: `brain.think(...)`; run each `tool_use` through the server (`normalize` strips the empty placeholders strict schemas force); push the results back as a `tool_result` user message. A turn with no tool call ends the wake. A `refusal` stop reason ends it too.
6. A thrown error skips the wake: the squad keeps its last order and the fireteams fight on. `onTrouble` tells the host.
7. The conversation is dropped when the wake did not finish cleanly or after `wakesPerConversation` (15) wakes. The status and traffic carry what matters.

## Constants

| Name | Value | Meaning |
|---|---|---|
| `standByMs` | 12 000 ms | wait before "Stand by" |
| `wakesPerConversation` | 15 | wakes before the history is reset |
| `quietMs` | 30 000 ms | operator's look-up interval |
| `gatherMs` | 1 500 ms | paying operator's gathering window |
| turns per wake | 6 | hard cap in `#wake` |
| traffic kept | 8 lines | shown in every wake |

## What the brain is given

`agent`: `{ role, side, squad, tier, station, lang, commander, unit, level? }` (`level` only for Anvil when the lobby set one). `wake`: `{ items, status, call, traffic }` with the raw status; model brains read the compact form in the message text (`compactStatus`), rule-based brains read `wake` directly.

## Tests

`agents/test/e2e.test.mjs` runs a real server binary (`CALLSIGN_BIN`) with scripted agents end to end; `agents/test/units.test.mjs` covers the loop's pieces. See [[Tests and Headless Matches]].

## Related

- [[Brains and Agents]]
- [[Agent Tools]]
- [[Prompts]]
- [[Stand By Behaviour]]
- [[Where Agents Run]]
- [[Agent Telemetry]]
- [[Operator - Anvil]]
- [[Squad Leaders]]
- [[WebSocket Frames]]
- [[Report Suppression]]
- [[Net Language]]
