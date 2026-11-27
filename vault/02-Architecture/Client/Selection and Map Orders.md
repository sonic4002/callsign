---
title: Selection and Map Orders
description: "A commander can select one squad and give orders by pressing things on the map."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/code
  - area/architecture
  - topic/client
  - topic/orders
  - topic/selection
created: 2026-11-26
updated: 2026-11-27
agent: CLD
origin: code
confidence: medium
related:
  - "[[Speech Recognition]]"
  - "[[Build Bar]]"
  - "[[Heroes]]"
  - "[[Direct Acts]]"
  - "[[Radio versus Direct Acts]]"
  - "[[Client]]"
  - "[[Map Rendering]]"
  - "[[Radio Console]]"
  - "[[Places on the Radio]]"
  - "[[Decision - Command Sidebar]]"
paths:
  - client/debug.js
  - client/map.js
  - client/places.js
  - client/placement.js
  - client/heroes.js
  - client/power.js
  - client/touch.js
  - client/i18n/en.json
---

# Selection and Map Orders

A commander can select one squad and give orders by pressing things on the map. The three plain orders (move, hold, attack) go straight to the game as a direct act; everything else the map offers is written as a radio call and transmitted at once.

## Selecting and letting go

| Action | Effect |
|---|---|
| Press a squad on the map | `select(sq)`: marks it (`scene.selected`), highlights its roster row, and writes the opening of a call to it in the radio box (`callPrefix`: "<squad>, this is <me>…") |
| Press a squad's name plate | Same; the plate's box (plus 5 px) is tested first in `Scene.pick`, so two squads standing together can each be picked by name |
| Press beside one of our squads | Within 26 px of a team it is that squad or enemy; within 46 px of one of **our** teams it still means the squad, not the ground |
| Press its row in the squads list | Selects; a second press on the selected row lets go |
| Escape (when no placing is under way and Help is closed) | `unselect()` |
| Right click on the map (`contextmenu`) | `unselect()` |
| The squad is destroyed | Selection clears in `setState` |

`unselect()` also removes the call opening from the box if the player has not typed on from it. The selected squad shows a breathing yellow ring under every team, a bobbing arrow above it, a yellow border on its name plate and a white blip on the mini map. Haulers cannot be selected: they take no radio calls.

Push-to-talk uses the selection too: a spoken order that opens with no known callsign is prefixed with the selected squad's call ([[Speech Recognition]]).

## What a press on the map means (`mapClick`)

`Scene.pick(sx, sy, side)` returns, in this order of preference: a squad (ours) or a contact (enemy in sight), a landmark or bridge, a structure, then a point and/or a gold field. A point's two name plates (`pointPlates`, its letter and callsign, and its place name) count as the point itself and are tested right after a squad or contact under the press: the names are drawn over the fog, so a point whose ground has never been seen can still be pressed (since 2026-11-27). Under a mouse the pointer becomes a hand over a name (`Scene.overName`).

| Pressed | No squad selected | A squad selected |
|---|---|---|
| Our squad | Select it | Select it; pressing the already selected squad, if it can dig in (`canDigIn`: land infantry, not a hero), offers **Dig in** (radio call `call.fortify`) |
| Enemy squad ("Target N") | Its name is added to the radio box | Menu: Attack (+ hero actions) |
| Enemy structure | Its name is added to the box | Menu: Attack; Capture first if the squad are engineers and the structure is capturable; hero may plant a charge |
| Tech building | Name to the box | As an enemy structure, with the "Tech" wording of the calls |
| Our own structure | The structure menu (below) | The structure menu, plus "send engineers to mend" when the squad are engineers |
| Gold field (no landmark or bridge there) | Drafts the haul call to Anvil (`call.haul`) in the box, not sent | Treated as the point the field is named after |
| Landmark | Name to the box; its name is shown for 3.5 s | Menu: Hold, Move, Cover |
| Bridge or point | Name to the box | Menu: Hold, Move, Attack (`ordersFor`) |
| Open ground | Nothing | **The squad is sent there at once**: a yellow ping marks the spot and `send(squad, "move", {place})` goes out |

A press while a structure is being placed moves or confirms the ghost instead, and while a rally point is being picked sets it ([[Build Bar]]). Hero-specific actions (`plant`, `seize`) are added by `heroOrders` ([[Heroes]]).

## How each becomes a frame

| Order | Sent as | Detail |
|---|---|---|
| Move / Hold / Attack from the menu, and tap-to-move on open ground | Direct act: `{type:"act", id, name:"order", args:{squad, order, place \| contact}}` | `BY_HAND = ["move","hold","attack"]`. The server applies it in the same tick and the squad answers "Wilco, out" by code, with no model call; the squad then counts as Hammer's own (commit 9e56316) |
| Cover, Capture, Dig in (fortify), Plant, Seize, Mend | Radio: `{type:"radio", text, strict}` through `order(text)` | The text is an i18n template `call.<kind>` filled with callsigns in the page language; it is kept in the sent-calls history so Up brings it back |
| Upgrade (roster button), give/take the fight, grant/revoke the purse | Radio call to Anvil | `call.upgrade`, `call.give`, `call.take`, `call.grant`, `call.revoke` |
| Rally, Cancel last, Repair, Sell on an own structure | Direct act: `name` = `rally`, `cancel`, `repair`, `sell` | See the structure menu |

Open-ground places are snapped to tens of metres from the nearest named point by `spotAt` and written the way the simulation reads them, `spotForm`: for example `N140 E60 of A`; a tap exactly on a point's grid position sends the point id alone. Named places send their id (`place.id`, a structure's id, a contact's id). The server's side of these acts: [[Direct Acts]]; the rule about what goes by radio: [[Radio versus Direct Acts]].

A refused act comes back as `{type:"acted", ok:false, error}`: the reason is written to the log (`refused`) and shown for 4 s on the card or button it came from.

## The orders menu (`#orders`)

One small menu serves every case. `offerOrders({title, facts, actions, gold, say})` shows only the buttons named in `actions`, places the menu at the press (kept inside the map), and remembers `say`. Pressing a button hides the menu and calls `say(action)`: a returned text is transmitted, `null` means the action did itself. A one-line reminder of what Hold, Move and Attack mean (`orders.about`) is shown only when all three are offered. Panning, zooming or pressing elsewhere hides the menu.

## The structure menu (`offerStructure`)

For one of the player's own standing structures, `structureActions` (in `power.js`) offers, in order:

| Button | When | What it does |
|---|---|---|
| Rally | Finished and it makes units | Starts picking a rally point for this structure's units; the next press on a point, tech building, landmark or bridge sends `act("rally", {place, structure})`; "Home" sends `place:"home"` |
| Cancel | It has a unit in its line | `act("cancel", {unit})` for the last unit in that line |
| Repair (shows `−cost`) | Finished, damaged, not already repairing | `act("repair", {place: st.id})` |
| Mend | Damaged and engineers are selected | Radio call `call.mend` to that squad (an order to a squad, so it is spoken) |
| Sell (shows `+value`) | Always | `act("sell", {place: st.id})` |

The menu's facts line gives health or build percentage, "repairing", "no power" and the rally place. The units the structure makes are not in the menu: pressing the structure narrows the Reinforcements tab of the build bar to them (`showMadeBy`, see [[Build Bar]]). When the side has two structures of a kind, calls name it with its id (`saidStructure`).

## Gestures (`client/touch.js`)

One pointer drags the map, two pinch-zoom about their midpoint, and a press that never left its slop (5 px mouse, 10 px finger) is a tap. The wheel zooms (or turns a fence being placed). Hovering with a mouse shows a landmark's or bridge's name.

## Related

- [[Client]]
- [[Map Rendering]]
- [[Build Bar]]
- [[Radio Console]]
- [[Direct Acts]]
- [[Radio versus Direct Acts]]
- [[Places on the Radio]]
- [[Decision - Command Sidebar]]
- [[Decision - Direct Build and Buy]]
