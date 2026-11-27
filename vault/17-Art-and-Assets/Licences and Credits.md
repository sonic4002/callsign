---
title: Licences and Credits
description: "The project's rule is that everything the game ships must be free to sell, and every asset or model not made from nothing in the repository is listed with its licence before it goes in."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/mixed
  - area/art-and-assets
  - topic/art
  - topic/licences
  - topic/speech
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Text to Speech Service]]"
  - "[[Art and Assets]]"
  - "[[Art Style Guide]]"
  - "[[Art Pipeline]]"
  - "[[Speech]]"
  - "[[Server Whisper]]"
  - "[[In-Browser Recognition]]"
  - "[[Sound, Music and Effects]]"
  - "[[Decision - Isometric Art]]"
  - "[[Known Flaws]]"
paths:
  - assets/NOTICE.md
  - assets/sprites/CREDITS.md
  - assets/audio/CREDITS.md
  - assets/audio/manifest.json
  - tts/NOTICE.md
  - stt/NOTICE.md
  - client/voice/NOTICE.md
  - client/vendor/README.md
  - docs/art/STYLE.md
---

# Licences and Credits

The project's rule is that everything the game ships must be free to sell, and every asset or model not made from nothing in the repository is listed with its licence before it goes in. This note gathers the five notice files into one place; the notice files themselves remain the source and must be updated first.

## The rule (`assets/NOTICE.md`)

- "Add a row before adding a file; an asset that is not listed here does not go in."
- An outside artwork would need: source address, author, licence (CC0, or CC-BY with the credit written down), what was changed, and where it is used. Nothing "free for personal use", nothing ripped from or imitating a particular game.
- **Artwork from outside: none.** No picture in `assets/sprites` was downloaded, traced or taken from another game or artist. Free CC0 art sets were considered for the units and rejected because they would have been a third look beside the painted buildings.

## Models that made the pictures

| Model | Used for | Licence | Source |
|---|---|---|---|
| FLUX.2 [klein] 4B, distilled | Buildings, landmarks, ground, portraits; painting the unit sheets | Apache-2.0 | `black-forest-labs/FLUX.2-klein-4B` on Hugging Face |
| Qwen3 4B text encoder (fp4) | The same | Apache-2.0 | `Comfy-Org/Flux-2-Klein-4B` |
| FLUX.2 VAE | The same | Apache-2.0 | `Comfy-Org/Flux-2-Klein-4B` |
| BiRefNet (general) | Cutting the background away | MIT | github.com/ZhengPeng7/BiRefNet |

**The FLUX.2 klein 9B model is non-commercial and must not be used.**

Tools: Blender 4.2 (GPL) renders the unit models; the licence covers the program, not the pictures made with it. ComfyUI (GPL-3.0) runs the image model; nothing of it ships. Per-picture seeds and prompts are in `assets/sprites/CREDITS.md`. The hero portraits were painted from a description of invented characters; "no real person and no existing character was named or shown" to the model.

## Music (`assets/audio/CREDITS.md`)

All tracks were fetched from OpenGameArt.org on 2026-11-24; files are the originals, renamed and not edited.

| File | Title | Artist | Licence | Use |
|---|---|---|---|---|
| `menu-monolith.mp3` | Heavy Metal Riffs - Monolith | Tri-Tachyon | CC-BY 4.0 | Menu |
| `menu-3hr-mt3.mp3` | Heavy Metal Riffs - 3HR.MT3 | Tri-Tachyon | CC-BY 4.0 | Menu |
| `battle-heavy-1.ogg` | Heavy Battle 1 | MintoDog | CC0 1.0 | Battle |
| `battle-heavy-2.ogg` | Heavy Battle 2 | MintoDog | CC0 1.0 | Battle |
| `battle-urgent.mp3` | Urgent (Dark Sci-Fi Audio Pack) | SRG774 | CC0 1.0 | Battle |

Attribution asked for by the CC-BY tracks: "Music by Tri-Tachyon - https://soundcloud.com/tri-tachyon/albums". The CC0 tracks are credited by choice.

**Open obligation:** CC-BY 4.0 requires the Tri-Tachyon line to be shown to players with the licence named. The credits file states: "Until the game has a credits screen, the two menu tracks must not ship in a public build."

`assets/audio/manifest.json` also carries each track's length, integrated loudness (LUFS) and peak, because "the tracks differ by more than 30 dB" and the player levels them.

Weapon sounds, effects and the radio effect are synthesized in code; no recorded sound effects are used.

## Speaking: the speech service (`tts/NOTICE.md`)

A test rig for the owner's machine, not part of the shipped game. See [[Text to Speech Service]].

| What | Licence | Note |
|---|---|---|
| BlueTTS "BlueV3" speech model (`notmax123/BlueV3-onnx`) | MIT | |
| Vocoder (fine-tuned from the Supertonic-3 vocoder, Supertone Inc.) | BigScience OpenRAIL-M | Commercial use allowed with use-based restrictions; "read it before a public release" |
| 15 voices (style tokens computed from LibriTTS-R speakers) | CC BY 4.0 | Attribution required: Y. Koizumi et al., "LibriTTS-R: A Restored Multi-Speaker Text-to-Speech Corpus", Interspeech 2023 |
| RenikudPlus Hebrew reader | Apache-2.0 | |
| polyg2p English reader | Apache-2.0 | Data derived from the CMU Pronouncing Dictionary (BSD-style) |
| `blue-onnx`, `renikud-plus`, `heb-tts-normalizer` | MIT | |
| `hebrew-num2words` | Apache-2.0 | |

Warning in the notice: `blue-onnx` pulls in `phonemizer-fork` and `espeakng-loader` (eSpeak NG, GPL-3.0) as dependencies that are not used. "They must not be carried into anything that ships."

## Listening: the server service (`stt/NOTICE.md`)

| What | Licence | Note |
|---|---|---|
| Hebrew model `ivrit-ai/whisper-large-v3-turbo-ct2` | Apache-2.0 | ivrit.ai's fine-tune of openai/whisper-large-v3-turbo; keep the licence and attribution |
| English model `dropbox-dash/faster-whisper-large-v3-turbo` | MIT | openai/whisper-large-v3-turbo, Copyright (c) 2022 OpenAI |
| faster-whisper 1.2.1, CTranslate2 4.9.1 | MIT | |
| Silero VAD | MIT | |
| `nvidia-cublas-cu12`, `nvidia-cudnn-cu12` | NVIDIA Software License Agreement (proprietary) | Only inside the local image, which is not published; read the agreement before publishing an image that contains them |

## Listening: in the browser (`client/voice/NOTICE.md`)

| What | Licence | Credit |
|---|---|---|
| Hebrew recogniser `ivrit-ai/zipformer2-66m-streaming-he` | CC BY 4.0 | The work of Yakov Kolani, fine-tuned from icefall's English streaming Zipformer (Apache-2.0) on audio from ivrit.ai under the ivrit.ai licence, which also asks for attribution |
| Older Hebrew recogniser `itayinbar/Ozen-v1` | Apache-2.0 | Distilled from ivrit.ai's Whisper fine-tune; base model openai/whisper-base (MIT) |
| English recogniser `onnx-community/moonshine-base-ONNX` | MIT | Model by Useful Sensors |
| `onnxruntime-web` 1.30.0 | MIT | Copyright (c) Microsoft Corporation |
| Ported code: `fft.js`, `mel.js`, the byte tokenizer, the decoder loop in `engine.js`, `mel_filters.bin`, `testdata/sample-he.wav` | MIT | From the Ozen web app, Copyright (c) 2026 Itay Inbar; the full MIT notice is in `client/voice/NOTICE.md` |

**Open obligation:** `stt/eval/RESULTS.md` records that the CC BY 4.0 credit for the Hebrew browser model is in the notice file but "the game itself shows none yet".

## Obligations still open before a public release

| Item | Source |
|---|---|
| A credits screen showing the Tri-Tachyon attribution, or drop the two menu tracks | `assets/audio/CREDITS.md` |
| Show the credit for the Hebrew browser recogniser (CC BY 4.0) in the game | `stt/eval/RESULTS.md` |
| Read the OpenRAIL-M licence of the vocoder | `tts/NOTICE.md` |
| Keep eSpeak NG (GPL-3.0) out of anything shipped | `tts/NOTICE.md` |
| Read NVIDIA's agreement before publishing the listening image | `stt/NOTICE.md` |
| Never use FLUX.2 klein 9B | `assets/NOTICE.md`, `CLAUDE.md` |

Not verified for the vault: the licence texts themselves were not re-read at their sources; the table repeats what the repository's notice files state.

## Related

- [[Art and Assets]]
- [[Art Style Guide]]
- [[Art Pipeline]]
- [[Speech]]
- [[Text to Speech Service]]
- [[Server Whisper]]
- [[In-Browser Recognition]]
- [[Sound, Music and Effects]]
- [[Decision - Isometric Art]]
- [[Known Flaws]]
- [[Backlog]]
