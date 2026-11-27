---
title: Art Direction and Sprite Pipeline
description: "Full canonical specification: docs/art/STYLE.md."
type: overview
status: current
tags:
  - type/overview
  - status/current
  - agent/AGY
  - origin/mixed
  - area/art-and-audio
  - topic/art
  - topic/style
  - topic/pipeline
created: 2026-11-26
updated: 2026-11-26
agent: AGY
origin: mixed
confidence: medium
related:
  - "[[Home]]"
  - "[[Unit Asset Redesign Log]]"
  - "[[Factions and Units]]"
  - "[[Running, Deploying and Testing]]"
paths:
  - docs/art/STYLE.md
  - assets/sprites/buildings
  - art/sprites.json
  - art/units.py
  - art/paint.py
  - art/paint.json
  - art/props.py
  - art/sheet.py
  - assets/audio
  - client/music.js
  - client/sfx.js
---

# Art Direction and Sprite Pipeline

Full canonical specification: `docs/art/STYLE.md`. Every sprite is held to the visual standard set by the painted buildings (`assets/sprites/buildings/`).

## Visual Rules
- **Look**: Hand-painted pixel-art / crisp ligne-claire isometric illustration — flat clean colour areas with painted panel seams, bolts, weathering, and dark `#161a1e` structural ink outlines. Not photographic, not smooth 3D plastic, not flat vector shapes.
- **View**: Orthographic **30° isometric (2:1 diamond)** looking from the south-east (+X runs down-right, +Y runs down-left). **No perspective, no horizon, no baked ground, no baked cast shadows, no text/insignia.**
- **Light**: Single upper-left key light — tops brightest, left faces mid-lit, right faces and undersides darkest with cool slate shadows.
- **Team Colours**: Never painted into sprites. Faction identity comes from faction palettes; player side colours (blue `#4da3ff`, red `#ff6b4a`, neutral `#cfd3c8`) are drawn at runtime as rings, pennants, plates, and health bars.

## Faction Palettes

| Element | Aegis Directorate | Ashfall Network |
|---|---|---|
| **Theme** | Clean, modular, prefabricated high-tech | Improvised, patched, weathered desert hardware |
| **Primary** | Steel blue-grey `#71889a` / `#4a5b68` / `#2b353d` | Desert sand `#b79560` / `#7d6239` / `#3a2e22` |
| **Secondary** | Pale grey-white panels `#d9e2e8` | Oxidized rust `#a2523c`, olive `#6b6a45`, timber |
| **Accents** | Pale cyan visors/optics `#cfeef4`, hazard yellow | Ochre headwraps `#c9a23f`, sapper/Oracle orange `#d9722e` |

## Generation Pipelines (All Commercial-Safe Local Models)

| Asset Type | Pipeline & Tools | Docker Command |
|---|---|---|
| **Buildings, Landmarks, Terrain, Portraits** | **ComfyUI + FLUX.2 klein 4B** (Apache-2.0; 9B is forbidden) via `art/sprites.json` + BiRefNet cutout | `make art` |
| **Animated Unit Sheets** (8/16 headings, walk/move/fire/wreck/die/abilities) | **Blender 4.2** procedural 3D models (`art/units.py`) with 2× supersampled Freestyle cel-ink rendering | `make art-units` |
| **Optional Painterly Polish Pass** | **FLUX.2 klein 4B** YCbCr chroma-locked detail pass (`art/paint.py`, `art/paint.json`) on RTX 5070 Ti | `make art-paint` |
| **Wall / Fence / Bridge Segments & Gold Props** | **Blender 4.2** seamless tiling pieces (`art/props.py`) | `make art-units` |
| **Visual Inspection Sheets** | Contact sheets at 1× game size on ground texture, construction stages, door emergence (`art/sheet.py`) | `make art-sheet` |

## Audio
- Soundtrack & ambient loops live in `assets/audio/` (`manifest.json`, `CREDITS.md`), played via `client/music.js` and procedural combat SFX in `client/sfx.js`.

## Related Notes
- [[Home]]
- [[Unit Asset Redesign Log]]
- [[Factions and Units]]
- [[Running, Deploying and Testing]]
