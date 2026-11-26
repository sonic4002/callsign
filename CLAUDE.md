# Callsign (אות קריאה)

Browser real-time strategy game where every squad is an AI agent, commanded by voice or text over a real military radio net, in Hebrew and English. Full design: `docs/PLAN.html` (read it before any big decision).

## Locked decisions
- **Game server:** Go. Authoritative simulation (10 ticks/s), WebSockets, radio routing. Owns all truth: gold, units, fog of war. Runs no AI.
- **Model relay:** Go, same repo. Agents never call AI directly. The relay looks up the squad's brain tier on the game server, picks the model, and calls the provider with the player's own key (OpenRouter or Claude/Gemini/OpenAI). Keys encrypted at rest, never returned to the browser.
- **Client:** TypeScript + Phaser 3, installable web app. Must work in Chrome, Safari and Edge on Mac, Windows and phones.
- **Command sidebar** (2026-11-24): the client has a build panel, radar, gold and squad roster. Orders to squads go by radio (see "Sending a squad by hand" for the one exception); the sidebar's other order buttons only compose radio calls.
- **Building and buying are the player's own act** (changed 2026-11-24 by the owner: "no need to wait for anvil to approve it, its a waste of time"): pressing a structure or a unit starts it at once on the server, with no agent in between. The net logs it, and Anvil is told so it can report when it is ready. Anvil can still build and buy when ordered by radio or when it holds the purse.
- **Brains without a player key** (owner, 2026-11-24): the default brain is a rule brain that needs no AI at all (fixed sentences in both languages, several skill levels), so anyone can play for free. Jev (TypeSafe's decision model) is the fast brain for order-taking and runs on the game's own key, held by the relay (`CALLSIGN_JEV_KEY`), never sent to a browser; this is the one exception to "the player's own key". Language models (Claude and the others) stay on the player's key and are for Anvil and higher tiers.
- **A public server holds none of the owner's keys** (owner, 2026-11-26: "Production must not hold any key of mine. Only users' keys if they want"): production runs the rule brain for free and language models only on each player's own key. A Claude key, Claude token or Jev key of the owner's is used only where `CALLSIGN_PRIVATE=1` marks the owner's own machine; anywhere else the agents host and the relay refuse it. So Jev on the game's key is for the owner's machine only until credits are sold.
- **Sending a squad by hand** (owner, 2026-11-26: "apply the task immediately and make the unit response with יבוצע סוף ... no need the whole radio recognition cycle"): selecting a squad and tapping the map gives it a move, hold or attack order at once on the server, and the squad answers "Wilco, out" by code with no model call. Every other order to a squad, and anything spoken or typed, is still a radio call that its leader reads.
- **Agents:** operator (callsign Anvil) and squad leaders run as Web Workers in the player's browser. They act only through game tools: `radio`, `move`, `hold`, `attack`, `report`, `buy` (operator only).
- **Fireteams:** plain utility AI on the server, no LLM. One "nerve" value (steady / shaken / pinned) shown through behavior only. No fatigue.
- **Open league:** the game also exposes an MCP endpoint with the same tools; any agent can join with its own model. Separate ladder, no tiers.
- **Economy** (changed 2026-11-24): one resource, gold. Haulers collect it from fields fed by gushers and unload at a refinery; the HQ keeps a small trickle and the sea rig stays a capturable source. Structures unlock units (the build tree). Superpowers unlock through the build tree plus gold, never by the clock. Spec: `docs/specs/2026-11-24-bases-harvest-maps.md`.
- **Rules data:** unit stats, costs, build tree, tiers live in one shared JSON file (`shared/rules.json`) read by server and client.

## Language and radio
- Hebrew and English are first-class from the first commit. All strings in `client/i18n/he.json` and `en.json`; a missing key fails the build. UI mirrors for RTL; the map never mirrors.
- All radio talk follows real procedure: "<to>, this is <from>…", Over / Out (never "over and out"), Roger, Wilco, Say again, Stand by, Correction, Radio silence. Hebrew: עבור, סוף, רות, רות יבוצע, אמור שנית, המתן, תיקון, דממת אלחוט.
- Map points use only letters shared by NATO and the IDF alphabet (Foxtrot = פסל, Kilo = כרמל, Sierra = סמך…). Never use ר for a point. Callsigns: Hammer/פטיש (player), Anvil/סדן (operator), Viper/צפע, Rhino/קרנף, Hawk/בז, Shark/כריש, Comet/שביט (strike aircraft).
- Radio routing is done by code (callsign match in both languages), never by an LLM.

## Art
- Isometric (3/4 view) sprites, changed from top-down on 2026-11-24; no text baked into images. Generated locally (ComfyUI, FLUX.2 klein 4B, Apache-2.0; the 9B model is non-commercial) under `assets/`, reviewed before use.

## How to work
- Build in the plan's phase order. Phase 0 first: no art, no voice, no accounts.
- Keep the server deterministic and covered by tests (`go test ./...`). Simulate whole matches headless in tests.
- Small commits, one feature each. Ask before changing a locked decision above.

## Layout
```
server/   Go game server (sim, rooms, radio net)
relay/    Go model relay
shared/   rules.json and protocol types
client/   TypeScript + Phaser web app
agents/   agent runtime (Web Worker) and prompts
assets/   generated art and audio
docs/     PLAN.html and notes
```
