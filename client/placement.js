// Placing a structure on the map: which ground it may stand on, the spot under the
// pointer, and the words that name that spot on the radio. Nothing here touches the page
// (placement.test.mjs). The rule is the server's own (server/sim/placement.go): both are
// checked against one table, client/testdata/placement-small.json, so the ground the page
// tints green is the ground the server accepts. The server still decides.

// Clearances a new structure keeps, added to its own footprint (as in placement.go).
const CLEAR = { landmark: 34, structure: 12, fence: 6, field: 10, edge: 20, workEdge: 4, workHQ: 70, work: 6, dockMargin: 160 };

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// terrainAt is the letter of the ground at a spot: L land, W water, I ice, M mountain.
export function terrainAt(map, x, y) {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return "M";
  return map.terrain[Math.floor(y / map.cell)][Math.floor(x / map.cell)];
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l = dx * dx + dy * dy;
  if (l === 0) return dist(px, py, ax, ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l));
  return dist(px, py, ax + t * dx, ay + t * dy);
}

const isBase = (def) => !["hq", "defence", "fence"].includes(def.role);
const hqOf = (rules, side) => rules.map.points.find((p) => p.kind === "hq" && p.owner === side);
const footprintOf = (rules, st) => rules.factions[st.faction]?.structures[st.kind]?.footprint ?? 30;

// dockReach is how far from its headquarters a side may put a dockyard: as far as the
// nearest shore, and some room along it.
const reaches = new WeakMap();
export function dockReach(rules, side) {
  const map = rules.map;
  const known = reaches.get(map) ?? {};
  if (known[side] !== undefined) return known[side];
  const hq = hqOf(rules, side);
  const x = hq.x + (hq.x > map.width / 2 ? -60 : 60);
  let best = [x, hq.y];
  let bd = Infinity;
  for (let r = 0; r < map.terrain.length; r++) {
    for (let c = 0; c < map.terrain[r].length; c++) {
      const cx = (c + 0.5) * map.cell;
      const cy = (r + 0.5) * map.cell;
      if (terrainAt(map, cx, cy) !== "L") continue;
      const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => terrainAt(map, cx + dx * map.cell, cy + dy * map.cell) === "W");
      const d = dist(x, hq.y, cx, cy);
      if (wet && d < bd) [best, bd] = [[cx, cy], d];
    }
  }
  known[side] = dist(hq.x, hq.y, best[0], best[1]) + CLEAR.dockMargin;
  reaches.set(map, known);
  return known[side];
}

// canPlace says why a structure cannot stand at (x, y) for a side, or "" when it can:
//   "edge" off the map's edge · "far" outside the ground the side may build on ·
//   "ground" not open land · "shore" a dockyard away from water · "room" something is in the way.
// `state` is the side's own snapshot: the structures and points it knows of.
export function canPlace(rules, state, side, def, x, y) {
  const map = rules.map;
  const m = rules.match;
  const structures = (state.structures ?? []).filter((s) => !s.ruin);
  if (!isBase(def)) return canPlaceWork(rules, state, side, def.role === "fence" ? 2 : def.footprint, x, y, structures);
  const fp = def.footprint;
  if (x < fp + CLEAR.edge || y < fp + CLEAR.edge || x > map.width - fp - CLEAR.edge || y > map.height - fp - CLEAR.edge) return "edge";
  const hq = hqOf(rules, side);
  const r = def.role === "dockyard" ? Math.max(m.baseRadius, dockReach(rules, side)) : m.baseRadius;
  const reach = dist(x, y, hq.x, hq.y) <= r || structures.some((s) => s.side === side && s.building >= 1 && isBase(s) && dist(x, y, s.x, s.y) <= m.baseReach);
  if (!reach) return "far";
  if (terrainAt(map, x, y) !== "L") return "ground";
  if (def.role === "dockyard") {
    const wet = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]].some(([dx, dy]) =>
      [map.cell, fp + map.cell / 2].some((d) => terrainAt(map, x + dx * d, y + dy * d) === "W"),
    );
    if (!wet) return "shore";
  } else if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => terrainAt(map, x + dx * fp, y + dy * fp) !== "L")) return "ground";
  if ((map.landmarks ?? []).some((l) => dist(x, y, l.x, l.y) < fp + CLEAR.landmark)) return "room";
  if ((map.bridges ?? []).some((b) => segDist(x, y, b.from[0], b.from[1], b.to[0], b.to[1]) < fp + b.width)) return "room";
  if ((map.gushers ?? []).some((g) => dist(x, y, g.x, g.y) < fp + g.fieldRadius + CLEAR.field)) return "room";
  if (map.points.some((p) => dist(x, y, p.x, p.y) < fp + m.captureRadius)) return "room";
  for (const s of structures) {
    if (s.role === "fence") {
      if (segDist(x, y, s.ax ?? s.x, s.ay ?? s.y, s.bx ?? s.x, s.by ?? s.y) < fp + CLEAR.fence) return "room";
    } else if (dist(x, y, s.x, s.y) < fp + footprintOf(rules, s) + CLEAR.structure) return "room";
  }
  return "";
}

// canPlaceWork is the rule for a defence, and for the middle of a fence run: on the side's
// own ground (near its headquarters, a structure of its own or a point it holds).
function canPlaceWork(rules, state, side, fp, x, y, structures) {
  const map = rules.map;
  const r = rules.match.buildRadius;
  if (x < fp + CLEAR.workEdge || y < fp + CLEAR.workEdge || x > map.width - fp - CLEAR.workEdge || y > map.height - fp - CLEAR.workEdge) return "edge";
  const hq = hqOf(rules, side);
  const held = (state.points ?? []).filter((p) => p.owner === side).map((p) => map.points.find((q) => q.id === p.id));
  const own =
    dist(x, y, hq.x, hq.y) <= r || structures.some((s) => s.side === side && s.role !== "fence" && dist(x, y, s.x, s.y) <= r) || held.some((p) => p && dist(x, y, p.x, p.y) <= r);
  if (!own) return "far";
  if (terrainAt(map, x, y) !== "L") return "ground";
  if ((map.landmarks ?? []).some((l) => dist(x, y, l.x, l.y) < fp + CLEAR.landmark)) return "room";
  if (map.points.some((p) => p.kind === "hq" && dist(x, y, p.x, p.y) < fp + CLEAR.workHQ)) return "room";
  if (structures.some((s) => s.role !== "fence" && dist(x, y, s.x, s.y) < fp + footprintOf(rules, s) + CLEAR.work)) return "room";
  return "";
}

// ---- the spot under the pointer, and its words ----

const STEP = 10; // a spot is said in tens of metres

// spotAt snaps a place on the map to one that can be said: so many metres north or south
// and east or west of the nearest named point.
export function spotAt(rules, x, y) {
  let point = null;
  let bd = Infinity;
  for (const p of rules.map.points) {
    const d = dist(x, y, p.x, p.y);
    if (d < bd) [point, bd] = [p, d];
  }
  const east = Math.round((x - point.x) / STEP) * STEP;
  const south = Math.round((y - point.y) / STEP) * STEP;
  return { point: point.id, east, south, x: point.x + east, y: point.y + south };
}

// spotWords says a spot the way the radio net reads it back into a place: a distance
// each way, always both, so that it is taken as an exact spot and not as a bearing.
// `t` is the page's translator and `name` the point's callsign in the language spoken.
export function spotWords(t, spot, name) {
  return t("place.spot", {
    ns: Math.abs(spot.south),
    nsDir: t(spot.south > 0 ? "dir.S" : "dir.N"),
    ew: Math.abs(spot.east),
    ewDir: t(spot.east < 0 ? "dir.W" : "dir.E"),
    point: name,
  });
}

// spotForm is the same spot as the simulation writes it: "N140 E60 of A".
export const spotForm = (spot) => `${spot.south > 0 ? "S" : "N"}${Math.abs(spot.south)} ${spot.east < 0 ? "W" : "E"}${Math.abs(spot.east)} of ${spot.point}`;

// parseSpot reads "N140 E60 of A" back into a spot, or null when the text is something else.
export function parseSpot(rules, place) {
  const m = /^([NS])(\d+) ([EW])(\d+) of ([A-Z])$/.exec(place ?? "");
  const point = m && rules.map.points.find((p) => p.id === m[5]);
  if (!point) return null;
  const south = (m[1] === "S" ? 1 : -1) * Number(m[2]);
  const east = (m[3] === "E" ? 1 : -1) * Number(m[4]);
  return { point: point.id, east, south, x: point.x + east, y: point.y + south };
}

// ---- the tint ----

// tint lists the ground a structure may stand on, as cells of `step` metres: every cell
// within the ground the side may build on, each marked ok or not. Cells far from
// anything the side owns are left out: they are red by being untinted, and the ghost
// itself says no there.
export function tint(rules, state, side, def, step = 20) {
  const cells = [];
  const map = rules.map;
  for (let y = step / 2; y < map.height; y += step) {
    for (let x = step / 2; x < map.width; x += step) {
      const why = canPlace(rules, state, side, def, x, y);
      if (why !== "far" && why !== "edge") cells.push({ x, y, ok: why === "" });
    }
  }
  return cells;
}

// tintKey changes when the tint has to be worked out again.
export const tintKey = (state, side, kind) =>
  JSON.stringify([kind, side, (state.structures ?? []).map((s) => [s.id, s.ruin ? 0 : 1, s.building >= 1 ? 1 : 0, s.side]), (state.points ?? []).map((p) => p.owner)]);

// ---- production lines ----

// lines groups a side's units on their way by the structure that makes them, each line in
// the order it will come out.
export function lines(state, side) {
  const out = new Map();
  for (const d of state.deploying ?? []) {
    if (d.side !== side) continue;
    const key = d.from || "";
    out.set(key, [...(out.get(key) ?? []), d]);
  }
  for (const line of out.values()) line.sort((a, b) => a.line - b.line);
  return out;
}

// unitLine is what a unit's button shows: how many of it are on their way, and the one
// that comes out first with how long it still has (its own time and the line ahead of it).
export function unitLine(state, side, unit) {
  const mine = (state.deploying ?? []).filter((d) => d.side === side && d.unit === unit);
  const wait = (d) => (d.ticksAhead ?? 0) + d.ticksLeft;
  const first = mine.reduce((best, d) => (!best || wait(d) < wait(best) ? d : best), null);
  return { count: mine.length, first, ticks: first ? wait(first) : 0, making: Boolean(first && (first.line ?? 0) === 0) };
}
