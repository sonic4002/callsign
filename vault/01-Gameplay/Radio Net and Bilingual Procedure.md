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
updated: 2026-11-26
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
