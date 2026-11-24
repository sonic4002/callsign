# Third-party code the page loads

Nothing here is fetched from a CDN at run time; the game server serves it.

| Directory | What | Version | Licence | How it gets here |
|---|---|---|---|---|
| `ort/` | onnxruntime-web, WebAssembly build (`ort.wasm.min.mjs`, `ort-wasm-simd-threaded.mjs`, `ort-wasm-simd-threaded.wasm`) | 1.30.0 | MIT, Copyright (c) Microsoft Corporation | `make voice-models`; not committed (14 MB). File sizes and SHA-256 are pinned in `client/voice/models.json`. |
