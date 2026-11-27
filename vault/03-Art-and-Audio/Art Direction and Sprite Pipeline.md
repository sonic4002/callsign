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
updated: 2026-11-27
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
  - assets/NOTICE.md
  - assets/sprites/manifest.json
  - assets/sprites/CREDITS.md
  - assets/audio/manifest.json
  - assets/audio/CREDITS.md
  - client/art.js
  - Makefile
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

---

## In detail

Every picture in the game is made on the owner's machine: buildings and scenery by an image model from words, units by Blender models built in code and then painted by the same image model. Only the music comes from outside, and every model and track is listed with its licence because everything the game ships must be free to sell.

### Notes in this area

- [[Art Style Guide]]: the one-page style every picture is held to (view, light, outline, palettes, sizes).
- [[Art Pipeline]]: the scripts in `art/`, the make targets, and how a candidate becomes a sprite.
- [[Licences and Credits]]: every model, tool and track with its licence, including the speech models.

### What is in `assets/` (tracked files)

| Folder | Files | What |
|---|---|---|
| `assets/sprites/buildings` | 138 | Headquarters, structures of both factions, their ruins, construction stages, door patches, tech buildings, rigs and the point marker |
| `assets/sprites/landmarks` | 31 | Houses and their ruins, bunker, ruin, groves, rocks, trees, stones, crags, mountains, the gusher, sandbags |
| `assets/sprites/units` | 24 | 18 unit sheets plus 6 turret sheets |
| `assets/sprites/segments` | 18 | Wall, barrier wall, wire fence and bridge pieces, per axis, with ruins, ends and posts |
| `assets/sprites/icons` | 7 | Build-card icons for the power, radar and tech buildings |
| `assets/sprites/props` | 5 | Three gold-field patches, the radar dish, the antenna loop |
| `assets/sprites/terrain` | 4 | Repeating ground tiles: land, sea, ice, mountain |
| `assets/sprites/portraits` | 2 | The two hero portraits |
| `assets/sprites` (root) | 2 | `manifest.json` (what the page loads) and `CREDITS.md` (seed and prompt of every generated sprite) |
| `assets/audio` | 7 | Five music tracks, `manifest.json`, `CREDITS.md` |
| `assets` (root) | 1 | `NOTICE.md` |

Not in git (see `.gitignore`): `assets/raw/` (raw model output, renders and painted canvases), `assets/models/` (speech model weights), `assets/voice-cache/`, `assets/stt-eval/`.

### The manifest is the contract

`assets/sprites/manifest.json` has the groups `units` (18), `buildings` (136), `landmarks` (31), `terrain` (4), `segments` (4), `props` (5), `variants` (8), `portraits` (2) and `icons` (7). A manifest key is the rules id of the thing in `shared/rules.json` (`vehicleWorks`, `dumpTruck`); `art/rename_keys.py` enforces this as the last step of the pipeline.

The page reads it in `loadSprites` (`client/art.js`) from `/assets/sprites/`, which the game server serves read-only. A missing manifest or image is not an error: the page draws its own stand-in, so it "looks finished with no image files at all". See [[Map Rendering]].

### Facts worth knowing

- The view changed from top-down to isometric on 2026-11-24; see [[Decision - Isometric Art]].
- No text is baked into any picture, so nothing needs translating; see [[i18n Rules]].
- Team colours are never painted in; the page draws rings, pennants and health bars.
- Weapon sounds and battle effects are synthesized in code (`client/sfx.js`, `client/fx.js`), not files; see [[Sound, Music and Effects]].
- Earned-rank marks and panel state icons are shapes drawn in code (`client/marks.js`), not pictures.
- The two menu music tracks are CC-BY 4.0 and, per `assets/audio/CREDITS.md`, must not ship in a public build until the game has a credits screen.

### Related

- [[Home]]
- [[Art Style Guide]]
- [[Art Pipeline]]
- [[Licences and Credits]]
- [[Map Rendering]]
- [[Sound, Music and Effects]]
- [[Decision - Isometric Art]]
- [[Make Targets]]
- [[Voice Pipeline (STT and TTS)]]
