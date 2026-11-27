---
title: Radio Console
description: "The radio console (#radio) is the log of the net, the box where calls are typed, and the talk and voice buttons."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/code
  - area/client
  - topic/client
  - topic/radio
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Traffic Levels]]"
  - "[[Command Net and Squad Net]]"
  - "[[Base Cues]]"
  - "[[Mobile Layout]]"
  - "[[Settings]]"
  - "[[Hints and Tidy Step]]"
  - "[[Speech Recognition]]"
  - "[[Text to Speech Service]]"
  - "[[Client]]"
  - "[[Page Layout]]"
paths:
  - client/debug.js
  - client/nets.js
  - client/cues.js
  - client/index.html
  - client/nets.test.mjs
  - client/cues.test.mjs
---

# Radio Console

The radio console (`#radio`) is the log of the net, the box where calls are typed, and the talk and voice buttons. It shows two nets, folds repeats, and decides which lines are also spoken.

## Parts

| Element | Role |
|---|---|
| `#net-tabs` | Two tabs: the command net (`data-net="command"`, labelled "radio log") and the squad net. A match always opens on the command net |
| `ol#log` | The command net: radio to and by the commander, the page's own event lines and system lines |
| `ol#squad-log` | The squad net: what squads and the operator say among themselves. Drawn only while its tab is open; read, never spoken |
| `input#text` | The call being written. An empty box follows the page direction, typed text follows its own first letter (`dir="auto"`) |
| `#ptt` | Push-to-talk (microphone); also the key left of `1` (Backquote) |
| `#speak` | Toggles the spoken radio on and off |
| Send button | Submits the box |
| `#voice-status` | What the recogniser is doing, or why it cannot |

## Log entries

`debug.js` keeps `entries` as data so a language switch can redraw them. Three kinds:

| Kind | From | Drawn as |
|---|---|---|
| `radio` | A `radio` frame, and the greeting's log | Time, who (callsign in the page language), the text exactly as transmitted (in the language it was sent in). Classes mark the sender (squad, operator, player) and cues |
| `event` | An `event` frame of this side that has an `event.<kind>` string | A line the page words itself (`event.captured`, `event.squad_lost`, …) |
| `system` | The page (`system(key)`) | Connecting, disconnected, refused with its reason, who has the initiative now, the other commander left / is back |

Events that the squads say on the radio themselves (pinned, contact) have no page line. An event that an operator's base cue already tells (`cued()` in `cues.js`) gets no second line; a spectator hears no cues and reads the page's lines instead.

## Two nets and the traffic level (`client/nets.js`)

Every transmission arrives with a `net` (`command` or `squad`) and a `level`, the least radio-traffic setting that shows it, given by the server ([[Traffic Levels]], [[Command Net and Squad Net]]).

- The command net shows a radio line when `message.level <= traffic.level` (1 quiet, 2 normal, 3 full; default normal). At the full level it carries the squad net's lines too.
- The page's own event lines have levels of their own (`eventLevels`): for example `enemy_destroyed`, `promoted`, `bridge_under_attack` from normal; `deploying`, `structure_started`, `upgraded`, `garrisoned`, `fortified`, `crushed` at full only. Anything not listed is always shown (a squad or point lost or taken, a sale, the base or a hauler under attack). System lines are always shown.
- `heard(message)` is exactly "shown on the command net": only those lines are handed to the voice. Changing the level silences whatever was waiting to be spoken.

## Folding and cues (`client/cues.js`)

- **Repeats fold.** Events of the same kind that follow one another within `FOLD_TICKS = 150` ticks become one line with a count ("×3", or a plural wording from `eventMany.<kind>`). Foldable kinds: `squad_spawned`, `squad_lost`, `enemy_destroyed`, `hauler_attacked`, `hauler_lost`, `structure_built`, `structure_attacked`, `structure_lost`, `structure_lost_theirs`, `hq_under_attack`, `bridge_under_attack` (structures fold per kind, bridges per bridge). Base cues lying between two repeats do not break the run. Identical system lines in a row fold too.
- **Base cues** are fixed lines the server writes in the operator's name; they arrive as radio with `cue` set. The log marks them with a small drawn beacon (`cueMark`, an SVG, so it needs no translation) so they are not taken for something the agent chose to say. They are spoken unless the "speak base cues" setting is off (`spoken()`); they are always written. See [[Base Cues]].
- **Phone strip.** `stripPick` chooses which of the last 10 lines a phone's four-line (and two-line) strip shows: radio addressed to the player first, then other radio, then system lines ([[Mobile Layout]]).

The log stays scrolled to the bottom only if it was already within 40 px of it.

## Sending

- `transmit(text)` is the one place a radio call leaves the page: `{type:"radio", text, strict}`. `strict` is the procedure level from [[Settings]].
- `sendBox()` sends the box. At the relaxed level (1) the text is first passed through `tidy()` (roughly spelled callsigns and places corrected; typed text is otherwise sent as written); see [[Hints and Tidy Step]].
- `order(text)` sends a call the page wrote itself (an orders-menu button, an upgrade) without passing through the box.
- `draft(text)` only puts text in the box: example calls from Help, a name picked on the map with no squad selected, the haul call for a gold field. On a touch device it does not focus the box, so the keyboard does not cover the map.
- **Recall.** Every sent call is kept in `sent`; Up and Down in the box walk through them, and the unsent draft is restored at the end.
- A `refused` frame (the net would not take the call) is logged with its reason in the warning tone.

## Push-to-talk hook

Holding `#ptt` or Backquote calls `talk()`: the music is muted, the spoken radio is "keyed" (`speech.key(true)`, the set cannot receive while transmitting), and recording starts with the net's phrases as hints. Letting go (`talkEnd`) transcribes — on the game server when it offers that, else in the browser — tidies the text, prefixes the selected squad's call when the speech named nobody, and sends it at once; the log shows what was sent and Up brings it back to fix. Spectators cannot talk. The recogniser itself is described in [[Speech Recognition]]; what is spoken back in [[Text to Speech Service]].

## Match end and connection loss

The operator's sign-off (`message.final`) drops all radio still waiting to be spoken. When the connection drops the page says so aloud once from a line kept ready (`declareLost`), writes "disconnected" and shows the no-server notice until it reconnects.

## Related

- [[Client]]
- [[Page Layout]]
- [[Radio Net]]
- [[Command Net and Squad Net]]
- [[Traffic Levels]]
- [[Base Cues]]
- [[Report Suppression]]
- [[Settings]]
- [[Speech]]
