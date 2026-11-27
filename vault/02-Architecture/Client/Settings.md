---
title: Settings
description: "Player settings live in a small modal dialog behind the gear button in the header (dialog#settings, added in commit 0d2acb6 to get them out of the sidebar)."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/code
  - area/architecture
  - topic/client
  - topic/settings
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Sound, Music and Effects]]"
  - "[[Text to Speech Service]]"
  - "[[Base Cues]]"
  - "[[Traffic Levels]]"
  - "[[Procedure Words]]"
  - "[[Hints and Tidy Step]]"
  - "[[Fireteams and Nerve]]"
  - "[[Key Handling]]"
  - "[[Service Worker and Install]]"
  - "[[Lobby Page]]"
paths:
  - client/index.html
  - client/debug.js
  - client/nets.js
  - client/cues.js
  - client/music.js
  - client/speech/speech.js
  - client/lobby.js
  - client/tutorial.js
  - client/brains/host.js
  - client/brains/seat.js
  - client/i18n/en.json
---

# Settings

Player settings live in a small modal dialog behind the gear button in the header (`dialog#settings`, added in commit 0d2acb6 to get them out of the sidebar). Every setting is kept by the browser in `localStorage`; nothing is stored on the server and there are no accounts.

## The settings dialog

| Section | Setting (English / Hebrew label) | Control | Values | Stored as | Default |
|---|---|---|---|---|---|
| Sound / צליל | Music mute | `#mute` button | on / off | `callsign.muted` (`"1"` / `"0"`) | not muted |
| Sound | Music volume | `#volume` slider | 0–1 in steps of 0.05 | `callsign.volume` | 0.7 |
| Sound | Now playing | `#track` | title · artist | — | — |
| Sound | Speak the radio aloud / השמעת הקשר בקול | `#voices` checkbox (same switch as the `#speak` button in the radio console) | on / off | `callsign.speech` (`"0"` = off) | on |
| Sound | Speak base cues aloud / השמעת הודעות הבסיס בקול | `#cue-voice` checkbox | on / off | `callsign.cueVoice` (`"on"` / `"off"`) | on |
| Radio / קשר | Radio traffic / עומס ברשת | `#traffic` select | 1 · Quiet / שקט, 2 · Normal / רגיל, 3 · Full / מלא | `callsign.traffic` | 2 |
| Radio | Radio procedure / נוהל קשר | `#strict` select | 1 · Relaxed / חופשי, 2 · Standard / רגיל, 3 · Strict / מחמיר | `callsign.strict` | 1 |
| Display / תצוגה | Show nerve (debug) / הצג עצבים (דיבאג) | `#nerve` checkbox | on / off | not stored | off |

The music block is hidden when the server has no music manifest. Clicking the dialog's backdrop closes it.

### What each one does

- **Music volume and mute** also set the level of the battle sounds (`Sfx` follows `music.volume`, 0 when muted). The spoken radio is deliberately less tied to it: its volume is `0.6 + 0.4 × music.volume`. See [[Sound, Music and Effects]].
- **Speak the radio aloud** turns the voice for radio lines on or off; see [[Text to Speech Service]].
- **Speak base cues aloud**: cues are always written in the log; this only decides whether they are spoken. See [[Base Cues]].
- **Radio traffic** is how much of the net the commander is shown and hears; the page filters by the level the server stamped on each line. The dialog explains it: "Quiet: only what needs you, and the answers to your own orders. Normal: also one line for each new contact and each objective reached. Full: everything. A squad you ordered yourself always reports to you." Changing it silences speech still waiting. See [[Traffic Levels]].
- **Radio procedure** is sent with every call as `strict` and decides how closely the server holds the player to procedure: 1 a callsign and the order are enough, roughly spelled names are corrected, and a call with no callsign goes to Anvil; 2 every call opens "<to>, this is <from>"; 3 also needs Over or Out, anything else is refused. At level 1 the page also tidies typed and spoken text before sending. See [[Procedure Words]] and [[Hints and Tidy Step]].
- **Show nerve** draws a coloured ring under each of the player's own teams (steady green, shaken yellow, pinned red). It is a debugging aid: the design is that nerve shows only through behaviour ([[Fireteams and Nerve]]).

## Settings outside the dialog

| Setting | Where | Stored as |
|---|---|---|
| Page language (Hebrew / English) | Language button in the header and on the start screen; `?lang=` in the address wins | `callsign.lang`; default from the browser's language |
| Build bar tab last used | The bar's tabs | `callsign.buildTab` |
| Lobby choices: enemy level, pace, map, starting gold | The new-match form | `callsign.level`, `callsign.speed`, `callsign.map`, `callsign.startGold` |
| Host password (after it worked once) | Lobby | `callsign.hostkey` |
| The seat held in a room | Lobby | `callsign.seat.<room>` = `{side, token}` |
| The first lesson: where it got to, and that it was seen | Coach | `callsign.lesson`, `callsign.lesson.seen` |
| "Run the rule brain in this browser" | AI dialog, key tab (`#brains-demo`) | `callsign.agents` (`"demo"` / `"auto"`) |
| The relay's player token | AI dialog (`client/brains/seat.js`) | `callsign.player` (a token the relay made, so a stored key stays with this browser between matches) |
| The player's AI key | AI dialog | **Not** in the browser: it is sent to the model relay and kept there encrypted ([[Key Handling]]) |

`sessionStorage` holds two one-shot guards: `callsign.repair` (the start screen's self-repair ran) and `callsign.swReload` (the page reloaded once for a new service worker); see [[Service Worker and Install]].

## What the player cannot set here

Match options (map, gold, length, pace, enemy level, Anvil's level, fast brain, purse) are chosen per match by whoever makes it, in the lobby ([[Lobby Page]]). Who has the initiative and the purse is changed during a match by radio call ([[Initiative - Orders, Fight and Purse]]).

## Related

- [[Client]]
- [[Page Layout]]
- [[Radio Console]]
- [[Traffic Levels]]
- [[Sound, Music and Effects]]
- [[Lobby Page]]
- [[i18n Rules]]
