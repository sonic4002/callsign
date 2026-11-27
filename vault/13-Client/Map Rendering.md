---
title: Map Rendering
description: "The battlefield is drawn by Scene in client/map.js on a 2D canvas, every animation frame, from the last state the server sent this side."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/code
  - area/client
  - topic/client
  - topic/map
  - topic/rendering
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Art Pipeline]]"
  - "[[Art Style Guide]]"
  - "[[Radar and Fog of War]]"
  - "[[Selection and Map Orders]]"
  - "[[Sim Loop and Determinism]]"
  - "[[Client]]"
  - "[[Page Layout]]"
  - "[[Sound, Music and Effects]]"
  - "[[Terrain, Cover and Bridges]]"
  - "[[Art and Assets]]"
paths:
  - client/map.js
  - client/iso.js
  - client/tiles.js
  - client/terrain.js
  - client/fog.js
  - client/art.js
  - client/bases-art.js
  - client/motion.js
  - client/touch.js
  - client/gold.js
---

# Map Rendering

The battlefield is drawn by `Scene` in `client/map.js` on a 2D canvas, every animation frame, from the last state the server sent this side. The ground is baked once into pictures; everything that stands on it is drawn fresh each frame, sorted far to near, under a fog picture and above it the labels.

## Projection (`client/iso.js`)

The simulation's world is flat: x grows east, y grows south, in map units ("metres"). The screen shows it as a 2:1 diamond with west always on the left.

| Step | Formula |
|---|---|
| World → iso plane | `toIso(x, y) = [x − y, (x + y) / 2]` |
| Iso plane → world | `fromIso(ix, iy) = [iy + ix/2, iy − ix/2]` |
| World → CSS pixel | `screen = ((ix − cx)·zoom + w/2, (iy − cy)·zoom + h/2)` where `(cx, cy)` is the iso point at the middle of the view |
| Ground circle of radius r | an ellipse `r·√2` wide by `r·√2/2` high (`groundEllipse`) |
| As one canvas transform | `ctx.transform(z, z/2, −z, z/2, w/2 − cx·z, h/2 − cy·z)` (used to lay the flat fog picture over the view) |

Nothing here depends on the page language: the map never mirrors.

### Camera

- `fitZoom` shows the whole map with margins; `READABLE = 0.36` is the least zoom at which troops and labels can be read. The opening view (`fit()`) is `max(fitZoom, READABLE)`, centred on `home` (a spot 260 units in front of the player's headquarters) when the whole map does not fit.
- Zoom is clamped between `fitZoom` and `4 × max(fitZoom, READABLE)`. `zoomAt` keeps the point under the cursor in place; `pan`, `centerOn` (used by a mini-map click) and the finale move it.
- Canvas pixels per CSS pixel are capped (`capRatio` in `touch.js`): 2 on touch devices, 3 otherwise.

## The ground: baked once, then tiles

`Scene.bake()` paints the terrain into one off-screen canvas (`this.layer`) with the context set to the iso plane.

| Constant | Value | Meaning |
|---|---|---|
| `RES` | 1.5 | Pixels per iso unit of the whole-map picture, at most |
| `BAKE_PIXELS` | 11e6 | Cap on that picture's size; a big map is baked coarser ("phones refuse more") |
| `MARGIN` | 90 | Iso units of margin round the map |
| `TILE` | 1024 | A sharp tile is 1024 px square |
| `LEVELS` | `[0.75, 1.5]` | Resolutions a tile may be baked at |
| `TILES_KEPT` / `TILES_KEPT_PHONE` | 16 / 8 | Tiles kept (about 4 MB each); least recently used is dropped |

`paintTerrain` draws, in order: a dark "slab" skirt under the map's near edges; land (the `terrain.land` sprite as a repeating pattern, or a code-drawn mottled green); water, ice and mountains from the map's terrain grid (`paintGround` in `terrain.js`, with the `sea`, `ice`, `mountain` pattern sprites when loaded); then scattered scenery (trees, bushes, stones: painted props through `drawScatter`, else `drawScenery`). The random generator is seeded with a constant (`rng(20261124)`), so the ground looks the same on every load.

`drawGround` lays the whole-map picture and, when the view is closer than it can show (`detailLevel(zoom × dpr, res)`), the sharp tiles of the part in view over it. A missing tile is baked at most one per frame so panning never stalls; if the view needs more tiles than are kept, the coarse picture alone is used. Tiles are snapped to whole device pixels so no seam shows. (Added in commit bb6afe6 when the maps grew.)

## One frame (`Scene.paint`)

1. Sky gradient, baked ground, moving glints on open water.
2. Movement: every team eases toward the server's position (`advance` in `motion.js`: smoothed speed, a turn rate per mover kind — foot, wheels, boat, air, jet — and distance covered for stride and wheels). Foot squads are drawn spread 1.75× apart so a squad is not one heap.
3. Triggers for this frame: gunfire, defence fire, smouldering headquarters, gusher sound, building-site dust and sparks, particle update.
4. Bridges (painted deck pieces from `sprites.segments.bridge`, else `drawBridge`).
5. Ground markings: each point's capture ring in its owner's colour with a progress arc; a dashed order line from each own squad to its target point; a ring under every team; the selected squad's breathing yellow ring (`SELECT = #ffd84a`); nerve rings when the "show nerve" setting is on.
6. Gold fields, the placement tint, ground effects (scorch marks, dust).
7. Everything that stands, depth-sorted (below).
8. Tracers, rockets in flight and falling bombs.
9. Fog of war, then the placement ghost, labels, the compass, the lesson's ring, and the mini map.

### Depth sorting

Every standing thing is pushed into one list with `depth = x + y` in world units (further south-east is nearer the viewer) and drawn in ascending order: point buildings (headquarters by faction, with `_ruin` once fallen), structures and fences, rally flags, gushers, remembered enemy haulers (35 % opacity), landmarks, teams, casualties (`depth − 1`), and standing smoke and fire. Aircraft get `+90` so they draw over what stands beneath them.

### Scales

Sprites are drawn larger than true scale to stay readable: `unitScale = max(0.78·crowd, min(2.0, zoom·1.3))`, `buildScale = max(0.66·crowd, min(2.5, zoom·1.8))`, with `crowd = clamp(zoom/0.3, 0.5, 1)`.

## Sprites and fallbacks (`client/art.js`)

- `loadSprites()` reads `/assets/sprites/manifest.json`: groups `units`, `buildings`, `landmarks`, `props`, `segments`, `terrain`, `variants`, `portraits`, `icons`. A missing manifest or image is never an error: that thing keeps its code-drawn look. The start screen does not wait for the pictures.
- Animated unit sheets have a row per map heading (eight; sixteen for vehicles per commit eea0d81) and a column per frame, with named runs (`anims`); a unit with a turret has a second sheet. Models are rendered at `ppm` pixels per metre and drawn at `METRE = 15`.
- Structures: a painted sprite under the structure's rules id (construction stages, door patches "open" and "lit", a turning part, a power-down look, `<id>_ruin`), else a code-drawn picture per role in `bases-art.js` (`fallbacks`: barracks, refinery, works, airbase, dockyard, power, radar, defence) in the faction's palette.
- Landmarks: the painted picture of that very landmark, else `landmarkFallbacks` in `terrain.js`.
- Rank marks and panel icons are code-drawn paths (`marks.js`), never images.

How the pictures are made: [[Art Pipeline]]; the look: [[Art Style Guide]].

## Fog (`client/fog.js`)

The server sends which cells this side has ever seen (`state.fog`: `cell`, `cols`, `rows`, `seen` as base64 bits). The page paints a small flat picture of the whole map (about `FOG_PIXELS = 130000` pixels, at least 8 map units per pixel, padded 160 units past the edge): solid ink `#04070a`, then "seen before" cut out to half darkness (`DIM = 0.5`, smoothed so cells blur), then what is in sight now cut out fully with a soft radial gradient per eye. Eyes (`Scene.eyes()`) are the side's headquarters (`rules.hq.sight`), points it holds (`match.pointSight`), its living teams (unit `sight`) and its finished structures. The same picture is laid over the mini map. What the server hides is in [[Radar and Fog of War]].

## Labels

Name plates are drawn above the fog: each point as `<letter> · <callsign>` in the page language with its name and income below; tech buildings with what holding them gives; enemy structures by name; own squads by callsign (with a cover percentage and `⛨` when in cover, brass chevrons for brain tier, silver marks for earned rank, a hero's health bar); enemy squads as "Target N" (`callsigns.contact`). Plates that would overlap move up or down (`clearOf`); each squad plate's box is remembered in `squadPlates` so a press on a name is a press on the squad ([[Selection and Map Orders]]). Health bars appear over anything damaged or still going up. Text direction of a plate follows its own script, not the page.

## What the page infers

The server says which of the player's own teams fire; for an enemy in sight, firing is inferred from having one of ours in its range, and the tracer target is the nearest enemy team, else the object the order names, else the headquarters. Defence fire is shown the same way from the rules' range and cooldown. These are pictures only; the server decides all damage ([[Sim Loop and Determinism]]).

## Related

- [[Client]]
- [[Page Layout]]
- [[Selection and Map Orders]]
- [[Sound, Music and Effects]]
- [[Radar and Fog of War]]
- [[Terrain, Cover and Bridges]]
- [[Art and Assets]]
- [[Decision - Isometric Art]]
