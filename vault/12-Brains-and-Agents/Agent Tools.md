---
title: Agent Tools
description: "Agents can change the match only by calling game tools over their WebSocket; the server checks every call against the caller's role and the simulation."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/mixed
  - area/brains-and-agents
  - topic/brains
  - topic/tools
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Direct Acts]]"
  - "[[Strike Aircraft]]"
  - "[[Sorties]]"
  - "[[Initiative - Orders, Fight and Purse]]"
  - "[[Places on the Radio]]"
  - "[[Traffic Levels]]"
  - "[[Brains and Agents]]"
  - "[[Agent Loop]]"
  - "[[Operator - Anvil]]"
  - "[[Squad Leaders]]"
paths:
  - agents/tools.mjs
  - server/room/tools.go
  - server/room/command.go
  - agents/aircraft.mjs
  - CLAUDE.md
---

# Agent Tools

Agents can change the match only by calling game tools over their WebSocket; the server checks every call against the caller's role and the simulation. `agents/tools.mjs` only describes the tools to a model; `server/room/tools.go` owns what each one does.

## Who may call what (server side)

`allowed` in `server/room/tools.go`:

| Role | Tools |
|---|---|
| `squad` | `radio`, `report`, `move`, `hold`, `attack`, `capture`, `repair`, `fortify`, `plant`, `seize` |
| `anvil` | `radio`, `report`, `buy`, `command`, `build`, `haul`, `cancel`, `rally`, `sell`, `repair` |
| `hammer`, spectators | none (the commander's direct acts are separate frames, see [[Direct Acts]]) |

`move`, `hold`, `attack` and the squad's `repair` always act on the caller's own squad. `repair` means different things by role: the operator pays to mend a structure; a squad walks to it.

## What a leader is offered (agent side)

`leaderToolsFor(unit)` builds the list from the unit's numbers in `shared/rules.json`, so a model is never shown a tool its squad cannot use:

| Tool | Offered when | Parameters |
|---|---|---|
| `radio` | always | `to` (callsigns), `body`, `end` (`over` / `out`), `kind` (`contact`, `objective`, `loss`, `status`, `ack`) |
| `report` | always | none |
| `move` | always | `place` |
| `hold` | always | `place` (`"here"` holds the ground the squad is on) |
| `attack` | always | `place` or `contact` (enemy squad id); fill one |
| `capture` | `unit.captureSeconds > 0` (engineers) | `place` (a structure id such as `s7`, or its name) |
| `repair` | `unit.repairPerSecond > 0` or `captureSeconds > 0` | `place` (a bridge; for engineers also an own damaged structure) |
| `fortify` | infantry on land, not a hero | none (dig a sandbag position) |
| `plant` | `unit.chargeDamage > 0` (a hero) | `place` (enemy structure, bridge, or enemy HQ point) |
| `seize` | `unit.seizeRadius > 0` (a hero) | `contact` (an enemy vehicle squad) |

### Strike aircraft

A unit with `bombs > 0` gets `strikeTools` instead: the same three order tools with other meanings (`server/sim/sortie.go`).

| Tool | Meaning for a strike squad |
|---|---|
| `attack` | fly a strike: all bombs in one pass, then home to rearm; `place` or `contact` (never an aircraft) |
| `move` | fly over a place and straight home, nothing dropped, to look |
| `hold` | break off and return to the airbase; any place but `"here"` is refused |

See [[Strike Aircraft]] and [[Sorties]].

## What the operator is offered

`operatorTools`:

| Tool | Parameters | What it does |
|---|---|---|
| `radio` | as above | speak to Hammer or squads |
| `report` | none | the operator's status (every wake already shows it) |
| `build` | `structure`, `place`, `place2`, `run` | start a structure; `place2` for a fence between two places; `run` is `north-south`, `east-west`, `northeast-southwest`, `northwest-southeast` or `""` |
| `buy` | `unit` or `upgrade` | raise a new squad, or raise a squad's brain tier (callsign) |
| `command` | `mode` (`orders` / `fight`), `buy` (boolean) | record that Hammer gave or took the fight or the purse in words of their own |
| `cancel` | `unit` | take the last unit of a kind out of its production line |
| `rally` | `place`, `structure` | where new units gather; `"home"` resets |
| `haul` | `field`, `hauler` | send gold haulers to a field, or `"auto"` |
| `sell` | `place` | sell one own structure |
| `repair` | `place` | pay to mend one own structure |

The server enforces the fight and the purse on these tools (`server/room/command.go`): see [[Initiative - Orders, Fight and Purse]].

## Places

A `place` is one string the server resolves (`rm.place` in `server/room/build.go`): a map point by id or any name (`F`, `Foxtrot`, `פסל`, `the town`), a landmark or bridge by id or name, a structure by id or name, `<bearing> of <point> [<metres>]`, or an exact spot (`N350 E30 of D`, or the order's own words). Words that fit more than one landmark return `ErrWhichPlace` ("which one"), and the agent answers "Say again" naming them. See [[Places on the Radio]].

## Schema details

- Every tool is declared `strict: true` with all properties required and no extras. Strict schemas force a model to send empty placeholders; `normalize(name, input)` drops `""`, `0` and `null`, turns `hold` at `"here"` into a hold with no place, and keeps `command.buy === false` (that false is the point).
- The radio `kind` lets the net decide how much Hammer is shown ([[Traffic Levels]]). The net writes the "<to>, this is <from>" call and the closing word itself; the body is only the message.

## Differs from the docs

Differs from `CLAUDE.md`, which lists the tools as `radio`, `move`, `hold`, `attack`, `report`, `buy` (operator only): bases, the economy, heroes and aircraft added `build`, `command`, `cancel`, `rally`, `haul`, `sell`, `repair`, `capture`, `fortify`, `plant` and `seize`.

## Related

- [[Brains and Agents]]
- [[Agent Loop]]
- [[Operator - Anvil]]
- [[Squad Leaders]]
- [[Prompts]]
- [[Places on the Radio]]
- [[Initiative - Orders, Fight and Purse]]
- [[Direct Acts]]
- [[Structures and Build Tree]]
- [[Heroes]]
- [[Decision - Agents and Tools]]
