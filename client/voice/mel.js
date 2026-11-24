// Whisper log-mel features: pad or trim to 30 s, reflect-pad 200, periodic Hann(400),
// hop 160, |rfft|^2, 3000 frames, slaney mel (201x80), log10, clamp to max-8, (x+4)/4.
// Output is [80][3000] float32.
// Ported from the Ozen web app (https://github.com/itayinbarr/ozen), MIT, Copyright (c) 2026 Itay Inbar.

import { FFT } from "./fft.js";

export const SR = 16000;
const N_FFT = 400;
const HOP = 160;
const N_MELS = 80;
const N_FREQ = N_FFT / 2 + 1;
const N_SAMPLES = 30 * SR;
const N_FRAMES = 3000;

// parseMelFilters reads mel_filters.bin: 201x80 float32 little-endian, [freq][mel].
export function parseMelFilters(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.byteLength !== N_FREQ * N_MELS * 4) throw new Error(`mel_filters.bin has ${bytes.byteLength} bytes, expected ${N_FREQ * N_MELS * 4}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(N_FREQ * N_MELS);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

export class LogMel {
  constructor(filters) {
    this.fft = new FFT(N_FFT);
    this.window = new Float64Array(N_FFT);
    for (let i = 0; i < N_FFT; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT);
    // Each mel filter touches a narrow band of bins; keep only that band.
    this.mels = [];
    for (let m = 0; m < N_MELS; m++) {
      let lo = -1;
      let hi = -1;
      for (let f = 0; f < N_FREQ; f++) {
        if (filters[f * N_MELS + m] !== 0) {
          if (lo < 0) lo = f;
          hi = f;
        }
      }
      const w = new Float64Array(lo < 0 ? 0 : hi - lo + 1);
      for (let f = lo; lo >= 0 && f <= hi; f++) w[f - lo] = filters[f * N_MELS + m];
      this.mels.push({ lo: Math.max(lo, 0), w });
    }
  }

  compute(x) {
    const P = N_FFT / 2;
    const padded = new Float64Array(N_SAMPLES + N_FFT);
    const m = Math.min(x.length, N_SAMPLES);
    for (let i = 0; i < m; i++) padded[P + i] = x[i];
    for (let i = 0; i < P; i++) {
      padded[i] = padded[2 * P - i];
      padded[P + N_SAMPLES + i] = padded[P + N_SAMPLES - 2 - i];
    }
    const fr = new Float64Array(N_FFT);
    const fi = new Float64Array(N_FFT);
    const or = new Float64Array(N_FFT);
    const oi = new Float64Array(N_FFT);
    const power = new Float64Array(N_FREQ);
    const logs = new Float64Array(N_MELS * N_FRAMES);
    let max = -Infinity;
    for (let t = 0; t < N_FRAMES; t++) {
      const base = t * HOP;
      for (let i = 0; i < N_FFT; i++) {
        fr[i] = padded[base + i] * this.window[i];
        fi[i] = 0;
      }
      this.fft.transform(fr, fi, or, oi);
      for (let k = 0; k < N_FREQ; k++) power[k] = or[k] * or[k] + oi[k] * oi[k];
      for (let mm = 0; mm < N_MELS; mm++) {
        const { lo, w } = this.mels[mm];
        let s = 0;
        for (let j = 0; j < w.length; j++) s += power[lo + j] * w[j];
        const v = Math.log10(Math.max(s, 1e-10));
        logs[mm * N_FRAMES + t] = v;
        if (v > max) max = v;
      }
    }
    const floor = max - 8;
    const out = new Float32Array(N_MELS * N_FRAMES);
    for (let i = 0; i < out.length; i++) out[i] = (Math.max(logs[i], floor) + 4) / 4;
    return out;
  }
}
