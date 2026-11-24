// Heroes, sandbag positions, crushing and ranks as the page works them out.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { canDigIn, crusherNear, digProgress, eventNames, heroEventKind, heroLock, heroOrders, heroPose, sandbagState, withBuilt } from "./heroes.js";
import { rankSvg, ranks } from "./marks.js";

const rules = JSON.parse(readFileSync(new URL("../shared/rules.json", import.meta.url)));
rules.map ??= structuredClone(rules.maps.small);
const { aegis, ashfall } = rules.factions;

test("positions built in the match join the map's landmarks, and leave it when gone", () => {
  const r = structuredClone(rules);
  const n = r.map.landmarks.length;
  const name = { en: "the sandbags north of Delta", he: "שקי חול מצפון לדוד" };
  const state = { landmarks: [{ id: "F-house-1", kind: "house", hp: 0.4 }, { id: "D-sandbags-1", kind: "sandbags", hp: 1, built: true, x: 450, y: 430, face: -1.57, by: 0, name }] };
  assert.equal(withBuilt(r, state), true);
  assert.equal(r.map.landmarks.length, n + 1);
  assert.deepEqual(r.map.landmarks.at(-1), { id: "D-sandbags-1", kind: "sandbags", x: 450, y: 430, name, built: true, face: -1.57, by: 0, state: "whole" });
  assert.equal(withBuilt(r, state), false, "nothing changed, so nothing needs redrawing");
  state.landmarks[1].kind = "sandbagsFlat";
  assert.equal(withBuilt(r, state), true);
  assert.equal(r.map.landmarks.at(-1).state, "flat");
  assert.equal(withBuilt(r, { landmarks: [] }), true);
  assert.equal(r.map.landmarks.length, n);
  assert.equal(sandbagState({ kind: "sandbags", hp: 0.3 }), "damaged");
});

test("only infantry dig in, and a hero is bought once the works and the radar stand", () => {
  assert.ok(canDigIn(aegis.units.commandos) && canDigIn(ashfall.units.militia));
  assert.ok(!canDigIn(aegis.units.tank) && !canDigIn(aegis.units.sentinel) && !canDigIn(null));
  const st = (role) => ({ side: 0, role, building: 1 });
  const base = { squads: [], deploying: [] };
  assert.equal(heroLock({ ...base, structures: [st("barracks")] }, rules, "aegis", 0, "sentinel").def.role, "works");
  assert.equal(heroLock({ ...base, structures: [st("barracks"), st("works")] }, rules, "aegis", 0, "sentinel").def.role, "radar");
  assert.equal(heroLock({ ...base, structures: [st("barracks"), st("works"), st("radar")] }, rules, "aegis", 0, "sentinel"), null);
  assert.equal(heroLock({ ...base, structures: [st("barracks"), st("works"), st("radar")], squads: [{ side: 0, unit: "sentinel" }] }, rules, "aegis", 0, "sentinel").text, "hero.one");
  assert.equal(heroLock({ ...base, structures: [st("barracks"), st("works"), st("radar")], deploying: [{ side: 0, unit: "sentinel" }] }, rules, "aegis", 0, "sentinel").text, "hero.one");
  assert.equal(heroLock({ ...base, structures: [] }, rules, "aegis", 0, "tank"), null, "not a hero: the usual lock says it");
});

test("a hero is drawn in the pose of what it is doing", () => {
  const ghost = { unit: "sentinel", order: { kind: "hold" }, hero: { charges: 2, hp: 1 } };
  assert.equal(heroPose(rules, ghost, { moving: false, firing: false }), "prone");
  assert.equal(heroPose(rules, ghost, { moving: false, firing: true }), "proneFire");
  assert.equal(heroPose(rules, ghost, { moving: true }), undefined);
  assert.equal(heroPose(rules, { ...ghost, order: { kind: "plant" }, hero: { work: 0.4 } }, {}), "plant");
  const raven = { unit: "oracle", order: { kind: "move" }, hero: { hp: 1 } };
  assert.equal(heroPose(rules, raven, { moving: true, firing: false }), "disguiseWalk");
  assert.equal(heroPose(rules, raven, { moving: false, firing: false }), "disguise");
  assert.equal(heroPose(rules, raven, { moving: false, firing: true }), undefined, "its own side sees it drop the disguise to shoot");
  assert.equal(heroPose(rules, { ...raven, order: { kind: "seize" }, hero: { work: 0.5 } }, {}), "seize");
  // The enemy sees the disguise for as long as the server says it holds.
  assert.equal(heroPose(rules, { unit: "oracle", disguised: true }, { moving: true, firing: true }), "disguiseWalk");
  assert.equal(heroPose(rules, { unit: "oracle", disguised: false }, { moving: true }), undefined);
  assert.equal(heroPose(rules, { unit: "commandos" }, {}), undefined);
});

test("the log words for a hero and for a squad that changes hands depend on whose it is", () => {
  assert.equal(heroEventKind({ kind: "hero_fielded", squad: 7 }), "hero_fielded");
  assert.equal(heroEventKind({ kind: "hero_fielded", contact: 7 }), "enemy_hero_fielded");
  assert.equal(heroEventKind({ kind: "hero_fell", contact: 7 }), "enemy_hero_fell");
  assert.equal(heroEventKind({ kind: "squad_lost", reason: "seized" }), "squad_seized");
  assert.equal(heroEventKind({ kind: "squad_lost", reason: "returned" }), "squad_released");
  assert.equal(heroEventKind({ kind: "squad_spawned", reason: "seized" }), "squad_taken");
  assert.equal(heroEventKind({ kind: "squad_spawned", reason: "returned" }), "squad_returned");
  assert.equal(heroEventKind({ kind: "squad_lost" }), "squad_lost");
  assert.equal(heroEventKind({ kind: "squad_lost", reason: "spent" }), "squad_lost");
  assert.deepEqual(eventNames(rules, { kind: "promoted", unit: "elite" }, "he"), { hero: "", rank: "עילית" });
  assert.equal(eventNames(rules, { kind: "hero_fell", unit: "oracle" }, "en").hero, "Oracle");
});

test("a man lost beside enemy armour was run down; a technical runs nobody down", () => {
  const groups = [
    { side: 0, unit: "tank", visuals: [{ px: 100, py: 100 }] },
    { side: 1, unit: "technical", visuals: [{ px: 300, py: 100 }] },
  ];
  assert.equal(crusherNear(rules, groups, 1, 110, 104), true);
  assert.equal(crusherNear(rules, groups, 1, 180, 100), false, "too far to have been the tank");
  assert.equal(crusherNear(rules, groups, 0, 110, 104), false, "its own side's tank");
  assert.equal(crusherNear(rules, groups, 0, 300, 104), false, "a light vehicle");
});

test("the menu offers a hero its own order on the right thing, and digging in shows its progress", () => {
  const ghost = { unit: "sentinel", hero: { charges: 1 } };
  assert.deepEqual(heroOrders(rules, ghost, { kind: "structure" }, ["attack"]), ["plant", "attack"]);
  assert.deepEqual(heroOrders(rules, ghost, { kind: "bridge" }, ["hold", "move", "attack"]), ["plant", "hold", "move", "attack"]);
  assert.deepEqual(heroOrders(rules, ghost, { kind: "enemyHQ" }, ["hold"]), ["plant", "hold"]);
  assert.deepEqual(heroOrders(rules, ghost, { kind: "point" }, ["hold"]), ["hold"]);
  assert.deepEqual(heroOrders(rules, { unit: "sentinel", hero: { charges: 0 } }, { kind: "bridge" }, ["hold"]), ["hold"], "no charges left");
  const raven = { unit: "oracle", hero: {} };
  assert.deepEqual(heroOrders(rules, raven, { kind: "contact", cls: "vehicle" }, ["attack"]), ["seize", "attack"]);
  assert.deepEqual(heroOrders(rules, raven, { kind: "contact", cls: "infantry" }, ["attack"]), ["attack"]);
  assert.deepEqual(heroOrders(rules, { unit: "commandos" }, { kind: "bridge" }, ["hold"]), ["hold"]);
  assert.equal(digProgress({ order: { kind: "fortify" }, dig: 0.4 }), 0.4);
  assert.equal(digProgress({ order: { kind: "hold" }, dig: 0.4 }), null);
});

test("every rank in the rules has its silver mark", () => {
  for (const r of rules.ranks) {
    assert.ok(ranks[r.id], `${r.id} has a mark`);
    assert.match(rankSvg(r.id, 14, r.name.en), /<svg[^>]*>.*<title>/);
  }
  assert.equal(rankSvg("", 14), "");
});
