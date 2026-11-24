// Mixed-radix complex FFT for Whisper's 400-sample frames (400 = 4*4*5*5).
// Ported from the Ozen web app (https://github.com/itayinbarr/ozen), MIT, Copyright (c) 2026 Itay Inbar.
// See client/voice/NOTICE.md.

export class FFT {
  constructor(n) {
    this.n = n;
    this.factors = factorize(n);
    this.cos = new Float64Array(n);
    this.sin = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = (-2 * Math.PI * i) / n;
      this.cos[i] = Math.cos(a);
      this.sin[i] = Math.sin(a);
    }
    const maxP = Math.max(...this.factors, 1);
    this.tRe = new Float64Array(maxP);
    this.tIm = new Float64Array(maxP);
  }

  // out = DFT(in). Input and output must be different arrays of length n.
  transform(inRe, inIm, outRe, outIm) {
    this.#rec(this.n, inRe, inIm, 0, 1, outRe, outIm, 0, 0);
  }

  #rec(n, inRe, inIm, inOff, stride, outRe, outIm, outOff, fi) {
    if (n === 1) {
      outRe[outOff] = inRe[inOff];
      outIm[outOff] = inIm[inOff];
      return;
    }
    const p = this.factors[fi];
    const m = n / p;
    for (let q = 0; q < p; q++) {
      this.#rec(m, inRe, inIm, inOff + q * stride, stride * p, outRe, outIm, outOff + q * m, fi + 1);
    }
    // Combine p sub-transforms of length m.
    const step = this.n / n;
    const { tRe, tIm } = this;
    for (let k = 0; k < m; k++) {
      for (let q = 0; q < p; q++) {
        tRe[q] = outRe[outOff + q * m + k];
        tIm[q] = outIm[outOff + q * m + k];
      }
      for (let r = 0; r < p; r++) {
        const idx = k + r * m;
        let sr = 0;
        let si = 0;
        for (let q = 0; q < p; q++) {
          const w = ((q * idx) % n) * step;
          const c = this.cos[w];
          const s = this.sin[w];
          sr += tRe[q] * c - tIm[q] * s;
          si += tRe[q] * s + tIm[q] * c;
        }
        outRe[outOff + idx] = sr;
        outIm[outOff + idx] = si;
      }
    }
  }
}

function factorize(n) {
  const out = [];
  let m = n;
  for (const p of [4, 2, 3, 5]) {
    while (m % p === 0) {
      out.push(p);
      m /= p;
    }
  }
  for (let p = 7; m > 1; p += 2) {
    while (m % p === 0) {
      out.push(p);
      m /= p;
    }
  }
  return out;
}
