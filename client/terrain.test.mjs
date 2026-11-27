// The ground as the page reads and draws it, and the lobby's small decisions.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { clearOf, matchLengths, ordersFor, parseOffset, seatState, startGold } from "./places.js";
import { coverPercent, deckOf, drawBridge, drawMiniMap, drawScenery, isWater, landmarkFallbacks, onDeck, paintGround, placeAt, scenery, terrainAt, terrainColors } from "./terrain.js";

const rules = JSON.parse(readFileSync(new URL("../shared/rules.json", import.meta.url), "utf8"));
rules.map ??= rules.maps.small; // the default map, as the server sends it to a page
const on = (id) => ({ ...rules, map: rules.maps[id] });

// A canvas context that accepts every call and counts them, so drawing code can run here.
function fakeContext() {
  const calls = {};
  const ctx = new Proxy(
    {},
    {
      get: (_, name) => (name === "calls" ? calls : (...args) => ((calls[name] = (calls[name] ?? 0) + 1), args)),
      set: () => true,
    },
  );
  return ctx;
}

// A small seeded generator, as the page uses for its scenery.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

test("every landmark and terrain kind in the rules can be drawn without a painted picture", () => {
  for (const kind of Object.keys(rules.landmarkKinds)) {
    assert.equal(typeof landmarkFallbacks[kind], "function", `no fallback drawing for landmark kind "${kind}"`);
    const g = fakeContext();
    landmarkFallbacks[kind](g, 0);
    assert.ok(g.calls.fill > 0, `${kind} draws nothing`);
  }
  for (const kind of Object.keys(rules.terrainKinds)) {
    assert.match(terrainColors[kind]?.fill ?? "", /^#/, `no colour for terrain "${kind}"`);
    assert.match(terrainColors[kind]?.radar ?? "", /^#/, `no radar colour for terrain "${kind}"`);
  }
  // Every landmark on every map is of a kind the rules know.
  for (const [id, map] of Object.entries(rules.maps)) {
    for (const l of map.landmarks) assert.ok(rules.landmarkKinds[l.kind], `${id}: ${l.id} has unknown kind ${l.kind}`);
  }
});

test("the terrain grid is read by position, and water under a standing bridge is no water", () => {
  const map = rules.maps.small;
  assert.equal(terrainAt(map, 200, 600), "L");
  assert.equal(terrainAt(map, 1400, 1650), "W");
  assert.equal(terrainAt(map, 1400, 340), "I");
  assert.equal(terrainAt(map, 1100, 40), "M");
  assert.equal(terrainAt(map, -5, 100), "M", "off the map counts as mountain");
  assert.equal(terrainAt(map, 100, map.height + 1), "M");

  const south = map.bridges.find((b) => b.id === "bridge-south");
  assert.ok(onDeck(south, 1400, 1360) && onDeck(south, 1330, 1390));
  assert.ok(!onDeck(south, 1400, 1410) && !onDeck(south, 1300, 1360));
  assert.equal(deckOf(south).length, 4);
  assert.equal(isWater(rules, 1400, 1650), true);
  assert.equal(isWater(rules, 200, 600), false);
  assert.equal(isWater(rules, 1400, 340), false, "ice is not water");
  assert.equal(isWater(rules, 1400, 1360), false, "a shell on a standing bridge hits the deck");
  assert.equal(isWater(rules, 1400, 1360, () => false), true, "a fallen bridge is water again");
});

test("a tap finds the landmark or bridge under it", () => {
  const map = rules.maps.small;
  assert.equal(placeAt(map, 902, 1240).landmark?.id, "D-bunker-1");
  assert.equal(placeAt(map, 1400, 1365).bridge?.id, "bridge-south");
  assert.deepEqual(placeAt(map, 200, 600), {});
  // The nearest of two close landmarks wins.
  const [a, b] = [map.landmarks.find((l) => l.id === "F-house-1"), map.landmarks.find((l) => l.id === "F-rocks-1")];
  assert.equal(placeAt(map, a.x + 4, a.y, 80).landmark.id, a.id);
  assert.equal(placeAt(map, b.x - 4, b.y, 80).landmark.id, b.id);
  assert.equal(coverPercent(0.65), 35);
  assert.equal(coverPercent(0.3), 70);
  assert.equal(coverPercent(1), 0);
  assert.equal(coverPercent(0), 0);
  assert.equal(coverPercent(undefined), 0);
});

test("the ground, the scenery, the bridges and the small map draw on every map", () => {
  for (const id of Object.keys(rules.maps)) {
    const r = on(id);
    const g = fakeContext();
    paintGround(g, r, rng(1));
    assert.ok(g.calls.fill > 100, `${id}: the ground is not painted`);
    const things = scenery(r, rng(1));
    assert.ok(things.some((s) => s.kind === "peak") && things.some((s) => s.kind === "tree"), `${id}: no peaks or trees`);
    for (const s of things) {
      assert.ok(s.kind === "peak" ? terrainAt(r.map, s.x, s.y) === "M" : terrainAt(r.map, s.x, s.y) === "L", `${id}: a ${s.kind} stands on the wrong ground`);
      if (s.kind !== "peak") assert.ok(r.map.points.every((p) => Math.hypot(p.x - s.x, p.y - s.y) >= 110), `${id}: scenery on a point`);
    }
    for (let i = 1; i < things.length; i++) assert.ok(things[i - 1].x + things[i - 1].y <= things[i].x + things[i].y, "far to near");
    drawScenery(g, things[0], 0, 0);
    for (const b of r.map.bridges) {
      for (const state of [undefined, { hp: 1, standing: true }, { hp: 0.2, standing: true }, { hp: 0, standing: false }]) {
        const d = fakeContext();
        drawBridge(d, b, (x, y) => [x, y], 1, state);
        assert.ok(d.calls.fill > 0);
      }
    }
    const mini = fakeContext();
    drawMiniMap(mini, r, r.map, 160, 100, { points: true });
    assert.ok(mini.calls.fillRect >= (r.map.width / r.map.cell) * (r.map.height / r.map.cell), `${id}: the small map misses cells`);
    assert.ok(mini.calls.stroke >= r.map.bridges.length);
  }
});

test("places, seats and the lobby's gold and length choices", () => {
  assert.deepEqual(parseOffset("NE of D 150"), { bearing: "NE", point: "D", metres: 150 });
  assert.deepEqual(parseOffset("N of F 120"), { bearing: "N", point: "F", metres: 120 });
  for (const other of ["F", "F-house-1", "bridge-south", "north of F", "", undefined]) assert.equal(parseOffset(other), null);

  assert.deepEqual(ordersFor("landmark"), ["hold", "move", "cover"]);
  assert.deepEqual(ordersFor("bridge"), ["hold", "move", "attack"]);
  assert.deepEqual(ordersFor("point"), ["hold", "move", "attack"]);

  assert.equal(seatState({ bot: true, taken: false }), "bot");
  assert.equal(seatState({ taken: false }), "empty");
  assert.equal(seatState({ taken: true, online: false, ready: true }), "offline");
  assert.equal(seatState({ taken: true, online: true, ready: false }), "taken");
  assert.equal(seatState({ taken: true, online: true, ready: true }), "ready");

  assert.equal(startGold("2500", ""), 2500);
  assert.equal(startGold("other", "1750"), 1750);
  assert.equal(startGold("other", "5"), 100, "held to the least a match may start with");
  assert.equal(startGold("other", "999999"), 20000);
  assert.equal(startGold("other", "999999", { min: 100, max: 5000 }), 5000);
  assert.equal(startGold("other", "plenty"), 0, "nonsense leaves the server's default");
  assert.equal(startGold("other", ""), 0);

  assert.deepEqual(matchLengths(600), [300, 600, 900, 1200, 1500, 1800]);
  assert.deepEqual(matchLengths(420), [300, 420, 600, 900, 1200, 1500, 1800]);
});

test("a name on the map moves out of the way of the names already written", () => {
  const point = [[100, 50, 80, 20], [110, 72, 60, 18]]; // a point's name and the line under it
  assert.equal(clearOf(point, 400, 60, 90, 18), 0, "nothing near: it stays");
  const dy = clearOf(point, 140, 60, 90, 18);
  assert.notEqual(dy, 0);
  const [x, y, w, h] = [140, 60 + dy, 90, 18];
  for (const [px, py, pw, ph] of point) assert.ok(!(x - w / 2 < px + pw && x + w / 2 > px && y - h / 2 < py + ph && y + h / 2 > py), "clear of both");
  assert.ok(Math.abs(dy) <= 40, "and no farther than it must");
});
