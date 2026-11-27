---
title: i18n Rules
description: "Hebrew and English are both first-class: every text of the page comes from client/i18n/he.json or client/i18n/en.json, and a test fails the build when the two disagree or a key is missing or unused."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/mixed
  - area/architecture
  - topic/client
  - topic/i18n
  - topic/hebrew
  - topic/rtl
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Procedure Words]]"
  - "[[Base Cues]]"
  - "[[Service Worker and Install]]"
  - "[[Net Language]]"
  - "[[Rule Brain]]"
  - "[[Command Grammar]]"
  - "[[Map Rendering]]"
  - "[[Client]]"
  - "[[Decision - Language and Radio]]"
  - "[[Callsigns]]"
paths:
  - client/i18n/en.json
  - client/i18n/he.json
  - client/i18n.test.mjs
  - client/debug.js
  - client/index.html
  - client/map.js
  - client/mobile.css
  - client/testdata/radio-calls.json
  - CLAUDE.md
---

# i18n Rules

Hebrew and English are both first-class: every text of the page comes from `client/i18n/he.json` or `client/i18n/en.json`, and a test fails the build when the two disagree or a key is missing or unused. The interface mirrors for Hebrew (right to left); the map never mirrors.

## The two string files

- Flat JSON objects, one key per string, 614 keys each at the time of writing. Placeholders are `{name}`.
- Keys are dotted by area. The largest groups: `help.*` (133), `lobby.*` (69), `monitor.*` (65), `event.*` (46), `tut.*` (26), `brains.*` (20), `call.*` (19), `order.*` (16), `placer.*` (16), `structure.*` (14), `act.*` (13), `command.*` (12), `voice.*` (11).
- Names of game things (factions, units, structures, points, callsigns, maps, tiers, tech buildings) are **not** in these files: they come from `shared/rules.json`, where each has `{en, he}`. The fixed radio lines (procedure words, base cues, the rule brain's phrases) are also in `rules.json` under `radio` ([[Procedure Words]], [[Base Cues]]).

## How the page uses them (`client/debug.js`)

| Mechanism | Detail |
|---|---|
| `t(key, vars)` | Looks the key up in the current language and fills `{placeholders}`. A missing key **throws** (`missing string "<key>" in <lang>.json`) |
| `data-i18n="key"` | Element text; also `data-i18n-placeholder` and `data-i18n-aria` |
| `labels()` | Sets `<html lang>` and `dir` (`rtl` for Hebrew), the title, and every `data-i18n*` element |
| Choosing the language | `?lang=he\|en` in the address, else `localStorage` `callsign.lang`, else Hebrew if the browser's language starts with `he`, else English |
| Switching | The language button flips it at any time: every list is redrawn from data, the manifest changes ([[Service Worker and Install]]), the other language's speech model is prepared, and the server is told with a `lang` frame so unasked lines (the operator's base cues) come in it ([[Net Language]]) |

`index.html` contains no user-facing text at all: the only literal word is the fallback `<title>Callsign`.

## The test that fails the build (`client/i18n.test.mjs`)

Run by `make test` (`node --test`). Five checks:

1. **Same keys, same placeholders.** `he.json` and `en.json` have identical key sets; no value is empty; each pair has the same `{placeholders}`; the Hebrew title contains Hebrew letters and the English one does not.
2. **Every key used exists, every key is used.** Keys are collected from `data-i18n*` attributes, from quoted strings in the first argument of `t(…)` and `system(…)` in every `.js` file of `client/` and `client/brains/`, from `strings.en.<key>`, and from a table of keys built at run time (`dynamic`: `event.`, `order.`, `call.`, `tut.`, `monitor.state.`, … each with its allowed values). A key used but missing fails; a key present but never used fails too.
3. **No literal text in the page.** After stripping tags, comments, scripts and styles, the only words left in `index.html` must be `Callsign`.
4. **Calls are proper procedure.** Every `call.*` template, in both languages, must open with `<to>, <marker> <from>` (this is / כאן) and end with Over (עבור), using the words from `rules.radio`.
5. **The rule brain understands them.** Every call the page writes, and the calls for what the panel now does directly (`client/testdata/radio-calls.json`), is run through the rule-brain operator and squad leader in both languages and must produce the right tool use (buy, build on a spot, build a turned fence, cancel, rally, sell, repair, haul, hold/move/attack). See [[Rule Brain]] and [[Command Grammar]].

Differs from CLAUDE.md only in wording: it says "a missing key fails the build"; there is no build, so the test is the gate, and at run time a missing key throws.

## Right to left

- The whole document switches direction; layout CSS uses logical properties (`inline-start`, `inset-inline`, `padding-inline`, `block-size`) so the sidebar, panels and sheets mirror by themselves.
- **The map never mirrors.** `canvas#map`, `canvas#radar-map`, the zoom buttons and the lobby's map pictures carry `dir="ltr"`; the projection has no language input ([[Map Rendering]]). West is always on the left, and the compass shows it in both languages.
- Numbers, clocks, gold, percentages and codes sit in `<bdi dir="ltr">` so they read left to right inside Hebrew; on the canvas the same is done with Unicode isolate marks (`⁦…⁩`) around `+15`, `62%`, `×3`.
- The radio box: empty, it follows the page so the placeholder reads right; with text it is `dir="auto"`, so each call follows its own first letter. Log lines are shown as transmitted, in the language they were sent in.
- A name plate on the map takes its direction from its own script.
- Physical exceptions are deliberate and commented: the large-touch-screen talk button is on the physical right in both languages; phone safe-area insets are swapped for RTL in `mobile.css`.
- Icons that could need mirroring are drawn shapes with nothing to mirror (the cue beacon, rank stars, power bolt).

## Speech language versus page language

What the net speaks follows the language Hammer last used, not the page ([[Net Language]]). Push-to-talk listens in the page language. The page decides whether a typed call is Hebrew by looking for Hebrew letters (`speaks()`), for the tidy step.

## Adding or changing a string

1. Add the key to **both** `en.json` and `he.json` with the same placeholders.
2. Use it through `t("key")` or `data-i18n`; if the key is built at run time, add its values to `dynamic` in `i18n.test.mjs`.
3. Remove keys that are no longer used; the test refuses leftovers.
4. Run `make test`.

## Related

- [[Client]]
- [[Decision - Language and Radio]]
- [[Net Language]]
- [[Procedure Words]]
- [[Callsigns]]
- [[Map Point Letters]]
- [[Glossary]]
- [[Tests and Headless Matches]]
