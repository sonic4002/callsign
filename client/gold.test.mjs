// The page's reading of the gold economy: which haulers it draws as units, which it
// lists, what a field looks like at a given fill, and when gold has just come home.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { fieldShare, flecks, ghosts, gusherAt, gusherOfPoint, haulerGroups, haulerRows, pickGusher, reach, unloaded } from "./gold.js";

const rules = JSON.parse(readFileSync(new URL("../shared/rules.json", import.meta.url)));
rules.map ??= rules.maps.small; // the default map, as the server sends it to a page
const name = (n) => ({ en: `Hauler ${n}`, he: `מוביל ${n}` });
const hauler = (id, side, extra = {}) => ({ id, side, callsign: name(id - 1000), unit: side ? "dumpTruck" : "crawler", state: "out", load: 0, field: "B", hp: 1, x: 300, y: 300, visible: true, ...extra });

test("own haulers are drawn as units, enemy ones only as ghosts when out of sight", () => {
  const state = { side: 0, haulers: [hauler(1001, 0), hauler(1002, 1, { visible: false }), hauler(1003, 1)] };
  const groups = haulerGroups(state);
  assert.deepEqual(groups.map((g) => [g.id, g.class, g.own, g.teams[0].action]), [[1001, "hauler", true, "advance"]]);
  assert.equal(haulerGroups({ side: 0, haulers: [hauler(1001, 0, { state: "loading" })] })[0].teams[0].action, "idle");
  // The one in sight comes as a contact; the one that got away is remembered.
  assert.deepEqual(ghosts(state).map((h) => h.id), [1002]);
  // A spectator sees everybody's, and remembers nothing.
  const all = { side: -1, haulers: [hauler(1001, 0), hauler(1003, 1)] };
  assert.equal(haulerGroups(all).length, 2);
  assert.deepEqual(ghosts(all), []);
  assert.deepEqual(haulerGroups({ side: 0 }), []);
});

test("the sidebar lists own haulers with the point of the field they work", () => {
  const state = { haulers: [hauler(1001, 0, { state: "loading", load: 0.5, field: "F" }), hauler(1002, 0, { state: "waiting", field: "" }), hauler(1003, 1)] };
  assert.deepEqual(
    haulerRows(state, rules, 0).map((r) => [r.id, r.state, r.point, r.load]),
    [
      [1001, "haul.loading", "F", 0.5],
      [1002, "haul.waiting", null, 0],
    ],
  );
});

test("a field shrinks as it is emptied but never vanishes, and scatters the same nuggets every time", () => {
  const g = rules.map.gushers[0];
  assert.equal(reach(g, 1), g.fieldRadius);
  assert.ok(reach(g, 0) > 0 && reach(g, 0) < reach(g, 0.5) && reach(g, 0.5) < reach(g, 1));
  assert.equal(reach(g, 7), g.fieldRadius, "a share past 1 is clamped");
  assert.equal(fieldShare({ fields: [{ gusher: "B", gold: 0.4 }] }, "B"), 0.4);
  assert.equal(fieldShare({}, "B"), 0);
  const a = flecks("B");
  assert.equal(a, flecks("B"));
  assert.notDeepEqual(a.slice(0, 3), flecks("K").slice(0, 3));
  assert.ok(a.every(([x, y]) => Math.hypot(x, y) <= 1));
  assert.ok(Math.hypot(a[0][0], a[0][1]) <= Math.hypot(a.at(-1)[0], a.at(-1)[1]), "inner nuggets come first");
});

test("gushers are found by the point they stand on, by the point they are named after, and under a tap", () => {
  const b = rules.map.points.find((p) => p.id === "B");
  const f = rules.map.points.find((p) => p.id === "F");
  assert.equal(gusherAt(rules, b)?.id, "B");
  assert.equal(gusherAt(rules, f)?.id, "F", "the rich field stands on the town island");
  // On the bigger maps each side's home field lies off the point it is named after.
  const medium = { ...rules, map: rules.maps.medium };
  assert.equal(gusherAt(medium, medium.map.points.find((p) => p.id === "A")), null);
  assert.equal(gusherOfPoint(medium, "A")?.id, "A");
  assert.equal(gusherOfPoint(rules, "F")?.id, "F");
  assert.equal(gusherOfPoint(rules, "G"), null);
  const mid = rules.map.gushers.find((g) => g.id === "F");
  assert.equal(pickGusher(rules, mid.x + 20, mid.y - 10)?.id, "F");
  assert.equal(pickGusher(rules, mid.x + mid.fieldRadius, mid.y), null);
  for (const g of rules.map.gushers) assert.ok(rules.map.points.some((p) => p.id === g.point), `gusher ${g.id} is named after a real point`);
});

test("gold has come home when a hauler stops unloading with an empty bed", () => {
  const before = { haulers: [hauler(1001, 0, { state: "unloading", load: 0.9 }), hauler(1002, 0, { state: "loading", load: 0.3 }), hauler(1003, 1, { state: "unloading", load: 1 })] };
  const after = { haulers: [hauler(1001, 0, { state: "out", load: 0 }), hauler(1002, 0, { state: "returning", load: 1 }), hauler(1003, 1, { state: "out", load: 0 })] };
  assert.deepEqual(unloaded(before, after, 0).map((h) => h.id), [1001]);
  assert.deepEqual(unloaded(null, after, 0), []);
  assert.deepEqual(unloaded(before, before, 0), []);
});

test("every hauler in the rules can be drawn and bought", () => {
  for (const [faction, f] of Object.entries(rules.factions)) {
    const haulers = Object.entries(f.units).filter(([, u]) => u.class === "hauler");
    assert.equal(haulers.length, 1, `${faction} has one hauler`);
    const [, u] = haulers[0];
    assert.ok(u.capacity > 0 && u.loadSeconds > 0 && u.unloadSeconds > 0 && u.name.en && u.name.he);
    assert.ok(u.cost / rules.match.hqTrickle <= 90, "the trickle rebuilds a hauler within ninety seconds");
  }
});
