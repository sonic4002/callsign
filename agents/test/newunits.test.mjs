// The units beyond the first three per faction: what the agents are told about them and
// how a buy call names them.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { wantedUnit } from "../brain-scripted.mjs";
import { leaderPrompt, operatorPrompt, unitFacts } from "../prompts.mjs";

const rules = JSON.parse(readFileSync(new URL("../../shared/rules.json", import.meta.url)));
const { aegis, ashfall } = rules.factions;

test("the scripted operator reads which unit a buy call names, in both languages", () => {
  assert.equal(wantedUnit("buy an attack helicopter", aegis.units), "helicopter");
  assert.equal(wantedUnit("קנה מסוק קרב", aegis.units), "helicopter");
  assert.equal(wantedUnit("buy a rocket launcher", aegis.units), "rocketLauncher");
  assert.equal(wantedUnit("buy a tank", aegis.units), "tank");
  assert.equal(wantedUnit("buy a vehicle", aegis.units), "tank", "a class alone means its cheapest unit");
  assert.equal(wantedUnit("buy one infantry squad", aegis.units), "commandos");
  assert.equal(wantedUnit("buy infantry", ashfall.units), "militia");
  assert.equal(wantedUnit("קנה נחיל רחפנים", ashfall.units), "fpvSwarm");
  assert.equal(wantedUnit("buy drones", ashfall.units), "fpvSwarm");
  assert.equal(wantedUnit("buy a rocket team", ashfall.units), "rpgTeam");
  assert.equal(wantedUnit("קנה חוליית טילי כתף", ashfall.units), "rpgTeam");
  assert.equal(wantedUnit("קנה סירה", ashfall.units), "speedboat");
});

test("the page's own buy calls name every unit unmistakably", () => {
  // The build buttons send "Buy one <class> squad, <unit name>": each must come back as itself.
  const classes = { en: { infantry: "infantry", vehicle: "vehicle", naval: "naval", air: "air" }, he: { infantry: "רגלים", vehicle: "רכב", naval: "ימית", air: "אוויר" } };
  for (const f of [aegis, ashfall]) {
    for (const [id, u] of Object.entries(f.units)) {
      assert.equal(wantedUnit(`Buy one ${classes.en[u.class]} squad, ${u.name.en}`, f.units), id);
      assert.equal(wantedUnit(`קנה כיתת ${classes.he[u.class]}, ${u.name.he}`, f.units), id);
    }
  }
});

test("prompts say what each unit can and cannot do", () => {
  assert.match(unitFacts(aegis.units.helicopter, rules), /flies over land and sea/);
  assert.match(unitFacts(aegis.units.rocketLauncher, rules), /cannot hit anything closer than 150/);
  assert.match(unitFacts(aegis.units.tank, rules), /cannot hit air targets/);
  assert.match(unitFacts(ashfall.units.fpvSwarm, rules), /cannot capture/);
  assert.match(unitFacts(ashfall.units.rpgTeam, rules), /through armor/);
  assert.equal(unitFacts(ashfall.units.technical, rules), "");
  const anvil = operatorPrompt({ rules, side: 0, faction: "aegis" });
  assert.match(anvil, /Hawk \(בז\) for aircraft/);
  assert.match(anvil, /helicopter: Attack helicopter \(מסוק קרב\), air, 400 gold/);
  assert.match(anvil, /only naval or air squads can reach or capture it/);
  const hawk = leaderPrompt({ rules, side: 0, faction: "aegis", station: { en: "Hawk 1", he: "בז 1" }, unit: aegis.units.helicopter });
  assert.match(hawk, /Your squad flies: it can go to any point/);
});
