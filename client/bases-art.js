// Structures on the map and on the build buttons. A painted sprite is used when the
// manifest has one under the structure's rules id (and "<id>_ruin" for its wreck);
// otherwise each role has a code-drawn picture here, in the faction's colours, so a
// missing sprite never leaves a gap.

import { drawBuilding, drawDoor, drawPoweredStructure, isoBox, shadow, sprites, drawSegment, stageOf } from "./art.js";
import { toIso } from "./iso.js";

const palettes = {
  aegis: { wall: "#93a6b4", side: "#657a89", dark: "#3a4853", roof: "#c7dbe4", trim: "#cfeef4", metal: "#4d5c68" },
  ashfall: { wall: "#bb9d69", side: "#8a6b40", dark: "#4b3a27", roof: "#7d4c31", trim: "#f1dfb0", metal: "#5a4a36" },
};

const line = (ctx, color, width, x1, y1, x2, y2) => {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
};
const disc = (ctx, color, x, y, rx, ry = rx) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
};
const box = (ctx, p, x, y, w, d, h, top = p.roof) => isoBox(ctx, x, y, w, d, h, top, p.side, p.wall);
// A standing tank: a cylinder seen from above and the side.
const tank = (ctx, p, x, y, r, h) => {
  ctx.fillStyle = p.side;
  ctx.fillRect(x - r, y - h, r * 2, h);
  disc(ctx, p.side, x, y, r, r / 2);
  disc(ctx, p.roof, x, y - h, r, r / 2);
};
const flag = (ctx, color, x, y, time) => {
  line(ctx, "#d8dcd6", 1.4, x, y, x, y - 22);
  const wave = Math.sin(time * 4) * 1.5;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - 22);
  ctx.lineTo(x + 11, y - 19 + wave);
  ctx.lineTo(x, y - 15);
  ctx.closePath();
  ctx.fill();
};

// One picture per role. Each draws a structure standing on the origin, about 50 px tall.
export const fallbacks = {
  barracks(ctx, p) {
    shadow(ctx, 36, 15, 0.3);
    box(ctx, p, 0, 0, 54, 34, 16, p.wall);
    box(ctx, p, 0, -16, 58, 38, 7);
    ctx.fillStyle = p.dark;
    ctx.fillRect(8, -12, 7, 12);
    for (const x of [-20, -8]) ctx.fillRect(x + 22, -13 + (x + 22) * 0.05, 4, 5);
  },
  refinery(ctx, p) {
    shadow(ctx, 38, 16, 0.3);
    box(ctx, p, -6, 2, 40, 34, 14, p.wall);
    tank(ctx, p, 20, 2, 11, 24);
    tank(ctx, p, 4, -10, 9, 30);
    line(ctx, p.metal, 3.5, -18, -12, -18, -46);
    disc(ctx, "rgba(210,210,200,0.35)", -18, -50, 5, 4);
    line(ctx, "#c9a44c", 2, -2, -4, 14, -4); // the gold line from the unloading bay
  },
  works(ctx, p) {
    shadow(ctx, 40, 17, 0.32);
    box(ctx, p, 0, 0, 60, 42, 24, p.wall);
    box(ctx, p, 0, -24, 62, 44, 4);
    ctx.fillStyle = p.dark;
    ctx.beginPath(); // the wide door on the near face
    ctx.moveTo(4, 2);
    ctx.lineTo(26, -9);
    ctx.lineTo(26, -25);
    ctx.lineTo(4, -14);
    ctx.closePath();
    ctx.fill();
    box(ctx, p, -22, -26, 12, 12, 12);
  },
  airbase(ctx, p) {
    // A pad on the ground with its markings, and a small tower beside it.
    isoBox(ctx, 6, 6, 66, 52, 2, "#4a5257", "#33393d", "#3b4246");
    ctx.strokeStyle = p.trim;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(6, 4, 15, 7.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    line(ctx, p.trim, 1.4, 0, 4, 12, 4);
    box(ctx, p, -32, -4, 14, 14, 30, p.wall);
    box(ctx, p, -32, -34, 18, 18, 7);
    line(ctx, p.metal, 1.4, 34, 0, 34, -22);
    ctx.fillStyle = "#e0782f";
    ctx.beginPath();
    ctx.moveTo(34, -22);
    ctx.lineTo(46, -19);
    ctx.lineTo(34, -17);
    ctx.fill();
  },
  dockyard(ctx, p) {
    // A pier out toward the water, a shed, and a crane.
    isoBox(ctx, 10, 12, 30, 62, 3, "#8a6f4d", "#5d4a33", "#6f583c");
    shadow(ctx, 26, 11, 0.28);
    box(ctx, p, -14, -2, 34, 26, 15, p.wall);
    box(ctx, p, -14, -17, 37, 29, 5);
    line(ctx, p.metal, 3, 22, 6, 22, -34);
    line(ctx, p.metal, 2.4, 22, -34, 44, -24);
    line(ctx, p.metal, 1.2, 40, -26, 40, -8);
    ctx.fillStyle = p.dark;
    ctx.fillRect(37, -8, 6, 5);
  },
  power(ctx, p) {
    // A turbine hall with two stacks.
    shadow(ctx, 36, 15, 0.3);
    box(ctx, p, -4, 2, 46, 32, 15, p.wall);
    for (const x of [-12, 6]) {
      line(ctx, p.metal, 6, x, -14, x, -40);
      disc(ctx, p.dark, x, -40, 3, 1.5);
    }
    tank(ctx, p, 24, 4, 8, 14);
  },
  radar(ctx, p, time) {
    // A low hut and a dish on a mast; the dish swings with the clock.
    shadow(ctx, 30, 13, 0.3);
    box(ctx, p, -8, 4, 34, 26, 11, p.wall);
    line(ctx, p.metal, 3, 12, 0, 12, -34);
    const turn = Math.cos((time ?? 0) * 1.05);
    ctx.fillStyle = p.trim;
    ctx.beginPath();
    ctx.ellipse(12, -38, 4 + 9 * Math.abs(turn), 9, 0, 0, Math.PI * 2);
    ctx.fill();
    line(ctx, p.dark, 1.4, 12, -38, 12 + 9 * turn, -43);
  },
  defence(ctx, p, time, def) {
    shadow(ctx, 15, 7, 0.3);
    isoBox(ctx, 0, 2, 26, 26, 6, "#8d8468", "#5d5744", "#716a52"); // sandbags
    box(ctx, p, 0, -6, 13, 13, 9, p.wall);
    const up = def?.vs?.infantry === 0; // an anti-aircraft weapon points at the sky
    if (up) {
      line(ctx, p.dark, 2.6, -3, -16, -9, -34);
      line(ctx, p.dark, 2.6, 3, -16, 9, -34);
    } else {
      line(ctx, p.dark, 3.2, 0, -13, 20, -7);
      disc(ctx, p.dark, 20, -7, 2.2, 2.2);
    }
  },
};

function rubble(ctx, p) {
  shadow(ctx, 28, 12, 0.3);
  isoBox(ctx, 0, 4, 46, 36, 3, "#2a2622", "#1d1a17", "#24201c");
  box(ctx, p, -14, -2, 8, 8, 9, p.dark);
  box(ctx, p, 12, 4, 10, 7, 5, p.dark);
  disc(ctx, "rgba(20,18,16,0.6)", 2, 0, 12, 5);
}

const heights = { barracks: 46, refinery: 62, works: 60, airbase: 56, dockyard: 54, defence: 40 };

// drawStructure draws one structure standing on the origin of the context.
//   st: { kind, role, faction, building, ruin, door }  def: its rules entry  color: its side's colour
//   door: "open" or "lit" while a unit comes out of it
export function drawStructure(ctx, st, def, color, time) {
  const p = palettes[st.faction] ?? palettes.aegis;
  if (st.ruin) {
    if (sprites.buildings[`${st.kind}_ruin`]) drawBuilding(ctx, `${st.kind}_ruin`, color, time);
    else rubble(ctx, p);
    return;
  }
  const paint = () => {
    // A structure short of power stands dark, and a radar's dish turns only with power.
    if (sprites.buildings[st.kind] && (st.dark || sprites.buildings[st.kind].spin)) drawPoweredStructure(ctx, st.kind, color, time, !st.dark);
    else if (sprites.buildings[st.kind]) drawBuilding(ctx, st.kind, color, time);
    else (fallbacks[st.role] ?? fallbacks.barracks)(ctx, p, time, def);
  };
  const rising = st.building < 1;
  if (!rising) {
    paint();
    if (st.door && st.door !== "closed") drawDoor(ctx, st.kind, st.door);
    if (!sprites.buildings[st.kind] && st.role !== "defence") flag(ctx, color, -30, 2, time);
    return;
  }
  // Going up: the building site, or a ghost of the whole thing, and the built part rising
  // from the ground.
  const h = heights[st.role] ?? 56;
  // Painted construction stages: bare footing, frame, scaffolding, nearly done.
  const stages = sprites.buildings[st.kind]?.stages ?? [];
  if (stages.length && stages.every((key) => sprites.buildings[key])) {
    drawBuilding(ctx, stages[stageOf(stages.length, st.building)], color, time);
    return;
  }
  if (sprites.buildings[`${st.kind}_site`]) {
    drawBuilding(ctx, `${st.kind}_site`, color, time);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, st.building * 1.4 - 0.4)); // the finished walls fade in over the frame
    paint();
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.globalAlpha = 0.28;
  paint();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.rect(-60, 30 - (h + 30) * st.building, 120, (h + 30) * st.building + 10);
  ctx.clip();
  paint();
  ctx.restore();
  // Scaffold poles.
  for (const x of [-30, 30]) line(ctx, "#c9a44c", 1.2, x, 6, x, -h);
  line(ctx, "#c9a44c", 1.2, -30, 6 - (h + 6) * st.building, 30, 6 - (h + 6) * st.building);
}

// drawFence draws one fence segment. The context sits on the segment's middle and is
// scaled so that one unit is one map unit on screen.
export function drawFence(ctx, st, color) {
  const [ax, ay] = toIso(st.ax - st.x, st.ay - st.y);
  const [bx, by] = toIso(st.bx - st.x, st.by - st.y);
  const p = palettes[st.faction] ?? palettes.aegis;
  // A run along the map's east-west or north-south line has a painted piece; a diagonal
  // one is drawn here.
  const [dx, dy] = [st.bx - st.ax, st.by - st.ay];
  const axis = Math.abs(dy) < 1 ? "x" : Math.abs(dx) < 1 ? "y" : null;
  if (axis && sprites.segments[st.kind]) {
    ctx.save();
    if (!st.ruin && st.building < 1) ctx.globalAlpha = 0.35 + 0.65 * st.building;
    const painted = drawSegment(ctx, st.kind, axis, Math.hypot(dx, dy), st.ruin ? "ruin" : "");
    ctx.restore();
    if (painted) {
      if (!st.ruin) line(ctx, color, 1.2, ax, ay + 1.5, bx, by + 1.5); // whose it is
      return;
    }
  }
  if (st.ruin) {
    for (const t of [0.2, 0.55, 0.85]) disc(ctx, "rgba(40,36,30,0.7)", ax + (bx - ax) * t, ay + (by - ay) * t, 5, 2.5);
    return;
  }
  ctx.save();
  if (st.building < 1) ctx.globalAlpha = 0.35 + 0.65 * st.building;
  if (st.faction === "ashfall") {
    // Wire on posts.
    for (const t of [0, 0.5, 1]) line(ctx, p.dark, 2, ax + (bx - ax) * t, ay + (by - ay) * t, ax + (bx - ax) * t, ay + (by - ay) * t - 13);
    for (const h of [5, 9, 13]) line(ctx, "#cfc7b4", 0.9, ax, ay - h, bx, by - h);
  } else {
    // A solid wall with a lit top edge.
    const h = 14;
    ctx.fillStyle = p.side;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx, by - h);
    ctx.lineTo(ax, ay - h);
    ctx.closePath();
    ctx.fill();
    line(ctx, p.roof, 2.4, ax, ay - h, bx, by - h);
  }
  ctx.restore();
  line(ctx, color, 1.2, ax, ay + 1.5, bx, by + 1.5); // whose it is
}

// drawIcon draws a structure on a build button.
export function drawIcon(ctx, id, def, faction, color) {
  if (def.role === "fence") {
    ctx.save();
    ctx.scale(0.9, 0.9);
    drawFence(ctx, { x: 0, y: 0, ax: -22, ay: 22, bx: 22, by: -22, faction, building: 1 }, color);
    ctx.restore();
    return;
  }
  drawStructure(ctx, { kind: id, role: def.role, faction, building: 1 }, def, color, 0);
}
