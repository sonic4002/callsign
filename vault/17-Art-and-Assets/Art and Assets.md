---
title: Art and Assets
description: "Every picture in the game is made on the owner's machine: buildings and scenery by an image model from words, units by Blender models built in code and then painted by the same image model."
type: hub
status: current
tags:
  - type/hub
  - status/current
  - agent/CLD
  - origin/mixed
  - area/art-and-assets
  - topic/art
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Art Style Guide]]"
  - "[[Art Pipeline]]"
  - "[[Licences and Credits]]"
  - "[[Map Rendering]]"
  - "[[Decision - Isometric Art]]"
  - "[[i18n Rules]]"
  - "[[Sound, Music and Effects]]"
  - "[[Reference Map]]"
  - "[[Make Targets]]"
  - "[[Speech]]"
paths:
  - docs/art/STYLE.md
  - assets/NOTICE.md
  - assets/sprites/manifest.json
  - assets/sprites/CREDITS.md
  - assets/audio/manifest.json
  - assets/audio/CREDITS.md
  - art/sprites.json
  - client/art.js
  - Makefile
---

# Art and Assets

Every picture in the game is made on the owner's machine: buildings and scenery by an image model from words, units by Blender models built in code and then painted by the same image model. Only the music comes from outside, and every model and track is listed with its licence because everything the game ships must be free to sell.

## Notes in this area

- [[Art Style Guide]]: the one-page style every picture is held to (view, light, outline, palettes, sizes).
- [[Art Pipeline]]: the scripts in `art/`, the make targets, and how a candidate becomes a sprite.
- [[Licences and Credits]]: every model, tool and track with its licence, including the speech models.

## What is in `assets/` (tracked files)

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

## The manifest is the contract

`assets/sprites/manifest.json` has the groups `units` (18), `buildings` (136), `landmarks` (31), `terrain` (4), `segments` (4), `props` (5), `variants` (8), `portraits` (2) and `icons` (7). A manifest key is the rules id of the thing in `shared/rules.json` (`vehicleWorks`, `dumpTruck`); `art/rename_keys.py` enforces this as the last step of the pipeline.

The page reads it in `loadSprites` (`client/art.js`) from `/assets/sprites/`, which the game server serves read-only. A missing manifest or image is not an error: the page draws its own stand-in, so it "looks finished with no image files at all". See [[Map Rendering]].

## Facts worth knowing

- The view changed from top-down to isometric on 2026-11-24; see [[Decision - Isometric Art]].
- No text is baked into any picture, so nothing needs translating; see [[i18n Rules]].
- Team colours are never painted in; the page draws rings, pennants and health bars.
- Weapon sounds and battle effects are synthesized in code (`client/sfx.js`, `client/fx.js`), not files; see [[Sound, Music and Effects]].
- Earned-rank marks and panel state icons are shapes drawn in code (`client/marks.js`), not pictures.
- The two menu music tracks are CC-BY 4.0 and, per `assets/audio/CREDITS.md`, must not ship in a public build until the game has a credits screen.

## Related

- [[Reference Map]]
- [[Art Style Guide]]
- [[Art Pipeline]]
- [[Licences and Credits]]
- [[Map Rendering]]
- [[Sound, Music and Effects]]
- [[Decision - Isometric Art]]
- [[Make Targets]]
- [[Speech]]
