# Callsign (אות קריאה)

Browser real-time strategy game where every squad is an AI agent, commanded by voice or text over a real military radio net, in Hebrew and English. Full design: `docs/PLAN.html` (read it before any big decision).

## Locked decisions
- **Game server:** Go. Authoritative simulation (10 ticks/s), WebSockets, radio routing. Owns all truth: gold, units, fog of war. Runs no AI.
- **Model relay:** Go, same repo. Agents never call AI directly. The relay looks up the squad's brain tier on the game server, picks the model, and calls the provider with the player's own key (OpenRouter or Claude/Gemini/OpenAI). Keys encrypted at rest, never returned to the browser.
- **Client:** TypeScript + Phaser 3, installable web app. Must work in Chrome, Safari and Edge on Mac, Windows and phones.
- **Agents:** operator (callsign Anvil) and squad leaders run as Web Workers in the player's browser. They act only through game tools: `radio`, `move`, `hold`, `attack`, `report`, `buy` (operator only).
- **Fireteams:** plain utility AI on the server, no LLM. One "nerve" value (steady / shaken / pinned) shown through behavior only. No fatigue.
- **Open league:** the game also exposes an MCP endpoint with the same tools; any agent can join with its own model. Separate ladder, no tiers.
- **Economy:** one resource, gold. Oil rigs on land and sea pump gold automatically; HQ well can't be captured. Superpowers unlock through the build tree plus gold, never by the clock.
- **Rules data:** unit stats, costs, build tree, tiers live in one shared JSON file (`shared/rules.json`) read by server and client.

## Language and radio
- Hebrew and English are first-class from the first commit. All strings in `client/i18n/he.json` and `en.json`; a missing key fails the build. UI mirrors for RTL; the map never mirrors.
- All radio talk follows real procedure: "<to>, this is <from>…", Over / Out (never "over and out"), Roger, Wilco, Say again, Stand by, Correction, Radio silence. Hebrew: עבור, סוף, רות, רות יבוצע, אמור שנית, המתן, תיקון, דממת אלחוט.
- Map points use only letters shared by NATO and the IDF alphabet (Foxtrot = פסל, Kilo = כרמל, Sierra = סמך…). Never use ר for a point. Callsigns: Hammer/פטיש (player), Anvil/סדן (operator), Viper/צפע, Rhino/קרנף, Hawk/בז, Shark/כריש.
- Radio routing is done by code (callsign match in both languages), never by an LLM.

## Art
- Top-down sprites, no text baked into images. Generated locally (ComfyUI, FLUX.2 klein / Z-Image Turbo) under `assets/`, reviewed before use.

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
