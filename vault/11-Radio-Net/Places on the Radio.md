---
title: Places on the Radio
description: "An order names a place in words: a letter point, a landmark ('the grove north of Foxtrot'), a bridge, a structure, a bearing from a point, an exact spot, or an enemy squad ('Target 3')."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/code
  - area/radio-net
  - topic/radio
  - topic/places
  - topic/landmarks
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Command Grammar]]"
  - "[[Net Language]]"
  - "[[Radio Net]]"
  - "[[Map Point Letters]]"
  - "[[Radio Routing]]"
  - "[[Radio versus Direct Acts]]"
  - "[[Terrain, Cover and Bridges]]"
  - "[[Tech Buildings]]"
  - "[[Placement and Production Queues]]"
  - "[[Selection and Map Orders]]"
paths:
  - server/radio/places.go
  - server/radio/places_test.go
  - server/radio/radio.go
  - server/room/build.go
  - server/room/tools.go
  - server/sim/place.go
  - shared/rules.json
  - client/places.js
  - client/map.js
  - agents/rule-phrases.mjs
---

# Places on the Radio

An order names a place in words: a letter point, a landmark ("the grove north of Foxtrot"), a bridge, a structure, a bearing from a point, an exact spot, or an enemy squad ("Target 3"). Code turns the words into one written form the simulation reads; when the words fit more than one landmark the squad is told to ask which.

## The kinds of place

| Kind | Said as | Written form (what the sim reads) |
|---|---|---|
| Map point | "Foxtrot", "פסל", "the town", "העיירה" | The point id: `F` |
| Landmark | Its own name, or a kind word beside a point | The landmark id: `T-ruin-1` |
| Bridge | "the west bridge" / "הגשר המערבי" | The bridge id: `bridge-west` |
| Structure | By id (`s7`), name, kind or role; "enemy …" / "אויב" for theirs | The structure id |
| Tech building | By its name on the map ("the clinic east of Delta") | The structure id |
| Bearing from a point | "north of Foxtrot", "NE of D 150" | `<bearing> of <point> [<metres>]`: `N of F`, `NE of D 150` |
| Exact spot | "140 metres north and 60 east of Alpha" / "צפונית 140 ומזרחית 60" | `N140 E60 of A` |
| Side of one's own base | north/south/east/west/front/rear | `base:<side>` (for building, not for squad orders) |
| Enemy squad | "Target 3" / "מטרה 3" | The `contact` argument, not a place |

"North of Foxtrot" with no distance means `DefaultOffset` = 120 map units (`server/sim/place.go`). `hold` with the place "here" means where the squad stands.

## Landmarks and bridges by name

Each landmark in `maps.<id>.landmarks` has an id, a kind, the nearest point (`near`), a `bearing` from it and a name in both languages, for example `T-ruin-1`: "the ruin north of Tango" / "החורבה מצפון לתמר". Bridges have a name each; the net works out the nearest point and bearing of a bridge from its middle (`initPlaces`).

`Net.FindLandmarks` finds them in a message two ways:

1. **By their own name** in either language (English also without the leading "the").
2. **By a kind word beside a point's name**: the message names a point and uses a word for a kind of thing. If the message also gives a compass direction, only the things at that bearing from the point fit; otherwise all of that kind near that point fit.

Kind words (`kindWords`):

| Kind | English | Hebrew |
|---|---|---|
| house | house, building | בית, בניין |
| bunker | bunker | בונקר |
| ruin | ruin, ruins | חורבה, חורבות |
| grove | grove, trees, tree, wood, woods | חורשה, עצים, עץ |
| rocks | rocks, rock, boulders | סלעים, סלע |
| wall | wall | חומה, קיר |
| bridge | bridge | גשר |

Compass words (`bearingWords`): north/south/east/west, northeast/northwest/southeast/southwest, and Hebrew צפון, צפונית, צפונה, דרום, דרומית, דרומה, מזרח, מזרחית, מזרחה, מערב, מערבית, מערבה. Two in a row ("north east", "צפון-מזרח") make the direction between them. Hebrew words are matched with up to two glued prefix letters removed ("בחורשה" → "חורשה", "שליד" → "ליד").

The ids found travel with every radio message as `landmarks` (commit `cd41fff`: "landmark tagging on the net").

## "Which one?"

`Net.ResolvePlace` returns one place, or — when the words fit several landmarks — the choices. The room turns that into `ErrWhichPlace`: `which one: "<text>" could be <name> (<id>) or <name> (<id>)`, so the squad's leader can ask on the net which was meant. A place the map does not know at all is `sim.ErrBadPlace` / `ErrNoPoint`.

## Order of resolution (`Room.place`)

For a `place` argument from an agent or a direct act:

1. The simulation's own resolver, for exact ids and written forms (`Sim.ResolveFor`).
2. A structure named in words: own by default, the enemy's when the order is an attack or plant, or the text says "enemy" / "אויב". Of several, the nearest to the squad; lowest id breaks a tie. A tech building's map name wins whoever holds it.
3. Something built that the words name (`builtPlace`; not read in detail — not verified).
4. The map's names: `Net.ResolvePlace` (point id, landmark or bridge id, the offset form, landmarks by words, then a single point with an exact spot, a bearing, or alone).
5. A side of one's own base (`sideWords`): north / צפון, צפוני; south / דרום, דרומי; east / מזרח, מזרחי; west / מערב, מערבי; front, forward / חזית, קדמי, קדימה; rear, back, behind / עורף, אחורי, מאחור.

Squad orders refuse a `base:` place.

## Exact spots

`spotIn` reads an exact spot from the words around a single point's name: exactly two numbers and two compass words, one north/south and one east/west, each number beside its direction, in either order ("140 metres north and 60 east", "north 140, east 60"). It writes `N140 E60` (north/south first). One direction, or two directions with one distance ("140 metres north-east"), stays a bearing. Exact spots exist so that a structure can be placed precisely over the radio (commits `b7e2ea0`, `99f2166`); `Place.Exact` makes what is built stand just there.

The page writes the offset form itself when the player picks a spot on the map; `parseOffset` in `client/places.js` reads `"NE of D 150"` back.

## Target N: naming the enemy

An enemy squad in sight has a contact id, and is called `callsigns.contact` plus that id: "Target 3" / "מטרה 3" (commit `4363fac`).

- The map draws the name under each enemy squad in sight (`contactName` in `client/map.js`), so the player can say "Viper 1 attack Target 3".
- Agents are told the same name in their prompts and status, and name contacts that way on the radio (`targetName` in `agents/rule-phrases.mjs`).
- The server does not parse "Target N" out of radio text; the receiving brain reads it and calls `attack` with `contact: N` (see [[Command Grammar]]). `Net.Localize` does swap Target / מטרה to the net's language.

## How the net says a place back

- A point is said by its callsign in the net's language: דוד, not Delta (see [[Net Language]]).
- A landmark or bridge by `Net.PlaceName(id, lang)`; the rule brain glues Hebrew prepositions onto it (`heGlue`: ב + "הגשר המערבי" → "בגשר המערבי").
- Tech buildings are called by their names on the map (commit `417aa20`).

## On the map

Tapping a thing offers orders by kind (`ordersFor` in `client/places.js`): a landmark offers hold, move, cover; a point or a bridge offers hold, move, attack.

## Related

- [[Radio Net]]
- [[Map Point Letters]]
- [[Radio Routing]]
- [[Net Language]]
- [[Radio versus Direct Acts]]
- [[Terrain, Cover and Bridges]]
- [[Tech Buildings]]
- [[Placement and Production Queues]]
- [[Command Grammar]]
- [[Selection and Map Orders]]
