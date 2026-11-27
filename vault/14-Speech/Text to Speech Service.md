---
title: Text to Speech Service
description: "The squads' and Anvil's radio messages are spoken aloud by a local speech service (tts/server.py, BlueTTS on the CPU) whose clean recording the page passes through a radio effect."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/code
  - area/speech
  - topic/speech
  - topic/tts
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Pronunciation Table]]"
  - "[[Traffic Levels]]"
  - "[[Command Net and Squad Net]]"
  - "[[Stand By Behaviour]]"
  - "[[Speech]]"
  - "[[Radio Console]]"
  - "[[Sound, Music and Effects]]"
  - "[[Settings]]"
  - "[[Licences and Credits]]"
  - "[[Docker Compose Services]]"
paths:
  - tts/server.py
  - tts/models.json
  - tts/fetch.py
  - tts/Dockerfile
  - tts/NOTICE.md
  - client/speech/speech.js
  - client/speech/queue.js
  - client/speech/radio.js
  - client/speech/text.js
  - client/debug.js
  - server/cmd/callsign/main.go
  - docker-compose.yml
  - Makefile
---

# Text to Speech Service

The squads' and Anvil's radio messages are spoken aloud by a local speech service (`tts/server.py`, BlueTTS on the CPU) whose clean recording the page passes through a radio effect. When the service is not running the page falls back to the browser's own voice with only the radio clicks around it.

## The service (`tts/server.py`)

| Item | Value |
|---|---|
| Model | BlueTTS "BlueV3" on ONNX Runtime, CPU, no network at run time |
| Languages | `he`, `en` (one model for both) |
| Port | 5002 (`--port`); compose service `tts`, profile `voice` |
| Output | `audio/wav`, mono 16-bit, 22050 Hz (`RATE`; the radio effect cuts everything above about 3.1 kHz anyway) |
| Speed | `SPEED = 1.08` ("radio talk is clipped") |
| Longest text | 400 characters (`MAX_CHARS`) |
| Cache size | 300 MB (`CACHE_BYTES`), least recently used dropped by `trim()` at start |
| Cache key | first 32 hex of SHA-256 over `[VERSION, lang, voice, text]`; `VERSION = "3"` is bumped when the model, the table or the settings change |
| Concurrency | one line at a time (`Speaker.lock`) |

HTTP interface:

| Request | Answer |
|---|---|
| `GET /say?lang=he\|en&voice=<name>&text=<message>` | the line as WAV; 400 for an unknown language or voice, or text outside 1..400 characters |
| `GET /health` | `{"ok": true, "voices": [...], "languages": ["he","en"]}` |

Synthesis path in `Speaker.say`: prepare the text (numbers spelled out), turn it into phonemes, apply the [[Pronunciation Table]] (`fix`), synthesize with the chosen voice style, resample to 22050 Hz. At start the service speaks one line per language to load each reader.

The game server forwards `/tts/*` to it when started with `-tts` (compose passes `-tts=http://tts:5002`). `make play` adds the `voice` profile only when the image `callsign-tts` exists and `assets/models/bluev3/onnx/vocoder.onnx` is on disk. Cached lines live in `assets/voice-cache/` (git-ignored), mounted as `/cache`.

## Models and licences (from `tts/NOTICE.md`)

| What | Source | Licence |
|---|---|---|
| Speech model (text encoder, flow, duration predictor) | `notmax123/BlueV3-onnx` @ `8410bbfe` | MIT |
| Vocoder | same bundle; fine-tuned from the Supertonic-3 vocoder | BigScience OpenRAIL-M (use-based restrictions; "read it before a public release") |
| Voices (15 style files) | same bundle; computed from LibriTTS-R speakers | CC BY 4.0, attribution required |
| Hebrew reader (text to phonemes) | RenikudPlus, `notmax123/RenikudPlus` @ `679c56ca`, 8-bit weights, 312 MB | Apache-2.0 |
| English reader | polyg2p 0.1.0 | Apache-2.0; data from the CMU Pronouncing Dictionary |
| Inference code | `blue-onnx`, `renikud-plus` 0.5.0, `heb-tts-normalizer` 0.2.0, `hebrew-num2words` 0.1.0 | MIT / Apache-2.0 |

`make tts-image` builds one layer (about 0.6 GB) on top of the art image `callsign-art`; `make tts-models` downloads about 680 MB into `assets/models/bluev3`; `make tts-test` runs the table's tests with no models and no network. The notice warns that `blue-onnx` pulls in eSpeak NG (GPL-3.0) as an unused dependency that "must not be carried into anything that ships".

## Voices per station (`client/speech/text.js`)

Each faction has its own cast, so the two sides never sound alike. A station keeps its voice for the whole match and in every match.

| Faction | Operator voice | Squad voices (in order) | Playback rate |
|---|---|---|---|
| Aegis | `tamar` | `adam`, `daniel`, `maya`, `david`, `michael`, `noa` | 1 |
| Ashfall | `sara` | `jonathan`, `ethan`, `lily`, `ariel`, `shira`, `yael` | 1.05 |

A squad's voice is `squads[(classOffset + number - 1) % 6]` with `classOffset` infantry 0, vehicle 2, naval 4, air 5. If the service does not offer the chosen name, a stable hash of `faction:station` picks one from what it does offer.

## What is said (`speakable`)

- The player's own calls are never spoken back.
- Only letters, digits and plain punctuation survive; the abbreviation נ"מ is replaced by "נון מם" so it is said by its letters.
- In Hebrew a squad number after a class callsign is written as a word: "צפע 2" becomes "צפע שתיים".
- Text over 300 characters is cut at the last sentence that fits.
- Only messages the command net shows at the chosen radio traffic are spoken; the squad net is read, never heard (`client/debug.js`). See [[Traffic Levels]] and [[Command Net and Squad Net]].

## Order and dropping (`client/speech/queue.js`)

One voice plays at a time. The queue cuts a backlog short "instead of talking for a minute about a fight that has moved on".

| Rule | Value |
|---|---|
| Lines addressed to the player (or to all stations) are `direct` and are played before chatter between stations | |
| Longest wait before a chatter line is dropped | 9 s (`staleMs`) |
| Longest wait before a direct line is dropped | 25 s (`directStaleMs`) |
| Queue length | 3 (`max`); chatter is pushed out first; direct lines may pile up to 6 |
| Same station saying the same text again within | 6 s (`repeatMs`) is not taken |
| A station's "Stand by" (`filler`) is dropped once its real answer is queued behind it | see [[Stand By Behaviour]] |
| The newest line is never dropped for age | |

The recording is requested when the line is queued, so it is usually there when its turn comes; a line whose audio takes over 8 s (`WAIT_FOR_VOICE`) falls back to the browser voice.

## Radio effect (`client/speech/radio.js`)

Web Audio only, no recorded sound effects: drive, two high-pass filters at 380 Hz, a presence peak at 1900 Hz, a soft clipper, two low-pass filters at 3100 Hz and a compressor. Seeded noise gives a key-up burst (0.07 s), a faint hiss under the voice and a squelch tail (0.16 s).

## Behaviour around it

- **Fallback.** With no service (`/tts/health` fails) the page uses `speechSynthesis` with key-up and squelch clicks; Hebrew words the device misreads are sent with vowel points (`pointedWords`, for example סוף as סוֹף). If the device has voices but none for Hebrew, the Hebrew line is skipped. The page looks for the service again every 30 s.
- **Mute while talking.** `Speech.key(true)` is called when the talk button goes down: "a radio that transmits does not receive". The voice playing is cut and lost; what is waiting is heard after release. The music is muted for the same time.
- **Volume.** The page gives the voice `0.6 + 0.4 * music.volume` (`client/debug.js`), so it never drops below 60% however low the music slider is; the music and the battle sounds are ducked while a voice plays.
- **Connection lost.** `Speech.keep` pre-fetches the "connection lost" line in both languages so `declare("lost")` can say it with the server gone.
- **Match end.** The operator's final sign-off silences everything still waiting.
- Nothing plays before the player's first click or key press (browser audio rules).

## Related

- [[Speech]]
- [[Pronunciation Table]]
- [[Radio Console]]
- [[Sound, Music and Effects]]
- [[Settings]]
- [[Traffic Levels]]
- [[Licences and Credits]]
- [[Docker Compose Services]]
- [[Make Targets]]
