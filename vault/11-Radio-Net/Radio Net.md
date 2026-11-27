---
title: Radio Net
description: "The radio net is how a commander (Hammer) talks to the operator (Anvil) and the squads, in Hebrew or English, with real radio procedure."
type: hub
status: current
tags:
  - type/hub
  - status/current
  - agent/CLD
  - origin/code
  - area/radio-net
  - topic/radio
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Procedure Words]]"
  - "[[Callsigns]]"
  - "[[Map Point Letters]]"
  - "[[Radio Routing]]"
  - "[[Command Net and Squad Net]]"
  - "[[Traffic Levels]]"
  - "[[Report Suppression]]"
  - "[[Base Cues]]"
  - "[[Initiative - Orders, Fight and Purse]]"
  - "[[Radio versus Direct Acts]]"
paths:
  - server/radio/radio.go
  - server/radio/places.go
  - server/radio/localize.go
  - server/room/room.go
  - server/room/traffic.go
  - server/room/cues.go
  - server/room/command.go
  - server/room/act.go
  - server/room/tools.go
  - shared/rules.json
  - client/nets.js
  - client/cues.js
---

# Radio Net

The radio net is how a commander (Hammer) talks to the operator (Anvil) and the squads, in Hebrew or English, with real radio procedure. Everything about it — who a call is for, how it ends, what it is about, whether it is shown or dropped — is decided by plain code over tables in `shared/rules.json`; no language model routes or classifies anything.

## How a transmission travels

1. The commander's page sends a `radio` frame with the text and a strictness level (`server/room/ws.go`). Agents never send raw text: they call the `radio` tool with `to`, `body` and `end`, and the server writes the procedure around the body (`Net.Compose`).
2. `server/radio` parses the text: addressees, sender, body, ending word, language, procedure words, map points and landmarks (`Net.Parse` / `Net.ParseRelaxed`).
3. The room checks the addressees exist on that side's net, then `classify` (`server/room/traffic.go`) gives the line a **kind**, a **net** (`command` or `squad`) and a **level** (1 to 3), or drops it.
4. The message is appended to the side's log and broadcast to that side only as `{"type":"radio","message":{...}}`. A side never receives the other side's net.
5. The page shows it on the command net or the squad net according to the player's traffic setting, and speaks only what the command net shows.

Each side has its own net, its own log and its own language. There is one `radio.Net` per room, built from the rules for that room's map (`radio.NewNet`).

## Notes in this area

| Note | What it covers |
|---|---|
| [[Procedure Words]] | Over, Out, Roger, Wilco and the rest, in both languages; "never over and out" |
| [[Callsigns]] | Hammer, Anvil, Viper, Rhino, Hawk, Shark, the hero and strike-aircraft callsigns, numbering |
| [[Map Point Letters]] | The letter points of each map, their Hebrew names, why ר is never a point |
| [[Radio Routing]] | The parser step by step, the three strictness levels, what is refused |
| [[Command Net and Squad Net]] | The two nets and the ten kinds of line |
| [[Traffic Levels]] | Quiet, Normal, Full and the level of every kind and cue |
| [[Report Suppression]] | One report per event; the windows in seconds |
| [[Base Cues]] | The operator's fixed lines about the base, all nineteen |
| [[Initiative - Orders, Fight and Purse]] | Who decides: orders-only, the fight handed over, the purse |
| [[Radio versus Direct Acts]] | What is said on the radio and what the commander does by hand |
| [[Places on the Radio]] | Points, landmarks, bridges, bearings, exact spots, Target N |
| [[Net Language]] | The net speaks the language Hammer last used; names in the net's language |

## Where the words live

| What | Where |
|---|---|
| Marker, Over, Out, procedure words | `shared/rules.json` → `radio.marker`, `radio.over`, `radio.out`, `radio.prowords` |
| Callsigns | `shared/rules.json` → `callsigns` |
| Point names | `shared/rules.json` → `maps.<id>.points[].callsign` / `name` / `aliases` |
| Hand-over phrases | `radio.command` |
| Operator's own-purchase lines | `radio.ownPurchase` |
| End-of-match lines | `radio.signOff` |
| Traffic windows and levels | `radio.traffic` |
| Base cues | `radio.cues` |
| Rule-brain sentences | `radio.brain` (see [[Rule Brain]]) |
| Hebrew spellings of NATO words to correct | `radio.spelledOut` |

## The last transmission

When a match ends, `Room.signOff` sends one line from the operator to each commander, marked `final`, kind `cue`, level 1: "Victory. The enemy is defeated" / "ניצחון. האויב הובס", "We have been defeated" / "הובסנו", or "The fight is over. Neither side won" / "הקרב הסתיים. אין מנצח". After the match is over `transmit` refuses everything else.

## Related

- [[Reference Map]]
- [[Brains and Agents]]
- [[Agent Tools]]
- [[Server Architecture]]
- [[WebSocket Frames]]
- [[Radio Console]]
- [[Speech]]
- [[Decision - Language and Radio]]
- [[Glossary]]
