// The build panel's state from a snapshot, the calls the page writes for structures, and
// the pictures every structure can fall back on.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { buildVerb, captureVerb, namedStructure, placeOf, wantedStructure } from "../agents/bases.mjs";
import { ofRole, stands, structureAt, structureCards, structureRows, unitDef, unitLock } from "./bases.js";

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const rules = JSON.parse(read("../shared/rules.json"));
const strings = { en: JSON.parse(read("i18n/en.json")), he: JSON.parse(read("i18n/he.json")) };
const t = (lang, key, vars) => strings[lang][key].replace(/\{(\w+)\}/g, (_, name) => vars[name]);

const st = (id, kind, role, extra = {}) => ({ id, kind, role, faction: "aegis", side: 0, x: 100, y: 100, hp: 1, building: 1, visible: true, ...extra });
const start = { gold: 500, structures: [st("s1", "barracks", "barracks"), st("s2", "refinery", "refinery", { x: 90, y: 650 })] };
const card = (state, id) => structureCards(state, rules, "aegis", 0).find((c) => c.id === id);

test("a unit is locked until the structure it needs stands", () => {
  assert.equal(unitLock(start, rules, "aegis", 0, "commandos"), null);
  assert.equal(unitLock(start, rules, "aegis", 0, "tank").id, "vehicleWorks");
  assert.equal(unitLock(start, rules, "aegis", 0, "helicopter").def.name.en, "Airbase");
  const rising = { ...start, structures: [...start.structures, st("s3", "vehicleWorks", "works", { building: 0.5 })] };
  assert.equal(unitLock(rising, rules, "aegis", 0, "tank").id, "vehicleWorks", "a works going up unlocks nothing yet");
  const built = { ...start, structures: [...start.structures, st("s3", "vehicleWorks", "works")] };
  assert.equal(unitLock(built, rules, "aegis", 0, "tank"), null);
  // A ruin unlocks nothing, the enemy's works is not ours, and a captured one counts.
  assert.ok(unitLock({ ...start, structures: [...start.structures, st("s3", "vehicleWorks", "works", { ruin: true })] }, rules, "aegis", 0, "tank"));
  assert.ok(unitLock({ ...start, structures: [...start.structures, st("s9", "chopShop", "works", { faction: "ashfall", side: 1 })] }, rules, "aegis", 0, "tank"));
  assert.equal(unitLock({ ...start, structures: [...start.structures, st("s9", "chopShop", "works", { faction: "ashfall" })] }, rules, "aegis", 0, "tank"), null);
  assert.equal(unitDef(rules, "technical").name.en, "Technical");
  assert.ok(stands(start, 0, "barracks") && !stands(start, 1, "barracks"));
});

test("the structure cards say what can be built and why not", () => {
  const cards = structureCards(start, rules, "aegis", 0);
  assert.deepEqual(cards.map((c) => c.id).sort(), Object.keys(rules.factions.aegis.structures).filter((id) => id !== "commandPost").sort());
  assert.equal(card(start, "barracks").state, "have");
  assert.equal(card(start, "vehicleWorks").state, "ready");
  assert.deepEqual(card(start, "vehicleWorks").unlocks, ["tank", "rocketLauncher"]);
  assert.equal(card(start, "airbase").state, "needs");
  assert.equal(card(start, "airbase").needs.id, "vehicleWorks");
  assert.equal(card({ ...start, gold: 10 }, "vehicleWorks").state, "poor");
  assert.equal(card(start, "sentryGun").state, "ready");

  // One base structure at a time; a defence may go up beside it.
  const rising = { ...start, structures: [...start.structures, st("s3", "vehicleWorks", "works", { building: 0.25 })] };
  assert.deepEqual([card(rising, "vehicleWorks").state, card(rising, "vehicleWorks").progress], ["rising", 0.25]);
  assert.equal(card(rising, "dockyard").state, "busy");
  assert.equal(card(rising, "sentryGun").state, "ready");
  const gunRising = { ...start, structures: [...start.structures, st("s4", "sentryGun", "defence", { building: 0.5 })] };
  assert.equal(card(gunRising, "barrierWall").state, "busy");
  assert.equal(card(gunRising, "dockyard").state, "ready");

  // The caps on defences and fence runs.
  const guns = Array.from({ length: rules.match.defenceCap }, (_, i) => st(`g${i}`, "sentryGun", "defence"));
  const full = { ...start, structures: [...start.structures, ...guns] };
  assert.equal(card(full, "sentryGun").state, "full");
  assert.equal(card(full, "sentryGun").have, rules.match.defenceCap);
  const runs = Array.from({ length: rules.match.fenceRuns * 3 }, (_, i) => st(`f${i}`, "barrierWall", "fence", { run: 1 + (i % rules.match.fenceRuns) }));
  assert.equal(card({ ...start, structures: [...start.structures, ...runs] }, "barrierWall").state, "full");
  assert.equal(card({ ...start, structures: [...start.structures, ...runs] }, "barrierWall").have, rules.match.fenceRuns);
});

test("the list of what stands shows a fence run as one row, and leaves out ruins and the enemy's", () => {
  const state = {
    structures: [
      ...start.structures,
      st("s5", "barrierWall", "fence", { run: 1, hp: 1 }),
      st("s6", "barrierWall", "fence", { run: 1, hp: 0.5 }),
      st("s7", "vehicleWorks", "works", { ruin: true }),
      st("s8", "chopShop", "works", { faction: "ashfall", side: 1 }),
    ],
  };
  const rows = structureRows(state, rules, 0);
  assert.deepEqual(rows.map((r) => r.id), ["s1", "s2", "s5"]);
  assert.deepEqual([rows[2].segments, rows[2].hp], [2, 0.75]);
  // A tap finds the structure under it, not a fence and not a ruin.
  assert.equal(structureAt(state, rules, 105, 95).id, "s1");
  assert.equal(structureAt(state, rules, 600, 600), null);
  assert.equal(ofRole(rules, "ashfall", "works").id, "chopShop");
});

test("the calls the page writes for structures are understood, in both languages", () => {
  for (const [faction, f] of Object.entries(rules.factions)) {
    for (const [id, def] of Object.entries(f.structures)) {
      if (def.role === "hq") continue;
      for (const lang of ["en", "he"]) {
        const fixed = def.role === "defence" || def.role === "fence";
        const text = fixed
          ? t(lang, "call.buildAt", { to: "Anvil", from: "Hammer", structure: def.name[lang], place: strings[lang]["place.front"] })
          : t(lang, "call.build", { to: "Anvil", from: "Hammer", structure: def.name[lang] });
        assert.ok(buildVerb.test(text.toLowerCase()), `${faction} ${id} ${lang}: no build word in "${text}"`);
        assert.equal(wantedStructure(text, f.structures), id, `${faction} ${id} ${lang}: "${text}"`);
        if (fixed) assert.equal(placeOf(text, []), "base:front", `"${text}"`);
        // Seen from the other side, it is named as a target.
        const seen = [{ id: "s9", name: def.name.en, role: def.role, whose: "enemy" }];
        const attack = t(lang, "call.attackStructure", { to: "Viper 1", from: "Hammer", structure: def.name[lang] });
        assert.equal(namedStructure(attack, seen, { enemy: true })?.id, "s9", `${faction} ${id} ${lang}: "${attack}"`);
        const capture = t(lang, "call.capture", { to: "Viper 1", from: "Hammer", structure: def.name[lang] });
        assert.ok(captureVerb.test(capture.toLowerCase()), `no capture word in "${capture}"`);
        assert.equal(namedStructure(capture, seen, { enemy: true })?.id, "s9", `"${capture}"`);
      }
    }
  }
});

test("every structure in the rules has a picture to fall back on", () => {
  const art = read("bases-art.js");
  const table = art.slice(art.indexOf("export const fallbacks = {"), art.indexOf("function rubble"));
  for (const f of Object.values(rules.factions)) {
    for (const [id, def] of Object.entries(f.structures)) {
      if (def.role === "hq") continue; // the headquarters is drawn with the map points
      if (def.role === "fence") {
        assert.ok(art.includes("export function drawFence"), "fences are drawn by drawFence");
        continue;
      }
      assert.ok(new RegExp(`\\n  ${def.role}\\(ctx`).test(table), `${id}: no fallback picture for the role ${def.role}`);
    }
  }
});

// The manifest key of a picture IS the rules id of the thing. Every structure and unit
// in the rules is drawn from the manifest when the picture is there and from the page's
// own drawing when it is not; nothing in the manifest still carries a pipeline name.
test("rules ids and the sprite manifest: every thing has a painted picture or a fallback, and none is orphaned", () => {
  const manifest = JSON.parse(read("../assets/sprites/manifest.json"));
  const art = read("art.js");
  for (const [faction, f] of Object.entries(rules.factions)) {
    for (const [id, def] of Object.entries(f.structures)) {
      if (def.role === "hq") {
        assert.ok(manifest.buildings[`hq_${faction}`] && manifest.buildings[`hq_${faction}_ruin`], `${faction}: no headquarters picture`);
        continue;
      }
      if (def.role === "fence") {
        const seg = manifest.segments[id];
        assert.ok(seg?.x && seg?.y && seg?.ruin?.x && seg?.ruin?.y, `${id}: the run has no painted pieces`);
        continue;
      }
      assert.ok(manifest.buildings[id], `${id}: no picture`);
      assert.ok(manifest.buildings[`${id}_ruin`], `${id}: no ruin`);
      if (def.role !== "defence") assert.ok(manifest.buildings[`${id}_site`], `${id}: no building site`);
    }
    for (const [id, u] of Object.entries(f.units)) {
      const entry = manifest.units[id];
      assert.ok(entry, `${id}: no sheet`);
      if (u.class === "hauler") for (const anim of ["idle", "move", "full", "moveFull", "load", "unload", "wreck"]) assert.ok(entry.anims[anim], `${id}: no ${anim} frames`);
      // And the page still draws it when the sheet does not load.
      assert.ok(u.class !== "hauler" || art.includes('if (cls === "hauler")'), "haulers have no code-drawn fallback");
    }
  }
  const leftover = [...Object.keys(manifest.buildings), ...Object.keys(manifest.units), ...Object.keys(manifest.segments)].filter((k) => /^(aegis|ashfall)_/.test(k));
  assert.deepEqual(leftover, [], "pipeline names in the manifest: run art/rename_keys.py");
  for (const group of ["buildings", "units", "landmarks", "props"]) {
    for (const [id, entry] of Object.entries(manifest[group])) {
      assert.ok(existsSync(new URL(`../assets/sprites/${entry.image}`, import.meta.url)), `${group}.${id}: ${entry.image} is missing`);
    }
  }
});

test("a hauler's frames follow what it is doing and how full it is", async () => {
  const { haulerAnim } = await import("./art.js");
  assert.equal(haulerAnim({ haul: "loading", load: 0.2 }), "load");
  assert.equal(haulerAnim({ haul: "unloading", load: 0.9 }), "unload");
  assert.equal(haulerAnim({ haul: "out", load: 0, moving: true }), "move");
  assert.equal(haulerAnim({ haul: "returning", load: 1, moving: true }), "moveFull");
  assert.equal(haulerAnim({ haul: "waiting", load: 0 }), "idle");
  assert.equal(haulerAnim({ haul: "fleeing", load: 0.8 }), "full");
});
