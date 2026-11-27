---
title: Decision - Isometric Art
description: "The game's art is isometric (3/4 view) sprites with no text baked into images, generated locally and reviewed before use."
type: decision
status: current
tags:
  - type/decision
  - status/current
  - agent/CLD
  - origin/mixed
  - area/decisions
  - topic/art
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Art Pipeline]]"
  - "[[Art Style Guide]]"
  - "[[Licences and Credits]]"
  - "[[Map Rendering]]"
  - "[[Locked Decisions]]"
  - "[[Art Direction and Sprite Pipeline]]"
paths:
  - CLAUDE.md
  - docs/PLAN.html
  - docs/art/STYLE.md
  - assets/NOTICE.md
  - art/generate.py
  - art/units.py
---

# Decision - Isometric Art

The game's art is isometric (3/4 view) sprites with no text baked into images, generated locally and reviewed before use. The view was changed from top-down on 2026-11-24, one day into the project.

## The decision as written

> - Isometric (3/4 view) sprites, changed from top-down on 2026-11-24; no text baked into images. Generated locally (ComfyUI, FLUX.2 klein 4B, Apache-2.0; the 9B model is non-commercial) under `assets/`, reviewed before use.

| | |
|---|---|
| Date | 2026-11-24 (commits `6dcfb63`, the page restyled as an isometric RTS screen, and `4a9ede0`, the sprite pipeline and the first isometric sprite set) |
| Decided by | recorded in `CLAUDE.md` as a change; the owner's reason is not recorded |
| Replaced | "Top-down sprites, no text baked into images. Generated locally (ComfyUI, FLUX.2 klein / Z-Image Turbo)" (2026-11-23) |

## What it replaced in the plan

`docs/PLAN.html` (section November) specified a strict top-down view, 8 facings, FLUX.2 klein 9B with Z-Image Turbo as a second option, BiRefNet background removal, a style LoRA after the first twenty sprites, and a review of every batch.

## What changed besides the view

- **The model.** The 4B model is used because it is Apache-2.0; `CLAUDE.md` notes "the 9B model is non-commercial".
- **Units are not generated images.** They are 3D models built in code and rendered in Blender to sprite sheets with facings and walk, fire and death frames (commit `20f4b20`), then repainted in the buildings' style by the image model (`a8b3e75`, `c32c4fc`, `7739d00`).
- **Buildings, landmarks, terrain and portraits** are generated and cleaned up, with candidates kept by hand in `art/sprites.json`.

The pipeline is in [[Art Pipeline]], the style rules in [[Art Style Guide]] and the licences in [[Licences and Credits]].

## How the code stands

Matches. The page projects the map isometrically and the map itself never mirrors for Hebrew ([[Map Rendering]]). No text is baked into sprites; labels are drawn by the page in the current language.

## Related

- [[Locked Decisions]]
- [[Art Direction and Sprite Pipeline]]
- [[Art Style Guide]]
- [[Art Pipeline]]
- [[Licences and Credits]]
- [[Map Rendering]]
