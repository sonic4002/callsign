---
title: Super Powers
description: "All 15 strategic and tactical super weapons, Strategic Command & Black-Site Silo structures, lobby allowances, and targeting cursors."
type: overview
status: current
tags:
  - type/overview
  - status/current
  - agent/AGY
  - origin/code
  - area/gameplay
  - topic/gameplay
  - topic/superpowers
created: 2026-11-27
updated: 2026-11-27
agent: AGY
origin: code
confidence: high
related:
  - "[[Home]]"
  - "[[Factions and Units]]"
  - "[[Base Building and Economy]]"
paths:
  - shared/rules.json
  - shared/superpowers.go
  - server/sim/superpowers.go
  - client/superpowers-fx.js
---

# Super Powers · כוחות על

Callsign features **15 strategic and tactical super weapons** defined in `shared/rules.json`, simulated deterministically in `server/sim/superpowers.go`, and rendered with multi-stage procedural Canvas VFX and custom targeting cursors in `client/superpowers-fx.js`.

## Lobby Configuration & Unlocking
- **Lobby Setting (`superPowers`)**: Players choose how many super powers each commander may arm per match: **`Off (0)`**, **`1`**, **`2` *(default)***, **`3`**, **`4`**, or **`All (15)`**.
- **Super Weapon Structures (`role: "superweapon"`)**:
  - **Aegis Directorate**: **Strategic Command** (`strategicCommand` · *פיקוד אסטרטגי*) — 500 gold, 14s build, 1500 HP, `-25` power, requires Radar.
  - **Ashfall Network**: **Black-Site Silo** (`blackSite` · *הסילו הסודי*) — 480 gold, 13s build, 1300 HP, `-25` power, requires Listening Post.
- **Selection Flow**: Clicking the Super Weapons building in the build bar opens the **Super Power Picker Modal** where the commander selects their `N` super powers before placing the complex. If the base loses power or is hit by EMP / Cyber Blackout, super-power recharge timers pause until power is restored.
- **Sandbox Testing Mode (`All`)**: Unlocks **all 15 super powers** automatically as soon as the complex finishes building, waives the Radar prerequisite, starts at **100% ready**, and uses a **20-second** fast recharge so every weapon and animation can be tested back-to-back.

## All 15 Super Powers

| ID | Name (EN / HE) | Cooldown | Cursor | Effect Summary |
|---|---|---|---|---|
| `rodOfGod` | **Rod of God** · מטה האלוהים | 5:00 | Circle + Crosshair | Hypersonic orbital tungsten rod; vaporises inner core, blasts outer ring, leaves permanent crater. |
| `tacticalNuke` | **Tactical Nuke** · פצצה גרעינית טקטית | 7:00 | Circle + Crosshair | Ballistic nuclear warhead; massive devastation, shatters nerve, rising mushroom cloud + Wilson ring, 45s fallout + crater. |
| `chemicalStrike` | **Chemical Strike** · תקיפה כימית | 4:00 | Wind-Drift Circle | 4 canisters burst into a 35s downwind-drifting toxic cloud; flushes garrisons & melts infantry, spares structures. |
| `lightningStorm` | **Lightning Storm** · סופת ברקים | 5:30 | Circle + Crosshair | 12s storm cloud bank slams 14 forked bolts prioritizing armor, aircraft, power plants & radar. |
| `droneSwarm` | **Hunter-Killer Swarm** · נחיל רחפני ציד | 3:30 | Circle + Crosshair | 18 micro-FPV quadcopters swarm in for 15s, laser-locking and dive-bombing enemy vehicles, haulers & troops. |
| `cyberBlackout` | **Cyber Blackout** · השבתת סייבר | 3:30 | Circle + Crosshair | 28s EW dome disables enemy turrets, radar & production, scrambles comms, and reveals stealth units. |
| `orbitalLaser` | **Orbital Laser Sweep** · קרן לייזר מסלולית | 4:30 | Drag Beam Line | Drag a 260m path: vertical orbital plasma beam slices across armor, walls & buildings, leaving a cooling molten trench. |
| `thermobaricMoab` | **Thermobaric MOAB** · פצצת וואקום תרמוברית | 5:00 | Circle + Crosshair | Heavy transport parachutes fuel-air bomb; aerosol mist ignites in a vacuum dome clearing all garrisons & sandbags (no fallout). |
| `empPulse` | **EMP Pulse** · פולס אלקטרומגנטי | 4:00 | Circle + Crosshair | Freezes enemy vehicles, haulers, turrets & structures for 22s with electric arcs, and crashes all aircraft inside. |
| `napalmRun` | **Napalm Carpet Run** · הפצצת נפאלם | 3:30 | Drag Flight Strip | Twin low-pass strike jets lay a 280m corridor of burning napalm & white phosphorus smoke for 25s. |
| `artilleryFirestorm` | **Artillery Firestorm** · סופת ארטילריה | 4:30 | Circle + Crosshair | 22 heavy shells rain over 12s, pinning armies, shredding sandbags, and pockmarking terrain with craters. |
| `scudSalvo` | **SCUD Cluster Salvo** · מטח טילי סקאד | 5:30 | Scatter Ring | 6 heavy ballistic rockets arc down across a wide dispersion zone, wrecking sprawling bases and bridges. |
| `tunnelAmbush` | **Subterranean Breach** · פריצה תת-קרקעית | 4:00 | Circle + Crosshair | 4s seismic ground fissures erupt beneath any land target, blasting structures above and deploying an instant ambush force. |
| `radioSpoof` | **Phantom Signal** · אות רפאים | 3:00 | Circle + Crosshair | 24s psy-ops broadcast spawns 8 flickering holographic decoy tanks/squads on enemy radar while draining enemy nerve. |
| `cruiseMissiles` | **Naval Cruise Salvo** · מטח טילי שיוט | 4:30 | 3 Sequential Locks | Mark 3 separate targets: 3 low-skimming Tomahawk missiles streak in from map edge (interceptable by dense flak). |
