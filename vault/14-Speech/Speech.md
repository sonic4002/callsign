---
title: Speech
description: "Callsign is played over a radio net, so the game both speaks (squads and Anvil are heard) and listens (the player holds a talk button and speaks an order)."
type: hub
status: current
tags:
  - type/hub
  - status/current
  - agent/CLD
  - origin/code
  - area/speech
  - topic/speech
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Text to Speech Service]]"
  - "[[Pronunciation Table]]"
  - "[[Speech Recognition]]"
  - "[[Server Whisper]]"
  - "[[In-Browser Recognition]]"
  - "[[Hints and Tidy Step]]"
  - "[[Recognition Evaluation]]"
  - "[[Speech on Phones]]"
  - "[[Server Flags]]"
  - "[[Make Targets]]"
paths:
  - tts/server.py
  - stt/server.py
  - client/speech/speech.js
  - client/voice/voice.js
  - server/room/listen.go
  - server/cmd/callsign/main.go
  - Makefile
---

# Speech

Callsign is played over a radio net, so the game both speaks (squads and Anvil are heard) and listens (the player holds a talk button and speaks an order). Both directions are optional layers over the text net: every call exists as text first, and the game is fully playable by typing.

## The two directions

| Direction | What it does | Where it runs | Notes |
|---|---|---|---|
| Speaking (text to speech) | Reads the radio messages of the player's own stations aloud, through a radio effect | An optional Python service (`tts/`) behind the game server at `/tts/`; fallback is the browser's own voice | [[Text to Speech Service]], [[Pronunciation Table]] |
| Listening (speech recognition) | Turns a held-button recording into the text of a radio call | An optional GPU service (`stt/`) behind `/stt/transcribe`, else models in the player's browser (`client/voice/`) | [[Speech Recognition]], [[Server Whisper]], [[In-Browser Recognition]] |

Between the recogniser and the net sits a repair step that puts the net's own spelling on callsigns and map points: [[Hints and Tidy Step]]. How well all of it works was measured: [[Recognition Evaluation]]. What differs on a phone: [[Speech on Phones]].

## Code map

| Path | What it is |
|---|---|
| `tts/server.py`, `tts/pronounce.py`, `tts/pronounce.json` | The speech service and its pronunciation table |
| `client/speech/` | Page side of speaking: `speech.js` (fetch, fallback, talk-key mute), `queue.js` (order and dropping), `radio.js` (the radio effect), `text.js` (what is said, which voice) |
| `stt/server.py`, `stt/models.json`, `stt/eval/` | The listening service and its measurements |
| `server/room/listen.go` | The game server's gate in front of the listening service |
| `client/voice/` | Page side of listening: `voice.js` (microphone, recording, server-or-browser choice), `worker.js` (models in a Web Worker), `transducer.js` + `fbank.js` (Hebrew streaming model), `engine.js` + `mel.js` (Moonshine and the older Hebrew model), `hints.js`, `normalize.js` (tidy) |

## Facts that hold across the area

- The game server is the only origin the page talks to. It forwards `/tts/*` to the speech service (flag `-tts`) and `POST /stt/transcribe` to the listening service (flag `-stt`); see [[Server Flags]].
- `make play` starts the speech service only when its image and models are present, and the listening service only when its image, its models and a GPU are present; see [[Make Targets]] and [[Docker Compose Services]].
- No model weights are in the repository. Each set is fetched by its own make target from pinned revisions and checked by SHA-256 (`tts/models.json`, `stt/models.json`, `client/voice/models.json`).
- The speech service is described by its own notice as a test rig, not part of a shipped game: "the plan is to pre-record the fixed radio phrases and serve them as files" (`tts/NOTICE.md`).
- All speech handles exactly two languages, Hebrew (`he`) and English (`en`); see [[Net Language]].

## Notes in this area

- [[Text to Speech Service]]
- [[Pronunciation Table]]
- [[Speech Recognition]]
- [[Server Whisper]]
- [[In-Browser Recognition]]
- [[Hints and Tidy Step]]
- [[Recognition Evaluation]]
- [[Speech on Phones]]

## Related

- [[Reference Map]]
- [[Radio Net]]
- [[Procedure Words]]
- [[Callsigns]]
- [[Radio Console]]
- [[Licences and Credits]]
- [[Operations]]
