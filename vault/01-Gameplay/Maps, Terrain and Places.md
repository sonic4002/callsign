---
title: Maps, Terrain and Places
description: "All three maps in shared/rules.json (generated via tools/mapgen.py) are mirrored west–east for fairness and contain every terrain type: land, water, ice, mountains, and destructible bridges."
type: overview
status: current
tags:
  - type/overview
  - status/current
  - agent/AGY
  - origin/code
  - area/gameplay
  - topic/gameplay
  - topic/maps
  - topic/terrain
created: 2026-11-26
updated: 2026-11-26
agent: AGY
origin: code
confidence: medium
related:
  - "[[Home]]"
  - "[[Radio Net and Bilingual Procedure]]"
  - "[[Base Building and Economy]]"
  - "[[System Architecture]]"
paths:
  - shared/rules.json
  - tools/mapgen.py
  - server/sim/place.go
---

# Maps, Terrain and Places

All three maps in `shared/rules.json` (generated via `tools/mapgen.py`) are **mirrored west–east** for fairness and contain every terrain type: land, water, ice, mountains, and destructible bridges.

## The Three Maps

| ID | English Name | Hebrew Name | Dimensions | Default Length | Character |
|---|---|---|---|---|---|
| `small` | **Twin Bridges** | שני הגשרים | `2800 × 1760` | 15 min | Compact river crossing with frozen northern ford, center town (*Foxtrot*), 3 bridges, and southern sea rig (*Sierra*). |
| `medium` | **Frozen Lake** | האגם הקפוא | `4000 × 2480` | 20 min | Wide northern frozen lake with an islet (*November*), flanking villages (*Lima* / *Mike*), and southern coast. |
| `large` | **Mountain Passes** | מעברי ההרים | `5200 × 3200` | 25 min | High mountain spine splitting lanes, multiple tech buildings (Assay Office, Clinic, Service Yard), and full combined-arms fronts. |

## Terrain Rules (`terrainKinds`)
- **Land (`L`)**: Standard ground movement (`1.0×` speed) and buildable where unobstructed.
- **Water (`W`)**: Boats only; impassable to ground units except over standing bridges.
- **Ice (`I`)**: Crossable shortcut for ground units at **`0.6×` speed** with **no cover**—high risk under fire.
- **Mountain (`M`)**: Impassable to ground and naval units; aircraft fly over freely.

## Cover, Garrisons, Sandbags & Bridges
- **Cover Landmarks**: `grove` (`0.75×` dmg), `rocks` (`0.70×`), `wall` (`0.70×`), `rubble` (`0.80×`). Stationary fireteams behind cover take reduced hits from shooters on the far side and **cannot be crushed** by tanks.
- **Garrisonable Buildings**: `house` (4 teams, `600 HP`, `0.6×`), `bunker` (4 teams, `1200 HP`, `0.5×`), `ruin` (3 teams, `260 HP`, `0.7×`). Garrisoned troops stay hidden until within `90` units or for `3s` after firing; building takes `50%` damage share and evicts shaken occupants into rubble if destroyed.
- **Sandbags (Fortify)**: Infantry can dig in (`6s`, up to `2` per squad) to create directional `sandbags` (`0.55×` dmg across a `130°` front arc, `260 HP`, destructible by heavy fire or vehicles).
- **Destructible Bridges**: `900 HP`. Collapsing a bridge destroys every ground unit standing on it (`bridge_fell` event) and cuts A* pathing until repaired to `50%` HP by Engineers/Sappers.

## Descriptive Places
The server's place resolver (`server/sim/place.go`) accepts:
1. Map point IDs or bilingual aliases (`"Foxtrot"`, `"פסל"`, `"the town"`, `"העיירה"`)
2. Named landmarks (`"the grove north of Foxtrot"`, `"הבית מצפון לפסל"`)
3. Structures and neutral tech buildings (`"the enemy works"`, `"the clinic west of Delta"`)
4. Directional offsets (`"200 metres east of Golf"`)

## Related Notes
- [[Home]]
- [[Radio Net and Bilingual Procedure]]
- [[Base Building and Economy]]
- [[System Architecture]]
