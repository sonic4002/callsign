---
title: Procedure Words
description: "Every call on the net follows real radio procedure: '<to>, this is <from>."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/mixed
  - area/gameplay
  - topic/radio
  - topic/procedure
  - topic/hebrew
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Rule Brain]]"
  - "[[Prompts]]"
  - "[[Report Suppression]]"
  - "[[Radio Routing]]"
  - "[[Agent Loop]]"
  - "[[Stand By Behaviour]]"
  - "[[Radio Net and Bilingual Procedure]]"
  - "[[Callsigns]]"
  - "[[Net Language]]"
  - "[[Command Net and Squad Net]]"
paths:
  - shared/rules.json
  - server/radio/radio.go
  - server/radio/radio_test.go
  - server/room/room.go
  - server/room/traffic.go
  - CLAUDE.md
---

# Procedure Words

Every call on the net follows real radio procedure: "<to>, this is <from>. <message>. Over/Out." The words are data in `shared/rules.json` (`radio`), matched by code in `server/radio/radio.go` in both languages.

## The shape of a call

| Part | English | Hebrew | Rules key |
|---|---|---|---|
| Marker between addressee and sender | this is | כאן | `radio.marker` |
| Done talking, reply expected | Over | עבור | `radio.over` |
| Done talking, no reply expected | Out | סוף | `radio.out` |

`Net.Compose` writes calls in these two forms:

- English: `Hammer, this is Viper 2. Wilco. Out.`
- Hebrew: `פטיש, כאן צפע 2, רות, יבוצע, סוף.`

Several addressees are listed the way they are spoken: "Viper 1, Viper 2 and Rhino 1" / "צפע 1, צפע 2 וקרנף 1". A body that ends in `?` or `!` gets no extra full stop.

## The procedure words

From `radio.prowords`. The key is what code and messages use (`Parsed.Prowords`, the `prowords` field of a radio message).

| Key | English spellings | Hebrew spellings |
|---|---|---|
| `wilco` | wilco | רות, יבוצע / רות יבוצע |
| `roger` | roger | רות |
| `affirmative` | affirmative | חיובי |
| `negative` | negative | שלילי |
| `sayAgain` | say again | אמור שנית |
| `standBy` | stand by / standby | המתן |
| `radioCheck` | radio check | איך נשמע |
| `fiveByFive` | five by five / loud and clear | חמש על חמש |
| `correction` | correction | תיקון |
| `radioSilence` | radio silence | דממת אלחוט |

`Net.prowords` matches the longest spelling first and blanks it out, so "רות, יבוצע" counts as Wilco and not also as Roger. A word only counts when it stands alone (no letter or digit directly before or after).

The server only *detects* procedure words; what a station does on hearing one is up to its brain (see [[Rule Brain]] and [[Prompts]]). One exception is built into the net: a transmission whose body is Roger or Wilco and nothing else (`Net.BareAck`) is classified as an acknowledgement, and the operator's bare acknowledgement to a squad is not sent at all (see [[Report Suppression]]).

## Never "over and out"

`Net.ending` looks for a closing Out first. If an Over stands just before it — "over and out", "over & out", "עבור וסוף", "עבור, סוף" — parsing fails with `ErrOverAndOut`: `end with "Over" or with "Out", never both`. This is enforced for every transmission that is parsed:

- Hammer's text at every strictness level: the page gets a `refused` frame with that reason.
- Agents' bodies: `Compose` parses the body first, so a body ending "over and out" is an error returned to the `radio` tool. An agent's `end` argument must be exactly `over` or `out`.

The Hebrew glued form is handled: "וסוף" (and-Out) is recognised as the Out.

## When an ending is required

| Who | Rule |
|---|---|
| Agents | Always: `Compose` refuses a call without `end` of `over` or `out`, and drops an ending the writer put in the body by habit before adding the right one |
| Hammer, strictness 1 and 2 | Optional. A call with no ending is sent as written, with `end` empty |
| Hammer, strictness 3 | Required: `ErrNoEnding` ("end the transmission with Over or Out") |

See [[Radio Routing]] for the strictness levels.

## What the ending means to the listeners

Not enforced by the server beyond the above; behaviour from the agents' side (not re-verified here, see [[Agent Loop]]): commit `424406e` made squads act on Anvil's orders that end with Out, and commit `5e2ae00` made agents say "Stand by" only after a long wait (see [[Stand By Behaviour]]).

## Differences from the docs

- `CLAUDE.md` lists the Hebrew words as עבור, סוף, רות, רות יבוצע, אמור שנית, המתן, תיקון, דממת אלחוט. The code has all of these and adds חיובי, שלילי, איך נשמע and חמש על חמש.
- Squads sent by hand answer with a fixed body written in `server/room/act.go`: "Wilco" in English and "יבוצע" (without רות) in Hebrew. That Hebrew body does not match the `wilco` spellings in the rules (רות, יבוצע / רות יבוצע), so `BareAck` does not see it as a bare acknowledgement. The sending code passes the tag `ack`, but `classify` applies a tag of `ack` only to a body that is a bare acknowledgement, so in Hebrew this line is classified `status` (or `answer` if Hammer has just called that squad) rather than `ack`. It is still shown at level 1, because the squad is Hammer's own. Read from the code; not confirmed by a test.

## Related

- [[Radio Net and Bilingual Procedure]]
- [[Radio Routing]]
- [[Callsigns]]
- [[Net Language]]
- [[Command Net and Squad Net]]
- [[Pronunciation Table]]
- [[Decision - Language and Radio]]
- [[Glossary]]
