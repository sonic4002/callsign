---
title: Voice Pipeline (STT and TTS)
description: "Callsign supports push-to-talk voice commands and spoken radio replies in both Hebrew and English, designed to work both on-device in the browser (zero server GPU required) and accelerated on a ..."
type: overview
status: current
tags:
  - type/overview
  - status/current
  - agent/AGY
  - origin/code
  - area/architecture
  - topic/architecture
  - topic/voice
  - topic/stt
  - topic/tts
created: 2026-11-26
updated: 2026-11-27
agent: AGY
origin: code
confidence: medium
related:
  - "[[Home]]"
  - "[[Radio Net and Bilingual Procedure]]"
  - "[[System Architecture]]"
  - "[[Running, Deploying and Testing]]"
paths:
  - client/voice
  - client/voice/hints.js
  - client/voice/normalize.js
  - stt/server.py
  - stt/eval/RESULTS.md
  - tts/server.py
  - tts/pronounce.json
  - assets/voice-cache
  - client/speech/speech.js
  - client/voice/voice.js
  - server/room/listen.go
  - server/cmd/callsign/main.go
  - Makefile
---

# Voice Pipeline (STT and TTS)

Callsign supports push-to-talk voice commands and spoken radio replies in both **Hebrew** and **English**, designed to work both **on-device in the browser** (zero server GPU required) and accelerated on a **local GPU** when hosted privately.

## Speech-to-Text (Voice In)

### In-Browser On-Device Models (`client/voice/`)
Runs inside a Web Worker on `onnxruntime-web` (14 MB, MIT) with COOP/COEP cross-origin isolation enabling up to 4 WASM threads. Models are cached in `callsign-voice-*` Cache Storage (preserved across service-worker updates).

| Language | Model | Size | License | Order Accuracy | Latency (Live / Whole) |
|---|---|---|---|---|---|
| **Hebrew** | `ivrit-ai/zipformer2-66m-streaming-he` (8-bit ONNX) | 72 MB | CC BY 4.0 | **90.1%** (callsigns `99.5%`, points `100%`) | `0.12s` desktop · `0.22–0.34s` phone-sim (streamed live via AudioWorklet) |
| **English** | **Moonshine base** | 67 MB | MIT | **91.1%** (callsigns `97.4%`, points `98%`) | `0.11s` desktop · `0.54–0.78s` phone-sim |

- **Net-Name Boosting (`client/voice/hints.js`, `transducer.js`)**: Active callsigns, current map points, and procedure words earn a `1.5`/letter beam-search bonus during decoding, raising Hebrew callsign accuracy from ~50% to `99.5%`.
- **Post-Processing (`client/voice/normalize.js`)**: Tidies spoken digits, callsign homophones, and procedure phrasing without altering already-valid calls.

### Optional GPU Listening Service (`stt/server.py`, `callsign-stt`)
Auto-enabled by `make play` when the `callsign-stt` Docker image, Whisper weights (`whisper-he` ivrit.ai large-v3-turbo + stock `whisper-en` large-v3-turbo, int8_float16, 2.3 GB VRAM), and an NVIDIA GPU are present:
- **RTX 5070 Ti Latency**: `~0.09–0.12s` per call (`~8` calls/s).
- **Accuracy** (`stt/eval/RESULTS.md`, 384 synthetic calls): Hebrew `98.6%` words (`100%` callsigns/points, `91%` exact); English `98.7%` words (`100%` callsigns, `92%` exact).
- **Silence Guard**: VAD + level check eliminates Whisper hallucinations on hiss/hum/clicks (`make stt-quiet`).

## Text-to-Speech (Radio Voices Out — `tts/server.py`)
- Uses `callsign-tts` (BlueV3 ONNX voices + pronunciation dictionary `tts/pronounce.json`) with disk caching in `assets/voice-cache/`.
- Falls back automatically to browser speech synthesis when `callsign-tts` is not running.
- Anvil cues and squad acknowledgements are rate-limited and queued behind direct replies to Hammer.

## Related Notes
- [[Home]]
- [[Radio Net and Bilingual Procedure]]
- [[System Architecture]]
- [[Running, Deploying and Testing]]

---

## In detail

Callsign is played over a radio net, so the game both speaks (squads and Anvil are heard) and listens (the player holds a talk button and speaks an order). Both directions are optional layers over the text net: every call exists as text first, and the game is fully playable by typing.

### The two directions

| Direction | What it does | Where it runs | Notes |
|---|---|---|---|
| Speaking (text to speech) | Reads the radio messages of the player's own stations aloud, through a radio effect | An optional Python service (`tts/`) behind the game server at `/tts/`; fallback is the browser's own voice | [[Text to Speech Service]], [[Pronunciation Table]] |
| Listening (speech recognition) | Turns a held-button recording into the text of a radio call | An optional GPU service (`stt/`) behind `/stt/transcribe`, else models in the player's browser (`client/voice/`) | [[Speech Recognition]], [[Server Whisper]], [[In-Browser Recognition]] |

Between the recogniser and the net sits a repair step that puts the net's own spelling on callsigns and map points: [[Hints and Tidy Step]]. How well all of it works was measured: [[Recognition Evaluation]]. What differs on a phone: [[Speech on Phones]].

### Code map

| Path | What it is |
|---|---|
| `tts/server.py`, `tts/pronounce.py`, `tts/pronounce.json` | The speech service and its pronunciation table |
| `client/speech/` | Page side of speaking: `speech.js` (fetch, fallback, talk-key mute), `queue.js` (order and dropping), `radio.js` (the radio effect), `text.js` (what is said, which voice) |
| `stt/server.py`, `stt/models.json`, `stt/eval/` | The listening service and its measurements |
| `server/room/listen.go` | The game server's gate in front of the listening service |
| `client/voice/` | Page side of listening: `voice.js` (microphone, recording, server-or-browser choice), `worker.js` (models in a Web Worker), `transducer.js` + `fbank.js` (Hebrew streaming model), `engine.js` + `mel.js` (Moonshine and the older Hebrew model), `hints.js`, `normalize.js` (tidy) |

### Facts that hold across the area

- The game server is the only origin the page talks to. It forwards `/tts/*` to the speech service (flag `-tts`) and `POST /stt/transcribe` to the listening service (flag `-stt`); see [[Server Flags]].
- `make play` starts the speech service only when its image and models are present, and the listening service only when its image, its models and a GPU are present; see [[Make Targets]] and [[Docker Compose Services]].
- No model weights are in the repository. Each set is fetched by its own make target from pinned revisions and checked by SHA-256 (`tts/models.json`, `stt/models.json`, `client/voice/models.json`).
- The speech service is described by its own notice as a test rig, not part of a shipped game: "the plan is to pre-record the fixed radio phrases and serve them as files" (`tts/NOTICE.md`).
- All speech handles exactly two languages, Hebrew (`he`) and English (`en`); see [[Net Language]].

### Notes in this area

- [[Text to Speech Service]]
- [[Pronunciation Table]]
- [[Speech Recognition]]
- [[Server Whisper]]
- [[In-Browser Recognition]]
- [[Hints and Tidy Step]]
- [[Recognition Evaluation]]
- [[Speech on Phones]]

### Related

- [[Home]]
- [[Radio Net and Bilingual Procedure]]
- [[Procedure Words]]
- [[Callsigns]]
- [[Radio Console]]
- [[Licences and Credits]]
- [[Running, Deploying and Testing]]
