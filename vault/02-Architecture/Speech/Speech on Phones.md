---
title: Speech on Phones
description: "Speech works on a phone under tighter conditions than on a desktop: the microphone needs https, the recognition model is a large download, and the phone can take the microphone or the audio ..."
type: concept
status: current
tags:
  - type/concept
  - status/current
  - agent/CLD
  - origin/mixed
  - area/architecture
  - topic/speech
  - topic/mobile
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Playing in Public]]"
  - "[[Playing on a LAN]]"
  - "[[Speech Recognition]]"
  - "[[Recognition Evaluation]]"
  - "[[Text to Speech Service]]"
  - "[[Mobile Layout]]"
  - "[[Voice Pipeline (STT and TTS)]]"
  - "[[In-Browser Recognition]]"
  - "[[Service Worker and Install]]"
  - "[[Known Flaws]]"
paths:
  - client/voice/voice.js
  - client/voice/worker.js
  - client/mobile.js
  - client/sw.js
  - client/speech/speech.js
  - client/voice/server.test.mjs
  - stt/eval/RESULTS.md
  - docs/FRIEND-MATCH.md
  - server/cmd/callsign/main.go
---

# Speech on Phones

Speech works on a phone under tighter conditions than on a desktop: the microphone needs https, the recognition model is a large download, and the phone can take the microphone or the audio context away mid-match. This note gathers what the code does about each; none of it has been run on a real iPhone.

## The microphone needs https

Browsers hand out the microphone only on https or `localhost`. A phone that opens the game by a LAN address over plain http can do everything except talk.

- `client/mobile.js` adds the class `no-voice` to the talk button when `isSecureContext === false`.
- Pressing the button then reports the state `insecure`: "Voice needs https or localhost; this page was opened over plain http. Typing works."
- The https ways of running the game are in [[Playing in Public]]; the LAN way and its limits in [[Playing on a LAN]].

## Which recogniser a phone gets

The same order as everywhere ([[Speech Recognition]]): the server's service if the server offers one, else the model in the browser. The results file states the production server has no GPU, so there a phone always recognises on the device.

## The model download

| Item | Size |
|---|---|
| Hebrew model | 72 MB |
| English model | 67 MB |
| Runtime | 14 MB, once |

- **Ahead of need.** `Voice.prepare(lang)` fetches the model in the lobby with its progress shown, so the first press of the talk button does not wait (commit c0491fe).
- **Not on a paid connection.** Nothing is fetched ahead when `navigator.connection.saveData` is set or `navigator.connection.type === "cellular"`; the model then comes with the first press of the talk button. Safari does not report the connection type, so an iPhone on mobile data still fetches ahead (noted in `stt/eval/RESULTS.md`).
- **Kept.** The worker stores the files in Cache Storage under the model's version, and the service worker leaves those caches alone when the page updates (commit 3dfa29f). The results file notes that Safari clears a site's storage after seven days without a visit unless the game was added to the Home Screen.
- **Old models dropped.** `forget` in the worker deletes the 165 MB of the older Hebrew model once the newer one is in use.

## Speed

The Hebrew model reads the call while the button is held, which the code comments call "the difference between a third of a second and well over one" on a phone. The measured figures (a desktop slowed 4x and 6x to imitate a phone) are in [[Recognition Evaluation]]: Hebrew about 0.22 to 0.33 s after release, English 0.5 to 1.4 s depending on the length of the call. Threads are available where the browser has SharedArrayBuffer, because the server sends the cross-origin isolation headers.

## A sturdier microphone (commit c2d99ae)

| Problem on a phone | What `client/voice/voice.js` does |
|---|---|
| The phone took the microphone away mid-match (a call, another app, the screen going dark) and the track still looks open but gives silence | A track that is not `live` or is `muted` is stopped and asked for again on the next press |
| The audio context was suspended behind the page's back | It is created and resumed inside the press itself, and woken again before the tap is used (waits up to 400 ms) |
| The live tap depends on that audio context | With a transcribing server the call is recorded whole by `MediaRecorder`, with no tap to depend on |
| The tap handed over nothing | `noTap` is set and the next call is recorded whole |
| No audio worklet in the browser | Recordings are made whole and recognised at the end |
| The button is held too long | The recording ends at 15 s whatever the page does |

## Speaking on a phone

- Nothing plays before the first touch; the audio context is unlocked by the first `pointerdown` or `keydown`.
- When the speech service is not there the phone's own voice is used; a device with voices but no Hebrew voice skips Hebrew lines ([[Text to Speech Service]]).
- Queued speech is dropped when the connection closes (commit 51bea0c).
- The radio is muted while the talk button is held, and the music with it.

## Layout

The phone layout has a large push-to-talk button; large touch screens get the same layout with a bigger talk button on the right (commits b8f7e67, 90f26df). The context menu on the button is suppressed so a long press does not open it. See [[Mobile Layout]].

## Not verified

- Behaviour on a real iPhone or Android phone: the results file says no phone was available, and the live path "has never run on an iPhone".
- Memory limits of phone browsers (iOS closes a tab that takes too much; no figure is recorded).

## Related

- [[Voice Pipeline (STT and TTS)]]
- [[Speech Recognition]]
- [[In-Browser Recognition]]
- [[Recognition Evaluation]]
- [[Mobile Layout]]
- [[Service Worker and Install]]
- [[Playing in Public]]
- [[Playing on a LAN]]
- [[Known Flaws]]
