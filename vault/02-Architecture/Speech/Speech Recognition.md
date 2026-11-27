---
title: Speech Recognition
description: "The player holds the talk button, speaks a radio call, and the page turns the recording into text, tidies it and transmits it at once."
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
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Server Whisper]]"
  - "[[In-Browser Recognition]]"
  - "[[Recognition Evaluation]]"
  - "[[Hints and Tidy Step]]"
  - "[[Procedure Words]]"
  - "[[Voice Pipeline (STT and TTS)]]"
  - "[[Speech on Phones]]"
  - "[[Radio Console]]"
  - "[[Selection and Map Orders]]"
  - "[[Radio Routing]]"
paths:
  - client/voice/voice.js
  - client/voice/worker.js
  - client/voice/tap.js
  - client/voice/resample.js
  - client/debug.js
  - server/room/listen.go
  - server/room/room.go
  - client/i18n/en.json
---

# Speech Recognition

The player holds the talk button, speaks a radio call, and the page turns the recording into text, tidies it and transmits it at once. The text comes from the game server's listening service when the server offers one, and otherwise from a model running in the player's own browser.

## Paths, in order of preference

| Order | Recogniser | When it is used | Audio leaves the device? |
|---|---|---|---|
| 1 | The game server's Whisper service, [[Server Whisper]] | `/api/server` reports `stt: true` and the page holds a commander's seat (`voice.useServer`) | Yes, to the game server; transcribed and not kept |
| 2 | Hebrew: streaming Zipformer2 in the browser | No server service, or it failed, was slow (over 6 s) or refused | No |
| 2 | English: Moonshine base in the browser | Same | No |
| 3 | Hebrew: Ozen-v1 in the browser (older) | Only where the Zipformer files are not on the server (`fallback` in `client/voice/models.json`) | No |

Details of the browser models: [[In-Browser Recognition]]. The browser's built-in Web Speech API is not wired in; it was only looked up ([[Recognition Evaluation]]).

When the server fails with anything but HTTP 429, the page leaves it alone for 60 s (`SERVER_REST`) and recognises in the browser meanwhile.

## Push-to-talk flow (`client/debug.js`, `client/voice/voice.js`)

1. **Press** (`talk()`): the button `#ptt`, or the `` ` `` key on a keyboard. The music is muted, the radio voices are cut (`speech.key(true)`), and `voice.start(lang, { phrases })` runs with the net's names from `hintPhrases`.
2. **Microphone**: `getUserMedia` with one channel, echo cancellation and noise suppression off, automatic gain on. A track that is no longer live or is muted is asked for again.
3. **Recording**: with no transcribing server, an audio worklet (`tap.js`, processor `callsign-tap`) hands samples to the page about 2048 at a time; `resample.js` brings them to 16 kHz and each piece goes straight to the worker (`begin` / `audio` / `end` messages). With a transcribing server, or where the worklet is unavailable, the browser's `MediaRecorder` makes the recording whole and it is decoded at the end.
4. **Release** (`talkEnd()`): `voice.stop(lang, openers, hints)` ends the recording. A recording under 0.4 s or with no sample above 0.01 is "nothing". Otherwise it goes to the server (`POST /stt/transcribe` as 16-bit samples, with the seat token in `X-Callsign-Seat`) or the worker is told the live recording is over.
5. **Tidy**: `tidy(text, { lang, rules, careful })` repairs callsigns and map points; `careful` is set when the server transcribed, because it spells well. See [[Hints and Tidy Step]].
6. **Selected squad**: if the call names nobody and a squad is selected on the map, the page puts "<squad>, this is <player>" in front.
7. **Send**: spoken calls go out at once (commit 350e1c0); the log shows what was sent, and Up in the radio box brings it back to fix and resend.

Limits in `voice.js`: longest recording 15 s (`MAX_SECONDS`; the recording ends there whatever the player does), sample rate 16 kHz.

## States shown to the player

`onState` reports: `idle`, `asking` (for the microphone), `loading { percent }`, `listening { text? }` (with the streaming model, the text so far), `working`, and the ways it stops: `unsupported`, `insecure` (page not on https or localhost), `denied`, `missing` (models not on this server: "Run: make voice-models"), `nothing`, `failed`. The button's tooltip says where the recording goes: recognised on this device, or sent to the game's own server and not kept (`voiceHint`, `voiceHint.server`).

## Live recognition while speaking

Commit df32a7e made push-to-talk hand the recording to the recogniser while it is spoken. Only the Hebrew Zipformer can read as it listens: by the time the button is let go it has read all but the last second, and the status line shows the call growing. Moonshine gets the same samples and starts at the end.

## Radio strictness

How closely the player is held to procedure is the player's choice (`#strict`, stored as `callsign.strict`, default 1), sent with every radio frame and enforced by the server in `Room.SayAt` (`server/room/room.go`):

| Level | Name | Server rule | Page behaviour |
|---|---|---|---|
| 1 | Relaxed | A callsign and the order are enough ("Viper 1 attack Delta"); a message with no callsign goes to the operator | The radio box is tidied before sending; typed text only has a misspelled callsign at its front put right |
| 2 | Standard | The call is required ("Viper 1, this is Hammer. ..."), else `ErrNoCall` | Box text is sent as written |
| 3 | Strict | The call and a closing Over or Out are required, else `ErrNoEnding` | Box text is sent as written |

A spoken call is always tidied before it is put in the box, at every level. Agents always transmit through the radio tool, which writes proper procedure itself. See [[Procedure Words]].

## Related

- [[Voice Pipeline (STT and TTS)]]
- [[Server Whisper]]
- [[In-Browser Recognition]]
- [[Hints and Tidy Step]]
- [[Recognition Evaluation]]
- [[Speech on Phones]]
- [[Radio Console]]
- [[Selection and Map Orders]]
- [[Radio Routing]]
- [[Seats, Tokens and Trust]]
