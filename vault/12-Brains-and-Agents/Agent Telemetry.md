---
title: Agent Telemetry
description: "Each agent tells its own commander which model thinks for it, how big its context is, and what it is doing right now."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/code
  - area/brains-and-agents
  - topic/brains
  - topic/telemetry
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Claude Brain and Player Keys]]"
  - "[[Brains and Agents]]"
  - "[[Agent Loop]]"
  - "[[Stand By Behaviour]]"
  - "[[Where Agents Run]]"
  - "[[Subscription Brain]]"
  - "[[WebSocket Frames]]"
  - "[[Page Layout]]"
  - "[[Settings]]"
paths:
  - agents/telemetry.mjs
  - agents/agent.mjs
  - agents/test/telemetry.test.mjs
  - server/room/telemetry.go
  - server/room/telemetry_test.go
  - server/room/room.go
  - client/brains/monitor.js
  - client/brains/monitor.test.mjs
  - client/i18n/en.json
---

# Agent Telemetry

Each agent tells its own commander which model thinks for it, how big its context is, and what it is doing right now. The game server relays that report to that side's commander only and never reads it; nothing an agent says about itself can change the game.

A report never carries the prompt, the model's reasoning, or any key.

## Path

```
Agent (Telemetry)  --{type:"telemetry", telemetry:{...}}-->  game server (Room.Report)
game server        --{type:"telemetry", agent:{squad, station, online, telemetry}}-->  that side's Hammer connections
page               --> the AI dialog's "Live" pane and one lamp per agent in the header
```

The agent uses the WebSocket it already has. The page's side is `client/brains/monitor.js`.

## The report (`agents/telemetry.mjs`, `v: 1`)

| Field | Meaning |
|---|---|
| `role`, `squad`, `tier` | which station; squad 0 is the operator |
| `brain` | `rule`, `jev`, `relay`, `claude` or `subscription` (per station, so a tiered brain names the right one) |
| `where` | `server` or `browser` |
| `model`, `planned` | the model that answered last; before the first thought, the one the brain plans to use (`rule-2`, `jev+rule-1`, `claude-haiku-5-5` ...) |
| `state`, `since` | `idle`, `thinking`, `acting`, `skipped`, `stopped`, and when it began |
| `woke` | what woke it: `{kind: "call", from}`, `{kind: "event", event}` or `{kind: "heard", from}` |
| `tool` | the tool being run while `acting` |
| `standBy` | it has said "Stand by" in this wake |
| `reason` | for `skipped` / `stopped`: `{code, text}`; codes such as `rate_limited`, `bad_key`, `timeout`, `unreachable`, `failed`, or the relay's own |
| `context` | `{input, cached, window}`: tokens of the last request (cached part included), how much came from cache, the model's window |
| `output` | tokens of the last answer |
| `talk` | `{messages, wakes, limit, resetAt, resetWhy}`: the conversation's length and why it was last reset (`match`, `wakes`, `tier`, `unfinished`) |
| `totals` | `{thoughts, input, output, cached, ms, lastMs}` for the match |
| `actions` | the last 5 tool calls in a few words ("hold F", "radio Hammer: Wilco", "buy tank") with whether each was accepted |
| `said` | the last radio body, up to 160 characters |
| `seq`, `at` | a counter and the agent's own clock, so durations do not depend on the reader's clock |

Unknown numbers stay `null`, never zero. The rule brain reports no usage: its row names no AI model and counts no tokens.

### Context window

`windowOf(model, given)`: what the response said (only the subscription brain's does), else the `WINDOWS` table, else unknown. The table lists `claude-haiku-5-5`, `claude-sonnet-5-5` and `claude-opus-5-5` at 1,000,000 tokens each; the file cites the provider's model reference, read 2026-11-24. OpenRouter-style ids are normalised first. Models of other providers show "window unknown".

### When reports are sent

Only a **change of state** is sent; numbers ride on the change that follows them. Reports are at least `gapMs` (150 ms) apart; a change inside the gap is sent when the gap has passed. `stopped` is sent at once, because there may be no later.

## The server's part (`server/room/telemetry.go`)

| Rule | Value |
|---|---|
| Who may report | only `anvil` and `squad` connections (`ErrNotAnAgent`) |
| Size | one JSON object of at most 4096 bytes (`ErrBadTelemetry`) |
| Flood control | burst of 8 per connection, one more every 50 ms; excess is dropped silently |
| Kept | the latest report per station, per side |
| Sent to | that side's `hammer` connections; never the other side, spectators or other agents |
| After the match ends | nothing is kept; a `{type:"telemetry", ended:true}` frame tells the page |
| Agent disconnects | the row stays, marked `online: false`, until another agent takes the station |
| Squad lost | the report is dropped and `{squad, gone:true}` is sent |

A commander who joins late gets the current list in the `hello` frame's `agents` field.

## What the player sees

- **Header lamps**: one per agent, showing its state (commit `95b16cb` moved them from a sidebar panel to the header).
- **AI dialog, "Live" pane**: a row per station with model (or "planned"), a context bar true to scale, state with its running time, what woke it, conversation ("wake 3 of 15", last reset and why), match totals with average and last thought time, the last actions, and "said Stand by".
- **One line for the side**: agents on the net, thinking now, thoughts, tokens in and out.
- States shown: no report yet, idle, thinking, acting, skipped a wake, stopped, off the net, match over.

The second pane of the same dialog is the player's key ([[Claude Brain and Player Keys]]).

## Tests

`agents/test/telemetry.test.mjs` (context sizes, windows, report order and gap, reset reasons, a report reaching only its own commander through a real server, and the browser timer case); `server/room/telemetry_test.go`; `client/brains/monitor.test.mjs`.

## History

- `34ac123` agents report model, context size and state; the server relays to their own commander only.
- `d44723c` reports carry the agent's own clock and the caller's name in both languages.
- `ec46ec7` the live view in the page.
- `e1ccf83` a bug that stopped every page-run agent from thinking: telemetry stored `setTimeout` bare and called it as a method, which a browser refuses ("Illegal invocation"). The timers are now wrapped, and a test holds it.

## Related

- [[Brains and Agents]]
- [[Agent Loop]]
- [[Stand By Behaviour]]
- [[Where Agents Run]]
- [[Subscription Brain]]
- [[WebSocket Frames]]
- [[Page Layout]]
- [[Settings]]
