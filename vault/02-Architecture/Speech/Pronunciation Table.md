---
title: Pronunciation Table
description: "tts/pronounce.json pins the radio's own Hebrew words to one reading each, written in the phonetic alphabet the voice model takes."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/code
  - area/architecture
  - topic/speech
  - topic/tts
  - topic/hebrew
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Map Point Letters]]"
  - "[[Places on the Radio]]"
  - "[[Base Cues]]"
  - "[[Heroes]]"
  - "[[Tech Buildings]]"
  - "[[Voice Pipeline (STT and TTS)]]"
  - "[[Text to Speech Service]]"
  - "[[Procedure Words]]"
  - "[[Callsigns]]"
  - "[[Glossary]]"
paths:
  - tts/pronounce.json
  - tts/pronounce.py
  - tts/test_pronounce.py
  - client/speech/text.js
  - shared/rules.json
---

# Pronunciation Table

`tts/pronounce.json` pins the radio's own Hebrew words to one reading each, written in the phonetic alphabet the voice model takes. It exists because the Hebrew reader guesses vowels from context and gets names wrong (Alef as "elef", Samech as "semach").

## How it is applied (`tts/pronounce.py`, `fix`)

1. The Hebrew reader turns text into phonemes word for word, so its output lines up with the text.
2. For every word of the message that is in the table, the matching phoneme word is rewritten to the table's reading.
3. The word is found by its consonants (`_skeleton`): only vowels and stress change. A prefix glued to the front (one or two of ו ב ל מ ה ש כ) keeps the phonemes the reader gave it, so "ובאלף" becomes "ube" + the pinned "ʔˈalef".

Safeguards:

| Case | What happens |
|---|---|
| Word counts of text and phonemes differ | The whole line is left alone |
| A spelled-out number equals a name (1000 is "אלף") | That word is left alone (counted against the message as written) |
| Entry has `"last": true` | Applied only to the final word of the message (עבור as the closing word, not "עבור" meaning "for") |
| Entry has `"before": <word>` | Applied only when that word follows (אמור only before שנית) |
| Language has no table | Returned unchanged; only `he` has entries |

The table has 63 Hebrew entries. English has none.

## Representative entries

| Group | Hebrew | Pinned reading | Note |
|---|---|---|---|
| Procedure | סוף | `sˈof` | "Out"; read "sof" wherever it stands (commit 01c222b) |
| Procedure | עבור | `ʔavˈoʁ` | "Over"; only as the last word |
| Procedure | רות | `ʁˈut` | "Roger" |
| Procedure | יבוצע | `jevutsˈa` | in "רות יבוצע" (Wilco) |
| Procedure | המתן | `hamtˈen` | "Stand by" |
| Procedure | אמור | `ʔemˈoʁ` | only before שנית ("Say again") |
| Stations | פטיש / סדן | `patˈiʃ` / `sadˈan` | Hammer / Anvil |
| Stations | צפע, קרנף, בז, כריש | `tsˈefa`, `kaʁnˈaf`, `bˈaz`, `kaʁˈiʃ` | Viper, Rhino, Hawk, Shark |
| Stations | רפאים, עורב, שביט | `ʁefaʔˈim`, `ʔoʁˈev`, `ʃavˈit` | the `ghost`, `raven`, `comet` callsign classes |
| Map points | אלף, בועז, גימל, דוד, הגר, פסל, כרמל, סמך, זאב | for example `ʔˈalef`, `davˈid`, `sˈameχ`, `zeʔˈev` | see [[Map Point Letters]] |
| Map points | לאה, משה, נשר, תמר, יואב, ואו | for example `leʔˈa`, `nˈeʃeʁ` | points of the larger maps |
| Rank | סמל | `samˈal` | "sergeant", not "semel" (commit 25efe83) |
| Abbreviation | סוללת, נון, מם | `solelˈat`, `nˈun`, `mˈem` | "סוללת נ"מ" is said "solelat nun-mem" (commit 20ddecb); the page rewrites נ"מ to "נון מם" first |
| Places | גשר, בונקר, חורבה, חורשה, סלעים, חומה, הריסות | for example `ɡˈeʃeʁ` | landmark words, see [[Places on the Radio]] |
| Base cues | הושלמה, נפתחו, מחסור, מותקף, מתקיפים, איבדנו, בידינו, זהב | for example `zahˈav` | words of the fixed cue lines, see [[Base Cues]] |
| Heroes and tech | זקיף, חוזה, גיבור, בוחן, מרפאה, מוסך | for example `zakˈif` | see [[Heroes]], [[Tech Buildings]] |

## Tests (`tts/test_pronounce.py`, `make tts-test`)

No models are needed. The tests hold that names get the table reading and keep their prefix, that "Over" is fixed only as the closing word, that a spelled-out number is not taken for a name, that text which does not line up is left alone, and that foreign words keep their tags.

One test is a tripwire against `shared/rules.json`: every Hebrew word of every map point callsign (all three maps), every landmark word, every class callsign, the player and the operator must be in the table. The one exception is "בית", which is read two ways (bayit, and beit in "בית זיקוק") and is left to the reader.

## The browser fallback has its own small table

When the service has no recording in time, the device's own voice speaks. `client/speech/text.js` (`pointedWords`) writes 13 words with vowel points so that voice reads them right: סוף, עבור, רות, צפע, קרנף, שביט, סדן, פטיש, סמל, המתן, סוללת, נון, מם.

## Keeping it current

Adding a callsign, map point or landmark word in `shared/rules.json` fails `make tts-test` until the word is added here. After changing the table, bump `VERSION` in `tts/server.py` so cached audio is not reused.

## Related

- [[Voice Pipeline (STT and TTS)]]
- [[Text to Speech Service]]
- [[Procedure Words]]
- [[Callsigns]]
- [[Map Point Letters]]
- [[Glossary]]
