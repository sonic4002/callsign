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
updated: 2026-11-26
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
