---
title: Known Flaws
description: "Defects, limits and stale text known on 2026-11-27, grouped by area, each with where it is recorded."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/mixed
  - area/status-and-reference
  - topic/flaws
  - topic/limits
created: 2026-11-26
updated: 2026-11-27
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Seats, Tokens and Trust]]"
  - "[[Key Handling]]"
  - "[[Radio Net and Bilingual Procedure]]"
  - "[[Initiative - Orders, Fight and Purse]]"
  - "[[AI Brains and Model Relay]]"
  - "[[Fast Brain - Jev]]"
  - "[[Client]]"
  - "[[Voice Pipeline (STT and TTS)]]"
  - "[[Recognition Evaluation]]"
  - "[[Licences and Credits]]"
paths:
  - docs/FRIEND-MATCH.md
  - stt/eval/RESULTS.md
  - stt/NOTICE.md
  - tts/NOTICE.md
  - client/voice/NOTICE.md
  - assets/audio/CREDITS.md
  - docs/research/2026-11-24-jev-decision-model.md
  - server/room/act.go
  - server/room/traffic.go
  - server/room/command.go
  - server/room/build.go
  - server/room/hub.go
  - server/sim/haul.go
  - agents/telemetry.mjs
  - agents/prompts.mjs
  - client/debug.js
  - client/sw.js
  - client/nets.js
---

# Known Flaws

Defects, limits and stale text known on 2026-11-26, grouped by area, each with where it is recorded. "Read from code" means the item was seen while reading and was not confirmed by running anything.

## Security and trust

| Flaw or limit | Source |
|---|---|
| No encryption on a LAN: the game is plain HTTP; radio, seat tokens and a typed AI key can be read on the network; tokens travel in the `/ws` address | `docs/FRIEND-MATCH.md`, `server/room/ws.go` |
| The join code is not a password: whoever has it takes the free seat | `docs/FRIEND-MATCH.md` |
| Trusting mode: a server started without an agent key lets anyone join any side as an agent and leaves the internal routes open | `server/room/hub.go`, log line in `server/cmd/callsign/main.go` |
| A WebSocket to an unknown room is not counted by the guess throttle; only the two HTTP routes are (read from code) | `serveWS` versus `wrongCode` in `server/room/hub.go` |
| The guess throttle is one counter for the whole server, so one guesser can lock out everyone's typos for the minute (read from code) | `wrongCode` in `server/room/hub.go` |
| A player is a browser token: clearing site data loses the stored key; whether orphaned key files are ever pruned is not verified | `client/brains/seat.js`, `relay/player.go` |

See [[Seats, Tokens and Trust]], [[Key Handling]].

## Radio and orders

| Flaw or limit | Source |
|---|---|
| The Hebrew by-hand Wilco is misclassified: `directOrder` sends the body "יבוצע" tagged `ack`, but the `wilco` spellings are "רות, יבוצע" / "רות יבוצע", so it is not a bare acknowledgement and becomes kind `status` or `answer`; agents skip a line only when its kind is `ack`, so Hebrew may wake agents where English does not (read from code) | `server/room/act.go`, `server/room/traffic.go` |
| An agent-supplied `kind: "ack"` has no effect, though the tool's comment lists it as allowed (read from code) | `classify` in `server/room/traffic.go` |
| Hand-over phrases are matched by substring, with no negation: "do not run the fight" would still hand over the fight (read from code) | `heardHammer` in `server/room/command.go` |
| "Ordered" means any word from Hammer to Anvil or all stations in the last 90 seconds, whatever it meant; the comment calls this deliberately simple | `server/room/command.go` |
| `mayActAlone(side, what)` ignores `what`, so sell, repair and build follow the buy purse exactly; `haul` is not gated by the purse (read from code) | `server/room/build.go`, `server/room/tools.go` |
| Hebrew has no number words for 11 and 12; squads above 12 can be addressed only by digits | `numberWords` in `server/radio/radio.go` |
| The nets are a display label: at Full traffic the squad net's lines also appear on, and are spoken with, the command net, although the help text says the squad net is "never spoken aloud" (read from code) | `onCommandNet` in `client/nets.js` |
| The server corrects no misspelt callsign; tidying is done by the page, and only at the relaxed level | `tidy` in `client/debug.js` |
| No rule protects bridges from agents: two server-side rules were committed and reverted the same evening | commits `8e72697`, `dc4e4a8`, `fb7788d`, `a7521f8` |

See [[Radio Net and Bilingual Procedure]], [[Initiative - Orders, Fight and Purse]].

## Brains and agents

| Flaw or limit | Source |
|---|---|
| The fast brain's threshold (0.67) is the vendor's example, tuned on a home-made order set written by the grammar's author; damaged orders are imitations, not recordings | `docs/research/2026-11-24-jev-decision-model.md` |
| Jev alone acted wrongly at every threshold tried (5 of 150 at 0.67); it is safe only behind the grammar | the same |
| The vendor publishes no rate limits, language list or uptime commitment; all players share one organisation's limit | the same |
| A two-step order to a squad ("move to Foxtrot, then attack Delta") is not understood by the leader grammar; the operator does split on "then" | `agents/rule-grammar.mjs` |
| Likely display bug: `plain()` reads `input.point` for attack while the tool's field is `place`, so an attack on a place shows as bare "attack" in the AI view (read from code) | `agents/telemetry.mjs` |
| The context-window table covers only three Claude models; other providers show "window unknown" | `agents/telemetry.mjs` |
| The subscription brain starts a process per thought with a 60 second kill; a test rig only | `agents/brain-subscription.mjs` |
| The scripted enemy does not buy or plan strike aircraft | commit `315ee23` |

See [[AI Brains and Model Relay]], [[Fast Brain - Jev]].

## Client

| Flaw or limit | Source |
|---|---|
| Self-repair and `?nosw` delete all caches, including the speech-model caches that the service worker's activation deliberately keeps (read from code) | inline script in `client/index.html`, `client/mobile.js`, `client/sw.js` |
| The cache version in `client/sw.js` is bumped by hand | `client/sw.js` |
| Placement rules exist twice (page and server), held together only by a shared test table | `client/placement.js`, `server/sim/placement.go`, `client/testdata/placement-small.json` |
| Enemy gunfire and defence fire on the map are inferred by the page from ranges, not reported by the server, so tracers can differ from what the simulation did | `gunfire`, `defenceFire` in `client/map.js` |
| "Show nerve (debug)" is offered to players and not remembered | `client/index.html` |
| Dead code: sidebar folding with no matching element; `structureRows` and some CSS look like leftovers (checked by grep only) | `client/debug.js`, `client/bases.js` |
| The phone breakpoint is repeated by hand in three files | `client/mobile.css`, `client/mobile.js`, `client/debug.js` |
| One music track's loudness figure is far from the others (`battle-urgent.mp3`, -43.1) | `assets/audio/manifest.json` |
| No automated test drives the page or the phone layout in a browser; client tests cover pure modules only | `client/*.test.mjs` |
| The lobby's four map cards (one row on a desktop, two rows of two on a phone) and the huge map on the page were not looked at in a browser when the map was added (2026-11-27) | `client/debug.css`, `client/mobile.css` |
| One grove of the small map has no mirror image (`K-grove-2`, west of Kilo): its twin fell on the edge of a hill in the generator and was left out; a test names it as the one exception | `tools/mapgen.py`, `TestEverythingOnEveryMapIsMirrored` in `server/sim/terrain_test.go` |

See [[Client]].

## Speech

| Flaw or limit | Source |
|---|---|
| Rough tidying still takes ordinary English words for a point with the same consonants on every map: "quarry" and "carry" become Kilo (X-ray on the huge map), "shore" becomes Sierra (Charlie on the huge map), although Quarry is itself a point's name on two maps (measured 2026-11-27) | `placeNames` in `client/voice/normalize.js`, [[Map Point Letters]] |
| The six point names of the huge map were never spoken to a recogniser or heard from the speech service: their hints, tidy rules and pinned readings are checked by tests on text only | `client/voice/voice.test.mjs`, `tts/pronounce.json` |
| Every recognition score is from synthetic voices; no recording of a real player exists; the phrase bonus and the tidy step are tuned on them | `stt/eval/RESULTS.md` |
| Phone performance was imitated by slowing a desktop; no phone was measured, and the live path never ran on an iPhone | the same |
| The speech service mispronounces Hebrew "נועו" and sometimes swallows "רות"; 17 of the 19 lost Hebrew orders are those two words | the same |
| A hint side effect: a noisy "Buy one vehicle squad" came back as "Viper 1, vehicle squad" | the same |
| Server Whisper is unusable without a GPU (about 4.5 seconds of four cores per call) | `stt/NOTICE.md`, `stt/eval/RESULTS.md` |
| Voice needs https or `localhost`: a LAN friend over http can type but not talk | `client/voice/voice.js`, `docs/FRIEND-MATCH.md` |
| Safari does not report the connection type, so an iPhone on mobile data still pre-fetches the roughly 70 MB model; Safari clears site storage after 7 days unless the game is on the Home Screen | `stt/eval/RESULTS.md` |
| The browser-voice fallback skips Hebrew lines on a device with voices but no Hebrew voice | `client/speech/speech.js` |
| The voice level still follows the music slider in part (`0.6 + 0.4 x music volume`), despite the subject of commit `c58c2d3` (read from code) | `client/debug.js` |

See [[Voice Pipeline (STT and TTS)]], [[Recognition Evaluation]].

## Licences before a public release

| Flaw or limit | Source |
|---|---|
| Two CC-BY menu tracks must not ship in a public build until there is a credits screen | `assets/audio/CREDITS.md` |
| The CC BY 4.0 credit for the Hebrew browser recogniser is not shown in the game | `client/voice/NOTICE.md`, `stt/eval/RESULTS.md` |
| The speech service's vocoder licence is to be read before a public release; a GPL dependency in its image is unused and must not ship | `tts/NOTICE.md` |
| The listening image contains proprietary GPU libraries; read the agreement before publishing the image | `stt/NOTICE.md` |

See [[Licences and Credits]].

## Simulation, balance and art

| Flaw or limit | Source |
|---|---|
| Only scripted balance is measured; the ordinary suite plays 4 seeds a map at an 80% limit | `server/sim/terrain_test.go` |
| Moving the hauler's unload spot "moves the scripted balance a great deal" | `unloadSpot` in `server/sim/haul.go` |
| The comment on `buyHauler` says a hauler needs a refinery; the rules say the works | `server/sim/haul.go`, `shared/rules.json` |
| The comment on `Structure.Base` says "one of each role per side"; `build` allows a second of a role | `shared/structures.go`, `server/sim/structures.go` |
| A unit-level `body` override exists in the rules schema and no unit uses it | `shared/rules.go` |
| Nothing persists; a slow client is dropped at a 512-frame queue, not throttled | `server/room/hub.go`, `server/room/room.go` |
| `assets/raw` is not in git, so kept sprites cannot be rebuilt on another machine without generating again | `art/cleanup.py`, `.gitignore` |
| The style sheet and the unit renderer use a 30 degree camera; the prompt templates say "about 35 degrees" | `docs/art/STYLE.md`, `art/units.py`, `art/sprites.json` |
| The sprite credits name the hero sheets with a faction prefix the files do not have | `assets/sprites/CREDITS.md` |

## Stale text in the code

- `client/debug.js` lines 1 to 3: "The radio is the only way to act"; the structure buttons "only write a radio call"; `client/power.js`: "Each is a radio call". All predate direct acts.
- Role comments in `server/room/room.go` ("hammer: radio only", "anvil: radio, report, buy") predate the longer tool lists.
- `agents/main.mjs` (`Director.brainFor`): "a player's own key will come in through here"; it comes through the browser host.
- `agents/brain-claude.mjs` describes itself as the Phase 0 arrangement to be replaced by the relay; both exist.
- A sentence about fences appears twice in `operatorPrompt` (`agents/prompts.mjs`); a line is repeated in `client/i18n.test.mjs`.
- A comment in the hub says the join code has "about 33 million values"; 31 to the fifth power is 28.6 million.
- The main script and stylesheet are still named `debug.js` and `debug.css`.

## Related

- [[Roadmap and Status]]
- [[Backlog]]
- [[Plan versus Code]]
- [[Open Questions]]
- [[Tests and Headless Matches]]
