// Transcribes the test recordings with the in-browser recognisers (client/voice), outside
// a browser, the way client/voice/voice.test.mjs does, with the names the page passes
// (openers for the models of engine.js, phrases for the streaming model of transducer.js).
// One thread; chrome.mjs runs the same code in a real browser and measures the wait.
//
//   node stt/eval/browser.mjs [--only he-whisper] [--models <dir holding the model folders>]
//
// Writes assets/stt-eval/results/browser.json for score.mjs: the page's Hebrew and English
// models, or with --only one model of client/voice/models.json by its key (the older
// Hebrew model is "he-whisper"), into browser-<key>.json. Needs `make voice-models`.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

import { Recognizer, isNoise, readWav } from "../../client/voice/engine.js";
import { hintPhrases } from "../../client/voice/hints.js";
import { parseMelFilters } from "../../client/voice/mel.js";
import { Tokenizer } from "../../client/voice/tokenizer.js";
import { Transducer } from "../../client/voice/transducer.js";

const arg = (name, or) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : or);
const root = new URL("../../", import.meta.url);
const data = new URL("assets/stt-eval/", root);
const voice = new URL("client/voice/", root);
const models = new URL(arg("--models", "assets/models") + "/", root);
const manifest = JSON.parse(readFileSync(new URL("models.json", voice)));
const rules = JSON.parse(readFileSync(new URL("shared/rules.json", root)));
rules.map = rules.maps.large; // fifteen points: the recordings name none of the six that only the huge map has
const index = JSON.parse(readFileSync(new URL("index.json", data)));

const ort = await import(new URL("client/vendor/ort/ort.wasm.min.mjs", root));
ort.env.wasm.numThreads = 1; // the page uses up to four; outside a browser the runtime has one
ort.env.wasm.wasmBinary = readFileSync(new URL("client/vendor/ort/ort-wasm-simd-threaded.wasm", root));
ort.env.logLevel = "error";

const cs = rules.callsigns;
const only = arg("--only");
const out = {};
for (const key of only ? [only] : ["he", "en"]) {
  const spec = manifest.models[key];
  const lang = key.slice(0, 2);
  const bytes = (name) => readFileSync(new URL(`${spec.dir}/${spec.files[name].path}`, models));
  const options = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };
  const session = (name) => ort.InferenceSession.create(bytes(name), options);
  const r =
    spec.kind === "transducer"
      ? new Transducer({ ort, encoder: await session("encoder"), decoder: await session("decoder"), joiner: await session("joiner"), tokens: bytes("tokens").toString(), spec })
      : new Recognizer({ ort, encoder: await session("encoder"), decoder: await session("decoder"), tokenizer: new Tokenizer(JSON.parse(bytes("tokenizer")), spec.tokenizer), spec, melFilters: parseMelFilters(readFileSync(new URL("mel_filters.bin", voice))) });
  const openers = [...Object.values(cs.classes).map((c) => c[lang]), cs.operator[lang], cs.allStations[lang]];
  const phrases = hintPhrases(rules, lang);
  for (const item of index.filter((i) => i.lang === lang)) {
    const { samples } = readWav(readFileSync(new URL(item.file, data)));
    const t0 = performance.now();
    const text = await r.transcribe(samples, { openers, phrases });
    out[item.file] = { text: isNoise(text) ? "" : text, ms: Math.round(performance.now() - t0) };
  }
  console.log(`${key}: done`);
}
mkdirSync(new URL("results/", data), { recursive: true });
writeFileSync(new URL(`results/browser${only ? `-${only}` : ""}.json`, data), JSON.stringify(out, null, 1));
