// Speech recognition: the parts that are plain code run in every `make test`. The last
// test runs the real Hebrew model on a recording and is opt-in (`make voice-test`).

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { Recognizer, isNoise, readWav, trimSilence } from "./engine.js";
import { LogMel, parseMelFilters } from "./mel.js";
import { normalize, similarity, relaxed, tidy } from "./normalize.js";
import { Tokenizer } from "./tokenizer.js";

const read = (name) => readFileSync(new URL(name, import.meta.url));
const rules = JSON.parse(read("../../shared/rules.json"));
rules.map ??= rules.maps.small; // the default map, as the server sends it to a page
const manifest = JSON.parse(read("models.json"));

// What the recognisers really wrote for spoken calls (three voices), and the call it must become.
const heard = {
  en: [
    ["Viper 2, this is hammer, hold foxtrot over.", "Viper 2, this is Hammer. Hold Foxtrot. Over."],
    ["Viper 2 this is hammer hold fox strut over", "Viper 2, this is Hammer. Hold Foxtrot. Over."],
    ["Viper, too, this is hammer, hold fox-trot over.", "Viper 2, this is Hammer. Hold Foxtrot. Over."],
    ["Viper 2: This is Hammer! Take your squad to the town and dig in. Then tell me what you see. Over!", "Viper 2, this is Hammer. Take your squad to the town and dig in. Then tell me what you see. Over."],
    ["Vipah 1: This is Hannah. Move to the bridge. Over.", "Viper 1, this is Hammer. Move to the bridge. Over."],
    ["Vapour one, this is hammer, attack gulf, then hold bravo out.", "Viper 1, this is Hammer. Attack Golf, then hold Bravo. Out."],
    ["Jack won this is hammer hold sierra over", "Shark 1, this is Hammer. Hold Sierra. Over."],
    ["Rhino 1, this is hammer. Attack kilo over.", "Rhino 1, this is Hammer. Attack Kilo. Over."],
    ["Amble, this is hammer by one infantry squad, commandos over.", "Anvil, this is Hammer. Buy one infantry squad, commandos. Over."],
    ["All stations this is hammer radio check over", "All stations, this is Hammer. Radio check. Over."],
    ["Viper one and Rhino too, this is hammer, kill everything at kylo and go to hotel over.", "Viper 1 and Rhino 2, this is Hammer. Kill everything at Kilo and go to Hotel. Over."],
  ],
  he: [
    ["צפע שתיים כאן פטיש תחזיקו את פסל עבור.", "צפע 2, כאן פטיש, תחזיקו את פסל, עבור."],
    ["ענף אחת כאן - פטיש תקפו את קרמל עבור.", "קרנף 1, כאן פטיש, תקפו את כרמל, עבור."],
    ["ריש אחת כאן פטישה חזק בשמח עבור", "כריש 1, כאן פטיש, חזק בסמך, עבור."],
    ["צפע אחת וקרנף אחת כאן פטיש נועו לכרמל סוף", "צפע 1 וקרנף 1, כאן פטיש, נועו לכרמל, סוף."],
    ["סדן, כאן פטיש, קנה טנק, עבור.", "סדן, כאן פטיש, קנה טנק, עבור."],
  ],
};

test("normalize: a heard call becomes proper procedure with the net's own names", () => {
  for (const lang of ["en", "he"]) {
    for (const [said, want] of heard[lang]) assert.equal(normalize(said, { lang, rules }), want, said);
  }
});

test("normalize: the calls the page itself writes pass through unchanged", () => {
  for (const lang of ["en", "he"]) {
    const strings = JSON.parse(read(`../i18n/${lang}.json`));
    const cs = rules.callsigns;
    for (const p of rules.map.points) {
      for (const verb of ["hold", "move", "attack"]) {
        const call = strings[`call.${verb}`].replace("{to}", `${cs.classes.infantry[lang]} 2`).replace("{from}", cs.player[lang]).replace("{point}", p.callsign[lang]);
        assert.equal(normalize(call, { lang, rules }), call);
      }
    }
  }
});

test("normalize: no guessing where there is nothing to go on", () => {
  // No call at the front: plain dictation, left alone.
  assert.equal(normalize("  hello   there ", { lang: "en", rules }), "hello there");
  // A missing Over is never added; the player ends the call.
  assert.equal(normalize("Viper 1, this is Hammer, hold bravo", { lang: "en", rules }), "Viper 1, this is Hammer. Hold Bravo.");
  // An unknown name in front stays as heard.
  assert.match(normalize("Tango one, this is Hammer, wait, over", { lang: "en", rules }), /^Tango 1, this is Hammer\. Wait\. Over\.$/);
  // Ordinary words that sound like a point are not renamed.
  assert.match(normalize("Viper 1, this is Hammer, kill them and hold the gold, over", { lang: "en", rules }), /Kill them and hold the gold\./);
  assert.ok(similarity("vapour", "viper", "en") > similarity("vapour", "rhino", "en"));
});

test("tokenizer: both kinds decode ids to text and skip special tokens", () => {
  const bytes = new Tokenizer({ model: { vocab: { "<s>": 1, "</s>": 2, "Ġ×©×ľ": 5, "×ķ×Ŀ": 6 } }, added_tokens: [{ id: 1 }, { id: 2 }] }, "bytes");
  assert.equal(bytes.decode([1, 5, 6, 2]), "שלום");
  const pieces = new Tokenizer({ model: { vocab: { "<s>": 1, "▁Hold": 7, "▁Fox": 8, "trot": 9, "<0x2E>": 10 } }, added_tokens: [{ id: 1 }] }, "pieces");
  assert.equal(pieces.decode([1, 7, 8, 9, 10]), "Hold Foxtrot.");
});

test("log-mel: the features of the test recording are the reference's", () => {
  const mel = new LogMel(parseMelFilters(read("mel_filters.bin"))).compute(readWav(read("testdata/sample-he.wav")).samples);
  assert.equal(mel.length, 80 * 3000);
  // Checked equal, value for value, to spec/golden/sample-he.mel.bin of the Ozen project.
  const at = (i) => Number(mel[i].toFixed(6));
  assert.deepEqual([at(0), at(1234), at(100000), at(239999)], [0.911415, -0.562888, 0.366259, -0.562888]);
  assert.equal(Number(mel.reduce((a, v) => a + v, 0).toFixed(1)), -41845.8);
});

test("a decoder stuck on one phrase is treated as noise", () => {
  assert.ok(isNoise("thank you ".repeat(10)));
  assert.ok(!isNoise("Viper 2, this is Hammer. Take your squad to the town and dig in, then tell me what you see. Over."));
});

test("silence around the speech is cut, with a margin", () => {
  const audio = new Float32Array(16000 * 5);
  for (let i = 32000; i < 48000; i++) audio[i] = 0.3 * Math.sin(i / 5);
  for (let i = 0; i < audio.length; i += 7) audio[i] += 0.0005; // a quiet room
  const cut = trimSilence(audio);
  assert.ok(cut.length >= 16000 && cut.length <= 16000 + 2 * 4000 + 1000, `kept ${cut.length} samples`);
  assert.equal(trimSilence(new Float32Array(16000)).length, 0);
});

test("models.json names every file with its size and checksum", () => {
  for (const f of [...manifest.runtime.files, ...Object.values(manifest.models).flatMap((m) => Object.values(m.files))]) {
    assert.ok(f.path && f.bytes > 0 && /^[0-9a-f]{64}$/.test(f.sha256), JSON.stringify(f));
  }
  assert.deepEqual(Object.keys(manifest.models).sort(), ["en", "he"]);
});

// The real thing: the Hebrew model on a 12 s recording, through the same runtime the
// page uses (single thread here). Opt-in because it needs 180 MB of weights.
const root = new URL("../../", import.meta.url);
const spec = manifest.models.he;
const weights = Object.values(spec.files).map((f) => new URL(`assets/models/${spec.dir}/${f.path}`, root));
const runtime = new URL("client/vendor/ort/", root);
const skip = !process.env.CALLSIGN_VOICE_MODELS ? "set CALLSIGN_VOICE_MODELS=1 (make voice-test)" : !weights.every(existsSync) || !existsSync(new URL("ort.wasm.min.mjs", runtime)) ? "weights are not here: make voice-models" : false;

test("the Hebrew model transcribes the test recording word for word", { skip }, async () => {
  const ort = await import(new URL("ort.wasm.min.mjs", runtime));
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmBinary = readFileSync(new URL("ort-wasm-simd-threaded.wasm", runtime));
  ort.env.logLevel = "error";
  const [enc, dec, tok] = weights.map((u) => readFileSync(u));
  const r = new Recognizer({
    ort,
    encoder: await ort.InferenceSession.create(enc, { executionProviders: ["wasm"] }),
    decoder: await ort.InferenceSession.create(dec, { executionProviders: ["wasm"] }),
    tokenizer: new Tokenizer(JSON.parse(tok), spec.tokenizer),
    spec,
    melFilters: parseMelFilters(read("mel_filters.bin")),
  });
  const text = await r.transcribe(readWav(read("testdata/sample-he.wav")).samples);
  assert.equal(text, "אני הייתי, נגיד, אומר דבר כזה. קודם כל הייתי רוצה לתאר את החברה, זאת אומרת, מה החברה עושה, מה הטכנולוגיה, מה האתגרים שלך.");
});

test("relaxed: a callsign that only sounds right is respelled when its number follows", () => {
  const rules = JSON.parse(readFileSync(new URL("../../shared/rules.json", import.meta.url), "utf8"));
  rules.map ??= rules.maps.small; // the default map, as the server sends it to a page
  assert.equal(relaxed("צבע 1 תפוס את דוד", { lang: "he", rules }), "צפע 1 תפוס את דוד");
  assert.equal(relaxed("צבע אחת תקוף", { lang: "he", rules }), "צפע 1 תקוף");
  assert.equal(relaxed("vapour two attack gulf", { lang: "en", rules }), "Viper 2 attack Golf");
  assert.equal(relaxed("what is happening at Kilo?", { lang: "en", rules }), "what is happening at Kilo?");
  assert.equal(relaxed("buy a tank", { lang: "en", rules }), "buy a tank");
  assert.equal(tidy("Viper 2, this is Hammer. Hold Foxtrot. Over.", { lang: "en", rules }), "Viper 2, this is Hammer. Hold Foxtrot. Over.");
});

test("a named enemy squad keeps its name and gets a digit", () => {
  const rules = JSON.parse(readFileSync(new URL("../../shared/rules.json", import.meta.url), "utf8"));
  rules.map ??= rules.maps.small; // the default map, as the server sends it to a page
  assert.equal(relaxed("viper one attack target three", { lang: "en", rules }), "Viper 1 attack Target 3");
  assert.equal(relaxed("צפע 1 תקוף את מטרה שלוש", { lang: "he", rules }), "צפע 1 תקוף את מטרה 3");
});

test("openers: a callsign the audio supports is taken as the first word, a poor fit is not", async () => {
  // A toy model that hears "zebra two": its free guess for the first word is wrong, and
  // "viper" is its second choice (close) or a hopeless one (far).
  const vocab = { "<pad>": 0, "<s>": 1, "</s>": 2, "▁zebra": 3, "▁vi": 4, "per": 5, "▁two": 6, "▁rhino": 7 };
  const tokenizer = new Tokenizer({ model: { vocab }, added_tokens: [{ id: 0 }, { id: 1 }, { id: 2 }] }, "pieces");
  class Tensor {
    constructor(type, data, dims) {
      Object.assign(this, { type, data, dims });
    }
  }
  const model = (viperLogit) => ({
    inputNames: ["input_ids", "encoder_hidden_states", "use_cache_branch", "past_key_values.0.decoder.key"],
    async run(feed) {
      const last = Number(feed.input_ids.data[0]);
      const logits = new Float32Array(8).fill(-20);
      if (last === 1) [logits[3], logits[4], logits[7]] = [5, viperLogit, -9]; // first word
      else if (last === 4) logits[5] = 5; // "vi" → "per"
      else if (last === 3 || last === 5) logits[6] = 5; // → "two"
      else logits[2] = 5; // end
      return { logits: new Tensor("float32", logits, [1, 1, 8]) };
    },
  });
  const make = (viperLogit) =>
    new Recognizer({
      ort: { Tensor },
      encoder: { run: async () => ({ last_hidden_state: new Tensor("float32", new Float32Array(1), [1, 1, 1]) }) },
      decoder: model(viperLogit),
      tokenizer,
      spec: { kind: "moonshine", heads: 1, headDim: 1, maxTokens: 10, tokensPerSecond: 10 },
    });
  const audio = Float32Array.from({ length: 16000 }, (_, i) => Math.sin(i / 7));
  const openers = ["Viper", "Rhino"];
  assert.equal(await make(3).transcribe(audio), "zebra two");
  assert.equal(await make(3).transcribe(audio, { openers }), "viper two");
  assert.equal(await make(-12).transcribe(audio, { openers }), "zebra two");
});

// The page writes calls itself (the order menu, the build and upgrade buttons, the Help
// examples) and sends them like typed text. Tidying must never turn one into another
// call: "צפע" is not the point "זאב", "כיתת" is not "דוד", "Militia cell" is not Kilo.
test("tidy leaves the calls the page writes alone, typed or spoken", () => {
  const rules = JSON.parse(readFileSync(new URL("../../shared/rules.json", import.meta.url), "utf8"));
  rules.map ??= rules.maps.small; // the default map, as the server sends it to a page
  const cs = rules.callsigns;
  const words = (text) => text.split(/[\s,.:;!?]+/).filter(Boolean).join(" ");
  for (const lang of ["he", "en"]) {
    const s = JSON.parse(readFileSync(new URL(`../i18n/${lang}.json`, import.meta.url), "utf8"));
    const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
    const calls = Object.keys(s).filter((k) => /^help\..*\.say$/.test(k)).map((k) => s[k]);
    for (const p of rules.map.points) for (const kind of ["hold", "move", "attack"]) calls.push(fill(s[`call.${kind}`], { to: `${cs.classes.infantry[lang]} 1`, from: cs.player[lang], point: p.callsign[lang] }));
    calls.push(fill(s["call.attack"], { to: `${cs.classes.vehicle[lang]} 2`, from: cs.player[lang], point: `${cs.contact[lang]} 3` }));
    for (const f of Object.values(rules.factions)) for (const u of Object.values(f.units)) calls.push(fill(s["call.buy"], { to: cs.operator[lang], from: cs.player[lang], class: s[`class.${u.class}`], unit: u.name[lang] }));
    for (const c of Object.values(cs.classes)) calls.push(fill(s["call.upgrade"], { to: cs.operator[lang], from: cs.player[lang], squad: `${c[lang]} 1` }));
    for (const text of calls) {
      assert.equal(tidy(text, { lang, rules, typed: true }), text, "typed text is sent as written");
      // A spoken call may have its punctuation redone, never its words.
      assert.equal(words(tidy(text, { lang, rules })).toLowerCase(), words(text).toLowerCase());
    }
  }
  // What typing still gets: a callsign that is only roughly spelled, put right.
  assert.equal(tidy("צבע 1 תפוס את דוד", { lang: "he", rules, typed: true }), "צפע 1 תפוס את דוד");
  assert.equal(tidy("vipr 2 attack target three", { lang: "en", rules, typed: true }), "Viper 2 attack Target 3");
});

test("a callsign inside the message is never respelled as a map point", () => {
  const rules = JSON.parse(readFileSync(new URL("../../shared/rules.json", import.meta.url), "utf8"));
  rules.map ??= rules.maps.small; // the default map, as the server sends it to a page
  assert.equal(tidy("סדן, שדרג את צפע 1", { lang: "he", rules }), "סדן, שדרג את צפע 1");
  assert.equal(tidy("סדן, כאן פטיש, שדרג את צפע 1 לדרגת המוח הבאה, עבור.", { lang: "he", rules }), "סדן, כאן פטיש, שדרג את צפע 1 לדרגת המוח הבאה, עבור.");
  assert.equal(tidy("Anvil, upgrade Viper 1", { lang: "en", rules }), "Anvil, upgrade Viper 1");
  // A place that only sounds right is still corrected.
  assert.equal(tidy("צפע 1 תקוף את קרמל", { lang: "he", rules }), "צפע 1 תקוף את כרמל");
});

test("gold is not a map point: a call for a gold truck keeps its words", () => {
  const rules = JSON.parse(readFileSync(new URL("../../shared/rules.json", import.meta.url), "utf8"));
  rules.map ??= rules.maps.small; // the default map, as the server sends it to a page
  assert.equal(relaxed("סדן, קנה משאית זהב", { lang: "he", rules }), "סדן, קנה משאית זהב");
  assert.equal(relaxed("סדן, המשאיות לשדה כרמל", { lang: "he", rules }), "סדן, המשאיות לשדה כרמל");
  assert.equal(relaxed("Anvil, haulers to the gold field at kilo", { lang: "en", rules }), "Anvil, haulers to the gold field at Kilo");
});
