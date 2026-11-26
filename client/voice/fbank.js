// Kaldi-style log mel filterbank features, computed as the samples arrive: 25 ms frames
// every 10 ms, 80 bins. This is what the streaming recogniser (transducer.js) was trained
// on, and it must match sherpa-onnx's front end number for number (no dither, frames
// centred on their hop, DC removed, pre-emphasis 0.97, Povey window, 512-point FFT, power
// spectrum, mel bins from 20 Hz to 7600 Hz, natural log). Written for this game.

import { FFT } from "./fft.js";

export const RATE = 16000;
export const BINS = 80;
const FRAME = 400;
const HOP = 160;
const N_FFT = 512;
const FLOOR = 1.1920928955078125e-7; // the smallest energy a bin may have before the log

const mel = (hz) => 1127 * Math.log(1 + hz / 700);

// The triangles of the mel filterbank, each kept as its first FFT bin and its weights.
function filters() {
  const [low, high] = [mel(20), mel(RATE / 2 - 400)];
  const step = (high - low) / (BINS + 1);
  const out = [];
  for (let b = 0; b < BINS; b++) {
    const [left, centre, right] = [low + b * step, low + (b + 1) * step, low + (b + 2) * step];
    let first = -1;
    const weights = [];
    for (let i = 0; i < N_FFT / 2; i++) {
      const m = mel((i * RATE) / N_FFT);
      if (m <= left || m >= right) continue;
      if (first < 0) first = i;
      weights.push(m <= centre ? (m - left) / (centre - left) : (right - m) / (right - centre));
    }
    out.push({ first, weights: Float32Array.from(weights) });
  }
  return out;
}

export class Fbank {
  constructor() {
    this.fft = new FFT(N_FFT);
    this.window = new Float64Array(FRAME);
    for (let i = 0; i < FRAME; i++) this.window[i] = Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)), 0.85);
    this.filters = filters();
    this.re = new Float64Array(N_FFT);
    this.im = new Float64Array(N_FFT);
    this.outRe = new Float64Array(N_FFT);
    this.outIm = new Float64Array(N_FFT);
    this.reset();
  }

  reset() {
    this.samples = new Float32Array(0); // what has been heard and is still needed
    this.offset = 0; // index of samples[0] in the whole recording
    this.made = 0; // frames produced so far
  }

  // accept takes more of the recording and returns the frames it completes, each a
  // Float32Array of BINS values. Frame t covers samples [t*160 - 120, t*160 + 280).
  accept(more) {
    const joined = new Float32Array(this.samples.length + more.length);
    joined.set(this.samples);
    joined.set(more, this.samples.length);
    this.samples = joined;
    const frames = [];
    const total = this.offset + joined.length;
    while (this.made * HOP + (FRAME + HOP) / 2 <= total) frames.push(this.#frame(this.made++));
    // Keep only what the next frame reaches back to.
    const keep = Math.max(0, this.made * HOP - (FRAME - HOP) / 2 - this.offset);
    if (keep > 0) {
      this.samples = this.samples.slice(keep);
      this.offset += keep;
    }
    return frames;
  }

  #frame(t) {
    const { re, im, outRe, outIm, window } = this;
    const start = t * HOP - (FRAME - HOP) / 2;
    let sum = 0;
    for (let i = 0; i < FRAME; i++) {
      let at = start + i;
      if (at < 0) at = -at - 1; // before the recording: its beginning, mirrored
      re[i] = this.samples[at - this.offset];
      sum += re[i];
    }
    const mean = sum / FRAME;
    for (let i = 0; i < FRAME; i++) re[i] -= mean;
    for (let i = FRAME - 1; i > 0; i--) re[i] -= 0.97 * re[i - 1];
    re[0] -= 0.97 * re[0];
    for (let i = 0; i < FRAME; i++) re[i] *= window[i];
    re.fill(0, FRAME);
    im.fill(0);
    this.fft.transform(re, im, outRe, outIm);
    const out = new Float32Array(BINS);
    for (let b = 0; b < BINS; b++) {
      const { first, weights } = this.filters[b];
      let energy = 0;
      for (let k = 0; k < weights.length; k++) {
        const i = first + k;
        energy += weights[k] * (outRe[i] * outRe[i] + outIm[i] * outIm[i]);
      }
      out[b] = Math.log(Math.max(energy, FLOOR));
    }
    return out;
  }
}
