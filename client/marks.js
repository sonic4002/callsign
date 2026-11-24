// Small marks drawn in code, so they stay crisp at any size: the two earned ranks beside a
// squad's label, and the build panel's state icons. Each is a few paths on a 16 by 16 grid,
// given both as an SVG string for the sidebar and drawn on a canvas for the map.
//
// Earned ranks are silver stars, so they never read as the brass chevrons a bought brain
// tier wears: a squad can show both, side by side.

const SILVER = "#e6edf2";
const STEEL = "#8fa3b3";
const INK = "#10161a";

// Each mark is a list of shapes: { d, fill?, stroke?, width? } in the 16-unit box.
const star = (cx, cy, outer, inner, points = 5, turn = -Math.PI / 2) => {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = turn + (i * Math.PI) / points;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
};

export const ranks = {
  // Seasoned: one silver star.
  seasoned: [{ d: star(8, 8.4, 6.6, 2.9), fill: SILVER, stroke: INK, width: 1.1 }],
  // Elite: a silver star over a steel bar. At label size it reads as "a star and a stripe".
  elite: [
    { d: star(8, 6, 5.8, 2.5), fill: SILVER, stroke: INK, width: 1.1 },
    { d: "M2.4 12.2H13.6V15.2H2.4Z", fill: STEEL, stroke: INK, width: 1 },
  ],
};

const BRASS = "#e2b33c";
const WARN = "#f0a04a";
const BAD = "#e0604c";
const GOOD = "#7fd08a";

export const icons = {
  // Power: a bolt. `lowPower` is the same bolt in a warning triangle.
  power: [{ d: "M9.6 1.2L3.6 9.2H7.4L6.2 14.8L12.4 6.6H8.6Z", fill: BRASS, stroke: INK, width: 0.9 }],
  lowPower: [
    { d: "M8 1.3L15.2 14.2H0.8Z", fill: WARN, stroke: INK, width: 1 },
    { d: "M8.9 5L5.9 9.4H7.9L7.2 12.8L10.3 8.3H8.3Z", fill: INK },
  ],
  // Rally: a flag on a staff, planted.
  rally: [
    { d: "M4 1.5V14.8", stroke: SILVER, width: 1.5 },
    { d: "M4.6 2.2H12.8L10.6 5.2L12.8 8.2H4.6Z", fill: GOOD, stroke: INK, width: 0.9 },
    { d: "M1.8 14.8H6.4", stroke: SILVER, width: 1.5 },
  ],
  // Sell: a coin dropping out of a structure's outline (an arrow down onto a coin).
  sell: [
    { d: "M8 1.2V7.4M5.2 5L8 7.8L10.8 5", stroke: SILVER, width: 1.6 },
    { d: "M2.6 11.8A5.4 2.8 0 1 0 13.4 11.8A5.4 2.8 0 1 0 2.6 11.8Z", fill: BRASS, stroke: INK, width: 0.9 },
  ],
  // Repair: a spanner.
  repair: [
    {
      d: "M10.9 1.4A3.6 3.6 0 0 0 7.6 6.3L1.9 12A1.5 1.5 0 0 0 4 14.1L9.7 8.4A3.6 3.6 0 0 0 14.6 5.1L12.3 7.3L9.9 6.1L8.7 3.7Z",
      fill: SILVER, stroke: INK, width: 0.9,
    },
  ],
  // Cancel: a cross in a ring.
  cancel: [
    { d: "M1.6 8A6.4 6.4 0 1 0 14.4 8A6.4 6.4 0 1 0 1.6 8Z", fill: BAD, stroke: INK, width: 0.9 },
    { d: "M5.2 5.2L10.8 10.8M10.8 5.2L5.2 10.8", stroke: INK, width: 1.8 },
  ],
};

const attrs = (s) =>
  `d="${s.d}" fill="${s.fill ?? "none"}"` + (s.stroke ? ` stroke="${s.stroke}" stroke-width="${s.width ?? 1}" stroke-linejoin="round" stroke-linecap="round"` : "");

// svg gives a mark as a self-contained SVG string, `size` CSS pixels square.
function svg(shapes, size, label) {
  const title = label ? `<title>${label.replace(/[<>&]/g, "")}</title>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="${label ? "false" : "true"}">${title}${shapes.map((s) => `<path ${attrs(s)}/>`).join("")}</svg>`;
}

// rankSvg("seasoned" | "elite") for the roster; an unknown or missing rank gives "".
export const rankSvg = (rank, size = 14, label = "") => (ranks[rank] ? svg(ranks[rank], size, label) : "");
// iconSvg("power" | "lowPower" | "rally" | "sell" | "repair" | "cancel") for the build panel.
export const iconSvg = (name, size = 14, label = "") => (icons[name] ? svg(icons[name], size, label) : "");

// draw paints a mark on a canvas with its top-left corner at (x, y), `size` pixels square.
function draw(ctx, shapes, x, y, size) {
  if (typeof Path2D === "undefined") return false;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 16, size / 16);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const s of shapes) {
    const path = new Path2D(s.d);
    if (s.fill) {
      ctx.fillStyle = s.fill;
      ctx.fill(path);
    }
    if (s.stroke) {
      ctx.strokeStyle = s.stroke;
      ctx.lineWidth = s.width ?? 1;
      ctx.stroke(path);
    }
  }
  ctx.restore();
  return true;
}

// drawRank paints a squad's earned rank beside its map label; nothing for no rank.
export const drawRank = (ctx, rank, x, y, size = 12) => Boolean(ranks[rank]) && draw(ctx, ranks[rank], x, y, size);
export const drawIcon = (ctx, name, x, y, size = 12) => Boolean(icons[name]) && draw(ctx, icons[name], x, y, size);
