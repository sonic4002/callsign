---
title: Base Building and Economy
description: "Adopted from classic base-building RTS design (documented in docs/specs/2026-11-24-bases-harvest-maps.md and docs/research/2026-11-24-classic-rts-play.md), adapted for Callsign's radio-net pacing."
type: overview
status: current
tags:
  - type/overview
  - status/current
  - agent/AGY
  - origin/mixed
  - area/gameplay
  - topic/gameplay
  - topic/economy
  - topic/bases
created: 2026-11-26
updated: 2026-11-27
agent: AGY
origin: mixed
confidence: medium
related:
  - "[[Home]]"
  - "[[Factions and Units]]"
  - "[[Maps, Terrain and Places]]"
  - "[[Locked Decisions]]"
paths:
  - docs/specs/2026-11-24-bases-harvest-maps.md
  - docs/research/2026-11-24-classic-rts-play.md
  - shared/rules.json
  - server/sim/structures.go
  - server/bot/base.go
---

# Base Building and Economy

Adopted from classic base-building RTS design (documented in `docs/specs/2026-11-24-bases-harvest-maps.md` and `docs/research/2026-11-24-classic-rts-play.md`), adapted for Callsign's radio-net pacing.

## Opening & Gold Loop
- **Starting State**: Every match opens with **HQ + 2 starting infantry squads** and `1,000` default starting gold (configurable in lobby: presets `300 / 1000 / 2500 / 5000` or custom).
- **Recommended Opening**: `Power → Refinery → Barracks → Works → Radar → Airbase` (`match.opening`).
- **Gushers & Haulers**:
  - Gold erupts from **gushers** into surrounding fields up to a cap (`fieldCap`).
  - Building a **Refinery / Smelter** spawns **1 free hauler** immediately. Additional haulers (up to `haulerCap: 4`) are built at the Works / Chop Shop.
  - Haulers automatically pick a safe gold field, load, return to the nearest own refinery, and unload; they flee when attacked and can be directed to a specific field by radio.
- **Safety Net & Naval Income**: HQ provides a `10 gold/s` trickle so a raided player can recover; capturing the **Sea Rig (Sierra)** pays a passive `30 gold/s`.

## Power & Tech Tree
Every structure produces or consumes power (`HQ: 0` (changed 2026-11-27; it was `+30`), `Power Plant / Generator Yard: +100`, production & defence structures: `-10` to `-20`).
- **Low Power Penalty** (`lowPowerFactor: 0.5`): Construction and unit queues run at **half speed**, powered defences stop firing, and the **Radar minimap goes dark**.
- **Placement Rules**: Placed freely on valid terrain within `baseRadius: 300` of HQ or `baseReach: 180` of any finished own structure (`buildRadius: 340` for defences/fences).
- **Production Queues & Rally Points**: Up to `5` units queued per role; building a second structure of a role adds a parallel production line. Units emerge visibly from the structure's animated bay/door and march to its **rally point** (settable by radio).
- **Sell & Repair**: Any non-HQ structure can be sold for `50%` gold refund (`sellShare: 0.5`), repaired over time for gold (`repairCostShare: 0.4`, `5%/s`), or instantly repaired to full by sending an Engineer/Sapper squad inside.

## Structure Matrix (`shared/rules.json`)

| Role | Aegis Structure | Cost / Power | Ashfall Structure | Cost / Power | Unlocks / Effect |
|---|---|---|---|---|---|
| `hq` | Command Post | 0 / +30 | The Den | 0 / +30 | Win condition; `10 gold/s` trickle |
| `power` | Power Plant | 140 / +100 | Generator Yard | 130 / +100 | Supplies base power (cap `3`) |
| `barracks` | Barracks | 200 / -10 | Safehouse | 150 / -10 | Infantry, Engineers/Sappers, RPG Team |
| `refinery` | Refinery | 400 / -15 | Smelter | 360 / -15 | Gold drop-off + **1 free hauler** |
| `works` | Vehicle Works | 240 / -20 | Chop Shop | 290 / -20 | Tanks, Rocket Launchers, Technicals, extra Haulers |
| `radar` | Radar Station | 280 / -20 | Listening Post | 280 / -20 | Enables **minimap** (while powered); gates Airbase & Hero |
| `dockyard` | Dockyard | 220 / -15 | Boat Shed | 250 / -15 | Patrol Boats / Speedboats |
| `airbase` | Airbase | 300 / -20 | Launch Yard | 400 / -20 | Helicopters, Strike Jets / Drones, Prop Bombers |
| `defence` | Sentry Gun / Flak | 150 / 200 (-10) | Gun Nest / Rocket Nest | 120 / 170 (-10) | Outranges non-siege ground/air; shuts down on low power |
| `fence` | Barrier Wall | 80 / 0 | Wire Fence | 50 / 0 | Blocks ground movement in runs until breached |

## Neutral Tech Buildings (Capturable by Engineers/Sappers)
- **Assay Office (בית הבוחן)**: `+250` lump gold on capture + `3 gold/s` steady income.
- **Field Clinic (מרפאת השדה)**: Heals nearby friendly infantry (`4 HP/s`, radius `130`).
- **Service Yard (מוסך השדה)**: Repairs nearby friendly vehicles (`14 HP/s`, radius `140`).

## Related Notes
- [[Home]]
- [[Factions and Units]]
- [[Maps, Terrain and Places]]
- [[Locked Decisions]]

---

## In detail

One focused note per subject, written from the code:

- [[Economy]] — There is one resource, gold. Haulers collect it from fields that gushers feed and unload it at a refinery; the headquarters adds a small trickle, the sea rig pays whoever holds it, and an Assay ...
- [[Structures and Build Tree]] — Structures are what a side builds: base structures that unlock units, defences that fire on their own, and fences that stop ground units.
- [[Power]] — Every structure either supplies power or uses it, and a side that uses more than it supplies is on low power.
- [[Placement and Production Queues]] — A structure stands on a chosen spot that the server checks, and units are made one at a time in a line at the structure that makes them, then walk out of its door to a rally point.
- [[Tech Buildings]] — Tech buildings belong to no army and stand on the map from the start; whichever side's engineers take one gets what it gives.
- [[Radar and Fog of War]] — The server keeps, for each side, the ground it has ever seen and what it last knew of points, landmarks, bridges, structures, fields and enemy haulers; a side is only ever sent that.
- [[Superpowers]] — Superpowers are planned and locked as a principle, but nothing of them is in the code.
