---
title: Plan versus Code
description: "The design plan (docs/PLAN.html, v0.6), the locked decisions in CLAUDE.md, the kickoff prompt and the friend-match guide each describe the game at one moment; the code has moved on."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/mixed
  - area/known-flaws-and-backlog
  - topic/flaws
  - topic/plan
  - topic/drift
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Decision - Client Stack]]"
  - "[[Decision - Agents and Tools]]"
  - "[[Agent Tools]]"
  - "[[Decision - Command Sidebar]]"
  - "[[Page Layout]]"
  - "[[Decision - Open League]]"
  - "[[Superpowers]]"
  - "[[Callsigns]]"
  - "[[Economy]]"
  - "[[Decision - Brains without a Player Key]]"
paths:
  - docs/PLAN.html
  - CLAUDE.md
  - KICKOFF.md
  - docs/FRIEND-MATCH.md
  - docs/specs/2026-11-24-bases-harvest-maps.md
  - shared/rules.json
  - server/room/act.go
  - agents/main.mjs
  - client/index.html
---

# Plan versus Code

The design plan (`docs/PLAN.html`, v0.6), the locked decisions in `CLAUDE.md`, the kickoff prompt and the friend-match guide each describe the game at one moment; the code has moved on. This note lists every difference found while writing the vault, so a reader of those documents knows what to trust.

## `CLAUDE.md` against the code

| `CLAUDE.md` says | The code |
|---|---|
| Client: TypeScript + Phaser 3 (also in the Layout block) | plain JavaScript modules on a canvas; no build step ([[Decision - Client Stack]]) |
| Agents run as Web Workers in the player's browser | a Node agent host on the server machine by default; the browser in some cases ([[Decision - Agents and Tools]]) |
| Tools: `radio`, `move`, `hold`, `attack`, `report`, `buy` | about twenty tools across roles ([[Agent Tools]]) |
| Orders to squads go only by radio | move, hold and attack on the map go by hand since 2026-11-26 ([[Decision - Command Sidebar]]) |
| The client has a build panel in the command sidebar | the build panel is a bar under the map; the mini map is on the map ([[Page Layout]]) |
| The open league exposes an MCP endpoint | not built ([[Decision - Open League]]) |
| Superpowers unlock through the build tree | no superpower exists ([[Superpowers]]) |
| Callsigns: Hammer, Anvil, Viper, Rhino, Hawk, Shark | also Ghost, Raven, Comet, Target, Hauler ([[Callsigns]]) |
| Layout: `agents/` is "agent runtime (Web Worker)"; `docs/` is "PLAN.html and notes" | `agents/` is also the Node host; `docs/` also has specs, research, the art style sheet and the friend-match guide |
| "Phase 0 first: no art, no voice, no accounts" | art and voice arrived on day two; there are still no accounts |

## `docs/PLAN.html` against the code

| Plan | Code |
|---|---|
| "You don't click units" | build and buy are pressed; squads are selected and sent by tapping |
| Rigs pump gold: HQ well +10, land rig +15, sea rig +30, damaged rig half | haulers harvest fields; HQ trickle 10, sea rig 30, land rig 0; no damaged-rig rule ([[Economy]]) |
| Every brain is a language model on the player's key | the rule brain is the default; Jev on the game's key ([[Decision - Brains without a Player Key]]) |
| Matches of 10 to 15 minutes; lengths 10, 15, 20 or until an HQ falls | defaults 15, 20 and 25 minutes by map; always a timer ([[Maps]]) |
| One map, nine points | three maps, fifteen letters ([[Maps]]) |
| Tango = טוב in the alphabet table | Tango = תמר, November = נשר ([[Map Point Letters]]) |
| Ashfall has no air | Ashfall has the drone swarm and the prop bomber ([[Factions]]) |
| Unit lists with recon drones, an interceptor dome, tunnels, traps, decoys, amphibious transport | not in the rules ([[Units - Aegis]], [[Units - Ashfall]]) |
| Fireteams read ammo, weather and personality | none of the three exists ([[Fireteams and Nerve]]) |
| Veterans keep a rank and memories across matches | ranks last one match ([[Ranks and Brain Tiers]]) |
| The operator is optional per room; radio language is a room option | every side has an operator; the net follows Hammer's language ([[Net Language]]) |
| One command net heard by the whole side; squad nets you tap to hear | a command net and a squad net as two log tabs, with traffic levels ([[Command Net and Squad Net]]) |
| "Stand by" said at once while the agent thinks | said only after a long wait ([[Stand By Behaviour]]) |
| Every squad reports in with a radio check at match start; radio silence and "Repeat" are mechanics | the server only detects procedure words; what a station does on hearing one is up to its brain (the rule brain answers a radio check with "five by five"); no radio-silence, correction or repeat mechanic was found in the server ([[Procedure Words]]) |
| Voice in: the Web Speech API first | Whisper on the server when offered, else recognisers in the browser; the Web Speech API is not wired in ([[Speech Recognition]]) |
| Voice out: pre-recorded phrases, Phonikud for vowels | a live local speech service with a pronunciation table ([[Text to Speech Service]]) |
| Art: strict top-down, FLUX.2 klein 9B, a style LoRA, generated sound effects | isometric, the 4B model, Blender-rendered units, synthesised sound effects ([[Decision - Isometric Art]], [[Sound, Music and Effects]]) |
| Data: Postgres and Redis | none; nothing persists |
| "Sign in", OpenRouter in one click, the expected AI cost shown | no accounts; a pasted key; no cost display |
| Client: "Phaser 3 or PixiJS, TypeScript" | neither |
| A slow AI call "never costs you" / "you pay for no AI" | the game pays for Jev decisions, within a daily ceiling ([[Fast Brain - Jev]]) |

## `KICKOFF.md` against the code

The kickoff prompt describes Phase 0 and is history: three unit types per faction, oil rigs, one blank map with nine points, a Node agent script and a "bare debug web page". Its test sentence still works in spirit: "Viper 2, this is Hammer. Hold Foxtrot. Over." answered by "Hammer, this is Viper 2. Wilco. Out."

## `docs/FRIEND-MATCH.md` against the code

| Document | Code |
|---|---|
| LAN section: the server "does not slow guessing down" | wrong join codes are throttled on any address: 40 a minute, then 429 ([[Seats, Tokens and Trust]]) |
| `POST /api/rooms` body: opponent, side, length, watch, bot | also takes speed, purse, map, starting gold, Anvil's level and the fast brain ([[HTTP API]]) |
| `/internal/tier` returns tier and operator | also returns whether the side is seated; tier 0 for the operator ([[HTTP API]]) |
| "Frames added": lobby, ready, leave | there are also `act`, `lang`, `lesson` and others ([[WebSocket Frames]]) |
| Match length picked in the lobby; "A friend on this network" | the lobby now also picks map, gold, speed, enemy level, purse and brains ([[Lobby Page]]) |

## The spec against the code

The bases spec (`docs/specs/2026-11-24-bases-harvest-maps.md`) was overtaken by its own three addenda the same day: free placement, power, selling and repairing structures were "out of scope" in the body and built by the addenda. Read the addenda as the later word.

## Related

- [[Known Flaws and Backlog]]
- [[Known Flaws]]
- [[Backlog]]
- [[Decisions]]
- [[Open Questions]]
- [[The Idea]]
