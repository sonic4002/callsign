# Phase 0 kickoff prompt

Paste this into Claude Code from inside the `callsign` folder.

---

Read CLAUDE.md and docs/PLAN.html. We're starting Phase 0: prove the core loop is fun before any art.

Build, in this order, and show me a plan before writing code:

1. `shared/rules.json`: two factions (Aegis, Ashfall) with 3 unit types each, oil rigs (HQ well, land rig, sea rig), gold costs, brain tiers 1–3.
2. Go game server in `server/`: one blank 2D map with points A, B, G, D, H, F, K, S, Z; authoritative tick loop at 10 ticks/s; rigs that pay gold; squads of fireteams with utility AI and nerve (steady / shaken / pinned); combat; WebSocket API.
3. Radio net: callsign routing in English and Hebrew, procedure words, message log.
4. A minimal agent loop (Node script for now, not the browser yet) for the operator and squad leaders, using the game tools `radio`, `move`, `hold`, `attack`, `report`, `buy`. Read the key from `CALLSIGN_ANTHROPIC_KEY` in a `.env` file (already in .gitignore). Tier 1 = a small fast model.
5. A bare debug web page: dots on a map, radio log, a text box to send orders as Hammer.
6. Headless tests that run a full match with two scripted players.

Done when I can type "Viper 2, this is Hammer. Hold Foxtrot. Over." and watch the squad move, hold, and answer "Hammer, this is Viper 2. Wilco. Out."
