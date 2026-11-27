---
title: Mobile Layout
description: "On a phone the same page and the same elements are rearranged by client/mobile.css: the map takes the screen, the treasury becomes a slim strip on top, and the radio log, squads, build panel and ..."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/code
  - area/client
  - topic/client
  - topic/mobile
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Page Layout]]"
  - "[[Radio Console]]"
  - "[[Build Bar]]"
  - "[[Map Rendering]]"
  - "[[Speech on Phones]]"
  - "[[Help and Tutorial Page]]"
  - "[[Service Worker and Install]]"
  - "[[Client]]"
paths:
  - client/mobile.css
  - client/mobile.js
  - client/touch.js
  - client/debug.js
  - client/debug.css
  - client/cues.js
  - client/tutorial.css
  - client/index.html
---

# Mobile Layout

On a phone the same page and the same elements are rearranged by `client/mobile.css`: the map takes the screen, the treasury becomes a slim strip on top, and the radio log, squads, build panel and header open as sheets from a bottom bar whose middle is the push-to-talk button. `client/mobile.js` holds the little behaviour this needs; nothing in it touches the match.

## When the phone layout applies

One media query, repeated in `mobile.css`, `mobile.js` (`PHONE`) and `debug.js` (`phoneLayout`):

```
(max-width: 700px), (max-height: 500px), (pointer: coarse) and (max-width: 1100px)
```

| Variant | Query | Difference |
|---|---|---|
| Phone upright | the query above | The arrangement below |
| Phone held sideways | `(max-height: 500px) and (orientation: landscape)` | The bar stands on the inline-end edge as a 76 px rail, sheets open beside it, the log strip shows two lines instead of four, the talk button sits at the foot of the rail |
| Large touch screen (unfolded phone, small tablet) | `(pointer: coarse) and (min-width: 701px) and (max-width: 1100px) and (min-height: 501px)` | Phone layout with a 96 px talk button on the physical right in both languages (commit 90f26df) |
| Touch, any of the above | `(pointer: coarse) and …` | The `+` and `−` zoom buttons are hidden: fingers pinch |
| Narrow (`max-width: 820px`) | — | The power line shrinks to a bolt and two numbers in the top strip |

Tablets wider than 1100 px and desktops keep the sidebar ([[Page Layout]]).

## Arrangement

| Region | Size variable | What it is |
|---|---|---|
| Top strip | `--strip: 46px` | `#treasury`: gold with income, clock, points, the two headquarters bars, power |
| Map | fills the rest | `#map-wrap`, fixed between the strip and the log |
| Log strip | `--tick: 96px` | The last few lines of the command net, always visible; a tap opens the radio sheet |
| Radio box | `--send: 54px` | `#send`; font 16 px so iOS does not zoom the page on focus |
| Bottom bar | `--tabs: 64px` | `nav#dock`: Radio, Squads, [talk button], Build, More |
| Talk button | 62 px round | `#ptt`, centred over the bar, above every sheet |

All offsets add the device's safe-area insets; the inline insets are swapped for Hebrew.

### Sheets

`show(name)` in `mobile.js` sets `data-sheet` on `<html>`; one sheet at a time, pressing its tab again closes it.

| Sheet | Shows |
|---|---|
| `radio` | The whole log with the two net tabs above it ([[Radio Console]]) |
| `squads` | The roster, the initiative line and the haulers |
| `build` | The build panel, which stays in the sidebar on a phone ([[Build Bar]]) |
| `more` | The header: Help, AI, language, Restart, Exit, settings gear, agent lamps |

A sheet steps aside by itself when the player touches the map, picks a squad row, presses a structure card or the rally button, or opens Help or Restart — in each case the next thing happens on the map. `?sheet=<name>` opens the page with one up (for screenshots).

### Which log lines the strip shows

`stripPick` (`client/cues.js`) marks four lines (`strip`) and two (`strip2`, used sideways) among the last ten: radio addressed to the player first, then other radio, then system lines; among equals the newest. CSS hides the rest and cuts each to one line.

## Behaviour (`client/mobile.js`, `client/touch.js`)

- **On-screen keyboard.** The keyboard covers the page without resizing it. `visualViewport` gives its height as `--kb`; with more than 80 px covered the page gets class `typing` and the radio box and log ride on top of the keyboard.
- **No accidental focus.** `draft()` in `debug.js` does not focus the radio box on a touch device, so picking a squad or a place does not open the keyboard over the map.
- **Gestures.** One finger pans, two pinch about their midpoint, a press that moved less than 10 px is a tap (`Gesture`). Safari's page pinch (`gesturestart`) and the long-press menu on the map and on the talk button are suppressed. Text selection is off except in inputs and log text.
- **Placing with a finger.** A tap moves the ghost and the panel's button confirms (a mouse click confirms directly); orders-menu buttons are at least 48 px high.
- **Cheaper drawing.** Canvas pixel ratio is capped at 2 on touch devices (`capRatio`), image smoothing drops to `"low"`, 8 ground tiles are kept instead of 16, and the baked ground is capped at 11 million pixels ([[Map Rendering]]).
- **Microphone.** Browsers give the microphone only on `https` or `localhost`; on any other address the talk button gets class `no-voice` and pressing it explains (`voice.insecure`). See [[Speech on Phones]].
- **Full-screen cards.** The start/lobby card anchors to the bottom with its buttons sticky; Help and the AI dialog fill the screen; every choice is at least 44 px.
- **The coach.** In the first lesson the coach card's height is published as `--coach` so the map can start below it on an upright phone, and steps are worded for fingers where `touch: true` ([[Help and Tutorial Page]]).
- **Installing.** The manifest is switched by page language and the service worker is registered here ([[Service Worker and Install]]).

## History

Phone layout, pinch zoom and the installable app arrived together on 2026-11-24 (commits b8f7e67, 2b0b9ce, bcd03ca); the lobby and AI dialog followed (e93d5c6), then large touch screens and the Exit button (90f26df), four log lines (51bea0c) and the power bolt in the strip (5aedaf6). A sturdier phone microphone came with tap-to-order on 2026-11-26 (c2d99ae).

## Not verified

Behaviour on real devices is not recorded in the repository beyond what the commit messages state; no automated test drives the phone layout itself (the gesture arithmetic and `stripPick` are unit-tested).

## Related

- [[Client]]
- [[Page Layout]]
- [[Radio Console]]
- [[Build Bar]]
- [[Service Worker and Install]]
- [[Speech on Phones]]
- [[Map Rendering]]
