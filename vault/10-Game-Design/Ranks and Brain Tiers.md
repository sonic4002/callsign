---
title: Ranks and Brain Tiers
description: "A squad has two separate standings."
type: concept
status: current
tags:
  - type/concept
  - status/current
  - agent/CLD
  - origin/mixed
  - area/game-design
  - topic/game-design
  - topic/ranks
  - topic/tiers
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Traffic Levels]]"
  - "[[Model Relay]]"
  - "[[Rule Brain]]"
  - "[[Pronunciation Table]]"
  - "[[Game Design]]"
  - "[[Fireteams and Nerve]]"
  - "[[Claude Brain and Player Keys]]"
  - "[[Heroes]]"
  - "[[Economy]]"
paths:
  - shared/rules.json
  - shared/rules.go
  - shared/models.json
  - server/sim/ranks.go
  - server/sim/command.go
  - docs/PLAN.html
---

# Ranks and Brain Tiers

A squad has two separate standings. Its rank is earned by what it destroys and makes its fireteams fight a little better; its brain tier is bought with gold and decides which class of model its leader may think with.

## Earned ranks

`ranks` in `shared/rules.json`, applied in `server/sim/ranks.go`:

| id | English | Hebrew | Kills needed | Accuracy | Stress taken | Healing out of combat |
|---|---|---|---|---|---|---|
| (none) | - | - | 0 | x 1 | x 1 | 0 |
| `seasoned` | Seasoned | מנוסה | 3 | x 1.04 | x 0.94 | 0 |
| `elite` | Elite | עילית | 6 | x 1.08 | x 0.88 | 0.4% of a member's health a second |

- "Kills" is the worth of what the squad destroyed in multiples of its own cost: `creditKill` shares the worth of the men a team just lost between the squads that shot it.
- A promotion raises the event `promoted`; the page logs a rank from the Normal traffic level up ([[Traffic Levels]]) and draws rank marks as code-drawn shapes.
- The numbers were brought down to these when the heroes were tuned (commit `52b255d`).

## Brain tiers

`tiers` in `shared/rules.json`:

| Tier | English | Hebrew | Upgrade cost (gold) | `modelClass` |
|---|---|---|---|---|
| 1 | Recruit | טירון | 0 (every squad starts here) | small |
| 2 | Sergeant | סמל | 300 | mid |
| 3 | Veteran | ותיק | 800 | top |

- `upgrade` in `server/sim/command.go` spends the next tier's cost and raises the squad's tier by one; the event is `upgraded`.
- A hero is fielded at tier 2 (`startTier`).
- The tier changes nothing in the simulation: no stat reads it. It is what the model relay looks up (`GET /internal/tier`) to pick the model for that squad's next thought, from the tier-to-model table in `shared/models.json` ([[Model Relay]]).
- With the rule brain there is no model to pick, but the tier still matters: a rule-brain squad leader's level of initiative (1 to 3) is its brain tier (`levelOf`, see [[Rule Brain]]). That is why a rule-brain operator holding the purse spends spare gold on brain upgrades last, lowest tier first (commit `075c6e0`).
- Hebrew speech reads the rank סמל as "samal" ([[Pronunciation Table]]).

## Differs from the plan

`docs/PLAN.html` describes veterans with memory across matches (a surviving squad gains a rank, a name and memories). In the code ranks last one match, and nothing persists between matches.

## Related

- [[Game Design]]
- [[Fireteams and Nerve]]
- [[Model Relay]]
- [[Claude Brain and Player Keys]]
- [[Heroes]]
- [[Economy]]
