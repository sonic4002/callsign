---
title: Page Layout
description: "On a desktop the page is a stage (map, build bar, radio console) beside a sidebar of instruments (header, treasury, squads)."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/code
  - area/architecture
  - topic/client
  - topic/layout
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Mobile Layout]]"
  - "[[i18n Rules]]"
  - "[[Map Rendering]]"
  - "[[Radar and Fog of War]]"
  - "[[Build Bar]]"
  - "[[Radio Console]]"
  - "[[Agent Telemetry]]"
  - "[[Lobby Page]]"
  - "[[Help and Tutorial Page]]"
  - "[[Settings]]"
paths:
  - client/index.html
  - client/debug.js
  - client/debug.css
  - client/map.js
  - client/power.js
  - client/brains/monitor.js
---

# Page Layout

On a desktop the page is a stage (map, build bar, radio console) beside a sidebar of instruments (header, treasury, squads). This note names every region and the element that holds it; the phone arrangement of the same elements is in [[Mobile Layout]].

## Desktop arrangement

```
+--------------------------------------------+------------------+
| #map-wrap                                  | #sidebar         |
|   canvas#map  (never mirrors)              |  header: title,  |
|   #radar-box (mini map)  #zoom  compass    |   buttons, lamps |
|   #coach  #placer  #orders (floating)      |  #treasury       |
+--------------------------------------------+   gold, time,    |
| #build-panel.under-map (the build bar)     |   points, HQ     |
+--------------------------------------------+   bars, power    |
| #radio: net tabs, log, send box            |  squads roster,  |
|                                            |   haulers        |
+--------------------------------------------+------------------+
```

`main` is a flex row: `#stage` (a column) and `#sidebar`. In a Hebrew page the document is `dir="rtl"`, so the sidebar and the text mirror; the two canvases carry `dir="ltr"` and never do (see [[i18n Rules]]).

## Regions

| Region | Element | What it shows |
|---|---|---|
| Map | `canvas#map` in `#map-wrap` | The isometric battlefield; see [[Map Rendering]] |
| Mini map | `#radar-box` / `canvas#radar-map` | The whole map flat, with fog, points, gushers, units and the view's outline. A click centres the view. It sits on the map beside the zoom buttons (moved there from the sidebar, commit 81881ae). Without a standing, powered radar structure it is dark and `#radar-off` says why (`radarState`: none / rising / dark); see [[Radar and Fog of War]] |
| Zoom | `#zoom` | `+`, `−` and fit; the mouse wheel and pinch also zoom |
| Compass | drawn on the map canvas by `Scene.compass()` | N/E/S/W on the tilted map (צ / מז / ד / מע in Hebrew), top corner; north is red |
| Floating panels | `#coach`, `#placer`, `#orders` | The lesson's coach, the placing panel, and the one small orders menu |
| Build bar | `#build-panel` | Structures and Reinforcements tabs; on desktop `seatBuildPanel()` moves it under the map; see [[Build Bar]] |
| Radio console | `#radio` | Two net tabs, the log, the text box, talk and voice buttons; see [[Radio Console]] |
| Header | `#sidebar header` | Title; buttons Help, AI (`#brains-open`), language, Restart, Exit, settings gear; and the agents' lamps |
| Agent lamps | `#monitor-strip` | One lamp per AI agent of this side (operator and each squad leader); a press opens the AI dialog on its live tab. Moved from a sidebar panel to the header in commit 95b16cb; see [[Agent Telemetry]] |
| Treasury | `#treasury` | Gold and income per minute, time left (with `×pace` when not 1), points held `ours : theirs`, the two headquarters health bars, and the power line (`use / supply`, a bar, "low" warning) |
| Squads | `#roster` | One row per squad: callsign, unit, member pips, current order, brain tier with the upgrade button, earned rank; deploying squads as rows with a bar. Above it `#command`: who has the initiative and the two one-tap switches |
| Haulers | `#haulers` | Each hauler's state and load bar, with `count/haulerCap` |
| Phone dock | `nav#dock` | Hidden on desktop; see [[Mobile Layout]] |
| No-server notice | `#no-server` | Shown while the WebSocket is down |

## Dialogs and overlays

| Element | Kind | Opens from |
|---|---|---|
| `#overlay` | Full-screen card: start screen, lobby, waiting room, result screen | Shown whenever no match is being played; see [[Lobby Page]] |
| `#help` | Window with Guide and Examples tabs | Help button, `?help`; see [[Help and Tutorial Page]] |
| `dialog#settings` | Modal | Gear button; see [[Settings]] |
| `dialog#brains` | Modal with tabs "live" (agents monitor) and "key" (the player's AI key) | AI button or a lamp; see [[Claude Brain and Player Keys]] |

## Roster row details

- A click on a row selects the squad; a second click on the selected row lets go of it ([[Selection and Map Orders]]).
- The upgrade button (`▲ <cost>`) transmits a radio call to Anvil (`call.upgrade`); the row shows "requested" until the upgrade lands, Anvil answers Negative / Say again, the call is refused, or 25 s pass (`REQUEST_TIMEOUT`). A landed upgrade highlights the row for 6 s.
- `#command-switch` and `#command-purse` only transmit the calls `call.give` / `call.take` and `call.grant` / `call.revoke`; the server holds the mode and answers with a `command` frame. See [[Initiative - Orders, Fight and Purse]].
- A strike aircraft's row says where it is in its sortie (`client/aircraft.js`: rearming with a percentage, parked, returning, overflying); see [[Sorties]].
- A squad whose leader is thinking gets the class `thinking` (from telemetry).

## Rebuild rule

The sidebar lists are rebuilt only when a JSON key of what they show changes (`drawn.roster`, `drawn.build`, `drawn.structures`, `drawn.haulers`), so buttons stay clickable between the server's states; progress bars are moved in place on every state frame.

## Known leftovers

- `debug.js` still has code for folding sidebar sections (`[data-fold]`, kept under `callsign.fold.<name>`), but no element in `index.html` carries `data-fold` any more.
- The header comment of `debug.js` says "The radio is the only way to act"; since the direct build/buy change the page also sends `act` frames ([[Radio versus Direct Acts]]).

## Related

- [[Client]]
- [[Mobile Layout]]
- [[Map Rendering]]
- [[Build Bar]]
- [[Radio Console]]
- [[Settings]]
- [[Decision - Command Sidebar]]
