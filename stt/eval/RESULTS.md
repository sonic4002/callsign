# Listening: what was measured (2026-11-24)

Run again with `make stt-eval` (needs `make play` running with the radio voices).

## Read this first

The test recordings are **synthetic**: the 32 Hebrew and 32 English calls in `calls.json`,
spoken by the game's own speech service in three voices each, once clean and once under
room noise at 10 dB (384 recordings, 3 to 6 seconds). Synthetic voices read clean text
with a steady accent and a perfect microphone. This is an easy test and the scores are an
upper bound. Nobody has a recording of a real player yet; the first thing to do with one is
to add it here.

The speech service also mispronounces a few words, which every recogniser then gets
"wrong" in the same way: Hebrew "נועו" comes out as "נו" or "נעול" (in 7 of the 32 calls),
and "רות" is sometimes swallowed. That puts a ceiling of roughly 98% on Hebrew word accuracy
that has nothing to do with the recognisers.

Columns: **words** = 1 − word error rate; **callsigns** = recordings in which every
callsign said was written, with its number; **points** = the same for map points;
**exact** = recordings written word for word. All after the page's tidying
(`client/voice/normalize.js`), which is what the player sees. Digits and number words
count as the same word.

## Hebrew (192 recordings)

| Recogniser | words | callsigns | points | exact | seconds per call |
|---|---|---|---|---|---|
| In the browser today (Ozen-v1, with its callsign openers) | 92.1% | 91.7% | 100% | 64% | 6.0 (one thread, outside a browser) |
| Service, no hints | 93.9% | 96.9% | 96% | 67% | 0.10 |
| Service, hints as a word list | 95.2% | 100% | 99% | 76% | 0.10 |
| **Service, hints as radio traffic (what runs)** | **98.6%** | **100%** | **100%** | **91%** | **0.10** |
| The same, 8-bit weights (what runs: half the GPU memory) | 98.5% | 100% | 100% | 91% | 0.12 |

As heard, before tidying, the difference is larger: without hints the service writes the
callsign right in 48% of the recordings ("צפה אחד", "ספר אחד" for צפע 1) and with hints in
97%. The tidying repairs most of that, which is why the tidied rows are closer.

## English (192 recordings)

| Recogniser | words | callsigns | points | exact | seconds per call |
|---|---|---|---|---|---|
| In the browser today (Moonshine base) | 97.6% | 95.8% | 98% | 85% | 0.42 (one thread) |
| Service, stock large-v3-turbo, no hints | 98.0% | 96.4% | 98% | 87% | 0.09 |
| **Service, stock large-v3-turbo, hints as radio traffic (what runs)** | **98.7%** | **100%** | **98%** | **92%** | **0.09** |
| Service, the Hebrew fine-tune asked for English, hints (64 recordings, on CPU) | 96.4% | 95.3% | 94% | 81% | |
| Service, the Hebrew fine-tune asked for English, no hints (64 recordings, on CPU) | 64.4% | 26.6% | 56% | 20% | |

The Hebrew fine-tune has lost much of its English, so English gets the stock model.

## Settings that were compared

- **Hints.** faster-whisper's `hotwords` and `initial_prompt` are the same mechanism for a
  short recording (both are placed before the transcript as "what was said earlier") and
  gave identical text for the same words. What matters is how the hint is written: as a
  few calls in the form the page writes them (`client/voice/hints.js`), Whisper also copies
  the spelling of numbers and the punctuation, and Hebrew exact calls rise from 76% to 91%.
  One cost seen: a noisy "Buy one vehicle squad" once came back as "Viper 1, vehicle
  squad", a callsign taken from the hint.
- **Precision.** Half precision (`float16`) and 8-bit weights with half-precision
  arithmetic (`int8_float16`) are within one recording of each other in every column and
  are equally fast.
  Both models take 4.3 GB of GPU memory in the first and 2.3 GB in the second, so the
  service runs the second. `--precision float16` brings the first back.
- **Beam.** Beam 5 and greedy decoding score the same and take the same time. Beam 5 stays.
- **Silence.** Without a voice detector Whisper wrote "תודה רבה", "Thank you." or "Over."
  for 25 of 36 recordings of hiss, hum, a fan, key clicks and tones. With the level check
  and the voice detector every one comes back empty (`make stt-quiet`), and accuracy on
  speech is unchanged.

## Speed and capacity

RTX 5070 Ti, both models loaded: a 3 to 6 second call takes 0.09 to 0.14 s (slowest of
384: 0.22 s); a 15-second recording 0.19 s; through the game server's `/stt/transcribe`,
0.10 s in all. One call at a time, so roughly 8 calls a second.

On a CPU, limited to 4 cores (`--cpus=4`, 8-bit):

| Model | seconds per call | Hebrew words | calls per minute, one at a time |
|---|---|---|---|
| ivrit.ai large-v3-turbo (the service's Hebrew model) | 4.5 | 96% (24 recordings, word-list hints) | 13 |
| stock Whisper small | 1.6 | 83%, callsigns 92% (48 recordings) | 37 |

Whisper pads every recording to 30 seconds, so a short call costs the same as a long one,
and greedy decoding does not make it faster (4.4 s). With all four cores busy for 4.5 s
per call, three or four people talking at once fill the queue, every one of them waits
five seconds or more, and the game simulation on the same cores is starved. This service
is for a machine with a GPU.

## Seen on the way: a small Hebrew model that needs no GPU

ivrit.ai now mirrors a 66-million-parameter streaming Zipformer for Hebrew
(`ivrit-ai/zipformer2-66m-streaming-he`, CC BY 4.0, by Yakov Kolani; 72 MB in 8 bits,
with ONNX files meant for browsers). On the same 192 Hebrew recordings, run with
sherpa-onnx on **one CPU thread**, no hints:

| Recogniser | words | callsigns | points | exact | seconds per call |
|---|---|---|---|---|---|
| Zipformer 66M, one CPU thread | 94.4% | 96.9% | 100% | 70% | 0.14 |

That is a little better than the in-browser model of today on this (easy) test, at less
than half its download, and fast enough that four cores could serve tens of calls a
second. It was not built into anything; it is the first thing to try for players without
this service, in the browser or on a small server.
