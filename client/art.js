// Art. Every unit, building and prop has an original drawing made in code here, so the
// page looks finished with no image files at all. When /assets/sprites/manifest.json
// exists, anything it lists is drawn from its image instead, with no other change.
//
// The same holds one unit at a time for the animated unit sheets (see art/units.py).
//
// All drawings are made around the origin, standing on it, facing south-east (right and
// toward the viewer). The caller translates, scales and flips.

import { drawVent, haulerShape } from "./gold.js";

const TAU = Math.PI * 2;

// ---- generated sprites ----

// `landmarks` and `props` hold pictures in the same form as `buildings`. `segments` holds
// the pieces of things laid end to end (walls, fences, the bridge): see CREDITS.md in
// assets/sprites for how a run is drawn. `variants` names the pictures of one kind of thing.
// `portraits` are the roster pictures of the heroes, as addresses for an <img>.
export const sprites = { units: {}, buildings: {}, landmarks: {}, props: {}, terrain: {}, segments: {}, variants: {}, portraits: {}, icons: {} };

const loadImage = (src) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

// loadSprites reads the manifest if there is one. A missing manifest or image is not an
// error: that thing simply keeps its code-drawn look.
export async function loadSprites(base = "/assets/sprites/") {
  let manifest;
  try {
    const res = await fetch(`${base}manifest.json`);
    if (!res.ok) return sprites;
    manifest = await res.json();
  } catch {
    return sprites;
  }
  const jobs = [];
  // A sheet is cut into frames by the numbers in the manifest, so the two must be of one
  // version: a kept copy of an older sheet cut by new numbers shows half soldiers. The
  // sheet's address therefore carries the manifest's stamp and the frame size, and a new
  // render is a new address that no cache can answer with the old picture.
  const sheet = (part) => base + part.image + "?v=" + [manifest.stamp, part.frame?.join("x")].filter(Boolean).join("-");
  for (const group of ["units", "buildings", "landmarks", "props"]) {
    for (const [id, entry] of Object.entries(manifest[group] ?? {})) {
      // A unit with a weapon that turns on its own has a second sheet for it; both must load.
      const images = [entry, entry.turret].filter((part) => part?.image).map((part) => loadImage(sheet(part)));
      jobs.push(
        Promise.all(images).then(([img, top]) => {
          if (!img || (entry.turret && !top)) return;
          sprites[group][id] = { ...entry, img, turret: entry.turret && { ...entry.turret, img: top } };
          // A structure's door is two small patches drawn over it: open, and open with the
          // light on. A patch that fails to load is simply never drawn.
          for (const patch of Object.values(entry.door?.frames ?? {})) {
            loadImage(base + patch.image).then((pic) => pic && (sprites[group][id].door.frames[patch.name].img = pic));
          }
        }),
      );
    }
  }
  // A segment is a small tree of pictures (x, y, and the same for each state); every node
  // with an image gets it loaded in place. A piece that fails to load leaves the whole
  // segment out, so the page falls back to its own drawing for all of it.
  for (const [id, entry] of Object.entries(manifest.segments ?? {})) {
    const tree = structuredClone(entry);
    const parts = [];
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (typeof node.image === "string") parts.push(loadImage(base + node.image).then((img) => (node.img = img)));
      else Object.values(node).forEach(walk);
    };
    walk(tree);
    jobs.push(Promise.all(parts).then((imgs) => imgs.every(Boolean) && (sprites.segments[id] = tree)));
  }
  sprites.variants = manifest.variants ?? {};
  for (const [id, entry] of Object.entries(manifest.portraits ?? {})) sprites.portraits[id] = { ...entry, src: base + entry.image };
  // A structure's small picture for its button in the build panel, as an address to show.
  for (const [id, entry] of Object.entries(manifest.icons ?? {})) sprites.icons[id] = { ...entry, src: base + entry.image };
  for (const [id, path] of Object.entries(manifest.terrain ?? {})) {
    jobs.push(loadImage(base + path).then((img) => img && (sprites.terrain[id] = img)));
  }
  await Promise.all(jobs);
  return sprites;
}

// drawSprite draws a manifest sprite standing on the origin, `height` pixels tall.
// `turn` is the direction of travel on screen in radians (0 = right, clockwise).
function drawSprite(ctx, entry, height, turn) {
  const { img, anchor = [0.5, 0.85] } = entry;
  const facings = Math.max(1, entry.facings ?? 1);
  const [fw, fh] = entry.frame ?? [img.width / facings, img.height];
  let frame = 0;
  let flip = 1;
  if (facings === 1) {
    flip = Math.cos(turn) < 0 ? -1 : 1;
  } else {
    // The first frame faces south-east; the rest go clockwise.
    const step = TAU / facings;
    frame = ((Math.round((turn - Math.PI / 4) / step) % facings) + facings) % facings;
  }
  const k = height / fh;
  ctx.save();
  ctx.scale(flip, 1);
  ctx.drawImage(img, frame * fw, 0, fw, fh, -anchor[0] * fw * k, -anchor[1] * fh * k, fw * k, fh * k);
  ctx.restore();
}

// ---- animated unit sheets ----
//
// A sheet has a row for each of eight map headings and a column for each frame; `anims`
// names runs of columns. The models are rendered at `ppm` pixels a metre and drawn here
// at METRE, so every unit is to one scale.

const METRE = 15;

// mapHeading turns a direction on screen into a heading on the map (0 = east, clockwise).
const mapHeading = (turn) => Math.atan2(Math.sin(turn) - Math.cos(turn) / 2, Math.sin(turn) + Math.cos(turn) / 2);
const rowOf = (entry, turn) => ((Math.round(mapHeading(turn) / (TAU / entry.facings)) % entry.facings) + entry.facings) % entry.facings;

function drawFrame(ctx, entry, part, anim, index, row) {
  const [start, count] = part.anims[anim] ?? part.anims.idle;
  const [fw, fh] = part.frame;
  const k = METRE / entry.ppm;
  const col = start + Math.max(0, Math.min(count - 1, index));
  ctx.drawImage(part.img, col * fw, row * fh, fw, fh, -part.anchor[0] * fw * k, -part.anchor[1] * fh * k, fw * k, fh * k);
}

// Where the soldiers of one fireteam stand around its centre, for the code-drawn figures.
const spots = [[0, 0], [-8, -4], [8, 3], [-1, -9]];
const spotsFor = (members) => spots.slice(0, Math.min(members, spots.length)).sort((a, b) => a[1] - b[1]);

// A fireteam on the move is a loose wedge behind its first man; halted or in a firefight
// it is a line abreast, facing the enemy. Slots are (ahead, to the right) in unit pixels.
const wedge = [[9, 0], [-6, -15], [-7, 15], [-22, -4], [-24, 19], [-38, 6]];
const abreast = [[0, 0], [1, -17], [-1, 17], [-16, -9], [-16, 9], [-30, 0]]; // a second rank behind the first three

// formation gives each of `members` soldiers a place around the team's centre, in the same
// pixels the unit is drawn in. `heading` is the map heading the team faces (0 = east,
// clockwise), `go` runs from 0 (halted: line abreast) to 1 (marching: wedge), and `seed`
// makes one team's spacing a little different from the next. Places are sorted far to near.
export function formation(members, heading, go = 0, seed = 0) {
  const n = Math.max(0, Math.min(members, wedge.length));
  const [fx, fy] = [Math.cos(heading), Math.sin(heading)];
  const k = Math.max(0, Math.min(1, go));
  const out = [];
  for (let i = 0; i < n; i++) {
    const ahead = wedge[i][0] * k + abreast[i][0] * (1 - k);
    const right = wedge[i][1] * k + abreast[i][1] * (1 - k);
    // A little raggedness, the same every frame for the same man.
    const jx = Math.sin(seed * 12.9898 + i * 78.233) * 1.6;
    const jy = Math.sin(seed * 39.3467 + i * 11.135) * 1.6;
    const mx = ahead * fx - right * fy + jx;
    const my = ahead * fy + right * fx + jy;
    out.push({ x: (mx - my) * Math.SQRT1_2, y: ((mx + my) / 2) * Math.SQRT1_2, i });
  }
  return out.sort((a, b) => a.y - b.y);
}

// frameAt picks the frame of a looping animation from the distance covered (`stride`, in
// world units) when the caller tracks it, so feet and wheels keep pace with the ground;
// without it, from the clock.
const cycle = (count, per, o, offset = 0) =>
  o.stride === undefined ? null : (((Math.floor((o.stride / per) * count + offset) % count) + count) % count);

// lift raises what flies to its height above its place on the ground, with a slow bob.
// The shadow is drawn before this, so it stays on the ground.
function lift(ctx, entry, o, i = 0) {
  if (o.grounded) return; // a picture of the unit, as on a build button: drawn where it stands
  // `alt` is how far up it is, 0 on the ground to 1: a strike aircraft climbs from its pad.
  const up = o.alt ?? 1;
  if (entry.altitude) ctx.translate(0, (-entry.altitude * METRE + Math.sin(o.time * 2.3 + o.seed + i * 1.9) * 1.2) * up);
}

function animatedInfantry(ctx, entry, o) {
  const down = !entry.altitude && (o.action === "cover" || o.nerve === "pinned");
  const engaged = o.sinceShot < 0.35 || (o.action === "fire" && !o.moving);
  const go = o.go ?? (o.moving ? 1 : 0);
  const file = formation(o.members, mapHeading(engaged ? (o.aim ?? o.turn) : o.turn), engaged ? 0 : go, o.seed);
  const strideLength = entry.stride ?? 26; // world units one walk cycle covers
  for (const { x: ox, y: oy, i } of file) {
    let anim = down ? "cover" : "idle";
    let index = 0;
    let turn = o.turn;
    if (o.pose && entry.anims[o.pose]) {
      // A pose the game asks for by name: a hero planting a charge, an engineer at work.
      anim = o.pose;
      const count = entry.anims[anim][1];
      const walking = /walk$/i.test(anim);
      index = walking ? (cycle(count, strideLength, o, i * 4) ?? Math.floor(o.time * (entry.fps?.[anim] ?? 10)) % count) : Math.floor(o.time * (entry.fps?.[anim] ?? 5)) % count;
      if (o.aim !== undefined && !walking) turn = o.aim;
    } else if (engaged) {
      // One soldier of the team fires each shot; the rest keep their aim.
      const flash = o.sinceShot < 0.09 && (o.shots + i) % file.length === 0;
      turn = o.aim ?? o.turn;
      anim = down ? (flash ? "coverFire" : "cover") : "fire";
      index = flash ? 1 : 0;
    } else if (o.moving) {
      anim = "walk";
      const count = entry.anims.walk[1];
      index = cycle(count, strideLength, o, o.seed * 3 + i * 4) ?? Math.floor(o.time * (entry.fps?.walk ?? 10) + o.seed * 3 + i * 3) % count;
    } else if (go > 0.08 && entry.anims.stop) {
      anim = "stop"; // the last step of a halt
    } else if (entry.anims.idle[1] > 1) {
      index = Math.floor(o.time * (entry.fps?.idle ?? 8) + i) % entry.anims.idle[1]; // rotors keep turning
    }
    ctx.save();
    ctx.translate(ox * (entry.altitude ? 1.5 : 1), oy * (entry.altitude ? 1.5 : 1));
    shadow(ctx, 5.5, 2.6, entry.altitude ? 0.2 : 0.32);
    lift(ctx, entry, o, i);
    drawFrame(ctx, entry, entry, anim, index, rowOf(entry, turn));
    ctx.restore();
  }
}

// wake is the water a boat disturbs: foam round the hull, and behind it two lines that
// lengthen and open with its speed (`go`, 0 to 1).
function wake(ctx, turn, go, time = 0) {
  disc(ctx, "rgba(235,248,255,0.22)", 0, 2, 30, 9);
  if (go <= 0.05) return;
  const [dx, dy] = [Math.cos(turn), Math.sin(turn)];
  const reach = 22 + 34 * go;
  for (const side of [-1, 1]) {
    line(ctx, `rgba(235,248,255,${(0.2 + 0.36 * go).toFixed(2)})`, 1.2 + 0.8 * go, -dx * 20 - dy * side * 5, -dy * 20 + dx * side * 5, -dx * (20 + reach) - dy * side * (6 + 11 * go), -dy * (20 + reach) + dx * side * (6 + 11 * go));
  }
  // Churned water astern, drifting back and fading.
  for (let k = 0; k < 3; k++) {
    const age = (time * 1.4 + k / 3) % 1;
    disc(ctx, `rgba(235,248,255,${(0.3 * go * (1 - age)).toFixed(2)})`, -dx * (22 + reach * age), -dy * (22 + reach * age), 3 + 6 * age, 1.5 + 3 * age);
  }
}

// dust is what a vehicle's wheels or tracks throw up behind it, more of it the faster it goes.
function dust(ctx, turn, go, time, seed) {
  if (go <= 0.08) return;
  const [dx, dy] = [Math.cos(turn), Math.sin(turn)];
  for (let k = 0; k < 4; k++) {
    const age = (time * 1.1 + k / 4 + seed) % 1;
    const back = 20 + 34 * age * (0.5 + 0.5 * go);
    const r = (4 + 10 * age) * (0.6 + 0.4 * go);
    // Paler than any ground it is thrown up from, so it reads on sand as well as on grass.
    disc(ctx, `rgba(236,226,200,${(0.5 * go * (1 - age)).toFixed(2)})`, -dx * back + Math.sin(seed * 7 + k * 2.1) * 3, -dy * back - 3 - 7 * age, r, r * 0.62);
  }
}

function animatedVehicle(ctx, entry, o) {
  const naval = o.cls === "naval";
  const row = rowOf(entry, o.turn);
  const go = o.go ?? (o.moving ? 1 : 0);
  if (naval) wake(ctx, o.turn, go, o.time + o.seed);
  else {
    // What flies casts a fainter shadow the higher it is. A plane's is the shape of a
    // plane, so that the eye ties the machine in the air to its place on the ground.
    if (o.alt !== undefined) planeShadow(ctx, o.turn, 0.34 - 0.12 * o.alt);
    else shadow(ctx, 26, 11, entry.altitude ? 0.22 : 0.32);
    if (!entry.altitude && !o.grounded) dust(ctx, o.turn, go, o.time, o.seed);
  }
  ctx.save();
  // A boat rides the swell; an engine under way shakes its hull; an aircraft hangs in the air.
  if (entry.altitude) lift(ctx, entry, o);
  else ctx.translate(0, naval ? Math.sin(o.time * 2 + o.seed) * 0.8 : go * Math.sin(o.time * 38 + o.seed) * 0.35);
  // Under way it shows its moving frames: tracks and wheels turning with the ground, a
  // boat's bow up, an aircraft nose down or banked into its turn.
  let anim = "idle";
  if ((go > 0.15 || (o.alt ?? 0) > 0.05) && entry.anims.move) anim = "move"; // a plane in the air is never at rest
  if (entry.altitude && go > 0.15 && Math.abs(o.turnRate ?? 0) > 0.7 && entry.anims.bankLeft) anim = o.turnRate < 0 ? "bankLeft" : "bankRight";
  const count = entry.anims[anim][1];
  const spun = Math.floor(o.time * (entry.fps?.[anim] ?? 12)) % count; // rotors turn by the clock
  const index = count < 2 ? 0 : anim === "move" && !entry.altitude ? (cycle(count, naval ? 60 : 9, o) ?? spun) : spun;
  drawFrame(ctx, entry, entry, anim, index, row);
  const top = entry.turret;
  if (!top) return ctx.restore();
  // The weapon sits on its pivot along the hull, and keeps pointing at what it last shot at.
  const heading = (row * TAU) / entry.facings;
  const along = top.pivot * METRE * Math.SQRT1_2;
  ctx.translate((Math.cos(heading) - Math.sin(heading)) * along, ((Math.cos(heading) + Math.sin(heading)) / 2) * along);
  const frame = [0.07, 0.15, 0.25].findIndex((until) => o.sinceShot < until);
  drawFrame(ctx, entry, top, frame < 0 ? "idle" : "fire", frame, rowOf(entry, o.sinceShot < 2.5 ? (o.aim ?? o.turn) : o.turn));
  ctx.restore();
}

// haulerAnim picks the frames a hauler shows: what it is doing, and whether its bed is
// full. `haul` is its working state from the server; `load` the share of its capacity.
export function haulerAnim({ haul, load = 0, moving = false }) {
  if (haul === "loading") return "load";
  if (haul === "unloading") return "unload";
  const full = load >= 0.5;
  if (moving) return full ? "moveFull" : "move";
  return full ? "full" : "idle";
}

// A hauler is one sheet with no weapon: it rolls, loads and unloads.
function animatedHauler(ctx, entry, o) {
  const anim = haulerAnim(o);
  const [, count] = entry.anims[anim] ?? entry.anims.idle;
  shadow(ctx, 28, 12);
  ctx.save();
  if (o.moving) ctx.translate(0, Math.sin(o.time * 34 + o.seed) * 0.35);
  drawFrame(ctx, entry, entry, anim, count > 1 ? Math.floor(o.time * (entry.fps?.[anim] ?? 5) + o.seed) % count : 0, rowOf(entry, o.turn));
  ctx.restore();
}

// hasAnimation reports whether a unit is drawn from an animated sheet.
export const hasAnimation = (unit) => Boolean(sprites.units[unit]?.anims);

// How long what is left of a unit stays on the field, in seconds.
export const casualtySeconds = (unit, cls) => (!hasAnimation(unit) ? 0 : sprites.units[unit].per === "member" ? 7 : cls === "naval" ? 1.8 : 12);

// drawCasualty draws a soldier falling, a burnt-out vehicle or a boat going down. `age`
// is the time since it happened, in seconds.
export function drawCasualty(ctx, { unit, cls, turn, age }) {
  const entry = sprites.units[unit];
  if (!entry?.anims) return;
  const left = casualtySeconds(unit, cls) - age;
  const row = rowOf(entry, turn);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, cls === "naval" ? left * 3 : left / 2));
  if (entry.per === "member") drawFrame(ctx, entry, entry, "die", Math.floor(age * (entry.fps?.die ?? 9)), row);
  else if (cls === "naval") drawFrame(ctx, entry, entry, "sink", Math.floor(age * 2.2), row);
  else {
    shadow(ctx, 26, 11);
    drawFrame(ctx, entry, entry, "wreck", 0, row);
  }
  ctx.restore();
}

// ---- building blocks ----

// isoBox draws a box standing on the ground: w along the east axis, d along the south
// axis, h tall, centred on (cx, cy).
export function isoBox(ctx, cx, cy, w, d, h, top, left, right) {
  const ax = w / 2, ay = w / 4; // half the east edge on screen
  const bx = -d / 2, by = d / 4; // half the south edge on screen
  const S = [cx + ax + bx, cy + ay + by];
  const N = [cx - ax - bx, cy - ay - by];
  const E = [cx + ax - bx, cy + ay - by];
  const W = [cx - ax + bx, cy - ay + by];
  const face = (color, pts) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
  };
  face(left, [W, S, [S[0], S[1] - h], [W[0], W[1] - h]]);
  face(right, [S, E, [E[0], E[1] - h], [S[0], S[1] - h]]);
  face(top, [[W[0], W[1] - h], [S[0], S[1] - h], [E[0], E[1] - h], [N[0], N[1] - h]]);
}

function line(ctx, color, width, ...pts) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 2) (i ? ctx.lineTo(pts[i], pts[i + 1]) : ctx.moveTo(pts[i], pts[i + 1]));
  ctx.stroke();
}

function poly(ctx, color, ...pts) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 2) (i ? ctx.lineTo(pts[i], pts[i + 1]) : ctx.moveTo(pts[i], pts[i + 1]));
  ctx.closePath();
  ctx.fill();
}

function disc(ctx, color, x, y, rx, ry = rx) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
}

// planeShadow is a fuselage and a wing on the ground, lying along the screen heading `turn`.
function planeShadow(ctx, turn, alpha) {
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  for (const [rx, ry, by] of [[30, 5, 0], [7, 26, 0.5]]) {
    ctx.beginPath();
    ctx.ellipse(2, 1, rx, ry, turn, 0, TAU);
    ctx.fill();
    if (by) continue;
  }
}

export function shadow(ctx, rx, ry = rx / 2, alpha = 0.32) {
  disc(ctx, `rgba(0,0,0,${alpha})`, 2, 1, rx, ry);
}

// ---- units ----

const looks = {
  aegis: { cloth: "#62788a", dark: "#2f3b45", head: "#3b4a57", trim: "#cfeef4", skin: "#d8b08a", hull: "#71889a", hullSide: "#4a5b68", hullLow: "#2b353d" },
  ashfall: { cloth: "#ab8b58", dark: "#4b3a27", head: "#c9a23f", trim: "#f1dfb0", skin: "#b98a62", hull: "#b79560", hullSide: "#7d6239", hullLow: "#3a2e22" },
};

function soldier(ctx, look, stride, firing) {
  const swing = Math.sin(stride) * 3;
  line(ctx, look.dark, 2.6, -1.5, -8, -2.5 + swing, 0);
  line(ctx, look.dark, 2.6, 1.5, -8, 2.5 - swing, 0);
  ctx.fillStyle = look.cloth;
  ctx.beginPath();
  ctx.roundRect(-4, -18, 8, 11, 2.5);
  ctx.fill();
  poly(ctx, look.dark, -6, -17, -3.5, -17, -3.5, -10, -6, -11); // pack
  const lift = firing ? -1.5 : 0;
  line(ctx, "#1b1f22", 1.8, -1, -13, 10, -12 + lift); // rifle
  line(ctx, look.cloth, 2.4, 0, -15, 5, -12.5 + lift); // arm
  disc(ctx, look.skin, 0.6, -21, 3.2);
  ctx.fillStyle = look.head;
  ctx.beginPath();
  ctx.arc(0.6, -21.6, 3.6, Math.PI * 0.95, TAU * 1.02);
  ctx.fill();
  line(ctx, look.trim, 1, 1.5, -21.3, 3.6, -21.1); // visor or scarf edge
}

function tank(ctx, look) {
  // Tracks, hull, turret, gun.
  poly(ctx, look.hullLow, -24, -3, -8, 7, 24, -8, 24, -1, -8, 14, -24, 4);
  poly(ctx, look.hullSide, -24, -9, -8, 1, -8, 8, -24, -2);
  poly(ctx, look.hullSide, -8, 1, 24, -14, 24, -7, -8, 8);
  poly(ctx, look.hull, -24, -9, 8, -24, 24, -14, -8, 1);
  for (const [x, y] of [[-3, 9.5], [5, 5.5], [13, 1.5], [20, -2]]) disc(ctx, "#14181b", x, y, 2.6, 2.2);
  poly(ctx, look.hullSide, -10, -15, 0, -9, 0, -5, -10, -11);
  poly(ctx, look.hullLow, 0, -9, 12, -15, 12, -11, 0, -5);
  poly(ctx, look.hull, -10, -15, 2, -21, 12, -15, 0, -9);
  line(ctx, look.hullLow, 3.2, 5, -13, 30, -2);
  line(ctx, look.trim, 1, -6, -16, 0, -19);
}

function technical(ctx, look) {
  for (const [x, y] of [[-12, 6], [12, -6]]) disc(ctx, "#14181b", x, y, 4.2, 3.6);
  poly(ctx, look.hullLow, -22, -2, -6, 6, 22, -8, 22, -4, -6, 10, -22, 2);
  poly(ctx, look.hullSide, -22, -8, -6, 0, -6, 6, -22, -2);
  poly(ctx, look.hullSide, -6, 0, 22, -14, 22, -8, -6, 6);
  poly(ctx, look.hull, -22, -8, 6, -22, 22, -14, -6, 0);
  // Cab at the front, gun on a post in the bed.
  poly(ctx, look.hullSide, 2, -11, 10, -7, 10, -1, 2, -5);
  poly(ctx, "#1f2a33", 10, -13, 20, -18, 20, -13, 10, -8);
  poly(ctx, look.hull, 2, -17, 12, -22, 20, -18, 10, -13);
  poly(ctx, look.hullSide, 2, -17, 10, -13, 10, -7, 2, -11);
  line(ctx, "#1b1f22", 2, -9, -8, -9, -17);
  line(ctx, "#1b1f22", 2.6, -14, -19, 2, -15);
  disc(ctx, look.head, -12, -17, 2.6);
}

function boat(ctx, look, small) {
  const k = small ? 0.8 : 1;
  ctx.save();
  ctx.scale(k, k);
  poly(ctx, look.hullLow, -26, -2, -18, 6, 14, 6, 32, -6, 12, -12, -18, -10);
  poly(ctx, look.hull, -24, -5, -17, 2, 13, 2, 28, -7, 11, -12, -17, -11);
  if (small) {
    line(ctx, "#1b1f22", 2.4, -4, -8, 12, -12);
    disc(ctx, look.head, -6, -11, 2.8);
    poly(ctx, look.hullSide, -22, -9, -17, -6, -17, 0, -22, -3);
  } else {
    poly(ctx, look.hullSide, -10, -12, 2, -8, 2, -1, -10, -5);
    poly(ctx, "#1f2a33", 2, -8, 10, -12, 10, -6, 2, -1);
    poly(ctx, look.trim, -10, -12, -2, -16, 10, -12, 2, -8);
    line(ctx, look.hullLow, 1.4, -2, -14, -2, -26);
    line(ctx, "#1b1f22", 2.6, 14, -9, 26, -11);
  }
  ctx.restore();
}

const unitHeight = { infantry: 26, vehicle: 34, naval: 36, hauler: 36 };

// drawUnit draws one fireteam. `turn` is its direction of travel on screen, `aim` the
// direction of its last shot, `sinceShot` the seconds since then and `shots` their count.
// aircraft is the code-drawn stand-in for anything that flies: a small drone, or a
// helicopter with its rotor turning.
function aircraft(ctx, look, small, time) {
  const k = small ? 0.35 : 1;
  const sweep = Math.cos(time * 30) * 26 * k;
  poly(ctx, look.hull ?? "#7d8f9c", [-24 * k, -3 * k], [14 * k, -6 * k], [22 * k, 0], [12 * k, 5 * k], [-8 * k, 4 * k]);
  if (!small) line(ctx, look.dark ?? "#39454f", 3, -22, -2, -40, -7);
  line(ctx, "rgba(20,24,28,0.75)", small ? 1 : 2, -sweep, -9 * k, sweep, -9 * k);
}

export function drawUnit(ctx, o) {
  const { unit, cls, faction, members, moving, firing, time, turn, seed } = o;
  const entry = sprites.units[unit];
  // A sheet drawn once per member is a squad of small figures, on foot or in the air.
  if (entry?.anims) return (entry.per === "member" ? animatedInfantry : cls === "hauler" ? animatedHauler : animatedVehicle)(ctx, entry, o);
  if (entry) {
    shadow(ctx, cls === "infantry" ? 9 : 20);
    drawSprite(ctx, entry, unitHeight[cls] ?? 28, turn);
    return;
  }
  const look = looks[faction] ?? looks.aegis;
  const flip = Math.cos(turn) < 0 ? -1 : 1;
  if (cls === "hauler") {
    // No sheet for it: a truck, or a tracked crawler for Aegis, with its load in the bed.
    shadow(ctx, 26, 10);
    ctx.save();
    ctx.scale(flip, 1);
    haulerShape(ctx, look, { tracked: faction !== "ashfall", load: o.load ?? 0, moving, time });
    ctx.restore();
    return;
  }
  if (cls === "air") {
    // No sheet for it: a plain machine in the air, with its shadow on the ground below.
    const many = members > 1;
    for (const [ox, oy] of many ? spotsFor(members) : [[0, 0]]) {
      ctx.save();
      ctx.translate(ox * 1.5, oy * 1.5);
      shadow(ctx, many ? 5 : 22, many ? 2.4 : 9, 0.2);
      ctx.translate(0, (many ? -22 : -44) + Math.sin(time * 2.3 + seed + ox) * 1.2);
      ctx.scale(flip, 1);
      aircraft(ctx, look, many, time);
      ctx.restore();
    }
    return;
  }
  if (cls === "infantry") {
    // One figure per soldier, standing in a loose file.
    for (const [i, [ox, oy]] of spotsFor(members).entries()) {
      ctx.save();
      ctx.translate(ox, oy);
      shadow(ctx, 5.5, 2.6);
      ctx.scale(flip, 1);
      soldier(ctx, look, moving ? time * 11 + seed + i * 1.7 : 0, firing);
      ctx.restore();
    }
    return;
  }
  if (cls === "naval") {
    // A boat rides its own bow wave instead of casting a shadow.
    ctx.save();
    ctx.scale(flip, 1);
    if (moving) {
      line(ctx, "rgba(235,248,255,0.55)", 1.6, -22, 4, -44, 0);
      line(ctx, "rgba(235,248,255,0.4)", 1.4, -18, 8, -40, 12);
    }
    disc(ctx, "rgba(235,248,255,0.22)", 2, 3, 28, 7);
    ctx.translate(0, Math.sin(time * 2 + seed) * 0.8);
    boat(ctx, look, faction === "ashfall");
    ctx.restore();
    return;
  }
  shadow(ctx, 24, 9);
  ctx.save();
  ctx.scale(flip, 1);
  (faction === "ashfall" ? technical : tank)(ctx, look);
  ctx.restore();
}

// ---- buildings ----

function pennant(ctx, x, y, color, time, size = 1) {
  const wave = Math.sin(time * 4 + x) * 1.5 * size;
  poly(ctx, color, x, y, x + 13 * size, y + 3 * size + wave, x, y + 8 * size);
}

function hqAegis(ctx, color, time) {
  shadow(ctx, 50, 22, 0.35);
  isoBox(ctx, 0, 0, 78, 78, 9, "#55636d", "#39444c", "#2a3238"); // apron
  isoBox(ctx, -4, -6, 52, 46, 26, "#7b8f9c", "#566673", "#3d4a54");
  isoBox(ctx, 14, -26, 24, 22, 16, "#8ea3b0", "#627482", "#465560");
  line(ctx, "#cfeef4", 1.6, -24, -16, -6, -7); // lit slit windows
  line(ctx, "#cfeef4", 1.6, 0, -6, 18, -15);
  line(ctx, "#2a3238", 2, 16, -50, 16, -72); // mast and dish
  ctx.fillStyle = "#a9bcc7";
  ctx.beginPath();
  ctx.ellipse(16, -74, 9, 5, -0.5, 0, TAU);
  ctx.fill();
  disc(ctx, "#39444c", 16, -74, 2);
  line(ctx, "#2a3238", 1.6, -22, -32, -22, -58);
  pennant(ctx, -22, -58, color, time);
}

function hqAshfall(ctx, color, time) {
  shadow(ctx, 50, 22, 0.35);
  isoBox(ctx, 0, 0, 80, 80, 6, "#8d7550", "#6a5638", "#4c3e29"); // packed earth yard
  isoBox(ctx, -26, 8, 10, 60, 11, "#c0a36d", "#8b744b", "#6b5837"); // sandbag walls
  isoBox(ctx, 10, 26, 60, 10, 11, "#c0a36d", "#8b744b", "#6b5837");
  isoBox(ctx, 6, -8, 40, 34, 18, "#a98b5a", "#7d6239", "#5c482b"); // blockhouse
  poly(ctx, "#6f7a4f", -18, -22, 6, -40, 30, -28, 6, -14); // canvas roof
  poly(ctx, "#59633e", -18, -22, 6, -14, 6, -8, -18, -17);
  poly(ctx, "#1d1a15", -2, -3, 6, -7, 6, 2, -2, 6); // doorway
  line(ctx, "#3a2e22", 2, -30, -12, -30, -52);
  pennant(ctx, -30, -52, color, time);
  isoBox(ctx, 30, 6, 12, 12, 9, "#5c6a45", "#44502f", "#333c23"); // crates
}

function landRig(ctx, color, time) {
  shadow(ctx, 30, 13, 0.3);
  isoBox(ctx, 0, 0, 44, 44, 4, "#6b6f6a", "#4b4f4b", "#373a37");
  // Lattice derrick.
  const apex = [0, -62];
  const feet = [[-14, -2], [0, 5], [14, -2], [0, -9]];
  for (const [x, y] of feet) line(ctx, "#2c3134", 2, x, y, apex[0], apex[1]);
  for (const h of [0.3, 0.55, 0.78]) {
    const ring = feet.map(([x, y]) => [x + (apex[0] - x) * h, y + (apex[1] - y) * h]);
    line(ctx, "#454c50", 1.3, ...ring.flat(), ...ring[0]);
  }
  // Nodding pump beside it.
  const nod = Math.sin(time * 2.2) * 0.22;
  line(ctx, "#2c3134", 2.4, 22, 2, 22, -14);
  ctx.save();
  ctx.translate(22, -14);
  ctx.rotate(nod);
  line(ctx, "#c4a046", 3, -13, 0, 13, 0);
  disc(ctx, "#c4a046", 13, 1, 3.4);
  ctx.restore();
  isoBox(ctx, -22, 6, 12, 12, 10, "#8c8f8a", "#62655f", "#4a4d48");
  pennant(ctx, 0, -72, color, time, 0.9);
  line(ctx, "#2c3134", 1.4, 0, -62, 0, -72);
}

function seaRig(ctx, color, time) {
  disc(ctx, "rgba(235,248,255,0.2)", 0, 8, 40, 14);
  for (const [x, y] of [[-22, 2], [0, 13], [22, 2], [0, -9]]) line(ctx, "#2a3136", 4, x, y, x, y - 22);
  isoBox(ctx, 0, -20, 54, 54, 8, "#7d868c", "#586067", "#40474d");
  isoBox(ctx, -8, -30, 22, 20, 14, "#b8873b", "#8a6429", "#69491d");
  line(ctx, "#2a3136", 2.2, 14, -28, 14, -64); // flare stack
  const flick = 3 + Math.sin(time * 9) * 1.2;
  disc(ctx, "rgba(255,170,60,0.9)", 14, -66 - flick / 2, 2.6, flick);
  line(ctx, "#c4a046", 2.2, -18, -34, -34, -52, -44, -46); // crane
  line(ctx, "#2a3136", 1.4, -8, -44, -8, -58);
  pennant(ctx, -8, -58, color, time, 0.9);
}

function flagPost(ctx, color, time) {
  shadow(ctx, 12, 5, 0.3);
  for (const [x, y] of [[-8, 1], [0, 5], [8, 1]]) disc(ctx, "#8b7a58", x, y, 5, 3);
  line(ctx, "#d8dcd6", 2, 0, 2, 0, -44);
  const wave = Math.sin(time * 4) * 2;
  poly(ctx, color, 0, -44, 20, -40 + wave, 20, -28 + wave, 0, -30);
}

const buildingHeight = { hq_aegis: 96, hq_ashfall: 80, landRig: 84, seaRig: 80, point: 52, gusher: 34 };
buildingHeight.hq_aegis_ruin = buildingHeight.hq_aegis; // a ruin fills the frame of the building it was
buildingHeight.hq_ashfall_ruin = buildingHeight.hq_ashfall;
const drawn = { hq_aegis: hqAegis, hq_ashfall: hqAshfall, landRig, seaRig, point: flagPost, hq_aegis_ruin: (ctx) => rubble(ctx, "#59636b", "#8b97a0"), hq_ashfall_ruin: (ctx) => rubble(ctx, "#6b5a45", "#8a6a4a") };

// rubble is a headquarters after it fell, for when there is no picture of the ruin: broken
// wall stubs around a heap of scorched debris.
function rubble(ctx, wall, light) {
  shadow(ctx, 34, 15, 0.35);
  isoBox(ctx, 0, 6, 56, 44, 3, "#2a2622", "#1d1a17", "#24201c");
  for (const [x, y, w, d, h] of [[-20, -4, 10, 9, 15], [17, -2, 9, 11, 10], [-5, -10, 13, 7, 7], [3, 13, 16, 8, 5], [-17, 12, 8, 8, 8]]) {
    isoBox(ctx, x, y, w, d, h, light, wall, "#33383c");
  }
  ctx.fillStyle = "#1b1815";
  for (const [x, y, r] of [[-3, 3, 9], [9, 6, 6], [-11, 5, 5], [4, -2, 5]]) {
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.55, 0, 0, TAU);
    ctx.fill();
  }
  line(ctx, "#3c4348", 1.6, 10, -4, 24, -22);
  line(ctx, "#3c4348", 1.4, -8, 2, -22, -10);
}

// drawBuilding draws what stands on a map point. `color` is the owner's colour.
export function drawBuilding(ctx, kind, color, time) {
  // The gusher's vent is a landmark that belongs to nobody: no shadow blob, no pennant.
  if (kind === "gusher" && sprites.landmarks.gusher) return drawSprite(ctx, sprites.landmarks.gusher, sprites.landmarks.gusher.height ?? 29, 0);
  const entry = sprites.buildings[kind];
  if (entry) {
    shadow(ctx, 30, 13, 0.3);
    drawSprite(ctx, entry, buildingHeight[kind] ?? entry.height ?? 70, 0);
    if (kind.endsWith("_ruin") || kind === "gusher") return; // nobody flies a flag over a ruin, or owns a gusher
    // A generated building carries no team colour, so it gets a pennant beside it.
    line(ctx, "#d8dcd6", 1.6, -26, 4, -26, -30);
    pennant(ctx, -26, -30, color, time);
    return;
  }
  if (kind === "gusher") return drawVent(ctx);
  drawn[kind]?.(ctx, color, time);
}

// landmarkKey is the picture a landmark of a kind wears: one of the kind's variants,
// chosen by the landmark's id so that it never changes, and its ruin once it has fallen.
export function landmarkKey(kind, id, fallen = false) {
  const options = sprites.variants[kind] ?? [kind];
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  const key = options[h % options.length];
  return fallen ? `${key}_ruin` : key;
}

// drawLandmark draws one of the map's own things (a house, a bunker, a grove, rocks) from
// its painted picture. It returns false when there is none, so the caller draws its own.
export function drawLandmark(ctx, kind, id, fallen = false) {
  const entry = sprites.landmarks[landmarkKey(kind, id, fallen)];
  if (!entry?.img) return false;
  if (kind !== "grove" && kind !== "rocks") shadow(ctx, 26, 11, 0.28);
  drawSprite(ctx, entry, entry.height ?? 46, 0);
  return true;
}

// What decorates open ground, and the pictures it wears: `variants` of these names.
const scatterKinds = { tree: "tree", stone: "stone", peak: "crag" };
const scatterTall = { tree: 30, stone: 13, peak: 40 };

// drawScatter draws one piece of the ground's decoration (see scenery in terrain.js) from
// a painted picture, with its foot on (x, y). Which picture of its kind it wears follows
// from the piece itself, so it never changes. It returns false when there is no picture.
export function drawScatter(g, s, x, y) {
  const options = sprites.variants[scatterKinds[s.kind]];
  if (!options?.length) return false;
  const pick = Math.floor((s.k * 7.13 + (s.tint ? 0.5 : 0) + (s.tone ?? 0)) * options.length) % options.length;
  const entry = sprites.landmarks[options[pick]];
  if (!entry?.img) return false;
  const tall = scatterTall[s.kind] * s.k;
  const k = tall / entry.size[1];
  const [w, anchor] = [entry.size[0] * k, entry.anchor ?? [0.5, 0.9]];
  g.fillStyle = "rgba(0,0,0,0.24)";
  g.beginPath();
  g.ellipse(x + w * 0.08, y + 1, w * 0.42, w * 0.17, 0, 0, TAU);
  g.fill();
  g.drawImage(entry.img, x - anchor[0] * w, y - anchor[1] * tall, w, tall);
  return true;
}

// drawProp draws a flat thing lying on the ground (a patch of gold), `width` screen pixels
// wide, centred on its own anchor. It returns false when there is no picture for it.
export function drawProp(ctx, key, width) {
  const entry = sprites.props[key];
  if (!entry) return false;
  const k = width / entry.size[0];
  ctx.drawImage(entry.img, -entry.anchor[0] * entry.size[0] * k, -entry.anchor[1] * entry.size[1] * k, entry.size[0] * k, entry.size[1] * k);
  return true;
}

// drawSegment draws one piece of a wall, fence or bridge run. The context sits on the
// piece's middle with one unit being one map unit on screen; `length` is how much of the
// run this piece stands for. It returns false when the run has no picture on that axis.
export function drawSegment(ctx, id, axis, length, state = "") {
  const seg = sprites.segments[id];
  const node = state ? seg?.[state]?.[axis] : seg?.[axis];
  if (!node?.img) return false;
  const k = seg.scale * (length / seg.length);
  ctx.drawImage(node.img, -node.anchor[0] * node.size[0] * k, -node.anchor[1] * node.size[1] * k, node.size[0] * k, node.size[1] * k);
  return true;
}

// ---- structures under construction, their doors, and what comes out of them ----

// stageOf picks which construction picture shows at `progress` (0 just begun, 1 finished)
// when there are `count` pictures before the finished one. It returns `count` for the
// finished building.
export const stageOf = (count, progress) => (progress >= 1 ? count : Math.max(0, Math.min(count - 1, Math.floor(progress * count))));

// doorAt says what a structure's door shows while a unit comes out of it, `t` running
// from 0 (the order to deploy) to 1 (the unit at its rally point): the light comes on,
// the door stands open while the unit passes, and it closes behind it.
export const doorAt = (t) => (t < 0 || t >= 1 ? "closed" : t < 0.12 ? "lit" : t < 0.86 ? "open" : "lit");

// structurePoint gives one of a structure's named points ("exit", "rally") as an offset
// in pixels from where the structure stands, for a structure drawn `height` pixels tall.
// The points are kept in the manifest as fractions of the picture.
export function structurePoint(entry, name, height = entry.height) {
  const at = entry?.door?.[name];
  if (!at) return null;
  const k = height / entry.size[1];
  const [ax, ay] = entry.anchor ?? [0.5, 0.8];
  return [(at[0] - ax) * entry.size[0] * k, (at[1] - ay) * entry.size[1] * k];
}

// emergence is where a unit leaving its structure is at `t` (0 to 1), as an offset in
// pixels from where the structure stands, how much of it shows (`alpha`) and how large to
// draw it (`scale`): it starts inside the doorway, hidden and small, and comes out to the
// rally point at full size.
export function emergence(entry, t, height = entry.height) {
  const from = structurePoint(entry, "exit", height);
  const to = structurePoint(entry, "rally", height) ?? from;
  if (!from) return null;
  const k = Math.max(0, Math.min(1, (t - 0.12) / 0.74)); // it moves while the door is open
  const eased = k * k * (3 - 2 * k);
  // Units are drawn larger than the buildings they come from, so one starts small in the
  // doorway and grows to its full size as it clears it (`scale`).
  return { x: from[0] + (to[0] - from[0]) * eased, y: from[1] + (to[1] - from[1]) * eased, alpha: Math.min(1, k * 4), scale: 0.55 + 0.45 * eased, turn: Math.atan2(to[1] - from[1], to[0] - from[0]) };
}

// drawStructurePicture draws a base structure or defence from its pictures: `progress` under 1
// shows it going up in stages, and `door` ("open" or "lit") lays the door patch over the
// finished building. It returns false when there is no picture for `kind`, so the caller
// can draw its own stand-in.
//
// A finished structure may also be given:
//   powered  false when its side is on low power: the picture goes dark, whatever turns on
//            it stands still, and a warning lamp blinks on it
//   time     seconds, for the part that turns and for the lamp
//   owner    a colour, for a building of no army that has a flagstaff (`flag` in the
//            manifest): the flag of whoever holds it; none when nobody does
export function drawStructurePicture(ctx, kind, { progress = 1, door = "closed", ruin = false, powered = true, time = 0, owner = null } = {}) {
  const base = sprites.buildings[kind];
  if (!base) return false;
  const height = base.height ?? 70;
  const stages = base.stages ?? [];
  const stage = stageOf(stages.length, progress);
  const done = !ruin && stage >= stages.length;
  // A building whose top turns is painted once more without that top (`spin.body`), and the
  // turning part is drawn over that; without the part's sheet the whole painting is used.
  const body = (base.spin?.body && sprites.props[base.spin.prop]?.img && sprites.buildings[base.spin.body]) || base;
  const entry = (ruin ? sprites.buildings[`${kind}_ruin`] : stage < stages.length ? sprites.buildings[stages[stage]] : body) ?? base;
  const dark = done && !powered;
  shadow(ctx, 30, 13, 0.3);
  drawSprite(ctx, dark ? dimmed(entry) : entry, height, 0);
  const patch = done && base.door?.frames?.[door];
  if (patch?.img) {
    const [x, y] = structureSpot(base, [patch.at[0] / base.size[0], patch.at[1] / base.size[1]], height);
    const k = height / base.size[1];
    ctx.drawImage(patch.img, x, y, patch.size[0] * k, patch.size[1] * k);
  }
  if (done && base.spin) drawSpin(ctx, base, height, powered ? time : 0, dark);
  if (dark) drawLamp(ctx, base, height, time);
  if (!ruin && owner && base.flag) {
    const [x, y] = structureSpot(base, base.flag, height);
    line(ctx, "#2b2f33", 1.4, x, y, x, y - 15);
    pennant(ctx, x, y - 15, owner, time, 0.8);
  }
  return true;
}

// structureSpot turns a place given as fractions of a building's picture into pixels from
// the point the building stands on, at the height it is drawn.
export function structureSpot(base, [fx, fy], height = base.height ?? 70) {
  const k = height / base.size[1];
  const [ax, ay] = base.anchor ?? [0.5, 0.8];
  return [(fx - ax) * base.size[0] * k, (fy - ay) * base.size[1] * k];
}

// spinFrame is which picture of a turning part to show: one turn every `period` seconds.
export const spinFrame = (frames, period, time) => ((Math.floor((time / period) * frames) % frames) + frames) % frames;

// drawSpin draws the part of a structure that turns (a radar's dish) over its picture:
// `base.spin` names the prop sheet, where on the building its mount sits, how tall it is
// drawn and how long one turn takes. At time 0 it stands still on its first picture.
function drawSpin(ctx, base, height, time, dark) {
  const { prop, at, height: tall, period = 6 } = base.spin;
  const part = sprites.props[prop];
  if (!part?.img) return;
  const [fw, fh] = part.frame;
  const k = (tall * (height / (base.height ?? height))) / fh;
  const [x, y] = structureSpot(base, at, height);
  const frame = spinFrame(part.frames, period, time);
  const img = dark ? dimmed(part).img : part.img;
  ctx.drawImage(img, frame * fw, 0, fw, fh, x - part.anchor[0] * fw * k, y - part.anchor[1] * fh * k, fw * k, fh * k);
}

// lampOn says whether a dark structure's warning lamp is lit at `time`: two short blinks,
// then a pause, so a row of dark buildings does not look like a string of fairy lights.
export const lampOn = (time) => {
  const t = ((time % 1.6) + 1.6) % 1.6;
  return t < 0.14 || (t > 0.3 && t < 0.44);
};

function drawLamp(ctx, base, height, time) {
  const [x, y] = structureSpot(base, base.lamp ?? [0.5, 0.18], height);
  disc(ctx, "#2a1c12", x, y, 2.2);
  if (!lampOn(time)) return;
  disc(ctx, "rgba(255,150,40,0.35)", x, y, 6);
  disc(ctx, "#ffb347", x, y, 2);
}

// dimmed gives a sprite's entry with its picture darkened, as a structure looks with the
// power down. The dark copy is made once and kept. Where there is no canvas to make it on
// (a test), the entry comes back as it is.
const darkened = new WeakMap();
function dimmed(entry) {
  const img = entry.img;
  if (!img || typeof document === "undefined") return entry;
  if (!darkened.has(img)) {
    const copy = document.createElement("canvas");
    copy.width = img.width;
    copy.height = img.height;
    const g = copy.getContext("2d");
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = "source-atop"; // only where the picture is, never its empty corners
    g.fillStyle = "rgba(10,14,30,0.52)";
    g.fillRect(0, 0, copy.width, copy.height);
    darkened.set(img, copy);
  }
  return { ...entry, img: darkened.get(img) };
}

// drawDoor lays a structure's door patch ("open" or "lit") over the building drawBuilding
// drew, at the same size. It returns false when the structure has no such picture.
export function drawDoor(ctx, kind, door) {
  const base = sprites.buildings[kind];
  const patch = base?.door?.frames?.[door];
  if (!patch?.img) return false;
  const k = (buildingHeight[kind] ?? base.height ?? 70) / base.size[1];
  const [ax, ay] = base.anchor ?? [0.5, 0.8];
  ctx.drawImage(patch.img, (patch.at[0] - ax * base.size[0]) * k, (patch.at[1] - ay * base.size[1]) * k, patch.size[0] * k, patch.size[1] * k);
  return true;
}

// drawSandbags draws a sandbag position facing `turn` (a direction on screen, as for a
// unit). `state` is "whole", "damaged" or "flat".
export function drawSandbags(ctx, turn, state = "whole") {
  const entry = sprites.landmarks.sandbags;
  if (!entry?.img) {
    // No picture: a low arc of bags drawn in place.
    for (let i = -2; i <= 2; i++) {
      const a = turn + i * 0.45;
      disc(ctx, i % 2 ? "#a8946b" : "#b9a57a", Math.cos(a) * 20, Math.sin(a) * 10 - 2, 5, 3);
    }
    return;
  }
  const [fw, fh] = entry.frame;
  const k = METRE / entry.ppm;
  const col = Math.max(0, entry.states.indexOf(state));
  ctx.drawImage(entry.img, col * fw, rowOf(entry, turn) * fh, fw, fh, -entry.anchor[0] * fw * k, -entry.anchor[1] * fh * k, fw * k, fh * k);
}

// ---- ground props (baked into the terrain once) ----

export function tree(ctx, x, y, k, tint) {
  disc(ctx, "rgba(0,0,0,0.25)", x + 4, y + 2, 9 * k, 4 * k);
  line(ctx, "#3a2c1c", 2.4 * k, x, y, x, y - 9 * k);
  disc(ctx, tint ? "#3d5a35" : "#35502f", x, y - 15 * k, 9 * k, 8 * k);
  disc(ctx, tint ? "#557a45" : "#4a6b3d", x - 2 * k, y - 18 * k, 6 * k, 5 * k);
}

export function house(ctx, x, y, w, d, roof) {
  disc(ctx, "rgba(0,0,0,0.25)", x + 6, y + 4, w * 0.8, w * 0.32);
  isoBox(ctx, x, y, w, d, 13, "#b9ae98", "#8f8572", "#6f6757");
  isoBox(ctx, x, y - 13, w + 3, d + 3, 5, roof, "#6e3d2d", "#55301f");
}

export function rock(ctx, x, y, k) {
  disc(ctx, "rgba(0,0,0,0.22)", x + 3, y + 2, 8 * k, 3.5 * k);
  poly(ctx, "#6d6a62", x - 8 * k, y, x - 3 * k, y - 8 * k, x + 5 * k, y - 6 * k, x + 8 * k, y);
  poly(ctx, "#8b887e", x - 3 * k, y - 8 * k, x + 5 * k, y - 6 * k, x + 1 * k, y - 2 * k);
}

// drawPoweredStructure draws a side's structure from its picture with the side's pennant
// beside it, as drawBuilding does, and also what power changes: unpowered it stands dark
// with its warning lamp, and whatever turns on it (a radar's dish) turns only with power.
// It returns false when there is no picture for `kind`.
export function drawPoweredStructure(ctx, kind, color, time, powered = true) {
  if (!drawStructurePicture(ctx, kind, { powered, time })) return false;
  line(ctx, "#d8dcd6", 1.6, -26, 4, -26, -30);
  pennant(ctx, -26, -30, color, time);
  return true;
}
