// Detailed procedural Canvas VFX, persistent craters, battlefield hazards, unit status arcs,
// screen-flash overlays and custom tactical targeting cursors for all 15 Callsign super powers.

import { groundEllipse as rawEllipse } from "./iso.js";
import { nearness } from "./fx.js";
import { terrainAt } from "./terrain.js";

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function groundEllipse(r, zoom = 1) {
  const [rx, ry] = rawEllipse(r);
  return { rx: rx * zoom, ry: ry * zoom };
}

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// World-space ellipse helper using the map's isometric camera.
function traceIsoCircle(ctx, cam, wx, wy, r) {
  const [sx, sy] = cam.screen(wx, wy);
  const { rx, ry } = groundEllipse(r, cam.zoom);
  ctx.beginPath();
  ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU);
  return { sx, sy, rx, ry };
}

// Recursive midpoint-displaced jagged lightning bolt from (x1,y1) to (x2,y2).
function boltPath(x1, y1, x2, y2, rand, depth = 4, jitter = 34) {
  if (depth <= 0) return [[x1, y1], [x2, y2]];
  const mx = (x1 + x2) * 0.5 + (rand() - 0.5) * jitter;
  const my = (y1 + y2) * 0.5 + (rand() - 0.5) * jitter * 0.6;
  const left = boltPath(x1, y1, mx, my, rand, depth - 1, jitter * 0.58);
  const right = boltPath(mx, my, x2, y2, rand, depth - 1, jitter * 0.58);
  return [...left.slice(0, -1), ...right];
}

function strokePolyline(ctx, pts) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

export function isValidSuperTarget(rules, sp, wx, wy) {
  if (!rules?.map || !sp) return false;
  if (!Number.isFinite(wx) || !Number.isFinite(wy)) return false;
  if (wx < 0 || wy < 0 || wx > rules.map.width || wy > rules.map.height) return false;
  if (sp.id === "tunnelAmbush" && terrainAt(rules.map, wx, wy) !== "L") return false;
  return true;
}

export class SuperPowerFx {
  constructor() {
    this.fired = new Set(); // strike ids whose launch SFX was handled
    this.detonated = new Set(); // strike ids whose primary detonation burst/SFX was handled
    this.subDone = new Set(); // "strikeId:subIdx" already handled
    this.flashes = []; // { t0, ttl, color, alpha }
    this.seenTick = null;
    this.tickAt = 0;
    this.smoothTick = 0;
    this.lastNow = 0;
    this.overAt = null;
    this.overTick = 0;
    this.overFade = 1;
    this.suppressBursts = false;
  }

  reset() {
    this.fired.clear();
    this.detonated.clear();
    this.subDone.clear();
    this.flashes.length = 0;
    this.seenTick = null;
    this.tickAt = 0;
    this.smoothTick = 0;
    this.lastNow = 0;
    this.overAt = null;
    this.overTick = 0;
    this.overFade = 1;
    this.suppressBursts = false;
  }

  // syncClock interpolates sub-tick time between 5 Hz server snapshots for smooth 60 FPS motion,
  // suppresses catch-up bursts after tab hiding or mid-match reloads, and fades out cleanly on match end.
  syncClock(state, rules, now, pace = 1) {
    if (!state) return;
    const rate = rules?.tickRate || 10;
    const rawTick = state.tick ?? 0;

    // Match restarted to tick 0 without setRules.
    if (this.seenTick !== null && rawTick + 2 < this.seenTick) {
      this.reset();
    }

    const bigStep = this.lastNow > 0 && now - this.lastNow > 450;
    this.lastNow = now;

    if (this.seenTick === null) {
      this.seenTick = rawTick;
      this.tickAt = now;
      this.smoothTick = rawTick;
    } else if (rawTick !== this.seenTick) {
      this.seenTick = rawTick;
      this.tickAt = now;
    }

    if (state.over) {
      if (this.overAt === null) {
        this.overAt = now;
        this.overTick = this.smoothTick || rawTick;
        this.flashes.length = 0;
      }
      const elapsedOver = Math.max(0, now - this.overAt);
      this.overFade = clamp(1 - elapsedOver / 1100, 0, 1);
      if (this.overFade > 0) {
        this.smoothTick = this.overTick + (elapsedOver / 1000) * rate * 0.35;
      }
      this.suppressBursts = true;
      return;
    }

    this.overAt = null;
    this.overFade = 1;
    const sub = clamp(((Math.max(0, now - this.tickAt)) / 1000) * rate * (pace || 1), 0, 2.3);
    const target = rawTick + sub;
    if (bigStep || target < this.smoothTick - 2.5 || this.smoothTick > rawTick + 2.5) {
      this.smoothTick = target;
    } else {
      this.smoothTick = Math.max(this.smoothTick, target);
    }
    this.suppressBursts = bigStep;
  }

  tickOf(state) {
    if (this.seenTick === (state?.tick ?? 0) && this.lastNow > 0) return this.smoothTick;
    return state?.tick ?? 0;
  }

  flash(cam, wx, wy, color, alpha, ttl, now) {
    if (this.suppressBursts || this.overFade < 1) return;
    let scale = 1;
    if (cam) {
      const [sx, sy] = cam.screen(wx, wy);
      scale = clamp(0.22 + 0.78 * nearness(cam, sx, sy), 0.22, 1);
    }
    if (this.flashes.length < 6) this.flashes.push({ t0: now, ttl, color, alpha: alpha * scale });
  }

  onScreen(cam, sx, sy, pad = 220) {
    return sx >= -pad && sx <= cam.w + pad && sy >= -pad && sy <= cam.h + pad;
  }

  // ---- Layer 1: Permanent Craters & Authoritative Scorches (drawn on ground below everything) ----

  drawCraters(ctx, cam, state, rules, now, reducedMotion = false) {
    const craters = state?.craters;
    if (!craters?.length) return;
    const rate = rules?.tickRate || 10;
    const tick = this.tickOf(state);

    for (const c of craters) {
      const [sx, sy] = cam.screen(c.x, c.y);
      const { rx, ry } = groundEllipse(c.r, cam.zoom);
      if (sx + rx * 2 < 0 || sx - rx * 2 > cam.w || sy + ry * 2 < 0 || sy - ry * 2 > cam.h) continue;

      if (c.kind === "scorch") {
        // Authoritative surface scorch mark (lightning bolts, artillery shells, drone pops).
        ctx.save();
        const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, rx * 1.25);
        sg.addColorStop(0, "rgba(16,13,10,0.62)");
        sg.addColorStop(0.55, "rgba(30,24,19,0.34)");
        sg.addColorStop(1, "rgba(38,32,25,0)");
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.ellipse(sx, sy, rx * 1.25, ry * 1.25, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
        continue;
      }

      const r = rng(c.id * 2654435761 + 17);
      const ageSec = Math.max(0, (tick - c.tick) / rate);
      const heat = clamp(1 - ageSec / 22, 0, 1) * this.overFade;

      ctx.save();
      // 1. Outer blast ejecta rays & scorched ash halo.
      const halo = ctx.createRadialGradient(sx, sy, rx * 0.3, sx, sy, rx * 1.65);
      if (c.kind === "nuke") {
        halo.addColorStop(0, "rgba(18,14,12,0.88)");
        halo.addColorStop(0.55, "rgba(38,28,22,0.58)");
        halo.addColorStop(1, "rgba(40,34,26,0)");
      } else {
        halo.addColorStop(0, "rgba(22,18,14,0.78)");
        halo.addColorStop(0.6, "rgba(44,36,28,0.42)");
        halo.addColorStop(1, "rgba(48,40,30,0)");
      }
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.ellipse(sx, sy, rx * 1.65, ry * 1.65, 0, 0, TAU);
      ctx.fill();

      // 2. Displaced dusty rim berm (lit on bottom-right, shadowed on top-left).
      ctx.strokeStyle = "rgba(168,148,116,0.45)";
      ctx.lineWidth = Math.max(1.5, rx * 0.14);
      ctx.beginPath();
      ctx.ellipse(sx, sy, rx * 1.02, ry * 1.02, 0, 0.15, Math.PI - 0.15);
      ctx.stroke();

      // 3. Recessed crater bowl with directional shadow gradient.
      const bowl = ctx.createRadialGradient(sx - rx * 0.2, sy - ry * 0.25, rx * 0.08, sx, sy, rx);
      bowl.addColorStop(0, c.kind === "tunnel" ? "#090807" : "#15120f");
      bowl.addColorStop(0.58, "#29221b");
      bowl.addColorStop(0.88, "#564938");
      bowl.addColorStop(1, "rgba(110,95,74,0.15)");
      ctx.fillStyle = bowl;
      ctx.beginPath();
      ctx.ellipse(sx, sy, rx * 0.96, ry * 0.96, 0, 0, TAU);
      ctx.fill();

      // 4. Radial ground fissures & shattered rock chunks.
      ctx.strokeStyle = "rgba(14,11,9,0.7)";
      ctx.lineWidth = Math.max(1, cam.zoom * 1.2);
      const cracks = c.kind === "nuke" || c.kind === "kinetic" ? 11 : 7;
      for (let i = 0; i < cracks; i++) {
        const a = (i / cracks) * TAU + (r() - 0.5) * 0.35;
        const len0 = 0.45 + r() * 0.3;
        const len1 = 1.05 + r() * 0.55;
        const midA = a + (r() - 0.5) * 0.25;
        ctx.beginPath();
        ctx.moveTo(sx + Math.cos(a) * rx * len0, sy + Math.sin(a) * ry * len0);
        ctx.lineTo(sx + Math.cos(midA) * rx * ((len0 + len1) * 0.5), sy + Math.sin(midA) * ry * ((len0 + len1) * 0.5));
        ctx.lineTo(sx + Math.cos(a) * rx * len1, sy + Math.sin(a) * ry * len1);
        ctx.stroke();
      }
      for (let i = 0; i < 8; i++) {
        const a = r() * TAU;
        const d = 0.85 + r() * 0.5;
        const rk = Math.max(1.2, (1.5 + r() * 2.5) * cam.zoom);
        ctx.fillStyle = i % 2 ? "#3a3128" : "#6c5d49";
        ctx.beginPath();
        ctx.ellipse(sx + Math.cos(a) * rx * d, sy + Math.sin(a) * ry * d, rk, rk * 0.65, r() * TAU, 0, TAU);
        ctx.fill();
      }

      // 5. Tunnel breach dark subterranean shaft collar.
      if (c.kind === "tunnel") {
        ctx.fillStyle = "#060504";
        ctx.beginPath();
        ctx.ellipse(sx, sy, rx * 0.52, ry * 0.52, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = "#8a6d48";
        ctx.lineWidth = Math.max(1.5, cam.zoom * 2.4);
        ctx.setLineDash([5 * cam.zoom, 3 * cam.zoom]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 6. Cooling glowing embers inside fresh craters.
      if (heat > 0.02) {
        const pulse = reducedMotion ? 0.85 : 0.78 + 0.22 * Math.sin(now / 190 + c.id);
        const ember = ctx.createRadialGradient(sx, sy, 0, sx, sy, rx * 0.62);
        ember.addColorStop(0, `rgba(255,210,110,${0.65 * heat * pulse})`);
        ember.addColorStop(0.5, `rgba(240,86,20,${0.48 * heat * pulse})`);
        ember.addColorStop(1, "rgba(180,30,10,0)");
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = ember;
        ctx.beginPath();
        ctx.ellipse(sx, sy, rx * 0.62, ry * 0.62, 0, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.restore();
    }
  }

  // ---- Layer 2A: Ground-Plane Hazard Beds & Strike Telegraphs (drawn BEFORE units/structures) ----

  drawGround(ctx, cam, state, rules, now, unitScale, reducedMotion = false) {
    if (!state || this.overFade <= 0.01) return;
    const tick = this.tickOf(state);
    const rate = rules?.tickRate || 10;
    const fadeAll = this.overFade;

    // 1. Flat ground beds for lingering hazards.
    for (const h of state.hazards ?? []) {
      if (h.visible === false) continue;
      const span = Math.max(1, h.endTick - h.startTick);
      const age = clamp((tick - h.startTick) / span, 0, 1);
      const fadeIn = clamp((tick - h.startTick) / 6, 0, 1);
      const fadeOut = clamp((h.endTick - tick) / 22, 0, 1);
      const vis = fadeIn * fadeOut * fadeAll;
      if (vis <= 0.01) continue;

      if (h.kind === "fallout") this.drawFalloutGround(ctx, cam, h, now, vis, reducedMotion);
      else if (h.kind === "chemical") this.drawChemicalGround(ctx, cam, h, vis);
      else if (h.kind === "napalm") this.drawNapalmGround(ctx, cam, h, vis);
      else if (h.kind === "trench") this.drawMoltenTrenchGround(ctx, cam, h, now, age, vis, reducedMotion);
      else if (h.kind === "cyber") this.drawCyberGround(ctx, cam, h, now, vis, reducedMotion);
      else if (h.kind === "emp") this.drawEmpGround(ctx, cam, h, now, age, vis, reducedMotion);
      else if (h.kind === "spoof") this.drawSpoofGround(ctx, cam, h, now, vis, reducedMotion);
    }

    // 2. Flat ground telegraph rings, corridors & surface shockwaves for active strikes.
    for (const st of state.superStrikes ?? []) {
      const sp = rules?.superPowers?.find((p) => p.id === st.power);
      if (!sp) continue;
      const toImpact = (st.impactTick - tick) / rate;
      const sinceImpact = (tick - st.impactTick) / rate;
      const delaySec = Math.max(0.1, (st.impactTick - st.startTick) / rate);
      const durSec = Math.max(0.1, (st.endTick - st.impactTick) / rate);
      this.drawStrikeGround(ctx, cam, state, st, sp, tick, rate, toImpact, sinceImpact, delaySec, durSec, now, unitScale, fadeAll, reducedMotion);
    }
  }

  drawFalloutGround(ctx, cam, h, now, vis, reducedMotion) {
    const [sx, sy] = cam.screen(h.x, h.y);
    const { rx, ry } = groundEllipse(h.r, cam.zoom);
    if (!this.onScreen(cam, sx, sy, rx + 40)) return;
    const pulse = reducedMotion ? 0.9 : 0.82 + 0.18 * Math.sin(now / 320 + h.id);
    ctx.save();
    const g = ctx.createRadialGradient(sx, sy, rx * 0.1, sx, sy, rx);
    g.addColorStop(0, `rgba(170,225,52,${0.26 * vis * pulse})`);
    g.addColorStop(0.55, `rgba(115,175,38,${0.18 * vis})`);
    g.addColorStop(1, "rgba(80,120,24,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = `rgba(195,245,70,${0.32 * vis * pulse})`;
    ctx.lineWidth = Math.max(1.2, 1.5 * cam.zoom);
    ctx.setLineDash([8 * cam.zoom, 6 * cam.zoom]);
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx * 0.96, ry * 0.96, 0, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    if (!reducedMotion) {
      const r = rng(h.id * 9973);
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 18; i++) {
        const a = r() * TAU + now * 0.00022 * (i % 2 ? 1 : -1);
        const d = (0.15 + r() * 0.8) * ((now / 3500 + r()) % 1);
        const px = sx + Math.cos(a) * rx * d;
        const py = sy + Math.sin(a) * ry * d - ((now / 50 + i * 19) % 20) * cam.zoom;
        ctx.fillStyle = `rgba(210,255,95,${0.5 * vis * (1 - d * 0.5)})`;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(1.1, 2.0 * cam.zoom), 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawChemicalGround(ctx, cam, h, vis) {
    const [sx, sy] = cam.screen(h.x, h.y);
    const { rx, ry } = groundEllipse(h.r, cam.zoom);
    if (!this.onScreen(cam, sx, sy, rx + 40)) return;
    ctx.save();
    const base = ctx.createRadialGradient(sx, sy, 0, sx, sy, rx);
    base.addColorStop(0, `rgba(130,192,38,${0.34 * vis})`);
    base.addColorStop(0.7, `rgba(92,148,26,${0.22 * vis})`);
    base.addColorStop(1, "rgba(70,110,20,0)");
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = `rgba(176,235,62,${0.35 * vis})`;
    ctx.lineWidth = Math.max(1.1, 1.4 * cam.zoom);
    ctx.setLineDash([6 * cam.zoom, 6 * cam.zoom]);
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx * 0.96, ry * 0.96, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  drawNapalmGround(ctx, cam, h, vis) {
    const [ax, ay] = cam.screen(h.x, h.y);
    const [bx, by] = cam.screen(h.x2, h.y2);
    const w = Math.max(10, h.r * 1.35 * cam.zoom);
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = `rgba(18,13,10,${0.62 * vis})`;
    ctx.lineWidth = w * 1.15;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();

    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = `rgba(255,95,22,${0.32 * vis})`;
    ctx.lineWidth = w * 0.72;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.restore();
  }

  drawMoltenTrenchGround(ctx, cam, h, now, age, vis, reducedMotion) {
    const [ax, ay] = cam.screen(h.x, h.y);
    const [bx, by] = cam.screen(h.x2, h.y2);
    const cool = clamp(1 - age * 0.88, 0.08, 1);
    const pulse = reducedMotion ? 0.9 : 0.85 + 0.15 * Math.sin(now / 140);
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = `rgba(18,15,13,${0.8 * vis})`;
    ctx.lineWidth = Math.max(6, 22 * cam.zoom);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();

    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = `rgba(255,120,30,${0.72 * cool * vis * pulse})`;
    ctx.lineWidth = Math.max(3, 11 * cam.zoom);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();

    ctx.strokeStyle = `rgba(255,244,210,${0.85 * cool * cool * vis})`;
    ctx.lineWidth = Math.max(1.2, 4 * cam.zoom);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.restore();
  }

  drawCyberGround(ctx, cam, h, now, vis, reducedMotion) {
    const [sx, sy] = cam.screen(h.x, h.y);
    const { rx, ry } = groundEllipse(h.r, cam.zoom);
    if (!this.onScreen(cam, sx, sy, rx + 40)) return;
    ctx.save();
    const g = ctx.createRadialGradient(sx, sy, rx * 0.15, sx, sy, rx);
    g.addColorStop(0, `rgba(26,230,205,${0.08 * vis})`);
    g.addColorStop(0.75, `rgba(22,195,180,${0.16 * vis})`);
    g.addColorStop(1, `rgba(46,242,214,${0.32 * vis})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU);
    ctx.fill();

    const rot = reducedMotion ? 0.35 : (now / 1400) % TAU;
    ctx.strokeStyle = `rgba(46,242,214,${0.72 * vis})`;
    ctx.lineWidth = Math.max(1.3, 2 * cam.zoom);
    for (let i = 0; i < 6; i++) {
      const a0 = rot + (i / 6) * TAU;
      ctx.beginPath();
      ctx.ellipse(sx, sy, rx, ry, 0, a0, a0 + 0.65);
      ctx.stroke();
    }
    if (!reducedMotion) {
      ctx.beginPath();
      ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU);
      ctx.clip();
      const scanY = sy - ry + ((now / 18) % Math.max(2, ry * 2));
      ctx.fillStyle = `rgba(46,242,214,${0.22 * vis})`;
      ctx.fillRect(sx - rx, scanY, rx * 2, Math.max(1.5, 2.5 * cam.zoom));
      const r = rng(Math.floor(now / 140) + h.id * 97);
      for (let i = 0; i < 8; i++) {
        const gx = sx + (r() - 0.5) * rx * 1.5;
        const gy = sy + (r() - 0.5) * ry * 1.5;
        const gw = (10 + r() * 24) * cam.zoom;
        ctx.fillStyle = i % 3 === 0 ? `rgba(255,68,96,${0.36 * vis})` : `rgba(46,242,214,${0.34 * vis})`;
        ctx.fillRect(gx, gy, gw, Math.max(1.2, 2 * cam.zoom));
      }
    }
    ctx.restore();
  }

  drawEmpGround(ctx, cam, h, now, age, vis, reducedMotion) {
    const [sx, sy] = cam.screen(h.x, h.y);
    const { rx, ry } = groundEllipse(h.r, cam.zoom);
    if (!this.onScreen(cam, sx, sy, rx + 40)) return;
    ctx.save();
    const pulse = reducedMotion ? 0.8 : 0.65 + 0.35 * Math.sin(now / 160);
    ctx.strokeStyle = `rgba(110,195,255,${0.5 * vis * pulse})`;
    ctx.lineWidth = Math.max(1.2, 1.8 * cam.zoom);
    ctx.setLineDash([10 * cam.zoom, 6 * cam.zoom]);
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    if (!reducedMotion) {
      const r = rng(Math.floor(now / 110) + h.id * 31);
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `rgba(165,225,255,${0.65 * vis * (1 - age * 0.5)})`;
      ctx.lineWidth = Math.max(1, 1.4 * cam.zoom);
      for (let i = 0; i < 4; i++) {
        const a = r() * TAU;
        const a2 = a + 0.25;
        const pts = boltPath(sx + Math.cos(a) * rx, sy + Math.sin(a) * ry, sx + Math.cos(a2) * rx, sy + Math.sin(a2) * ry, r, 3, 14 * cam.zoom);
        strokePolyline(ctx, pts);
      }
    }
    ctx.restore();
  }

  drawSpoofGround(ctx, cam, h, now, vis, reducedMotion) {
    const [sx, sy] = cam.screen(h.x, h.y);
    const { rx, ry } = groundEllipse(h.r, cam.zoom);
    if (!this.onScreen(cam, sx, sy, rx + 40)) return;
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const p = reducedMotion ? (i + 1) / 3 : ((now / 1800) + i / 3) % 1;
      ctx.strokeStyle = `rgba(204,122,255,${0.42 * (1 - p * 0.85) * vis})`;
      ctx.lineWidth = Math.max(1.1, 1.6 * cam.zoom);
      ctx.beginPath();
      ctx.ellipse(sx, sy, rx * p, ry * p, 0, 0, TAU);
      ctx.stroke();
    }
    if (!reducedMotion) {
      const ang = (now / 950) % TAU;
      ctx.fillStyle = `rgba(204,122,255,${0.11 * vis})`;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.ellipse(sx, sy, rx, ry, 0, ang, ang + 0.55);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawStrikeGround(ctx, cam, state, st, sp, tick, rate, toImpact, sinceImpact, delaySec, durSec, now, unitScale, fadeAll, reducedMotion) {
    const [sx, sy] = cam.screen(st.x, st.y);
    const { rx, ry } = groundEllipse(sp.radius, cam.zoom);
    const elapsed = Math.max(0, (tick - st.startTick) / rate);
    const inFade = clamp(elapsed / 0.25, 0, 1) * fadeAll;
    if (inFade <= 0.01) return;

    ctx.save();
    if (st.power === "rodOfGod") {
      if (toImpact > 0) {
        const k = 1 - clamp(toImpact / delaySec, 0, 1);
        const { rx: crx, ry: cry } = groundEllipse(sp.coreRadius || 78, cam.zoom);
        ctx.strokeStyle = `rgba(124,232,255,${(0.38 + 0.5 * k) * inFade})`;
        ctx.lineWidth = Math.max(1.4, 2 * cam.zoom);
        ctx.beginPath();
        ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU);
        ctx.stroke();
        const pulse = reducedMotion ? 0.8 : 0.65 + 0.35 * Math.sin(now / 90);
        ctx.strokeStyle = `rgba(255,90,90,${pulse * inFade})`;
        ctx.beginPath();
        ctx.ellipse(sx, sy, crx * (1.6 - 0.6 * k), cry * (1.6 - 0.6 * k), 0, 0, TAU);
        ctx.stroke();
      } else if (sinceImpact >= 0 && sinceImpact < 1.35) {
        for (const [lag, col] of [[0, "255,250,230"], [0.12, "140,225,255"]]) {
          const rp = clamp((sinceImpact - lag) / 1.15, 0, 1);
          if (rp <= 0 || rp >= 1) continue;
          ctx.strokeStyle = `rgba(${col},${(1 - rp) * 0.88 * fadeAll})`;
          ctx.lineWidth = Math.max(1.8, (1 - rp) * 8 * unitScale);
          ctx.beginPath();
          ctx.ellipse(sx, sy, rx * (0.15 + rp * 1.45), ry * (0.15 + rp * 1.45), 0, 0, TAU);
          ctx.stroke();
        }
      }
    } else if (st.power === "tacticalNuke") {
      if (toImpact > 0) {
        const blink = reducedMotion ? 0.85 : 0.55 + 0.45 * Math.sin(now / 120);
        ctx.strokeStyle = `rgba(255,160,40,${(0.4 + 0.45 * blink) * inFade})`;
        ctx.lineWidth = Math.max(1.5, 2.4 * cam.zoom);
        ctx.beginPath();
        ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = `rgba(255,70,40,${0.7 * blink * inFade})`;
        ctx.setLineDash([12 * cam.zoom, 8 * cam.zoom]);
        ctx.beginPath();
        ctx.ellipse(sx, sy, rx * 0.5, ry * 0.5, 0, 0, TAU);
        ctx.stroke();
      } else if (sinceImpact >= 0 && sinceImpact < 7.5) {
        const p = clamp(sinceImpact / 7.2, 0, 1);
        const fade = clamp(1 - (sinceImpact - 4.8) / 2.6, 0, 1) * fadeAll;
        const shockP = clamp(sinceImpact / 1.8, 0, 1);
        if (shockP < 1) {
          ctx.strokeStyle = `rgba(255,235,180,${(1 - shockP) * 0.9 * fadeAll})`;
          ctx.lineWidth = Math.max(2, (1 - shockP) * 12 * unitScale);
          ctx.beginPath();
          ctx.ellipse(sx, sy, rx * (0.2 + shockP * 1.65), ry * (0.2 + shockP * 1.65), 0, 0, TAU);
          ctx.stroke();
        }
        const skirtR = rx * (0.4 + p * 0.95);
        const skirtG = ctx.createRadialGradient(sx, sy, skirtR * 0.2, sx, sy, skirtR);
        skirtG.addColorStop(0, `rgba(110,92,72,${0.58 * fade})`);
        skirtG.addColorStop(0.7, `rgba(148,128,100,${0.36 * fade})`);
        skirtG.addColorStop(1, "rgba(150,132,106,0)");
        ctx.fillStyle = skirtG;
        ctx.beginPath();
        ctx.ellipse(sx, sy, skirtR, skirtR * 0.48, 0, 0, TAU);
        ctx.fill();
      }
    } else if (st.power === "chemicalStrike") {
      if (toImpact > 0) {
        const k = 1 - clamp(toImpact / delaySec, 0, 1);
        ctx.strokeStyle = `rgba(168,230,61,${(0.38 + 0.45 * k) * inFade})`;
        ctx.lineWidth = Math.max(1.3, 2 * cam.zoom);
        ctx.setLineDash([8 * cam.zoom, 6 * cam.zoom]);
        ctx.beginPath();
        ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU);
        ctx.stroke();
      }
    } else if (st.power === "lightningStorm") {
      const cloudFade = (toImpact > 0 ? clamp(elapsed / 1.1, 0, 1) : clamp(1 - (sinceImpact - durSec) / 2.2, 0, 1)) * fadeAll;
      if (cloudFade > 0.01) {
        const sh = ctx.createRadialGradient(sx, sy, rx * 0.15, sx, sy, rx * 1.15);
        sh.addColorStop(0, `rgba(12,18,28,${0.46 * cloudFade})`);
        sh.addColorStop(0.75, `rgba(14,22,34,${0.3 * cloudFade})`);
        sh.addColorStop(1, "rgba(14,22,34,0)");
        ctx.fillStyle = sh;
        ctx.beginPath();
        ctx.ellipse(sx, sy, rx * 1.15, ry * 1.15, 0, 0, TAU);
        ctx.fill();
        if (sinceImpact < durSec) {
          ctx.strokeStyle = `rgba(100,181,255,${0.32 * cloudFade})`;
          ctx.lineWidth = Math.max(1.2, 1.6 * cam.zoom);
          ctx.setLineDash([8 * cam.zoom, 6 * cam.zoom]);
          ctx.beginPath();
          ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU);
          ctx.stroke();
        }
      }
    } else if (st.power === "droneSwarm") {
      if (sinceImpact < durSec) {
        const outFade = clamp((durSec - sinceImpact) / 1.0, 0, 1) * inFade;
        ctx.strokeStyle = `rgba(255,93,71,${0.38 * outFade})`;
        ctx.lineWidth = Math.max(1.2, 1.5 * cam.zoom);
        ctx.setLineDash([6 * cam.zoom, 6 * cam.zoom]);
        ctx.beginPath();
        ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU);
        ctx.stroke();
      }
    } else if (st.power === "cyberBlackout") {
      if (toImpact > 0) {
        const k = 1 - clamp(toImpact / delaySec, 0, 1);
        ctx.strokeStyle = `rgba(46,242,214,${(0.4 + 0.5 * k) * inFade})`;
        ctx.lineWidth = Math.max(1.4, 2 * cam.zoom);
        ctx.beginPath();
        ctx.ellipse(sx, sy, rx * (1.2 - 0.2 * k), ry * (1.2 - 0.2 * k), 0, 0, TAU);
        ctx.stroke();
      } else if (sinceImpact >= 0 && sinceImpact < 1.5) {
        const p = clamp(sinceImpact / 1.4, 0, 1);
        ctx.strokeStyle = `rgba(46,242,214,${(1 - p) * 0.92 * fadeAll})`;
        ctx.lineWidth = Math.max(1.2, (4 * (1 - p) + 1) * cam.zoom);
        ctx.beginPath();
        ctx.ellipse(sx, sy, rx * p * 1.08, ry * p * 1.08, 0, 0, TAU);
        ctx.stroke();
      }
    } else if (st.power === "orbitalLaser") {
      if (toImpact > 0) {
        const [bx, by] = cam.screen(st.x2, st.y2);
        const k = 1 - clamp(toImpact / delaySec, 0, 1);
        ctx.strokeStyle = `rgba(77,195,255,${(0.35 + 0.55 * k) * inFade})`;
        ctx.lineWidth = Math.max(1.4, 2 * cam.zoom);
        ctx.setLineDash([10 * cam.zoom, 6 * cam.zoom]);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    } else if (st.power === "thermobaricMoab") {
      if (toImpact > 0) {
        const k = 1 - clamp(toImpact / delaySec, 0, 1);
        ctx.strokeStyle = `rgba(255,122,41,${(0.35 + 0.5 * k) * inFade})`;
        ctx.lineWidth = Math.max(1.4, 2 * cam.zoom);
        ctx.beginPath();
        ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU);
        ctx.stroke();
      } else if (sinceImpact >= 0 && sinceImpact < 1.4) {
        for (const [lag, w] of [[0, 11], [0.18, 5]]) {
          const rp = clamp((sinceImpact - lag) / 1.15, 0, 1);
          if (rp <= 0 || rp >= 1) continue;
          ctx.strokeStyle = `rgba(255,215,155,${(1 - rp) * 0.9 * fadeAll})`;
          ctx.lineWidth = Math.max(1.5, (1 - rp) * w * unitScale);
          ctx.beginPath();
          ctx.ellipse(sx, sy, rx * (0.2 + rp * 1.5), ry * (0.2 + rp * 1.5), 0, 0, TAU);
          ctx.stroke();
        }
      }
    } else if (st.power === "empPulse") {
      if (toImpact > 0) {
        const k = 1 - clamp(toImpact / delaySec, 0, 1);
        ctx.strokeStyle = `rgba(88,166,255,${(0.35 + 0.5 * k) * inFade})`;
        ctx.lineWidth = Math.max(1.4, 2 * cam.zoom);
        ctx.beginPath();
        ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU);
        ctx.stroke();
      } else if (sinceImpact >= 0 && sinceImpact < 1.3) {
        ctx.globalCompositeOperation = "lighter";
        for (const [lag, mult] of [[0, 1.08], [0.14, 0.92]]) {
          const rp = clamp((sinceImpact - lag) / 1.05, 0, 1);
          if (rp <= 0 || rp >= 1) continue;
          ctx.strokeStyle = `rgba(135,215,255,${(1 - rp) * 0.92 * fadeAll})`;
          ctx.lineWidth = Math.max(1.6, (1 - rp) * 9 * unitScale);
          ctx.beginPath();
          ctx.ellipse(sx, sy, rx * rp * mult, ry * rp * mult, 0, 0, TAU);
          ctx.stroke();
        }
      }
    } else if (st.power === "napalmRun") {
      if (toImpact > 0) {
        const [bx, by] = cam.screen(st.x2, st.y2);
        ctx.strokeStyle = "rgba(255,95,38,0.55)";
        ctx.lineWidth = Math.max(10, (sp.width || 88) * 0.6 * cam.zoom);
        ctx.lineCap = "round";
        ctx.globalAlpha = 0.2 * inFade;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    } else if (st.power === "artilleryFirestorm") {
      if (sinceImpact < durSec) {
        const outFade = clamp((durSec - sinceImpact) / 1.0, 0, 1) * inFade;
        ctx.strokeStyle = `rgba(240,180,58,${0.42 * outFade})`;
        ctx.lineWidth = Math.max(1.2, 1.6 * cam.zoom);
        ctx.setLineDash([8 * cam.zoom, 8 * cam.zoom]);
        ctx.beginPath();
        ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU);
        ctx.stroke();
      }
    } else if (st.power === "scudSalvo") {
      if (sinceImpact < durSec) {
        const outFade = clamp((durSec - sinceImpact) / 0.8, 0, 1) * inFade;
        ctx.strokeStyle = `rgba(232,100,60,${0.48 * outFade})`;
        ctx.lineWidth = Math.max(1.4, 2 * cam.zoom);
        ctx.setLineDash([12 * cam.zoom, 6 * cam.zoom]);
        ctx.beginPath();
        ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU);
        ctx.stroke();
      }
    } else if (st.power === "tunnelAmbush") {
      if (toImpact > 0) {
        const k = 1 - clamp(toImpact / delaySec, 0, 1);
        const r = rng(st.seed + 19);
        for (let i = 0; i < 3; i++) {
          const rp = reducedMotion ? (i + 1) / 3 : ((now / 700) + i / 3) % 1;
          ctx.strokeStyle = `rgba(212,141,70,${(1 - rp * 0.85) * (0.35 + 0.55 * k) * inFade})`;
          ctx.lineWidth = Math.max(1.3, 2.2 * cam.zoom);
          ctx.beginPath();
          ctx.ellipse(sx, sy, rx * rp, ry * rp, 0, 0, TAU);
          ctx.stroke();
        }
        ctx.strokeStyle = `rgba(18,12,8,${(0.4 + 0.55 * k) * inFade})`;
        ctx.lineWidth = Math.max(1, (1.5 + 2.5 * k) * cam.zoom);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU + (r() - 0.5) * 0.35;
          const len = rx * 0.78 * k;
          const midA = a + (r() - 0.5) * 0.35;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + Math.cos(midA) * len * 0.5, sy + Math.sin(midA) * len * 0.25);
          ctx.lineTo(sx + Math.cos(a) * len, sy + Math.sin(a) * len * 0.5);
          ctx.stroke();
        }
        const dg = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(1, rx * 0.55 * k));
        dg.addColorStop(0, `rgba(155,132,96,${0.55 * k * inFade})`);
        dg.addColorStop(1, "rgba(140,120,88,0)");
        ctx.fillStyle = dg;
        ctx.beginPath();
        ctx.ellipse(sx, sy, rx * 0.55 * k, ry * 0.55 * k, 0, 0, TAU);
        ctx.fill();
      }
    } else if (st.power === "radioSpoof") {
      if (toImpact > 0) {
        const k = 1 - clamp(toImpact / delaySec, 0, 1);
        ctx.strokeStyle = `rgba(201,122,255,${(0.4 + 0.5 * k) * inFade})`;
        ctx.lineWidth = Math.max(1.3, 2 * cam.zoom);
        ctx.beginPath();
        ctx.ellipse(sx, sy, rx * (1.15 - 0.15 * k), ry * (1.15 - 0.15 * k), 0, 0, TAU);
        ctx.stroke();
      } else if (sinceImpact >= 0 && sinceImpact < 1.2) {
        const p = clamp(sinceImpact / 1.2, 0, 1);
        ctx.strokeStyle = `rgba(204,122,255,${(1 - p) * 0.85 * fadeAll})`;
        ctx.lineWidth = Math.max(1.2, (1 - p) * 4 * cam.zoom);
        ctx.beginPath();
        ctx.ellipse(sx, sy, rx * (0.25 + p * 0.85), ry * (0.25 + p * 0.85), 0, 0, TAU);
        ctx.stroke();
      }
    } else if (st.power === "cruiseMissiles") {
      // Never reveal locked target crosshairs to the enemy before missile impact!
      const showLocks = state.side === undefined || state.side === -1 || state.side === st.side;
      if (showLocks) {
        for (let i = 0; i < (st.subImpacts?.length ?? 0); i++) {
          const sub = st.subImpacts[i];
          const span = Math.max(1, sub.impactTick - sub.launchTick);
          const k = (tick - sub.launchTick) / span;
          if (k < 1) {
            const [tx, ty] = cam.screen(sub.x, sub.y);
            const pulse = reducedMotion ? 0.85 : 0.65 + 0.35 * Math.sin(now / 110 + i);
            ctx.strokeStyle = `rgba(255,77,109,${0.75 * pulse * inFade})`;
            ctx.lineWidth = Math.max(1.2, 1.8 * cam.zoom);
            ctx.beginPath();
            ctx.ellipse(tx, ty, 22 * unitScale, 11 * unitScale, 0, 0, TAU);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(tx - 14 * unitScale, ty);
            ctx.lineTo(tx + 14 * unitScale, ty);
            ctx.moveTo(tx, ty - 7 * unitScale);
            ctx.lineTo(tx, ty + 7 * unitScale);
            ctx.stroke();
          }
        }
      }
    }
    ctx.restore();
  }

  // ---- Layer 2B: Depth-Sorted 3D Plumes, Low-Pass Aircraft/Missiles & Status Arcs (sorted in `things`) ----

  standing(cam, state, rules, now, unitScale, fx, sfx, reducedMotion = false) {
    const items = [];
    if (!state || this.overFade <= 0.01) return items;
    const tick = this.tickOf(state);
    const rate = rules?.tickRate || 10;
    const fadeAll = this.overFade;

    // 1. 3D volumetric hazard plumes & decoys.
    for (const h of state.hazards ?? []) {
      if (h.visible === false) continue;
      const span = Math.max(1, h.endTick - h.startTick);
      const age = clamp((tick - h.startTick) / span, 0, 1);
      const fadeIn = clamp((tick - h.startTick) / 6, 0, 1);
      const fadeOut = clamp((h.endTick - tick) / 22, 0, 1);
      const vis = fadeIn * fadeOut * fadeAll;
      if (vis <= 0.01) continue;

      if (h.kind === "chemical") {
        const [sx, sy] = cam.screen(h.x, h.y);
        const { rx, ry } = groundEllipse(h.r, cam.zoom);
        if (this.onScreen(cam, sx, sy, rx + 50)) {
          items.push({
            depth: h.x + h.y + 18,
            raw: true,
            draw: (ctx) => this.drawChemicalPlumes(ctx, sx, sy, rx, ry, h, now, vis, cam.zoom, reducedMotion),
          });
        }
      } else if (h.kind === "napalm") {
        const r = rng(h.id * 1337 + 9);
        const w = Math.max(10, h.r * 1.35 * cam.zoom);
        for (let i = 0; i < 16; i++) {
          const k = i / 15;
          const wx = h.x + (h.x2 - h.x) * k;
          const wy = h.y + (h.y2 - h.y) * k;
          const jx = (r() - 0.5) * w * 0.72;
          const jy = (r() - 0.5) * w * 0.42;
          const hSeed = r();
          const wSeed = r();
          const [bx, by] = cam.screen(wx, wy);
          if (!this.onScreen(cam, bx, by, 90)) continue;
          items.push({
            depth: wx + wy + 15,
            raw: true,
            draw: (ctx) => this.drawNapalmPlume(ctx, bx + jx, by + jy, i, hSeed, wSeed, now, vis, unitScale, reducedMotion),
          });
        }
      } else if (h.kind === "trench") {
        const cool = clamp(1 - age * 0.88, 0.08, 1);
        for (let i = 0; i < 8; i++) {
          const k = (i + 0.5) / 8;
          const wx = h.x + (h.x2 - h.x) * k;
          const wy = h.y + (h.y2 - h.y) * k;
          const [sx, sy] = cam.screen(wx, wy);
          if (!this.onScreen(cam, sx, sy, 60)) continue;
          items.push({
            depth: wx + wy + 14,
            raw: true,
            draw: (ctx) => {
              const rise = reducedMotion ? 14 * unitScale : ((now / 32 + i * 19) % 34) * unitScale;
              const a = (1 - rise / (34 * unitScale)) * 0.3 * cool * vis;
              if (a <= 0.01) return;
              ctx.save();
              ctx.fillStyle = `rgba(210,224,234,${a})`;
              ctx.beginPath();
              ctx.arc(sx + (reducedMotion ? 0 : Math.sin(now / 300 + i) * 3 * unitScale), sy - rise, (5 + rise * 0.16) * cam.zoom, 0, TAU);
              ctx.fill();
              ctx.restore();
            },
          });
        }
      } else if (h.kind === "spoof") {
        for (let i = 0; i < (h.decoys?.length ?? 0); i++) {
          const d = h.decoys[i];
          const [dx, dy] = cam.screen(d.x, d.y);
          if (!this.onScreen(cam, dx, dy, 60)) continue;
          items.push({
            depth: d.x + d.y + 12,
            raw: true,
            draw: (ctx) => this.drawSpoofDecoy(ctx, dx, dy, d, i, now, vis, unitScale, reducedMotion),
          });
        }
      }
    }

    // 2. EMP-stunned & Cyber-disabled unit/structure electric arcs (sorted at unit/structure depth).
    const rStatus = rng((reducedMotion ? 7 : Math.floor(now / 110)) + 41);
    const pushTeamArcs = (teams) => {
      for (const t of teams ?? []) {
        if (!t.stunned) continue;
        const [sx, sy] = cam.screen(t.x, t.y);
        if (!this.onScreen(cam, sx, sy, 50)) continue;
        const seed = Math.floor(rStatus() * 1e6);
        items.push({
          depth: t.x + t.y + 18,
          raw: true,
          draw: (ctx) => {
            const rr = rng(seed);
            const rad = 16 * unitScale;
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.strokeStyle = `rgba(135,220,255,${0.86 * fadeAll})`;
            ctx.lineWidth = Math.max(1.1, 1.5 * unitScale);
            for (let i = 0; i < (reducedMotion ? 1 : 2); i++) {
              const a1 = rr() * TAU;
              const a2 = a1 + 1.4 + rr();
              const pts = boltPath(
                sx + Math.cos(a1) * rad,
                sy - 10 * unitScale + Math.sin(a1) * rad * 0.5,
                sx + Math.cos(a2) * rad,
                sy - 10 * unitScale + Math.sin(a2) * rad * 0.5,
                rr,
                3,
                10 * unitScale,
              );
              strokePolyline(ctx, pts);
            }
            ctx.restore();
          },
        });
      }
    };
    for (const sq of state.squads ?? []) pushTeamArcs(sq.teams);
    for (const c of state.contacts ?? []) pushTeamArcs(c.teams);

    for (const st of state.structures ?? []) {
      if (!st.disabled || st.ruin) continue;
      const [sx, sy] = cam.screen(st.x, st.y);
      if (!this.onScreen(cam, sx, sy, 70)) continue;
      const seed = Math.floor(rStatus() * 1e6);
      items.push({
        depth: st.x + st.y + 20,
        raw: true,
        draw: (ctx) => {
          const rr = rng(seed);
          const rad = 24 * unitScale;
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          ctx.strokeStyle = `rgba(46,242,214,${0.82 * fadeAll})`;
          ctx.lineWidth = Math.max(1.2, 1.7 * unitScale);
          const a1 = rr() * TAU;
          const pts = boltPath(sx + Math.cos(a1) * rad, sy - 16 * unitScale, sx - Math.cos(a1) * rad, sy - 24 * unitScale, rr, 3, 12 * unitScale);
          strokePolyline(ctx, pts);
          ctx.restore();
        },
      });
    }

    // 3. Active super-power strike side-effects (SFX/blasts/shakes) + 3D standing/mid-air bodies.
    for (const st of state.superStrikes ?? []) {
      const sp = rules?.superPowers?.find((p) => p.id === st.power);
      if (!sp) continue;

      const sinceLaunch = (tick - st.startTick) / rate;
      const toImpact = (st.impactTick - tick) / rate;
      const sinceImpact = (tick - st.impactTick) / rate;
      const delaySec = Math.max(0.1, (st.impactTick - st.startTick) / rate);
      const durSec = Math.max(0.1, (st.endTick - st.impactTick) / rate);

      // Launch SFX once (only if fresh, never replayed on reload or after tab hide).
      if (!this.fired.has(st.id)) {
        this.fired.add(st.id);
        if (!this.suppressBursts && sinceLaunch >= -0.05 && sinceLaunch <= 0.65) {
          sfx?.playSuper?.(st.power, "launch", cam, st.x, st.y);
        }
      }

      this.collectStrikeStanding(items, cam, st, sp, tick, rate, toImpact, sinceImpact, delaySec, durSec, now, unitScale, fx, sfx, fadeAll, reducedMotion);
    }

    return items;
  }

  drawChemicalPlumes(ctx, sx, sy, rx, ry, h, now, vis, zoom, reducedMotion) {
    const r = rng(h.id * 48271);
    ctx.save();
    for (let i = 0; i < 18; i++) {
      const baseA = r() * TAU;
      const baseD = 0.1 + r() * 0.72;
      const swirl = reducedMotion ? baseA : baseA + Math.sin(now / 1400 + i) * 0.28 + now * 0.00018 * (i % 2 ? 1 : -1);
      const px = sx + Math.cos(swirl) * rx * baseD;
      const py = sy + Math.sin(swirl) * ry * baseD - (6 + (reducedMotion ? 4 : 9 * Math.sin(now / 900 + i * 1.7))) * zoom;
      const pr = rx * (0.24 + r() * 0.22);
      const pg = ctx.createRadialGradient(px, py, 0, px, py, Math.max(1, pr));
      const bright = i % 3 === 0;
      pg.addColorStop(0, bright ? `rgba(186,238,68,${0.32 * vis})` : `rgba(136,184,42,${0.3 * vis})`);
      pg.addColorStop(0.55, `rgba(98,136,34,${0.19 * vis})`);
      pg.addColorStop(1, "rgba(76,104,28,0)");
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.ellipse(px, py, pr, pr * 0.62, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawNapalmPlume(ctx, fx, fy, i, hSeed, wSeed, now, vis, unitScale, reducedMotion) {
    const flick = reducedMotion ? 0.9 : 0.74 + 0.26 * Math.sin(now / 95 + i * 2.3);
    const fh = (18 + hSeed * 20) * unitScale * flick * vis;
    const fw = (7 + wSeed * 7) * unitScale;
    ctx.save();
    const sRise = reducedMotion ? 18 * unitScale : ((now / 28 + i * 17) % 42) * unitScale;
    const sAlpha = (1 - sRise / (42 * unitScale)) * 0.36 * vis;
    if (sAlpha > 0.01) {
      const sg = ctx.createRadialGradient(fx, fy - fh * 0.6 - sRise, 0, fx, fy - fh * 0.6 - sRise, Math.max(1, fw * 2.3));
      sg.addColorStop(0, `rgba(232,230,222,${sAlpha})`);
      sg.addColorStop(0.6, `rgba(170,164,154,${sAlpha * 0.65})`);
      sg.addColorStop(1, "rgba(130,126,120,0)");
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(fx, fy - fh * 0.6 - sRise, fw * 2.3, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "lighter";
    const fg = ctx.createRadialGradient(fx, fy - fh * 0.35, 0, fx, fy - fh * 0.35, Math.max(1, fh));
    fg.addColorStop(0, `rgba(255,250,205,${0.88 * vis})`);
    fg.addColorStop(0.35, `rgba(255,152,32,${0.72 * vis})`);
    fg.addColorStop(0.75, `rgba(215,48,14,${0.38 * vis})`);
    fg.addColorStop(1, "rgba(140,20,6,0)");
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.ellipse(fx, fy - fh * 0.35, fw * 1.12, fh * 0.85, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawSpoofDecoy(ctx, dx, dy, d, i, now, vis, unitScale, reducedMotion) {
    const jitterX = reducedMotion ? 0 : Math.sin(now / 80 + i * 7) * 1.5 * unitScale;
    const flick = reducedMotion ? 0.85 : 0.62 + 0.38 * Math.sin(now / 120 + i * 3.1);
    const isVeh = d.unit === "tank" || d.unit === "technical" || d.unit === "rocketLauncher";
    const s = unitScale * (isVeh ? 15 : 8);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = `rgba(210,135,255,${0.62 * flick * vis})`;
    ctx.lineWidth = Math.max(1, 1.2 * unitScale);
    ctx.beginPath();
    ctx.ellipse(dx, dy, s * 1.15, s * 0.58, 0, 0, TAU);
    ctx.stroke();

    for (const [ox, col] of [[-1.4 * unitScale, `rgba(70,240,255,${0.52 * flick * vis})`], [1.4 * unitScale, `rgba(220,105,255,${0.6 * flick * vis})`]]) {
      ctx.strokeStyle = col;
      ctx.fillStyle = col.replace(/[\d.]+\)$/, `${0.2 * flick * vis})`);
      ctx.lineWidth = Math.max(1, 1.3 * unitScale);
      if (isVeh) {
        ctx.beginPath();
        ctx.roundRect(dx + jitterX + ox - s * 0.9, dy - s * 0.75, s * 1.8, s * 0.85, 3);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(dx + jitterX + ox, dy - s * 0.55, s * 0.45, 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(dx + jitterX + ox, dy - s * 0.55);
        ctx.lineTo(dx + jitterX + ox + s * 1.2, dy - s * 0.8);
        ctx.stroke();
      } else {
        for (const [mx, my] of [[-s * 0.6, 0], [0, -s * 0.25], [s * 0.6, s * 0.1]]) {
          ctx.beginPath();
          ctx.arc(dx + jitterX + ox + mx, dy + my - s * 0.95, s * 0.25, 0, TAU);
          ctx.moveTo(dx + jitterX + ox + mx, dy + my - s * 0.7);
          ctx.lineTo(dx + jitterX + ox + mx, dy + my);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  fireOnce(st, sinceImpact, cam, fx, sfx, { shake = 0, blast = 0, flash = null, sound = "impact", x = st.x, y = st.y } = {}) {
    if (sinceImpact < 0 || this.detonated.has(st.id)) return;
    this.detonated.add(st.id);
    if (this.suppressBursts || sinceImpact > 0.45) return;
    if (shake > 0) fx?.shake?.(x, y, shake, performance.now());
    if (blast > 0) fx?.blast?.(x, y, performance.now(), blast, { scorch: false });
    if (sound) sfx?.playSuper?.(st.power, sound, cam, x, y);
    if (flash) this.flash(cam, x, y, flash.color, flash.alpha, flash.ttl, performance.now());
  }

  fireSubOnce(st, idx, subAge, cam, fx, sfx, { shake = 0, blast = 0, sound = "", x = 0, y = 0 } = {}) {
    const key = `${st.id}:${idx}`;
    if (subAge < 0 || this.subDone.has(key)) return;
    this.subDone.add(key);
    if (this.suppressBursts || subAge > 0.4) return;
    if (shake > 0) fx?.shake?.(x, y, shake, performance.now());
    if (blast > 0) fx?.blast?.(x, y, performance.now(), blast, { scorch: false });
    if (sound) sfx?.playSuper?.(st.power, sound, cam, x, y);
  }

  collectStrikeStanding(items, cam, st, sp, tick, rate, toImpact, sinceImpact, delaySec, durSec, now, unitScale, fx, sfx, fadeAll, reducedMotion) {
    const [sx, sy] = cam.screen(st.x, st.y);
    const { rx, ry } = groundEllipse(sp.radius, cam.zoom);

    if (st.power === "rodOfGod") {
      if (sinceImpact >= 0) {
        this.fireOnce(st, sinceImpact, cam, fx, sfx, {
          shake: 26,
          blast: 2.2,
          flash: { color: "220,246,255", alpha: 0.52, ttl: 420 },
        });
      }
      if (sinceImpact >= 0 && sinceImpact < 3.0 && this.onScreen(cam, sx, sy, rx * 2 + 80)) {
        items.push({
          depth: st.x + st.y + 18,
          raw: true,
          draw: (ctx) => {
            const p = clamp(sinceImpact / 2.9, 0, 1);
            ctx.save();
            const coreR = rx * (0.35 + Math.sin(Math.min(1, sinceImpact / 0.9) * Math.PI * 0.5) * 0.55);
            const fireA = clamp(1 - sinceImpact / 1.4, 0, 1) * fadeAll;
            if (fireA > 0.01) {
              ctx.globalCompositeOperation = "lighter";
              const fg = ctx.createRadialGradient(sx, sy - coreR * 0.25, 0, sx, sy - coreR * 0.25, Math.max(1, coreR));
              fg.addColorStop(0, `rgba(255,255,245,${fireA})`);
              fg.addColorStop(0.45, `rgba(255,190,85,${fireA * 0.85})`);
              fg.addColorStop(1, "rgba(210,75,18,0)");
              ctx.fillStyle = fg;
              ctx.beginPath();
              ctx.arc(sx, sy - coreR * 0.25, coreR, 0, TAU);
              ctx.fill();
            }
            ctx.globalCompositeOperation = "source-over";
            const r = rng(st.seed);
            for (let i = 0; i < 24; i++) {
              const a = r() * TAU;
              const spd = (0.45 + r() * 1.1) * rx * 1.3;
              const vh = (90 + r() * 140) * unitScale;
              const dx = sx + Math.cos(a) * spd * p;
              const dy = sy + Math.sin(a) * spd * 0.5 * p - Math.max(0, vh * p - 150 * unitScale * p * p);
              const da = clamp(1 - p * 1.12, 0, 1) * fadeAll;
              if (da <= 0.01) continue;
              ctx.fillStyle = i % 3 === 0 ? `rgba(255,210,115,${da})` : `rgba(60,50,40,${da})`;
              ctx.beginPath();
              ctx.arc(dx, dy, Math.max(1.4, (2 + r() * 2.4) * unitScale), 0, TAU);
              ctx.fill();
            }
            ctx.restore();
          },
        });
      }
    } else if (st.power === "tacticalNuke") {
      if (sinceImpact >= 0) {
        this.fireOnce(st, sinceImpact, cam, fx, sfx, {
          shake: 38,
          blast: 3.0,
          flash: { color: "255,250,235", alpha: 0.84, ttl: 920 },
        });
      }
    } else if (st.power === "chemicalStrike") {
      if (sinceImpact >= 0) {
        this.fireOnce(st, sinceImpact, cam, fx, sfx, { shake: 7 });
      }
      if (toImpact > 0 && toImpact < 1.3 && this.onScreen(cam, sx, sy, rx + 120)) {
        const drop = 1 - toImpact / 1.3;
        const inA = clamp(drop / 0.15, 0, 1) * fadeAll;
        items.push({
          depth: st.x + st.y + 85,
          raw: true,
          draw: (ctx) => {
            ctx.save();
            for (let i = 0; i < 4; i++) {
              const a = (i / 4) * TAU + 0.4;
              const tx = sx + Math.cos(a) * rx * 0.45;
              const ty = sy + Math.sin(a) * ry * 0.45;
              const cx = tx - (1 - drop) * 80 * unitScale;
              const cy = ty - (1 - drop * drop) * 240 * unitScale;
              ctx.strokeStyle = `rgba(180,235,90,${0.55 * inA})`;
              ctx.lineWidth = Math.max(1.2, 2.2 * unitScale);
              ctx.beginPath();
              ctx.moveTo(cx - 18 * unitScale, cy - 48 * unitScale);
              ctx.lineTo(cx, cy);
              ctx.stroke();
              ctx.fillStyle = `rgba(168,230,61,${inA})`;
              ctx.beginPath();
              ctx.arc(cx, cy, Math.max(1.8, 3.2 * unitScale), 0, TAU);
              ctx.fill();
            }
            ctx.restore();
          },
        });
      } else if (sinceImpact >= 0 && sinceImpact < 1.6 && this.onScreen(cam, sx, sy, rx * 1.5)) {
        items.push({
          depth: st.x + st.y + 18,
          raw: true,
          draw: (ctx) => {
            const p = clamp(sinceImpact / 1.5, 0, 1);
            ctx.save();
            for (let i = 0; i < 4; i++) {
              const a = (i / 4) * TAU + 0.4;
              const bx = sx + Math.cos(a) * rx * 0.45;
              const by = sy + Math.sin(a) * ry * 0.45;
              const br = rx * (0.2 + p * 0.6);
              const g = ctx.createRadialGradient(bx, by, 0, bx, by, Math.max(1, br));
              g.addColorStop(0, `rgba(198,255,80,${(1 - p) * 0.68 * fadeAll})`);
              g.addColorStop(1, "rgba(120,180,30,0)");
              ctx.fillStyle = g;
              ctx.beginPath();
              ctx.ellipse(bx, by, br, br * 0.55, 0, 0, TAU);
              ctx.fill();
            }
            ctx.restore();
          },
        });
      }
    } else if (st.power === "lightningStorm") {
      for (let i = 0; i < (st.subImpacts?.length ?? 0); i++) {
        const sub = st.subImpacts[i];
        const age = (tick - sub.impactTick) / rate;
        if (age >= 0) {
          this.fireSubOnce(st, i, age, cam, fx, sfx, { shake: 10, blast: 0.75, sound: "bolt", x: sub.x, y: sub.y });
        }
      }
    } else if (st.power === "droneSwarm") {
      for (let i = 0; i < (st.subImpacts?.length ?? 0); i++) {
        const sub = st.subImpacts[i];
        const tToHit = (sub.impactTick - tick) / rate;
        if (tToHit <= 0) {
          this.fireSubOnce(st, i, -tToHit, cam, fx, sfx, { shake: 4, blast: 0.7, sound: "pop", x: sub.x, y: sub.y });
          continue;
        }
        const [tx, ty] = cam.screen(sub.x, sub.y);
        const orbitAngle = (reducedMotion ? 0.8 : now * 0.0042) + i * 1.37;
        const orbitR = rx * (0.28 + (i % 5) * 0.14);
        let dx = sx + Math.cos(orbitAngle) * orbitR;
        let dy = sy + Math.sin(orbitAngle) * orbitR * 0.52;
        let alt = (56 + (i % 4) * 14 + (reducedMotion ? 0 : Math.sin(now / 180 + i) * 6)) * unitScale;
        let inFade = fadeAll;

        if (toImpact > 0) {
          const k = clamp(toImpact / Math.max(0.5, delaySec), 0, 1);
          inFade *= clamp(1 - k * 0.85 + 0.15, 0, 1);
          dx -= k * 240 * unitScale;
          alt += k * 55 * unitScale;
        } else if (tToHit < 0.75) {
          const dive = 1 - tToHit / 0.75;
          dx = dx + (tx - dx) * dive * dive;
          dy = dy + (ty - dy) * dive * dive;
          alt *= 1 - dive * dive;
        }
        if (!this.onScreen(cam, dx, dy, 80)) continue;
        const [wx, wy] = cam.world(dx, dy);
        const diving = toImpact <= 0 && tToHit < 0.75;
        items.push({
          depth: wx + wy + (diving ? 35 : 88),
          raw: true,
          draw: (ctx) => {
            ctx.save();
            ctx.globalAlpha = inFade;
            if (diving) {
              ctx.strokeStyle = "rgba(255,60,50,0.72)";
              ctx.lineWidth = Math.max(1, 1.2 * unitScale);
              ctx.beginPath();
              ctx.moveTo(dx, dy - alt);
              ctx.lineTo(tx, ty);
              ctx.stroke();
            }
            ctx.fillStyle = "rgba(0,0,0,0.28)";
            ctx.beginPath();
            ctx.ellipse(dx, dy, 4 * unitScale, 2 * unitScale, 0, 0, TAU);
            ctx.fill();

            const px = dx;
            const py = dy - alt;
            const sz = 5.5 * unitScale;
            ctx.strokeStyle = "#1c2024";
            ctx.lineWidth = Math.max(1.1, 1.8 * unitScale);
            ctx.beginPath();
            ctx.moveTo(px - sz, py - sz * 0.55);
            ctx.lineTo(px + sz, py + sz * 0.55);
            ctx.moveTo(px + sz, py - sz * 0.55);
            ctx.lineTo(px - sz, py + sz * 0.55);
            ctx.stroke();
            ctx.fillStyle = "rgba(220,232,240,0.45)";
            for (const [rxo, ryo] of [[-sz, -sz * 0.55], [sz, sz * 0.55], [sz, -sz * 0.55], [-sz, sz * 0.55]]) {
              ctx.beginPath();
              ctx.ellipse(px + rxo, py + ryo, 2.4 * unitScale, 1.3 * unitScale, 0, 0, TAU);
              ctx.fill();
            }
            ctx.fillStyle = reducedMotion || (Math.floor(now / 150) + i) % 2 ? "#ff3b30" : "#ffaa44";
            ctx.beginPath();
            ctx.arc(px, py, Math.max(1.2, 1.8 * unitScale), 0, TAU);
            ctx.fill();
            ctx.restore();
          },
        });
      }
    } else if (st.power === "cyberBlackout") {
      if (sinceImpact >= 0) {
        this.fireOnce(st, sinceImpact, cam, fx, sfx, { shake: 5 });
      }
    } else if (st.power === "orbitalLaser") {
      if (sinceImpact >= 0) {
        this.fireOnce(st, sinceImpact, cam, fx, sfx, {});
      }
      if (sinceImpact >= 0 && sinceImpact <= durSec + 0.4) {
        const k = clamp(sinceImpact / durSec, 0, 1);
        const fade = (sinceImpact > durSec ? clamp(1 - (sinceImpact - durSec) / 0.4, 0, 1) : 1) * fadeAll;
        const wx = st.x + (st.x2 - st.x) * k;
        const wy = st.y + (st.y2 - st.y) * k;
        if (!this.suppressBursts && fade > 0.25 && Math.random() < 0.3) fx?.shake?.(wx, wy, 4.5, now);
        const [hx, hy] = cam.screen(wx, wy);
        if (this.onScreen(cam, hx, hy, 90)) {
          items.push({
            depth: wx + wy + 18,
            raw: true,
            draw: (ctx) => {
              ctx.save();
              ctx.globalCompositeOperation = "lighter";
              const sg = ctx.createRadialGradient(hx, hy, 0, hx, hy, Math.max(1, 38 * unitScale));
              sg.addColorStop(0, `rgba(255,255,255,${fade})`);
              sg.addColorStop(0.35, `rgba(140,225,255,${0.85 * fade})`);
              sg.addColorStop(0.65, `rgba(255,145,40,${0.6 * fade})`);
              sg.addColorStop(1, "rgba(255,80,15,0)");
              ctx.fillStyle = sg;
              ctx.beginPath();
              ctx.ellipse(hx, hy, 38 * unitScale, 22 * unitScale, 0, 0, TAU);
              ctx.fill();
              if (!reducedMotion) {
                const sr = rng(Math.floor(now / 55) + st.id);
                for (let i = 0; i < 12; i++) {
                  const a = -Math.PI * sr();
                  const d = (12 + sr() * 34) * unitScale;
                  ctx.strokeStyle = i % 2 ? `rgba(255,235,160,${0.88 * fade})` : `rgba(145,230,255,${0.88 * fade})`;
                  ctx.lineWidth = Math.max(1, 1.5 * unitScale);
                  ctx.beginPath();
                  ctx.moveTo(hx, hy);
                  ctx.lineTo(hx + Math.cos(a) * d, hy + Math.sin(a) * d);
                  ctx.stroke();
                }
              }
              ctx.restore();
            },
          });
        }
      }
    } else if (st.power === "thermobaricMoab") {
      if (sinceImpact >= 0) {
        this.fireOnce(st, sinceImpact, cam, fx, sfx, {
          shake: 28,
          blast: 2.5,
          flash: { color: "255,195,120", alpha: 0.58, ttl: 520 },
        });
      }
      if (toImpact > 0 && toImpact < 0.55 && this.onScreen(cam, sx, sy, rx + 60)) {
        const ap = 1 - toImpact / 0.55;
        items.push({
          depth: st.x + st.y + 18,
          raw: true,
          draw: (ctx) => {
            const ar = rx * (0.15 + ap * 0.82);
            ctx.save();
            const ag = ctx.createRadialGradient(sx, sy - ar * 0.15, 0, sx, sy - ar * 0.15, Math.max(1, ar));
            ag.addColorStop(0, `rgba(240,224,185,${0.66 * fadeAll})`);
            ag.addColorStop(0.65, `rgba(195,175,145,${0.4 * fadeAll})`);
            ag.addColorStop(1, "rgba(170,155,130,0)");
            ctx.fillStyle = ag;
            ctx.beginPath();
            ctx.ellipse(sx, sy - ar * 0.1, ar, ar * 0.62, 0, 0, TAU);
            ctx.fill();
            ctx.restore();
          },
        });
      } else if (sinceImpact >= 0 && sinceImpact < 3.5 && this.onScreen(cam, sx, sy, rx * 1.8)) {
        items.push({
          depth: st.x + st.y + 20,
          raw: true,
          draw: (ctx) => {
            const p = clamp(sinceImpact / 3.4, 0, 1);
            const fireA = clamp(1 - sinceImpact / 2.2, 0, 1) * fadeAll;
            const domeR = rx * (0.45 + Math.pow(Math.min(1, sinceImpact / 1.1), 0.5) * 0.68);
            ctx.save();
            if (fireA > 0.01) {
              ctx.globalCompositeOperation = "lighter";
              const fg = ctx.createRadialGradient(sx, sy - domeR * 0.25, 0, sx, sy - domeR * 0.25, Math.max(1, domeR));
              fg.addColorStop(0, `rgba(255,255,235,${fireA})`);
              fg.addColorStop(0.38, `rgba(255,148,38,${0.9 * fireA})`);
              fg.addColorStop(0.74, `rgba(220,52,14,${0.6 * fireA})`);
              fg.addColorStop(1, "rgba(120,20,6,0)");
              ctx.fillStyle = fg;
              ctx.beginPath();
              ctx.arc(sx, sy - domeR * 0.22, domeR, 0, TAU);
              ctx.fill();
            }
            ctx.globalCompositeOperation = "source-over";
            const sA = clamp(1 - p, 0, 1) * 0.58 * fadeAll;
            const sr = rx * (0.45 + p * 0.7);
            ctx.strokeStyle = `rgba(48,40,35,${sA})`;
            ctx.lineWidth = Math.max(2, (22 * (1 - p * 0.4)) * unitScale);
            ctx.beginPath();
            ctx.ellipse(sx, sy - p * 120 * unitScale, sr, sr * 0.36, 0, 0, TAU);
            ctx.stroke();
            ctx.restore();
          },
        });
      }
    } else if (st.power === "empPulse") {
      if (sinceImpact >= 0) {
        this.fireOnce(st, sinceImpact, cam, fx, sfx, {
          shake: 12,
          flash: { color: "120,210,255", alpha: 0.46, ttl: 400 },
        });
      }
      if (toImpact > 0 && this.onScreen(cam, sx, sy, 90)) {
        const k = 1 - clamp(toImpact / delaySec, 0, 1);
        items.push({
          depth: st.x + st.y + 40,
          raw: true,
          draw: (ctx) => {
            const orbY = sy - k * 85 * unitScale;
            const rad = (16 + 18 * k) * unitScale;
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            const og = ctx.createRadialGradient(sx, orbY, 0, sx, orbY, Math.max(1, rad));
            og.addColorStop(0, `rgba(255,255,255,${0.96 * fadeAll})`);
            og.addColorStop(0.5, `rgba(88,186,255,${0.78 * fadeAll})`);
            og.addColorStop(1, "rgba(40,110,255,0)");
            ctx.fillStyle = og;
            ctx.beginPath();
            ctx.arc(sx, orbY, rad, 0, TAU);
            ctx.fill();
            ctx.restore();
          },
        });
      } else if (sinceImpact >= 0 && sinceImpact < 1.35 && !reducedMotion && this.onScreen(cam, sx, sy, rx + 40)) {
        const p = clamp(sinceImpact / 1.35, 0, 1);
        items.push({
          depth: st.x + st.y + 24,
          raw: true,
          draw: (ctx) => {
            const r = rng(Math.floor(now / 80) + st.id);
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.strokeStyle = `rgba(205,240,255,${(1 - p) * 0.82 * fadeAll})`;
            ctx.lineWidth = Math.max(1, 1.7 * unitScale);
            for (let i = 0; i < 8; i++) {
              const a = (i / 8) * TAU + r() * 0.3;
              const pts = boltPath(sx, sy - 65 * unitScale * (1 - p), sx + Math.cos(a) * rx * p, sy + Math.sin(a) * ry * p, r, 3, 18 * unitScale);
              strokePolyline(ctx, pts);
            }
            ctx.restore();
          },
        });
      }
    } else if (st.power === "napalmRun") {
      if (sinceImpact >= 0) {
        this.fireOnce(st, sinceImpact, cam, fx, sfx, {
          shake: 14,
          x: (st.x + st.x2) * 0.5,
          y: (st.y + st.y2) * 0.5,
        });
      }
      const total = delaySec + 1.8;
      const elapsed = delaySec - toImpact;
      const k = clamp(elapsed / total, 0, 1);
      if (k > 0.08 && k < 0.98) {
        const [ax, ay] = cam.screen(st.x, st.y);
        const [bx, by] = cam.screen(st.x2, st.y2);
        const ang = Math.atan2(by - ay, bx - ax);
        const flyP = (k - 0.08) / 0.9;
        const edgeFade = clamp(Math.min(flyP / 0.12, (1 - flyP) / 0.12), 0, 1) * fadeAll;
        const distScreen = Math.hypot(bx - ax, by - ay) || 1;
        const ux = (bx - ax) / distScreen;
        const uy = (by - ay) / distScreen;
        const nx = -uy;
        const ny = ux;
        const lead = -260 * unitScale + flyP * (distScreen + 540 * unitScale);

        for (const [sideOff, backOff] of [[-18, 0], [18, -28]]) {
          const jx = ax + ux * (lead + backOff * unitScale) + nx * sideOff * unitScale;
          const jyGround = ay + uy * (lead + backOff * unitScale) + ny * sideOff * unitScale;
          if (!this.onScreen(cam, jx, jyGround, 140)) continue;
          const [wx, wy] = cam.world(jx, jyGround);
          items.push({
            depth: wx + wy + 92,
            raw: true,
            draw: (ctx) => {
              const jy = jyGround - 92 * unitScale;
              ctx.save();
              ctx.globalAlpha = edgeFade;
              ctx.fillStyle = "rgba(0,0,0,0.24)";
              ctx.beginPath();
              ctx.ellipse(jx, jyGround, 18 * unitScale, 8 * unitScale, ang, 0, TAU);
              ctx.fill();

              ctx.translate(jx, jy);
              ctx.rotate(ang);
              ctx.globalCompositeOperation = "lighter";
              ctx.fillStyle = "rgba(255,155,45,0.9)";
              ctx.beginPath();
              ctx.ellipse(-18 * unitScale, 0, 12 * unitScale, 3.5 * unitScale, 0, 0, TAU);
              ctx.fill();
              ctx.globalCompositeOperation = "source-over";
              ctx.fillStyle = "#323a42";
              ctx.beginPath();
              ctx.moveTo(20 * unitScale, 0);
              ctx.lineTo(-10 * unitScale, -18 * unitScale);
              ctx.lineTo(-15 * unitScale, -16 * unitScale);
              ctx.lineTo(-8 * unitScale, -4 * unitScale);
              ctx.lineTo(-17 * unitScale, -6 * unitScale);
              ctx.lineTo(-17 * unitScale, 6 * unitScale);
              ctx.lineTo(-8 * unitScale, 4 * unitScale);
              ctx.lineTo(-15 * unitScale, 16 * unitScale);
              ctx.lineTo(-10 * unitScale, 18 * unitScale);
              ctx.closePath();
              ctx.fill();
              ctx.restore();
            },
          });
        }
      }
    } else if (st.power === "artilleryFirestorm") {
      for (let i = 0; i < (st.subImpacts?.length ?? 0); i++) {
        const sub = st.subImpacts[i];
        const tToHit = (sub.impactTick - tick) / rate;
        if (tToHit <= 0) {
          this.fireSubOnce(st, i, -tToHit, cam, fx, sfx, { shake: 7, blast: 1.05, sound: "shell", x: sub.x, y: sub.y });
        }
        const [bx, by] = cam.screen(sub.x, sub.y);
        if (!this.onScreen(cam, bx, by, 90)) continue;
        if (tToHit > 0 && tToHit < 0.85) {
          const drop = 1 - tToHit / 0.85;
          items.push({
            depth: sub.x + sub.y + 84,
            raw: true,
            draw: (ctx) => {
              const px = bx - (1 - drop) * 55 * unitScale;
              const py = by - (1 - drop * drop) * 230 * unitScale;
              ctx.save();
              ctx.strokeStyle = `rgba(255,220,130,${0.82 * clamp(drop / 0.15, 0, 1) * fadeAll})`;
              ctx.lineWidth = Math.max(1.2, 2.2 * unitScale);
              ctx.beginPath();
              ctx.moveTo(px - 12 * unitScale, py - 46 * unitScale);
              ctx.lineTo(px, py);
              ctx.stroke();
              ctx.restore();
            },
          });
        } else if (tToHit <= 0 && tToHit > -1.05) {
          const age = -tToHit / 1.05;
          items.push({
            depth: sub.x + sub.y + 16,
            raw: true,
            draw: (ctx) => {
              const gh = 46 * Math.sin(Math.min(1, age * 1.4) * Math.PI * 0.5) * unitScale;
              ctx.save();
              ctx.fillStyle = `rgba(118,98,74,${(1 - age) * 0.7 * fadeAll})`;
              ctx.beginPath();
              ctx.ellipse(bx, by - gh * 0.45, (10 + age * 16) * unitScale, gh * 0.65, 0, 0, TAU);
              ctx.fill();
              ctx.restore();
            },
          });
        }
      }
    } else if (st.power === "scudSalvo") {
      for (let i = 0; i < (st.subImpacts?.length ?? 0); i++) {
        const sub = st.subImpacts[i];
        const tToHit = (sub.impactTick - tick) / rate;
        if (tToHit <= 0) {
          this.fireSubOnce(st, i, -tToHit, cam, fx, sfx, { shake: 16, blast: 1.85, sound: "impact", x: sub.x, y: sub.y });
        }
        if (tToHit <= 0 && tToHit > -1.85) {
          const [bx, by] = cam.screen(sub.x, sub.y);
          if (!this.onScreen(cam, bx, by, 100)) continue;
          const age = -tToHit / 1.85;
          items.push({
            depth: sub.x + sub.y + 18,
            raw: true,
            draw: (ctx) => {
              const fr = (50 + age * 28) * unitScale;
              ctx.save();
              ctx.globalCompositeOperation = "lighter";
              const fg = ctx.createRadialGradient(bx, by - 14 * unitScale, 0, bx, by - 14 * unitScale, Math.max(1, fr));
              fg.addColorStop(0, `rgba(255,245,200,${(1 - age) * 0.9 * fadeAll})`);
              fg.addColorStop(0.5, `rgba(255,105,30,${(1 - age) * 0.7 * fadeAll})`);
              fg.addColorStop(1, "rgba(180,30,10,0)");
              ctx.fillStyle = fg;
              ctx.beginPath();
              ctx.arc(bx, by - 14 * unitScale, fr, 0, TAU);
              ctx.fill();
              ctx.restore();
            },
          });
        }
      }
    } else if (st.power === "tunnelAmbush") {
      if (toImpact > 0 && !this.suppressBursts && Math.random() < 0.22) {
        const k = 1 - clamp(toImpact / delaySec, 0, 1);
        fx?.shake?.(st.x, st.y, 2.5 + 4.5 * k, now);
      }
      if (sinceImpact >= 0) {
        this.fireOnce(st, sinceImpact, cam, fx, sfx, { shake: 20, blast: 1.7 });
      }
      if (sinceImpact >= 0 && sinceImpact < 2.4 && this.onScreen(cam, sx, sy, rx + 80)) {
        items.push({
          depth: st.x + st.y + 16,
          raw: true,
          draw: (ctx) => {
            const p = clamp(sinceImpact / 2.2, 0, 1);
            const r = rng(st.seed + 19);
            const gh = 110 * unitScale * Math.sin(Math.min(1, p * 1.35) * Math.PI * 0.5);
            ctx.save();
            const gg = ctx.createRadialGradient(sx, sy - gh * 0.45, 0, sx, sy - gh * 0.45, Math.max(1, rx * (0.45 + p * 0.4)));
            gg.addColorStop(0, `rgba(138,112,78,${(1 - p) * 0.85 * fadeAll})`);
            gg.addColorStop(1, "rgba(110,92,66,0)");
            ctx.fillStyle = gg;
            ctx.beginPath();
            ctx.ellipse(sx, sy - gh * 0.4, rx * 0.5, gh * 0.7, 0, 0, TAU);
            ctx.fill();
            for (let i = 0; i < 18; i++) {
              const a = r() * TAU;
              const spd = (0.35 + r() * 0.85) * rx;
              const vh = (85 + r() * 110) * unitScale;
              const bx = sx + Math.cos(a) * spd * p;
              const by = sy + Math.sin(a) * spd * 0.5 * p - Math.max(0, vh * p - 140 * unitScale * p * p);
              ctx.fillStyle = i % 2 ? `rgba(88,72,52,${(1 - p) * fadeAll})` : `rgba(48,38,28,${(1 - p) * fadeAll})`;
              ctx.beginPath();
              ctx.arc(bx, by, Math.max(1.4, (2.2 + r() * 3) * unitScale), 0, TAU);
              ctx.fill();
            }
            ctx.restore();
          },
        });
      }
    } else if (st.power === "radioSpoof") {
      if (sinceImpact >= 0) {
        this.fireOnce(st, sinceImpact, cam, fx, sfx, {});
      }
    } else if (st.power === "cruiseMissiles") {
      for (let i = 0; i < (st.subImpacts?.length ?? 0); i++) {
        const sub = st.subImpacts[i];
        const span = Math.max(1, sub.impactTick - sub.launchTick);
        const k = (tick - sub.launchTick) / span;
        if (k >= 0 && k < 1) {
          const oxW = sub.startX ?? st.x;
          const oyW = sub.startY ?? st.y;
          const mxW = oxW + (sub.x - oxW) * k;
          const myW = oyW + (sub.y - oyW) * k;
          const [ox, oy] = cam.screen(oxW, oyW);
          const [tx, ty] = cam.screen(sub.x, sub.y);
          const [mx, my] = cam.screen(mxW, myW);
          if (!this.onScreen(cam, mx, my, 120)) continue;
          const climb = k < 0.12 ? k / 0.12 : 1;
          const dive = k > 0.85 ? (1 - k) / 0.15 : 1;
          const alt = climb * dive * 44 * unitScale;
          const ang = Math.atan2(ty - oy, tx - ox);
          const tailK = Math.max(0, k - 0.32);
          const tailClimb = tailK < 0.12 ? tailK / 0.12 : 1;
          const tailDive = tailK > 0.85 ? (1 - tailK) / 0.15 : 1;
          const tailX = ox + (tx - ox) * tailK;
          const tailY = oy + (ty - oy) * tailK - tailClimb * tailDive * 44 * unitScale;

          items.push({
            depth: mxW + myW + 86,
            raw: true,
            draw: (ctx) => {
              ctx.save();
              ctx.globalAlpha = fadeAll;
              const cg = ctx.createLinearGradient(tailX, tailY, mx, my - alt);
              cg.addColorStop(0, "rgba(235,240,245,0)");
              cg.addColorStop(1, "rgba(245,248,252,0.82)");
              ctx.strokeStyle = cg;
              ctx.lineWidth = Math.max(1.4, 3.2 * unitScale);
              ctx.beginPath();
              ctx.moveTo(tailX, tailY);
              ctx.lineTo(mx, my - alt);
              ctx.stroke();

              ctx.fillStyle = "rgba(0,0,0,0.28)";
              ctx.beginPath();
              ctx.ellipse(mx, my, 10 * unitScale, 4 * unitScale, ang, 0, TAU);
              ctx.fill();

              ctx.translate(mx, my - alt);
              ctx.rotate(ang);
              ctx.globalCompositeOperation = "lighter";
              ctx.fillStyle = "rgba(255,155,40,0.95)";
              ctx.beginPath();
              ctx.ellipse(-12 * unitScale, 0, 8 * unitScale, 2.8 * unitScale, 0, 0, TAU);
              ctx.fill();
              ctx.globalCompositeOperation = "source-over";
              ctx.fillStyle = "#e4e8ec";
              ctx.fillRect(-10 * unitScale, -2 * unitScale, 20 * unitScale, 4 * unitScale);
              ctx.fillStyle = "#c83848";
              ctx.beginPath();
              ctx.moveTo(10 * unitScale, -2 * unitScale);
              ctx.lineTo(15 * unitScale, 0);
              ctx.lineTo(10 * unitScale, 2 * unitScale);
              ctx.fill();
              ctx.fillStyle = "#7a8692";
              ctx.fillRect(-2 * unitScale, -8 * unitScale, 4 * unitScale, 16 * unitScale);
              ctx.restore();
            },
          });
        } else if (k >= 1) {
          const age = (tick - sub.impactTick) / rate;
          this.fireSubOnce(st, i, age, cam, fx, sfx, {
            shake: sub.intercepted ? 6 : 18,
            blast: sub.intercepted ? 0.9 : 1.9,
            sound: sub.intercepted ? "intercept" : "impact",
            x: sub.x,
            y: sub.y,
          });
          if (sub.intercepted && age >= 0 && age < 1.2) {
            const [tx, ty] = cam.screen(sub.x, sub.y);
            if (!this.onScreen(cam, tx, ty, 70)) continue;
            const p = clamp(age / 1.2, 0, 1);
            items.push({
              depth: sub.x + sub.y + 88,
              raw: true,
              draw: (ctx) => {
                ctx.save();
                ctx.fillStyle = `rgba(225,228,232,${(1 - p) * 0.78 * fadeAll})`;
                ctx.beginPath();
                ctx.arc(tx, ty - 42 * unitScale, (16 + p * 26) * unitScale, 0, TAU);
                ctx.fill();
                ctx.restore();
              },
            });
          }
        }
      }
    }
  }

  // ---- Layer 3: High-Altitude Sky & Space Elements (drawn AFTER ground fog, BEFORE HUD labels) ----

  drawSky(ctx, cam, state, rules, now, unitScale, reducedMotion = false) {
    const strikes = state?.superStrikes;
    if (!strikes?.length || this.overFade <= 0.01) return;
    const rate = rules?.tickRate || 10;
    const tick = this.tickOf(state);
    const fadeAll = this.overFade;

    for (const st of strikes) {
      const sp = rules?.superPowers?.find((p) => p.id === st.power);
      if (!sp) continue;
      const elapsed = Math.max(0, (tick - st.startTick) / rate);
      const toImpact = (st.impactTick - tick) / rate;
      const sinceImpact = (tick - st.impactTick) / rate;
      const delaySec = Math.max(0.1, (st.impactTick - st.startTick) / rate);
      const durSec = Math.max(0.1, (st.endTick - st.impactTick) / rate);

      if (st.power === "rodOfGod") this.skyRodOfGod(ctx, cam, st, toImpact, sinceImpact, delaySec, unitScale, fadeAll);
      else if (st.power === "tacticalNuke") this.skyNuke(ctx, cam, st, toImpact, sinceImpact, now, unitScale, fadeAll, reducedMotion);
      else if (st.power === "lightningStorm") this.skyLightning(ctx, cam, st, sp, tick, rate, elapsed, toImpact, sinceImpact, durSec, now, unitScale, fadeAll, reducedMotion);
      else if (st.power === "orbitalLaser") this.skyOrbitalLaser(ctx, cam, st, toImpact, sinceImpact, delaySec, durSec, now, unitScale, fadeAll, reducedMotion);
      else if (st.power === "thermobaricMoab") this.skyMoab(ctx, cam, st, toImpact, delaySec, unitScale, fadeAll);
      else if (st.power === "scudSalvo") this.skyScud(ctx, cam, st, tick, rate, unitScale, fadeAll);
    }
  }

  skyRodOfGod(ctx, cam, st, toImpact, sinceImpact, delaySec, unitScale, fadeAll) {
    const [sx, sy] = cam.screen(st.x, st.y);
    if (!this.onScreen(cam, sx, sy, 220)) return;
    ctx.save();
    if (toImpact > 0) {
      const k = 1 - clamp(toImpact / delaySec, 0, 1);
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `rgba(120,235,255,${(0.18 + 0.55 * k) * fadeAll})`;
      ctx.lineWidth = Math.max(1.2, (1.5 + 4 * k * k) * unitScale);
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, sy);
      ctx.stroke();

      if (toImpact < 0.45) {
        const drop = 1 - toImpact / 0.45;
        const rodY = sy - (1 - drop * drop) * (sy + 260 * unitScale);
        const rodH = 135 * unitScale;
        const rodW = 9.5 * unitScale;
        const trail = ctx.createLinearGradient(sx, rodY - rodH * 2.5, sx, rodY);
        trail.addColorStop(0, "rgba(120,220,255,0)");
        trail.addColorStop(0.55, `rgba(255,165,65,${0.7 * fadeAll})`);
        trail.addColorStop(1, `rgba(255,255,255,${0.98 * fadeAll})`);
        ctx.strokeStyle = trail;
        ctx.lineWidth = rodW * 2.2;
        ctx.beginPath();
        ctx.moveTo(sx, rodY - rodH * 2.6);
        ctx.lineTo(sx, rodY);
        ctx.stroke();

        for (let m = 0; m < 3; m++) {
          const my = rodY - m * 24 * unitScale;
          const mw = (26 + m * 14) * unitScale;
          ctx.strokeStyle = `rgba(210,246,255,${(0.75 - m * 0.2) * fadeAll})`;
          ctx.lineWidth = Math.max(1.2, 2 * unitScale);
          ctx.beginPath();
          ctx.moveTo(sx - mw, my - mw * 0.9);
          ctx.lineTo(sx, my);
          ctx.lineTo(sx + mw, my - mw * 0.9);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = fadeAll;
        ctx.fillStyle = "#2b333b";
        ctx.fillRect(sx - rodW * 0.45, rodY - rodH, rodW * 0.9, rodH);
        ctx.fillStyle = "#fff9e6";
        ctx.beginPath();
        ctx.arc(sx, rodY, rodW * 0.75, 0, TAU);
        ctx.fill();
      }
    } else if (sinceImpact >= 0 && sinceImpact < 0.85) {
      const kp = (1 - sinceImpact / 0.85) * fadeAll;
      ctx.globalCompositeOperation = "lighter";
      const colW = (46 * kp + 8) * unitScale;
      const cg = ctx.createLinearGradient(sx - colW, sy, sx + colW, sy);
      cg.addColorStop(0, "rgba(110,220,255,0)");
      cg.addColorStop(0.5, `rgba(255,255,255,${0.95 * kp})`);
      cg.addColorStop(1, "rgba(110,220,255,0)");
      ctx.fillStyle = cg;
      ctx.fillRect(sx - colW, 0, colW * 2, sy);
    }
    ctx.restore();
  }

  skyNuke(ctx, cam, st, toImpact, sinceImpact, now, unitScale, fadeAll, reducedMotion) {
    const [sx, sy] = cam.screen(st.x, st.y);
    if (!this.onScreen(cam, sx, sy, 280)) return;
    ctx.save();
    if (toImpact > 0 && toImpact < 1.6) {
      const drop = 1 - toImpact / 1.6;
      const inA = clamp(drop / 0.15, 0, 1) * fadeAll;
      const mx = sx - (1 - drop) * 210 * unitScale;
      const my = sy - (1 - drop * drop) * (sy + 260 * unitScale);
      ctx.strokeStyle = `rgba(255,220,160,${0.65 * inA})`;
      ctx.lineWidth = Math.max(1.8, 5 * unitScale);
      ctx.beginPath();
      ctx.moveTo(mx - 80 * unitScale, my - 170 * unitScale);
      ctx.lineTo(mx, my);
      ctx.stroke();
      ctx.globalAlpha = inA;
      ctx.fillStyle = "#2c3035";
      ctx.beginPath();
      ctx.arc(mx, my, 5 * unitScale, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "#fff2c0";
      ctx.beginPath();
      ctx.arc(mx - 3.5 * unitScale, my - 7 * unitScale, 6.5 * unitScale, 0, TAU);
      ctx.fill();
    } else if (sinceImpact >= 0 && sinceImpact < 7.5) {
      const fade = clamp(1 - (sinceImpact - 4.8) / 2.6, 0, 1) * fadeAll;
      if (fade <= 0.01) {
        ctx.restore();
        return;
      }
      const rise = Math.pow(clamp(sinceImpact / 3.8, 0, 1), 0.72);
      const stemH = rise * 210 * unitScale;
      const stemW = (24 + rise * 20) * unitScale;
      for (let i = 0; i < 8; i++) {
        const f = i / 7;
        const cy = sy - stemH * f;
        const cw = stemW * (1.2 - 0.35 * Math.sin(f * Math.PI));
        const sg = ctx.createRadialGradient(sx, cy, 0, sx, cy, Math.max(1, cw));
        const glow = clamp(1 - sinceImpact / 3.2, 0, 1);
        sg.addColorStop(0, `rgba(${Math.round(90 + 165 * glow)},${Math.round(70 + 100 * glow)},${Math.round(58 + 30 * glow)},${0.82 * fade})`);
        sg.addColorStop(0.65, `rgba(54,46,42,${0.7 * fade})`);
        sg.addColorStop(1, "rgba(44,38,34,0)");
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.ellipse(sx + (reducedMotion ? 0 : Math.sin(now / 260 + i) * 3 * unitScale), cy, cw, cw * 0.65, 0, 0, TAU);
        ctx.fill();
      }
      if (sinceImpact > 0.35 && sinceImpact < 4.5) {
        const wp = clamp((sinceImpact - 0.35) / 3.6, 0, 1);
        const wa = Math.sin(wp * Math.PI) * 0.72 * fadeAll;
        const wr = (55 + wp * 95) * unitScale;
        ctx.strokeStyle = `rgba(248,250,255,${wa})`;
        ctx.lineWidth = Math.max(1.5, (12 * (1 - wp * 0.5)) * unitScale);
        ctx.beginPath();
        ctx.ellipse(sx, sy - stemH * 0.56, wr, wr * 0.32, 0, 0, TAU);
        ctx.stroke();
      }
      const capY = sy - stemH - 12 * unitScale;
      const capR = (45 + rise * 92) * unitScale;
      const fireHeat = clamp(1 - sinceImpact / 4.2, 0, 1);
      const r = rng(st.seed + 5);
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * TAU + (reducedMotion ? 0 : now * 0.0002);
        const cx = sx + Math.cos(ang) * capR * 0.52;
        const cy = capY - capR * 0.14 + Math.sin(ang) * capR * 0.22;
        const cr = capR * (0.42 + r() * 0.18);
        const cg = ctx.createRadialGradient(cx, cy - cr * 0.2, 0, cx, cy, Math.max(1, cr));
        cg.addColorStop(0, `rgba(${Math.round(78 + 150 * fireHeat)},${Math.round(68 + 80 * fireHeat)},${Math.round(62 + 20 * fireHeat)},${0.85 * fade})`);
        cg.addColorStop(0.65, `rgba(48,43,40,${0.78 * fade})`);
        cg.addColorStop(1, "rgba(38,34,32,0)");
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(cx, cy, cr, 0, TAU);
        ctx.fill();
      }
      if (fireHeat > 0.02) {
        ctx.globalCompositeOperation = "lighter";
        const fg = ctx.createRadialGradient(sx, capY + capR * 0.1, 0, sx, capY, Math.max(1, capR * 0.85));
        fg.addColorStop(0, `rgba(255,252,220,${0.95 * fireHeat * fadeAll})`);
        fg.addColorStop(0.45, `rgba(255,148,38,${0.8 * fireHeat * fadeAll})`);
        fg.addColorStop(1, "rgba(220,52,12,0)");
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.ellipse(sx, capY + capR * 0.08, capR * 0.85, capR * 0.55, 0, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  skyLightning(ctx, cam, st, sp, tick, rate, elapsed, toImpact, sinceImpact, durSec, now, unitScale, fadeAll, reducedMotion) {
    const [sx, sy] = cam.screen(st.x, st.y);
    const { rx, ry } = groundEllipse(sp.radius, cam.zoom);
    if (!this.onScreen(cam, sx, sy, rx + 180)) return;
    const cloudFade = (toImpact > 0 ? clamp(elapsed / 1.1, 0, 1) : clamp(1 - (sinceImpact - durSec) / 2.2, 0, 1)) * fadeAll;
    if (cloudFade <= 0.01) return;

    ctx.save();
    const cloudY = sy - 175 * unitScale;
    const r = rng(st.seed + 33);
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * TAU + (reducedMotion ? 0 : now * 0.00025);
      const d = 0.15 + r() * 0.65;
      const cx = sx + Math.cos(a) * rx * d;
      const cy = cloudY + Math.sin(a) * ry * d * 0.65;
      const cr = rx * (0.34 + r() * 0.18);
      const sheet = reducedMotion ? 0 : Math.max(0, Math.sin(now / 160 + i * 4.3) - 0.86) * 4;
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, cr));
      cg.addColorStop(0, sheet > 0.1 ? `rgba(165,215,255,${0.52 * cloudFade})` : `rgba(38,48,62,${0.62 * cloudFade})`);
      cg.addColorStop(0.65, `rgba(24,32,44,${0.48 * cloudFade})`);
      cg.addColorStop(1, "rgba(20,26,38,0)");
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.ellipse(cx, cy, cr, cr * 0.55, 0, 0, TAU);
      ctx.fill();
    }

    for (let i = 0; i < (st.subImpacts?.length ?? 0); i++) {
      const sub = st.subImpacts[i];
      const age = (tick - sub.impactTick) / rate;
      if (age < 0 || age > 0.52) continue;
      const [bx, by] = cam.screen(sub.x, sub.y);
      const alpha = clamp(1 - age / 0.52, 0, 1) * fadeAll;
      const br = rng(st.seed + i * 7919);
      const mainPts = boltPath(bx + (br() - 0.5) * 32 * unitScale, cloudY, bx, by, br, 5, 38 * unitScale);

      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `rgba(95,165,255,${0.7 * alpha})`;
      ctx.lineWidth = Math.max(2, 8.5 * unitScale);
      strokePolyline(ctx, mainPts);
      ctx.strokeStyle = `rgba(245,252,255,${alpha})`;
      ctx.lineWidth = Math.max(1.2, 2.5 * unitScale);
      strokePolyline(ctx, mainPts);

      for (let b = 0; b < 3; b++) {
        const idx = 4 + b * 7;
        if (idx >= mainPts.length) continue;
        const [px, py] = mainPts[idx];
        const branch = boltPath(px, py, px + (br() - 0.5) * 68 * unitScale, py + (38 + br() * 40) * unitScale, br, 3, 18 * unitScale);
        ctx.strokeStyle = `rgba(130,200,255,${0.65 * alpha})`;
        ctx.lineWidth = Math.max(1, 1.5 * unitScale);
        strokePolyline(ctx, branch);
      }
      const fg = ctx.createRadialGradient(bx, by, 0, bx, by, Math.max(1, 32 * unitScale));
      fg.addColorStop(0, `rgba(255,255,255,${alpha})`);
      fg.addColorStop(0.5, `rgba(110,195,255,${0.75 * alpha})`);
      fg.addColorStop(1, "rgba(80,140,255,0)");
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(bx, by, 32 * unitScale, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  skyOrbitalLaser(ctx, cam, st, toImpact, sinceImpact, delaySec, durSec, now, unitScale, fadeAll, reducedMotion) {
    const [ax, ay] = cam.screen(st.x, st.y);
    const [bx, by] = cam.screen(st.x2, st.y2);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    if (toImpact > 0) {
      const k = 1 - clamp(toImpact / delaySec, 0, 1);
      ctx.strokeStyle = `rgba(120,225,255,${(0.35 + 0.5 * k) * fadeAll})`;
      ctx.lineWidth = Math.max(1.1, (1.5 + 3 * k) * unitScale);
      ctx.beginPath();
      ctx.moveTo(ax, 0);
      ctx.lineTo(ax, ay);
      ctx.stroke();
    } else if (sinceImpact >= 0 && sinceImpact <= durSec + 0.4) {
      const k = clamp(sinceImpact / durSec, 0, 1);
      const fade = (sinceImpact > durSec ? clamp(1 - (sinceImpact - durSec) / 0.4, 0, 1) : 1) * fadeAll;
      const hx = ax + (bx - ax) * k;
      const hy = ay + (by - ay) * k;
      if (!this.onScreen(cam, hx, hy, 120)) {
        ctx.restore();
        return;
      }
      const wobble = reducedMotion ? 0 : Math.sin(now / 55) * 3;
      const beamW = Math.max(2, (24 + wobble) * unitScale * fade);
      const bg = ctx.createLinearGradient(hx - beamW, hy, hx + beamW, hy);
      bg.addColorStop(0, "rgba(40,150,255,0)");
      bg.addColorStop(0.28, `rgba(77,195,255,${0.72 * fade})`);
      bg.addColorStop(0.5, `rgba(255,255,255,${0.98 * fade})`);
      bg.addColorStop(0.72, `rgba(77,195,255,${0.72 * fade})`);
      bg.addColorStop(1, "rgba(40,150,255,0)");
      ctx.fillStyle = bg;
      ctx.fillRect(hx - beamW, 0, beamW * 2, hy);

      if (!reducedMotion) {
        ctx.strokeStyle = `rgba(180,242,255,${0.78 * fade})`;
        ctx.lineWidth = Math.max(1.1, 2 * unitScale);
        ctx.beginPath();
        const step = Math.max(10, Math.round(14 * unitScale));
        for (let y = 0; y <= hy; y += step) {
          const wave = Math.sin(y * 0.045 - now * 0.022) * beamW * 0.52;
          if (y === 0) ctx.moveTo(hx + wave, y);
          else ctx.lineTo(hx + wave, y);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  skyMoab(ctx, cam, st, toImpact, delaySec, unitScale, fadeAll) {
    if (toImpact <= 0) return;
    const [sx, sy] = cam.screen(st.x, st.y);
    if (!this.onScreen(cam, sx, sy, 420)) return;
    const k = 1 - clamp(toImpact / delaySec, 0, 1);
    ctx.save();
    if (k < 0.85) {
      const planeP = k / 0.85;
      const edgeFade = clamp(Math.min(planeP / 0.14, (1 - planeP) / 0.14), 0, 1) * fadeAll;
      const px = sx + (planeP - 0.35) * 560 * unitScale;
      const groundY = sy + (planeP - 0.35) * 75 * unitScale;
      const py = groundY - 190 * unitScale;

      ctx.globalAlpha = edgeFade;
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.beginPath();
      ctx.ellipse(px, groundY, 34 * unitScale, 12 * unitScale, 0.13, 0, TAU);
      ctx.fill();

      ctx.strokeStyle = "rgba(235,240,245,0.35)";
      ctx.lineWidth = Math.max(1, 2.4 * unitScale);
      for (const wy of [-26, 26]) {
        ctx.beginPath();
        ctx.moveTo(px - 120 * unitScale, py + wy * unitScale - 15 * unitScale);
        ctx.lineTo(px - 6 * unitScale, py + wy * unitScale);
        ctx.stroke();
      }
      ctx.fillStyle = "#3a4248";
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(0.13);
      ctx.beginPath();
      ctx.ellipse(0, 0, 32 * unitScale, 6 * unitScale, 0, 0, TAU);
      ctx.fill();
      ctx.fillRect(-6 * unitScale, -34 * unitScale, 12 * unitScale, 68 * unitScale);
      ctx.fillRect(-30 * unitScale, -13 * unitScale, 6 * unitScale, 26 * unitScale);
      ctx.restore();
    }

    if (k >= 0.32 && k < 0.88) {
      const dp = (k - 0.32) / 0.56;
      const chuteFade = clamp(Math.min(dp / 0.12, (1 - dp) / 0.12), 0, 1) * fadeAll;
      const swing = Math.sin(dp * 9) * 5 * unitScale;
      const by = sy - (1 - dp) * 180 * unitScale - 14 * unitScale;
      ctx.globalAlpha = chuteFade;
      ctx.strokeStyle = "rgba(230,235,240,0.75)";
      ctx.lineWidth = Math.max(1, unitScale);
      ctx.beginPath();
      ctx.moveTo(sx + swing, by);
      ctx.lineTo(sx + swing - 11 * unitScale, by - 18 * unitScale);
      ctx.moveTo(sx + swing, by);
      ctx.lineTo(sx + swing + 11 * unitScale, by - 18 * unitScale);
      ctx.stroke();
      ctx.fillStyle = "#eef2f4";
      ctx.beginPath();
      ctx.arc(sx + swing, by - 18 * unitScale, 12 * unitScale, Math.PI, TAU);
      ctx.fill();
      ctx.fillStyle = "#48523c";
      ctx.fillRect(sx + swing - 3.5 * unitScale, by - 2 * unitScale, 7 * unitScale, 14 * unitScale);
    }
    ctx.restore();
  }

  skyScud(ctx, cam, st, tick, rate, unitScale, fadeAll) {
    ctx.save();
    for (let i = 0; i < (st.subImpacts?.length ?? 0); i++) {
      const sub = st.subImpacts[i];
      const tToHit = (sub.impactTick - tick) / rate;
      if (tToHit <= 0 || tToHit >= 2.2) continue;
      const [bx, by] = cam.screen(sub.x, sub.y);
      if (!this.onScreen(cam, bx, by, 320)) continue;
      const drop = 1 - tToHit / 2.2;
      const inA = clamp(drop / 0.12, 0, 1) * fadeAll;
      const dir = st.side === 0 ? -1 : 1;
      const startX = bx + dir * 210 * unitScale;
      const startY = by - 360 * unitScale;
      const at = (t) => [startX + (bx - startX) * t, startY + (by - startY) * (t * t)];

      ctx.lineCap = "round";
      for (let s = 0; s < 10; s++) {
        const [x0, y0] = at(Math.max(0, drop - (s + 1) * 0.055));
        const [x1, y1] = at(Math.max(0, drop - s * 0.055));
        ctx.strokeStyle = `rgba(220,214,204,${(1 - s / 10) * 0.66 * inA})`;
        ctx.lineWidth = Math.max(1.2, (3 + s * 1.1) * unitScale);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
      const [mx, my] = at(drop);
      const [px, py] = at(Math.max(0, drop - 0.04));
      ctx.strokeStyle = `rgba(82,80,73,${inA})`;
      ctx.lineWidth = Math.max(1.6, 4.2 * unitScale);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(mx, my);
      ctx.stroke();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `rgba(255,175,55,${0.95 * inA})`;
      ctx.beginPath();
      ctx.arc(px, py, 6.2 * unitScale, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.restore();
  }

  // ---- Convenience wrappers (used by unit tests & standalone callers) ----

  drawHazards(ctx, cam, state, rules, now, unitScale, reducedMotion = false) {
    this.syncClock(state, rules, now);
    this.drawGround(ctx, cam, state, rules, now, unitScale, reducedMotion);
    for (const item of this.standing(cam, state, rules, now, unitScale, null, null, reducedMotion)) item.draw(ctx);
  }

  drawStrikes(ctx, cam, state, rules, now, unitScale, fx, sfx, reducedMotion = false) {
    this.syncClock(state, rules, now);
    this.drawGround(ctx, cam, state, rules, now, unitScale, reducedMotion);
    for (const item of this.standing(cam, state, rules, now, unitScale, fx, sfx, reducedMotion)) item.draw(ctx);
    this.drawSky(ctx, cam, state, rules, now, unitScale, reducedMotion);
  }

  drawStatusOverlays(ctx, cam, state, now, unitScale, reducedMotion = false) {
    if (!state) return;
    for (const item of this.standing(cam, { ...state, hazards: [], superStrikes: [] }, null, now, unitScale, null, null, reducedMotion)) item.draw(ctx);
  }

  // ---- Layer 5: Custom Animated Tactical Targeting Cursor (Mouse + Touch) ----

  drawCursor(ctx, cam, aiming, hover, now, lang, rules = null, reducedMotion = false) {
    if (!aiming) return;
    const sp = aiming.def;
    if (!sp) return;
    let wx;
    let wy;
    if (hover) {
      [wx, wy] = cam.world(hover.x, hover.y);
    } else if (aiming.spot) {
      wx = aiming.spot.x;
      wy = aiming.spot.y;
    } else {
      return;
    }
    const [sx, sy] = cam.screen(wx, wy);
    const valid = rules ? isValidSuperTarget(rules, sp, wx, wy) : true;
    const col = valid ? sp.color || "#7ce8ff" : "#ff5a52";
    const rot = reducedMotion ? 0 : (now / 1500) % TAU;
    const pulse = reducedMotion ? 0.9 : 0.72 + 0.28 * Math.sin(now / 180);

    ctx.save();
    if (sp.cursor === "line" || sp.cursor === "strip") {
      const hasStart = Boolean(aiming.start);
      const endWorld = aiming.end ?? { x: wx, y: wy };
      const [ax, ay] = hasStart ? cam.screen(aiming.start.x, aiming.start.y) : [sx, sy];
      let bx = sx;
      let by = sy;
      if (hasStart) {
        const dx = endWorld.x - aiming.start.x;
        const dy = endWorld.y - aiming.start.y;
        const d = Math.hypot(dx, dy) || 1;
        const span = sp.length || 260;
        [bx, by] = cam.screen(aiming.start.x + (dx / d) * span, aiming.start.y + (dy / d) * span);
      } else {
        [bx, by] = cam.screen(wx + (sp.length || 260) * 0.5, wy);
      }
      const wPx = Math.max(14, (sp.width || 60) * cam.zoom * 0.72);
      ctx.lineCap = "round";
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.2;
      ctx.lineWidth = wPx;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();

      ctx.globalAlpha = 0.92;
      ctx.lineWidth = 2.2;
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);

      const ang = Math.atan2(by - ay, bx - ax);
      for (let i = 1; i <= 4; i++) {
        const f = reducedMotion ? i / 5 : ((i / 5) + ((now / 900) % 0.2)) % 1;
        const cx = ax + (bx - ax) * f;
        const cy = ay + (by - ay) * f;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(-6, -7);
        ctx.lineTo(5, 0);
        ctx.lineTo(-6, 7);
        ctx.stroke();
        ctx.restore();
      }
      this.drawCrosshair(ctx, sx, sy, 22, col, pulse);
    } else if (sp.cursor === "multi3") {
      const locked = aiming.targets ?? [];
      for (let i = 0; i < locked.length; i++) {
        const [lx, ly] = cam.screen(locked[i].x, locked[i].y);
        const { rx, ry } = groundEllipse(sp.radius, cam.zoom);
        ctx.strokeStyle = sp.color || "#7ce8ff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(lx, ly, rx, ry, 0, 0, TAU);
        ctx.stroke();
        this.drawCrosshair(ctx, lx, ly, 16, sp.color || "#7ce8ff", 1);
        ctx.fillStyle = "#fff";
        ctx.font = "700 13px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(String(i + 1), lx, ly - 18);
      }
      if (locked.length < 3) {
        const { rx, ry } = groundEllipse(sp.radius, cam.zoom);
        ctx.fillStyle = `${col}22`;
        ctx.beginPath();
        ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU);
        ctx.stroke();
        this.drawCrosshair(ctx, sx, sy, 24, col, pulse);
        ctx.fillStyle = "#fff";
        ctx.font = "700 13px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${locked.length + 1}/3`, sx, sy - 26);
      }
    } else {
      const { rx, ry } = traceIsoCircle(ctx, cam, wx, wy, sp.radius);
      ctx.fillStyle = `${col}20`;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.4;
      if (sp.cursor === "windCircle" || sp.cursor === "scatterCircle") ctx.setLineDash([10, 6]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.lineWidth = 3;
      for (let i = 0; i < 4; i++) {
        const a = rot + (i * Math.PI) / 2;
        ctx.beginPath();
        ctx.ellipse(sx, sy, rx * 1.06, ry * 1.06, 0, a - 0.22, a + 0.22);
        ctx.stroke();
      }

      if (sp.coreRadius > 0) {
        const { rx: crx, ry: cry } = groundEllipse(sp.coreRadius, cam.zoom);
        ctx.strokeStyle = `rgba(255,255,255,${0.55 * pulse})`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.ellipse(sx, sy, crx, cry, 0, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (sp.cursor === "windCircle") {
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.4;
        const ax = sx + rx * 0.72;
        const ay = sy + ry * 0.25;
        ctx.beginPath();
        ctx.moveTo(sx + rx * 0.2, sy + ry * 0.08);
        ctx.lineTo(ax, ay);
        ctx.lineTo(ax - 9, ay - 6);
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - 9, ay + 6);
        ctx.stroke();
      }

      if (sp.cursor === "scatterCircle") {
        ctx.strokeStyle = `rgba(255,150,90,${0.48 * pulse})`;
        ctx.lineWidth = 1.3;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + rot * 0.4;
          ctx.beginPath();
          ctx.ellipse(sx + Math.cos(a) * rx * 0.55, sy + Math.sin(a) * ry * 0.55, rx * 0.22, ry * 0.22, 0, 0, TAU);
          ctx.stroke();
        }
      }

      this.drawCrosshair(ctx, sx, sy, Math.max(22, Math.min(48, rx * 0.34)), col, pulse);
    }

    const label = !valid && aiming.invalidText ? aiming.invalidText : sp.name?.[lang] ?? sp.id;
    ctx.font = '700 12px system-ui, "Segoe UI", "Noto Sans Hebrew", sans-serif';
    ctx.textAlign = "center";
    const tw = ctx.measureText(label).width + 18;
    const ly = sy - Math.max(36, groundEllipse(sp.radius, cam.zoom).ry + 18);
    ctx.fillStyle = "rgba(8,12,16,0.86)";
    ctx.beginPath();
    ctx.roundRect(sx - tw / 2, ly - 11, tw, 22, 4);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = valid ? "#f4f7f8" : "#ff9b96";
    ctx.fillText(label, sx, ly + 4);
    ctx.restore();
  }

  drawCrosshair(ctx, x, y, arm, color, pulse) {
    const gap = 7;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(x - arm, y);
    ctx.lineTo(x - gap, y);
    ctx.moveTo(x + gap, y);
    ctx.lineTo(x + arm, y);
    ctx.moveTo(x, y - arm * 0.72);
    ctx.lineTo(x, y - gap * 0.72);
    ctx.moveTo(x, y + gap * 0.72);
    ctx.lineTo(x, y + arm * 0.72);
    ctx.stroke();

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, gap * (0.9 + 0.2 * pulse), 0, TAU);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, TAU);
    ctx.fill();
  }

  // ---- Layer 6: Atmospheric Screen Flash Overlay ----

  drawScreenFlash(ctx, w, h, now, reducedMotion = false) {
    if (reducedMotion || this.overFade < 1 || !this.flashes.length) {
      if (this.overFade < 1) this.flashes.length = 0;
      return;
    }
    let keep = 0;
    for (const f of this.flashes) {
      const p = (now - f.t0) / f.ttl;
      if (p < 0 || p >= 1) continue;
      this.flashes[keep++] = f;
      const a = Math.pow(1 - p, 1.8) * f.alpha;
      ctx.fillStyle = `rgba(${f.color},${a})`;
      ctx.fillRect(0, 0, w, h);
    }
    this.flashes.length = keep;
  }
}
