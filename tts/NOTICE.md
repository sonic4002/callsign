# Radio voices: what is used and under which licence

The speech service (`tts/server.py`) is a test rig for this machine. It is not part of the
shipped game: the plan is to pre-record the fixed radio phrases and serve them as files.
Nothing here is committed to the repository except the code and the pronunciation table;
the image is built by `make tts-image` and the weights are fetched by `make tts-models`
into `assets/models/bluev3/` (git-ignored), from the pinned revisions in `tts/models.json`.

| What | Source | Licence | Notes |
|---|---|---|---|
| Speech model (text encoder, flow, duration predictor) | BlueTTS "BlueV3", Hugging Face `notmax123/BlueV3-onnx` @ `8410bbfe` | MIT | Hebrew and English from one model. |
| Vocoder (`onnx/vocoder.onnx`) | same bundle; fine-tuned from the Supertonic-3 vocoder (Supertone Inc.) | BigScience OpenRAIL-M | Commercial use is allowed, with the use-based restrictions of that licence. The text is fetched as `assets/models/bluev3/LICENSE.OpenRAIL-M`. Read it before a public release. |
| Voices (`voices/*.json`, 15) | same bundle; style tokens computed from LibriTTS-R speakers | CC BY 4.0 | Attribution required: Y. Koizumi et al., "LibriTTS-R: A Restored Multi-Speaker Text-to-Speech Corpus", Interspeech 2023. The files hold encoder outputs, not recordings. |
| Hebrew reader (text to phonemes) | RenikudPlus, Hugging Face `notmax123/RenikudPlus` @ `679c56ca`, the 8-bit weights | Apache-2.0 | 312 MB. The full-precision weights (1.2 GB) score the same within half a point on the model card. |
| English reader | polyg2p 0.1.0 wheel and `en.*` data from the BlueV3 bundle | Apache-2.0; data derived from the CMU Pronouncing Dictionary (BSD-style, notice in `frontend/polyg2p_data/NOTICE`) | Contains no eSpeak NG code or data. |
| Inference code | `blue-onnx` from github.com/maxmelichov/BlueTTS @ `5a9d9a04`, `renikud-plus` 0.5.0, `heb-tts-normalizer` 0.2.0 | MIT | Installed in the image. |
| Hebrew number words | `hebrew-num2words` 0.1.0 | Apache-2.0 | |
| Runtime | ONNX Runtime (CPU), NumPy, SciPy, aiohttp | MIT / BSD / Apache-2.0 | Already in the `callsign-art` base image. |

`blue-onnx` also pulls in `phonemizer-fork` and `espeakng-loader` (eSpeak NG, GPL-3.0) as
dependencies. The BlueV3 bundle does not use them, and they are only inside the local test
image. They must not be carried into anything that ships.

The radio effect (`client/speech/radio.js`) is our own: filters, a soft clipper and
generated noise in Web Audio. No recorded sound effects are used.
