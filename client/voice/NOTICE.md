# Voice input: what it is made of

Push-to-talk speech recognition that runs in the player's browser. With these recognisers no audio
leaves the device. A game server that has its own listening service (`stt/`, see `stt/NOTICE.md`)
is used first instead: the recording is then sent to that server, transcribed and not kept, and
the recognisers here are the fallback.

| Part | Source | Licence |
|---|---|---|
| Hebrew recogniser | [ivrit-ai/zipformer2-66m-streaming-he](https://huggingface.co/ivrit-ai/zipformer2-66m-streaming-he), revision `ee769a2a`, the 8-bit sherpa-onnx export, 72 MB. A streaming Zipformer2 transducer (66M parameters) by Yakov Kolani ([thewh1teagle/zipformer2-66m-streaming-he](https://huggingface.co/thewh1teagle/zipformer2-66m-streaming-he)), mirrored by ivrit.ai; used unchanged | CC BY 4.0 |
| Hebrew recogniser, older, used only where the first is not on the server (`make voice-models ALL=1`) | [itayinbar/Ozen-v1](https://huggingface.co/itayinbar/Ozen-v1), revision `82aae03d`, fp16 encoder + fp32 decoder, 165 MB | Apache-2.0 |
| English recogniser | [onnx-community/moonshine-base-ONNX](https://huggingface.co/onnx-community/moonshine-base-ONNX), revision `b1e9b6aa`, 8-bit encoder and decoder, 67 MB (model by Useful Sensors) | MIT |
| Runtime | [onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web) 1.30.0, WebAssembly build, 14 MB | MIT, Copyright (c) Microsoft Corporation |
| `fft.js`, `mel.js`, the byte tokenizer in `tokenizer.js`, the decoder loop in `engine.js`, `mel_filters.bin`, `testdata/sample-he.wav` | ported or copied from the [Ozen web app](https://github.com/itayinbarr/ozen) | MIT, Copyright (c) 2026 Itay Inbar |
| `fbank.js`, `transducer.js`, `resample.js`, `tap.js` | written for this game. The features follow kaldi-native-fbank and the search follows the transducer decoding of [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) and [icefall](https://github.com/k2-fsa/icefall) (both Apache-2.0) in method; no code of theirs is included | the game's own |

The Hebrew recogniser is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/),
which allows commercial use and asks for credit: it is the work of Yakov Kolani, fine-tuned from
[icefall's English streaming Zipformer](https://huggingface.co/Zengwei/icefall-asr-librispeech-streaming-zipformer-2023-05-17)
(Apache-2.0) on audio from [ivrit.ai](https://www.ivrit.ai/) under the
[ivrit.ai licence](https://www.ivrit.ai/en/the-license/), which also asks for attribution: thanks to both.

Ozen-v1 was distilled from ivrit.ai's Whisper fine-tune and trained on ivrit.ai audio under the same
ivrit.ai licence. Its base model is openai/whisper-base (MIT, Copyright (c) 2022 OpenAI).

Why these, and what else was measured (the English Zipformers, the browser's own recognition):
`stt/eval/RESULTS.md`.

The weights and the runtime are not in the repository. `make voice-models` downloads them into
`assets/models/` and `client/vendor/ort/` from the pinned versions in `models.json` and checks
every file's SHA-256.

## MIT notice for the ported code

Copyright (c) 2026 Itay Inbar

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
