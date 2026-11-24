# The listening service: what it is made of, and under which licence

`stt/server.py` transcribes the players' spoken radio calls on the game machine's own GPU.
It is optional. A game server started without `-stt` does not offer it, and the page then
recognises speech in the browser (`client/voice/`), as it does whenever this service fails
or is slow. Nothing here is committed to the repository except the code: the image is built
by `make stt-image` and the weights are fetched by `make stt-models` into
`assets/models/whisper-he/` and `assets/models/whisper-en/` (git-ignored), from the pinned
revisions in `stt/models.json`, checked by SHA-256.

| What | Source | Licence | Notes |
|---|---|---|---|
| Hebrew model | [ivrit-ai/whisper-large-v3-turbo-ct2](https://huggingface.co/ivrit-ai/whisper-large-v3-turbo-ct2) @ `72ad623a`, 1.6 GB | Apache-2.0 (model card) | ivrit.ai's fine-tune of openai/whisper-large-v3-turbo, in CTranslate2 form. Trained on ivrit.ai's crowd-transcribed and professionally transcribed Hebrew speech. Commercial use, hosting and modification are allowed; keep the licence and attribution. Thanks to [ivrit.ai](https://www.ivrit.ai/). |
| English model | [dropbox-dash/faster-whisper-large-v3-turbo](https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo) @ `0a363e91`, 1.6 GB | MIT | openai/whisper-large-v3-turbo (MIT, Copyright (c) 2022 OpenAI) converted to CTranslate2, half precision. This is the repository faster-whisper itself names `large-v3-turbo` (formerly `mobiuslabsgmbh/…`). |
| Inference | [faster-whisper](https://github.com/SYSTRAN/faster-whisper) 1.2.1, [CTranslate2](https://github.com/OpenNMT/CTranslate2) 4.9.1 | MIT | |
| Voice detector | Silero VAD, the ONNX file shipped inside faster-whisper | MIT | Runs on the CPU with ONNX Runtime (MIT). |
| GPU libraries | `nvidia-cublas-cu12` 12.9.3.13, `nvidia-cudnn-cu12` 9.28.1.4 (pip) | NVIDIA Software License Agreement (proprietary, redistributable inside an application) | Only inside the local image, which is not published. Read the agreement before publishing an image that contains them. |
| Web server and arrays | aiohttp, NumPy | Apache-2.0 / BSD | |

The service loads both models with 8-bit weights and half-precision arithmetic: 2.3 GB of
GPU memory, against 4.3 GB in plain half precision, with the same accuracy and speed
(`stt/eval/RESULTS.md`). If the GPU is full when it starts it runs on the CPU, slowly, and
moves to the GPU by itself once there is room.

## What happens to a recording

The page sends it to the game server, which passes it on only for a commander who holds a
seat in a live match. The service holds it in memory for the length of the request. It is
never written to disk and never logged; the log has only its length, its language and the
time taken. The container has no route to the internet.

## Why this is not for a server without a GPU

Whisper reads every recording as a 30-second window, so a 5-second call costs the same as
a 30-second one. On this machine's GPU that is a fraction of a second. On a CPU it is
seconds of all cores for every call, one call at a time: the measurements are in
`stt/eval/RESULTS.md`. A public server with a few cores and many players should not run
this service; its players use the recogniser in their own browsers.
