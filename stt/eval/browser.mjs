// Transcribes the test recordings with the in-browser recognisers (client/voice), outside
// a browser, the way client/voice/voice.test.mjs does, with the openers the page passes.
//
//   node stt/eval/browser.mjs [--models <dir holding ozen-v1 and moonshine-base>]
//
// Writes assets/stt-eval/results/browser.json for score.mjs. Needs `make voice-models`.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

import { Recognizer, isNoise, readWav } from "../../client/voice/engine.js";
import { parseMelFilters } from "../../client/voice/mel.js";
import { Tokenizer } from "../../client/voice/tokenizer.js";

const arg = (name, or) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : or);
const root = new URL("../../", import.meta.url);
const data = new URL("assets/stt-eval/", root);
const voice = new URL("client/voice/", root);
const models = new URL(arg("--models", "assets/models") + "/", root);
const manifest = JSON.parse(readFileSync(new URL("models.json", voice)));
const rules = JSON.parse(readFileSync(new URL("shared/rules.json", root)));
const index = JSON.parse(readFileSync(new URL("index.json", data)));

const ort = await import(new URL("client/vendor/ort/ort.wasm.min.mjs", root));
ort.env.wasm.numThreads = 1; // the page uses up to four; outside a browser the runtime has one
ort.env.wasm.wasmBinary = readFileSync(new URL("client/vendor/ort/ort-wasm-simd-threaded.wasm", root));
ort.env.logLevel = "error";

const cs = rules.callsigns;
const out = {};
for (const lang of ["he", "en"]) {
  const spec = manifest.models[lang];
  const [enc, dec, tok] = Object.values(spec.files).map((f) => readFileSync(new URL(`${spec.dir}/${f.path}`, models)));
  const options = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };
  const r = new Recognizer({
    ort,
    encoder: await ort.InferenceSession.create(enc, options),
    decoder: await ort.InferenceSession.create(dec, options),
    tokenizer: new Tokenizer(JSON.parse(tok), spec.tokenizer),
    spec,
    melFilters: parseMelFilters(readFileSync(new URL("mel_filters.bin", voice))),
  });
  const openers = [...Object.values(cs.classes).map((c) => c[lang]), cs.operator[lang], cs.allStations[lang]];
  for (const item of index.filter((i) => i.lang === lang)) {
    const { samples } = readWav(readFileSync(new URL(item.file, data)));
    const t0 = performance.now();
    const text = await r.transcribe(samples, { openers });
    out[item.file] = { text: isNoise(text) ? "" : text, ms: Math.round(performance.now() - t0) };
  }
  console.log(`${lang}: done`);
}
mkdirSync(new URL("results/", data), { recursive: true });
writeFileSync(new URL("results/browser.json", data), JSON.stringify(out, null, 1));
