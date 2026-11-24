// Placing structures as the page works it out: the tint against the server's own table,
// the spot under the pointer and the words that say it, and what a unit's button shows of
// its production line.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { canPlace, lines, parseSpot, spotAt, spotForm, spotWords, terrainAt, tint, tintKey, unitLine } from "./placement.js";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const rules = read("../shared/rules.json");
rules.map = rules.maps.small;
const table = read("./testdata/placement-small.json");
const strings = { en: read("./i18n/en.json"), he: read("./i18n/he.json") };
const tr = (lang) => (key, vars = {}) => strings[lang][key].replace(/\{(\w+)\}/g, (_, k) => vars[k]);
const defOf = (kind) => Object.values(rules.factions).map((f) => f.structures[kind]).find(Boolean);

test("the page tints exactly the ground the server accepts", () => {
  // The table was written by the server's rule (server/sim/placement_test.go) for a match
  // with a gun at a held point and a fence at home. One difference anywhere fails.
  const state = { structures: table.structures, points: table.points };
  assert.ok(table.rows.length >= 6);
  for (const row of table.rows) {
    const def = defOf(row.kind);
    let i = 0;
    let ok = 0;
    for (let y = table.step / 2; y < rules.map.height; y += table.step) {
      for (let x = table.step / 2; x < rules.map.width; x += table.step) {
        const mine = canPlace(rules, state, row.side, def, x, y) === "";
        assert.equal(mine, row.ok[i] === "1", `${row.kind} for side ${row.side} at (${x}, ${y}): the page says ${mine}, the server ${row.ok[i]}`);
        ok += mine;
        i++;
      }
    }
    assert.equal(i, row.ok.length);
    assert.ok(ok > 0, `${row.kind} has ground somewhere`);
  }
});

test("why a spot is refused", () => {
  const state = { structures: table.structures, points: table.points };
  const works = defOf("vehicleWorks");
  const hq = rules.map.points.find((p) => p.id === "A");
  assert.equal(canPlace(rules, state, 0, works, 800, 520), "far");
  assert.equal(canPlace(rules, state, 0, works, hq.x + 30, hq.y), "room");
  assert.equal(canPlace(rules, state, 0, works, 5, hq.y), "edge");
  const barracks = table.structures.find((s) => s.side === 0 && s.role === "barracks");
  assert.equal(canPlace(rules, state, 0, works, barracks.x + 10, barracks.y), "room");
  // Water, ice and mountains are never built on.
  for (let y = 20; y < rules.map.height; y += 40) {
    for (let x = 20; x < rules.map.width; x += 40) {
      if (terrainAt(rules.map, x, y) !== "L") assert.notEqual(canPlace(rules, state, 0, works, x, y), "", `(${x}, ${y})`);
    }
  }
  // A ruin is built over; a structure still going up does not extend the base.
  const far = { ...barracks, id: "s99", x: hq.x + 280, y: hq.y - 200 };
  const beyond = [hq.x + 400, hq.y - 250];
  const reach = (extra) => canPlace(rules, { ...state, structures: [...table.structures, extra] }, 0, works, ...beyond);
  assert.equal(reach({ ...far, building: 0.5 }), "far");
  assert.notEqual(reach({ ...far, building: 1 }), "far");
});

test("the tint lists the ground near the base, green where the structure fits", () => {
  const state = { structures: table.structures, points: table.points };
  const cells = tint(rules, state, 0, defOf("vehicleWorks"), 20);
  assert.ok(cells.some((c) => c.ok) && cells.some((c) => !c.ok));
  for (const c of cells) assert.ok(Math.hypot(c.x - 150, c.y - 480) <= rules.match.baseRadius + rules.match.baseReach + 400, "no tint far from the base");
  assert.equal(cells.filter((c) => c.ok).every((c) => canPlace(rules, state, 0, defOf("vehicleWorks"), c.x, c.y) === ""), true);
  // The tint is worked out again when a structure is finished or falls, not every frame.
  const key = tintKey(state, 0, "vehicleWorks");
  assert.equal(tintKey({ ...state }, 0, "vehicleWorks"), key);
  assert.notEqual(tintKey({ ...state, structures: table.structures.slice(1) }, 0, "vehicleWorks"), key);
  assert.notEqual(tintKey(state, 0, "airbase"), key);
});

test("a spot is said as metres each way from the nearest point, in both languages", () => {
  const spot = spotAt(rules, 213, 338); // nearest point is Alpha (150, 480)
  assert.deepEqual(spot, { point: "A", east: 60, south: -140, x: 210, y: 340 });
  assert.equal(spotForm(spot), "N140 E60 of A");
  assert.deepEqual(parseSpot(rules, "N140 E60 of A"), spot);
  assert.equal(parseSpot(rules, "N of A 100"), null);
  assert.equal(spotWords(tr("en"), spot, "Alpha"), "140 metres north and 60 metres east of Alpha");
  assert.equal(spotWords(tr("he"), spot, "אלף"), "140 מטר צפונית ו-60 מטר מזרחית לאלף");
  const sw = spotAt(rules, 430, 712); // Delta (450, 690)
  assert.equal(spotForm(sw), "S20 W20 of D");
  assert.equal(spotWords(tr("en"), sw, "Delta"), "20 metres south and 20 metres west of Delta");
  // Right on a point: still both distances, so it reads as an exact spot.
  assert.equal(spotWords(tr("en"), spotAt(rules, 800, 520), "Foxtrot"), "0 metres north and 0 metres east of Foxtrot");
  assert.equal(strings.en["call.buildSpot"].replace("{to}", "Anvil").replace("{from}", "Hammer").replace("{structure}", "Vehicle Works").replace("{place}", spotWords(tr("en"), spot, "Alpha")),
    "Anvil, this is Hammer. Build a Vehicle Works 140 metres north and 60 metres east of Alpha. Over.");
});

test("a unit's button shows its line: how many, and the first one's wait", () => {
  const d = (id, unit, from, line, ticksLeft, ticksAhead) => ({ id, side: 0, unit, from, line, ticksLeft, ticksTotal: 70, ticksAhead });
  const state = {
    deploying: [d(5, "tank", "s4", 0, 30, 0), d(6, "tank", "s4", 1, 70, 30), d(7, "rocketLauncher", "s4", 2, 70, 100), d(8, "commandos", "s2", 0, 12, 0), { ...d(9, "tank", "s9", 0, 5, 0), side: 1 }],
  };
  assert.deepEqual(unitLine(state, 0, "tank"), { count: 2, first: state.deploying[0], ticks: 30, making: true });
  const rockets = unitLine(state, 0, "rocketLauncher");
  assert.deepEqual([rockets.count, rockets.ticks, rockets.making], [1, 170, false]);
  assert.deepEqual(unitLine(state, 0, "helicopter"), { count: 0, first: null, ticks: 0, making: false });
  const all = lines(state, 0);
  assert.deepEqual([...all.keys()], ["s4", "s2"]);
  assert.deepEqual(all.get("s4").map((x) => x.id), [5, 6, 7]);
});
