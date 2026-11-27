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
updated: 2026-11-27
agent: AGY
origin: code
confidence: medium
related:
  - "[[Home]]"
  - "[[Art Direction and Sprite Pipeline]]"
  - "[[Factions and Units]]"
  - "[[Running, Deploying and Testing]]"
paths:
  - art/paint.json
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

## Staged GPU Sculpted Redesign — Olive Drab + Blue Ribbons (2026-11-27)
Following owner feedback that the earlier blue-steel realistic set still read as smooth grey mannequins (ball hands, tube limbs) and bevelled boxes, all 18 units and 6 turrets were rebuilt and staged into `assets/raw/stage/sprites/` without modifying live `assets/sprites/` or `assets/raw/plain/`:
1. **Cycles CUDA GPU Rendering & Staging (`art/units.py`, `art/paint.py`)**:
   - Added `--out-root`, `--plain-root`, `--raw-root`, `--base-manifest`, `--device`, `--ppm`, and `--ss` flags so full renders stage safely outside the live directory while keeping `manifest["stamp"]` and all non-unit manifest entries intact.
   - Enabled Cycles `CUDA` on the RTX 5070 Ti (`~0.73 GB` VRAM, well within the headroom beside the running speech services) with **2× supersampling (`SS = 2`, 32 samples + OIDN + subtle RGB `UnsharpMask`)** at **`PPM = 52`**, cutting total unit-sheet pixels by **12.0%** (`222.86 Mpx` -> `196.22 Mpx`) for phone memory.
2. **Outline-Free Isometric Lighting & Realistic Military PBR**:
   - Replaced flat high ambient fill (`0.95`) with crisp directional desert sunlight (`energy = 5.6`, `1.4°`), controlled desert sky dome (`0.54`), cool silhouette-carving rim light (`1.55`), and deeper local AO cavity darkening (`0.16`).
   - Switched `AEGIS` armor/uniforms to weathered dielectric olive drab CARC paint & BDU cloth with coyote-tan MOLLE webbing and vivid cobalt-blue cloth recognition ribbons (`finish="ribbon"`), keeping `AEGIS_GREY` for aircraft and naval craft. Boosted `ASHFALL` readability on sand with darker olive chest rigs, dark trousers/boots, weathered earth-khaki tunics, and oxidized rust/timber hulls.
3. **Sculpted Procedural Geometry Across All 18 Units**:
   - Added `loft`, `cloth_fold` (`SUBSURF` + `STUCCI` `DISPLACE`), `sculpted_limb`, `combat_boot`, `gloved_hand`, `grate`, `bolt_row`, and fluttering 3D cloth `pennant` helpers.
   - Rebuilt infantry (`commandos`, `engineers`, `militia`, `rpgTeam`, `sappers`) with folded trousers/sleeves, seamless knees, lug-sole combat boots, gloved gripping hands, anatomical heads, MOLLE webbing, tied blue helmet bands, and projecting weapon silhouettes; rebuilt `sentinel` and `oracle` with hollow `SOLIDIFY`-thickened draped cloth cowls and multi-fold cloaks/robes.
   - Rebuilt all 12 vehicles, aircraft, drone, and boats with lofted fuselages, deep-V flared naval hulls, radial tire treads, recessed slatted grilles/engine louvers, 12-tube MLRS pod, ribbed tipping hoppers, radial warbird engine cowl, and 3-blade carbon FPV quadcopter.
4. **FLUX.2 Paint Pass A/B Verdict (`art/paint.json`, `art/paint.py`)**:
   - A/B testing on `commandos` (`assets/raw/stage/compare_flux_ab.png`) confirmed FLUX.2 klein 4B enhances the sculpted 2× SS Cycles renders with stitched webbing, fabric creases, leather grain, and metal scuffing at both game size and close-up while preserving silhouettes and blue ribbons.
   - Cleaned `art/paint.json` of all external game/vehicle names and moved blue-ribbon prompt instructions out of the shared `style` string so Ashfall units remain completely free of blue bleed or wing markings.
   - Full report and before/after comparison sheets live under `assets/raw/stage/REPORT.md`.

> [!note] Superseded 2026-11-27
> The earlier blue-grey AgX PBR pass below was superseded by the olive-drab + cobalt-blue-ribbon sculpted GPU redesign staged in `assets/raw/stage/sprites/`.

## Realistic Military Miniature Redesign — All 18 Units Shipped (2026-11-27)
Following visual review of the cel-ink prototype, the unit art direction pivoted away from cartoon black outlines and bright toy palettes to a **realistic military miniature** look (*Company of Heroes* / *C&C Generals* / *Broken Arrow*):
1. **Blender 4.2 Cycles AgX PBR Engine (`art/units.py`)**:
   - Upgraded render resolution from `PPM = 40` to **`PPM = 56`** (`SS = 1`, 36 Cycles samples + OpenImageDenoise). `client/art.js` automatically reads `ppm` from `manifest.json` so sprites render 40% crisper at identical world scale.
   - Switched color management to **`AgX` (`AgX - Medium High Contrast`, exposure `0.25`)** with natural desert sky lighting, warm sun, cool rim, and warm sand bounce — **zero Freestyle cartoon black ink outlines**.
   - Upgraded Cycles PBR shaders (`mat()`) with mottled weathering, metallic `Pointiness` edge wear, AO cavity grime, height-based desert dust (auto-disabled for aircraft and naval vessels), micro-surface bump, and physical material presets (`paint`, `metal`, `cloth`, `rubber`, `glass`, `skin`, `rust`).
   - Rebuilt human infantry anatomy with `subsurf` sculpted torsos, realistic proportions, dark smoked ballistic goggles, FAST helmets + Peltor ear-pro, flush SAPI plate carriers, realistic M4/AK/RPG silhouettes, and rebuilt the Aegis MBT with a Merkava IV / Leopard 2A7 arrowhead wedge turret, 7 road wheels, and 6 hinged ballistic side skirts.
2. **Photorealistic FLUX.2 klein 4B GPU Pass (`art/paint.py`, `art/paint.json`)**:
   - Rewrote global and per-unit prompts for realistic weathered military scale models (removing pixel-art and dark-outline wording), using `START = 1` and `KEEP = 0.62` YCbCr luminance/chroma separation so FLUX adds realistic paint wear, bolts, welds, and fabric folds without neon speckles or silhouette drift.
   - Preserves emissive muzzle flashes and headlights untouched, applies soft `0.78×` anti-fringe edge blending (no black outline halo), and quantizes with `FASTOCTREE` + `FLOYDSTEINBERG` dithering to prevent gradient banding.
   - All **18 units + 6 turrets** rendered and painted on the RTX 5070 Ti inside `--rm` Docker containers (`callsign-blender` + `callsign-art`):
     - **Aegis (9)**: `commandos`, `engineers`, `sentinel`, `tank`, `rocketLauncher`, `crawler`, `helicopter`, `strikeJet`, `patrolBoat`
     - **Ashfall (9)**: `militia`, `rpgTeam`, `sappers`, `oracle`, `technical`, `dumpTruck`, `fpvSwarm`, `propBomber`, `speedboat`
3. **Cache Invalidation & Live Serving (`server/cmd/callsign/main.go`, `client/sw.js`, `client/mobile.js`)**:
   - Added `Cache-Control: no-cache` for `/assets/sprites/` in the Go static handler.
   - Narrowed `PICTURES` in `client/sw.js` so `manifest.json` stays `networkFirst`, fetched sprite revalidations with `{ cache: "no-cache" }`, bumped `CACHE` to **`callsign-16`**, and fixed `client/mobile.js` reload guard to a 5-second timestamp window.

## Earlier Iteration (Superseded, 2026-11-26)
- Tested a 2× supersampled Freestyle cel-ink pass (`#161a1e` cartoon outlines, `PPM = 40`) on 4 flagship units (`tank`, `technical`, `commandos`, `militia`); superseded by the realistic AgX PBR + photorealistic FLUX.2 pipeline above.

## Backups & Rollback
- All 24 original sprite sheets (18 units + 6 turrets) and `manifest.json` from `HEAD` are preserved in git (`git checkout -- assets/sprites/ art/` to revert instantly) and archived in the session scratch backup (`scratch/before_all/`).

## Related Notes
- [[Home]]
- [[Art Direction and Sprite Pipeline]]
- [[Factions and Units]]
- [[Running, Deploying and Testing]]
