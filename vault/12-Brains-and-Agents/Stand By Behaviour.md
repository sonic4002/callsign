---
title: Stand By Behaviour
description: "'Stand by' means two different things around the agents: the radio proword an agent sends when its answer is taking long, and a host that is connected but not running a side."
type: concept
status: current
tags:
  - type/concept
  - status/current
  - agent/CLD
  - origin/code
  - area/brains-and-agents
  - topic/brains
  - topic/radio
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Agent Telemetry]]"
  - "[[Where Agents Run]]"
  - "[[Procedure Words]]"
  - "[[Brains and Agents]]"
  - "[[Agent Loop]]"
  - "[[Claude Brain and Player Keys]]"
  - "[[Fast Brain - Jev]]"
  - "[[Traffic Levels]]"
paths:
  - agents/agent.mjs
  - agents/host.mjs
  - agents/brain-jev.mjs
  - agents/telemetry.mjs
  - agents/test/e2e.test.mjs
  - agents/test/jev.test.mjs
  - client/brains/monitor.js
  - client/brains/host.js
  - server/room/host.go
  - shared/rules.json
---

# Stand By Behaviour

"Stand by" means two different things around the agents: the radio proword an agent sends when its answer is taking long, and a host that is connected but not running a side. This note covers both, and what happens when a thought fails altogether.

## 1. "Stand by" on the radio (המתן)

When a radio call wakes an agent whose brain is slow, a timer starts. If no `radio` tool call has gone out after `standByMs` (**12 seconds**), the agent transmits to the caller:

> Hammer, this is Viper 2. Stand by. Out.

Body from the `standBy` table in `agents/agent.mjs`: "Stand by" in English, "המתן" in Hebrew, chosen by the net language. It ends with Out and has no `kind`.

Rules:

- Only for a wake that contains a **call** (events never get one).
- Only for a **slow** brain: `brain.slowFor({ role, tier })` if the brain has it, else `brain.slow`.
- At most once per wake, and never after the agent has already answered.
- The timer is cleared when the wake ends, whatever the outcome.

| Brain | `slow` | Says "Stand by" |
|---|---|---|
| `rule` | false | never |
| `jev` | false | never ("the answer is there in a moment") |
| `relay` | true | yes |
| `claude` | true | yes |
| `subscription` | true | yes |
| `tiered` (fast + relay) | per station: tier-1 squads false, everything else true | only stations on the language model |

### Why 12 seconds

It was 2.5 s. Commit `5e2ae00` (2026-11-26): "A slow brain sent 'Stand by' 2.5 s into every thought, so nearly every answer came with an extra line on the net. It now waits 12 s." The page already shows who is thinking (the header lamps, see [[Agent Telemetry]]), so only a long wait is worth a line on the net.

`standByMs` is a constructor option of `Agent` and `Host`; the end-to-end test sets it to 50 ms to hear the line, other tests to 60 s to keep it quiet.

The agent's telemetry records it (`standBy: true`), and the AI view shows "said Stand by" beside a thinking station.

## 2. A host standing by

A host whose `hello` says `active: false` runs no agents: another host has the side (`agents/host.mjs`, `server/room/host.go`). It keeps its control connection and takes over when the server greets it again with `active: true`. In the browser the AI dialog shows this as "This browser is standing by: another one is already running your squads." See [[Where Agents Run]].

## 3. When there is no answer at all

"Stand by" is not followed by a guarantee. If the thought fails (provider error, relay unreachable, limit, refusal by the model):

- the wake is **skipped**; the squad keeps its last order and its fireteams keep fighting;
- telemetry goes to state `skipped` with a reason code;
- the next wake tries again from a fresh conversation;
- for trouble only the player can fix (`no_key`, `bad_key`, `not_your_seat`) the browser hands the side back to the server machine's agents.

The fast brain never leaves a gap: when the relay cannot decide within 2.5 s it answers as the rule brain would.

## Related procedure words

The server's radio net also recognises "stand by" / "standby" / "המתן" as a proword when a station says it (`radio.prowords.standBy` in `shared/rules.json`). See [[Procedure Words]].

## Related

- [[Brains and Agents]]
- [[Agent Loop]]
- [[Agent Telemetry]]
- [[Where Agents Run]]
- [[Claude Brain and Player Keys]]
- [[Fast Brain - Jev]]
- [[Procedure Words]]
- [[Traffic Levels]]
