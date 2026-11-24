# Callsign art style

One page. Every picture in the game is held to it; a picture that breaks a rule here is
redone, not excused. The reference is the painted buildings (`assets/sprites/buildings`):
everything else is brought up to them.

## The look

Hand-painted pixel-art: flat, clean colour areas with painted detail inside them (panel
lines, seams, hatches, planks, rust, soot), a dark outline round every object and round its
main parts, and one clear light. Not photographic, not smooth 3D, not flat vector shapes.

## View

- Isometric, 2:1 diamond: the camera looks down at 30° from the south-east of the object.
  Map east runs down-right on screen, map south runs down-left. The map never mirrors.
- Orthographic: no perspective, no horizon, no vanishing lines.
- A picture is one object, whole and uncropped, on a transparent background, with no
  ground, no scenery and no cast shadow painted in (the game draws the shadow).
- No text, letters, numbers, logos, flags or insignia in any picture.

## Light

- One light from the upper left of the picture. Tops are lightest, faces turned left are
  mid, faces turned right and undersides are darkest.
- A unit sheet is lit after it is turned, so every heading has the same light on screen.

## Outline and shading

- Outline colour `#161a1e`, never pure black. On a unit sheet it is 2 px at sheet size
  (about 1 px on screen), on a building 2 to 3 px in the stored picture.
- Three tones per material are enough: lit, mid, shaded. Detail is drawn with lines and
  small marks, not with gradients.
- Glass is dark slate with one pale glint. Lamps and muzzle flashes are the only parts
  that glow.

## Palettes

| | Aegis Directorate | Ashfall Network |
|---|---|---|
| Idea | clean, prefabricated, high-tech | improvised, patched, rusty |
| Main | blue-grey `#71889a`, shaded `#4a5b68`, deep `#2b353d` | sand `#b79560`, shaded `#7d6239`, deep `#3a2e22` |
| Second | white and pale grey panels `#d9e2e8` | rust red `#a2523c`, olive `#6b6a45`, raw timber |
| Accent | pale cyan `#cfeef4` (visors, lamps), hazard yellow on working vehicles | ochre `#c9a23f` head wraps, orange `#d9722e` on sappers and the Oracle |
| Soldiers | blue-grey uniform, dark vest, helmet with pale visor | sand and olive clothes, head wrap, wooden rifle |

Buildings of no army (clinic, garage, goldworks, houses) use plaster, brick and tile:
neither blue-grey nor sand. The ground is dry sand-olive scrub; nothing that stands on it
may be the same value as it, which is what the outline is for.

Wrecks and ruins are the same picture burnt: charcoal `#2a2a2c` with soot, never a new shape.

## Team colour

The army's palette says whose a thing is; it is painted in. The side colours (blue
`#4da3ff`, red `#ff6b4a`, grey `#cfd3c8` for no one) are never painted into a picture: the
game draws them as rings under squads, pennants, name plates and health bars. A captured
building keeps its picture and changes its pennant.

## Sizes

| Kind | Stored | Drawn |
|---|---|---|
| Units | sheets at 40 px a metre, a row per heading (E, SE, S, SW, W, NW, N, NE by the map), a column per frame | 15 px a metre times the unit scale (0.8 to 2) |
| Buildings, landmarks | 2.6 times `height` in the manifest | `height` px times the build scale (0.66 to 2.5) |
| Walls, fences, bridge | pieces at 40 px a metre, one per axis | laid end to end |
| Build-card icons | 144 x 96 | as they are |
| Portraits | 192 x 192, head and shoulders, dark slate-blue ground | as they are |
| Ground | tiles that repeat, seen from straight above, even light | as a pattern |

A soldier is about 1.8 m (27 px before the unit scale), a tank 7 m. Judge every picture at
that size on the ground texture, not enlarged on white.

## Animation

Frames of one animation must not move, grow or change colour against each other: the
shape of every unit frame comes from the 3D model (`art/units.py`), and the paint is laid
over it (`art/paint.py`) from the same noise for the same heading, then pulled back to the
model's own colours. Never repaint a single frame by hand or with another seed.

## How a picture is made

| Kind | Made by | Command |
|---|---|---|
| Buildings, houses, trees, rocks, ground, portraits | FLUX.2 klein 4B from words (`art/sprites.json`), background cut away | `make art` |
| Units | Blender model in code, then painted over by FLUX.2 klein 4B (`art/paint.json`) | `make art-units`, `make art-paint` |
| Walls, fences, bridge, sandbags, gold | Blender model in code | `make art-units` |

Only models and assets whose licence allows selling the game: FLUX.2 klein 4B is
Apache-2.0 (the 9B model is not allowed). Anything from outside is CC0 or as permissive,
is listed in `assets/NOTICE.md`, and is restyled to this page before it goes in.

## Review

Every picture is looked at before it is committed: on the ground texture, at game size,
beside a building of its army. Reject for: a different view angle, light from the wrong
side, a halo or missing pieces at the edge, a baked ground slab or shadow, anything that
reads as text, a frame that jumps.
