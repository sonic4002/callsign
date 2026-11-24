// The battlefield: terrain baked once, then every frame the points, buildings, fireteams,
// gunfire and labels, sorted by depth. It draws only what the server sent this side.

import { casualtySeconds, drawBuilding, drawCasualty, drawUnit, hasAnimation, sprites } from "./art.js";
import { Fog } from "./fog.js";
import { Finale, damageState, fallen } from "./finale.js";
import { Fx } from "./fx.js";
import { Camera, groundEllipse, toIso } from "./iso.js";
import { hearing, weaponOf } from "./sfx.js";
import { coverPercent, drawBridge, drawMiniMap, drawScenery, isWater, landmarkFallbacks, paintGround, placeAt, scenery } from "./terrain.js";
import { pixelRatio, smoothing } from "./touch.js";

export const sideColor = { [-1]: "#cfd3c8", 0: "#4da3ff", 1: "#ff6b4a" };
const nerveColor = { steady: "#63d68a", shaken: "#f0c04a", pinned: "#ff5a5a" };
const TAU = Math.PI * 2;
const RES = 1.5; // terrain is baked at this many pixels per iso unit, less on a big map
const BAKE_PIXELS = 11e6; // the most pixels the baked terrain may have: phones refuse more
const MARGIN = 90;

// A small seeded generator, so the terrain looks the same on every load.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export class Scene {
  constructor(canvas, radar, { lang, showNerve, side }) {
    this.side = side;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.radar = radar;
    this.rctx = radar.getContext("2d");
    this.lang = lang; // () => "en" | "he"
    this.showNerve = showNerve; // () => boolean
    this.cam = new Camera();
    this.rules = null;
    this.state = null;
    this.groups = new Map(); // squad id → what is drawn for it
    this.effects = [];
    this.fx = new Fx(); // blasts, smoke, spray and scorch marks
    this.sfx = null; // battle sounds; the page sets it once it has a volume to follow
    this.hqSeen = null; // headquarters health as of the last state, to notice hits
    this.hqHitAt = [-1e9, -1e9];
    this.finale = null; // the fall of a headquarters, while it plays
    this.ruined = [false, false]; // which side's headquarters lies in ruins
    this.sawLive = false; // this page has seen the match running, so its end is news
    this.onFinale = null; // the page's hook: called when the result screen may come up
    this.selected = 0;
    this.last = performance.now();
    this.waves = [];
  }

  setRules(rules) {
    this.rules = rules;
    this.groups.clear();
    this.effects = [];
    this.fx.reset((x, y) => isWater(rules, x, y, (id) => this.bridges.get(id)?.standing ?? true));
    this.lands = new Map(); // landmark id → its state when it differs from the map's
    this.bridges = new Map(); // bridge id → { hp, standing } as last seen
    this.hover = null; // { x, y } of the pointer over the view, in CSS pixels
    this.named = null; // { id, until }: a landmark or bridge whose name is shown for a moment
    this.radarBase = null;
    this.hqSeen = null;
    this.finale = null;
    this.ruined = [false, false];
    this.sawLive = false;
    this.selected = 0;
    this.factionOf = {};
    this.unitOf = {};
    for (const [faction, f] of Object.entries(rules.factions)) {
      for (const [id, u] of Object.entries(f.units)) {
        this.factionOf[id] = faction;
        this.unitOf[id] = u;
      }
    }
    this.hqFaction = {}; // filled as squads are seen
    this.cam.setWorld(rules.map.width, rules.map.height);
    const hq = rules.map.points.find((p) => p.kind === "hq" && p.owner === this.side);
    this.cam.home = hq ? [hq.x + (hq.x < rules.map.width / 2 ? 260 : -260), hq.y] : null;
    this.fog = new Fog(rules);
    this.bake();
    this.resize();
  }

  resize() {
    const box = this.canvas.parentElement.getBoundingClientRect();
    const dpr = pixelRatio();
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(box.width * dpr));
    this.canvas.height = Math.max(1, Math.round(box.height * dpr));
    this.canvas.style.width = `${box.width}px`;
    this.canvas.style.height = `${box.height}px`;
    if (this.rules) this.cam.resize(box.width, box.height);
    const rw = this.radar.clientWidth || 200;
    const rh = this.rules ? Math.round((rw * this.rules.map.height) / this.rules.map.width) : rw * 0.625;
    this.radar.width = Math.round(rw * dpr);
    this.radar.height = Math.round(rh * dpr);
    this.radar.style.height = `${rh}px`;
  }

  // ---- state ----

  setState(state) {
    this.state = state;
    this.lands = new Map((state.landmarks ?? []).map((l) => [l.id, l]));
    const bridges = new Map((state.bridges ?? []).map((b) => [b.id, b]));
    if ([...bridges].some(([id, b]) => this.bridges.get(id)?.standing !== b.standing)) this.radarBase = null;
    this.bridges = bridges;
    const seen = new Set();
    const groups = [
      ...state.squads.map((s) => ({ ...s, own: true })),
      ...state.contacts.map((c) => ({ ...c, own: false })),
    ];
    for (const g of groups) {
      seen.add(g.id);
      const faction = this.factionOf[g.unit];
      this.hqFaction[g.side] = faction;
      let group = this.groups.get(g.id);
      if (!group) {
        group = { visuals: [] };
        this.groups.set(g.id, group);
      }
      // `small` is a squad of many small figures (soldiers, drones) and not one big machine;
      // `air` is anything that flies.
      const stats = this.unitOf[g.unit];
      Object.assign(group, { id: g.id, side: g.side, unit: g.unit, cls: g.class, faction, own: g.own, view: g, small: (stats?.members ?? 1) > 1, air: stats?.domain === "air" });
      // Teams arrive as a list of the living, so each is matched to the nearest one
      // already on screen instead of by its place in the list.
      const free = new Set(group.visuals);
      const next = [];
      for (const tm of g.teams ?? []) {
        let best = null;
        let bd = 150;
        for (const v of free) {
          const d = Math.hypot(v.tx - tm.x, v.ty - tm.y);
          if (d < bd) [best, bd] = [v, d];
        }
        if (best) free.delete(best);
        else best = { x: tm.x, y: tm.y, turn: g.side === 0 ? 0.4 : Math.PI - 0.4, seed: Math.random() * 10, nextShot: 0, members: tm.members };
        // Losses inside a building are not seen from outside.
        if (tm.members < best.members && !tm.in) {
          this.lose(group, best, false);
          if (group.small) this.fall(group, best, best.members - tm.members);
        }
        Object.assign(best, { tx: tm.x, ty: tm.y, members: tm.members, action: tm.action, nerve: tm.nerve, in: tm.in ?? "", cover: tm.cover ?? 0 });
        next.push(best);
      }
      for (const lost of free) {
        this.lose(group, lost, true);
        this.fall(group, lost, lost.members);
      }
      group.visuals = next;
    }
    for (const [id, group] of this.groups) {
      if (seen.has(id)) continue;
      // Our own squad vanishing means it was destroyed; a contact may just be out of sight.
      // A contact that was being shot at a moment ago was destroyed too.
      const now = performance.now();
      for (const v of group.visuals) {
        if (!group.own && !(now - v.hitAt < 2500)) continue;
        this.lose(group, v, true);
        this.fall(group, v, v.members);
      }
      this.groups.delete(id);
    }
    if (this.selected && !state.squads.some((s) => s.id === this.selected)) this.selected = 0;
    this.hqWatch(state);
  }

  // fall leaves what is left of `count` soldiers, or of a vehicle or boat, where it was.
  fall(group, v, count) {
    const ttl = casualtySeconds(group.unit, group.cls) * 1000;
    if (!ttl) return;
    const one = !group.small;
    for (let i = 0; i < (one ? 1 : count); i++) {
      const spread = () => (one ? 0 : (Math.random() - 0.5) * 14);
      this.effects.push({ kind: "casualty", unit: group.unit, cls: group.cls, x: v.x + spread(), y: v.y + spread(), turn: v.aim ?? v.turn, t0: performance.now() + i * 120, ttl });
    }
  }

  // lose shows a team taking a loss: dust for a soldier down, a burning wreck for a
  // vehicle, a plume for a boat going under.
  lose(group, v, whole) {
    const now = performance.now();
    if (group.small && group.air) return this.fx.pop(v.x, v.y, now); // a drone shot out of the air
    if (group.small) return this.fx.dust(v.x, v.y, now, whole ? 1.6 : 1.1);
    if (!whole) return this.fx.shell(v.x, v.y, now, 0.6);
    if (group.cls === "naval") {
      this.fx.sinking(v.x, v.y, now);
      this.sound("boomS", v.x, v.y);
      this.sound("splash", v.x, v.y, 150);
    } else {
      this.fx.wreck(v.x, v.y, now);
      this.sound("boomM", v.x, v.y);
    }
  }

  // hqWatch notices a headquarters losing health between two states, or falling.
  hqWatch(state) {
    const hq = state.hq ?? [];
    const now = performance.now();
    for (const p of this.rules.map.points) {
      if (p.kind !== "hq") continue;
      const was = this.hqSeen?.[p.owner];
      const is = hq[p.owner];
      if (was === undefined || is === undefined || is >= was) continue;
      if (is <= 0) {
        // The fall itself is the finale's to show; see fell().
      } else if (now - this.hqHitAt[p.owner] > 650) {
        this.hqHitAt[p.owner] = now;
        this.fx.strike(p.x, p.y, now, 0.8);
        this.sound("boomS", p.x, p.y);
      }
    }
    this.hqSeen = [...hq];
    this.fell(state, now);
  }

  // fell starts the finale when a match ends with a headquarters destroyed. A page that
  // joins after the end has nothing to watch and just shows the ruin.
  fell(state, now) {
    const owner = fallen(state);
    if (!state.over) this.sawLive = true;
    if (owner < 0 || this.finale || this.ruined[owner]) return;
    if (!this.sawLive) {
      this.ruined[owner] = true;
      return;
    }
    const p = this.rules.map.points.find((q) => q.kind === "hq" && q.owner === owner);
    const cam = this.cam;
    const zoom = Math.max(cam.zoom, Math.max(cam.fitZoom, 0.36) * 1.9);
    const [ix, iy] = toIso(p.x, p.y);
    // The building ends up a little above the middle, clear of the result card.
    const to = { cx: ix, cy: iy + (0.14 * cam.h) / zoom, zoom };
    this.finale = new Finale({ owner, x: p.x, y: p.y, from: { cx: cam.cx, cy: cam.cy, zoom: cam.zoom }, to, t0: now, reduced: this.fx.reducedMotion() });
  }

  // finaleHolds says whether the result screen should still wait for the finale.
  finaleHolds(now = performance.now()) {
    return Boolean(this.finale?.holds(now));
  }

  // playFinale moves the view and sets off each step of the fall when its moment comes.
  playFinale(now) {
    const f = this.finale;
    if (!f) return;
    const view = f.camera(now);
    if (view) {
      this.cam.auto = false;
      Object.assign(this.cam, view);
    }
    const centre = hearing(this.cam, this.cam.w / 2, this.cam.h / 2, this.cam.zoom); // we are looking right at it
    for (const step of f.due(now)) {
      if (step === "blast") {
        this.fx.view = this.cam; // the view has only just arrived
        this.fx.collapse(f.x, f.y, now);
        this.sfx?.play("boomL", centre);
        this.sfx?.play("boomM", centre, 420);
      } else if (step === "ruin") {
        this.ruined[f.owner] = true;
      } else if (step === "aftershock") {
        this.sfx?.play("boomM", centre);
      } else if (step === "overlay") {
        this.onFinale?.();
      }
    }
  }

  // smoulder shows how hurt each headquarters is: smoke, then fire, then a burning ruin.
  // The enemy's is shown only while it is in sight; its health is as last seen.
  smoulder(now) {
    const { rules, state } = this;
    for (const p of rules.map.points) {
      if (p.kind !== "hq") continue;
      const ruined = this.ruined[p.owner];
      const seen = state.side !== 1 - p.owner || state.points.find((s) => s.id === p.id)?.visible;
      if (!seen && !ruined) continue;
      this.fx.smolder(`hq${p.owner}`, p.x, p.y, now, ruined ? 3 : Math.min(2, damageState(state.hq?.[p.owner])));
    }
  }

  // sound plays a battle sound as heard from the middle of the view.
  sound(kind, x, y, delay = 0) {
    if (!this.sfx) return;
    const [sx, sy] = this.cam.screen(x, y);
    this.sfx.play(kind, hearing(this.cam, sx, sy, this.cam.zoom), delay);
  }

  // shoot shows and sounds one burst from a team's weapon at a target.
  shoot(group, v, target, now) {
    const w = weaponOf(group.unit, group.cls);
    const miss = () => (Math.random() - 0.5) * 16;
    for (let i = 0; i < w.rounds; i++) {
      const t0 = now + i * w.gap;
      const x2 = target.x + miss();
      const y2 = target.y + miss();
      this.effects.push({ kind: "tracer", x1: v.x, y1: v.y, x2, y2, turn: v.turn, heavy: Boolean(w.heavy), flash: i === 0 && !hasAnimation(group.unit), t0, ttl: w.heavy ? 240 : 160 });
      const at = t0 + w.travel;
      if (w.impact === "shell") this.fx.shell(x2, y2, at, 1.25);
      else if (w.impact === "pop") this.fx.pop(x2, y2, at);
      else if (i % 2 === 0) this.fx.dust(x2, y2, at, 0.8);
    }
    this.sound(w.sound, v.x, v.y);
    if (w.impact === "shell") this.sound(this.fx.onWater(target.x, target.y) ? "splash" : "boomS", target.x, target.y, w.travel);
  }

  // ---- terrain ----

  bake() {
    const { rules } = this;
    const { width: W, height: H } = rules.map;
    // A big map is baked coarser, so the picture stays a size every browser will hold.
    const res = Math.min(RES, Math.sqrt(BAKE_PIXELS / ((W + H + 2 * MARGIN) * ((W + H) / 2 + 2 * MARGIN))));
    this.res = res;
    const layer = document.createElement("canvas");
    layer.width = Math.round((W + H + 2 * MARGIN) * res);
    layer.height = Math.round(((W + H) / 2 + 2 * MARGIN) * res);
    const g = layer.getContext("2d");
    g.setTransform(res, 0, 0, res, (H + MARGIN) * res, MARGIN * res);
    const path = (pts, dy = 0) => {
      g.beginPath();
      pts.forEach(([x, y], i) => {
        const [ix, iy] = toIso(x, y);
        i ? g.lineTo(ix, iy + dy) : g.moveTo(ix, iy + dy);
      });
      g.closePath();
    };
    const whole = [[0, 0], [W, 0], [W, H], [0, H]];
    const rand = rng(20261124);

    // The map is a slab: a dark skirt below its near edges gives it thickness.
    g.fillStyle = "#11161a";
    path(whole, 22);
    g.fill();
    g.fillStyle = "#2a2f26";
    path(whole, 10);
    g.fill();

    // Land under everything, then the map's own water, ice and mountains.
    g.fillStyle = sprites.terrain.land ? g.createPattern(sprites.terrain.land, "repeat") : "#5e6b43";
    path(whole);
    g.fill();
    if (!sprites.terrain.land) {
      g.save();
      path(whole);
      g.clip();
      for (const [n, colors, size] of [[Math.round((W * H) / 1800), ["rgba(120,124,78,0.20)", "rgba(58,74,44,0.22)", "rgba(142,132,88,0.14)"], 46], [Math.round((W * H) / 620), ["rgba(30,40,24,0.20)", "rgba(190,186,130,0.12)"], 3]]) {
        for (let i = 0; i < n; i++) {
          const [ix, iy] = toIso(rand() * W, rand() * H);
          g.fillStyle = colors[Math.floor(rand() * colors.length)];
          g.beginPath();
          g.ellipse(ix, iy, size * (0.4 + rand()), size * (0.2 + rand() * 0.4), 0, 0, TAU);
          g.fill();
        }
      }
      g.restore();
    }
    paintGround(g, rules, rand, { water: sprites.terrain.sea ? g.createPattern(sprites.terrain.sea, "repeat") : null });
    for (const s of scenery(rules, rand)) drawScenery(g, s, ...toIso(s.x, s.y));

    this.layer = layer;
    // Glints on open water, wherever the map has any.
    this.waves = [];
    for (let i = 0; i < 4000 && this.waves.length < Math.round((W * H) / 23000); i++) {
      const x = rand() * W;
      const y = rand() * H;
      if (isWater(rules, x, y) && isWater(rules, x - 30, y) && isWater(rules, x + 30, y)) this.waves.push({ x, y, phase: rand() * TAU, len: 14 + rand() * 26 });
    }
  }

  // ---- frame ----

  // draw paints one frame, nudged a few pixels when a blast shakes the view.
  draw(now) {
    this.playFinale(now);
    const z = this.cam.zoom;
    const [kx, ky] = this.fx.offset(now);
    this.cam.cx -= kx / z;
    this.cam.cy -= ky / z;
    try {
      this.paint(now);
    } finally {
      this.cam.cx += kx / z;
      this.cam.cy += ky / z;
    }
  }

  paint(now) {
    const { ctx, cam } = this;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const time = now / 1000;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const sky = ctx.createLinearGradient(0, 0, 0, cam.h);
    sky.addColorStop(0, "#0b1014");
    sky.addColorStop(1, "#141b20");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, cam.w, cam.h);
    if (!this.rules || !this.layer) return;
    const { rules } = this;
    const z = cam.zoom;
    const S = (x, y) => cam.screen(x, y);

    // Terrain.
    const gx = (-rules.map.height - MARGIN - cam.cx) * z + cam.w / 2;
    const gy = (-MARGIN - cam.cy) * z + cam.h / 2;
    ctx.imageSmoothingQuality = smoothing();
    ctx.drawImage(this.layer, gx, gy, (this.layer.width / this.res) * z, (this.layer.height / this.res) * z);
    ctx.lineCap = "round";
    for (const w of this.waves) {
      const glint = 0.5 + 0.5 * Math.sin(time * 1.3 + w.phase);
      const [sx, sy] = S(w.x + Math.sin(time * 0.4 + w.phase) * 12, w.y);
      ctx.strokeStyle = `rgba(214,240,246,${0.08 + 0.3 * glint})`;
      ctx.lineWidth = Math.max(1, 1.6 * z);
      ctx.beginPath();
      ctx.moveTo(sx - w.len * z, sy);
      ctx.lineTo(sx + w.len * z, sy);
      ctx.stroke();
    }
    if (!this.state) return;
    const state = this.state;
    // Sprites are drawn larger than true scale so they stay readable, less so when the
    // whole map is squeezed onto a small screen.
    const crowd = Math.max(0.5, Math.min(1, z / 0.3));
    const unitScale = Math.max(0.95 * crowd, Math.min(2.4, z * 1.9));
    const buildScale = Math.max(0.62 * crowd, Math.min(2.2, z * 1.55));

    // Move what is on screen toward where the server says it is.
    const ease = 1 - Math.exp(-dt * 9);
    for (const group of this.groups.values()) {
      for (const v of group.visuals) {
        const dx = v.tx - v.x;
        const dy = v.ty - v.y;
        v.moving = Math.hypot(dx, dy) > 1.2;
        if (v.moving) {
          const [ix, iy] = toIso(dx, dy);
          v.turn = Math.atan2(iy, ix);
        }
        v.x += dx * ease;
        v.y += dy * ease;
      }
    }
    this.gunfire(now);
    this.smoulder(now);
    this.fx.update(now, dt);
    this.sfx?.refresh();

    // Bridges lie on the water: standing, shot up or fallen, as this side last saw them.
    for (const b of rules.map.bridges ?? []) drawBridge(ctx, b, S, z, this.bridges.get(b.id), rules.bridgeRules?.dangerShare);

    // Ground markings: capture rings, order lines, team rings.
    const [rx, ry] = groundEllipse(rules.match.captureRadius);
    for (const p of rules.map.points) {
      const live = state.points.find((s) => s.id === p.id);
      const [sx, sy] = S(p.x, p.y);
      ctx.beginPath();
      ctx.ellipse(sx, sy, rx * z, ry * z, 0, 0, TAU);
      ctx.fillStyle = `${sideColor[live.owner]}1c`;
      ctx.fill();
      ctx.setLineDash([7 * z + 3, 6 * z + 3]);
      ctx.strokeStyle = `${sideColor[live.owner]}b0`;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.setLineDash([]);
      if (live.capSide !== -1 && live.progress > 0) {
        ctx.beginPath();
        ctx.ellipse(sx, sy, rx * z, ry * z, 0, -Math.PI / 2, -Math.PI / 2 + TAU * live.progress);
        ctx.strokeStyle = sideColor[live.capSide];
        ctx.lineWidth = 4;
        ctx.stroke();
      }
    }
    for (const group of this.groups.values()) {
      const color = sideColor[group.side];
      const target = group.own && group.view.order?.point && rules.map.points.find((p) => p.id === group.view.order.point);
      if (target && group.visuals.length) {
        const cx = group.visuals.reduce((a, v) => a + v.x, 0) / group.visuals.length;
        const cy = group.visuals.reduce((a, v) => a + v.y, 0) / group.visuals.length;
        ctx.strokeStyle = `${color}${group.id === this.selected ? "cc" : "66"}`;
        ctx.lineWidth = group.id === this.selected ? 2 : 1.3;
        ctx.setLineDash([3, 6]);
        ctx.lineDashOffset = -time * 14;
        ctx.beginPath();
        ctx.moveTo(...S(cx, cy));
        ctx.lineTo(...S(target.x, target.y));
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const wide = group.small ? 13 : 24;
      for (const v of group.visuals) {
        if (v.in) continue; // inside a building: the building shows who holds it
        const [sx, sy] = S(v.x, v.y);
        ctx.beginPath();
        ctx.ellipse(sx, sy, wide * unitScale, (wide / 2) * unitScale, 0, 0, TAU);
        ctx.fillStyle = `${color}38`;
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        if (group.id === this.selected) {
          ctx.beginPath();
          ctx.ellipse(sx, sy, (wide + 4 + Math.sin(time * 5)) * unitScale, ((wide + 4 + Math.sin(time * 5)) / 2) * unitScale, 0, 0, TAU);
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }
        if (group.own && this.showNerve() && v.nerve) {
          ctx.beginPath();
          ctx.ellipse(sx, sy, (wide + 8) * unitScale, ((wide + 8) / 2) * unitScale, 0, 0, TAU);
          ctx.strokeStyle = nerveColor[v.nerve];
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }
      }
    }

    this.fx.drawGround(ctx, cam, unitScale, now);

    // Everything that stands up, far to near.
    const things = [];
    for (const p of rules.map.points) {
      const live = state.points.find((s) => s.id === p.id);
      const kind = p.kind === "hq" ? `hq_${this.hqFaction[p.owner] ?? (p.owner === 0 ? "aegis" : "ashfall")}${this.ruined[p.owner] ? "_ruin" : ""}` : p.kind;
      things.push({ depth: p.x + p.y, x: p.x, y: p.y, scale: buildScale, draw: () => drawBuilding(ctx, kind, sideColor[live.owner], time) });
    }
    for (const l of rules.map.landmarks ?? []) {
      // A fallen building is drawn as the rubble it has become.
      const kind = this.lands.get(l.id)?.kind ?? l.kind;
      things.push({
        depth: l.x + l.y,
        x: l.x,
        y: l.y,
        scale: buildScale,
        draw: () => (sprites.buildings[kind] ? drawBuilding(ctx, kind, sideColor[-1], time) : (landmarkFallbacks[kind] ?? landmarkFallbacks.rubble)(ctx, time)),
      });
    }
    for (const group of this.groups.values()) {
      for (const v of group.visuals) {
        if (v.in) continue;
        things.push({
          depth: v.x + v.y + (group.air ? 90 : 0), // what flies is drawn over what stands under it
          x: v.x,
          y: v.y,
          scale: unitScale,
          draw: () => drawUnit(ctx, { unit: group.unit, cls: group.cls, faction: group.faction, members: v.members, moving: v.moving, firing: now < v.flashUntil, time, turn: v.turn, seed: v.seed, action: v.action, nerve: v.nerve, aim: v.aim, sinceShot: (now - (v.shotAt ?? -1e9)) / 1000, shots: v.shots ?? 0 }),
        });
      }
    }
    for (const e of this.effects) {
      if (e.kind !== "casualty" || now < e.t0) continue;
      things.push({ depth: e.x + e.y - 1, x: e.x, y: e.y, scale: unitScale, draw: () => drawCasualty(ctx, { unit: e.unit, cls: e.cls, turn: e.turn, age: (now - e.t0) / 1000 }) });
    }
    things.sort((a, b) => a.depth - b.depth);
    for (const th of things) {
      const [sx, sy] = S(th.x, th.y);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(th.scale, th.scale);
      th.draw();
      ctx.restore();
    }

    // Gunfire and smoke.
    this.effects = this.effects.filter((e) => now - e.t0 < e.ttl);
    for (const e of this.effects) {
      const life = (now - e.t0) / e.ttl;
      if (e.kind === "tracer" && life >= 0) {
        const [ax, ay] = S(e.x1, e.y1);
        const [bx, by] = S(e.x2, e.y2);
        const lift = 12 * unitScale;
        const head = Math.min(1, life * 1.6);
        const tail = Math.max(0, head - 0.35);
        ctx.strokeStyle = `rgba(255,236,150,${1 - life})`;
        ctx.lineWidth = e.heavy ? 2.6 : 1.5;
        ctx.beginPath();
        ctx.moveTo(ax + (bx - ax) * tail, ay - lift + (by - ay) * tail);
        ctx.lineTo(ax + (bx - ax) * head, ay - lift + (by - ay) * head);
        ctx.stroke();
        if (e.flash && life < 0.35) {
          ctx.fillStyle = `rgba(255,214,110,${0.9 - life * 2})`;
          ctx.beginPath();
          ctx.arc(ax + Math.cos(e.turn) * 10 * unitScale, ay - lift + Math.sin(e.turn) * 5 * unitScale, (e.heavy ? 6 : 3.5) * unitScale, 0, TAU);
          ctx.fill();
        }
      }
    }
    this.fx.draw(ctx, cam, unitScale, now);

    // Fog of war over everything on the ground; the labels stay readable above it.
    this.fog.render(state.fog, this.eyes());
    this.fog.draw(ctx, cam);

    this.labels(buildScale, unitScale);
    this.drawRadar();
  }

  // eyes lists where this side sees from: its headquarters and its living teams.
  eyes() {
    const { rules } = this;
    const eyes = rules.map.points.filter((p) => p.kind === "hq" && p.owner === this.state.side).map((p) => [p.x, p.y, rules.hq.sight]);
    // A point we hold keeps watch over the ground around it.
    for (const live of this.state.points) {
      const p = rules.map.points.find((q) => q.id === live.id);
      if (p.kind !== "hq" && live.owner === this.state.side) eyes.push([p.x, p.y, rules.match.pointSight]);
    }
    for (const group of this.groups.values()) {
      if (group.own) for (const v of group.visuals) eyes.push([v.x, v.y, this.unitOf[group.unit].sight]);
    }
    return eyes;
  }

  // gunfire turns "this team is firing" into tracers. The server says which of our own
  // teams fire; for an enemy in sight it is inferred from having one of ours in its range.
  gunfire(now) {
    const all = [...this.groups.values()];
    for (const group of all) {
      const stats = this.unitOf[group.unit];
      if (!stats) continue;
      for (const v of group.visuals) {
        if (group.own && v.action !== "fire") continue;
        let target = null;
        let bd = stats.range * 1.05;
        for (const other of all) {
          if (other.side === group.side) continue;
          for (const o of other.visuals) {
            const d = Math.hypot(o.x - v.x, o.y - v.y);
            if (d < bd) [target, bd] = [o, d];
          }
        }
        // With no enemy team in reach, a firing team is shooting at the headquarters.
        if (!target && (group.own || now - this.hqHitAt[1 - group.side] < 1500)) {
          const hq = this.rules.map.points.find((p) => p.kind === "hq" && p.owner === 1 - group.side);
          if (hq && Math.hypot(hq.x - v.x, hq.y - v.y) < bd) target = { x: hq.x, y: hq.y };
        }
        if (!target) continue;
        v.aim = Math.atan2(...toIso(target.x - v.x, target.y - v.y).reverse());
        // A hull keeps its heading when its weapon can turn without it.
        if (!v.moving && !sprites.units[group.unit]?.turret) v.turn = v.aim;
        if (now < v.nextShot) continue;
        v.shotAt = now;
        v.shots = (v.shots ?? 0) + 1;
        target.hitAt = now;
        v.nextShot = now + (stats.cooldownTicks / this.rules.tickRate) * 1000 * (0.75 + Math.random() * 0.5);
        v.flashUntil = now + 110;
        this.shoot(group, v, target, now);
      }
    }
  }

  plate(text, sx, sy, { size = 12, color = "#e9ede6", border = "#000", bold = true, alpha = 0.72 } = {}) {
    const { ctx } = this;
    ctx.font = `${bold ? "600 " : ""}${size}px system-ui, "Segoe UI", "Noto Sans Hebrew", "Heebo", sans-serif`;
    ctx.direction = /[֐-׿]/.test(text) ? "rtl" : "ltr";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = ctx.measureText(text).width + size;
    const h = size + 7;
    ctx.fillStyle = `rgba(10,14,16,${alpha})`;
    ctx.beginPath();
    ctx.roundRect(sx - w / 2, sy - h / 2, w, h, 3);
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(text, sx, sy + 0.5);
    return h;
  }

  labels(buildScale, unitScale) {
    const { rules, state, cam } = this;
    const lang = this.lang();
    const tall = { hq: 100, landRig: 92, seaRig: 88, point: 60 };
    for (const p of rules.map.points) {
      const live = state.points.find((s) => s.id === p.id);
      const [sx, sy] = cam.screen(p.x, p.y);
      const top = sy - tall[p.kind] * buildScale;
      const income = rules.rigs[p.kind].income;
      // The isolate marks keep "+15" reading left to right inside a Hebrew label.
      const sub = income ? `${p.name[lang]} ⁦+${income}⁩` : p.name[lang];
      if (cam.zoom >= 0.25) this.plate(sub, sx, top, { size: 11, color: "#b9c2b6", border: "rgba(0,0,0,0)", bold: false, alpha: 0.55 });
      this.plate(`${p.id} · ${p.callsign[lang]}`, sx, top - 19, { size: 13, color: "#f2f4ee", border: sideColor[live.owner] });
    }
    this.landmarkLabels(buildScale, lang);
    for (const group of this.groups.values()) {
      if (!group.visuals.length) continue;
      const cx = group.visuals.reduce((a, v) => a + v.x, 0) / group.visuals.length;
      const low = Math.max(...group.visuals.map((v) => cam.screen(v.x, v.y)[1]));
      const [sx] = cam.screen(cx, group.visuals.reduce((a, v) => a + v.y, 0) / group.visuals.length);
      if (!group.own) {
        // An enemy in sight gets a name the player can say: "Viper 1 attack Target 3".
        this.plate(this.contactName(group.view, lang), sx, low + 16 * unitScale + 4, { size: 12, color: sideColor[group.side], border: `${sideColor[group.side]}88` });
        continue;
      }
      // A squad in cover says so on its plate, with how much harder it is to hit.
      const cover = Math.max(0, ...group.visuals.map((v) => coverPercent(v.cover)));
      this.plate(cover ? `${group.view.callsign[lang]}  ⛨ ⁦${cover}%⁩` : group.view.callsign[lang], sx, low + 16 * unitScale + 4, {
        size: 12,
        color: sideColor[group.side],
        border: group.id === this.selected ? "#ffffff" : `${sideColor[group.side]}88`,
      });
    }
  }

  // landmarkLabels shows what the side knows about the buildings (who is inside, how
  // badly hit), and the name of the landmark or bridge under the pointer or just tapped.
  landmarkLabels(buildScale, lang) {
    const { rules, cam, ctx } = this;
    for (const l of rules.map.landmarks ?? []) {
      const seen = this.lands.get(l.id);
      if (!seen) continue;
      const [sx, sy] = cam.screen(l.x, l.y);
      const top = sy - 30 * buildScale;
      if (seen.garrison) {
        // One pip for every fireteam inside, in its side's colour.
        const n = seen.garrison.teams;
        const w = 7;
        for (let i = 0; i < n; i++) {
          ctx.fillStyle = sideColor[seen.garrison.side];
          ctx.strokeStyle = "#0b0f10";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.rect(sx - (n * (w + 2)) / 2 + i * (w + 2), top - 6, w, w);
          ctx.fill();
          ctx.stroke();
        }
      }
      if (seen.kind !== "rubble" && seen.hp < 1) {
        ctx.fillStyle = "rgba(10,14,16,0.75)";
        ctx.fillRect(sx - 15, top + 4, 30, 4);
        ctx.fillStyle = seen.hp < 0.35 ? "#ff5a5a" : "#f0c04a";
        ctx.fillRect(sx - 14, top + 5, 28 * seen.hp, 2);
      }
    }
    const now = performance.now();
    const shown = this.named && now < this.named.until ? this.named.id : this.hover && this.placeUnder(this.hover.x, this.hover.y);
    if (!shown) return;
    const place = typeof shown === "string" ? [...(rules.map.landmarks ?? []), ...(rules.map.bridges ?? [])].find((p) => p.id === shown) : shown.landmark ?? shown.bridge;
    if (!place) return;
    const [x, y] = place.from ? [(place.from[0] + place.to[0]) / 2, (place.from[1] + place.to[1]) / 2] : [place.x, place.y];
    const [sx, sy] = cam.screen(x, y);
    this.plate(place.name[lang], sx, sy - 44 * buildScale, { size: 12, color: "#f2f4ee", border: "#c9a44c" });
  }

  // placeUnder is the landmark or bridge under a point of the view, as { landmark } or
  // { bridge }, or null.
  placeUnder(sx, sy) {
    if (!this.rules) return null;
    const hit = placeAt(this.rules.map, ...this.cam.world(sx, sy), Math.max(26, 20 / this.cam.zoom));
    return hit.landmark || hit.bridge ? hit : null;
  }

  // showName shows a landmark's or bridge's name for a few seconds, as after a tap.
  showName(id) {
    this.named = { id, until: performance.now() + 3500 };
  }

  // ---- radar ----

  drawRadar() {
    const { rctx: g, rules, state, cam } = this;
    const w = this.radar.width;
    const h = this.radar.height;
    const k = w / rules.map.width;
    g.setTransform(1, 0, 0, 1, 0, 0);
    // The terrain, drawn once for this size and redrawn when a bridge falls or stands again.
    if (!this.radarBase || this.radarBase.width !== w || this.radarBase.height !== h) {
      this.radarBase = document.createElement("canvas");
      this.radarBase.width = w;
      this.radarBase.height = h;
      drawMiniMap(this.radarBase.getContext("2d"), rules, rules.map, w, h, { standing: (id) => this.bridges.get(id)?.standing ?? true });
    }
    g.drawImage(this.radarBase, 0, 0);
    g.strokeStyle = "rgba(160,220,190,0.10)";
    g.lineWidth = 1;
    for (let x = 200; x < rules.map.width; x += 200) {
      g.beginPath();
      g.moveTo(x * k, 0);
      g.lineTo(x * k, h);
      g.stroke();
    }
    for (const p of rules.map.points) {
      const live = state.points.find((s) => s.id === p.id);
      const r = (p.kind === "hq" ? 5 : 3.5) * this.dpr;
      g.fillStyle = sideColor[live.owner];
      g.strokeStyle = "#0b0f10";
      g.beginPath();
      p.kind === "hq" ? g.rect(p.x * k - r, p.y * k - r, 2 * r, 2 * r) : g.arc(p.x * k, p.y * k, r, 0, TAU);
      g.fill();
      g.stroke();
    }
    this.fog.drawRadar(g, k);
    for (const group of this.groups.values()) {
      g.fillStyle = group.id === this.selected ? "#ffffff" : sideColor[group.side];
      for (const v of group.visuals) g.fillRect(v.x * k - 1.5 * this.dpr, v.y * k - 1.5 * this.dpr, 3 * this.dpr, 3 * this.dpr);
    }
    // What the main view is looking at.
    const corners = [[0, 0], [cam.w, 0], [cam.w, cam.h], [0, cam.h]].map(([sx, sy]) => cam.world(sx, sy));
    g.strokeStyle = "rgba(255,255,255,0.75)";
    g.lineWidth = this.dpr;
    g.beginPath();
    corners.forEach(([x, y], i) => (i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k)));
    g.closePath();
    g.stroke();
  }

  radarToWorld(ev) {
    const box = this.radar.getBoundingClientRect();
    return [((ev.clientX - box.left) / box.width) * this.rules.map.width, ((ev.clientY - box.top) / box.height) * this.rules.map.height];
  }

  // ---- picking ----

  // pick says what is under a point of the view: one of our squads, an enemy in sight,
  // a landmark, a bridge, or a map point.
  // contactName is what the player calls an enemy squad in sight, e.g. "Target 3".
  contactName(view, lang) {
    return `${this.rules.callsigns.contact[lang]} ${view.id}`;
  }

  pick(sx, sy, side) {
    if (!this.rules || !this.state) return {};
    let squad = null;
    let contact = null;
    let bd = 26;
    for (const group of this.groups.values()) {
      if (group.own && group.side !== side) continue;
      for (const v of group.visuals) {
        const [vx, vy] = this.cam.screen(v.x, v.y);
        const d = Math.hypot(vx - sx, vy - 10 - sy);
        if (d < bd) [squad, contact, bd] = group.own ? [group.view, null, d] : [null, group.view, d];
      }
    }
    if (squad) return { squad };
    if (contact) return { contact };
    // A landmark or a bridge before the point it stands beside: it is the smaller target.
    const place = this.placeUnder(sx, sy);
    if (place) return place;
    const [wx, wy] = this.cam.world(sx, sy);
    const point = this.rules.map.points.find((p) => Math.hypot(p.x - wx, p.y - wy) <= this.rules.match.captureRadius * 1.15);
    return point ? { point } : {};
  }
}
