// The streaming recogniser (the Hebrew model in this browser): its features, its search
// and the way it is told what to expect, on a toy model in every `make test`. The last
// test runs the real model on a recording and is opt-in (`make voice-test`).

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { readWav } from "./engine.js";
import { Fbank } from "./fbank.js";
import { hintPhrases } from "./hints.js";
import { Transducer, parseTokens, phraseTree } from "./transducer.js";

const read = (name) => readFileSync(new URL(name, import.meta.url));
const manifest = JSON.parse(read("models.json"));

test("fbank: the features of the test recording are kaldi's", () => {
  const { samples } = readWav(read("testdata/sample-he.wav"));
  const frames = new Fbank().accept(samples);
  // Checked equal to kaldi-native-fbank (the front end of sherpa-onnx: no dither, snip_edges
  // off, 80 bins, high_freq -400) to within 0.0002 on every one of the 1199 x 80 values.
  assert.equal(frames.length, 1199);
  const at = (t, b) => Number(frames[t][b].toFixed(3));
  assert.deepEqual([at(0, 0), at(100, 40), at(500, 79)], [-5.027, -3.496, -2.781]);
  assert.equal(Math.round(frames.reduce((a, f) => a + f.reduce((x, y) => x + y, 0), 0) / 100), -1983);
  // In pieces of any size the frames are the same.
  const fbank = new Fbank();
  const pieces = [];
  for (let i = 0; i < 32000; i += 777) pieces.push(...fbank.accept(samples.subarray(i, Math.min(32000, i + 777))));
  assert.deepEqual(pieces[150], frames[150]);
});

// A toy model that hears "צבע אחת" a little more readily than "צפע אחת": one piece a
// frame, four frames at a time.
const pieces = ["<blk>", "<sos/eos>", "<unk>", "▁צבע", "▁צ", "פע", "▁אחת", "פרדע"];
class Tensor {
  constructor(type, data, dims) {
    Object.assign(this, { type, data, dims });
  }
}
function toy() {
  let frame = 0;
  const encoder = {
    inputMetadata: [{ name: "x", type: "float32", shape: ["N", 4, 80] }, { name: "seen", type: "int64", shape: ["N"] }],
    run: async () => ({ encoder_out: new Tensor("float32", Float32Array.from({ length: 4 }, () => frame++), [1, 4, 1]), new_seen: new Tensor("int64", BigInt64Array.of(BigInt(frame)), [1]) }),
  };
  const decoder = { run: async ({ y }) => new Object({ decoder_out: new Tensor("float32", Float32Array.from({ length: y.dims[0] }, (_, i) => Number(y.data[i * 2 + 1])), [y.dims[0], 1]) }) };
  const joiner = {
    async run({ encoder_out: e, decoder_out: d }) {
      const n = e.dims[0];
      const logit = new Float32Array(n * pieces.length).fill(-20);
      for (let i = 0; i < n; i++) {
        const [t, last] = [e.data[i], d.data[i]];
        const row = logit.subarray(i * pieces.length, (i + 1) * pieces.length);
        row[0] = 0; // wait
        if (t === 0 && last === 0) [row[3], row[4]] = [3, 2]; // "צבע" is likelier than "צ…"
        else if (t === 1 && last === 4) row[5] = 3; // "צ" + "פע"
        else if (t === 2 && (last === 3 || last === 5)) row[6] = 4; // → "אחת"
      }
      return { logit: new Tensor("float32", logit, [n, pieces.length]) };
    },
  };
  return new Transducer({ ort: { Tensor }, encoder, decoder, joiner, tokens: pieces.map((p, i) => `${p} ${i}`).join("\n"), spec: { shift: 4 } });
}
const second = new Float32Array(16000).fill(0.1);

test("tokens.txt is read into pieces by id", () => {
  assert.deepEqual(parseTokens("<blk> 0\n▁צ 4\nפע 5\n"), ["<blk>", , , , "▁צ", "פע"]);
});

test("the search writes what the model hears, at once or as the recording arrives", async () => {
  assert.equal(await toy().transcribe(second), "צבע אחת");
  const stream = toy().stream();
  const seen = [];
  for (let i = 0; i < second.length; i += 1600) {
    await stream.accept(second.subarray(i, i + 1600));
    seen.push(stream.text());
  }
  assert.equal(await stream.finish(), "צבע אחת");
  assert.equal(seen.at(-1), "צבע אחת", "the text is there while the button is still held");
});

test("an expected name is written when the model nearly heard it, and only then", async () => {
  assert.equal(await toy().transcribe(second, { phrases: ["צפע"] }), "צפע אחת");
  // A phrase that only begins like what was said earns nothing in the end.
  assert.equal(await toy().transcribe(second, { phrases: ["צפרדע"] }), "צבע אחת");
  // Nor does a phrase bend a word it is only the beginning of ("צ" is not said alone).
  assert.equal(await toy().transcribe(second, { phrases: ["צ"] }), "צבע אחת");
  assert.equal(await toy().transcribe(second, { phrases: ["צפע"], boost: 0 }), "צבע אחת");
});

test("the phrase tree counts letters word by word", () => {
  const tree = phraseTree(["דממת אלחוט"]);
  const walk = (text) => [...text].reduce((node, ch) => node.next.get(ch), tree);
  assert.equal(walk("▁דממת").letter, 4);
  assert.equal(walk("▁דממת▁").letter, 0);
  assert.equal(walk("▁דממת▁אל").letter, 2);
  assert.ok(walk("▁דממת▁אלחוט").end && !walk("▁דממת").end);
});

test("phrases are the net's words, with the letters Hebrew glues to a name", () => {
  const rules = JSON.parse(read("../../shared/rules.json"));
  rules.map = rules.maps.small;
  const he = hintPhrases(rules, "he");
  for (const w of ["צפע", "וקרנף", "כרמל", "לכרמל", "בפסל", "כל התחנות", "עבור", "דממת אלחוט"]) assert.ok(he.includes(w), w);
  assert.equal(new Set(he).size, he.length);
  const en = hintPhrases(rules, "en");
  assert.ok(en.includes("Viper") && en.includes("Foxtrot") && !en.some((w) => /[֐-׿]/.test(w)));
});

// The real thing: the Hebrew model on a 12 s recording, through the same runtime the page
// uses (single thread here). Opt-in because it needs 72 MB of weights.
const root = new URL("../../", import.meta.url);
const spec = manifest.models.he;
const weights = Object.fromEntries(Object.entries(spec.files).map(([name, f]) => [name, new URL(`assets/models/${spec.dir}/${f.path}`, root)]));
const runtime = new URL("client/vendor/ort/", root);
const skip = !process.env.CALLSIGN_VOICE_MODELS ? "set CALLSIGN_VOICE_MODELS=1 (make voice-test)" : !Object.values(weights).every(existsSync) || !existsSync(new URL("ort.wasm.min.mjs", runtime)) ? "weights are not here: make voice-models" : false;

test("the Hebrew model transcribes the test recording, whole and in pieces", { skip }, async () => {
  assert.equal(spec.kind, "transducer");
  const ort = await import(new URL("ort.wasm.min.mjs", runtime));
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmBinary = readFileSync(new URL("ort-wasm-simd-threaded.wasm", runtime));
  ort.env.logLevel = "error";
  const session = (name) => ort.InferenceSession.create(readFileSync(weights[name]), { executionProviders: ["wasm"] });
  const model = new Transducer({ ort, encoder: await session("encoder"), decoder: await session("decoder"), joiner: await session("joiner"), tokens: readFileSync(weights.tokens, "utf8"), spec });
  const { samples } = readWav(read("testdata/sample-he.wav"));
  const want = "אני הייתי, נגיד אומר דבר כזה, קודם כל הייתי רוצה לתאר את החברה, זאת אומרת, מה החברה עושה, מה הטכנולוגיה, מה האתגרים שלך";
  assert.equal(await model.transcribe(samples), want);
  const stream = model.stream({ phrases: ["צפע", "כרמל"] }); // names that were not said change nothing
  for (let i = 0; i < samples.length; i += 1600) await stream.accept(samples.subarray(i, i + 1600));
  assert.equal(await stream.finish(), want);
});
