// The speech worker. It owns ONNX Runtime and the recognisers, so the page only hands it
// samples and gets text back, and the map never waits on it.
//
//   in:  { type: "load", lang }                      warm a language's model
//        { type: "transcribe", id, lang, audio, openers }     audio: Float32Array, 16 kHz mono
//   out: { type: "progress", lang, loaded, total }
//        { type: "ready", lang, ms, threads }
//        { type: "missing", lang }                   the files are not on this server
//        { type: "result", id, text, ms }
//        { type: "error", id?, lang?, message }

import { Recognizer, isNoise } from "./engine.js";
import { parseMelFilters } from "./mel.js";
import { Tokenizer } from "./tokenizer.js";

const here = (path) => new URL(path, import.meta.url).href;
const post = (m) => self.postMessage(m);

class Missing extends Error {}

let shared = null; // the manifest, the runtime and the mel filters, loaded once
const recognisers = new Map(); // lang → Promise<Recognizer>

async function common() {
  const manifest = await (await fetch(here("models.json"))).json();
  let ort;
  try {
    ort = await import(here("../vendor/ort/ort.wasm.min.mjs"));
  } catch {
    throw new Missing("runtime");
  }
  ort.env.wasm.wasmPaths = here("../vendor/ort/");
  // Threads need a cross-origin isolated page; the game server sends the headers for it.
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  ort.env.logLevel = "error";
  const melFilters = parseMelFilters(await (await fetch(here("mel_filters.bin"))).arrayBuffer());
  return { manifest, ort, melFilters };
}

// file returns a model file's bytes: from the browser's cache when it is there, else from
// the server, checked against the manifest before it is kept.
async function file(cache, url, want, onBytes) {
  const hit = await cache?.match(url);
  if (hit) {
    const bytes = new Uint8Array(await hit.arrayBuffer());
    if (bytes.length === want.bytes) {
      onBytes(bytes.length);
      return bytes;
    }
    await cache.delete(url);
  }
  const res = await fetch(url);
  if (res.status === 404) throw new Missing(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bytes = new Uint8Array(want.bytes);
  let n = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (n + value.length > want.bytes) throw new Error(`${url} is larger than models.json says`);
    bytes.set(value, n);
    n += value.length;
    onBytes(value.length);
  }
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (n !== want.bytes || digest !== want.sha256) throw new Error(`${url} does not match models.json; run make voice-models again`);
  // A full cache is not a failure: the file is simply fetched again next time.
  await cache?.put(url, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } })).catch(() => {});
  return bytes;
}

async function load(lang) {
  const t0 = performance.now();
  shared ??= common().catch((err) => {
    shared = null;
    throw err;
  });
  const { manifest, ort, melFilters } = await shared;
  const spec = manifest.models[lang];
  if (!spec) throw new Error(`no speech model for "${lang}"`);
  const cache = await self.caches?.open(`callsign-voice-${spec.dir}-${spec.revision.slice(0, 8)}`).catch(() => null);
  const total = Object.values(spec.files).reduce((n, f) => n + f.bytes, 0);
  let loaded = 0;
  const got = {};
  for (const [key, want] of Object.entries(spec.files)) {
    got[key] = await file(cache, `/assets/models/${spec.dir}/${want.path}`, want, (n) => post({ type: "progress", lang, loaded: (loaded += n), total }));
  }
  const options = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };
  const encoder = await ort.InferenceSession.create(got.encoder, options);
  const decoder = await ort.InferenceSession.create(got.decoder, options);
  const tokenizer = new Tokenizer(JSON.parse(new TextDecoder().decode(got.tokenizer)), spec.tokenizer);
  post({ type: "ready", lang, ms: Math.round(performance.now() - t0), threads: ort.env.wasm.numThreads });
  return new Recognizer({ ort, encoder, decoder, tokenizer, spec, melFilters });
}

function recogniser(lang) {
  if (!recognisers.has(lang)) {
    recognisers.set(
      lang,
      load(lang).catch((err) => {
        recognisers.delete(lang);
        throw err;
      }),
    );
  }
  return recognisers.get(lang);
}

const fail = (err, extra) => post(err instanceof Missing ? { type: "missing", ...extra } : { type: "error", message: err?.message ?? String(err), ...extra });

// One utterance at a time: the runtime does not run two sessions at once.
let queue = Promise.resolve();

self.addEventListener("message", ({ data }) => {
  if (data.type === "load") {
    recogniser(data.lang).catch((err) => fail(err, { lang: data.lang }));
  } else if (data.type === "transcribe") {
    queue = queue.then(async () => {
      try {
        const r = await recogniser(data.lang);
        const t0 = performance.now();
        const text = await r.transcribe(data.audio, { openers: data.openers ?? [] });
        post({ type: "result", id: data.id, text: isNoise(text) ? "" : text, ms: Math.round(performance.now() - t0) });
      } catch (err) {
        fail(err, { id: data.id, lang: data.lang });
      }
    });
  }
});
