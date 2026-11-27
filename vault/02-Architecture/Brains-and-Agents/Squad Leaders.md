---
title: Squad Leaders
description: "Each squad has its own leader agent, started when the squad comes out and stopped when it is lost."
type: concept
status: current
tags:
  - type/concept
  - status/current
  - agent/CLD
  - origin/code
  - area/architecture
  - topic/brains
  - topic/squads
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Where Agents Run]]"
  - "[[Report Suppression]]"
  - "[[Agent Tools]]"
  - "[[Rule Brain]]"
  - "[[Ranks and Brain Tiers]]"
  - "[[Net Language]]"
  - "[[AI Brains and Model Relay]]"
  - "[[Agent Loop]]"
  - "[[Operator - Anvil]]"
  - "[[Command Grammar]]"
paths:
  - agents/agent.mjs
  - agents/prompts.mjs
  - agents/rule-leader.mjs
  - agents/tools.mjs
  - agents/host.mjs
  - agents/heroes.mjs
  - agents/aircraft.mjs
  - shared/rules.json
---

# Squad Leaders

Each squad has its own leader agent, started when the squad comes out and stopped when it is lost. The leader decides where the squad goes and what it does there and keeps its commander informed; the fireteams fight on their own on the server.

## Life cycle

The host ([[Where Agents Run]]) adds a leader for every squad in the `hello` state, on each `squad_spawned` event, and removes it on `squad_lost`. A new match (a fresh `hello`) stops every agent and starts again. Haulers have no leader and take no radio calls.

## Chain of command

Hammer (פטיש) is the human; Anvil (סדן) is Hammer's operator. A leader carries out both: it chooses how, never whether. A direct order from Hammer outranks Anvil until Hammer hands the squad back. The leader reports to **whoever gave its current order** (`agent.commander`, set from the last call, or "Hammer" when the player sent it by tapping the map).

Squads do not order squads: the rule brain ignores an order from another squad (`understandLeader` returns `none`).

## What a leader does

| On | It |
|---|---|
| an order | acts with one tool (`move`, `hold`, `attack`, or its special tool), then answers "Wilco ... Out"; if the tool refuses, "Negative, <reason> ... Over" |
| a call it cannot read | "Say again ... Over", naming what it came closest to |
| a radio check | "Five by five ... Out" |
| `contact`, `pinned`, `arrived`, `losses` | one report each, then stays off the net |
| a `known` contact (another squad met it first) | says nothing ([[Report Suppression]]) |

Arriving and going inside a building are one piece of news: whichever comes second is not said.

## Tools by kind of squad

From `leaderToolsFor` ([[Agent Tools]]):

| Squad | Extra tools beyond `radio`, `report`, `move`, `hold`, `attack` |
|---|---|
| ordinary land infantry | `fortify` |
| engineers (`captureSeconds > 0`): Aegis `engineers`, Ashfall `sappers` | `capture`, `repair`, `fortify` |
| hero with `chargeDamage`: Aegis `sentinel` | `plant` |
| hero with `seizeRadius`: Ashfall `oracle` | `seize` |
| vehicles, boats, helicopters, drones | none |
| strike aircraft (`bombs > 0`): Aegis `strikeJet`, Ashfall `propBomber` | a different meaning for `move` / `hold` / `attack`; nothing else |

A squad a hero has seized is of the other army's design; its leader's prompt is built from that unit (`unitAnywhere`) and says so.

## Tier and brain

A squad's brain tier (1 Recruit / טירון, 2 Sergeant / סמל, 3 Veteran / ותיק; upgrade costs 300 and 800 gold) decides how it thinks:

| Brain | What the tier changes |
|---|---|
| rule | its initiative level, 1 to 3 ([[Rule Brain]]) |
| jev | the rule level behind the grammar; with a player's key only tier 1 uses Jev |
| relay | the model: tier key `"1"`, `"2"`, `"3"` in `shared/models.json`, with effort `low`, `medium`, `high` |
| claude / subscription | `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5` |

An upgrade is noticed on the next wake (the status shows the new tier): the conversation is dropped and the next thought uses the new brain. The relay asks the game server for the tier on every thought, so a player cannot use a stronger model than the gold paid for. See [[Ranks and Brain Tiers]].

## Language

A leader writes every radio body in the net language, which follows the commander's page and then whatever Hammer last spoke, and names points by their callsign in that language ([[Net Language]]).

## Related

- [[AI Brains and Model Relay]]
- [[Agent Loop]]
- [[Agent Tools]]
- [[Operator - Anvil]]
- [[Rule Brain]]
- [[Command Grammar]]
- [[Prompts]]
- [[Fireteams and Nerve]]
- [[Ranks and Brain Tiers]]
- [[Callsigns]]
- [[Procedure Words]]
- [[Heroes]]
- [[Strike Aircraft]]
