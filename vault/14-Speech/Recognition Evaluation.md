---
title: Recognition Evaluation
description: "Speech recognition was measured twice: the server's Whisper service on 2026-11-24 and the recognisers in the browser on 2026-11-26."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/code
  - area/speech
  - topic/speech
  - topic/stt
  - topic/evaluation
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Speech]]"
  - "[[Speech Recognition]]"
  - "[[Server Whisper]]"
  - "[[In-Browser Recognition]]"
  - "[[Hints and Tidy Step]]"
  - "[[Speech on Phones]]"
  - "[[Command Grammar]]"
  - "[[Known Flaws]]"
  - "[[Make Targets]]"
paths:
  - stt/eval/RESULTS.md
  - stt/eval/calls.json
  - stt/eval/make.py
  - stt/eval/run.py
  - stt/eval/score.mjs
  - stt/eval/hints.mjs
  - stt/eval/chrome.mjs
  - stt/eval/browser.mjs
  - Makefile
---

# Recognition Evaluation

Speech recognition was measured twice: the server's Whisper service on 2026-11-24 and the recognisers in the browser on 2026-11-26. All numbers on this page are copied from `stt/eval/RESULTS.md` and were not re-run for the vault; the test recordings are synthetic, so the scores are an upper bound.

## Method

- **Test set**: 32 Hebrew and 32 English calls (`stt/eval/calls.json`), spoken by the game's own speech service in three voices each, once clean and once under room noise at 10 dB: 384 recordings of 3 to 6 seconds, 192 per language.
- **Tools**: `make.py` speaks the calls (needs `make play` with voices), `hints.mjs` writes the hints the page would send (using the large map), `run.py` transcribes, `score.mjs` scores. `make stt-eval` runs the chain; `make stt-quiet` checks that silence and noise come back empty. Recordings and transcripts go to `assets/stt-eval/` (git-ignored).
- **Browser**: `chrome.mjs` drives headless Chrome against the page's own speech worker (`--mic` plays each recording as the microphone); `browser.mjs` runs the same recogniser code in Node on one thread.
- **Columns**: *words* = 1 minus word error rate; *callsigns* = recordings where every callsign said was written with its number; *points* = the same for map points; *exact* = written word for word; *order* = recordings in which the order would be understood after tidying, as the rule brain's grammar reads it. All after the page's tidying.
- **Known ceiling**: the speech service mispronounces a few Hebrew words ("נועו" in 7 of 32 calls, "רות" sometimes swallowed), which caps Hebrew word accuracy at roughly 98%.

## The server service (2026-11-24)

Hebrew, 192 recordings:

| Recogniser | words | callsigns | points | exact | s per call |
|---|---|---|---|---|---|
| Browser until 2026-11-26 (Ozen-v1, with openers) | 92.1% | 91.7% | 100% | 64% | 6.0 (one thread) |
| Service, no hints | 93.9% | 96.9% | 96% | 67% | 0.10 |
| Service, hints as a word list | 95.2% | 100% | 99% | 76% | 0.10 |
| Service, hints as radio traffic | 98.6% | 100% | 100% | 91% | 0.10 |
| The same, 8-bit weights (what runs) | 98.5% | 100% | 100% | 91% | 0.12 |

English, 192 recordings:

| Recogniser | words | callsigns | points | exact | s per call |
|---|---|---|---|---|---|
| Browser (Moonshine base) | 97.6% | 95.8% | 98% | 85% | 0.42 (one thread) |
| Service, stock large-v3-turbo, no hints | 98.0% | 96.4% | 98% | 87% | 0.09 |
| Service, stock large-v3-turbo, hints as traffic (what runs) | 98.7% | 100% | 98% | 92% | 0.09 |
| Hebrew fine-tune asked for English, hints (64 recordings) | 96.4% | 95.3% | 94% | 81% | |
| Hebrew fine-tune asked for English, no hints (64 recordings) | 64.4% | 26.6% | 56% | 20% | |

Settings compared:

| Setting | Finding |
|---|---|
| Hints | `hotwords` and `initial_prompt` gave identical text; what matters is writing the hint as calls. Before tidying, the Hebrew callsign is right in 48% of recordings without hints and 97% with. |
| Precision | `float16` and `int8_float16` are within one recording of each other and equally fast; 4.3 GB against 2.3 GB of GPU memory. |
| Beam | Beam 5 and greedy score and cost the same. Beam 5 stays. |
| Silence | Without a voice detector Whisper wrote "תודה רבה", "Thank you." or "Over." for 25 of 36 noise recordings; with the level check and detector every one is empty. |

Speed (the results file names the test GPU as an RTX 5070 Ti): a 3 to 6 s call takes 0.09 to 0.14 s, a 15 s recording 0.19 s, about 8 calls a second one at a time. On a CPU limited to 4 cores:

| Model | s per call | Hebrew words | calls per minute |
|---|---|---|---|
| ivrit.ai large-v3-turbo | 4.5 | 96% (24 recordings) | 13 |
| stock Whisper small | 1.6 | 83%, callsigns 92% (48 recordings) | 37 |

Conclusion in the file: "This service is for a machine with a GPU."

## In the browser (2026-11-26)

The results file states the production server has four CPU cores and no GPU, so every player's speech there is recognised in their own browser. The recordings were made again that day, so these numbers differ a little from the table above. 192 recordings a language, after tidying:

| Hebrew recogniser | order | words | callsigns | points | exact | download |
|---|---|---|---|---|---|---|
| Ozen-v1 (what ran before) | 79.2% | 91.7% | 94.3% | 97% | 61% | 165 MB |
| Zipformer2 66M streaming, told nothing | 82.8% | 94.5% | 96.9% | 98% | 69% | 72 MB |
| The same, told the net's names (what runs now) | 90.1% | 95.3% | 99.5% | 100% | 74% | 72 MB |

| English recogniser | order | words | callsigns | points | exact | download |
|---|---|---|---|---|---|---|
| Moonshine base (still runs) | 91.1% | 97.9% | 97.4% | 98% | 85% | 67 MB |
| Zipformer 66M streaming English, told nothing | 74.5% | 92.4% | 88.0% | 93% | 62% | 73 MB |
| The same with hot words | 83.9% | 95.3% | 93.8% | 98% | 72% | 73 MB |
| Zipformer 20M streaming English, told nothing | 12.0% | 76.0% | 14.6% | 89% | 11% | 44 MB |
| The same with hot words | 42.2% | 85.6% | 49.5% | 97% | 30% | 44 MB |

Moonshine's order score was 88.0% before the tidy step learned "Viper, too, hold Delta". The English Zipformers were run with sherpa-onnx itself and were not built into the page.

Median seconds from letting go of the button to the text:

| Setting | Zipformer he, live | Zipformer he, whole | Ozen-v1 | Moonshine en |
|---|---|---|---|---|
| Worker, 4 threads, calls of 4.4 s | 0.12 | 0.12 | 1.30 | 0.11 |
| Worker, 1 thread, calls of 4.7 s | | 0.23 | 4.49 | 0.23 |
| Main thread, 1 thread, calls of 4.7 s | 0.06 | 0.24 | 4.42 | 0.24 |
| The same slowed 4x ("a good phone") | 0.22 | 0.92 | 30.1 | 0.92 |
| The same slowed 6x ("a middling phone") | 0.33 | 1.36 | not run | 1.39 |

Other measurements: starting a model already on the machine took 0.9 s (Zipformer) and 0.75 s (Moonshine) at full speed, 3.4 s and 2.7 s slowed 4x. A loaded recogniser costs a desktop Chrome tab roughly 250 to 400 MB. The phrase bonus was tried from 0.5 to 3: 1 to 2 score alike, 3 starts to write names that were not said. Of 30 noise recordings at three levels the Zipformer wrote nothing for 28 and "אממ" for the loudest hum. Through the real microphone path (`chrome.mjs --mic`) the order was understood in 91.7% of Hebrew and 94.3% of English recordings.

## The browser's own recognition (Web Speech API)

Looked up from browser documentation, not measured and not wired in. Findings recorded: it does not exist in a web app added to the iPhone's Home Screen; the audio goes to Google, Microsoft or Apple; there is no way to give it the net's names for Hebrew or on a phone. The file's position: if added, it should be a setting the player turns on, worded to say where the recording goes, never a default.

## Known weaknesses (as the file lists them)

- Synthetic voices only; no recording of a real player exists yet. The phrase bonus and the tidy step are tuned on these recordings.
- A phone was imitated by slowing a desktop, not used; memory, browser and microphone of a real phone were not measured. The live path has never run on an iPhone.
- 17 of the 19 Hebrew recordings whose order is still lost are the two words the speech service mispronounces.
- The Hebrew browser model's CC BY 4.0 credit is not yet shown in the game.

## Related

- [[Speech]]
- [[Speech Recognition]]
- [[Server Whisper]]
- [[In-Browser Recognition]]
- [[Hints and Tidy Step]]
- [[Speech on Phones]]
- [[Command Grammar]]
- [[Known Flaws]]
- [[Make Targets]]
