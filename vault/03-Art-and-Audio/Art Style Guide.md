---
title: Art Style Guide
description: "docs/art/STYLE.md is the one-page rule sheet every picture is held to: 'a picture that breaks a rule here is redone, not excused'."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/mixed
  - area/art-and-audio
  - topic/art
  - topic/style
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Licences and Credits]]"
  - "[[Art Pipeline]]"
  - "[[Art Direction and Sprite Pipeline]]"
  - "[[Decision - Isometric Art]]"
  - "[[Factions]]"
  - "[[Map Rendering]]"
paths:
  - docs/art/STYLE.md
  - art/sprites.json
  - art/paint.json
  - art/units.py
  - assets/sprites/manifest.json
---

# Art Style Guide

`docs/art/STYLE.md` is the one-page rule sheet every picture is held to: "a picture that breaks a rule here is redone, not excused". The reference is the painted buildings in `assets/sprites/buildings`; everything else is brought up to them.

## The look

Hand-painted pixel-art: flat, clean colour areas with painted detail inside them (panel lines, seams, hatches, planks, rust, soot), a dark outline round every object and its main parts, and one clear light. Not photographic, not smooth 3D, not flat vector shapes.

## View

| Rule | Value |
|---|---|
| Projection | Isometric, 2:1 diamond, orthographic (no perspective, no horizon) |
| Camera | Looks down at 30 degrees from the south-east of the object (`ELEVATION` in `art/units.py`) |
| Axes on screen | Map east runs down-right, map south runs down-left |
| Mirroring | The map never mirrors, also in the right-to-left Hebrew interface |
| Content of a picture | One object, whole and uncropped, transparent background, no ground, no scenery, no cast shadow (the game draws the shadow) |
| Forbidden | Text, letters, numbers, logos, flags or insignia in any picture |

Differs from the style page: the prompt templates for generated buildings and scenery in `art/sprites.json` say "camera raised about 35 degrees", while the style page and the unit renderer use 30 degrees.

## Light, outline, shading

- One light from the upper left of the picture. Tops lightest, faces turned left mid, faces turned right and undersides darkest.
- A unit sheet is lit after it is turned, so every heading has the same light on screen.
- Outline colour `#161a1e`, never pure black: 2 px at sheet size on a unit (about 1 px on screen), 2 to 3 px in a stored building picture.
- Three tones per material: lit, mid, shaded. Detail is lines and small marks, not gradients.
- Glass is dark slate with one pale glint. Lamps and muzzle flashes are the only parts that glow.

## Palettes

| | Aegis Directorate | Ashfall Network |
|---|---|---|
| Idea | clean, prefabricated, high-tech | improvised, patched, rusty |
| Main | blue-grey `#71889a`, shaded `#4a5b68`, deep `#2b353d` | sand `#b79560`, shaded `#7d6239`, deep `#3a2e22` |
| Second | white and pale grey panels `#d9e2e8` | rust red `#a2523c`, olive `#6b6a45`, raw timber |
| Accent | pale cyan `#cfeef4` (visors, lamps), hazard yellow on working vehicles | ochre `#c9a23f` head wraps, orange `#d9722e` on sappers and the Oracle |
| Soldiers | blue-grey uniform, dark vest, helmet with pale visor | sand and olive clothes, head wrap, wooden rifle |

- Buildings of no army (clinic, garage, goldworks, houses) use plaster, brick and tile: neither blue-grey nor sand.
- The ground is dry sand-olive scrub; nothing standing on it may be the same value as it.
- Wrecks and ruins are the same picture burnt (charcoal `#2a2a2c` with soot), never a new shape.

## Team colour

The army's palette says whose a thing is and is painted in. The side colours (blue `#4da3ff`, red `#ff6b4a`, grey `#cfd3c8` for no one) are never painted into a picture: the game draws them as rings under squads, pennants, name plates and health bars. A captured building keeps its picture and changes its pennant.

## Sizes

| Kind | Stored | Drawn |
|---|---|---|
| Units | Sheets at 40 px a metre; a row per heading (E, SE, S, SW, W, NW, N, NE by the map), a column per frame | 15 px a metre times the unit scale (0.8 to 2) |
| Buildings, landmarks | 2.6 times `height` in the manifest (`DRAWN` in `art/cleanup.py`) | `height` px times the build scale (0.66 to 2.5) |
| Walls, fences, bridge | Pieces at 40 px a metre, one per axis | Laid end to end |
| Build-card icons | 144 x 96 | As they are |
| Portraits | 192 x 192, head and shoulders, dark slate-blue ground | As they are |
| Ground | Tiles that repeat, seen from straight above, even light | As a pattern |

A soldier is about 1.8 m (27 px before the unit scale), a tank 7 m. Every picture is judged at that size on the ground texture, "not enlarged on white".

Headings in the shipped sheets (`assets/sprites/manifest.json`): soldiers, heroes, haulers, the helicopter and the drone swarm have 8; the tank, technical, rocket launcher, both boats and both strike aircraft have 16 (commit eea0d81 gave vehicles sixteen).

## Animation

Frames of one animation must not move, grow or change colour against each other. The shape of every unit frame comes from the 3D model (`art/units.py`); the paint is laid over it (`art/paint.py`) from the same noise for the same heading, then pulled back to the model's own colours. Never repaint a single frame by hand or with another seed.

## Licence rule

Only models and assets whose licence allows selling the game. FLUX.2 klein 4B is Apache-2.0; the 9B model is non-commercial and not allowed. Anything from outside must be CC0 or as permissive, listed in `assets/NOTICE.md`, and restyled to this page before it goes in. See [[Licences and Credits]].

## Review

Every picture is looked at before it is committed: on the ground texture, at game size, beside a building of its army. Reasons to reject: a different view angle, light from the wrong side, a halo or missing pieces at the edge, a baked ground slab or shadow, anything that reads as text, a frame that jumps. The review sheets come from `make art-sheet`; see [[Art Pipeline]].

## Related

- [[Art Direction and Sprite Pipeline]]
- [[Art Pipeline]]
- [[Licences and Credits]]
- [[Decision - Isometric Art]]
- [[Factions]]
- [[Map Rendering]]
