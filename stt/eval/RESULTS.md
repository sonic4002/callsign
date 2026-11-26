# Listening: what was measured (2026-11-24, and in the browser on 2026-11-26)

Run again with `make stt-eval` (needs `make play` running with the radio voices).
The recognisers in the browser, which are all a player has on a server without a GPU,
are measured at the end: "In the browser, without the service".

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
| In the browser until 2026-11-26 (Ozen-v1, with its callsign openers) | 92.1% | 91.7% | 100% | 64% | 6.0 (one thread, outside a browser) |
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

## In the browser, without the service (2026-11-26)

The production server has four CPU cores and no GPU, so it will not run the service
above, and every player's speech is then recognised in their own browser. That path was
measured on its own, and the Hebrew model was replaced.

### How it was measured

- The recordings were made again on 2026-11-26 (`stt/eval/make.py`; the files of the 24th
  were gone), so the numbers of the model that was there before differ a little from the
  table further up. Everything in this section is from the same 384 files.
- **In a browser:** `node stt/eval/chrome.mjs` starts headless Chrome (157, muted, its own
  profile, deleted afterwards), serves this checkout to it on a local port with the game
  server's headers, and talks to the page's own speech worker (`client/voice/worker.js`)
  as the page does. `--mic` goes further: Chrome plays each recording as its microphone
  and `client/voice/voice.js` holds the talk button for as long as it lasts.
  `stt/eval/browser.mjs` runs the same recogniser code in Node on one thread; its text is
  the same as Chrome's but for a recording or two (arithmetic differs slightly between
  one thread and four), and it is the quick way to compare settings.
- **A phone was imitated, not used.** No phone was available. Chrome's CPU throttling
  (`Emulation.setCPUThrottlingRate`) slows a page's main thread only; a worker runs at
  full speed whatever the rate (measured: 127 ms at 1x, 4x and 6x). So for the slowed
  rows the worker's code is run on the page's main thread (`--main`) with one WebAssembly
  thread (`--no-isolation`), which is also what a browser without threads would do. The
  desktop is a Ryzen 9 9950X3D, one of the fastest cores there is: slowed four times it
  is roughly a good phone of today, slowed six times a middling one, and a cheap phone
  is slower than either. Read the slowed rows as "about", not as a promise.
- **order** is the column that matters: the recordings in which the order would be
  understood after tidying (every callsign with its number, every map point, and what to
  do as the rule brain's grammar reads it; `score.mjs` has the exact rule).

### What was measured (192 recordings a language, after tidying)

| Hebrew recogniser | order | words | callsigns | points | exact | download | licence |
|---|---|---|---|---|---|---|---|
| Ozen-v1 (what ran until now) | 79.2% | 91.7% | 94.3% | 97% | 61% | 165 MB | Apache-2.0 |
| Zipformer2 66M streaming, told nothing | 82.8% | 94.5% | 96.9% | 98% | 69% | 72 MB | CC BY 4.0 |
| **The same, told the net's names (what runs now)** | **90.1%** | **95.3%** | **99.5%** | **100%** | **74%** | **72 MB** | CC BY 4.0 |

| English recogniser | order | words | callsigns | points | exact | download | licence |
|---|---|---|---|---|---|---|---|
| **Moonshine base (what ran, and still runs)** | **91.1%** | **97.9%** | **97.4%** | **98%** | **85%** | **67 MB** | MIT |
| Zipformer 66M streaming, English (2023-06-26), told nothing | 74.5% | 92.4% | 88.0% | 93% | 62% | 73 MB | Apache-2.0 |
| The same with hot words | 83.9% | 95.3% | 93.8% | 98% | 72% | 73 MB | Apache-2.0 |
| Zipformer 20M streaming, English (2023-02-17), told nothing | 12.0% | 76.0% | 14.6% | 89% | 11% | 44 MB | Apache-2.0 |
| The same with hot words | 42.2% | 85.6% | 49.5% | 97% | 30% | 44 MB | Apache-2.0 |

The Hebrew and Moonshine rows are from Chrome; the English Zipformers were run with
sherpa-onnx itself (Python, one thread, its own hot-word search at score 2), which is the
best they can do, and were not built into the page. The English row for Moonshine was
88.0% before the tidying learned to read "Viper, too, hold Delta" (see below); nothing
else about English changed. Every model here also needs the runtime once: onnxruntime-web,
14 MB, MIT.

Time from letting go of the button to the text, median, in seconds:

| | Zipformer he, live | Zipformer he, whole | Ozen-v1 | Moonshine en |
|---|---|---|---|---|
| Worker, 4 threads (a desktop today), calls of 4.4 s | 0.12 | 0.12 | 1.30 | 0.11 |
| Worker, 1 thread, calls of 4.7 s | | 0.23 | 4.49 | 0.23 |
| Main thread, 1 thread, 1x, calls of 3 s | 0.06 | 0.17 | | 0.13 |
| The same slowed 4x | **0.22** | 0.70 | | 0.54 |
| The same slowed 6x | 0.34 | 1.02 | | 0.78 |
| Main thread, 1 thread, 1x, calls of 4.7 s | 0.06 | 0.24 | 4.42 | 0.24 |
| The same slowed 4x | 0.22 | 0.92 | 30.1 | 0.92 |
| The same slowed 6x | 0.33 | 1.36 | not run | 1.39 |

"Live" is the recording handed to the recogniser while it is being made, at the speed of
speech, which is what the page now does; "whole" is the recording handed over at its end.
The first row's "live" was not paced, so it is the same as "whole". Starting a model that
is already on the machine (reading it, checking its SHA-256, building the sessions) took
0.9 s at 1x, 3.4 s slowed 4x and 5.0 s slowed 6x for the Zipformer, and 0.75 / 2.7 /
3.9 s for Moonshine; it happens once a visit, during the first call or before it.

Memory, the tab's process in desktop Chrome (128 MB with an empty page): the Zipformer
peaks at about 500 MB with four threads and settles near 370 MB with one; Ozen-v1 peaked
at 880 to 1000 MB; Moonshine peaks at 550 to 610 MB. So a recogniser costs a tab roughly
250 to 400 MB while it is loaded. A phone's browser was not measured; iOS in particular
closes a tab that takes too much, and there is no published limit to plan against.

### What was changed, and why

- **Hebrew: the Zipformer.** `ivrit-ai/zipformer2-66m-streaming-he` (Yakov Kolani's
  model, mirrored by ivrit.ai, CC BY 4.0) in its 8-bit sherpa-onnx export. It is run on
  the ONNX Runtime the page already had, not on sherpa-onnx's own WebAssembly build: that
  would be a second runtime to download, its hot words need the model's tokenizer, and the
  page's tests could not run it. `client/voice/fbank.js` computes Kaldi's features (equal
  to kaldi-native-fbank to 0.0002 on every value) and `transducer.js` does the streaming
  and the search. sherpa-onnx itself with the same files, told nothing, wrote the same
  text but for a few recordings in 192 (it pads the end of a recording differently).
- **Told what to expect.** The callsigns, this map's points and the procedure words
  (`hints.js`, `hintPhrases`) earn a bonus of 1.5 per letter, for the first four letters
  of each word, while the search (beam 4) is spelling them, and lose it again if the word
  turns out to be another. Without it the callsign comes out right in half the Hebrew
  recordings before tidying ("צפה אחד", "ספר אחד"); with it in nearly all. The bonus was
  tried from 0.5 to 3: 1 to 2 score alike, 3 starts to write names that were not said.
  It is set on these synthetic recordings, which is a weakness: real voices may want
  less or more.
- **Live.** With audio worklets (every current browser) the microphone's samples go to
  the worker while the button is held (`tap.js`, `resample.js`), so the Zipformer has read
  all but the last second by the time the button is let go, and the status line shows what
  it has written so far. Without them the recording is made whole, as before. Moonshine
  cannot read as it listens; it gets the same samples and starts at the end.
- **English: nothing to change.** Both English Zipformers are worse than Moonshine on
  these calls, hot words or not, and Moonshine is fast enough (0.5 s slowed 4x).
- **Tidying.** "Viper, too, hold Delta" is read as Viper 2 (six English recordings); a
  closing word written twice is one; the rule brain takes "נעו" for "נועו".
- **Silence and noise.** Thirty recordings of hiss, hum, a fan, clicks and a tone, each
  at three levels, with and without the phrases: the Zipformer wrote nothing for 28 and
  "אממ" for the loudest hum. The phrase bonus did not make it write a callsign into noise.
- **Not tried:** recording levels (the browser's own gain control is on), a voice
  detector in front (the Zipformer does not need one for silence, and the level check
  stays), and the larger Hebrew models (`thewh1teagle/parakeet-tdt-0.6b-v3-he` and the
  Whisper fine-tunes are 600 MB and more, too much for a phone).

### On a phone

- **Download.** 72 MB for Hebrew or 67 MB for English, plus 14 MB of runtime, once: the
  worker keeps them in the browser's Cache Storage under the model's version, and the
  service worker no longer deletes those caches when the page is updated (it did, so
  every new version of the page made every player download the model again). On mobile
  data (where the browser says so: Chrome on Android) or with data saving on, nothing is
  fetched ahead in the lobby; the model comes with the first press of the talk button.
  Safari does not say what kind of connection it is on, so an iPhone on mobile data still
  fetches ahead. Safari also clears a site's storage after seven days without a visit
  unless the game was added to the Home Screen; the model is then fetched again.
- **Threads.** The game server sends `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` on everything, so the page is cross-origin
  isolated and the runtime gets up to four threads wherever the browser has
  SharedArrayBuffer (Safari on iOS from 15.2, Chrome on Android). The slowed rows above
  assume it gets none, which is the worst case; with threads a phone does better.
- **What to expect.** A Hebrew call is on the screen about a quarter of a second after
  the button is let go on a good phone and a third on a middling one, if the phone keeps
  up with speech while the button is held (it has to do 1.28 s of audio in under 1.28 s:
  slowed 6x that took 0.29 s). English, which waits for the end, takes half a second to
  one second for a short call.

### The browser's own recognition (Web Speech API): looked up, not wired in

It could not be measured: headless Chrome has no recogniser behind it, and no phone was
at hand. From the browsers' own documentation (2026-11-26):

- **Where it exists.** Chrome on desktop and Android (`webkitSpeechRecognition`, and
  unprefixed from 139), Safari from 14.1 / iOS 14.5 (prefixed), Edge on desktop (uneven,
  by Microsoft's own account). Firefox 160 has it on desktop only and only with its
  on-device models. **Not in a web app added to the iPhone's Home Screen**, and not in
  Chrome or Edge on iOS (WebKit bugs 225298 and 239816), which matters for a game that is
  meant to be installed.
- **Hebrew.** Chrome's recogniser takes `he-IL` (Chrome's own article names it), Azure
  lists it for Edge, and Apple lists Hebrew for dictation, which is what Safari uses and
  which must be switched on in the phone's settings. None of this was tested here.
- **Where the audio goes.** To Google from Chrome, to Microsoft from Edge, to Apple from
  Safari unless the phone can do that language itself. Chrome's on-device mode (139,
  desktop only) has no Hebrew, and neither has Edge's.
- **No names.** The only way to tell it what to expect (`phrases`, Chrome 142) works on
  desktop with the on-device models, so not for Hebrew and not on a phone. Callsigns and
  map points would rest on the tidying alone.
- **Push-to-talk.** `start()` on press and `stop()` on release is what the API is for,
  and `stop()` returns what was heard so far; whether a result reliably comes back for a
  two-second call, whether Chrome on Android beeps at each start, and whether it clashes
  with the page's own microphone and sounds are not documented and need a phone.

With a Hebrew call now recognised on the device in a third of a second, the reasons to
add it are a cold start with no 72 MB download and, perhaps, better Hebrew for real
voices. If it is added it should be a setting the player turns on, worded to say that the
recording goes to Google or Apple, never a default, and tried on real phones first.

### Known weaknesses

- Synthetic voices only. The first recordings of real players should be added to this
  set, and the phrase bonus and the tidying checked against them.
- The slowed rows imitate a phone's speed, not its memory, its browser or its microphone.
  The live path (audio worklet, resampling from 48 kHz) was run end to end in desktop
  Chrome with each recording as the microphone (`chrome.mjs --mic`: all 384 were handed
  over live, and the order was understood in 91.7% of the Hebrew ones and 94.3% of the
  English ones, no worse than the worker fed the files directly; the Hebrew pass was made
  just before the search learned that a comma ends a word, which moved two recordings).
  It was also tried on the game's own page from a private server, where the status line
  showed the Hebrew call growing while the key was held. It has never run on an iPhone.
- Hebrew words the speech service mispronounces still fail the same way ("נועו" read as
  "נעול ה…", "רות" swallowed): 17 of the 19 Hebrew recordings whose order is still lost
  are those two words.
- The Hebrew model's licence (CC BY 4.0) allows commercial use and requires credit. The
  credit is in `client/voice/NOTICE.md`; the game itself shows none yet.
