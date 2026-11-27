---
title: Sound, Music and Effects
description: "Battle sounds are synthesised in the browser with Web Audio, battle effects are particles drawn in code, and only the music is recorded audio."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/code
  - area/client
  - topic/client
  - topic/audio
  - topic/effects
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Settings]]"
  - "[[Licences and Credits]]"
  - "[[Text to Speech Service]]"
  - "[[Match Rules and Winning]]"
  - "[[Client]]"
  - "[[Map Rendering]]"
  - "[[Art and Assets]]"
paths:
  - client/sfx.js
  - client/music.js
  - client/fx.js
  - client/finale.js
  - client/map.js
  - client/debug.js
  - assets/audio/manifest.json
  - client/fx.test.mjs
  - client/finale.test.mjs
---

# Sound, Music and Effects

Battle sounds are synthesised in the browser with Web Audio, battle effects are particles drawn in code, and only the music is recorded audio. All of it is a picture of what the server reported: none of it changes the match.

## Battle sounds (`client/sfx.js`)

Nothing is recorded or downloaded: every sound is made from noise bursts, low thumps and short sweeps. The chain is: each sound → its own level, low-pass and pan → bus → limiter → master → out.

| Kind | Priority | Used for |
|---|---|---|
| `rifleA`, `rifleB`, `mg` | 1 | Small arms (commandos, militia, speedboat, gun nest) |
| `hmg`, `autocannon` | 2 | Technical, sentry gun; patrol boat, helicopter, flak battery |
| `cannon` | 3 | Tank, rocket launcher, rocket team, rocket nest |
| `boomS`, `boomM`, `boomL` | 3, 4, 5 | Shell bursts and hits; wrecks and bombs; the headquarters' fall |
| `splash` | 2 | A shell or bomb on water, a boat going under |
| `coins`, `built`, `door` | 1 | A hauler unloading, a structure finished, a unit leaving its structure |
| `gush`, `hammer` | 0 | A gusher in sight (every 2.6–3.5 s), a building site |

- **Weapons table.** `weapons` maps each unit and defence id to a sound, rounds per burst, gap, what the round does where it lands (`dust`, `pop`, `shell`), travel time, and for rockets an arc. Unknown units fall back by class.
- **Placement.** `hearing(view, sx, sy, zoom)` turns a screen position into pan, gain and a low-pass cutoff: a fight away from the middle of the view is quieter, duller and off to its side; beyond about three half-screens it is silent; zoomed far out everything is further away.
- **Voices.** At most 10 sounds play at once (`Voices`); when full, a louder kind pushes out a quieter one, so a big fight is a texture and not a wall. Each kind has a least gap between two starts.
- **Level.** Follows the music slider and mute (`level: () => music.muted ? 0 : music.volume`), and is ducked to 40 % while a radio voice speaks.
- Browsers allow audio only after the first click or key press; `unlock()` runs on it.

## Music (`client/music.js`)

Reads `/assets/audio/manifest.json`; with no manifest or no tracks the page is simply silent and the music controls are hidden.

| Mode | When | Tracks in the manifest | Order |
|---|---|---|---|
| `menu` | Start screen, lobby, result screen | 2 (CC-BY 4.0) | Walked in order, so the two alternate |
| `battle` | A match being played, and during the finale | 3 (CC0 1.0) | Shuffled |

- Two decks cross-fade over `FADE = 1.4` s. Each track is levelled from its measured loudness (`lufs`) toward `TARGET_LUFS = −15`, never boosted past its peak, then scaled by `BALANCE` (menu 1, battle 0.42: "the battle sits under the radio").
- The music ducks to 30 % while a radio voice speaks, and is muted while the talk button is held (it would be heard as speech).
- Volume and mute are kept in `callsign.volume` and `callsign.muted` ([[Settings]]). Track titles, artists and licences are listed under Credits on the start screen, as the licences ask ([[Licences and Credits]]).

## Spoken radio

The voice for radio lines is a separate system (`client/speech/`): see [[Text to Speech Service]]. The hooks on this side are `speech.say(message)` for each heard line, `speech.silence()` at match end, traffic change and exit, and the ducking callback above.

## Effects (`client/fx.js`)

Particles are drawn from a few soft blob textures made in code. Positions are world coordinates plus a height above the ground, so effects keep their proportion to the sprites at every zoom.

| Limit | Value |
|---|---|
| Particles | 640 |
| Decals (scorch marks, 24 s) | 40 |
| Emitters | 10 |

The pools are bounded: when full, a new item only gets in by replacing the oldest item of lower priority. "A big fight gets thinner smoke, never a slower frame."

| Effect | Shown when |
|---|---|
| `dust` | Small-arms impacts, a soldier down, building sites |
| `pop` | Autocannon/HMG impacts, a drone shot down |
| `shell` | A shell burst; `spray` on water |
| `blast` | A bomb, the pieces of larger explosions; leaves a scorch mark and shakes the view |
| `wreck` / `sinking` | A vehicle destroyed (burning wreck, smoke column) / a boat going under |
| `strike` | A headquarters taking a hit (at most every 650 ms) |
| `coins` | Gold raining into the refinery when a hauler unloads |
| `smolder` | A headquarters at or below 66 % health smokes, at or below 33 % burns, and burns low as a ruin |
| `collapse` | The headquarters' fall (below) |

Other things drawn by `map.js` itself: tracers with a muzzle flash, rockets that climb, trail smoke and fall, bombs falling from strike aircraft (one after another, like a stick), casualties left on the ground (flattened when armour ran them down), dust and sparks on building sites, a door opening behind a unit that just came out, and a yellow ping where a squad was sent.

**Reduced motion.** With `prefers-reduced-motion`, the view does not shake, the finale cuts instead of gliding, and the pulsing CSS animations stop.

## The fall of a headquarters (`client/finale.js`)

When a match ends with `reason: "hq_destroyed"`, the page plays a sequence before the result screen (commit 7444c92). `finale.js` holds only the timing; `map.js` plays it.

| Moment (ms after the end) | Normal | Reduced motion |
|---|---|---|
| View glides to the building (ease in-out), zoomed in | 0–950 | cut at 0 |
| `blast`: `fx.collapse`, sounds `boomL` then `boomM` | 1100 | 150 |
| `ruin`: the building is swapped for its ruin behind the fireball | 1340 | 390 |
| `aftershock` ×3: `boomM` | 2000, 2800, 3600 | 1050, 1850, 2650 |
| `overlay`: the result card fades in | 5600 | 3200 |

A page that joins after the match has ended sees no finale, only the ruin. A match that ran out of time has no fallen headquarters and no finale. The operator's sign-off and the result reasons are in [[Match Rules and Winning]].

## Related

- [[Client]]
- [[Map Rendering]]
- [[Settings]]
- [[Text to Speech Service]]
- [[Licences and Credits]]
- [[Art and Assets]]
