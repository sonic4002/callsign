// Battle effects: shell bursts, burning wrecks, water plumes, dust and scorch marks.
// Everything is drawn in code from a few soft blob textures; nothing is downloaded.
//
// Positions are world coordinates on the ground plus a height `h` above it. Sizes and
// heights are in the same units the troops are drawn in, so effects keep their proportion
// to the sprites at every zoom. All particles live in one bounded pool: a big fight gets
// thinner smoke, never a slower frame.

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);

export const LIMITS = { particles: 640, decals: 40, emitters: 10 };

// Pool holds at most `cap` items. When it is full a new item only gets in by replacing
// the oldest item of lower priority.
export class Pool {
  constructor(cap) {
    this.cap = cap;
    this.items = [];
  }

  add(item) {
    if (this.items.length < this.cap) {
      this.items.push(item);
      return true;
    }
    let victim = -1;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.pri < item.pri && (victim < 0 || it.t0 < this.items[victim].t0)) victim = i;
    }
    if (victim < 0) return false;
    this.items[victim] = item;
    return true;
  }

  // sweep drops what has run its time.
  sweep(now) {
    let n = 0;
    for (const it of this.items) if (now - it.t0 < it.ttl) this.items[n++] = it;
    this.items.length = n;
  }

  clear() {
    this.items.length = 0;
  }
}

// nearness is 1 for a blast at the middle of the view and 0 for one well outside it.
export function nearness(view, sx, sy) {
  const d = Math.hypot((sx - view.w / 2) / (view.w / 2), (sy - view.h / 2) / (view.h / 2));
  return Math.max(0, Math.min(1, 1.25 - d));
}

const textures = {};
const stops = {
  flash: [[0, "rgba(255,255,255,1)"], [0.35, "rgba(255,244,190,0.95)"], [1, "rgba(255,190,80,0)"]],
  fireY: [[0, "rgba(255,250,210,1)"], [0.4, "rgba(255,214,96,0.9)"], [1, "rgba(255,140,30,0)"]],
  fireO: [[0, "rgba(255,196,84,0.95)"], [0.5, "rgba(244,112,28,0.8)"], [1, "rgba(150,40,10,0)"]],
  fireR: [[0, "rgba(214,84,26,0.8)"], [0.55, "rgba(120,34,14,0.55)"], [1, "rgba(40,20,14,0)"]],
  smokeD: [[0, "rgba(34,31,29,0.95)"], [0.55, "rgba(46,42,39,0.7)"], [1, "rgba(60,56,52,0)"]],
  smokeL: [[0, "rgba(122,116,106,0.9)"], [0.55, "rgba(140,134,124,0.6)"], [1, "rgba(160,155,146,0)"]],
  dust: [[0, "rgba(176,156,118,0.9)"], [0.6, "rgba(160,142,108,0.55)"], [1, "rgba(150,134,104,0)"]],
  scorch: [[0, "rgba(14,12,10,0.62)"], [0.55, "rgba(24,20,17,0.4)"], [1, "rgba(30,26,22,0)"]],
  water: [[0, "rgba(244,252,255,0.95)"], [0.5, "rgba(206,232,240,0.7)"], [1, "rgba(170,210,224,0)"]],
};

function texture(name) {
  if (textures[name]) return textures[name];
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [at, color] of stops[name]) grad.addColorStop(at, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return (textures[name] = c);
}

export class Fx {
  constructor({ reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false } = {}) {
    this.reducedMotion = reducedMotion;
    this.pool = new Pool(LIMITS.particles);
    this.decals = new Pool(LIMITS.decals);
    this.emitters = new Pool(LIMITS.emitters);
    this.water = () => false; // (x, y) → whether that spot of the map is open water
    this.kick = 0; // pixels of screen shake still to play out
    this.kicks = []; // jolts waiting for their blast
    this.view = null; // { w, h, screen(x, y) } of the last frame, for culling and shake
    this.smolders = new Map(); // id → when that fire next puts out smoke
  }

  // reset clears everything for a new map. `water` says where a shell makes a splash:
  // a function of (x, y), or, as before there was terrain, the y the sea starts at.
  reset(water = () => false) {
    this.water = typeof water === "function" ? water : (x, y) => y >= water;
    this.pool.clear();
    this.decals.clear();
    this.emitters.clear();
    this.kick = 0;
    this.kicks = [];
    this.smolders.clear();
  }

  onWater(x, y) {
    return this.water(x, y);
  }

  // onScreen says whether a point is in or near the view. Effects elsewhere are skipped.
  onScreen(x, y, margin = 160) {
    if (!this.view) return true;
    const [sx, sy] = this.view.screen(x, y);
    return sx > -margin && sx < this.view.w + margin && sy > -margin && sy < this.view.h + margin;
  }

  // ---- building blocks ----

  blob(tex, x, y, o) {
    return this.pool.add({ kind: "blob", tex, x, y, h: 0, vx: 0, vy: 0, vh: 0, g: 0, drag: 0, r0: 4, r1: 8, a: 1, add: false, pri: 1, ...o });
  }

  speck(color, x, y, o) {
    return this.pool.add({ kind: "speck", color, x, y, h: 2, vx: 0, vy: 0, vh: 0, g: 260, drag: 0.4, size: 1.5, add: false, pri: 1, ...o });
  }

  ring(x, y, o) {
    return this.pool.add({ kind: "ring", x, y, r0: 5, r1: 30, a: 0.5, color: "255,236,200", pri: 1, ...o });
  }

  scorch(x, y, now, r, ttl = 24_000) {
    this.decals.add({ x, y, r, t0: now, ttl, pri: 1 });
  }

  // shake jolts the view at time `at`, harder the nearer the blast is to its middle.
  shake(x, y, amount, at = 0) {
    if (amount <= 0 || this.reducedMotion() || !this.view) return;
    const [sx, sy] = this.view.screen(x, y);
    const kick = amount * nearness(this.view, sx, sy);
    if (kick > 0.2 && this.kicks.length < 24) this.kicks.push({ at, kick });
  }

  // ---- effects ----

  // dust is a bullet striking the ground, or a soldier going down.
  dust(x, y, now, s = 1) {
    if (!this.onScreen(x, y)) return;
    if (this.onWater(x, y)) return this.spray(x, y, now, 0.35 * s);
    for (let i = 0; i < 2; i++) {
      this.blob("dust", x + rand(-3, 3), y + rand(-3, 3), { t0: now + i * 30, ttl: rand(320, 520), r0: 2 * s, r1: rand(6, 9) * s, a: 0.6, vh: rand(8, 18), h: 1, pri: 0 });
    }
    this.speck("#5a4d38", x, y, { t0: now, ttl: 380, vx: rand(-16, 16), vy: rand(-16, 16), vh: rand(40, 80), size: 1.1, pri: 0 });
  }

  // spray is a shot or a shell landing in the sea.
  spray(x, y, now, s = 1) {
    if (!this.onScreen(x, y)) return;
    const n = Math.round(4 + 6 * s);
    for (let i = 0; i < n; i++) {
      const up = rand(80, 190) * Math.sqrt(s);
      this.blob("water", x + rand(-3, 3) * s, y + rand(-3, 3) * s, { t0: now + rand(0, 90), ttl: rand(750, 1150), r0: 3 * s, r1: rand(8, 13) * s, a: 0.9, vh: up, g: 230, vx: rand(-8, 8) * s, vy: rand(-8, 8) * s, h: 1, pri: 1 });
    }
    for (let i = 0; i < n + 2; i++) {
      this.speck("#eaf7fb", x, y, { t0: now + rand(0, 90), ttl: 900, vx: rand(-34, 34) * s, vy: rand(-34, 34) * s, vh: rand(70, 170) * Math.sqrt(s), g: 300, size: 1.3, pri: 0 });
    }
    this.ring(x, y, { t0: now + 60, ttl: 800, r0: 4 * s, r1: 30 * s, a: 0.55, color: "232,246,250" });
    this.ring(x, y, { t0: now + 260, ttl: 900, r0: 3 * s, r1: 20 * s, a: 0.35, color: "232,246,250" });
  }

  // blast is an explosion of size `s`: 1 is a tank shell, about 1.8 a vehicle going up.
  blast(x, y, now, s = 1, { h = 3, scorch = true, pri = 2, shake = 2.6 } = {}) {
    if (!this.onScreen(x, y)) return;
    const root = Math.sqrt(s);
    this.blob("flash", x, y, { t0: now, ttl: 120, r0: 9 * s, r1: 30 * s, a: 1, add: true, h: h + 4 * s, pri });
    for (let i = 0, n = Math.round(4 + 4 * s); i < n; i++) {
      const dir = rand(0, TAU);
      const sp = rand(6, 26) * s;
      this.blob("fire", x, y, { t0: now + rand(0, 50), ttl: rand(330, 620) * root, r0: rand(4, 7) * s, r1: rand(10, 16) * s, a: 0.95, add: true, vx: Math.cos(dir) * sp, vy: Math.sin(dir) * sp, vh: rand(12, 38) * s, drag: 3, h: h + rand(0, 6) * s, pri });
    }
    for (let i = 0, n = Math.round(4 + 4 * s); i < n; i++) {
      const dir = rand(0, TAU);
      const sp = rand(3, 14) * s;
      this.blob(Math.random() < 0.65 ? "smokeD" : "smokeL", x, y, { t0: now + rand(80, 320), ttl: rand(1500, 2700) * root, r0: rand(5, 8) * s, r1: rand(17, 27) * s, a: 0.62, vx: 5 + Math.cos(dir) * sp, vy: -3 + Math.sin(dir) * sp, vh: rand(14, 30), drag: 1.1, h: h + rand(2, 10) * s, pri: pri - 1 });
    }
    for (let i = 0, n = Math.round(5 + 4 * s); i < n; i++) {
      const dir = rand(0, TAU);
      const sp = rand(26, 84) * root;
      this.speck(Math.random() < 0.3 ? "#2b241d" : "#4a3f30", x, y, { t0: now, ttl: 1400, vx: Math.cos(dir) * sp, vy: Math.sin(dir) * sp, vh: rand(70, 170) * root, size: rand(1.2, 2.4) * root, pri: pri - 1 });
    }
    for (let i = 0, n = Math.round(3 + 3 * s); i < n; i++) {
      const dir = rand(0, TAU);
      const sp = rand(40, 120) * root;
      this.speck("#ffd68a", x, y, { t0: now, ttl: rand(260, 480), vx: Math.cos(dir) * sp, vy: Math.sin(dir) * sp, vh: rand(60, 150) * root, size: 1.2, add: true, g: 200, pri: pri - 1 });
    }
    this.ring(x, y, { t0: now, ttl: 380, r0: 6 * s, r1: 36 * s, a: 0.5 });
    if (scorch) this.scorch(x, y, now, rand(9, 12) * s);
    this.shake(x, y, shake * s, now);
  }

  // pop is a small round bursting: a heavy machine gun or a boat's cannon.
  pop(x, y, now) {
    if (!this.onScreen(x, y)) return;
    if (this.onWater(x, y)) return this.spray(x, y, now, 0.3);
    this.blob("flash", x, y, { t0: now, ttl: 90, r0: 3, r1: 9, a: 0.95, add: true, h: 3 });
    this.blob("fire", x, y, { t0: now, ttl: rand(180, 260), r0: 2.5, r1: 6, a: 0.9, add: true, vh: 14, h: 3 });
    this.blob("dust", x, y, { t0: now + 60, ttl: rand(500, 800), r0: 3, r1: rand(8, 11), a: 0.55, vh: rand(10, 20), h: 3, pri: 0 });
    for (let i = 0; i < 2; i++) this.speck("#4a3f30", x, y, { t0: now, ttl: 700, vx: rand(-30, 30), vy: rand(-30, 30), vh: rand(50, 100), size: 1.2, pri: 0 });
  }

  // shell is where a round lands: a burst on the ground, a plume in the sea.
  // coins is gold pouring out of a hauler at the drop-off: a small bright shower.
  coins(x, y, now) {
    if (!this.onScreen(x, y)) return;
    this.blob("flash", x, y, { t0: now, ttl: 160, r0: 2, r1: 8, a: 0.5, add: true, h: 6 });
    for (let i = 0; i < 9; i++) {
      this.speck(i % 3 ? "#f0c95a" : "#fff3b8", x, y, { t0: now + i * 35, ttl: rand(450, 750), vx: rand(-26, 26), vy: rand(-26, 26), vh: rand(60, 120), size: 1.4, pri: 0 });
    }
  }

  shell(x, y, now, s = 1) {
    if (this.onWater(x, y)) {
      this.spray(x, y, now, 1.1 * s);
      this.shake(x, y, 1.2 * s, now);
    } else {
      this.blast(x, y, now, s);
    }
  }

  // column is smoke that keeps rising from a wreck, with flames at its foot at first.
  column(x, y, now, seconds, s = 1) {
    this.emitters.add({ x, y, t0: now, ttl: seconds * 1000, next: now + 250, s, pri: 1 });
  }

  // wreck is a vehicle destroyed: the main blast, smaller ones after it, then smoke.
  wreck(x, y, now, s = 1.8) {
    this.blast(x, y, now, s, { h: 5, pri: 3, shake: 3 });
    for (let i = 0, n = 2 + Math.floor(Math.random() * 2); i < n; i++) {
      this.blast(x + rand(-10, 10), y + rand(-10, 10), now + rand(240, 1100), rand(0.45, 0.75), { h: 6, scorch: false, pri: 2, shake: 1.5 });
    }
    this.column(x, y, now, 13, s * 0.6);
  }

  // sinking is a boat destroyed: a burst on deck, then the sea closing over it.
  sinking(x, y, now, s = 1.5) {
    this.blast(x, y, now, s * 0.7, { h: 7, scorch: false, pri: 3, shake: 3 });
    this.spray(x, y, now + 120, s * 1.3);
    this.spray(x + rand(-12, 12), y + rand(-8, 8), now + 620, s * 0.8);
    this.column(x, y, now, 3.5, s * 0.4);
  }

  // strike is a hit on a building: a burst some way up its walls and falling rubble.
  strike(x, y, now, s = 1.1) {
    this.blast(x + rand(-22, 22), y + rand(-22, 22), now, s, { h: rand(8, 34), scorch: false, shake: 2.2 });
  }

  // collapse is a headquarters destroyed: one great blast that throws the building
  // apart, a shock wave and a wall of dust across the ground, smaller blasts walking
  // through what is left, then a long fire.
  collapse(x, y, now) {
    this.blast(x, y, now, 3.6, { h: 16, pri: 4, shake: 3.3 });
    this.blob("flash", x, y, { t0: now, ttl: 260, r0: 40, r1: 150, a: 0.9, add: true, h: 20, pri: 4 });
    this.ring(x, y, { t0: now + 40, ttl: 900, r0: 14, r1: 150, a: 0.6 });
    this.ring(x, y, { t0: now + 220, ttl: 1100, r0: 10, r1: 110, a: 0.35 });
    // Pieces of the building, thrown high and far.
    for (let i = 0; i < 34; i++) {
      const dir = rand(0, TAU);
      const sp = rand(30, 150);
      this.speck(["#59636b", "#3c4348", "#8b97a0", "#6b5a45", "#2a2622"][i % 5], x + rand(-14, 14), y + rand(-14, 14), { t0: now + rand(0, 90), ttl: 2600, vx: Math.cos(dir) * sp, vy: Math.sin(dir) * sp, vh: rand(120, 330), g: 300, size: rand(2.2, 4.6), h: rand(6, 30), pri: 3 });
    }
    // Dust rolling out along the ground.
    for (let i = 0; i < 14; i++) {
      const dir = (i / 14) * TAU + rand(-0.2, 0.2);
      const sp = rand(34, 70);
      this.blob("dust", x, y, { t0: now + rand(120, 380), ttl: rand(1900, 2900), r0: 9, r1: rand(30, 44), a: 0.6, vx: Math.cos(dir) * sp, vy: Math.sin(dir) * sp, vh: rand(4, 12), drag: 1.3, h: 2, pri: 2 });
    }
    for (let i = 0; i < 9; i++) {
      this.blast(x + rand(-38, 38), y + rand(-38, 38), now + 260 + i * rand(210, 330), rand(1.1, 2.2), { h: rand(4, 36), pri: 3, shake: 2.6 });
    }
    this.column(x - 12, y + 6, now + 300, 40, 2.1);
    this.column(x + 14, y - 8, now + 1100, 40, 1.7);
  }

  // smolder is a building on fire for as long as it is called, once a frame: level 1 is a
  // thread of smoke from the roof, 2 is flames and dark smoke, 3 is a ruin burning low.
  // `id` names the fire, `roof` is how high above the ground it burns.
  smolder(id, x, y, now, level, roof = 30) {
    if (level <= 0 || now < (this.smolders.get(id) ?? 0)) return;
    this.smolders.set(id, now + [0, 300, 170, 190][level]);
    if (!this.onScreen(x, y)) return;
    const big = level === 1 ? 0.75 : level === 2 ? 1.25 : 1.1;
    const h = level === 3 ? roof * 0.3 : roof;
    const spots = level === 1 ? [[6, -4]] : level === 2 ? [[6, -4], [-10, 6]] : [[-12, 6], [12, -6], [0, 12]];
    const [ox, oy] = spots[Math.floor(Math.random() * spots.length)];
    this.blob(level === 1 && Math.random() < 0.6 ? "smokeL" : "smokeD", x + ox + rand(-3, 3), y + oy + rand(-3, 3), { t0: now, ttl: rand(2400, 3600), r0: 4 * big, r1: rand(15, 23) * big, a: level === 1 ? 0.34 : 0.5, vx: 7, vy: -4, vh: rand(22, 36), drag: 0.25, h, pri: 0 });
    if (level >= 2) {
      this.blob("fire", x + ox + rand(-4, 4), y + oy + rand(-4, 4), { t0: now, ttl: rand(300, 480), r0: 4 * big, r1: 9 * big, a: 0.85, add: true, vh: rand(14, 28), h: h - 3, pri: 0 });
      if (Math.random() < 0.25) this.speck("#ffd68a", x + ox, y + oy, { t0: now, ttl: 700, vx: rand(-14, 14), vy: rand(-14, 14), vh: rand(40, 90), g: 60, size: 1.1, add: true, h, pri: 0 });
    }
  }

  // ---- frame ----

  update(now, dt) {
    this.pool.sweep(now);
    this.decals.sweep(now);
    this.emitters.sweep(now);
    this.kicks = this.kicks.filter((j) => (j.at > now ? true : ((this.kick = Math.max(this.kick, j.kick)), false)));
    this.kick *= Math.exp(-dt * 7);
    if (this.kick < 0.15) this.kick = 0;

    for (const e of this.emitters.items) {
      if (now < e.t0) continue;
      const age = (now - e.t0) / e.ttl;
      let guard = 0;
      while (e.next <= now && guard++ < 3) {
        e.next += 150 + 90 * age;
        if (!this.onScreen(e.x, e.y)) continue;
        const s = e.s;
        this.blob(Math.random() < 0.7 ? "smokeD" : "smokeL", e.x + rand(-3, 3), e.y + rand(-3, 3), { t0: now, ttl: rand(2600, 3800), r0: 5 * s, r1: rand(18, 26) * s, a: 0.5 * (1 - 0.65 * age), vx: 7, vy: -4, vh: rand(26, 40), drag: 0.25, h: 6, pri: 0 });
        if (age < 0.4) this.blob("fire", e.x + rand(-4, 4) * s, e.y + rand(-4, 4) * s, { t0: now, ttl: rand(260, 420), r0: 4 * s, r1: 8 * s, a: 0.85 * (1 - age * 2), add: true, vh: rand(16, 30), h: 5, pri: 0 });
      }
    }

    for (const p of this.pool.items) {
      if (now < p.t0 || p.kind === "ring") continue;
      const slow = Math.exp(-p.drag * dt);
      p.vx *= slow;
      p.vy *= slow;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vh -= p.g * dt;
      p.h += p.vh * dt;
      if (p.h < 0) {
        p.h = 0;
        if (p.g) p.ttl = Math.min(p.ttl, now - p.t0 + (p.kind === "speck" ? 0 : 160)); // it landed
        p.vh = 0;
        p.vx = p.vy = 0;
      }
    }
  }

  // offset is how far the whole view is shaken this frame, in pixels.
  offset(now) {
    if (!this.kick) return [0, 0];
    return [Math.sin(now * 0.083) * this.kick, Math.cos(now * 0.117) * this.kick * 0.7];
  }

  // drawGround paints what lies flat: scorch marks and shock rings. Call it before the
  // troops and buildings are drawn.
  drawGround(ctx, view, k, now) {
    this.view = view;
    for (const d of this.decals.items) {
      const [sx, sy] = view.screen(d.x, d.y);
      if (sx < -80 || sx > view.w + 80 || sy < -80 || sy > view.h + 80) continue;
      const life = (now - d.t0) / d.ttl;
      const fade = Math.max(0, Math.min(1, (1 - life) * 3.5) * Math.min(1, (now - d.t0) / 250));
      const rx = d.r * k * 1.5;
      ctx.globalAlpha = fade;
      ctx.drawImage(texture("scorch"), sx - rx, sy - rx / 2, 2 * rx, rx);
    }
    ctx.globalAlpha = 1;
    for (const p of this.pool.items) {
      if (p.kind !== "ring" || now < p.t0) continue;
      const [sx, sy] = view.screen(p.x, p.y);
      const life = (now - p.t0) / p.ttl;
      const r = (p.r0 + (p.r1 - p.r0) * (1 - (1 - life) ** 2)) * k;
      ctx.strokeStyle = `rgba(${p.color},${p.a * (1 - life)})`;
      ctx.lineWidth = Math.max(1, 2.4 * k * (1 - life));
      ctx.beginPath();
      ctx.ellipse(sx, sy, r * 1.4, r * 0.7, 0, 0, TAU);
      ctx.stroke();
    }
  }

  // draw paints everything that stands in the air: smoke first, then fire over it.
  draw(ctx, view, k, now) {
    this.view = view;
    const live = [];
    for (const p of this.pool.items) {
      if (p.kind === "ring" || now < p.t0) continue;
      const [sx, gy] = view.screen(p.x, p.y);
      if (sx < -70 || sx > view.w + 70 || gy < -70 || gy > view.h + 260) continue;
      p.sx = sx;
      p.sy = gy - p.h * k;
      live.push(p);
    }
    for (const pass of [false, true]) {
      ctx.globalCompositeOperation = pass ? "lighter" : "source-over";
      for (const p of live) {
        if (Boolean(p.add) !== pass) continue;
        const life = (now - p.t0) / p.ttl;
        if (p.kind === "speck") {
          ctx.globalAlpha = Math.min(1, (1 - life) * 4);
          ctx.fillStyle = p.color;
          const s = Math.max(1, p.size * k);
          ctx.fillRect(p.sx - s / 2, p.sy - s / 2, s, s);
          continue;
        }
        const r = (p.r0 + (p.r1 - p.r0) * (1 - (1 - life) ** 2)) * k;
        const tex = p.tex === "fire" ? (life < 0.3 ? "fireY" : life < 0.62 ? "fireO" : "fireR") : p.tex;
        ctx.globalAlpha = p.a * Math.min(1, life * 12) * (1 - life) ** (p.add ? 1 : 1.5);
        ctx.drawImage(texture(tex), p.sx - r, p.sy - r, 2 * r, 2 * r);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}
