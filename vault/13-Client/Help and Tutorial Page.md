---
title: Help and Tutorial Page
description: "The page teaches the game in two ways: a Help window with a guide and example radio calls, and 'Learn to command', an interactive first match in which a coach shows one line at a time."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/code
  - area/client
  - topic/client
  - topic/help
  - topic/tutorial
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[First Lesson]]"
  - "[[Settings]]"
  - "[[i18n Rules]]"
  - "[[Rule Brain]]"
  - "[[Where Agents Run]]"
  - "[[Client]]"
  - "[[Lobby Page]]"
  - "[[Radio Console]]"
  - "[[Build Bar]]"
  - "[[Procedure Words]]"
paths:
  - client/index.html
  - client/debug.js
  - client/lesson.js
  - client/tutorial.js
  - client/tutorial.css
  - client/lesson.test.mjs
  - client/i18n/en.json
  - client/map.js
---

# Help and Tutorial Page

The page teaches the game in two ways: a Help window with a guide and example radio calls, and "Learn to command", an interactive first match in which a coach shows one line at a time. This note covers the page side; the lesson's room and its waiting enemy on the server are in [[First Lesson]].

## Help window (`#help`)

Opened by the Help button, closed by its button, a click outside or Escape; `?help` opens the page on it and `?help=examples` on its second tab. On a phone it fills the screen.

### Guide tab

1. A button to take the lesson again ("Play the lesson", `tut.again`).
2. How to talk (`help.talk`).
3. Asked-and-answered list, one `help.q.*` / `help.a.*` pair each: orders, move, cover, bridges, placing, turning a wall, power, radar, production lines, selling, tech buildings, defences, units, Anvil's automatic mode, base cues, the two nets, upgrades, heroes, digging in, planes, ranks, match speed, voice.
4. The three radio procedure levels (Relaxed / Standard / Strict) with what each demands ([[Settings]]).
5. "The map" (`help.more`).

### Examples tab

Example calls in the page language; **clicking one closes Help and puts the call in the radio box** to send or edit.

| Group | Examples (by key) |
|---|---|
| To squads | attack, attack a target, attack anything, hold, move, fall back, a described place, go inside, repair, seize, dig in, plant a charge, air strike, take a structure, several squads at once, report, all stations |
| To Anvil | manage (hand over the fight), status, buy, open the base, build the works, build on a spot, cancel a unit, rally, defend, haul, power, radar, sell, repair a structure, buy naval, upgrade |
| Procedure | radio check, a full-procedure call |

All text is in the i18n files; nothing is literal in the page ([[i18n Rules]]).

## The first lesson

### Starting it

- "Learn to command · 5 minutes" (`#learn-start`) is offered first on the start screen, and highlighted on a browser that has not been through it (`callsign.lesson.seen` unset).
- From Help, "take the lesson again" leaves for the start screen with `?learn`, which goes straight in.
- `startLesson()` makes a room with `{opponent:"bot", bot:"tutorial", length:0}`. The squads think in this browser with the rule brain (the seat is marked `lesson`), so it needs no key and never the host password ([[Rule Brain]], [[Where Agents Run]]).

### Steps (`client/lesson.js`)

The lesson is data: 16 steps in order. A step the player acts in ends by itself when `done(c)` is true, read from the real match (the server's state and the radio log), so a reload or doing two things at once never leaves it stuck. A step the player only reads (`manual`) ends on Next, offered once `ready(c)`.

| # | id | Kind | Over when | Lights up |
|---|---|---|---|---|
| 1 | `welcome` | read | Next | — |
| 2 | `select` | act | A squad is selected, or one was already called | Ring on the first squad; roster |
| 3 | `order` | act | The commander has called a squad on the radio | Ring on the nearest point; the send box |
| 4 | `answer` | read | Next, once a squad has answered | The log |
| 5 | `orders` | read | Next (Hold / Move / Attack) | — |
| 6 | `cover` | read | Next | — |
| 7 | `power` | act | A power structure is placed | Structures tab |
| 8 | `refinery` | act | The refinery stands and its hauler has come out | Structures tab |
| 9 | `fog` | read | Next | — |
| 10 | `barracks` | act | A barracks stands | Structures tab |
| 11 | `buy` | act | A squad beyond the starting ones is on its way | Reinforcements tab |
| 12 | `deploy` | read | Next, once that squad has arrived | Roster |
| 13 | `upgrade` | act | A squad has a brain above tier 1 | Roster |
| 14 | `enemy` | act | A squad was sent at an enemy by name ("Target N"), or the enemy is already beaten | Ring on the first enemy in sight |
| 15 | `voice` | read | Next | The talk button |
| 16 | `win` | read | End: "Keep fighting here" or "Play a real match" | — |

- `advance()` passes over steps already done in one go; Skip ends any step.
- Steps marked `touch` have a second wording for fingers (`tutTouch.<id>`: select, order, power, refinery, buy, upgrade, enemy).
- **Releasing the enemy.** The lesson's enemy stands still until the learner has a base: from the `buy` step on (`released`), the coach sends `{type:"lesson"}` once per connection and the server lets it go.
- The lines are filled with this match's own names (`#names`): the player's callsign, the first squads, the nearest point and gold field, Anvil, the cheapest infantry unit, the first target, upgrade costs, and the page's own button labels.

### The coach (`client/tutorial.js`, `#coach`)

A card over the top of the map with the step's line, a `n / 16` counter, Skip, Next and a close button. It:

- points at one thing on the map with a pulsing ring (`scene.coach`: a point, a squad, or the first contact);
- gives the page element in question a breathing brass glow (`.coach-target`), and on a phone also the dock tab that holds it;
- turns the build panel to the half the step is about, and puts away a sheet left open by the step before;
- remembers progress in `localStorage` `callsign.lesson` = `{room, step}`, so a reload picks the lesson up where it was; finishing or leaving sets `callsign.lesson.seen`.

Leaving the coach does not end the match: it goes on as an ordinary one. The last step offers staying, or going back to the start screen for a real match.

### Tests

`client/lesson.test.mjs` checks the step conditions and `advance` without a page; the i18n test requires a `tut.<id>` string for every step in both languages.

## Related

- [[Client]]
- [[First Lesson]]
- [[Lobby Page]]
- [[Radio Console]]
- [[Build Bar]]
- [[Procedure Words]]
- [[i18n Rules]]
