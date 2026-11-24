// The ground: what the map's terrain grid, bridges and landmarks are, and how they are
// drawn when no painted picture exists for them. Everything here reads the map data in
// the rules; nothing about any one map is written into the page.
//
// This file uses only the canvas it is handed, so the tests can load it without a page.

import { toIso } from "./iso.js";

const TAU = Math.PI * 2;

// ---- reading the map ----

// terrainAt is the terrain letter at a position; off the map counts as mountain.
export function terrainAt(map, x, y) {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return "M";
  return map.terrain[Math.floor(y / map.cell)][Math.floor(x / map.cell)];
}

// deckOf is the four corners of a bridge's deck, in map units.
export function deckOf(b) {
  const [ax, ay] = b.from;
  const [bx, by] = b.to;
  const l = Math.hypot(bx - ax, by - ay);
  const nx = (-(by - ay) / l) * (b.width / 2);
  const ny = ((bx - ax) / l) * (b.width / 2);
  return [[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]];
}

// onDeck says whether a position is on a bridge's deck.
export function onDeck(b, x, y) {
  const [ax, ay] = b.from;
  const [bx, by] = b.to;
  const t = ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2);
  return t >= 0 && t <= 1 && Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)) <= b.width / 2;
}

// isWater says whether a shell landing at a position hits water: water terrain with no
// standing bridge over it. `standing` is (bridge id) => boolean; all stand when omitted.
export function isWater(rules, x, y, standing = () => true) {
  const map = rules.map;
  if (!rules.terrainKinds?.[terrainAt(map, x, y)]?.water) return false;
  return !(map.bridges ?? []).some((b) => standing(b.id) && onDeck(b, x, y));
}

// placeAt is the landmark or bridge at a position of the map, for a click or a tap: the
// nearest landmark within `reach`, else a bridge whose deck is under it.
export function placeAt(map, x, y, reach = 30) {
  let best = null;
  let bd = reach;
  for (const l of map.landmarks ?? []) {
    const d = Math.hypot(l.x - x, l.y - y);
    if (d <= bd) [best, bd] = [l, d];
  }
  if (best) return { landmark: best };
  const bridge = (map.bridges ?? []).find((b) => onDeck(b, x, y));
  return bridge ? { bridge } : {};
}

// coverText is how much harder a fireteam is to hit, as a whole percentage: a cover
// factor of 0.65 is "35".
export const coverPercent = (factor) => (factor > 0 && factor < 1 ? Math.round((1 - factor) * 100) : 0);

// ---- colours ----

export const terrainColors = {
  L: { fill: "#5e6b43", radar: "#33412a" },
  W: { fill: "#1d5c78", radar: "#16455b" },
  I: { fill: "#cfe1e8", radar: "#b9cdd6" },
  M: { fill: "#57524a", radar: "#5d574c" },
};

// ---- the baked ground ----

// A cell's four corners on the iso plane, grown a little so neighbours leave no seam.
function cellPath(g, cell, c, r, grow = 0.6) {
  const x0 = c * cell - grow;
  const y0 = r * cell - grow;
  const x1 = (c + 1) * cell + grow;
  const y1 = (r + 1) * cell + grow;
  g.beginPath();
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(([x, y], i) => {
    const [ix, iy] = toIso(x, y);
    i ? g.lineTo(ix, iy) : g.moveTo(ix, iy);
  });
  g.closePath();
}

// paintGround draws the terrain onto a context already set to the iso plane: land under
// everything, then water, ice and rock cell by cell, a beach where land meets water, and
// peaks on the mountains. `fills` may give canvas patterns for land and water.
export function paintGround(g, rules, rand, fills = {}) {
  const map = rules.map;
  const cell = map.cell;
  const cols = Math.round(map.width / cell);
  const rows = Math.round(map.height / cell);
  const at = (c, r) => (c < 0 || r < 0 || c >= cols || r >= rows ? null : map.terrain[r][c]);
  const strip = (pts, fill) => {
    g.fillStyle = fill;
    g.beginPath();
    pts.forEach(([x, y], i) => {
      const [ix, iy] = toIso(x, y);
      i ? g.lineTo(ix, iy) : g.moveTo(ix, iy);
    });
    g.closePath();
    g.fill();
  };
  // Water, ice and rock over the land.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = at(c, r);
      if (k === "L") continue;
      g.fillStyle = k === "W" && fills.water ? fills.water : terrainColors[k].fill;
      cellPath(g, cell, c, r);
      g.fill();
      if (k === "I") {
        // Ice: a paler sheen and a crack or two.
        g.fillStyle = `rgba(255,255,255,${0.08 + rand() * 0.14})`;
        cellPath(g, cell, c, r, -4);
        g.fill();
        if (rand() < 0.5) {
          const [ax, ay] = toIso((c + rand()) * cell, (r + rand()) * cell);
          const [bx, by] = toIso((c + rand()) * cell, (r + rand()) * cell);
          g.strokeStyle = "rgba(96,130,150,0.55)";
          g.lineWidth = 0.8;
          g.beginPath();
          g.moveTo(ax, ay);
          g.lineTo(bx, by);
          g.stroke();
        }
      } else if (k === "M") {
        g.fillStyle = `rgba(${rand() < 0.5 ? "30,28,24" : "120,112,98"},${0.1 + rand() * 0.14})`;
        cellPath(g, cell, c, r, -2);
        g.fill();
      }
    }
  }
  // A beach on the land side of every shore, and surf on the water side.
  const sand = "rgba(196,180,128,0.85)";
  const surf = "rgba(226,243,246,0.45)";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (at(c, r) !== "L") continue;
      const x0 = c * cell;
      const y0 = r * cell;
      const x1 = x0 + cell;
      const y1 = y0 + cell;
      const d = 9;
      const w = 5;
      for (const [dc, dr, land, sea] of [
        [0, -1, [[x0, y0], [x1, y0], [x1, y0 + d], [x0, y0 + d]], [[x0, y0 - w], [x1, y0 - w], [x1, y0], [x0, y0]]],
        [0, 1, [[x0, y1 - d], [x1, y1 - d], [x1, y1], [x0, y1]], [[x0, y1], [x1, y1], [x1, y1 + w], [x0, y1 + w]]],
        [-1, 0, [[x0, y0], [x0 + d, y0], [x0 + d, y1], [x0, y1]], [[x0 - w, y0], [x0, y0], [x0, y1], [x0 - w, y1]]],
        [1, 0, [[x1 - d, y0], [x1, y0], [x1, y1], [x1 - d, y1]], [[x1, y0], [x1 + w, y0], [x1 + w, y1], [x1, y1]]],
      ]) {
        const k = at(c + dc, r + dr);
        if (k !== "W" && k !== "I") continue;
        strip(land, sand);
        if (k === "W") strip(sea, surf);
      }
    }
  }
}

// scenery lists what decorates the ground, far to near: peaks on the mountains, and
// trees and stones on open land away from the points, landmarks and bridges.
export function scenery(rules, rand) {
  const map = rules.map;
  const cell = map.cell;
  const out = [];
  map.terrain.forEach((row, r) => {
    [...row].forEach((k, c) => {
      if (k !== "M") return;
      const n = 1 + (rand() < 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++) out.push({ kind: "peak", x: (c + 0.2 + rand() * 0.6) * cell, y: (r + 0.2 + rand() * 0.6) * cell, k: 0.8 + rand() * 0.9, tone: rand() });
    });
  });
  const busy = [...map.points.map((p) => [p.x, p.y, 110]), ...(map.landmarks ?? []).map((l) => [l.x, l.y, 46])];
  const count = Math.round((map.width * map.height) / 14000);
  for (let i = 0; i < count; i++) {
    const x = rand() * map.width;
    const y = rand() * map.height;
    const tree = rand() < 0.75;
    const k = 0.7 + rand() * 0.6;
    const tint = rand() < 0.5;
    if (terrainAt(map, x, y) !== "L" || busy.some(([bx, by, r]) => Math.hypot(bx - x, by - y) < r)) continue;
    // Not on a shore cell either: trees in the surf look wrong.
    if ([[cell * 0.6, 0], [-cell * 0.6, 0], [0, cell * 0.6], [0, -cell * 0.6]].some(([dx, dy]) => terrainAt(map, x + dx, y + dy) !== "L")) continue;
    out.push({ kind: tree ? "tree" : "stone", x, y, k, tint });
  }
  return out.sort((a, b) => a.x + a.y - (b.x + b.y));
}

// drawScenery draws one piece of scenery with its foot at (x, y) of the context.
export function drawScenery(g, s, x, y) {
  const k = s.k;
  if (s.kind === "peak") {
    const h = 34 * k;
    const w = 26 * k;
    poly(g, "rgba(0,0,0,0.22)", [[x - w, y + 3], [x + w * 1.3, y + 6], [x, y - h * 0.2]]);
    poly(g, s.tone < 0.5 ? "#6b655a" : "#746c5f", [[x - w, y], [x, y - h], [x + w * 0.2, y + 5]]);
    poly(g, s.tone < 0.5 ? "#4a453d" : "#514b42", [[x + w * 0.2, y + 5], [x, y - h], [x + w, y]]);
    if (k > 1.2) poly(g, "#e6ebee", [[x - w * 0.26, y - h * 0.74], [x, y - h], [x + w * 0.24, y - h * 0.76], [x + w * 0.05, y - h * 0.66]]);
  } else if (s.kind === "tree") {
    tree(g, x, y, k, s.tint);
  } else {
    stone(g, x, y, k);
  }
}

// ---- small shapes ----

function poly(g, fill, pts) {
  g.fillStyle = fill;
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fill();
}

function disc(g, fill, x, y, rx, ry) {
  g.fillStyle = fill;
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, TAU);
  g.fill();
}

function tree(g, x, y, k, tint) {
  disc(g, "rgba(0,0,0,0.25)", x + 4, y + 2, 9 * k, 4 * k);
  g.strokeStyle = "#3a2c1c";
  g.lineWidth = 2.4 * k;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x, y - 9 * k);
  g.stroke();
  disc(g, tint ? "#3d5a35" : "#35502f", x, y - 15 * k, 9 * k, 8 * k);
  disc(g, tint ? "#4c6d41" : "#43623a", x - 2 * k, y - 18 * k, 5.5 * k, 4.5 * k);
}

function stone(g, x, y, k) {
  disc(g, "rgba(0,0,0,0.22)", x + 3, y + 2, 8 * k, 3.5 * k);
  poly(g, "#6d6a62", [[x - 8 * k, y], [x - 3 * k, y - 8 * k], [x + 5 * k, y - 6 * k], [x + 8 * k, y]]);
  poly(g, "#8b887e", [[x - 3 * k, y - 8 * k], [x + 5 * k, y - 6 * k], [x + 1 * k, y - 2 * k]]);
}

// box draws a block standing on the ground with its middle at (cx, cy): w along the
// map's east, d along its south, h tall.
function box(g, cx, cy, w, d, h, top, left, right) {
  const ex = w / 2, ey = w / 4;
  const sx = -d / 2, sy = d / 4;
  const N = [cx - ex - sx, cy - ey - sy];
  const E = [cx + ex - sx, cy + ey - sy];
  const S = [cx + ex + sx, cy + ey + sy];
  const W = [cx - ex + sx, cy - ey + sy];
  const up = ([x, y]) => [x, y - h];
  poly(g, left, [W, S, up(S), up(W)]);
  poly(g, right, [S, E, up(E), up(S)]);
  poly(g, top, [up(N), up(E), up(S), up(W)]);
}

// ---- landmarks ----

// landmarkFallbacks draws each kind of landmark at the origin of the context when no
// painted picture exists for it. Every kind in the rules has an entry: a test checks it.
export const landmarkFallbacks = {
  house(g) {
    disc(g, "rgba(0,0,0,0.28)", 7, 5, 26, 11);
    box(g, 0, 0, 30, 26, 15, "#b9ae98", "#8f8572", "#6f6757");
    box(g, 0, -15, 34, 30, 6, "#8e4f3a", "#6e3d2d", "#55301f");
    poly(g, "#3b332a", [[-9, 6], [-3, 9], [-3, -1], [-9, -4]]);
  },
  bunker(g) {
    disc(g, "rgba(0,0,0,0.3)", 6, 5, 28, 12);
    box(g, 0, 0, 34, 30, 9, "#8d9189", "#6a6e67", "#52564f");
    box(g, 0, -9, 26, 22, 4, "#9a9e95", "#74786f", "#5b5f57");
    poly(g, "#1c1f1c", [[-14, 3], [-2, 9], [-2, 5], [-14, -1]]);
    poly(g, "#1c1f1c", [[4, 9], [15, 3], [15, -1], [4, 5]]);
  },
  ruin(g) {
    disc(g, "rgba(0,0,0,0.25)", 5, 5, 24, 10);
    box(g, -8, -2, 12, 26, 13, "#a59c88", "#847b69", "#665f51");
    box(g, 6, -6, 16, 6, 8, "#a59c88", "#847b69", "#665f51");
    box(g, 8, 6, 8, 8, 4, "#8f8674", "#746c5c", "#5a5347");
    stone(g, 14, 10, 0.6);
    stone(g, -2, 12, 0.5);
  },
  grove(g) {
    for (const [x, y, k, tint] of [[-18, -8, 1.0, true], [8, -14, 1.2, false], [20, -2, 0.9, true], [-6, 4, 1.25, false], [10, 10, 1.0, true], [-22, 8, 0.85, false]]) tree(g, x, y, k, tint);
  },
  rocks(g) {
    for (const [x, y, k] of [[-12, -4, 1.3], [8, -8, 1.0], [14, 4, 1.5], [-4, 8, 1.1]]) stone(g, x, y, k);
  },
  wall(g) {
    disc(g, "rgba(0,0,0,0.25)", 6, 5, 30, 8);
    box(g, 0, 0, 56, 7, 11, "#a8a294", "#7f7a6e", "#646056");
    box(g, -18, -11, 8, 7, 3, "#a8a294", "#7f7a6e", "#646056");
    box(g, 6, -11, 8, 7, 3, "#a8a294", "#7f7a6e", "#646056");
  },
  rubble(g) {
    disc(g, "rgba(0,0,0,0.25)", 3, 4, 24, 10);
    box(g, -8, 0, 10, 12, 4, "#8f8674", "#746c5c", "#5a5347");
    for (const [x, y, k] of [[6, -6, 0.9], [12, 6, 0.7], [-14, 8, 0.6], [0, 8, 0.8], [-4, -8, 0.6]]) stone(g, x, y, k);
  },
};

// ---- bridges ----

// drawBridge draws a bridge on the ground of the view: its deck, planks and rails when it
// stands, charred when it is close to falling, and two broken stubs when it is down.
// `toScreen` is (x, y) → [sx, sy]; `state` is { hp (share), standing } or nothing.
export function drawBridge(g, bridge, toScreen, zoom, state, danger = 0.35) {
  const standing = state ? state.standing : true;
  const hp = state ? state.hp : 1;
  const [ax, ay] = bridge.from;
  const [bx, by] = bridge.to;
  const l = Math.hypot(bx - ax, by - ay);
  const ux = (bx - ax) / l;
  const uy = (by - ay) / l;
  const nx = -uy * (bridge.width / 2);
  const ny = ux * (bridge.width / 2);
  // A fallen bridge keeps a stub at each bank.
  const spans = standing ? [[-6, l + 6]] : [[-6, l * 0.16], [l * 0.84, l + 6]];
  const quad = (t0, t1, k = 1) => [
    toScreen(ax + ux * t0 + nx * k, ay + uy * t0 + ny * k),
    toScreen(ax + ux * t1 + nx * k, ay + uy * t1 + ny * k),
    toScreen(ax + ux * t1 - nx * k, ay + uy * t1 - ny * k),
    toScreen(ax + ux * t0 - nx * k, ay + uy * t0 - ny * k),
  ];
  const weak = standing && hp < danger;
  for (const [t0, t1] of spans) {
    // The shadow on the water, then the deck.
    poly(g, "rgba(0,0,0,0.3)", quad(t0, t1).map(([x, y]) => [x + 3 * zoom, y + 7 * zoom]));
    poly(g, weak ? "#6f5d4a" : "#8a7354", quad(t0, t1));
    poly(g, weak ? "#57493a" : "#9c8463", quad(t0, t1, 0.72));
    g.strokeStyle = weak ? "rgba(30,22,16,0.7)" : "rgba(52,40,28,0.55)";
    g.lineWidth = Math.max(1, 1.2 * zoom);
    for (let t = Math.ceil(t0 / 14) * 14; t < t1; t += 14) {
      const [p, q] = [toScreen(ax + ux * t + nx, ay + uy * t + ny), toScreen(ax + ux * t - nx, ay + uy * t - ny)];
      g.beginPath();
      g.moveTo(...p);
      g.lineTo(...q);
      g.stroke();
    }
    // Rails along both edges.
    g.strokeStyle = weak ? "#3b3027" : "#4f3f2e";
    g.lineWidth = Math.max(1.2, 2.4 * zoom);
    for (const k of [1, -1]) {
      const [p, q] = [toScreen(ax + ux * t0 + nx * k, ay + uy * t0 + ny * k), toScreen(ax + ux * t1 + nx * k, ay + uy * t1 + ny * k)];
      g.beginPath();
      g.moveTo(p[0], p[1] - 5 * zoom);
      g.lineTo(q[0], q[1] - 5 * zoom);
      g.stroke();
    }
  }
  if (weak) {
    // Holes where the deck has been shot through.
    for (const [t, k] of [[l * 0.3, 0.3], [l * 0.55, -0.4], [l * 0.72, 0.1]]) {
      const [sx, sy] = toScreen(ax + ux * t + nx * k, ay + uy * t + ny * k);
      disc(g, "rgba(12,24,30,0.8)", sx, sy, 7 * zoom, 3.5 * zoom);
    }
  }
  if (!standing) {
    // Splintered ends and a few timbers in the water between them.
    for (const [t, k] of [[l * 0.3, 0.5], [l * 0.5, -0.3], [l * 0.68, 0.2]]) {
      const [sx, sy] = toScreen(ax + ux * t + nx * k, ay + uy * t + ny * k);
      g.strokeStyle = "rgba(92,74,54,0.85)";
      g.lineWidth = Math.max(1, 2.2 * zoom);
      g.beginPath();
      g.moveTo(sx - 8 * zoom, sy - 2 * zoom);
      g.lineTo(sx + 8 * zoom, sy + 3 * zoom);
      g.stroke();
    }
  }
}

// ---- small maps ----

// drawMiniMap paints a flat picture of a map into a w × h box of a context: terrain,
// bridges, and optionally the points. The lobby's map cards and the radar both use it.
export function drawMiniMap(g, rules, map, w, h, { points = false, sides = ["#4da3ff", "#ff6b4a"], standing = () => true } = {}) {
  const cols = Math.round(map.width / map.cell);
  const rows = Math.round(map.height / map.cell);
  const kx = w / cols;
  const ky = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      g.fillStyle = terrainColors[map.terrain[r][c]].radar;
      g.fillRect(Math.floor(c * kx), Math.floor(r * ky), Math.ceil(kx) + 1, Math.ceil(ky) + 1);
    }
  }
  const k = w / map.width;
  for (const b of map.bridges ?? []) {
    g.strokeStyle = standing(b.id) ? "#a58c66" : "rgba(165,140,102,0.35)";
    g.lineWidth = Math.max(1.5, b.width * k * 0.7);
    g.setLineDash(standing(b.id) ? [] : [2, 2]);
    g.beginPath();
    g.moveTo(b.from[0] * k, b.from[1] * (h / map.height));
    g.lineTo(b.to[0] * k, b.to[1] * (h / map.height));
    g.stroke();
    g.setLineDash([]);
  }
  if (!points) return;
  for (const p of map.points) {
    const x = p.x * k;
    const y = p.y * (h / map.height);
    const r = Math.max(2, w / 70);
    g.strokeStyle = "#0b0f10";
    g.lineWidth = 1;
    if (p.kind === "hq") {
      g.fillStyle = sides[p.owner];
      g.fillRect(x - r * 1.4, y - r * 1.4, r * 2.8, r * 2.8);
      g.strokeRect(x - r * 1.4, y - r * 1.4, r * 2.8, r * 2.8);
      continue;
    }
    g.fillStyle = p.kind === "landRig" ? "#e7b93c" : p.kind === "seaRig" ? "#7fd0e6" : "#e6e9e1";
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
    g.stroke();
  }
}
