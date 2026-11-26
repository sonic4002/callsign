// The speech worker. It owns ONNX Runtime and the recognisers, so the page only hands it
// samples and gets text back, and the map never waits on it.
//
//   in:  { type: "load", lang }                      warm a language's model
//        { type: "transcribe", id, lang, audio, openers, phrases }   audio: Float32Array, 16 kHz mono
//        a recording sent as it is made, so that most of the work is done by its end:
//        { type: "begin", id, lang, phrases }, { type: "audio", id, samples }, { type: "end", id, openers }
//        { type: "cancel", id }
//   out: { type: "progress", lang, loaded, total }
//        { type: "ready", lang, ms, threads, model }
//        { type: "missing", lang }                   the files are not on this server
//        { type: "partial", id, text }               what a streaming model has written so far
//        { type: "result", id, text, ms }
//        { type: "error", id?, lang?, message }
//
// openers are the callsigns a call can start with (for the models of engine.js); phrases
// are the net's names and words (for the streaming model of transducer.js).

import { Recognizer, isNoise } from "./engine.js";
import { parseMelFilters } from "./mel.js";
import { Tokenizer } from "./tokenizer.js";
import { Transducer } from "./transducer.js";

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

// Each model's files are kept by the browser in a cache of their own, named for the model
// and its version, so they are downloaded once. The page's service worker leaves these alone.
const cacheName = (spec) => `callsign-voice-${spec.dir}-${spec.revision.slice(0, 8)}`;

// forget drops the kept files of models this page no longer uses: an older version, or a
// model that has since been replaced (the 165 MB of the older Hebrew one, on a phone).
// `using` is the model just started, which stays whatever it is.
function forget(manifest, using) {
  const wanted = new Set([using, ...Object.values(manifest.models).filter((m) => !m.optional)].map(cacheName));
  self.caches
    ?.keys()
    .then((names) => Promise.all(names.filter((name) => name.startsWith("callsign-voice-") && !wanted.has(name)).map((name) => self.caches.delete(name))))
    .catch(() => {});
}

// load fetches and starts the model for a language. When this server does not have its
// files and models.json names another to use instead (`fallback`), that one is loaded.
async function load(lang, key = lang) {
  const t0 = performance.now();
  shared ??= common().catch((err) => {
    shared = null;
    throw err;
  });
  const { manifest, ort, melFilters } = await shared;
  const spec = manifest.models[key];
  if (!spec) throw new Error(`no speech model for "${lang}"`);
  const cache = await self.caches?.open(cacheName(spec)).catch(() => null);
  const total = Object.values(spec.files).reduce((n, f) => n + f.bytes, 0);
  let loaded = 0;
  const got = {};
  try {
    for (const [name, want] of Object.entries(spec.files)) {
      got[name] = await file(cache, `/assets/models/${spec.dir}/${want.path}`, want, (n) => post({ type: "progress", lang, loaded: (loaded += n), total }));
    }
  } catch (err) {
    if (err instanceof Missing && spec.fallback) return load(lang, spec.fallback);
    throw err;
  }
  const options = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };
  const session = (bytes) => ort.InferenceSession.create(bytes, options);
  const text = (bytes) => new TextDecoder().decode(bytes);
  let model;
  if (spec.kind === "transducer") {
    model = new Transducer({ ort, encoder: await session(got.encoder), decoder: await session(got.decoder), joiner: await session(got.joiner), tokens: text(got.tokens), spec });
  } else {
    const tokenizer = new Tokenizer(JSON.parse(text(got.tokenizer)), spec.tokenizer);
    model = new Recognizer({ ort, encoder: await session(got.encoder), decoder: await session(got.decoder), tokenizer, spec, melFilters });
  }
  post({ type: "ready", lang, ms: Math.round(performance.now() - t0), threads: ort.env.wasm.numThreads, model: spec.dir });
  forget(manifest, spec);
  return model;
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

// One thing at a time, in the order asked: the runtime does not run two sessions at once.
let queue = Promise.resolve();
const live = new Map(); // id of a recording being sent → { lang, stream, chunks, said } or { failed }

const done = (id, text, t0) => post({ type: "result", id, text: isNoise(text) ? "" : text, ms: Math.round(performance.now() - t0) });

function joined(chunks) {
  const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  return all;
}

const handlers = {
  async transcribe(data) {
    const r = await recogniser(data.lang);
    const t0 = performance.now();
    done(data.id, await r.transcribe(data.audio, { openers: data.openers ?? [], phrases: data.phrases ?? [] }), t0);
  },
  async begin(data) {
    try {
      const r = await recogniser(data.lang);
      // A streaming model starts writing now; the others get the whole recording at its end.
      live.set(data.id, { lang: data.lang, stream: r.stream?.({ phrases: data.phrases ?? [] }), chunks: [], said: "" });
    } catch (failed) {
      live.set(data.id, { failed }); // said when the recording ends
    }
  },
  async audio(data) {
    const rec = live.get(data.id);
    if (!rec || rec.failed) return;
    if (!rec.stream) return void rec.chunks.push(data.samples);
    await rec.stream.accept(data.samples);
    const text = rec.stream.text();
    if (text !== rec.said) post({ type: "partial", id: data.id, text: (rec.said = text) });
  },
  async end(data) {
    const rec = live.get(data.id);
    if (!rec) throw new Error("no such recording");
    live.delete(data.id);
    if (rec.failed) throw rec.failed;
    const t0 = performance.now();
    if (rec.stream) return done(data.id, await rec.stream.finish(), t0);
    const r = await recogniser(rec.lang);
    done(data.id, await r.transcribe(joined(rec.chunks), { openers: data.openers ?? [] }), t0);
  },
  async cancel(data) {
    live.delete(data.id);
  },
};

self.addEventListener("message", ({ data }) => {
  if (data.type === "load") {
    recogniser(data.lang).catch((err) => fail(err, { lang: data.lang }));
  } else if (handlers[data.type]) {
    queue = queue.then(() => handlers[data.type](data)).catch((err) => {
      live.delete(data.id);
      // Only the message that carries the answer reports the failure.
      if (data.type === "transcribe" || data.type === "end") fail(err, { id: data.id, lang: data.lang });
    });
  }
});
