---
title: Command Grammar
description: "The command grammar (agents/rule-grammar.mjs) is how a squad leader without a model understands a radio call in Hebrew or English."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/mixed
  - area/architecture
  - topic/brains
  - topic/rule-brain
  - topic/grammar
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Rule Brain]]"
  - "[[Fast Brain - Jev]]"
  - "[[AI Brains and Model Relay]]"
  - "[[Squad Leaders]]"
  - "[[Radio Routing]]"
  - "[[Places on the Radio]]"
  - "[[Procedure Words]]"
  - "[[Hints and Tidy Step]]"
  - "[[Tests and Headless Matches]]"
paths:
  - agents/rule-grammar.mjs
  - agents/rule-leader.mjs
  - agents/test/rule.test.mjs
  - agents/test/orders.mjs
  - agents/test/fixtures/orders.json
  - tools/parsecalls/main.go
  - docs/research/2026-11-24-jev-decision-model.md
---

# Command Grammar

The command grammar (`agents/rule-grammar.mjs`) is how a squad leader without a model understands a radio call in Hebrew or English. It turns one call into exactly one *intent*, or into a "Say again" that names what it nearly understood; it never guesses.

Both the [[Rule Brain]] and the [[Fast Brain - Jev]] use it; the fast brain asks its model only when the grammar returns `unclear`.

## Three steps

1. **Find the order words** (`scan`). Each order class has a list of ways to say it in each language, including the usual slips of a speech recogniser. Longer entries match first and are blanked out ("take out" is an attack, never "take"). What is left is compared word by word by sound (English) or spelling (Hebrew).
2. **Read what the order is about**: map points and landmarks (already found by the server's radio net and delivered on the call as `points` and `landmarks`), an enemy squad by name ("Target 7" / "מטרה שלוש"), a structure, a bearing.
3. **Put them together** (`understandLeader`) into one intent.

Word order and polite filler do not matter. A negated word is not an order ("don't stop to fight", "אל תתקפו").

## Order classes (`leaderWords`)

| Class | English examples | Hebrew examples | Recogniser slips accepted |
|---|---|---|---|
| `attack` | attack, assault, destroy, engage, take out, open fire, bomb | תקוף, השמד, חסל, הסתער, הפצץ, פתח באש | "a tack", "attic", "a tech"; תכוף, טקוף |
| `move` | move, go, advance, head, proceed, push, cross | נוע, זוז, התקדם, לך, סע, טוס, חצו | "moo", "movie", "mauve"; נוא, נעו |
| `hold` | hold, defend, secure, guard, take, capture, occupy | החזק, הגן, אבטח, שמור, תפוס, כבוש | "hole", "holt", "hauled" |
| `fallBack` | fall back, retreat, withdraw, RTB, pull out | נסוג, סגו, חזור, התקפל, הביתה | "full back", "fall bag" |
| `cover` | take cover, get down, hide, shelter | תפסו מחסה, התחבא, הורידו ראש | |
| `enter` | get in, go inside, enter, garrison | היכנס, כנסו, אייש, לתוך | |
| `leave` | leave, exit, come out, vacate | צאו מה, עזבו, פנו את | |
| `stop` | stop, halt, hold position, stay put, freeze | עצור, עמוד, חכו, המתינו | |
| `dig` | dig in, fortify, entrench, sandbags | התבצר, התחפר, שקי חול | |
| `repair` | repair, fix, mend, rebuild | תקן, שקם, שפץ | |
| `capture` | capture, take over, seize, occupy | השתלט, כבוש את, תפוס את | |
| `plant` | plant, demolish, blow up, charge | הנח, מטען, פוצץ | |
| `seize` | seize, hijack, take over, steal | השתלט, חטוף | |
| `report` | report, status, sitrep, where are you | דווח, מה המצב, איפה אתם, תמונת מצב | |

Matching rules: English entries match as whole words. Hebrew entries are stems: they match at the start of a word, behind "ו" or "ש", with any ending; an entry starting with `=` must be the whole word.

### Matching by sound

A leftover word of four letters or more that is not a plain word or a name from the rules is scored against every single-word entry. English uses `sound()` (rough consonant classes, so "hauled" and "hold" come out alike) weighted 0.75 with 0.25 spelling, and needs 0.8; Hebrew uses spelling distance and needs 0.75. A word that sounds like two different orders within 0.05 is not taken. `nearMiss` (threshold 0.6) feeds the "Say again" that names the order it nearly heard.

## Intents

Plain data: a `label`, a `kind` and one tool call or one line to say.

| Intent | Tool call |
|---|---|
| `move`, `hold`, `attack` (place) | `move` / `hold` / `attack` with `place` |
| `attackContact` | `attack` with `contact` |
| `repair`, `capture`, `plant`, `seize`, `fortify` | the tool of that name |
| `report` | a radio line built from the status |
| `say`, `negative` | a fixed line |
| `unclear` | "Say again" (`sayAgain`, `sayAgainWhich`, `sayAgainVerb`, `sayAgainWhere`, `sayAgainWhat`) |
| `none` | nothing (a call from another squad) |

## Reading rules worth knowing

- A hero's orders are read first: "plant" for a unit with `chargeDamage`, "seize" / "capture" for one with `seizeRadius`.
- "Dig in" builds a position where the squad stands; "go to the town and dig in" is to hold the town.
- "Capture" with an enemy structure named: engineers capture, others answer `why.onlyEngineersCapture`.
- Two points joined by "or" are a question back ("Say again: Delta or Foxtrot?"), not a choice.
- "from Delta to Foxtrot" goes to Foxtrot: a point right after "from" / "מ" is skipped.
- "north of Foxtrot" with no landmark: the whole call body is passed as the place and the game reads the words.
- "Fall back" with no place goes to the own headquarters. "Attack" with no target goes for the nearest enemy in sight (from level 2, one its weapon can hurt), else the enemy headquarters.
- "Escort the haulers" holds the field the haulers work.
- "Hold" alone is hold here; with leftover words the brain could not place, it asks where rather than stay put on a guess.
- More than one landmark fitting the words: "Say again: <the options>?".
- Hebrew names starting with "ה" are also found behind "ל", "ב", "מ" (`morePoints`).

## How it is tested and measured

`agents/test/fixtures/orders.json` holds **150 orders** to one squad (Viper 1, commandos, near Bravo) on the drill ground map: 85 English, 65 Hebrew.

| Kind | Meaning | EN | HE |
|---|---|---|---|
| T | taught: the Help examples and what the page's buttons write | 25 | 20 |
| P | loose paraphrase | 35 | 25 |
| A | damaged the way a speech recogniser damages a call | 25 | 20 |

Each order carries what the server's radio net reads from the text (`body`, `end`, `prowords`, `points`, `landmarks`), produced with `tools/parsecalls`, and the expected action.

`agents/test/rule.test.mjs` holds the grammar to: **every** taught sentence right in both languages; at least **90%** of all orders right; **zero** actions that were not ordered. `agents/test/orders.mjs` (`measure`, `score`) is shared with the live measurement of the fast brain.

Measured (from `docs/research/2026-11-24-jev-decision-model.md`, section 6; not re-run for this note): grammar alone 138 of 150 right (92%), 12 "Say again", 0 wrong. The research note itself warns the set was written by the grammar's author and four faults were fixed after it showed them.

## Related

- [[AI Brains and Model Relay]]
- [[Rule Brain]]
- [[Fast Brain - Jev]]
- [[Squad Leaders]]
- [[Radio Routing]]
- [[Places on the Radio]]
- [[Procedure Words]]
- [[Hints and Tidy Step]]
- [[Tests and Headless Matches]]
