---
title: Decision - Language and Radio
description: "Hebrew and English are both first-class from the first commit, all radio talk follows real radio procedure in both languages, map points use only letters shared by the NATO and IDF alphabets, and ..."
type: decision
status: current
tags:
  - type/decision
  - status/current
  - agent/CLD
  - origin/mixed
  - area/decisions
  - topic/radio
  - topic/i18n
  - topic/hebrew
created: 2026-11-26
updated: 2026-11-27
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[i18n Rules]]"
  - "[[Map Rendering]]"
  - "[[Procedure Words]]"
  - "[[Radio Routing]]"
  - "[[Hints and Tidy Step]]"
  - "[[Map Point Letters]]"
  - "[[Net Language]]"
  - "[[Callsigns]]"
  - "[[Locked Decisions]]"
  - "[[Radio Net and Bilingual Procedure]]"
paths:
  - CLAUDE.md
  - docs/PLAN.html
  - shared/rules.json
  - client/i18n/en.json
  - client/i18n/he.json
  - client/i18n.test.mjs
  - server/radio/radio.go
  - server/radio/radio_test.go
---

# Decision - Language and Radio

Hebrew and English are both first-class from the first commit, all radio talk follows real radio procedure in both languages, map points use only letters shared by the NATO and IDF alphabets, and radio routing is done by code, never by a language model. These four rules are the "Language and radio" section of `CLAUDE.md`.

## The decision as written

> - Hebrew and English are first-class from the first commit. All strings in `client/i18n/he.json` and `en.json`; a missing key fails the build. UI mirrors for RTL; the map never mirrors.
> - All radio talk follows real procedure: "<to>, this is <from>…", Over / Out (never "over and out"), Roger, Wilco, Say again, Stand by, Correction, Radio silence. Hebrew: עבור, סוף, רות, רות יבוצע, אמור שנית, המתן, תיקון, דממת אלחוט.
> - Map points use only letters shared by NATO and the IDF alphabet (Foxtrot = פסל, Kilo = כרמל, Sierra = סמך…). Never use ר for a point. Callsigns: Hammer/פטיש (player), Anvil/סדן (operator), Viper/צפע, Rhino/קרנף, Hawk/בז, Shark/כריש.
> - Radio routing is done by code (callsign match in both languages), never by an LLM.

| | |
|---|---|
| Date | 2026-11-23 (`e21e0cb`) |
| Decided by | the plan (`docs/PLAN.html`, sections Mike and Quebec) |
| Replaced | nothing |

## The reasons recorded

From the plan:

- ר is never a point because its IDF word, רות, also means Roger.
- No callsign is a word from either phonetic alphabet, so a squad never sounds like a map point; "Eagle / נשר" and "Wolf / זאב" were dropped for that reason.
- Routing in code is instant and needs no AI; only the message content goes to the agents.
- No text is baked into images, so one sprite serves both languages.

## How the code stands

| Rule | Code |
|---|---|
| Both string files, a missing key fails the build | `client/i18n/en.json` and `he.json` have 616 lines each; `client/i18n.test.mjs` runs in `make test` ([[i18n Rules]]) |
| RTL mirrors, the map never | [[i18n Rules]], [[Map Rendering]] |
| Procedure words | `radio.prowords`, `marker`, `over`, `out` in `shared/rules.json`; the parser refuses "over and out" (`ErrOverAndOut`) ([[Procedure Words]]) |
| How strictly the player is held to procedure | a setting with three levels, relaxed by default ([[Radio Routing]], [[Hints and Tidy Step]]) |
| Shared letters, never ר | twenty-one letters in use across the four maps (fifteen until the huge map of 2026-11-27); a test enforces the ר rule ([[Map Point Letters]]) |
| Routing by code | `server/radio/radio.go` ([[Radio Routing]]) |
| The net's language | the whole net speaks the language Hammer last used ([[Net Language]]) |

## Where the code has grown past the text

- More callsigns than listed: Ghost / רפאים and Raven / עורב (heroes), Comet / שביט (strike aircraft), Target / מטרה (an enemy squad in sight), Hauler / מוביל ([[Callsigns]]).
- More procedure words than listed: Affirmative / חיובי, Negative / שלילי, Radio check / איך נשמע, Five by five / חמש על חמש.
- More point letters than the plan's nine: L, M, N, T, V, Y. The plan's table gave Tango as טוב; the game uses תמר for Tango and נשר for November ([[Map Point Letters]]).
- The plan had "radio silence" and "correction" as mechanics, and "Repeat" for artillery; in the code the server only detects procedure words and leaves what follows to each station's brain; no such mechanic was found in the server ([[Procedure Words]]).

## Related

- [[Locked Decisions]]
- [[Radio Net and Bilingual Procedure]]
- [[Procedure Words]]
- [[Callsigns]]
- [[Map Point Letters]]
- [[i18n Rules]]
- [[Net Language]]
