---
title: Unit Asset Redesign Log
description: "Unit Asset Redesign Log."
type: log
status: current
tags:
  - type/log
  - status/current
  - agent/AGY
  - origin/code
  - area/art-and-audio
  - topic/art
  - topic/units
  - topic/redesign
created: 2026-11-26
updated: 2026-11-26
agent: AGY
origin: code
confidence: medium
related:
  - "[[Home]]"
  - "[[Art Direction and Sprite Pipeline]]"
  - "[[Factions and Units]]"
  - "[[Running, Deploying and Testing]]"
paths:
  - art/paint.py
  - art/units.py
  - client/sw.js
---

# Unit Asset Redesign Log

## Diagnosis of Original Unit Sprites
Comparing the original unit sheets against the reference buildings (`hq_aegis.png`, `barracks.png`, `vehicleWorks.png`, `hq_ashfall.png`, `safehouse.png`, `chopShop.png`) exposed three core gaps:
1. **Box-primitive geometry**: Unbeveled boxes/cylinders gave infantry a stiff stick-figure look and vehicles a flat toy silhouette lacking Aegis's crisp white/blue-grey modular plating or Ashfall's bolted rust/sandbag character.
2. **Missing internal structural ink & cavity shading**: Flat Cycles Principled BSDF had zero Ambient Occlusion and no internal `#161a1e` ink lines along seams/hatches/folds.
3. **Destructive FLUX paint-over (`art/paint.py`)**: Per-channel RGB gain multiplication (`0.5–2.2×`) amplified VAE chroma noise into neon green/magenta speckles, and running muzzle flashes through FLUX turned shots into black-outlined yellow/pink triangles.

## Pipeline Upgrades Shipped (2026-11-26)
1. **Blender 4.2 Stylized Cel-Ink Engine (`art/units.py`)**:
   - Enabled **2× supersampled rendering (`SS = 2`)** downsampled cleanly to exact `PPM = 40`.
   - Added **Two-Layer Freestyle Ink (`#161a1e`)**: bold outer contour (`4.4 px` @ 2×) + crisp internal structural seams (`2.3 px` @ 2×, `38°` crease angle, silhouettes, and material boundaries).
   - Added dedicated `fx` collection excluded from Freestyle so muzzle flashes and glowing bursts stay bright and clean without dark outlines.
   - Upgraded `mat()` with Ambient Occlusion cavity shading, subtle object-space brushwork/rust weathering, and material presets (`paint`, `cloth`, `metal`, `glass`, `rubber`, `rust`).
   - Added beveled geometry helpers (`bevel=` on `box`, `prism_y`, `prism_z`, `cyl`, plus `taper_box`).
2. **Cleaned YCbCr FLUX Paint Pass (`art/paint.py`)**:
   - Switched from per-channel RGB gain to **YCbCr luminance-detail blending** (`START = 2`, `KEEP = 0.88` chroma lock) — eliminates 100% of green/magenta speckles while preserving Freestyle ink lines and glowing visors/muzzle flashes.
3. **Service Worker Cache Bump (`client/sw.js`)**:
   - Bumped `CACHE` from `callsign-14` → `callsign-15` so browsers immediately load the redesigned sprites while preserving `callsign-voice-*` speech models.

## Flagship Prototype Units Completed (4 of 18)
- **`tank`** (Aegis MBT): Beveled composite hull, pale-grey/white top armour plates, 4-block ERA side skirts, 6 beveled road wheels, slotted radiator louvers, wedge turret with bustle rack, smoke launchers, cupola + coax MG, glowing cyan CITV optics, bore evacuator, and slotted muzzle brake.
- **`technical`** (Ashfall Gun Truck): Sculpted desert pickup, bullbar, wheel arches, slat-armoured windshield, bolted rust-red door plates, rolled roof camo tarp, rollbar, sandbagged bed + ammo crate, angled V-shaped rust gun shield, and keffiyeh gunner.
- **`commandos`** (Aegis Special Forces): Tapered anatomy, dark steel-blue tactical helmet + glowing cyan visor, pale-grey composite chest plate & shoulder pauldrons, knee pads, comms backpack + aerial, suppressed carbine.
- **`militia`** (Ashfall Desert Fighter): Layered ochre keffiyeh + dark agal headband, olive chest rig with 3 mag pouches, diagonal bandolier, rucksack + bedroll, wooden-stock AK with curved magazine.

## Remaining 14 Units Queued for Rollout
`engineers`, `sappers`, `rpgTeam`, `sentinel`, `oracle`, `rocketLauncher`, `helicopter`, `strikeJet`, `propBomber`, `patrolBoat`, `speedboat`, `fpvSwarm`, `crawler`, `dumpTruck`.

## Backups & Rollback
- Original sprites are tracked in git (`git checkout -- assets/sprites/ art/` to revert instantly).
- Three-way comparison snapshots (Original / Pure Blender Cel-Ink / Blender + Cleaned FLUX) are preserved in the conversation scratch/artifact directory.

## Related Notes
- [[Home]]
- [[Art Direction and Sprite Pipeline]]
- [[Factions and Units]]
- [[Running, Deploying and Testing]]
