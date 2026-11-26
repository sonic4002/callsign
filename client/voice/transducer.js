// A streaming recogniser: a Zipformer transducer (encoder, decoder, joiner) that reads the
// recording 1.28 seconds at a time and writes as it goes. The Hebrew model is one of these.
// The ONNX Runtime module and its sessions are handed in, as in engine.js, so the browser
// worker and the Node tests run the same code.
//
// It can be told what to expect. `phrases` are the names and words of this match's radio
// net (callsigns, map points, procedure words): while the search is spelling one of them
// it is given a small bonus per letter, which it loses again if the word turns out to be
// another. Biasing works on letters, not on the model's own word pieces, so it needs no
// tokenizer and does not care how the model happens to split a name.

import { Fbank, BINS, RATE } from "./fbank.js";

const BLANK = 0;
const UNK = 2;
const SPACE = "▁"; // the mark a word piece carries when it starts a word
export const BEAM = 4;
const WIDE = 8; // pieces tried for each hypothesis at each step
// Bonus per letter of an expected phrase, in nats. Measured on stt/eval (192 Hebrew
// recordings): with none the callsign is written right in half the calls, from 1 to 2 in
// nearly all and the order is understood most often, and at 3 words that were not said
// start to appear.
export const BOOST = 1.5;

// parseTokens reads tokens.txt ("piece id" per line) into the pieces by id.
export function parseTokens(text) {
  const pieces = [];
  for (const line of text.split("\n")) {
    const at = line.lastIndexOf(" ");
    if (at > 0) pieces[Number(line.slice(at + 1))] = line.slice(0, at);
  }
  return pieces;
}

// Only the first letters of each word of a phrase earn the bonus: enough to carry a short
// name past a likelier everyday word, without a long one outweighing what was heard.
const PAID = 4;
const MARKS = ",.?!:;";

// phraseTree builds the letter tree of the expected phrases. Each starts a word. A node
// knows how far into its word it is (`letter`, 0 for the mark that starts the word).
export function phraseTree(phrases) {
  const root = { next: new Map(), end: false, letter: 0 };
  for (const phrase of phrases) {
    let node = root;
    for (const ch of SPACE + phrase.trim().replace(/\s+/g, SPACE)) {
      if (!node.next.has(ch)) node.next.set(ch, { next: new Map(), end: false, letter: ch === SPACE ? 0 : node.letter + 1 });
      node = node.next.get(ch);
    }
    if (node !== root) node.end = true;
  }
  return root;
}

// follow walks one word piece through the tree from a hypothesis's place in it
// ({ node, trial, last }): `trial` is the bonus still on trial, lost if the phrase is not
// finished, and `last` the phrase finished just before, which earns nothing said twice
// running. It returns the new place and the change to the hypothesis's score.
function follow(root, at, piece, boost) {
  let { node, trial, last } = at;
  let gain = 0;
  for (const ch of piece) {
    // A word ends at the next word or at a comma or full stop, which the model also writes.
    const between = ch === SPACE || MARKS.includes(ch);
    if (node.end && between) {
      // The phrase ended with its word. Its bonus is kept, unless it only repeats itself.
      if (node === last) gain -= trial;
      last = node;
      node = root;
      trial = 0;
    }
    let next = node.next.get(ch);
    if (!next) {
      gain -= trial; // not that phrase after all
      trial = 0;
      if (node !== root) last = null;
      next = root.next.get(ch);
    }
    if (next) {
      node = next;
      if (node.letter > 0 && node.letter <= PAID) {
        trial += boost;
        gain += boost;
      }
    } else {
      node = root;
      if (!between) last = null;
    }
  }
  return { node, trial, last, gain };
}

export class Transducer {
  // spec is the model's entry in models.json; tokens is the text of its tokens.txt.
  constructor({ ort, encoder, decoder, joiner, tokens, spec }) {
    Object.assign(this, { ort, encoder, decoder, joiner, spec });
    this.pieces = parseTokens(tokens);
    const meta = encoder.inputMetadata;
    const [, chunk, bins] = meta.find((m) => m.name === "x").shape;
    if (bins !== BINS) throw new Error(`the encoder wants ${bins} mel bins`);
    this.chunk = chunk; // frames the encoder reads at a time
    this.shift = spec.shift; // frames it moves on by
    this.states = meta.filter((m) => m.name !== "x").map((m) => ({ name: m.name, type: m.type, dims: m.shape.map((d) => (typeof d === "number" ? d : 1)) }));
    this.context = 2;
  }

  // stream starts a recording. phrases: what to listen for; boost: how hard.
  stream({ phrases = [], boost = BOOST, beam = BEAM } = {}) {
    return new Stream(this, phrases.length && boost > 0 ? phraseTree(phrases) : null, boost, beam);
  }

  // transcribe is the whole recording at once.
  async transcribe(audio, options) {
    const s = this.stream(options);
    await s.accept(audio);
    return s.finish();
  }
}

class Stream {
  constructor(model, tree, boost, beam) {
    Object.assign(this, { model, tree, boost, beam });
    const T = model.ort.Tensor;
    this.fbank = new Fbank();
    this.frames = []; // features not yet read by the encoder
    this.state = {};
    for (const s of model.states) {
      const n = s.dims.reduce((a, b) => a * b, 1);
      this.state[s.name] = s.type === "int64" ? new T("int64", new BigInt64Array(n), s.dims) : new T("float32", new Float32Array(n), s.dims);
    }
    this.hyps = [{ ys: new Array(model.context).fill(BLANK), score: 0, node: tree, trial: 0, last: null }];
    this.decoded = new Map(); // last tokens → the decoder's output for them
    this.busy = Promise.resolve();
  }

  // accept takes more of the recording (16 kHz mono floats) and decodes what it completes.
  accept(samples) {
    this.frames.push(...this.fbank.accept(samples));
    return (this.busy = this.busy.then(() => this.#run()));
  }

  // finish ends the recording and resolves with the text. Quiet is added so that the last
  // word, which the model writes a little after it was said, is not cut off.
  async finish() {
    const { chunk } = this.model;
    const tail = RATE * 0.3;
    await this.accept(new Float32Array(tail));
    // What is left is less than the encoder reads at a time: fill it up with quiet.
    if (this.frames.length > 0) await this.accept(new Float32Array((chunk - this.frames.length) * 160));
    return this.text(true);
  }

  // text is what has been written so far; `final` also settles a phrase still on trial.
  text(final = false) {
    let best = null;
    for (const h of this.hyps) {
      const score = final && h.trial && (!h.node.end || h.node === h.last) ? h.score - h.trial : h.score;
      if (!best || score > best.score) best = { ys: h.ys, score };
    }
    const { pieces, context } = this.model;
    return best.ys.slice(context).map((id) => pieces[id]).join("").replaceAll(SPACE, " ").trim();
  }

  async #run() {
    const { model } = this;
    const T = model.ort.Tensor;
    while (this.frames.length >= model.chunk) {
      const x = new Float32Array(model.chunk * BINS);
      for (let t = 0; t < model.chunk; t++) x.set(this.frames[t], t * BINS);
      this.frames.splice(0, model.shift);
      const out = await model.encoder.run({ x: new T("float32", x, [1, model.chunk, BINS]), ...this.state });
      for (const s of model.states) this.state[s.name] = out[`new_${s.name}`];
      const enc = out.encoder_out;
      const [, steps, dim] = enc.dims;
      for (let t = 0; t < steps; t++) await this.#step(enc.data.subarray(t * dim, (t + 1) * dim), dim);
    }
  }

  // decoder outputs for every hypothesis, asked for in one batch and remembered.
  async #decoderOut(hyps) {
    const { model } = this;
    const T = model.ort.Tensor;
    const key = (h) => h.ys.slice(-model.context).join(",");
    const missing = [...new Set(hyps.map(key).filter((k) => !this.decoded.has(k)))];
    if (missing.length) {
      const y = BigInt64Array.from(missing.flatMap((k) => k.split(",").map(BigInt)));
      const { decoder_out: d } = await model.decoder.run({ y: new T("int64", y, [missing.length, model.context]) });
      const dim = d.dims[1];
      missing.forEach((k, i) => this.decoded.set(k, d.data.slice(i * dim, (i + 1) * dim)));
    }
    return hyps.map((h) => this.decoded.get(key(h)));
  }

  // One encoder frame: every hypothesis either waits (blank) or writes one more piece.
  async #step(frame, dim) {
    const { model, tree, boost, beam } = this;
    const T = model.ort.Tensor;
    const n = this.hyps.length;
    const dec = await this.#decoderOut(this.hyps);
    const e = new Float32Array(n * dim);
    const d = new Float32Array(n * dim);
    for (let i = 0; i < n; i++) {
      e.set(frame, i * dim);
      d.set(dec[i], i * dim);
    }
    const { logit } = await model.joiner.run({ encoder_out: new T("float32", e, [n, dim]), decoder_out: new T("float32", d, [n, dim]) });
    const vocab = logit.dims[1];
    const data = logit.data;
    const next = new Map(); // tokens so far → the best way of having written them
    const offer = (h) => {
      const k = h.ys.join(",");
      const had = next.get(k);
      if (!had || h.score > had.score) next.set(k, h);
    };
    for (let i = 0; i < n; i++) {
      const h = this.hyps[i];
      const base = i * vocab;
      let max = -Infinity;
      for (let v = 0; v < vocab; v++) if (data[base + v] > max) max = data[base + v];
      let sum = 0;
      for (let v = 0; v < vocab; v++) sum += Math.exp(data[base + v] - max);
      const norm = max + Math.log(sum);
      // The few most likely pieces; an expected phrase can lift one of them over the rest.
      const top = [];
      for (let v = 0; v < vocab; v++) {
        if (v === UNK) continue;
        const lp = data[base + v] - norm;
        if (top.length < WIDE || lp > top[top.length - 1][1]) {
          top.push([v, lp]);
          top.sort((a, b) => b[1] - a[1]);
          if (top.length > WIDE) top.pop();
        }
      }
      for (const [v, lp] of top) {
        if (v === BLANK) offer({ ...h, score: h.score + lp });
        else {
          const f = tree ? follow(tree, h, model.pieces[v], boost) : { node: null, trial: 0, last: null, gain: 0 };
          offer({ ys: [...h.ys, v], score: h.score + lp + f.gain, node: f.node, trial: f.trial, last: f.last });
        }
      }
    }
    this.hyps = [...next.values()].sort((a, b) => b.score - a.score).slice(0, beam);
  }
}
