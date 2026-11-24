// One recogniser: audio (16 kHz mono floats) → encoder → greedy decoder loop → text.
// The ONNX Runtime module and its sessions are handed in, so the browser worker and the
// Node test run the same code. Two front ends share the loop:
//   "whisper"   log-mel features of a padded 30 s window (the Hebrew model)
//   "moonshine" the raw samples (the English model)
// The decoder loop follows the Ozen web app (https://github.com/itayinbarr/ozen), MIT,
// Copyright (c) 2026 Itay Inbar.

import { LogMel, SR } from "./mel.js";

const BOS = 1;
const EOS = 2;
export const MAX_SECONDS = 30;

export class Recognizer {
  // spec is the model's entry in models.json.
  constructor({ ort, encoder, decoder, tokenizer, spec, melFilters }) {
    Object.assign(this, { ort, encoder, decoder, tokenizer, spec });
    this.mel = spec.kind === "whisper" ? new LogMel(melFilters) : null;
    this.layers = decoder.inputNames.filter((n) => n.endsWith(".decoder.key")).length;
  }

  // openers are the names a call can start with ("צפע", "Viper", …). A small model
  // spells such names badly when it guesses freely, so the names themselves are tried as
  // the first word: if the audio supports one of them well enough it is taken, and the
  // rest is decoded as usual. `floor` is the lowest average log-probability per token at
  // which an opener is believed. `trace` (optional) receives what was decided.
  async transcribe(audio, { openers = [], floor = OPENER_FLOOR, trace } = {}) {
    const T = this.ort.Tensor;
    const x = trimSilence(audio).subarray(0, MAX_SECONDS * SR);
    if (x.length < SR / 4) return "";
    let feed;
    let limit;
    if (this.mel) {
      feed = { input_features: new T("float32", this.mel.compute(x), [1, 80, 3000]) };
      limit = this.spec.maxTokens;
    } else {
      feed = { input_values: new T("float32", Float32Array.from(x), [1, x.length]) };
      // This model makes up words when it is allowed to run on past the speech.
      limit = Math.min(this.spec.maxTokens, Math.ceil((x.length / SR) * this.spec.tokensPerSecond));
    }
    const out = await this.encoder.run(feed);
    const hidden = out.last_hidden_state ?? Object.values(out)[0];
    const want = openerBytes(openers);
    const forced = want.length ? await this.#decode(hidden, limit, want, floor, trace) : null;
    return this.tokenizer.decode(forced ?? (await this.#decode(hidden, limit, [], floor, trace)));
  }

  // #decode is the greedy loop. With openers it first walks the tokens that spell one of
  // them, and gives up (null) when none fits or the fit is poor.
  async #decode(hidden, limit, openers, floor, trace) {
    const T = this.ort.Tensor;
    const { heads, headDim } = this.spec;
    const feed = { encoder_hidden_states: hidden, use_cache_branch: new T("bool", new Uint8Array([0]), [1]) };
    for (const name of this.decoder.inputNames) {
      if (name.startsWith("past_key_values.")) feed[name] = new T("float32", new Float32Array(0), [1, heads, 0, headDim]);
    }
    const ids = [];
    let last = BOS;
    let remaining = openers; // what is still to be spelled of each opener that fits so far
    let score = 0;
    for (let step = 0; step < limit; step++) {
      feed.input_ids = new T("int64", BigInt64Array.from([BigInt(last)]), [1, 1]);
      const res = await this.decoder.run(feed);
      const logits = res.logits;
      const vocab = logits.dims.at(-1);
      const data = logits.data;
      const base = data.length - vocab;
      let best = 0;
      for (let i = 1; i < vocab; i++) if (data[base + i] > data[base + best]) best = i;
      if (remaining.length) {
        // Only tokens that continue an opener are allowed here.
        let pick = -1;
        for (let i = 0; i < vocab; i++) {
          const bytes = this.tokenizer.tokens[i];
          if (!bytes?.length || this.tokenizer.special.has(i)) continue;
          if ((pick < 0 || data[base + i] > data[base + pick]) && remaining.some((r) => startsWith(r, bytes))) pick = i;
        }
        if (pick < 0) return null;
        let sum = 0;
        for (let i = 0; i < vocab; i++) sum += Math.exp(data[base + i] - data[base + best]);
        score += data[base + pick] - data[base + best] - Math.log(sum);
        const bytes = this.tokenizer.tokens[pick];
        remaining = remaining.filter((r) => startsWith(r, bytes)).map((r) => r.subarray(bytes.length));
        if (remaining.some((r) => r.length === 0)) {
          const mean = score / (ids.length + 1);
          trace?.({ opener: this.tokenizer.decode([...ids, pick]), score: mean, taken: mean >= floor });
          if (mean < floor) return null;
          remaining = [];
        }
        best = pick;
      }
      if (best === EOS) break;
      ids.push(best);
      last = best;
      for (let l = 0; l < this.layers; l++) {
        for (const kv of ["key", "value"]) {
          feed[`past_key_values.${l}.decoder.${kv}`] = res[`present.${l}.decoder.${kv}`];
          // The encoder side of the cache is computed once, on the first step.
          if (step === 0) feed[`past_key_values.${l}.encoder.${kv}`] = res[`present.${l}.encoder.${kv}`];
        }
      }
      feed.use_cache_branch = new T("bool", new Uint8Array([1]), [1]);
    }
    return ids;
  }
}

// The lowest average log-probability per token at which a forced opener is believed.
// Measured on eight voices: a callsign that was really said scores -0.4 to -2.7, and one
// that was not (even "צבע אדום" against "צפע") scores below -7.
export const OPENER_FLOOR = -5;

const startsWith = (whole, part) => part.length <= whole.length && part.every((b, i) => whole[i] === b);

// openerBytes spells each opener the ways a model may start a sentence with it: with or
// without a leading space, as given and with a capital first letter.
function openerBytes(openers) {
  const text = new TextEncoder();
  const forms = new Set();
  for (const name of openers) {
    for (const form of [name, name.toLowerCase(), name[0].toUpperCase() + name.slice(1)]) {
      forms.add(form);
      forms.add(` ${form}`);
    }
  }
  return [...forms].map((form) => text.encode(form));
}

// isNoise spots a decoder stuck on one phrase, which is what these models write for
// noise or silence. Such output is dropped rather than shown.
export function isNoise(text) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 12) return false;
  for (let size = 1; size <= 4; size++) {
    let repeats = 0;
    for (let i = 0; i + size <= words.length; i += size) {
      if (!words.slice(i, i + size).every((w, j) => w === words[j])) break;
      repeats++;
    }
    if (words.length >= size * 6 && repeats * size > words.length * 0.7) return true;
  }
  return false;
}

// trimSilence cuts the quiet before and after the speech, leaving a short margin. The
// English model in particular writes nothing, or nonsense, when it is given seconds of
// silence to explain.
export function trimSilence(audio, rate = SR) {
  const frame = Math.round(rate * 0.03);
  const levels = [];
  for (let i = 0; i + frame <= audio.length; i += frame) {
    let sum = 0;
    for (let j = i; j < i + frame; j++) sum += audio[j] * audio[j];
    levels.push(Math.sqrt(sum / frame));
  }
  const loud = Math.max(0.004, 0.06 * Math.max(0, ...levels));
  const first = levels.findIndex((v) => v > loud);
  if (first < 0) return audio.subarray(0, 0);
  const last = levels.findLastIndex((v) => v > loud);
  const margin = Math.round(rate * 0.25);
  return audio.subarray(Math.max(0, first * frame - margin), Math.min(audio.length, (last + 1) * frame + margin));
}

// readWav returns the samples of a 16-bit PCM mono WAV file (test audio only).
export function readWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 12;
  let rate = 0;
  let channels = 1;
  while (off + 8 <= view.byteLength) {
    const id = String.fromCharCode(...bytes.subarray(off, off + 4));
    const size = view.getUint32(off + 4, true);
    if (id === "fmt ") {
      channels = view.getUint16(off + 10, true);
      rate = view.getUint32(off + 12, true);
    } else if (id === "data") {
      const n = Math.floor(Math.min(size, view.byteLength - off - 8) / 2 / channels);
      const samples = new Float32Array(n);
      for (let i = 0; i < n; i++) samples[i] = view.getInt16(off + 8 + i * 2 * channels, true) / 32768;
      return { rate, samples };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error("not a PCM WAV file");
}
