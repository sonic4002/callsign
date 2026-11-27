---
title: Factions and Units
description: "Callsign ships with two asymmetric launch factions defined in shared/rules.json."
type: overview
status: current
tags:
  - type/overview
  - status/current
  - agent/AGY
  - origin/mixed
  - area/gameplay
  - topic/gameplay
  - topic/factions
  - topic/units
  - topic/balance
created: 2026-11-26
updated: 2026-11-27
agent: AGY
origin: mixed
confidence: medium
related:
  - "[[Home]]"
  - "[[Base Building and Economy]]"
  - "[[Art Direction and Sprite Pipeline]]"
  - "[[Unit Asset Redesign Log]]"
paths:
  - shared/rules.json
  - docs/PLAN.html
---

# Factions and Units

Callsign ships with two asymmetric launch factions defined in `shared/rules.json`. Balance target: **45%–55% win rate** for each faction over 200 scripted matches per map (`make balance`).

---

## Aegis Directorate · מנהלת אגיס
> *"Fewer soldiers, sharper eyes."*
> **Palette**: Prefabricated pale-grey/white panels (`#d9e2e8`) over steel blue-grey (`#71889a`), dark slate recesses, pale cyan optics (`#cfeef4`).
> **Starting Units**: 2× Commandos.

| Unit | Hebrew | Requires | Cost | Teams × Men | HP | Range | Role & Special Notes |
|---|---|---|---|---|---|---|---|
| **Commandos** | קומנדו | Barracks | 100 | 3 × 2 | 66 | 190 | Core precision infantry; garrisons buildings, digs sandbags. |
| **Combat Engineers** | הנדסה קרבית | Barracks | 150 | 1 × 3 | 50 | 140 | Repairs bridges (`40/s`), repairs own structures, captures enemy/neutral structures (`8s`). |
| **Main Battle Tank** | טנק מערכה | Works | 250 | 2 × 1 | 450 | 260 | Heavy armour (`0.6`), **crushes** infantry in the open. |
| **Precision Rocket Launcher** | משגר רקטות מדויק | Works | 300 | 2 × 1 | 150 | 420 | **Siege** (`minRange 150`); outranges all defences (`1.6×` vs structures). |
| **Patrol Boat** | סירת סיור | Dockyard | 250 | 2 × 1 | 300 | 230 | Naval control & sea-rig capture (`0.6×` vs air). |
| **Attack Helicopter** | מסוק קרב | Airbase | 400 | 2 × 1 | 240 | 220 | Fast hover gunship (`speed 75`, `sight 320`). |
| **Strike Jet** *(Comet)* | מטוס תקיפה | Airbase | 500 | 2 × 1 | 150 | 60 | Sortie bomber (`2` bombs, `blastRadius 60`, `2×` vs structures, `75%` evade, `14s` rearm). |
| **Ore Crawler** | זחל כרייה | Works | 150 | 1 × 1 | 420 | — | Tough armoured hauler (`capacity 320`, `7s` load, no leader agent). |
| **Sentinel** *(Hero · Ghost)* | זקיף (רפאים) | Barracks + Works + Radar | 500 | 1 × 1 | 150 | 280 | Starts Tier 2; stealth (`95`), anti-infantry sniper (`45` dmg), **2 demolition charges** (`1200` dmg, `5s` fuse) for structures/bridges. |

---

## Ashfall Network · רשת אפר
> *"They can't hit what they can't find."*
> **Palette**: Dusty desert sand (`#b79560`), oxidized rust-red plates (`#a2523c`), faded olive gear (`#6b6a45`), warm timber, ochre headwraps.
> **Starting Units**: 2× Militia cells.

| Unit | Hebrew | Requires | Cost | Teams × Men | HP | Range | Role & Special Notes |
|---|---|---|---|---|---|---|---|
| **Militia Cell** | חוליית מיליציה | Safehouse | 100 | 4 × 3 | 50 | 160 | Large guerrilla squad (12 fighters); garrisons buildings, digs sandbags. |
| **Rocket Team** | חוליית טילי כתף | Safehouse | 150 | 2 × 3 | 32 | 240 | **Siege** (`siegeRange 340`, `pierce 0.8`); anti-armour & anti-defence infantry. |
| **Sappers** | חבלנים | Safehouse | 130 | 1 × 4 | 36 | 130 | Fast capture (`6s`), bridge repair (`30/s`), `2×` damage vs fences. |
| **Technical** | טנדר חמוש | Chop Shop | 250 | 3 × 1 | 330 | 220 | Fast raid gun truck (`speed 48`, rapid HMG fire). |
| **Speedboat** | סירה מהירה | Boat Shed | 250 | 3 × 1 | 190 | 185 | Fast sea raider (`speed 52`) for contesting Sierra sea rig. |
| **Drone Swarm** | נחיל רחפנים | Launch Yard | 150 | 4 × 2 | 40 | 70 | Cheap agile FPV swarm (`speed 90`), cannot capture points. |
| **Prop Bomber** *(Comet)* | מפציץ מדחף | Launch Yard | 450 | 3 × 1 | 130 | 55 | Sortie bomber (`1` heavy bomb `135` dmg, `2×` vs structures, `10s` rearm). |
| **Gold Truck** | משאית זהב | Chop Shop | 150 | 1 × 1 | 300 | — | Faster lighter hauler (`speed 52`, `capacity 250`, `5s` load, no leader agent). |
| **Oracle** *(Hero · Raven)* | חוזה (עורב) | Safehouse + Chop Shop + Listening Post | 500 | 1 × 1 | 220 | 150 | Starts Tier 2; walks disguised (`85`), **seizes** an enemy vehicle squad (`radius 240`, `3s`), emits nerve **dread aura** (`radius 185`). |

## Future Planned Factions (`docs/PLAN.html`)
- **Iron Bloc**: Heavy armour & massed artillery (*Firestorm barrage*).
- **Hornet Collective**: Electronic warfare & drone swarms (*Blackout* radio jamming).
- **Tidewall Union**: Naval & coastal power (*Off-map carrier strike*).

## Related Notes
- [[Home]]
- [[Base Building and Economy]]
- [[Art Direction and Sprite Pipeline]]
- [[Unit Asset Redesign Log]]

---

## In detail

One focused note per subject, written from the code:

- [[Factions]] — The game has two factions, Aegis Directorate and Ashfall Network, defined under factions in shared/rules.json.
- [[Units - Aegis]] — Every unit the Aegis Directorate (מנהלת אגיס) can field, with the numbers in shared/rules.json (factions.aegis.units) as they are now.
- [[Units - Ashfall]] — Every unit the Ashfall Network (רשת אפר) can field, with the numbers in shared/rules.json (factions.ashfall.units) as they are now.
- [[Heroes]] — Each faction has one hero: a squad of a single exceptional soldier, of which only one may be alive at a time.
- [[Strike Aircraft]] — Strike aircraft are squads of planes that stand at an airbase, fly a sortie to bomb a target or look at a place, and come home to be armed again.
- [[Ranks and Brain Tiers]] — A squad has two separate standings.
- [[Fireteams and Nerve]] — A squad is made of fireteams, and every fireteam is moved and fought by plain utility AI on the server, with no language model.
- [[Balance]] — Balance between the two factions is measured by playing whole scripted matches headless: the scripted enemy on both sides, each pairing from both ends of the map, over many seeds.
