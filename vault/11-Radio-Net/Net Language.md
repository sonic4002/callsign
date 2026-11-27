---
title: Net Language
description: "A side's whole net speaks one language at a time: the one its commander last used, or — before the commander has said anything — the language the commander's page is in."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/code
  - area/radio-net
  - topic/radio
  - topic/language
  - topic/hebrew
  - topic/i18n
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Map Point Letters]]"
  - "[[Hints and Tidy Step]]"
  - "[[i18n Rules]]"
  - "[[Radio Net]]"
  - "[[Radio Routing]]"
  - "[[Callsigns]]"
  - "[[Procedure Words]]"
  - "[[Base Cues]]"
  - "[[Pronunciation Table]]"
  - "[[Agent Loop]]"
paths:
  - server/room/room.go
  - server/room/tools.go
  - server/room/act.go
  - server/room/cues.go
  - server/room/command.go
  - server/radio/radio.go
  - server/radio/localize.go
  - server/radio/localize_test.go
  - agents/agent.mjs
  - client/debug.js
  - shared/rules.json
---

# Net Language

A side's whole net speaks one language at a time: the one its commander last used, or — before the commander has said anything — the language the commander's page is in. The server decides it and composes every agent transmission, base cue and announcement in it, with point names and callsigns put into that language.

## How the language of a call is detected

`Net.parse` (`server/radio/radio.go`):

| Evidence | Language |
|---|---|
| The marker "כאן" | `he` |
| The marker "this is" | `en` |
| No marker, any Hebrew letter in the text | `he` |
| Otherwise | `en` |

## Where it is stored

`Room.lang[side]` is a map from station key to language:

| Written by | What |
|---|---|
| `SayAt` | Hammer's own key (`player`) gets the language of every call Hammer makes: "the net follows the commander's language" |
| `transmit` | Each addressee's key gets the language of the call it received |
| `SetLang` | `player` gets the page's language, from a `{"type":"lang","text":"he"|"en"}` frame |

The page sends the `lang` frame on connecting and whenever the player switches language (`client/debug.js`). `SetLang` accepts it only from a commander and only `he` or `en`, and broadcasts `{"type":"netlang","lang":...}` to the side. The `hello` frame carries the same as `netlang` ("" before it is known).

## Which language a transmission is written in

For an agent's `radio` tool (`toolRadio`), the first that is set:

1. The `lang` argument, if it is `en` or `he`.
2. The commander's language (`lang[side]["player"]`).
3. The language this station was last spoken to in.
4. The language all stations were last addressed in.
5. English.

For server-written lines:

| Line | Language |
|---|---|
| Base cues (`cueLang`) | Hebrew if the commander's language is `he`, otherwise English |
| Own-purchase announcements (`announce`, `announceBuilt`, `announceStructure`) | Same |
| The Wilco of a squad sent by hand (`directOrder`) | Same |
| The sign-off at the end of a match | Same |

Both sides have their own setting: one commander can play in Hebrew and the other in English in the same match.

## Names in the net's language (`Net.Localize`)

A station writing Hebrew sometimes names a point or squad the English way. Before composing, the body of every agent transmission is passed through `Localize(body, lang)`, which replaces whole names from the other language with the net's:

- Point callsigns: Delta ↔ דוד.
- When the net is Hebrew, also the Hebrew spellings of NATO words from `radio.spelledOut`: דלתא or דלתה → דוד (see [[Map Point Letters]]).
- Squad class callsigns: Viper ↔ צפע, and so on.
- Hammer ↔ פטיש, Anvil ↔ סדן, All stations ↔ כל התחנות, Target ↔ מטרה.

Rules of the replacement: longest name first; only whole names (no letter of either alphabet directly before or after); a Hebrew prefix letter glued to the front (ל ב מ ה ו כ ש) is kept, so "נסוג לדלתא" becomes "נסוג לדוד". Case is ignored.

Hammer's own text is **not** localized or rewritten by the server: it is logged as sent. (At strictness level 1 the page tidies it before sending; see [[Hints and Tidy Step]].)

Descriptive point names ("the town" / "העיירה") and landmark names are not translated by `Localize`; only callsigns are.

## What the agents know

`agents/agent.mjs` keeps `netLang`:

- At start: the language of Hammer's last message in the log from `hello`, else `hello.netlang`.
- Updated by a `netlang` frame, and by a `direct` frame (which carries the commander's language) — so a squad sent by hand before a word was said reports in the right language (commit `8830e24`: "Agents learn the commander's language from the page, before a word is said").
- Each wake tells the agent which language the net is in (commit `e1f3f79`).

## The page's language versus the net's

The page's interface language (`callsign.lang` in `localStorage`, or `?lang=`, or the browser's language) is separate from the net's, but it seeds the net through the `lang` frame, and a call typed in the other language then switches the net. Radio messages carry names in both languages (`from.en`, `from.he`), so the log can show a station's callsign in the page's language. Interface strings are covered in [[i18n Rules]].

## Why

| Commit | Date | Reason given |
|---|---|---|
| `e1f3f79` | 2026-11-24 | "Replies no longer mix a Hebrew call with an English body: the server composes in the commander's language and each wake tells the agent which one it is" |
| `04068d4` | 2026-11-24 | "The net says a point's and a squad's name in its own language: דוד, not Delta or דלתא" |
| `8b35479` | 2026-11-24 | The page tells the game its language, so the first base cues come in it |
| `8830e24` | 2026-11-26 | Agents learn the commander's language from the page before a word is said |

`CLAUDE.md` requires Hebrew and English to be first-class from the first commit; this mechanism is how the radio honours that.

## Related

- [[Radio Net]]
- [[Radio Routing]]
- [[Map Point Letters]]
- [[Callsigns]]
- [[Procedure Words]]
- [[Base Cues]]
- [[i18n Rules]]
- [[Pronunciation Table]]
- [[Agent Loop]]
- [[Decision - Language and Radio]]
