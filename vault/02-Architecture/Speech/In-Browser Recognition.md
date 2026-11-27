---
title: In-Browser Recognition
description: "Without a listening service on the game server, the player's speech is recognised by a model running in a Web Worker in their own browser, on ONNX Runtime's WebAssembly build."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/code
  - area/architecture
  - topic/speech
  - topic/stt
  - topic/voice
  - topic/browser
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Service Worker and Install]]"
  - "[[Speech on Phones]]"
  - "[[Voice Pipeline (STT and TTS)]]"
  - "[[Speech Recognition]]"
  - "[[Server Whisper]]"
  - "[[Hints and Tidy Step]]"
  - "[[Recognition Evaluation]]"
  - "[[Licences and Credits]]"
  - "[[Make Targets]]"
paths:
  - client/voice/models.json
  - client/voice/worker.js
  - client/voice/transducer.js
  - client/voice/fbank.js
  - client/voice/engine.js
  - client/voice/mel.js
  - client/voice/tokenizer.js
  - client/voice/fetch-models.mjs
  - client/voice/NOTICE.md
  - client/vendor/README.md
  - client/voice/voice.test.mjs
  - client/voice/transducer.test.mjs
  - client/voice/server.test.mjs
  - client/sw.js
  - server/cmd/callsign/main.go
  - Makefile
---

# In-Browser Recognition

Without a listening service on the game server, the player's speech is recognised by a model running in a Web Worker in their own browser, on ONNX Runtime's WebAssembly build. No audio leaves the device on this path, and it is the only path on a server without a GPU.

## Models (`client/voice/models.json`)

| Key | Model | Kind | Download | Licence | Role |
|---|---|---|---|---|---|
| `he` | `ivrit-ai/zipformer2-66m-streaming-he` @ `ee769a2a`, 8-bit sherpa-onnx export (encoder 70.5 MB, decoder 1.0 MB, joiner 0.8 MB, tokens) | `transducer` (streaming Zipformer2, 66M parameters) | 72 MB | CC BY 4.0 | Hebrew, since 2026-11-26 (commit 6c48909) |
| `he-whisper` | `itayinbar/Ozen-v1` @ `82aae03d`, fp16 encoder + fp32 decoder | `whisper` | 165 MB | Apache-2.0 | Older Hebrew model, `optional`; the `fallback` of `he` |
| `en` | `onnx-community/moonshine-base-ONNX` @ `b1e9b6aa`, 8-bit encoder and decoder | `moonshine` | 67 MB | MIT | English |
| runtime | `onnxruntime-web` 1.30.0, WebAssembly build | | 14 MB | MIT | Shared by all three |

The CC BY 4.0 Hebrew model requires credit. The credit is in `client/voice/NOTICE.md`; `stt/eval/RESULTS.md` records that "the game itself shows none yet".

## Fetching the files to the server (`make voice-models`)

`client/voice/fetch-models.mjs` downloads the runtime into `client/vendor/ort/` and the models into `assets/models/<dir>/` (`zipformer-he`, `moonshine-base`, and with `ALL=1` also `ozen-v1`). Every file has its size and SHA-256 pinned in `models.json`; a file that does not match is not kept. Neither directory is in git. Nothing is fetched from a CDN at run time: the game server serves the files.

## Loading in the browser (`client/voice/worker.js`)

- The worker owns ONNX Runtime and the recognisers, "so the page only hands it samples and gets text back, and the map never waits on it".
- Each file is fetched from `/assets/models/<dir>/...`, its length and SHA-256 are checked against the manifest, and it is kept in a Cache Storage cache named `callsign-voice-<dir>-<revision 8 chars>`. A later visit reads it from there.
- A 404 means the files are not on this server: if the model has a `fallback` (Hebrew does) that one is loaded instead; otherwise the page shows "The speech models are not installed on this server. Run: make voice-models".
- `forget` deletes the caches of models the page no longer uses (an older revision, or the 165 MB Ozen-v1 after the Zipformer took over).
- Threads: `min(4, hardwareConcurrency)` when the page is cross-origin isolated, else 1. The game server sends `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on everything for this reason.
- Jobs run one at a time in the order asked.
- The page's service worker never caches `/assets/models/` or `/vendor/`, and on activation leaves every `callsign-voice-` cache alone (commit 3dfa29f); before that, each new version of the page made every player download the model again. See [[Service Worker and Install]].

`Voice.prepare(lang)` fetches the model ahead of need in the lobby, with progress shown (commit c0491fe); see [[Speech on Phones]] for when it does not.

## The Hebrew streaming model (`transducer.js`, `fbank.js`)

- A Zipformer transducer (encoder, decoder, joiner) that reads the recording 1.28 s at a time and writes as it goes.
- It runs on the ONNX Runtime the page already had, not on sherpa-onnx's own WebAssembly build. `fbank.js` computes Kaldi's features (equal to kaldi-native-fbank to 0.0002 on every value, per the results file); `transducer.js` does the streaming and a beam search of width 4 (`BEAM`).
- **Told what to expect.** The net's names and words (`hintPhrases`) form a letter tree. While the search is spelling one of them it earns a bonus of 1.5 nats per letter (`BOOST`) for the first four letters of each word (`PAID`), and loses it again if the word turns out to be another. The bias works on letters, not on the model's word pieces, so it needs no tokenizer.
- The worker posts `partial` messages with the text so far; the page shows it as "Listening: ...".

## Moonshine and the older Hebrew model (`engine.js`)

One `Recognizer` class with two front ends: `whisper` (log-mel features of a padded 30 s window, `mel.js`) and `moonshine` (raw samples), sharing a greedy decoder loop.

- **Openers.** The callsigns a call can start with (the side's class callsigns, the operator, "all stations") are tried as the first word: if the audio supports one well enough (average log-probability per token at least `OPENER_FLOOR = -5`) it is taken and the rest is decoded as usual (commit eff795d).
- **Silence.** `trimSilence` cuts the quiet before and after the speech with a 0.25 s margin; under a quarter of a second of sound returns "".
- **Runaway text.** Moonshine's output is capped at 6.5 tokens per second of audio (`tokensPerSecond`) because it "makes up words when it is allowed to run on past the speech".
- **Noise.** `isNoise` drops output of 12 or more words that is one short phrase repeated, which is what these models write for noise.

## Provenance of the code (`client/voice/NOTICE.md`)

`fft.js`, `mel.js`, the byte tokenizer, the decoder loop in `engine.js`, `mel_filters.bin` and `testdata/sample-he.wav` are ported or copied from the Ozen web app (MIT, Copyright (c) 2026 Itay Inbar). `fbank.js`, `transducer.js`, `resample.js` and `tap.js` were written for this game; they follow kaldi-native-fbank, sherpa-onnx and icefall in method and include none of their code.

## Tests

`node --test` (part of `make test`) covers the tidy step, tokenizers, log-mel and fbank features against references, the phrase tree, the server-or-browser choice and the 15 s limit with fakes. The tests that run the real models are skipped unless `CALLSIGN_VOICE_MODELS=1` (`make voice-test`, which needs `make voice-models` first).

## Related

- [[Voice Pipeline (STT and TTS)]]
- [[Speech Recognition]]
- [[Server Whisper]]
- [[Hints and Tidy Step]]
- [[Recognition Evaluation]]
- [[Speech on Phones]]
- [[Service Worker and Install]]
- [[Licences and Credits]]
- [[Make Targets]]
