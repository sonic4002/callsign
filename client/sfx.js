// Battle sounds, made in Web Audio from noise bursts, low thumps and short sweeps.
// Nothing is recorded or downloaded.
//
//   each sound -> its own level, low-pass and pan -> bus -> limiter -> master -> out
//
// A fight far from the middle of the view is quieter, duller and off to its side. Only a
// few sounds play at once, and a louder kind pushes a quieter one out, so a big fight is
// a texture and never a wall. Nothing plays before the player's first click or key press.

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// How each unit's weapon looks and sounds. `rounds` shots `gap` ms apart per burst;
// `impact` is what the round does where it lands; `travel` is ms from muzzle to target.
const weapons = {
  commandos: { sound: "rifleA", rounds: 3, gap: 85, impact: "dust", travel: 60 },
  militia: { sound: "rifleB", rounds: 2, gap: 110, impact: "dust", travel: 60 },
  tank: { sound: "cannon", rounds: 1, gap: 0, impact: "shell", travel: 130, heavy: true },
  technical: { sound: "hmg", rounds: 4, gap: 110, impact: "pop", travel: 80, heavy: true },
  patrolBoat: { sound: "autocannon", rounds: 3, gap: 140, impact: "pop", travel: 90, heavy: true },
  speedboat: { sound: "mg", rounds: 5, gap: 75, impact: "dust", travel: 70 },
  helicopter: { sound: "autocannon", rounds: 4, gap: 95, impact: "pop", travel: 80, heavy: true },
  // Rockets are seen in flight: a salvo that climbs, trails smoke and comes down on the target.
  rocketLauncher: { sound: "cannon", rounds: 4, gap: 260, impact: "shell", travel: 1100, heavy: true, rocket: 1 },
  fpvSwarm: { sound: "boomS", rounds: 1, gap: 0, impact: "pop", travel: 40 },
  rpgTeam: { sound: "cannon", rounds: 1, gap: 0, impact: "shell", travel: 480, heavy: true, rocket: 0.25 },
};
const byClass = { infantry: weapons.commandos, vehicle: weapons.technical, naval: weapons.speedboat, air: weapons.helicopter };
export const weaponOf = (unit, cls) => weapons[unit] ?? byClass[cls] ?? weapons.commandos;

// Louder kinds outrank quieter ones when every voice is taken. `gap` is the least time
// in ms between two starts of the same kind; `seconds` is how long one lasts.
export const kinds = {
  rifleA: { pri: 1, gap: 70, seconds: 0.45 },
  rifleB: { pri: 1, gap: 70, seconds: 0.5 },
  mg: { pri: 1, gap: 90, seconds: 0.55 },
  hmg: { pri: 2, gap: 110, seconds: 0.75 },
  autocannon: { pri: 2, gap: 120, seconds: 0.9 },
  splash: { pri: 2, gap: 120, seconds: 1.0 },
  coins: { pri: 1, gap: 400, seconds: 0.7 },
  gush: { pri: 0, gap: 1500, seconds: 1.6 },
  hammer: { pri: 0, gap: 220, seconds: 0.25 },
  built: { pri: 1, gap: 600, seconds: 0.8 },
  door: { pri: 1, gap: 300, seconds: 0.7 },
  cannon: { pri: 3, gap: 90, seconds: 1.9 },
  boomS: { pri: 3, gap: 90, seconds: 1.3 },
  boomM: { pri: 4, gap: 150, seconds: 3.0 },
  boomL: { pri: 5, gap: 400, seconds: 5.5 },
};

// hearing places a sound by where it is on screen: `pan` -1..1, `gain` 0..1 and a
// low-pass `cutoff` in Hz. Past about three half-screens from the middle it is silent.
export function hearing(view, sx, sy, zoom = 1) {
  const dx = (sx - view.w / 2) / (view.w / 2);
  const dy = (sy - view.h / 2) / (view.h / 2);
  const d = Math.hypot(dx, dy);
  if (!Number.isFinite(d) || d > 3.2) return { pan: 0, gain: 0, cutoff: 700 };
  const far = Math.max(0, d - 0.6);
  // Zoomed far out, even the middle of the view is a long way off.
  const height = clamp(0.55 + 0.45 * Math.min(1, zoom / 0.6), 0.55, 1);
  return {
    pan: clamp(dx * 0.8, -1, 1),
    gain: height / (1 + (d / 1.1) ** 2),
    cutoff: Math.max(700, 16000 / (1 + (far * 2.2) ** 2)),
  };
}

// Voices decides which sounds may start. At most `max` play at once.
export class Voices {
  constructor(max = 10) {
    this.max = max;
    this.active = []; // { kind, pri, end, stop }
    this.last = {}; // kind → ms it last started
  }

  // admit returns true when the sound may start now, having made room for it if needed.
  admit(kind, now, stop = () => {}) {
    const k = kinds[kind];
    if (!k) return false;
    this.active = this.active.filter((v) => v.end > now);
    if (now - (this.last[kind] ?? -Infinity) < k.gap) return false;
    if (this.active.length >= this.max) {
      let victim = -1;
      for (let i = 0; i < this.active.length; i++) {
        const v = this.active[i];
        if (v.pri < k.pri && (victim < 0 || v.pri < this.active[victim].pri || (v.pri === this.active[victim].pri && v.end < this.active[victim].end))) victim = i;
      }
      if (victim < 0) return false;
      this.active[victim].stop();
      this.active.splice(victim, 1);
    }
    this.last[kind] = now;
    this.active.push({ kind, pri: k.pri, end: now + k.seconds * 1000, stop });
    return true;
  }
}

// ---- synthesis ----

const noises = new WeakMap();
function noiseBuffer(ctx) {
  if (noises.has(ctx)) return noises.get(ctx);
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noises.set(ctx, buf);
  return buf;
}

// burst is filtered noise that starts sharp and dies away. `f1` sweeps the filter.
function burst(ctx, out, at, seconds, { type = "bandpass", f0 = 1000, f1 = f0, q = 0.8, gain = 1, attack = 0.002 }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) filter.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + seconds);
  const level = ctx.createGain();
  level.gain.setValueAtTime(0.0001, at);
  level.gain.exponentialRampToValueAtTime(gain, at + attack);
  level.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  src.connect(filter).connect(level).connect(out);
  src.start(at, Math.random() * 1.5);
  src.stop(at + seconds + 0.02);
}

// thump is a sine that drops in pitch: the body of a shot or a blast.
function thump(ctx, out, at, seconds, f0, f1, gain) {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(f0, at);
  osc.frequency.exponentialRampToValueAtTime(Math.max(18, f1), at + seconds);
  const level = ctx.createGain();
  level.gain.setValueAtTime(0.0001, at);
  level.gain.exponentialRampToValueAtTime(gain, at + 0.004);
  level.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  osc.connect(level).connect(out);
  osc.start(at);
  osc.stop(at + seconds + 0.02);
}

// crackle is the debris and secondary pops after a blast.
function crackle(ctx, out, at, seconds, count, gain) {
  for (let i = 0; i < count; i++) {
    const when = at + 0.05 + Math.random() ** 1.6 * seconds;
    burst(ctx, out, when, rand(0.015, 0.05), { f0: rand(1400, 3800), q: 1.2, gain: gain * rand(0.4, 1) });
  }
}

function rounds(count, gap, each) {
  for (let i = 0; i < count; i++) each((i * gap + (i ? rand(-0.012, 0.012) : 0)) , i);
}

// Each recipe schedules its nodes into `out` starting at `at` (context seconds).
const recipes = {
  // A light, sharp carbine: a crack with little body.
  rifleA(ctx, out, at) {
    rounds(3, 0.085, (dt) => {
      burst(ctx, out, at + dt, 0.07, { f0: 2300, q: 0.9, gain: 0.8 });
      burst(ctx, out, at + dt, 0.02, { type: "highpass", f0: 4200, gain: 0.45 });
      thump(ctx, out, at + dt, 0.045, 320, 130, 0.3);
    });
    burst(ctx, out, at + 0.2, 0.22, { type: "lowpass", f0: 900, f1: 300, gain: 0.1 });
  },
  // An older, heavier rifle: lower, rounder, with a tail.
  rifleB(ctx, out, at) {
    rounds(2 + (Math.random() < 0.5 ? 1 : 0), 0.11, (dt) => {
      burst(ctx, out, at + dt, 0.11, { f0: 1050, q: 0.75, gain: 0.85 });
      thump(ctx, out, at + dt, 0.085, 175, 68, 0.6);
      burst(ctx, out, at + dt, 0.17, { type: "lowpass", f0: 520, gain: 0.22 });
    });
  },
  // A boat's light machine gun: fast and thin.
  mg(ctx, out, at) {
    rounds(5, 0.075, (dt) => {
      burst(ctx, out, at + dt, 0.06, { f0: 1500, q: 0.9, gain: 0.7 });
      thump(ctx, out, at + dt, 0.05, 230, 95, 0.38);
    });
    burst(ctx, out, at + 0.3, 0.22, { type: "lowpass", f0: 700, f1: 250, gain: 0.1 });
  },
  // The technical's heavy machine gun: slow, thudding rounds.
  hmg(ctx, out, at) {
    rounds(4, 0.11, (dt) => {
      burst(ctx, out, at + dt, 0.12, { f0: 820, q: 0.7, gain: 0.95 });
      thump(ctx, out, at + dt, 0.1, 135, 50, 0.9);
      burst(ctx, out, at + dt, 0.016, { type: "highpass", f0: 3200, gain: 0.35 });
    });
    burst(ctx, out, at + 0.36, 0.34, { type: "lowpass", f0: 600, f1: 200, gain: 0.16 });
  },
  // A patrol boat's cannon: three hard knocks.
  autocannon(ctx, out, at) {
    rounds(3, 0.14, (dt) => {
      burst(ctx, out, at + dt, 0.14, { f0: 1000, q: 0.6, gain: 0.95 });
      thump(ctx, out, at + dt, 0.15, 112, 44, 1.0);
    });
    burst(ctx, out, at + 0.32, 0.5, { type: "lowpass", f0: 650, f1: 180, gain: 0.22 });
  },
  // The tank's main gun: a crack, a deep boom, and the roll after it.
  cannon(ctx, out, at) {
    burst(ctx, out, at, 0.03, { type: "highpass", f0: 2600, gain: 0.6 });
    thump(ctx, out, at, 0.13, 250, 60, 0.75);
    thump(ctx, out, at, 0.65, 96, 26, 1.3);
    burst(ctx, out, at, 0.5, { type: "lowpass", f0: 3000, f1: 150, q: 0.5, gain: 1.1 });
    burst(ctx, out, at + 0.12, 1.6, { type: "lowpass", f0: 380, f1: 120, q: 0.4, gain: 0.32, attack: 0.08 });
  },
  // A shell going off.
  boomS(ctx, out, at) {
    thump(ctx, out, at, 0.5, 82, 30, 1.05);
    burst(ctx, out, at, 0.5, { type: "lowpass", f0: 1900, f1: 120, q: 0.5, gain: 1.0 });
    burst(ctx, out, at + 0.1, 1.0, { type: "lowpass", f0: 320, f1: 110, q: 0.4, gain: 0.22, attack: 0.06 });
    crackle(ctx, out, at, 0.45, 6, 0.2);
  },
  // A vehicle going up: bigger, with a second blast inside it.
  boomM(ctx, out, at) {
    thump(ctx, out, at, 0.85, 72, 24, 1.4);
    burst(ctx, out, at, 0.9, { type: "lowpass", f0: 2300, f1: 90, q: 0.5, gain: 1.25 });
    thump(ctx, out, at + rand(0.28, 0.42), 0.5, 88, 30, 0.8);
    burst(ctx, out, at + 0.35, 0.5, { type: "lowpass", f0: 1500, f1: 110, q: 0.5, gain: 0.6 });
    burst(ctx, out, at + 0.15, 2.6, { type: "lowpass", f0: 300, f1: 80, q: 0.4, gain: 0.36, attack: 0.1 });
    crackle(ctx, out, at, 1.1, 12, 0.24);
  },
  // A headquarters coming down.
  boomL(ctx, out, at) {
    thump(ctx, out, at, 1.5, 62, 20, 1.5);
    burst(ctx, out, at, 1.6, { type: "lowpass", f0: 2600, f1: 70, q: 0.5, gain: 1.35 });
    for (const dt of [0.45, 0.95, 1.6, 2.3]) {
      thump(ctx, out, at + dt, 0.7, rand(70, 95), 26, 0.85);
      burst(ctx, out, at + dt, 0.7, { type: "lowpass", f0: 1700, f1: 100, q: 0.5, gain: 0.7 });
    }
    burst(ctx, out, at + 0.2, 4.8, { type: "lowpass", f0: 280, f1: 60, q: 0.4, gain: 0.42, attack: 0.15 });
    crackle(ctx, out, at, 3.2, 26, 0.24);
  },
  // Gold tipped out of a hauler: a rattle of small bright rings.
  coins(ctx, out, at) {
    for (let i = 0; i < 9; i++) {
      const when = at + i * 0.045 + Math.random() * 0.02;
      const f = rand(2600, 5200);
      burst(ctx, out, when, 0.09, { f0: f, q: 9, gain: 0.32 });
      burst(ctx, out, when, 0.03, { type: "highpass", f0: 6000, gain: 0.12 });
    }
    burst(ctx, out, at, 0.5, { type: "lowpass", f0: 700, f1: 240, gain: 0.12, attack: 0.03 });
  },
  // A gusher: a rush of grit thrown up, with a faint glitter in it.
  gush(ctx, out, at) {
    burst(ctx, out, at, 1.5, { f0: 520, f1: 1500, q: 0.6, gain: 0.16, attack: 0.35 });
    burst(ctx, out, at + 0.2, 1.1, { type: "highpass", f0: 5200, gain: 0.035, attack: 0.3 });
    for (let i = 0; i < 4; i++) burst(ctx, out, at + 0.5 + i * 0.17 + Math.random() * 0.08, 0.06, { f0: rand(3400, 5600), q: 10, gain: 0.07 });
  },
  // A building site: one blow of a hammer on steel.
  hammer(ctx, out, at) {
    burst(ctx, out, at, 0.06, { f0: rand(1700, 2700), q: 11, gain: 0.3 });
    thump(ctx, out, at, 0.06, 190, 90, 0.22);
  },
  // A structure finished: two rising notes.
  built(ctx, out, at) {
    burst(ctx, out, at, 0.28, { f0: 620, q: 13, gain: 0.32 });
    burst(ctx, out, at + 0.15, 0.4, { f0: 930, q: 13, gain: 0.32 });
  },
  // A unit coming out: a door rolling up, and the thud when it stops.
  door(ctx, out, at) {
    burst(ctx, out, at, 0.5, { type: "lowpass", f0: 320, f1: 900, q: 2, gain: 0.22, attack: 0.1 });
    thump(ctx, out, at + 0.45, 0.1, 130, 60, 0.3);
  },
  // Water thrown up and falling back.
  splash(ctx, out, at) {
    thump(ctx, out, at, 0.22, 120, 45, 0.5);
    burst(ctx, out, at, 0.85, { f0: 2300, f1: 520, q: 0.5, gain: 0.65, attack: 0.05 });
    burst(ctx, out, at + 0.25, 0.7, { f0: 1800, q: 0.4, gain: 0.1, attack: 0.15 });
  },
};

// synth schedules one sound into `out`. Exported so sounds can be rendered offline.
export function synth(ctx, out, kind, at = ctx.currentTime) {
  recipes[kind]?.(ctx, out, at);
}

// limiter keeps a busy fight from clipping.
export function limiter(ctx) {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 8;
  comp.ratio.value = 12;
  comp.attack.value = 0.002;
  comp.release.value = 0.18;
  return comp;
}

const LOUD = 0.55; // battle sounds at full volume, against music and voices at 1
const DUCKED = 0.4; // while a radio voice is speaking

export class Sfx {
  // level() is the player's volume, 0..1, and 0 when muted.
  constructor({ level = () => 0.7, max = 10 } = {}) {
    this.level = level;
    this.voices = new Voices(max);
    this.ctx = null;
    this.ducked = false;
    this.shown = -1;
    if (typeof addEventListener === "function") {
      for (const kind of ["pointerdown", "keydown"]) addEventListener(kind, () => this.unlock(), { once: true });
    }
  }

  // unlock must be called from a click or key press. Safe to call many times.
  unlock() {
    if (this.ctx) return;
    const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    try {
      this.ctx = Ctx ? new Ctx() : null;
    } catch {
      this.ctx = null;
    }
    if (!this.ctx) return;
    this.bus = limiter(this.ctx);
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.bus.connect(this.master).connect(this.ctx.destination);
    this.refresh();
  }

  // duck lowers the battle while a radio voice is speaking.
  duck(on) {
    this.ducked = on;
    this.refresh();
  }

  // refresh follows the volume slider and the mute button. Cheap; call it every frame.
  refresh() {
    if (!this.master) return;
    const v = clamp(this.level(), 0, 1) * LOUD * (this.ducked ? DUCKED : 1);
    if (v === this.shown) return;
    this.shown = v;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  // play starts one sound as heard from `where` (see hearing), `delay` ms from now.
  play(kind, where, delay = 0) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || !kinds[kind] || !where || where.gain < 0.02 || this.level() <= 0) return false;
    const now = performance.now() + delay;
    const level = ctx.createGain();
    level.gain.value = where.gain * rand(0.85, 1);
    if (!this.voices.admit(kind, now, () => level.gain.setTargetAtTime(0, ctx.currentTime, 0.03))) return false;
    const dull = ctx.createBiquadFilter();
    dull.type = "lowpass";
    dull.frequency.value = where.cutoff;
    const tail = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (tail.pan) tail.pan.value = where.pan;
    level.connect(dull).connect(tail).connect(this.bus);
    synth(ctx, level, kind, ctx.currentTime + delay / 1000 + 0.005);
    setTimeout(() => tail.disconnect(), delay + kinds[kind].seconds * 1000 + 300);
    return true;
  }
}
