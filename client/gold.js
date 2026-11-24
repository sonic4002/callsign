// Gold on the map: the gushers that throw it up, the fields it lies in, and the haulers
// that carry it home. Everything here is drawn in code, so it works with no pictures at
// all; a painted gusher base or a hauler sheet, when the sprite manifest has one under
// the same id the rules use, is drawn by art.js and this module adds the life on top.

import { drawProp } from "./art.js";
import { groundEllipse } from "./iso.js";

const TAU = Math.PI * 2;

// The states in which a hauler is driving.
const driving = new Set(["out", "returning", "fleeing"]);

// haulerGroups turns the snapshot's haulers into the unit groups the map draws: the
// side's own haulers, and for a spectator everybody's. An enemy hauler in sight arrives
// as a contact and is drawn from there.
export function haulerGroups(state) {
  return (state.haulers ?? [])
    .filter((h) => h.visible && (state.side < 0 || h.side === state.side))
    .map((h) => ({
      id: h.id,
      side: h.side,
      unit: h.unit,
      class: "hauler",
      callsign: h.callsign,
      own: true,
      hauler: h,
      teams: [{ x: h.x, y: h.y, members: 1, action: driving.has(h.state) ? "advance" : "idle" }],
    }));
}

// ghosts are enemy haulers the side remembers but cannot see now.
export const ghosts = (state) => (state.haulers ?? []).filter((h) => !h.visible && state.side >= 0 && h.side !== state.side);

// gusherAt is the gusher standing on a map point, if any: there it replaces the point's building.
export const gusherAt = (rules, p) => (rules.map.gushers ?? []).find((g) => g.x === p.x && g.y === p.y) ?? null;

// gusherOfPoint is the gusher named after a map point on the radio ("the Kilo field").
export const gusherOfPoint = (rules, id) => (rules.map.gushers ?? []).find((g) => g.point === id) ?? null;

// fieldShare is how full a field is, 0…1, as this side last saw it.
export const fieldShare = (state, id) => (state.fields ?? []).find((f) => f.gusher === id)?.gold ?? 0;

// reach is how far the gold lies from the gusher for a field that full. Even an empty
// field keeps a small patch, so the place can still be found.
export const reach = (gusher, share) => gusher.fieldRadius * (0.3 + 0.7 * Math.sqrt(Math.max(0, Math.min(1, share))));

// pickGusher is the gusher under a map position, or null.
export function pickGusher(rules, wx, wy) {
  return (rules.map.gushers ?? []).find((g) => Math.hypot(g.x - wx, g.y - wy) <= g.fieldRadius * 0.7) ?? null;
}

// Each gusher scatters the same flecks every time: positions on a unit disc with a phase.
const scattered = new Map();
export function flecks(id, count = 72) {
  if (scattered.has(id)) return scattered.get(id);
  let seed = 2166136261;
  for (const ch of String(id)) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const list = [];
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(rand());
    const a = rand() * TAU;
    list.push([r * Math.cos(a), r * Math.sin(a), rand() * TAU, 0.6 + rand() * 0.8]);
  }
  list.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1])); // inner flecks first: a shrinking field loses its rim
  scattered.set(id, list);
  return list;
}

// drawField paints the gold lying on the ground around a gusher. `S` maps a map position
// to the screen and `zoom` is screen pixels per map unit.
export function drawField(ctx, S, zoom, gusher, share, time) {
  const r = reach(gusher, share);
  const [sx, sy] = S(gusher.x, gusher.y);
  const [rx, ry] = groundEllipse(r * zoom);
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, rx);
  glow.addColorStop(0, `rgba(236,190,70,${0.42 + 0.22 * share})`);
  glow.addColorStop(0.75, `rgba(206,154,48,${0.22 + 0.12 * share})`);
  glow.addColorStop(1, "rgba(201,150,48,0)");
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(1, ry / rx);
  ctx.translate(-sx, -sy);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(sx, sy, rx, 0, TAU);
  ctx.fill();
  ctx.restore();
  // The painted patch for how full the field is, lying under the nuggets.
  const patch = share > 0.66 ? "gold_field_3" : share > 0.33 ? "gold_field_2" : share > 0.02 ? "gold_field_1" : "";
  if (patch) {
    ctx.save();
    ctx.translate(sx, sy);
    drawProp(ctx, patch, rx * 1.5);
    ctx.restore();
  }
  // Nuggets: more of them, and farther out, the fuller the field is.
  const all = flecks(gusher.id);
  const shown = Math.round(all.length * (0.25 + 0.75 * share));
  const size = Math.max(1.5, 3.4 * zoom);
  for (let i = 0; i < shown; i++) {
    const [dx, dy, phase, big] = all[i];
    const [fx, fy] = S(gusher.x + dx * r * 0.92, gusher.y + dy * r * 0.92);
    const glint = 0.5 + 0.5 * Math.sin(time * 2.4 + phase);
    ctx.fillStyle = glint > 0.86 ? "#fff6c9" : `rgba(${214 + Math.round(30 * glint)},${166 + Math.round(40 * glint)},58,0.95)`;
    ctx.beginPath();
    ctx.ellipse(fx, fy, size * big, size * big * 0.55, 0, 0, TAU);
    ctx.fill();
  }
}

// drawVent is the code-drawn gusher itself: a low ring of broken rock around the vent.
export function drawVent(ctx) {
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(2, 3, 22, 10, 0, 0, TAU);
  ctx.fill();
  for (const [x, y, w, h, c] of [[-13, 0, 9, 7, "#5b5347"], [12, 1, 10, 8, "#665d4f"], [-3, 5, 11, 6, "#4d463c"], [0, -5, 12, 7, "#70675a"], [-9, -4, 7, 6, "#5f574b"], [9, -4, 7, 5, "#57503f"]]) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(x, y - h / 2, w, h, 0, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = "#231d12";
  ctx.beginPath();
  ctx.ellipse(0, -3, 6.5, 3.4, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#c79a35";
  ctx.beginPath();
  ctx.ellipse(0, -3, 4, 2, 0, 0, TAU);
  ctx.fill();
}

// drawFountain is the gold thrown up out of the vent: drops that rise, spread and fall
// back, in a loop. It is drawn upright at the origin, in the scale of a building.
export function drawFountain(ctx, time, strength = 1, drops = 26) {
  const height = 46 * (0.75 + 0.25 * strength);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const core = ctx.createLinearGradient(0, -4, 0, -height);
  core.addColorStop(0, "rgba(255,214,110,0.55)");
  core.addColorStop(1, "rgba(255,214,110,0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.moveTo(-3.2, -3);
  ctx.quadraticCurveTo(-1.2, -height * 0.6, 0, -height);
  ctx.quadraticCurveTo(1.2, -height * 0.6, 3.2, -3);
  ctx.fill();
  ctx.restore();
  for (let i = 0; i < drops; i++) {
    // Each drop has its own place in the loop, its own side and its own reach.
    const life = (time * (0.55 + (i % 5) * 0.06) + i * 0.6180339) % 1;
    const side = ((i * 7919) % 13) / 6 - 1; // -1…1
    const far = 9 + ((i * 104729) % 17);
    const x = side * far * life;
    const y = -3 - height * 4 * life * (1 - life) * (0.7 + ((i * 31) % 10) / 33);
    const fade = life < 0.85 ? 1 : (1 - life) / 0.15;
    ctx.fillStyle = i % 4 === 0 ? `rgba(255,246,201,${fade})` : `rgba(240,188,66,${fade})`;
    ctx.beginPath();
    ctx.arc(x, y, i % 3 === 0 ? 1.7 : 1.2, 0, TAU);
    ctx.fill();
  }
}

// haulerShape is the code-drawn hauler, used when the sprite manifest has no sheet for
// it: a cab, an open bed, and the gold in the bed heaped as high as its load.
export function haulerShape(ctx, look, { tracked = false, load = 0, moving = false, time = 0 }) {
  const quad = (c, ...p) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    ctx.closePath();
    ctx.fill();
  };
  const bob = moving ? Math.sin(time * 18) * 0.5 : 0;
  ctx.save();
  ctx.translate(0, bob);
  if (tracked) {
    quad("#14181b", -24, -2, -7, 8, 25, -8, 25, -2, -7, 14, -24, 4);
  } else {
    for (const [x, y] of [[-14, 7], [-2, 3], [15, -5]]) {
      ctx.fillStyle = "#14181b";
      ctx.beginPath();
      ctx.ellipse(x, y, 4.4, 3.8, 0, 0, TAU);
      ctx.fill();
    }
  }
  // Bed: two sides and a floor, open at the top.
  quad(look.hullLow, -24, -6, -6, 3, 12, -6, -6, -15);
  quad(look.hullSide, -24, -14, -6, -5, -6, 3, -24, -6);
  quad(look.hullSide, -6, -5, 12, -14, 12, -6, -6, 3);
  if (load > 0.02) {
    const h = 3 + 9 * Math.min(1, load);
    quad("#b98a2c", -21, -13, -6, -6, 9, -13, -6, -20);
    quad("#e6b84a", -17, -13 - h * 0.5, -6, -8 - h, 6, -13 - h * 0.5, -6, -18 - h * 0.2);
    quad("#fff0b0", -8, -12 - h, -5, -10.5 - h, -3, -12 - h, -6, -13.5 - h);
  }
  // Cab at the front.
  quad(look.hullSide, 12, -20, 22, -15, 22, -6, 12, -11);
  quad(look.hull, 12, -20, 18, -24, 28, -19, 22, -15);
  quad(look.hullLow, 22, -15, 28, -19, 28, -10, 22, -6);
  quad(look.trim, 23, -14, 27, -17, 27, -13, 23, -10.5);
  ctx.restore();
}

// loadBar draws how full a hauler is, in screen pixels, centred on (sx, sy).
export function loadBar(ctx, sx, sy, share, width = 26) {
  const w = width;
  ctx.fillStyle = "rgba(8,12,14,0.75)";
  ctx.fillRect(sx - w / 2 - 1, sy - 1, w + 2, 5);
  ctx.fillStyle = "#e6b84a";
  ctx.fillRect(sx - w / 2, sy, w * Math.max(0, Math.min(1, share)), 3);
}

// unloaded reports the haulers of a side that finished unloading between two snapshots:
// they were unloading, and are now on their way out with an empty bed.
export function unloaded(before, after, side) {
  const was = new Map((before?.haulers ?? []).map((h) => [h.id, h]));
  return (after?.haulers ?? []).filter((h) => h.side === side && h.visible && was.get(h.id)?.state === "unloading" && h.state !== "unloading" && h.load === 0);
}

// haulerRows is what the sidebar lists: one row per own hauler, with the string key of
// its state and the map point of the field it works.
export function haulerRows(state, rules, side) {
  return (state.haulers ?? [])
    .filter((h) => h.side === side && h.visible)
    .map((h) => ({ id: h.id, callsign: h.callsign, state: `haul.${h.state}`, load: h.load, hp: h.hp, point: gusherPoint(rules, h.field), sentTo: gusherPoint(rules, h.assigned) }));
}

const gusherPoint = (rules, id) => (id ? (rules.map.gushers ?? []).find((g) => g.id === id)?.point ?? null : null);
