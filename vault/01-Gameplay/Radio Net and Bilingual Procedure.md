---
title: Radio Net and Bilingual Procedure
description: "Hebrew and English are first-class citizens across UI, voice recognition, radio routing, and agent replies."
type: overview
status: current
tags:
  - type/overview
  - status/current
  - agent/AGY
  - origin/code
  - area/gameplay
  - topic/gameplay
  - topic/radio
  - topic/hebrew
  - topic/bilingual
created: 2026-11-26
updated: 2026-11-27
agent: AGY
origin: code
confidence: medium
related:
  - "[[Home]]"
  - "[[Chain of Command and Autonomy]]"
  - "[[Maps, Terrain and Places]]"
  - "[[Voice Pipeline (STT and TTS)]]"
paths:
  - server/radio
  - shared/rules.json
  - server/radio/radio.go
  - server/radio/places.go
  - server/radio/localize.go
  - server/room/room.go
  - server/room/traffic.go
  - server/room/cues.go
  - server/room/command.go
  - server/room/act.go
  - server/room/tools.go
  - client/nets.js
  - client/cues.js
---

# Radio Net and Bilingual Procedure

Hebrew and English are first-class citizens across UI, voice recognition, radio routing, and agent replies. Mixing languages (*"תחזיקו את Foxtrot"*) is supported natively. UI mirrors for RTL in Hebrew; **the map never mirrors**.

## Addressing & Routing
Radio routing is executed purely in Go code (`server/radio/`) via bilingual callsign matching—**never by an LLM**.

- **Single squad**: `"Viper 2, this is Hammer. Hold Foxtrot. Over."` / `"צפע 2, כאן פטיש, תחזיקו את פסל, עבור."`
- **Multiple squads**: `"Viper 2 and Rhino 1, this is Hammer..."`
- **All stations**: `"All stations, this is Hammer..."` / `"כל התחנות, כאן פטיש..."`
- **Operator**: `"Anvil, this is Hammer..."` / `"סדן, כאן פטיש..."`

## Callsigns (`shared/rules.json`)

| Role | English | עברית |
|---|---|---|
| Player | Hammer | פטיש |
| Operator | Anvil | סדן |
| Infantry squads | Viper 1, 2… | צפע 1, 2… |
| Vehicle squads | Rhino 1, 2… | קרנף 1, 2… |
| Helicopters / Drones | Hawk 1, 2… | בז 1, 2… |
| Strike Aircraft | Comet 1, 2… | שביט 1, 2… |
| Naval squads | Shark 1, 2… | כריש 1, 2… |
| Aegis Hero (Sentinel) | Ghost | רפאים |
| Ashfall Hero (Oracle) | Raven | עורב |
| Contacts / Haulers | Target / Hauler | מטרה / מוביל |

> No callsign reuses a phonetic alphabet word, preventing collisions with map points.

## Procedure Words (Prowords)

| English | עברית | Game Meaning |
|---|---|---|
| `<to>, this is <from>` | `<אל>, כאן <מאת>` | Standard call opener |
| **Over** | **עבור** | Expecting reply (reports, questions, orders) |
| **Out** | **סוף** | Conversation complete (acknowledgements; never *"over and out"*) |
| **Roger** | **רות** | Information received |
| **Wilco** | **רות, יבוצע** | Order received and will be executed |
| **Affirmative / Negative** | **חיובי / שלילי** | Yes / Refused with reason |
| **Say again** | **אמור שנית** | Unclear or ambiguous order; asks instead of guessing |
| **Stand by** | **המתן** | Spoken if an LLM call takes long |
| **Radio check** / **Five by five** | **איך נשמע?** / **חמש על חמש** | Signal check (answered in code) |
| **Correction** | **תיקון** | Replaces previous transmission |
| **Radio silence** | **דממת אלחוט** | Silence net transmissions |

## Shared Phonetic Map Points (NATO ↔ IDF)
Only letters shared by both alphabets name map points. **`ר` (Romeo / רות) is never used** because *רות* means *Roger*.

| Letter | NATO | IDF (צה״ל) | Typical Role |
|---|---|---|---|
| **A / א** | Alpha | אלף | West HQ |
| **B / ב** | Bravo | בועז | West Gold Field |
| **G / ג** | Golf | גימל | Crossing / Quarry |
| **D / ד** | Delta | דוד | Ridge / West Farm |
| **H / ה** | Hotel | הגר | Farm / East Flank |
| **F / פ** | Foxtrot | פסל | Center Town |
| **K / כ** | Kilo | כרמל | East Gold Field |
| **S / ס** | Sierra | סמך | Sea Rig |
| **Z / ז** | Zulu | זאב | East HQ |
| **L, M, N, T, Y, V** | Lima, Mike, November, Tango, Yankee, Victor | לאה, משה, נשר, תמר, יואב, ואו | Medium & Large map points |

## Traffic Levels & Anvil Base Cues
Radio traffic is categorized by priority (`order`, `answer`, `ask`, `cue`, `loss` = level 1; `contact`, `objective` = level 2; `notice`, `status`, `ack` = level 3). Anvil speaks rate-limited fixed cues for base events (*Construction complete*, *New options available*, *Low power*, *Base under attack*, *Hauler under attack*, *Hero in the field*, etc.).

## Related Notes
- [[Home]]
- [[Chain of Command and Autonomy]]
- [[Maps, Terrain and Places]]
- [[Voice Pipeline (STT and TTS)]]

---

## In detail

The radio net is how a commander (Hammer) talks to the operator (Anvil) and the squads, in Hebrew or English, with real radio procedure. Everything about it — who a call is for, how it ends, what it is about, whether it is shown or dropped — is decided by plain code over tables in `shared/rules.json`; no language model routes or classifies anything.

### How a transmission travels

1. The commander's page sends a `radio` frame with the text and a strictness level (`server/room/ws.go`). Agents never send raw text: they call the `radio` tool with `to`, `body` and `end`, and the server writes the procedure around the body (`Net.Compose`).
2. `server/radio` parses the text: addressees, sender, body, ending word, language, procedure words, map points and landmarks (`Net.Parse` / `Net.ParseRelaxed`).
3. The room checks the addressees exist on that side's net, then `classify` (`server/room/traffic.go`) gives the line a **kind**, a **net** (`command` or `squad`) and a **level** (1 to 3), or drops it.
4. The message is appended to the side's log and broadcast to that side only as `{"type":"radio","message":{...}}`. A side never receives the other side's net.
5. The page shows it on the command net or the squad net according to the player's traffic setting, and speaks only what the command net shows.

Each side has its own net, its own log and its own language. There is one `radio.Net` per room, built from the rules for that room's map (`radio.NewNet`).

### Notes in this area

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

### Where the words live

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

### The last transmission

When a match ends, `Room.signOff` sends one line from the operator to each commander, marked `final`, kind `cue`, level 1: "Victory. The enemy is defeated" / "ניצחון. האויב הובס", "We have been defeated" / "הובסנו", or "The fight is over. Neither side won" / "הקרב הסתיים. אין מנצח". After the match is over `transmit` refuses everything else.

### Related

- [[Home]]
- [[AI Brains and Model Relay]]
- [[Agent Tools]]
- [[Server Architecture]]
- [[WebSocket Frames]]
- [[Radio Console]]
- [[Voice Pipeline (STT and TTS)]]
- [[Decision - Language and Radio]]
- [[Glossary]]
