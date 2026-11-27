---
title: Rule Brain
description: "The rule brain is the game's default: squad leaders and Anvil with no AI at all, so anyone can play without a key."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/mixed
  - area/brains-and-agents
  - topic/brains
  - topic/rule-brain
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Command Grammar]]"
  - "[[Agent Loop]]"
  - "[[Agent Telemetry]]"
  - "[[Brains and Agents]]"
  - "[[Fast Brain - Jev]]"
  - "[[Operator - Anvil]]"
  - "[[Squad Leaders]]"
  - "[[Ranks and Brain Tiers]]"
  - "[[Initiative - Orders, Fight and Purse]]"
  - "[[Procedure Words]]"
paths:
  - agents/brain-rule.mjs
  - agents/rule-leader.mjs
  - agents/rule-operator.mjs
  - agents/rule-phrases.mjs
  - agents/rule-grammar.mjs
  - agents/aircraft.mjs
  - agents/test/rule.test.mjs
  - shared/rules.json
  - CLAUDE.md
---

# Rule Brain

The rule brain is the game's default: squad leaders and Anvil with no AI at all, so anyone can play without a key. Orders are read by a grammar in Hebrew and English, answered in fixed phrases from `shared/rules.json`, and carried out with as much initiative as the station's level allows.

It was called the "scripted" brain before commit `d8f07d5`; `CALLSIGN_BRAIN=scripted` still selects it. It costs no call and no noticeable CPU, runs in Node and in a Web Worker, and draws nothing at random: the same wake always gives the same answer (tested).

## Pieces

| File | Role |
|---|---|
| `agents/brain-rule.mjs` | `ruleBrain({ operatorLevel })`; `stepper` and `memories` |
| `agents/rule-grammar.mjs` | reads a call into one intent ([[Command Grammar]]) |
| `agents/rule-leader.mjs` | `leaderPlan`, `carryOut`, `leaderEvent`: what a leader does |
| `agents/rule-operator.mjs` | `operatorPlan`, `ownMoves`, `fightMoves`: what Anvil does |
| `agents/rule-phrases.mjs` | picks a wording from `radio.brain` and fills in names |

### How it fits the agent loop

The loop asks for one thought per turn ([[Agent Loop]]). `stepper` turns a plan (a list of tool calls) into that shape: on the first turn of a wake it computes the plan and returns the first step as a `tool_use`; on later turns it returns the next. A step may carry `orElse(reason)`: if the game refuses the tool, the rest of the plan is replaced by what `orElse` returns, usually a "Negative, <the game's reason>". The typical plan for an order is `[tool, radio "Wilco" out]`.

`memories` keeps per-station memory between wakes (what was said, the last order, whether it already fell back). On the server machine each side gets its own rule brain so plans are not shared.

The brain reports its "model" as `rule-<level>`, shown in the commander's AI view ([[Agent Telemetry]]).

## Levels

A **squad's** level is its brain tier (`levelOf`). **Anvil's** level is a setting of the match (lobby `anvil`), else the host's `CALLSIGN_ANVIL_LEVEL`, default 3.

### Squad leader (`agents/rule-leader.mjs`)

| Level | Behaviour |
|---|---|
| 1 | does what it is told; reports contact, pinned, arrival, losses |
| 2 | also: "attack" with no target goes for an enemy its weapon can hurt; says Negative (`why.cannotHurt`) when sent at something it cannot touch; with no order, engages a hurtable enemy in sight; when holding, moves into cover within 110 m if that keeps it inside the capture radius; after a move, takes cover at hand; falls back **once per order** when half its teams are shaken or pinned or it is at half strength (to the nearest held point nearer home, else the HQ) |
| 3 | also: comes at a defended point from the side (a spot 120 m off the flank with more cover, then in); keeps a long weapon (`minRange` or `siege`, range >= 200) at 80% of its range and backs off when the enemy gets inside it; asks for support when outnumbered, at most every 45 s |

### Operator (`agents/rule-operator.mjs`)

| Level | Behaviour |
|---|---|
| 1 | carries out Hammer's orders, nothing else |
| 2 | with the purse (`command.buy`), one purchase per wake in this order: power if short; the opening (`power`, `refinery`, `barracks`); haulers (2, a third after 240 s; none for 90 s after one was shot at); the next opening structure when gold covers it plus two squads; repair a structure under 66% health when rich; one strike squad once 4 infantry and 2 vehicle squads exist; replacement squads (infantry to 4, vehicles to 3, then balanced) up to 8 squads, or cap minus 2 with 1500+ gold; finally brain upgrades, lowest tier first. It never sells or sets a rally point on its own |
| 3 | with the fight (`command.mode === "fight"`), at most three calls per wake: two nearest squads to a base under attack; a guard to a field whose hauler was hit; idle squads to free points on its own half, one per point; boats to the sea rig; with nothing free and three spare squads, mass at the forward point and go together (hold the nearest point not held, or attack the enemy HQ); one squad stays on each held point; strike aircraft at an enemy squad in sight, a seen defence or power structure, or a look over the enemy HQ every 150 s |

Told to take more than its level allows, Anvil answers Negative (`why.ordersOnly` at level 1, `why.economyOnly` at level 2). It skips squads in `hammerOrdered`, heroes, engineers and haulers when tasking.

### What the operator understands

Fixed patterns in both languages, several orders in one call joined by "then" / "ואז" or "and" / "וגם": build (with an exact spot and a fence's run), buy with a count (max 5 per clause), upgrade, cancel, sell, repair, rally, haulers to a field or `auto`, handing over and taking back the fight in loose words (`command` tool), "attack with everything", "defend the base", a task for named squads or for everyone, "everyone dig in", and a status question. What it does not understand gets "Say again", with the verb or place it did catch.

It also sums squads' contact reports up for Hammer once per place per 90 s (`summary`, phrase `opContact`).

## Phrases

All 86 lines live in `shared/rules.json` under `radio.brain`, in both languages, some with several wordings. `phrase(rules, lang, key, vars, pick)` chooses a wording by a number (the squad's number plus how often it has said that line), so squads do not sound alike but stay deterministic. Hebrew one-letter prefixes are glued the Hebrew way: `{b_place}` with "הגשר המערבי" gives "בגשר המערבי". A key missing from the table throws.

| Key | English | Hebrew |
|---|---|---|
| `wilco` | Wilco | רות, יבוצע |
| `sayAgain` | Say again | אמור שנית |
| `negative` | Negative, {reason} | שלילי, {reason} |
| `fiveByFive` | Five by five | חמש על חמש |
| `contact` (3 wordings) | Contact near {place} | מגע ליד {place} |
| `why.ordersOnly` | I act on your orders only; give me the order | אני פועל רק לפי פקודה; תן את הפקודה |

## Tests

`agents/test/rule.test.mjs`: the grammar on the 150-order set; determinism; each level's behaviour for leaders and operator; no repeat of a contact the net just heard. See [[Command Grammar]].

## History

- `0243c5e` first scripted brain; `d8f07d5` rewritten as the rule brain with a grammar and three levels.
- `2585634` `CLAUDE.md` made it the default brain (owner's decision, 2026-11-24).
- `24865cf`, `075c6e0`, `b22db48`, `a25e6ed` tuned the level-3 operator after played matches.
- `5fc59d5`, `d3b799c` added strike aircraft.

## Related

- [[Brains and Agents]]
- [[Command Grammar]]
- [[Fast Brain - Jev]]
- [[Operator - Anvil]]
- [[Squad Leaders]]
- [[Agent Loop]]
- [[Ranks and Brain Tiers]]
- [[Initiative - Orders, Fight and Purse]]
- [[Procedure Words]]
- [[Enemy Bot]]
- [[Decision - Brains without a Player Key]]
