---
title: First Lesson
description: "'Learn to command' is an interactive first match with a coach: a real match on the small map against an enemy that stands still until the learner is ready."
type: concept
status: current
tags:
  - type/concept
  - status/current
  - agent/CLD
  - origin/code
  - area/game-design
  - topic/game-design
  - topic/tutorial
  - topic/lesson
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[WebSocket Frames]]"
  - "[[Help and Tutorial Page]]"
  - "[[Game Design]]"
  - "[[Enemy Bot]]"
  - "[[Match Rules and Winning]]"
  - "[[Rooms, Hub and Lobby]]"
  - "[[Structures and Build Tree]]"
paths:
  - client/lesson.js
  - client/tutorial.js
  - server/room/hub.go
  - server/room/lesson_test.go
  - server/bot/bot.go
---

# First Lesson

"Learn to command" is an interactive first match with a coach: a real match on the small map against an enemy that stands still until the learner is ready. Its steps are data, and each one ends when the server's state shows the player really did the thing, so a reload never leaves the lesson out of step.

## The lesson's room

From `server/room/hub.go`:

| Rule | Value |
|---|---|
| How it is made | a match against the bot with the style `tutorial` |
| Map | always the small map ("the lesson is written for the small map") |
| Length | 1800 seconds (`lessonSeconds`): nobody is hurried |
| Spectators | none |
| Fast brain | off: "a lesson spends nothing" |
| Host password | not needed even on a public server: the lesson runs no agents on the server machine; its squads think in the learner's browser |
| How many at once | 8 (`maxLessons`), since anyone can start one |

The enemy (`lesson` in `server/bot/bot.go`) does nothing until it is released, then its first squad walks at the land rig nearest the learner's headquarters, so the learner meets one enemy in sight. It never buys. The page releases it with the `lesson` frame ([[WebSocket Frames]]).

## The steps

`STEPS` in `client/lesson.js`. A step the player acts in ends by itself when its `done` test is true; a step that is only read (`manual`) ends on Next.

| # | id | Kind | Ends when |
|---|---|---|---|
| 1 | `welcome` | read | Next |
| 2 | `select` | act | a squad is selected, or one has been ordered |
| 3 | `order` | act | the commander has called a squad on the radio |
| 4 | `answer` | read | Next, offered once a squad has answered |
| 5 | `orders` | read | Next (how Move, Hold and Attack differ) |
| 6 | `cover` | read | Next |
| 7 | `power` | act | a power structure is placed |
| 8 | `refinery` | act | the refinery stands and its hauler has come out |
| 9 | `fog` | read | Next |
| 10 | `barracks` | act | a barracks stands |
| 11 | `buy` | act | a squad beyond the starting ones is bought; **the enemy is released from this step on** |
| 12 | `deploy` | read | Next, offered once the new squad is in the field |
| 13 | `upgrade` | act | one squad has a brain above tier 1 |
| 14 | `enemy` | act | a squad is sent at an enemy squad by name, or the enemy is beaten |
| 15 | `voice` | read | Next (push-to-talk) |
| 16 | `win` | read | Next |

`advance` passes over steps already done in one go; Skip ends any step. Steps marked `touch` are worded differently for fingers. The coach card, what it lights up and the Help window are described in [[Help and Tutorial Page]].

## History

The lesson's room and enemy (`17c0d6e`), its steps as data (`6b91d16`) and the coach (`fc00500`) were added on 2026-11-24, then reworked the same day to follow the new opening (`84b4445`) and placing with the ghost (`def89ab`).

## Related

- [[Game Design]]
- [[Help and Tutorial Page]]
- [[Enemy Bot]]
- [[Match Rules and Winning]]
- [[Rooms, Hub and Lobby]]
- [[Structures and Build Tree]]
