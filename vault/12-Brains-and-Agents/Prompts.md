---
title: Prompts
description: "The system prompts for Anvil and the squad leaders are built in code from shared/rules.json (agents/prompts.mjs), so every number and name in them is the game's own."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/code
  - area/brains-and-agents
  - topic/brains
  - topic/prompts
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Agent Tools]]"
  - "[[Subscription Brain]]"
  - "[[Brains and Agents]]"
  - "[[Agent Loop]]"
  - "[[Operator - Anvil]]"
  - "[[Squad Leaders]]"
  - "[[Procedure Words]]"
  - "[[Net Language]]"
  - "[[Initiative - Orders, Fight and Purse]]"
  - "[[Factions]]"
paths:
  - agents/prompts.mjs
  - agents/agent.mjs
  - agents/bases.mjs
  - agents/heroes.mjs
  - agents/aircraft.mjs
  - agents/power.mjs
  - agents/tools.mjs
  - shared/rules.json
---

# Prompts

The system prompts for Anvil and the squad leaders are built in code from `shared/rules.json` (`agents/prompts.mjs`), so every number and name in them is the game's own. Only language-model brains read them; the rule brain and the fast brain ignore the prompt and work from the wake data.

There are two builders, `operatorPrompt({ rules, side, faction })` and `leaderPrompt({ rules, side, faction, station, unit, seized })`, called once per `hello` in `Agent.#greet`. Prompts are written in English and tell the model to transmit in the net language.

## Shared blocks

| Block | Content |
|---|---|
| `wakes` | "You are woken only when something happens ... finish the whole job inside the wake ... Text you write outside a tool call is heard by nobody." |
| `procedure` | The radio rules: the net writes "<to>, this is <you>" and the closing word, so only the body is written. Wilco / "רות, יבוצע" ends Out; Negative with a reason ends Over; "Say again" rather than guess; "Five by five" to a radio check; never a bare Roger; a call ending in Out expects no reply; one short sentence; every transmission carries a `kind`; one report per event; write in the net language and name points by their callsign in it (Delta is דוד, never "דלתא") |
| `mapTable(rules, side)` | The map's name and size ("x grows east, y grows south, distances are in metres"); one line per point with both callsigns, both names, coordinates and what it is; ground rules; bridges; landmarks (each kind explained once, then id and both names); how to pass described places; tech buildings; capture time and the timer rule; how enemy squads are named ("Target 3" / "מטרה 3"); fog of war |
| `doctrine[faction]` | One paragraph that makes the same model play the factions differently |

Doctrine as written:

- **Aegis**: "few soldiers, sharp eyes. Be patient, wait for information before committing, and prefer flanks and ambushes to frontal pushes. On the radio you are clipped and calm."
- **Ashfall**: "cheap and many. Be aggressive but avoid open fights, pull back early when a fight turns, and come back from a new angle. On the radio you are loose and fast."

## Leader prompt, in order

1. Who you are: squad callsign in both languages, the unit, its class and faction.
2. The fireteams fight on their own; you decide where the squad goes and keep your commander informed.
3. Chain of command: Hammer, then Anvil; "you choose how, never whether"; a direct order from Hammer outranks Anvil.
4. `wakes`.
5. For strike aircraft: `leaderStrike(unit)` (what attack, move and hold mean for planes).
6. "On an order: first act with ... then answer on the radio", listing the tools this unit has; when to report; the squad's domain (land, sea, air); `unitFacts(unit)` ("Know your squad: ...").
7. `leaderBases(unit)`: structures, capture and repair for engineers.
8. `leaderHeroes(unit, rules, { seized })`: the hero's own tool, or that this squad was seized from the enemy.
9. `procedure`, `mapTable`, `doctrine`.

`unitFacts` turns numbers into words: flies / sea only; classes it cannot hit (`vs` = 0); `pierce`; `minRange` ("keep it back and screened"); short range; `noCapture`; engineers; `siege`; a hauler; a strike aircraft.

## Operator prompt, in order

Rewritten "as one set, organised by tool" in commit `0a9c0e9`.

1. Who you are and what you do; squad callsign families (Viper / צפע, Rhino / קרנף, Shark / כריש, Hawk / בז, Comet / שביט for strike aircraft).
2. Hammer outranks you; `hammerOrdered` squads are Hammer's.
3. `wakes`.
4. **Who decides**: the fight (`command.mode`) and the purse (`command.buy`), the fixed phrases that switch them in both languages, standing tasks ("buy troops and push forward") that need the `command` tool first, and "never give yourself the fight or the purse".
5. **The net**: you hear everything; most traffic needs nothing; never acknowledge what was not addressed to you. **Summing up for Hammer**: once when a fight starts, once when it ends; never one line per squad. Base news is told by fixed lines in your name; never repeat one.
6. **Your tools**, one line each; and that Hammer also acts by hand ("(no call) Hammer, by hand" is information, not an order).
7. **Gold**: gushers, fields, haulers, refinery, the HQ trickle, the sea rig, the hauler cap.
8. **The base**: structures (`structureLines`), the opening order, placing rules with the real radii and caps, defences and fences, **power**, **radar**.
9. **Production**: population cap, the unit list with cost and what each needs, queues and their limit, cancel, rally, brain upgrades with their costs, heroes (`heroLines`), strike aircraft (`strikeLines`).
10. **Selling and repairing** with the real shares.
11. **The fight**: structures as targets, defences outrange ordinary weapons, siege units, `fightLines`.
12. `procedure`, `mapTable`, `doctrine`.

Rule: "Never say what something cost and do not report gold amounts unless Hammer asks about gold."

## The wake message

Each wake is one user message (`renderWake` in `agents/agent.mjs`):

```
<one line per item: a call, something heard, an event>
The net language is Hebrew|English: write every radio body in it, ...

Status: {compact JSON}

Net traffic, most recent last:
  <up to 8 transmissions>
```

A call is rendered as `Radio call for you from Hammer, in Hebrew: "..."` plus `Points named: F, D.` and `Landmarks its words fit: ...` when the server's net found any. `compactStatus` trims the server's report: for a leader `{ secondsLeft, you, friends, haulers, contacts, points, structures, ground? }`; for the operator also `command`, `purchaseOrdered`, `hammerOrdered`, `gold`, `goldPerMinute`, haulers, fields, `hqHealth`, `power`, `radar`, `opening`, `squads`, `deploying`.

## Tool descriptions

The other half of what a model reads is the tool descriptions in `agents/tools.mjs` ([[Agent Tools]]). The subscription brain appends them to the system prompt as a "How you act here" section, because Claude Code's own tools are off ([[Subscription Brain]]).

## Size

A big map has around a hundred landmarks, so landmark kinds are explained once instead of per line (commit `1d9e0ae`). The relay accepts a system prompt up to 64 KB. The actual prompt length was not measured for this note.

## Related

- [[Brains and Agents]]
- [[Agent Loop]]
- [[Agent Tools]]
- [[Operator - Anvil]]
- [[Squad Leaders]]
- [[Procedure Words]]
- [[Net Language]]
- [[Initiative - Orders, Fight and Purse]]
- [[Factions]]
- [[Maps]]
