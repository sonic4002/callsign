---
title: Operator - Anvil
description: "Anvil (סדן) is the operator: the player's staff officer on the net."
type: concept
status: current
tags:
  - type/concept
  - status/current
  - agent/CLD
  - origin/code
  - area/brains-and-agents
  - topic/brains
  - topic/operator
  - topic/anvil
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Agent Tools]]"
  - "[[Initiative - Orders, Fight and Purse]]"
  - "[[Agent Loop]]"
  - "[[Base Cues]]"
  - "[[Radio versus Direct Acts]]"
  - "[[Command Net and Squad Net]]"
  - "[[Rule Brain]]"
  - "[[Brains and Agents]]"
  - "[[Prompts]]"
  - "[[Squad Leaders]]"
paths:
  - agents/agent.mjs
  - agents/prompts.mjs
  - agents/rule-operator.mjs
  - agents/tools.mjs
  - server/room/command.go
  - server/room/lobby.go
  - shared/rules.json
---

# Operator - Anvil

Anvil (סדן) is the operator: the player's staff officer on the net. It turns Hammer's (פטיש) intent into tasks for squad leaders, runs the base and the purchases when allowed, and sums the fight up for Hammer.

There is one operator per side, station key `operator`, squad id 0. It never moves a squad itself: it speaks to leaders by radio and they act.

## What it can do

Its tools are `radio`, `report`, `build`, `buy`, `command`, `cancel`, `rally`, `haul`, `sell`, `repair` ([[Agent Tools]]). What it may do *on its own* is limited by two permissions the room holds per side and enforces ([[Initiative - Orders, Fight and Purse]]):

| Permission | Status field | Off (how a match starts) | On |
|---|---|---|---|
| The fight | `command.mode` | `orders`: gives no squad a task of its own | `fight`: retasks squads and sends help |
| The purse | `command.buy` | spends only when Hammer just asked (`purchaseOrdered`) | buys, builds, sells and repairs on its own judgement |

Fixed phrases in `shared/rules.json` (`radio.command`) switch these by code: "run the fight" / "נהל את הקרב" gives both; "I have command" / "הפיקוד אצלי" takes both back; "you may buy" / "מותר לך לקנות" gives the purse; "do not buy" / "אל תקנה" takes it back. The `command` tool covers any other wording. A lobby option can also start the match with the purse given.

Squads Hammer ordered by name appear in status as `hammerOrdered`; Anvil gives them no task until it is handed the fight afresh (commit `cc77d6d`).

## How it differs from a leader in the loop

- It **hears the whole net**. Only Hammer's call to it gets a wake of its own; squads' reports are read together; a bare Roger / Wilco wakes nobody ([[Agent Loop]]).
- It is woken on a quiet map every 30 s if it holds the initiative and has an idle squad or spare gold.
- A paying operator gathers a burst of traffic for 1.5 s before thinking.
- Base news (construction complete, low power, hauler lost ...) is told to Hammer by the server's fixed lines in Anvil's name ([[Base Cues]]). Anvil does not repeat them, and a cue wakes nobody.
- When Hammer builds, buys or orders by hand, Anvil sees a `direct` frame as traffic "(no call) Hammer, by hand, ..." and plans around it without answering ([[Radio versus Direct Acts]]).

## Summing up for Hammer

Squads report on the squad net; Hammer hears the command net ([[Command Net and Squad Net]]). Anvil tells Hammer of a fight once when it starts (`kind: "contact"`) and once when it ends or changes (`objective` or `loss`), never one line per squad.

## Which brain

| Situation | Anvil's brain | Model shown |
|---|---|---|
| Default, no keys | rule brain at the match's level | `rule-1` / `rule-2` / `rule-3` |
| Match on the fast brain | still the rule brain (Jev cannot plan or write) | `rule-N` |
| Player's key on the relay | the provider's `operator` model from `shared/models.json`, effort `medium` | e.g. `claude-opus-5-5` |
| Owner's machine, `claude` or `subscription` brain | `claude-opus-5-5`, or `CALLSIGN_OPERATOR_MODEL` | that id |

`CALLSIGN_OPERATOR=0` on the agent host plays with no Anvil at all.

### The rule-brain Anvil's level

Set per match in the lobby (`anvil`, 1 to 3), else by the server's `-anvil-level` flag / `CALLSIGN_ANVIL_LEVEL`, default 3:

| Level | Does |
|---|---|
| 1 | carries out orders only |
| 2 | with the purse, also keeps the economy going: the opening, power, haulers, replacement squads |
| 3 | with the fight, also runs it: takes and holds points, guards haulers, comes home to a base under attack, masses before attacking, sends strike aircraft |

Asked for more than its level allows it answers "Negative" with `why.ordersOnly` or `why.economyOnly`. Details in [[Rule Brain]].

## Match end

On `match_end` the agent clears its inbox and takes no more wakes. The last transmission, Anvil telling its commander the result, is written by the server itself (`signOff` in `server/room/room.go`, lines from `radio.signOff` in `shared/rules.json`), not by the agent.

## Related

- [[Brains and Agents]]
- [[Agent Loop]]
- [[Agent Tools]]
- [[Rule Brain]]
- [[Prompts]]
- [[Squad Leaders]]
- [[Initiative - Orders, Fight and Purse]]
- [[Base Cues]]
- [[Callsigns]]
- [[Economy]]
- [[Structures and Build Tree]]
