---
title: Server Whisper
description: "The listening service (stt/server.py) transcribes the players' spoken radio calls with Whisper on the game machine's own GPU."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/code
  - area/speech
  - topic/speech
  - topic/stt
  - topic/server
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Recognition Evaluation]]"
  - "[[Hints and Tidy Step]]"
  - "[[Speech]]"
  - "[[Speech Recognition]]"
  - "[[In-Browser Recognition]]"
  - "[[Seats, Tokens and Trust]]"
  - "[[HTTP API]]"
  - "[[Docker Compose Services]]"
  - "[[Make Targets]]"
  - "[[Licences and Credits]]"
paths:
  - stt/server.py
  - stt/models.json
  - stt/fetch.py
  - stt/Dockerfile
  - stt/NOTICE.md
  - stt/test_server.py
  - server/room/listen.go
  - server/room/hub.go
  - server/cmd/callsign/main.go
  - docker-compose.yml
  - Makefile
---

# Server Whisper

The listening service (`stt/server.py`) transcribes the players' spoken radio calls with Whisper on the game machine's own GPU. It is optional and gated: the game server passes a recording on only for a commander who holds a seat in a live match, and a machine without a GPU should not run it at all.

## Models (`stt/models.json`, `stt/NOTICE.md`)

| Language | Model | Size | Licence |
|---|---|---|---|
| Hebrew | `ivrit-ai/whisper-large-v3-turbo-ct2` @ `72ad623a` (ivrit.ai's fine-tune of whisper-large-v3-turbo, CTranslate2 form) | 1.6 GB | Apache-2.0 |
| English | `dropbox-dash/faster-whisper-large-v3-turbo` @ `0a363e91` (stock whisper-large-v3-turbo converted to CTranslate2) | 1.6 GB | MIT |

English gets the stock model because the Hebrew fine-tune "has lost much of its English" ([[Recognition Evaluation]]). Inference is faster-whisper 1.2.1 on CTranslate2 4.9.1 (MIT), with the Silero voice detector shipped inside faster-whisper. The image also holds two NVIDIA CUDA libraries from pip under NVIDIA's proprietary licence; the notice says to read that agreement before publishing an image that contains them.

`make stt-image` builds the image (about 4.4 GB, stands alone); `make stt-models` downloads about 3.2 GB into `assets/models/whisper-he` and `assets/models/whisper-en` from the pinned revisions, the weights checked by SHA-256; `make stt-test` runs the service's own tests with no models, GPU or network; `make stt-quiet` and `make stt-eval` measure it.

## Precision and device

| Setting | Value |
|---|---|
| Default precision on the GPU | `int8_float16`: 8-bit weights, half-precision arithmetic, 2.3 GB of GPU memory for both models |
| Alternative | `--precision float16`: 4.3 GB, "neither faster nor more accurate here" (commit 75fc93f) |
| On the CPU | `int8` |
| `--device` | `auto` (default), `cuda`, `cpu` |

**CPU to GPU move** (commit 50fe864). At start, with `--device auto`, a separate process (`PROBE`, `gpu_refusal`) tries to load both models on the GPU, so a failed attempt does not leave GPU memory held by the service. If the GPU cannot be used the service starts on the CPU and a background thread (`regain`) looks again every 300 s (`GPU_RETRY_SECONDS`); once the models fit they are loaded, tried on a tone and swapped in under the lock.

## HTTP interface (port 5003)

| Request | Answer |
|---|---|
| `POST /transcribe?lang=he\|en&hints=<text>` with the recording as body | `{"text": "..."}` ("" when nothing was said) |
| `GET /health` | `{"ok", "languages", "device", "precision", "maxSeconds"}` |

## What it accepts and refuses

| Limit | Value | Refusal |
|---|---|---|
| Format | 16 kHz mono 16-bit, as a WAV file or bare samples | 400 for any other WAV format or an unreadable file |
| Length | 15 s (`MAX_SECONDS`) | 413 |
| Language | `he` or `en` only | 400 |
| Hints | cut to 600 characters (`MAX_HINT_CHARS`) | none; silently cut |
| Queue | one recording at a time; at most 4 waiting (`MAX_WAITING`) | 503 "busy" |

## Keeping silence silent

Whisper writes whole sentences for silence and noise, so three things stand in its way (`Listener.hear`):

1. A level check: a recording whose loudest 20 ms is below RMS 0.003 (`QUIET`) returns "" without asking a model.
2. The voice detector (`vad_filter`, minimum silence 400 ms, padding 200 ms).
3. Whisper's own scores: a segment is dropped when `no_speech_prob > 0.6` with `avg_logprob < -0.7`, or `avg_logprob <= -1.2`, or `compression_ratio >= 2.4`.

Decoding uses beam 5, temperature 0 with no retries at higher temperature ("they are where invented text comes from"), and no conditioning on previous text. The hints go in as `initial_prompt`; see [[Hints and Tidy Step]].

## Privacy

A recording is held in memory for the length of its request, never written to disk and never logged; the log has only its length, its language and the time taken. The compose service `stt` sits on the network `listen`, which is `internal: true`: the container has no route out and is reached only by the game server.

## The gate in the game server (`server/room/listen.go`)

The page never talks to the service directly. The game server exposes `POST /stt/transcribe?room=&side=&lang=&hints=` only when started with `-stt`, and reports `stt: true` in `/api/server`.

| Check | Rule |
|---|---|
| Who | The room must exist and `side` be 0 or 1; in a room with seats, `X-Callsign-Seat` must hold that side's seat, else 403. The open room of a server without an agent key has no seats and is trusted to be on this machine. |
| How often | Per network address: a bucket of 8 calls (`listenBurst`) refilled one every 3 s (`listenEvery`); beyond it 429 with `Retry-After`. |
| How long | Body at most 15 s of audio plus a header (`listenBody`), else 413. |
| What is forwarded | Only `lang` and `hints`; the seat header and cookies are stripped. |
| Failure | 502 "the listening service did not answer"; the page then recognises in the browser. |

Behind the machine's own https front the sender's address is read from the last entry of `X-Forwarded-For`, and only when the connection itself arrives from a loopback or private address (`senderAddr`).

`make play` starts the service and tells the game server about it only when the image, both models and a GPU (`nvidia-smi`) are all present.

## Why not on a CPU

Whisper pads every recording to 30 s, so a short call costs the same as a long one: about 0.1 s on the GPU, about 4.5 s of four cores on a CPU, one call at a time. `stt/NOTICE.md`: "A public server with a few cores and many players should not run this service; its players use the recogniser in their own browsers."

## Related

- [[Speech]]
- [[Speech Recognition]]
- [[In-Browser Recognition]]
- [[Hints and Tidy Step]]
- [[Recognition Evaluation]]
- [[Seats, Tokens and Trust]]
- [[HTTP API]]
- [[Docker Compose Services]]
- [[Make Targets]]
- [[Licences and Credits]]
