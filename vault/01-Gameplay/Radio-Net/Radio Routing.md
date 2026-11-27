---
title: Radio Routing
description: "Routing is done by code: a transmission is taken apart by matching callsigns, the marker and the ending word in both languages, and delivered to the stations it names."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/code
  - area/gameplay
  - topic/radio
  - topic/routing
  - topic/server
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Callsigns]]"
  - "[[Procedure Words]]"
  - "[[Hints and Tidy Step]]"
  - "[[Net Language]]"
  - "[[Command Net and Squad Net]]"
  - "[[Report Suppression]]"
  - "[[Initiative - Orders, Fight and Purse]]"
  - "[[Agent Loop]]"
  - "[[Traffic Levels]]"
  - "[[Base Cues]]"
paths:
  - server/radio/radio.go
  - server/radio/radio_test.go
  - server/room/room.go
  - server/room/ws.go
  - server/room/tools.go
  - client/debug.js
  - client/i18n/en.json
---

# Radio Routing

Routing is done by code: a transmission is taken apart by matching callsigns, the marker and the ending word in both languages, and delivered to the stations it names. No language model reads a message to decide who it is for (package comment of `server/radio/radio.go`: "No model is involved").

## The two entry points

| Sender | Path | Procedure written by |
|---|---|---|
| Hammer (the page) | `{"type":"radio","text":...,"strict":1..3}` → `Room.SayAt` | The player; checked against the strictness level |
| Anvil and squad leaders | `radio` tool `{to, body, end, lang?, kind?}` → `Room.toolRadio` | The server: `Net.Compose` builds the call, then it is parsed again |

An agent that tries to send a `radio` frame is refused: "agents transmit with the radio tool".

## Parsing, step by step (`Net.parse`)

1. Trim. Empty text is `ErrEmpty` ("nothing to send"). The text is lower-cased for matching.
2. **Addressees.** Read callsigns from the front, one after another, skipping spaces and commas, and after the first also "and ", "&" or the Hebrew glued ו. Each is a fixed name or a class word with a number (see [[Callsigns]]). All of them go into `To`.
3. **Marker.** Skip separators (space, tab, newline, `, . : ; -` and dashes). If the next words are "this is" or "כאן" followed by a word boundary, a sender callsign must follow; if none does, `ErrNoSender` ("say who you are after \"this is\""). The sender goes into `From`.
4. **No marker.** The addressees still count when the mode is relaxed, or when a separator other than a space follows them ("Viper 2, hold Foxtrot"). Otherwise the front callsigns are treated as part of the message and `To` is emptied.
5. **Ending.** `Net.ending` strips a closing Out or Over (see [[Procedure Words]]); "over and out" in any spelling is `ErrOverAndOut`.
6. **Body.** What is left, trimmed of separators.
7. **Extras.** Procedure words, map points and landmarks named in the body (`Prowords`, `Points`, `Landmarks`).
8. **Language.** The marker decides ("כאן" → `he`, "this is" → `en`); with no marker, any Hebrew letter in the text makes it `he`, otherwise `en`.

A word boundary means the text ends or the next rune is neither a letter nor a digit, so "Viper 22x" or "Hammerhead" are not callsigns.

## Strictness levels (Hammer only)

The player picks a level in the page settings (`#strict`, stored as `callsign.strict`, default 1). Constants `Relaxed`, `Standard`, `Strict` in `server/room/room.go`.

| Level | English label | Hebrew label | What is required | Refusal |
|---|---|---|---|---|
| 1 | Relaxed | חופשי | A callsign and the order are enough ("Viper 1 attack Delta"). With no callsign the message goes to Anvil | – |
| 2 | Standard | רגיל | The opening call: addressee and "this is Hammer" | `ErrNoCall`: `start with the call: "<to>, this is <you>"` |
| 3 | Strict | מחמיר | The call and a closing Over or Out | `ErrNoCall`, `ErrNoEnding`: "end the transmission with Over or Out" |

Details from `SayAt`:

- Level 1 uses `ParseRelaxed`; levels 2 and 3 use `Parse`. A frame with no `strict` field is level 1.
- At every level, naming yourself as someone else is refused: "you are Hammer, not <name>".
- At level 1 the page also runs a tidy step on the text before sending, which corrects a roughly spelled callsign or place (`tidy` in `client/debug.js`; see [[Hints and Tidy Step]]). Levels 2 and 3 send the text as written.
- A refused call comes back to that client alone as `{"type":"refused","text":...,"reason":...}`.

Introduced in commit `350e1c0` (2026-11-24); typed relaxed calls are sent as written since `99e245c`.

## Delivery (`Room.transmit`)

1. Refuse if the match is over.
2. For each addressee: a squad must be a living squad of that side ("no station Viper 9 on this net"); a station cannot call itself.
3. Record the language against each addressee (see [[Net Language]]).
4. `classify` gives kind, net and level, or drops the line (see [[Command Net and Squad Net]], [[Report Suppression]]).
5. `noteCall` records whom Hammer or the operator called (see [[Initiative - Orders, Fight and Purse]]).
6. The message gets the next sequence number, is appended to the side's log and broadcast to **every client of that side** as a `radio` frame. Routing by addressee happens on the receiving end: each agent sees the `to` list and wakes only for what concerns it (see [[Agent Loop]]).
7. For Hammer's own transmissions, `heardHammer` then checks for the fixed hand-over phrases.

## The message as sent to clients

| Field | Meaning |
|---|---|
| `seq`, `tick` | Order on the net and the simulation tick |
| `from`, `to` | Names: stable `key`, `en`, `he`, and the squad id for squads |
| `lang` | `en` or `he` |
| `text` | The full transmission as sent |
| `body`, `end` | The message without call and ending; `over`, `out` or empty |
| `prowords`, `points`, `landmarks` | What the parser found in the body |
| `kind`, `net`, `level` | See [[Command Net and Squad Net]] and [[Traffic Levels]] |
| `cue` | Set to the cue's key on a base cue (see [[Base Cues]]) |
| `final` | Set on the sign-off at the end of a match |

Field names beyond these: not verified here; see `Message` in `server/room/room.go`.

## Agents' side of routing (`toolRadio`)

- `to` may be one callsign or a list; each must resolve exactly (`Net.Resolve`), else `unknown callsign "<x>"`.
- The language is chosen by the server (see [[Net Language]]); names in the body are put into that language (`Net.Localize`).
- `Compose` drops a call or an ending the writer put into the body by habit, then writes the proper ones.
- `kind` is accepted only when it is one of contact, objective, loss, status, ack.
- A line the net drops returns `{"sent":"","dropped":"<why>"}`, not an error.

## Related

- [[Radio Net and Bilingual Procedure]]
- [[Procedure Words]]
- [[Callsigns]]
- [[Places on the Radio]]
- [[Command Net and Squad Net]]
- [[Net Language]]
- [[WebSocket Frames]]
- [[Agent Tools]]
- [[Radio Console]]
- [[Decision - Language and Radio]]
