---
title: Art Pipeline
description: "The art is produced by scripts in art/ that run in two Docker images with the network off: an image model (FLUX.2 klein 4B in ComfyUI) makes buildings, scenery, ground and portraits from words, ..."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/code
  - area/art-and-audio
  - topic/art
  - topic/pipeline
created: 2026-11-26
updated: 2026-11-27
agent: CLD
origin: code
confidence: medium
related:
  - "[[Art Direction and Sprite Pipeline]]"
  - "[[Art Style Guide]]"
  - "[[Licences and Credits]]"
  - "[[Make Targets]]"
  - "[[Map Rendering]]"
  - "[[Structures and Build Tree]]"
  - "[[Strike Aircraft]]"
  - "[[Heroes]]"
paths:
  - art/generate.py
  - art/cleanup.py
  - art/paint.py
  - art/paint.json
  - art/units.py
  - art/props.py
  - art/plan.py
  - art/sheet.py
  - art/rename_keys.py
  - art/sprites.json
  - art/models.sh
  - art/Dockerfile
  - art/Dockerfile.blender
  - assets/sprites/CREDITS.md
  - assets/sprites/manifest.json
  - Makefile
---

# Art Pipeline

The art is produced by scripts in `art/` that run in two Docker images with the network off: an image model (FLUX.2 klein 4B in ComfyUI) makes buildings, scenery, ground and portraits from words, and Blender renders units and run pieces from models built in code, which the image model then paints. Each kind of picture has one route; nothing is drawn by hand.

## Routes

| Kind | Made by | Command |
|---|---|---|
| Buildings, houses, trees, rocks, ground, portraits | `generate.py` then `cleanup.py` | `make art` |
| Units | `units.py` (Blender), then `paint.py` | `make art-units`, `make art-paint` |
| Walls, fences, bridge, sandbags, gold, turning parts | `props.py` (Blender); walls, fences, bridge and sandbags also painted | `make art-units`, `make art-paint` |
| Review pictures | `sheet.py` | `make art-sheet` |

## Images and model weights

| Target | What it does |
|---|---|
| `make art-image` | Builds `callsign-art` from `art/Dockerfile`: Python 3.12, PyTorch with CUDA, ComfyUI `v0.46.2`, `rembg`. About 13 GB. |
| `make art-models` | Runs `art/models.sh` once with the network on, into the Docker volume `callsign-art-models`: `flux-2-klein-4b.safetensors`, `qwen_3_4b_fp4_flux2.safetensors`, `flux2-vae.safetensors`, `birefnet-general.onnx`. About 13 GB. |
| `make art-units-image` | Builds `callsign-blender` from `art/Dockerfile.blender`: Python 3.11 with `bpy==4.2.0` and Pillow. About 2.7 GB. Cycles on the CPU. |

Generation and painting need a GPU (`--device nvidia.com/gpu=all`); unit rendering runs on the CPU in a few minutes.

## Route 1: generated pictures (`make art`)

`python art/generate.py && python art/cleanup.py && python art/rename_keys.py`

**`art/sprites.json`** holds twelve prompt templates (`styles`: `building`, `ruin`, `terrain`, `scenery`, `site`, `stage`, `door`, `portrait`, and `airfield`, `airfield_ruin`, `airfield_stage`, `airfield_door` for the two airfields) and 164 sprite entries (128 buildings, 30 landmarks, 4 terrain, 2 portraits). An entry has `id`, `kind`, `style`, `subject` (the words), `seeds` (candidates to try), `height`, `draw`, and optionally `from`, `plan`, `door`, `lamp`, `keep`.

**The keep mechanism.** `generate.py` starts ComfyUI on the container's loopback and writes one raw candidate per sprite and seed to `assets/raw/<id>__<seed>.png` (existing ones are skipped; `--seeds 5 6 tank` tries other seeds). A person looks at the candidates (`sheet.py candidates`) and sets `"keep": <seed>` on the one that passed review. `cleanup.py` turns only kept sprites into game sprites; a sprite without `keep` is left out of the manifest and the page draws its own stand-in. All 164 entries currently name a `keep`. Because `assets/raw` is not in git, a kept sprite whose raw image is not on the machine keeps the picture and manifest entry it already has; since 2026-11-27 `cleanup.py` finds that picture under the name `rename_keys.py` gave it, so `python art/cleanup.py <id ...>` remakes only the named sprites on a machine without the other raws. A run that writes a picture also gives the manifest a new `stamp`.

**Second states (`from`).** 107 entries are a second state of another sprite: a ruin, a construction site or stage, or an open door. The model redraws the kept image of the building (the klein image-edit graph with a reference latent), so the result stands exactly where the building does and is trimmed to the same frame.

**Sites painted over a plan (`plan`, since 2026-11-27).** The two airfields (`aegis_airbase`, `ashfall_launchYard`: rules ids `airbase`, `launchYard`) are not one block but a site the game parks aircraft on, so their layout is not left to words. `art/plan.py` draws a block-out in the game's projection (`sx = x - y`, `sy = (x + y) / 2`, 3.2 picture pixels a world unit, on a blue backdrop) and `generate.py` has the model redraw it with the same image-edit graph; the painted picture keeps the block-out's positions to the pixel. `cleanup.py` then sizes the picture so one world unit of the plan is one world unit on the page at zoom 1 (stored at 2.6 times `height`, drawn at 1.8 times `height`, the `buildScale` factor in `client/map.js`) and puts the anchor on the plan's middle. The plan, in world units from the structure's centre, x east and y south:

| Part | Where |
|---|---|
| Slab | the square of half-width 70 with its corners cut at `abs(x) + abs(y) = 118` |
| Runway | x -66 to 66, y 27 to 53 (the near, lower-left edge) |
| Apron | the open middle; aircraft stand in a row at y 0 |
| Two hangars, fronts open to the south | x -56 to -18 and x -12 to 26, y -62 to -28, 20 high |
| Tower (Aegis) or lookout post (Ashfall) | x -68 to -58, y -50 to -40 |
| Helicopter pad with the H | centre (47, -43), radius 17; the door's `exit` and `rally` are both here, with `lift: true` |

The H is the only lettering in any picture. The door patch covers the front of the east hangar; `lamp` is the tower top. Ruin, stages and door are second states (`from`) with their own `airfield_*` templates, which name the blue backdrop and allow the H.

| Setting (`generate.py`) | Value |
|---|---|
| Sampler | `euler`, Flux2Scheduler |
| Steps | 4 at guidance 1 (what the distilled model is made for) |
| Size | 1024 x 1024 |

**`cleanup.py`** cuts the background away (BiRefNet through rembg), trims, scales to 2.6 times the drawn height, and writes `assets/sprites/{buildings,landmarks,terrain,portraits}/<id>.png`, the manifest and `CREDITS.md` (model, licence, seed and prompt of every sprite). Details:

- Construction stages `<id>_stage1`, `_stage2`, ... are listed in order under the building's `stages`; `<id>_site` is another name for the first.
- A door (`<id>_open`) is a small patch cut around the building's `door.box`, drawn over the building; `<id>_lit` is the same patch with the light on. `exit` and `rally` are fractions of the building's picture.
- Terrain tiles are made to repeat by cross-fading each edge into the far side; ice and rock are also evened out.
- Build-card icons are fitted to 144 x 96.

## Route 2: units (`make art-units`, then `make art-paint`)

**`art/units.py`** builds every unit as an original low-poly model of boxes, prisms and cylinders, poses it by turning its joints, turns it to its headings under one fixed light and renders it with Blender (Cycles, CPU) from the game's camera (30 degrees elevation, 40 px a metre). Frames are packed into one sheet per unit: a row per heading, a column per frame. It owns the `units` part of the manifest and writes the plain renders to `assets/raw/plain`.

Shipped sheets and their animations (`assets/sprites/manifest.json`):

| Sheets | Headings | Animations |
|---|---|---|
| `commandos`, `militia`, `rpgTeam` | 8 | `idle`, `walk` (twelve frames), `fire`, `cover`, `coverFire`, `die`, `stop` |
| `engineers`, `sappers` | 8 | the same plus `work` |
| `sentinel` (hero) | 8 | soldier set plus `prone`, `proneFire`, `plant` |
| `oracle` (hero) | 8 | soldier set plus `disguise`, `disguiseWalk`, `seize` |
| `fpvSwarm` | 8 | `idle`, `walk`, `fire`, `die` |
| `crawler`, `dumpTruck` (haulers) | 8 | `idle`, `move`, `full`, `moveFull`, `load`, `unload`, `wreck` |
| `tank`, `technical`, `rocketLauncher` | 16 | `idle`, `wreck`, `move`; separate `_turret` sheets |
| `patrolBoat`, `speedboat` | 16 | `idle`, `sink`, `move`; separate `_turret` sheets |
| `helicopter` | 8 | `idle`, `wreck`, `move`, `bankLeft`, `bankRight`; `_turret` sheet |
| `strikeJet`, `propBomber` | 16 | `idle`, `wreck`, `move`, `bankLeft`, `bankRight`; no turret sheet |

The page does not show a strike aircraft's `bankLeft` / `bankRight` frames (`animatedVehicle` in `client/art.js`, since 2026-11-27): the aircraft reverses for home in about half a second, and at the camera's angle a rolled wing reads as a broken picture. Its sixteen headings carry the turn. The frames stay in the sheets; the helicopter still banks.

**`art/paint.py`** paints the plain sheets in the buildings' style (commit a8b3e75). The render goes in as the picture to start from and the model keeps three of its four steps (`START = 1`), so the output has the same shape in the same place. Then:

- the frame's alpha is still the render's own, so nothing is cut out by guesswork and no frame moves;
- colours are pulled back 75% toward the render's (`KEEP = 0.75`);
- frames that are one heading of one animation step sit in the same place of the 1024 px canvas and are painted from the same noise (seed 7 in `art/paint.json`), so a walk does not flicker.

`art/paint.json` gives the words for 18 units and 5 pieces (`barrierWall`, `wireFence`, `wall`, `bridge`, `sandbags`). Painted canvases are kept in `assets/raw/paint/<sheet>/`; deleting one paints it again. `make art-paint UNITS="tank militia"` paints only those; all of them take about an hour. `--plain` writes the render with the outline only.

## Route 3: run pieces and props (`art/props.py`)

Things laid end to end cannot be painted to meet their neighbour exactly, so they are modelled and rendered once along the map's east-west axis (`x`) and once along north-south (`y`). Each piece covers exactly 4 m of its run (`LENGTH`), which is 60 world units, with a small overlap so no gap shows. It owns the `segments` and `props` parts of the manifest and also renders:

- the sandbag position: a row for each of eight headings, a column for each state (`whole`, `damaged`, `flat`), covering a 130 degree arc;
- the radar dish and antenna loop: 12 frames for a full clockwise turn;
- three gold-field patches.

## Last step: `art/rename_keys.py`

The pipeline names a faction's pictures with the faction in front (`aegis_works`, `ashfall_hauler`) because one prompt file holds both armies. The game asks for a picture by rules id, so this step renames manifest keys and files (`aegis_works` becomes `vehicleWorks`). It runs last in `make art` and `make art-units` and can be run any number of times.

Differs from `assets/sprites/CREDITS.md`: the credits text names the hero sheets `units/aegis_sentinel.png` and `units/ashfall_oracle.png`; the files and manifest keys are `sentinel` and `oracle`.

## Review sheets (`make art-sheet`)

Writes four pictures in the repo root (git-ignored): `art-sheet.png` (every finished sprite on the game's ground at game size), `art-stages.png` (each structure going up, then its door open and lit), `art-leaving.png` (a unit coming out of each producing structure and walking to its rally point), `art-powered.png` (power and radar structures lit and with the power down, the dish through a turn, tech buildings unheld and held). `sheet.py` also has `candidates`, `grid` and `strip` modes.

## History in brief

| Commit | Step |
|---|---|
| 4a9ede0 | Local sprite pipeline and the first isometric sprite set |
| 20f4b20 | Blender-rendered units with eight facings and walk, fire and death animation |
| ebdf733, caa0b49 | Structures, landmarks, terrain, haulers, engineers, run pieces |
| eea0d81, 0162d26 | Heroes, sixteen headings for vehicles, construction stages, doors, portraits |
| a8b3e75, c32c4fc, 7739d00, 11ba41b | The style sheet and the painter; all units, then haulers, walls, fences, bridge and sandbags painted |
| c7c5b1a | The strike jet and the prop bomber |

## Related

- [[Art Direction and Sprite Pipeline]]
- [[Art Style Guide]]
- [[Licences and Credits]]
- [[Make Targets]]
- [[Map Rendering]]
- [[Structures and Build Tree]]
- [[Strike Aircraft]]
- [[Heroes]]
