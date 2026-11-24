// Makes a clean voice sound like it came over a tactical radio. Works on a live
// AudioContext and on an OfflineAudioContext alike.
//
//   voice -> drive -> high-pass x2 -> presence peak -> soft clip -> low-pass x2 -> compressor -> out
//   noise -> envelope -> band-pass ----------------------------------^
//
// The noise is the set itself: a short burst as the transmitter keys up, a faint hiss under
// the voice, and a squelch tail when the key is released.

const KEY_UP = 0.07; // seconds of burst before the voice
const TAIL = 0.16; // seconds of squelch after it

const chains = new WeakMap();

function chain(ctx) {
  if (chains.has(ctx)) return chains.get(ctx);
  const biquad = (type, frequency, Q = 0.707, gain = 0) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = Q;
    f.gain.value = gain;
    return f;
  };
  const input = ctx.createGain();
  input.gain.value = 2.2; // drive into the clipper

  const clip = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(2.6 * x) / Math.tanh(2.6);
  }
  clip.curve = curve;
  clip.oversample = "2x";

  const squeeze = ctx.createDynamicsCompressor();
  squeeze.threshold.value = -22;
  squeeze.knee.value = 6;
  squeeze.ratio.value = 7;
  squeeze.attack.value = 0.003;
  squeeze.release.value = 0.12;

  const out = ctx.createGain();
  // The low-pass comes after the clipper, so the harshness clipping adds stays in the band.
  const band = biquad("lowpass", 3100);
  const stages = [input, biquad("highpass", 380), biquad("highpass", 380), biquad("peaking", 1900, 1, 5), clip, band, biquad("lowpass", 3100), squeeze, out];
  for (let i = 1; i < stages.length; i++) stages[i - 1].connect(stages[i]);
  out.connect(ctx.destination);

  // Two seconds of white noise, looped. Seeded, so the same line always renders the same.
  const hiss = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = hiss.getChannelData(0);
  let seed = 0x2f6e2b1;
  for (let i = 0; i < data.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = seed / 0x80000000 - 1;
  }
  const noiseBand = biquad("bandpass", 2100, 0.5);
  noiseBand.connect(band);

  const built = { input, out, hiss, noiseBand };
  chains.set(ctx, built);
  return built;
}

// transmit schedules one voice buffer through the radio, starting at `when` (context time).
// It returns { end, stop }: the context time the transmission is over, and a way to cut it.
export function transmit(ctx, buffer, { when = ctx.currentTime, volume = 1, rate = 1 } = {}) {
  const c = chain(ctx);
  c.out.gain.setValueAtTime(volume, when);

  const voice = ctx.createBufferSource();
  voice.buffer = buffer;
  voice.playbackRate.value = rate;
  voice.connect(c.input);
  const start = when + KEY_UP;
  const stopTalking = start + buffer.duration / rate;
  const end = stopTalking + TAIL;
  voice.start(start);

  const noise = ctx.createBufferSource();
  noise.buffer = c.hiss;
  noise.loop = true;
  const level = ctx.createGain();
  noise.connect(level).connect(c.noiseBand);
  const g = level.gain;
  g.setValueAtTime(0, when);
  g.linearRampToValueAtTime(0.5, when + 0.008); // key up
  g.exponentialRampToValueAtTime(0.03, start); // hiss under the voice
  g.setValueAtTime(0.03, stopTalking);
  g.linearRampToValueAtTime(0.6, stopTalking + 0.012); // squelch tail
  g.exponentialRampToValueAtTime(0.001, end);
  noise.start(when);
  noise.stop(end + 0.02);

  return {
    end,
    stop() {
      for (const node of [voice, noise]) {
        try {
          node.stop();
        } catch {
          // Already stopped.
        }
      }
    },
  };
}

// click plays the key-up burst and the squelch tail around a voice the radio cannot
// process (the browser's own speech synthesis). It returns a function that plays the tail.
export function click(ctx, volume = 1) {
  const c = chain(ctx);
  const burst = (peak, seconds) => {
    const t = ctx.currentTime;
    c.out.gain.setValueAtTime(volume, t);
    const noise = ctx.createBufferSource();
    noise.buffer = c.hiss;
    const level = ctx.createGain();
    noise.connect(level).connect(c.noiseBand);
    level.gain.setValueAtTime(0, t);
    level.gain.linearRampToValueAtTime(peak, t + 0.008);
    level.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    noise.start(t);
    noise.stop(t + seconds + 0.02);
  };
  burst(0.5, KEY_UP);
  return () => burst(0.6, TAIL);
}
