// The fall of a headquarters, as a sequence: the view glides to the building, it blows
// apart, a ruin is left burning, and only then the result screen comes up. This file is
// the timing and the thresholds, with no drawing in it; client/map.js plays it.

// Health (0..1) at or below which a headquarters shows smoke, then fire.
export const SMOKE_AT = 0.66;
export const FIRE_AT = 0.33;

// damageState: 0 intact, 1 smoking, 2 burning, 3 fallen.
export function damageState(health) {
  if (!(health > 0)) return health === undefined || Number.isNaN(health) ? 0 : 3;
  return health <= FIRE_AT ? 2 : health <= SMOKE_AT ? 1 : 0;
}

// fallen is the side whose headquarters was destroyed to end this match, or -1. A match
// that ran out of time has no fallen headquarters.
export function fallen(state) {
  if (!state?.over || state.reason !== "hq_destroyed") return -1;
  return state.winner === 0 || state.winner === 1 ? 1 - state.winner : -1;
}

// timing gives the moments of the sequence in ms after the match ended. With reduced
// motion the view cuts to the building instead of gliding and the wait is shorter.
export function timing(reduced = false) {
  const glide = reduced ? 0 : 950;
  return {
    glide, // the view arrives
    blast: glide + 150, // the first, biggest explosion
    ruin: glide + 150 + 240, // the building is swapped for its ruin, behind the fireball
    aftershocks: [900, 1700, 2500].map((ms) => glide + 150 + ms), // later blasts worth a sound
    overlay: reduced ? 3200 : 5600, // the result screen starts to fade in
  };
}

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

// Finale is one run of the sequence. `from` and `to` are camera settings { cx, cy, zoom }.
export class Finale {
  constructor({ owner, x, y, from, to, t0, reduced = false }) {
    Object.assign(this, { owner, x, y, from, to, t0, reduced });
    this.at = timing(reduced);
    this.steps = [
      ["blast", this.at.blast],
      ["ruin", this.at.ruin],
      ...this.at.aftershocks.map((ms) => ["aftershock", ms]),
      ["overlay", this.at.overlay],
    ];
    this.next = 0;
  }

  // camera is where the view should be now, or null once the glide is over and the
  // player has the view back.
  camera(now) {
    const ms = now - this.t0;
    if (ms >= this.at.glide) return this.arrived ? null : ((this.arrived = true), { ...this.to });
    const k = ease(Math.max(0, ms / this.at.glide));
    const mix = (a, b) => a + (b - a) * k;
    return { cx: mix(this.from.cx, this.to.cx), cy: mix(this.from.cy, this.to.cy), zoom: mix(this.from.zoom, this.to.zoom) };
  }

  // due hands out, once each and in order, the steps whose moment has come.
  due(now) {
    const out = [];
    while (this.next < this.steps.length && now - this.t0 >= this.steps[this.next][1]) out.push(this.steps[this.next++][0]);
    return out;
  }

  // holds says whether the result screen should still wait.
  holds(now) {
    return now - this.t0 < this.at.overlay;
  }
}
