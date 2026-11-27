---
title: Hints and Tidy Step
description: "A radio call has a fixed frame and a closed set of names, and the game uses that twice: before recognition it tells the recogniser what to expect (hints), and after recognition it puts the net's ..."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/code
  - area/architecture
  - topic/speech
  - topic/stt
  - topic/voice
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[In-Browser Recognition]]"
  - "[[Recognition Evaluation]]"
  - "[[Radio Routing]]"
  - "[[Speech Recognition]]"
  - "[[Voice Pipeline (STT and TTS)]]"
  - "[[Server Whisper]]"
  - "[[Callsigns]]"
  - "[[Map Point Letters]]"
  - "[[Procedure Words]]"
  - "[[Places on the Radio]]"
paths:
  - client/voice/hints.js
  - client/voice/normalize.js
  - client/voice/transducer.js
  - client/voice/voice.test.mjs
  - client/debug.js
  - stt/server.py
  - stt/eval/RESULTS.md
  - shared/rules.json
---

# Hints and Tidy Step

A radio call has a fixed frame and a closed set of names, and the game uses that twice: before recognition it tells the recogniser what to expect (hints), and after recognition it puts the net's own spelling on callsigns and map points (tidy). Both are built from `shared/rules.json` and the current map, never from a hand-kept word list.

## Hints (`client/voice/hints.js`)

| Function | Output | Used by |
|---|---|---|
| `hintWords(rules, lang)` | The words: player, operator, all stations, contact ("Target"), hauler, every class callsign, every point of this map, the marker ("this is" / כאן), Over, Out and the first form of each procedure word | Base for the other two; the "word list" row of the evaluation |
| `hintPhrases(rules, lang)` | The same list; in Hebrew also the glued forms: ו + each station ("וקרנף") and ל, ב, מ + each point ("לכרמל") | The Hebrew model in the browser, as its phrase bonus ([[In-Browser Recognition]]) |
| `hintCalls(rules, lang)` | The vocabulary written as radio traffic: one call to each kind of squad with a rotating order (Move to / Hold / Attack a point), one to the operator and one to all stations, then the remaining names as a list | The server's Whisper, as `hints` (its `initial_prompt`) |

Why traffic and not a list: Whisper takes its hint as "what was said just before" and follows its spelling and punctuation as well as its words. Written as calls in the form the page itself writes, Hebrew exact calls rose from 76% to 91% ([[Recognition Evaluation]]). The server cuts hints at 600 characters.

One cost was seen in the measurements: a noisy "Buy one vehicle squad" once came back as "Viper 1, vehicle squad", a callsign taken from the hint.

## Tidy (`client/voice/normalize.js`)

`tidy(heard, { lang, rules, typed, careful })` picks the repair:

- `normalize` when the marker ("this is" / כאן) was said: the frame is found first ("<to>, this is <from> ... over"), then each slot is matched to the names it can hold.
- `relaxed` otherwise ("vapour two attack gulf"), and always for typed text.

### What it rewrites

| Slot | Rule |
|---|---|
| Addressee (before the marker) | Each word is matched to the operator and class callsigns by sound (`similarity` at least 0.45); a number word or a homophone ("won", "too", "for", אחד, שתיים) becomes its digit; "all stations" is matched whole (0.7). Several addressees are joined with "and" / ו. |
| Sender (after the marker) | The first word is replaced by the player's own callsign if it sounds at all like it (0.4): "the player is the only one who talks here". |
| Closing word | The last word becomes Over / Out (עבור / סוף) if it sounds like one (0.8). A closing word written twice is one (commit e1c87fd). |
| Map points in the body | A word that sounds like a point's callsign gets the map's spelling (0.75); a name heard as two words ("fox strut") is joined; Hebrew prefix letters stay glued ("לכרמל"); a bare Hebrew letter with a geresh ("א'") becomes the point named after it, read from the letter (commit c2d6975). |
| Enemy contacts | "target three" becomes "Target 3". |
| Relaxed form | A first word that sounds like a class callsign (0.6) and is followed by its number is respelled; the number may be set off by commas ("Viper, too, hold Delta" is Viper 2); the operator's name must be close to exact (0.8). |
| English only | A body opening with "by" becomes "buy". |

`sound()` reduces a word to rough consonant classes (so "vapour" and "viper" come out alike); similarity is 75% sound and 25% spelling.

### What it never rewrites

- Nothing here guesses a missing "Over". Anything that matches nothing is left as heard.
- A station's own name is never a place ("צפע" is not "זאב"), nor the words of a unit's name ("Militia cell" is not Kilo); a callsign inside the message is never respelled as a map point (commit b649142).
- The words of procedure and of command are never respelled as map points ("Run the fight" is not "Lima the fight") (commit 7eca980).
- The `notPlaces` list: ordinary words that sound like a point (hold, gold, go, all, out, over, זהב, סוף, ...), the words a place is described with (grove, house, bridge, north, מטר, ...), and the order words for selling, repairing and power.
- Words shorter than three letters.
- **Typed text** (`typed`): only a misspelled callsign at its front is put right; the rest is sent as the player wrote it, because matching by sound "on typed words only does harm" ("זהב" is not "זאב") (commit 99e245c).
- **Careful mode** (`careful`, used when the server transcribed): a word becomes a map point only when it reads aloud as that point's name and is spelled within one or two letters of it (`sameName`): "קרמל" is כרמל and "Gulf" is Golf, but "עוד" is not דוד and "carry" is not Kilo.

### When it runs

| Input | Tidied? |
|---|---|
| A spoken call | Always, before it is put in the box and sent |
| The radio box at strictness 1 (Relaxed) | Yes; typed text in `typed` mode |
| The radio box at strictness 2 or 3 | No |
| Calls the page writes itself (map orders, buttons) | Pass through unchanged; tests hold this for every help example on every map |

The server parses whatever arrives by callsign match; see [[Radio Routing]]. Strictness levels are in [[Speech Recognition]].

## Related

- [[Voice Pipeline (STT and TTS)]]
- [[Speech Recognition]]
- [[Server Whisper]]
- [[In-Browser Recognition]]
- [[Recognition Evaluation]]
- [[Callsigns]]
- [[Map Point Letters]]
- [[Procedure Words]]
- [[Places on the Radio]]
- [[Command Grammar]]
