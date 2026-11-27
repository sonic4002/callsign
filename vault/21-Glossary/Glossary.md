---
title: Glossary
description: "Every project term, callsign and Hebrew and English pair in one place, each with a pointer to the note that explains it."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/mixed
  - area/glossary
  - topic/glossary
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Callsigns]]"
  - "[[Operator - Anvil]]"
  - "[[Squad Leaders]]"
  - "[[Fireteams and Nerve]]"
  - "[[Decisions]]"
  - "[[Factions]]"
  - "[[Stand By Behaviour]]"
  - "[[Procedure Words]]"
  - "[[Map Point Letters]]"
  - "[[Tests and Headless Matches]]"
paths:
  - shared/rules.json
  - shared/rules.go
  - shared/structures.go
  - client/i18n/en.json
  - client/i18n/he.json
  - server/room/hub.go
  - server/sim/sim.go
  - agents/agent.mjs
  - CLAUDE.md
---

# Glossary

Every project term, callsign and Hebrew and English pair in one place, each with a pointer to the note that explains it. Names of game things are copied from `shared/rules.json`; page labels from `client/i18n/en.json` and `he.json`.

## The game and the people in it

| Term | Hebrew | Meaning |
|---|---|---|
| Callsign | אות קריאה | the game |
| Hammer | פטיש | the player, the commander ([[Callsigns]]) |
| Anvil | סדן | the operator: the commander's staff agent, one per side ([[Operator - Anvil]]) |
| Squad leader | - | the agent that leads one squad ([[Squad Leaders]]) |
| Fireteam | - | a part of a squad, moved and fought by code on the server ([[Fireteams and Nerve]]) |
| The owner | - | the person whose project this is; decisions marked "owner" are theirs ([[Decisions]]) |
| Side 0 / side 1 | - | west (headquarters at Alpha) and east (headquarters at Zulu) |
| Aegis Directorate | מנהלת אגיס | faction `aegis` ([[Factions]]) |
| Ashfall Network | רשת אפר | faction `ashfall` |

## Callsigns

| English | Hebrew | Who |
|---|---|---|
| Hammer | פטיש | the player |
| Anvil | סדן | the operator |
| All stations | כל התחנות | everyone on a side's net |
| Viper N | צפע N | infantry squads |
| Rhino N | קרנף N | vehicle squads |
| Hawk N | בז N | air squads (helicopter, drone swarm) |
| Shark N | כריש N | naval squads |
| Ghost | רפאים | the Aegis hero, the Sentinel |
| Raven | עורב | the Ashfall hero, the Oracle |
| Comet N | שביט N | strike aircraft of both factions |
| Target N | מטרה N | an enemy squad in sight |
| Hauler N | מוביל N | a hauler; a name in reports, not a radio station |

## Procedure words

| English | Hebrew | Meaning |
|---|---|---|
| this is | כאן | marks the speaker: "<to>, this is <from>" |
| Over | עבור | done talking, a reply is expected |
| Out | סוף | done talking, no reply needed; never "over and out" |
| Roger | רות | received and understood |
| Wilco | רות, יבוצע | received, will comply |
| Affirmative / Negative | חיובי / שלילי | yes / no |
| Say again | אמור שנית | repeat your last message |
| Stand by | המתן | wait, I will come back to you ([[Stand By Behaviour]]) |
| Radio check | איך נשמע | checking the signal |
| Five by five | חמש על חמש | loud and clear |
| Correction | תיקון | my last message was wrong |
| Radio silence | דממת אלחוט | no transmitting |

See [[Procedure Words]].

## Map point letters

| Letter | NATO | IDF |
|---|---|---|
| A | Alpha | אלף |
| B | Bravo | בועז |
| G | Golf | גימל |
| D | Delta | דוד |
| H | Hotel | הגר |
| V | Victor | ואו |
| Z | Zulu | זאב |
| Y | Yankee | יואב |
| K | Kilo | כרמל |
| L | Lima | לאה |
| M | Mike | משה |
| N | November | נשר |
| S | Sierra | סמך |
| F | Foxtrot | פסל |
| T | Tango | תמר |

ר is never a point: its word, רות, means Roger. See [[Map Point Letters]].

## Maps and places

| English | Hebrew | What |
|---|---|---|
| Twin Bridges | שני הגשרים | the small map |
| Frozen Lake | האגם הקפוא | the medium map |
| Mountain Passes | מעברי ההרים | the large map |
| West HQ / East HQ | המפקדה המערבית / המפקדה המזרחית | Alpha and Zulu |
| Town | העיירה | Foxtrot, on every map |
| Sea rig / Lake rig | האסדה הימית / אסדת האגם | Sierra |
| house, bunker, ruin | בית, בונקר, חורבה | landmarks that can be garrisoned |
| grove, rocks, wall, rubble | חורשה, סלעים, חומה, הריסות | landmarks that give cover |
| sandbags | שקי חול | a position a squad digs |
| the west bridge (and others) | הגשר המערבי | bridges, named per map |
| Drill ground | שטח האימונים | the fixed test map nobody plays ([[Tests and Headless Matches]]) |

## Units

| English | Hebrew | id | Faction |
|---|---|---|---|
| Commandos | קומנדו | `commandos` | Aegis |
| Combat engineers | הנדסה קרבית | `engineers` | Aegis |
| Main battle tank | טנק מערכה | `tank` | Aegis |
| Precision rocket launcher | משגר רקטות מדויק | `rocketLauncher` | Aegis |
| Patrol boat | סירת סיור | `patrolBoat` | Aegis |
| Attack helicopter | מסוק קרב | `helicopter` | Aegis |
| Strike jet | מטוס תקיפה | `strikeJet` | Aegis |
| Ore crawler | זחל כרייה | `crawler` | Aegis |
| Sentinel | זקיף | `sentinel` | Aegis (hero) |
| Militia cell | חוליית מיליציה | `militia` | Ashfall |
| Sappers | חבלנים | `sappers` | Ashfall |
| Rocket team | חוליית טילי כתף | `rpgTeam` | Ashfall |
| Technical | טנדר חמוש | `technical` | Ashfall |
| Speedboat | סירה מהירה | `speedboat` | Ashfall |
| Drone swarm | נחיל רחפנים | `fpvSwarm` | Ashfall |
| Prop bomber | מפציץ מדחף | `propBomber` | Ashfall |
| Gold truck | משאית זהב | `dumpTruck` | Ashfall |
| Oracle | חוזה | `oracle` | Ashfall (hero) |

## Structures

| Role | Aegis | Hebrew | Ashfall | Hebrew |
|---|---|---|---|---|
| hq | Command Post | מוצב הפיקוד | The Den | המאורה |
| power | Power Plant | תחנת כוח | Generator Yard | חצר הגנרטורים |
| barracks | Barracks | מגורי הלוחמים | Safehouse | בית המסתור |
| refinery | Refinery | בית הזיקוק | Smelter | המתכה |
| works | Vehicle Works | מפעל הרכב | Chop Shop | המוסך |
| radar | Radar Station | תחנת מכ״ם | Listening Post | עמדת ההאזנה |
| dockyard | Dockyard | המספנה | Boat Shed | סככת הסירות |
| airbase | Airbase | בסיס האוויר | Launch Yard | חצר השיגור |
| defence | Sentry Gun | תותח זקיף | Gun Nest | קן מקלעים |
| defence | Flak Battery | סוללת נ״מ | Rocket Nest | קן טילים |
| fence | Barrier Wall | חומת מגן | Wire Fence | גדר תיל |

Tech buildings: Assay Office / בית הבוחן, Field Clinic / מרפאת השדה, Service Yard / מוסך השדה ([[Tech Buildings]]).

## Ranks and tiers

| English | Hebrew | What |
|---|---|---|
| Recruit, Sergeant, Veteran | טירון, סמל, ותיק | brain tiers 1, 2, 3 ([[Ranks and Brain Tiers]]) |
| Seasoned, Elite | מנוסה, עילית | earned ranks |

## Game terms

| Term | Meaning |
|---|---|
| Gold | the one resource ([[Economy]]) |
| Gusher, field | a gold source and the gold lying around it |
| Hauler | the unarmed vehicle that collects gold |
| Rig | a point kind: `landRig`, `seaRig`; only the sea rig pays |
| Role | what a structure is for (barracks, works ...); the build tree is written in roles ([[Structures and Build Tree]]) |
| Opening | the order a base usually grows in: power, refinery, barracks, works, radar, airbase |
| Line, queue | units waiting at the structure that makes them ([[Placement and Production Queues]]) |
| Rally point | where new units gather |
| Low power | a side using more power than it supplies ([[Power]]) |
| Nerve | steady, shaken, pinned ([[Fireteams and Nerve]]) |
| Garrison | fireteams inside a building |
| Siege unit | the only kind allowed to outrange a defence |
| Hero | a squad of one; one alive per side ([[Heroes]]) |
| Charge, plant; seize; dread | the heroes' special actions and effect |
| Sortie | one flight of a strike squad: parked, out, back, rearming ([[Sorties]]) |
| Body, standoff | the room a team takes up; the extra gap kept between enemies ([[Bodies and Collision]]) |
| Pace | a map's multiplier on all movement |
| Speed | a room's clock: relaxed, normal, fast |
| Tick | one tenth of a match second |
| Contact | an enemy squad in sight |
| Scripted enemy, bot | the code-driven opponent: easy, normal, relentless (`standard`) ([[Enemy Bot]]) |
| Lesson | "Learn to command" / ללמוד לפקד, the tutorial match ([[First Lesson]]) |

## Radio terms

| Term | Hebrew | Meaning |
|---|---|---|
| Command net | - | lines to or from Hammer or all stations ([[Command Net and Squad Net]]) |
| Squad net | רשת הכיתות | squads and Anvil among themselves |
| Radio traffic | עומס ברשת | the page's setting: Quiet / שקט, Normal / רגיל, Full / מלא ([[Traffic Levels]]) |
| Radio procedure (strictness) | נוהל קשר | Relaxed / חופשי, Standard / רגיל, Strict / מחמיר ([[Radio Routing]]) |
| Kind | - | the class of a line: order, answer, ask, cue, loss, contact, objective, notice, status, ack |
| Base cue | - | a fixed line the server writes in Anvil's name ([[Base Cues]]) |
| The fight, the purse | - | whether Anvil runs the battle; whether it may spend ([[Initiative - Orders, Fight and Purse]]) |
| Hammer's own squad | - | a squad Hammer ordered by name or by hand; Anvil leaves it alone |
| Direct act, by hand | - | the commander's own build, buy or order, with no radio call ([[Direct Acts]]) |
| Tidy | - | the page's repair of a roughly typed or heard call ([[Hints and Tidy Step]]) |
| Net language | - | the language a side's net is in ([[Net Language]]) |
| Spot | - | a place said as an offset from a point, "N140 E60 of A" ([[Places on the Radio]]) |

## Brains and services

| Term | Meaning |
|---|---|
| Brain | what an agent thinks with: rule, fast (Jev), relay (the player's key), claude, subscription ([[Brains and Agents]]) |
| Rule brain | the default: a grammar and fixed phrases, no AI ([[Rule Brain]]) |
| Level | the rule brain's initiative, 1 to 3 |
| Fast brain, Jev | a decision model behind the grammar, on the game's own key ([[Fast Brain - Jev]]) |
| Model relay | the service that holds players' keys and calls providers ([[Model Relay]]) |
| Host | the program running a side's agents: on the server machine or in the browser ([[Where Agents Run]]) |
| Wake | one activation of an agent ([[Agent Loop]]) |
| Telemetry, lamps | agents' own reports of model, context and state, shown to their commander ([[Agent Telemetry]]) |
| Private machine | a machine marked `CALLSIGN_PRIVATE=1` ([[Private Machine Guard]]) |
| Seat, seat token | a side's commander in one match and the secret that proves it ([[Seats, Tokens and Trust]]) |
| Player token | the relay's name for a browser |
| Agent key | the secret of the server's own services |
| Host password | needed to make a match on a public server |
| Join code | five characters naming a match |
| Hub, room | all matches on a server; one match ([[Rooms, Hub and Lobby]]) |
| Snapshot | the match as one side may see it ([[Sim Loop and Determinism]]) |

## Page, speech and art

| Term | Meaning |
|---|---|
| Build bar | the Structures and Reinforcements panel under the map ([[Build Bar]]) |
| Roster | the list of the side's squads, Squads / כיתות |
| Ghost, tint | the see-through structure while placing; the green and red ground |
| Dock, sheet, strip | the phone's bottom bar, its panels and the always-visible log lines ([[Mobile Layout]]) |
| Finale | the sequence when a headquarters falls |
| Push-to-talk | hold the talk button to record a call ([[Speech Recognition]]) |
| Hints | the net's names given to a recogniser |
| Speech service, listening service | text to speech and server-side recognition ([[Text to Speech Service]], [[Server Whisper]]) |
| Pronunciation table | fixed readings for words the voice gets wrong ([[Pronunciation Table]]) |
| Candidate, keep | a generated picture and the choice to use it ([[Art Pipeline]]) |
| Plain render, painted sheet | a unit sheet out of Blender, and after repainting |
| Facings | the 8 or 16 headings a unit is drawn in |

## Related

- [[Reference Map]]
- [[Callsigns]]
- [[Procedure Words]]
- [[Map Point Letters]]
- [[Units - Aegis]]
- [[Units - Ashfall]]
- [[Structures and Build Tree]]
