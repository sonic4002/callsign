// Power, the radar, selling and repairing as the page works them out from a snapshot.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { structureCards } from "./bases.js";
import { powerFigure, powerOf, radarState, repairCost, sellValue, siegeReach, structureActions, wouldRunShort } from "./power.js";

const rules = JSON.parse(readFileSync(new URL("../shared/rules.json", import.meta.url), "utf8"));
const aegis = rules.factions.aegis.structures;

test("the sidebar's power line: supply against use, and when it is low", () => {
  assert.equal(powerOf({}), null);
  assert.deepEqual(powerOf({ power: { supply: 130, use: 65, low: false } }), { supply: 130, use: 65, low: false, share: 0.5 });
  assert.equal(powerOf({ power: { supply: 30, use: 45, low: true } }).share, 1);
});

test("a build button says what the structure does to power, and warns when it would run short", () => {
  assert.equal(powerFigure(aegis.powerPlant), `+${aegis.powerPlant.power}`);
  assert.equal(powerFigure(aegis.radar), `−${-aegis.radar.power}`);
  assert.equal(powerFigure({}), "");
  const state = { power: { supply: 30, use: 25, low: false } };
  assert.equal(wouldRunShort(state, aegis.vehicleWorks), true);
  assert.equal(wouldRunShort(state, aegis.powerPlant), false);
  assert.equal(wouldRunShort({ power: { supply: 130, use: 25, low: false } }, aegis.vehicleWorks), false);
});

test("the mini map says why it is off", () => {
  const radar = (extra) => ({ id: "s4", side: 0, role: "radar", building: 1, ...extra });
  assert.equal(radarState({ radar: true, structures: [] }, 0), "on");
  assert.equal(radarState({ structures: [] }, 0), "on"); // a snapshot from before radar
  assert.equal(radarState({ radar: false, structures: [] }, 0), "none");
  assert.equal(radarState({ radar: false, structures: [radar({ side: 1 })] }, 0), "none");
  assert.equal(radarState({ radar: false, structures: [radar({ ruin: true })] }, 0), "none");
  assert.equal(radarState({ radar: false, structures: [radar({ building: 0.4 })] }, 0), "rising");
  assert.equal(radarState({ radar: false, structures: [radar()] }, 0), "dark");
});

test("selling gives the rules' share back and repairing costs in proportion", () => {
  assert.equal(sellValue(rules, aegis.vehicleWorks), Math.round(aegis.vehicleWorks.cost * rules.match.sellShare));
  assert.equal(sellValue(rules, aegis.barrierWall), Math.round((aegis.barrierWall.cost / aegis.barrierWall.segments) * rules.match.sellShare));
  assert.equal(repairCost(rules, aegis.vehicleWorks, { hp: 0.5 }), Math.ceil(aegis.vehicleWorks.cost * rules.match.repairCostShare * 0.5));
  assert.equal(repairCost(rules, aegis.vehicleWorks, { hp: 1 }), 0);
});

test("what can be done with a structure of one's own", () => {
  const st = { side: 0, hp: 1, building: 1 };
  assert.deepEqual(structureActions(st, 0), ["sell"]);
  assert.deepEqual(structureActions({ ...st, hp: 0.6 }, 0), ["sell", "repair"]);
  assert.deepEqual(structureActions({ ...st, hp: 0.6 }, 0, { engineers: true }), ["sell", "repair", "mend"]);
  assert.deepEqual(structureActions({ ...st, hp: 0.6, repairing: true }, 0, { engineers: true }), ["sell", "mend"]);
  assert.deepEqual(structureActions({ ...st, hp: 0.6, building: 0.5 }, 0), ["sell"]);
  assert.deepEqual(structureActions({ ...st, side: 1, hp: 0.6 }, 0), []);
  assert.deepEqual(structureActions({ ...st, ruin: true }, 0), []);
});

test("a side may hold several power structures, and one of everything else", () => {
  const plant = (id) => ({ id, side: 0, kind: "powerPlant", faction: "aegis", role: "power", building: 1, hp: 1 });
  const card = (structures) => structureCards({ gold: 5000, structures }, rules, "aegis", 0).find((c) => c.id === "powerPlant");
  assert.equal(card([plant("s1")]).state, "ready");
  assert.equal(card(Array.from({ length: rules.match.powerStructures }, (_, i) => plant(`s${i}`))).state, "have");
});

test("only siege units outrange the defences they can hurt", () => {
  for (const [owner, f] of Object.entries(rules.factions)) {
    for (const [id, d] of Object.entries(f.structures).filter(([, s]) => s.role === "defence")) {
      for (const [enemy, e] of Object.entries(rules.factions)) {
        for (const [uid, u] of Object.entries(e.units)) {
          if ((d.vs?.[u.class] ?? 1) === 0 || (u.vs?.structure ?? 1) === 0 || u.siege) continue;
          assert.ok(siegeReach(u) <= d.range, `${uid} (${enemy}) outranges the ${id} (${owner})`);
        }
      }
    }
  }
});
