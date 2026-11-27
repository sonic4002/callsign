---
title: The Idea
description: "Callsign (אות קריאה) is a browser real-time strategy game in which every squad is an AI agent, and the player commands by voice or text over a military radio net in Hebrew and English."
type: concept
status: current
tags:
  - type/concept
  - status/current
  - agent/CLD
  - origin/mixed
  - area/gameplay
  - topic/game-design
  - topic/overview
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[AI Brains and Model Relay]]"
  - "[[Fireteams and Nerve]]"
  - "[[Match Rules and Winning]]"
  - "[[Decision - Direct Build and Buy]]"
  - "[[Economy]]"
  - "[[Radio versus Direct Acts]]"
  - "[[Radio Net and Bilingual Procedure]]"
  - "[[Decision - Economy]]"
  - "[[Decision - Isometric Art]]"
  - "[[Decision - Client Stack]]"
paths:
  - CLAUDE.md
  - docs/PLAN.html
  - KICKOFF.md
  - shared/rules.json
---

# The Idea

Callsign (אות קריאה) is a browser real-time strategy game in which every squad is an AI agent, and the player commands by voice or text over a military radio net in Hebrew and English. The player is Hammer (פטיש); an operator agent called Anvil (סדן) and one leader agent per squad carry the orders out, while plain game code on the server moves and fights the fireteams.

## The chain of command

| Layer | Who | What decides | Where it runs |
|---|---|---|---|
| Commander | The player, callsign Hammer / פטיש | A person | The page |
| Operator | Anvil / סדן, one per side | A brain (rule brain, or a language model) | Agent host on the server machine, or a Web Worker in the player's browser |
| Squad leader | One per squad (Viper 2 / צפע 2 ...) | A brain (rule brain, the fast brain, or a language model) | Same as the operator |
| Fireteams | 1 to 4 teams per squad | Utility AI, no model | The game server |

See [[AI Brains and Model Relay]] for the brains and [[Fireteams and Nerve]] for the bottom layer.

## The core loop as the code plays it

1. A match opens with a headquarters, two starting squads and gold (1,000 by default). See [[Match Rules and Winning]].
2. The commander builds a base: power, a refinery (which brings a hauler), a barracks and on up the tree. Building and buying are pressed directly in the page: [[Decision - Direct Build and Buy]].
3. Haulers collect gold from fields fed by gushers: [[Economy]].
4. Orders to squads go by radio, spoken or typed, or by tapping the map, which sends the same order directly: [[Radio versus Direct Acts]].
5. Squads answer in radio procedure and report what they meet: [[Radio Net and Bilingual Procedure]].
6. The match ends when a headquarters falls or the timer runs out.

## What changed from the first plan

`docs/PLAN.html` (design plan v0.6) describes an earlier game. The differences that matter:

| Plan | Code now |
|---|---|
| Oil rigs pump gold on their own; nothing to harvest | Haulers harvest gold from fields; only the sea rig and the headquarters pay by themselves ([[Decision - Economy]]) |
| Players do not click units; everything through the operator | Build and buy are direct, and a tap on the map orders a squad ([[Decision - Direct Build and Buy]]) |
| Top-down art | Isometric art ([[Decision - Isometric Art]]) |
| Phaser 3 + TypeScript client | Plain JavaScript modules on a canvas ([[Decision - Client Stack]]) |
| Every brain is a language model on the player's key | The default is a rule brain with no AI at all ([[Decision - Brains without a Player Key]]) |
| Superpowers, weather, ammo, fatigue | Not in the code ([[Superpowers]], [[Plan versus Code]]) |

The full list is in [[Plan versus Code]].

## Design pillars (from the plan)

- Quick matches, playable on a phone. The maps' default lengths are 15, 20 and 25 minutes ([[Maps]]); the plan said 10 to 15.
- Command, not clicks: skill is in how the commander briefs the net.
- Fair: brain tiers are bought with in-game gold, never with money ([[Ranks and Brain Tiers]]).
- Obedience first: squads carry out the order and improvise only how.

## Related

- [[Game Overview]]
- [[Factions]]
- [[Radio Net and Bilingual Procedure]]
- [[AI Brains and Model Relay]]
- [[Locked Decisions]]
- [[Project Log]]
