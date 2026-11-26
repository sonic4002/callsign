// Brings microphone audio down to the 16 kHz the recognisers hear, as it arrives. Each
// output sample is read off the input through a windowed sinc that also removes what
// 16 kHz cannot carry (above 7.2 kHz), so nothing folds back into the speech.

export class Resampler {
  constructor(from, to = 16000) {
    this.step = from / to; // input samples per output sample
    this.cut = Math.min(1, to / from) * 0.9; // pass band, as a share of the input's own limit
    this.half = Math.ceil(16 * Math.max(1, this.step)); // the filter reaches this far each way
    this.kept = new Float32Array(0); // input still needed
    this.offset = 0; // index of kept[0] in the whole input
    this.next = 0; // the next output sample's place in the input
  }

  // push takes more input and returns the output samples it completes.
  push(input) {
    if (this.step === 1) return Float32Array.from(input);
    const all = new Float32Array(this.kept.length + input.length);
    all.set(this.kept);
    all.set(input, this.kept.length);
    const total = this.offset + all.length;
    const out = [];
    const { cut, half } = this;
    for (; this.next + half < total; this.next += this.step) {
      const first = Math.max(this.offset, Math.ceil(this.next - half));
      let sum = 0;
      for (let n = first; n <= this.next + half; n++) {
        const t = this.next - n;
        const x = Math.PI * cut * t;
        const sinc = x === 0 ? 1 : Math.sin(x) / x;
        sum += all[n - this.offset] * cut * sinc * (0.5 + 0.5 * Math.cos((Math.PI * t) / half));
      }
      out.push(sum);
    }
    const keep = Math.max(this.offset, Math.floor(this.next - half));
    this.kept = all.slice(keep - this.offset);
    this.offset = keep;
    return Float32Array.from(out);
  }
}
