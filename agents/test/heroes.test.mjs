// Heroes, digging in, crushing and ranks: what the agents are told, which tools each
// leader has, and how the rule brain reads the orders in both languages.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { compactStatus, renderWake } from "../agent.mjs";
import { ruleBrain, wantedUnit } from "../brain-rule.mjs";
import { describeHeroEvent, heroUnit, unitAnywhere } from "../heroes.mjs";
import { leaderPrompt, operatorPrompt } from "../prompts.mjs";
import { leaderToolsFor } from "../tools.mjs";

const rules = JSON.parse(readFileSync(new URL("../../shared/rules.json", import.meta.url)));
rules.map ??= rules.maps.small;
const { aegis, ashfall } = rules.factions;
const hammer = { key: "player", en: "Hammer", he: "פטיש" };
const names = (unit) => leaderToolsFor(unit).map((t) => t.name);

async function think(brain, ctx) {
  const messages = [{ role: "user", content: "wake" }];
  const calls = [];
  for (let i = 0; i < 6; i++) {
    const res = await brain.think({ rules, messages, ...ctx });
    messages.push({ role: "assistant", content: res.content });
    const uses = res.content.filter((b) => b.type === "tool_use");
    if (!uses.length) return calls;
    calls.push(...uses.map((u) => [u.name, u.input]));
    messages.push({ role: "user", content: uses.map((u) => ({ type: "tool_result", tool_use_id: u.id, content: "{}" })) });
  }
  assert.fail("the brain never ended its turn");
}
const call = (body, extra = {}) => ({ from: hammer, to: [], lang: "en", body, end: "over", points: [], prowords: [], ...extra });
const wake = (c, status = null) => ({ items: [{ kind: "radio", msg: c }], call: c, status });

test("each leader has the tools its squad can use", () => {
  assert.ok(names(aegis.units.commandos).includes("fortify"), "infantry dig in");
  assert.ok(names(ashfall.units.militia).includes("fortify"));
  for (const unit of [aegis.units.tank, aegis.units.helicopter, ashfall.units.speedboat]) {
    assert.ok(!names(unit).some((n) => ["fortify", "plant", "seize"].includes(n)), `${unit.name.en} has none of them`);
  }
  assert.deepEqual(names(aegis.units.sentinel).slice(-1), ["plant"]);
  assert.deepEqual(names(ashfall.units.oracle).slice(-1), ["seize"]);
  assert.ok(!names(aegis.units.sentinel).includes("fortify") && !names(ashfall.units.oracle).includes("plant"));
  for (const t of leaderToolsFor(aegis.units.sentinel).concat(leaderToolsFor(ashfall.units.oracle), leaderToolsFor(aegis.units.commandos))) {
    assert.equal(t.strict, true);
    assert.deepEqual(t.input_schema.required, Object.keys(t.input_schema.properties));
  }
});

test("the prompts say what heroes, sandbags, tanks and ranks do", () => {
  const ghost = leaderPrompt({ rules, side: 0, faction: "aegis", station: { en: "Ghost 1", he: "רפאים 1" }, unit: aegis.units.sentinel });
  assert.match(ghost, /You are a hero: one soldier/);
  assert.match(ghost, /plant tool sets a demolition charge/);
  assert.match(ghost, new RegExp(`You carry ${aegis.units.sentinel.charges}`));
  assert.match(ghost, /or plant, for a charge/);
  assert.doesNotMatch(ghost, /fortify tool/);
  const raven = leaderPrompt({ rules, side: 1, faction: "ashfall", station: { en: "Raven 1", he: "עורב 1" }, unit: ashfall.units.oracle });
  assert.match(raven, /seize tool takes over an enemy vehicle squad/);
  assert.match(raven, /lose their nerve/);
  const viper = leaderPrompt({ rules, side: 0, faction: "aegis", station: { en: "Viper 1", he: "צפע 1" }, unit: aegis.units.commandos });
  assert.match(viper, /fortify tool builds a sandbag position/);
  assert.match(viper, /"dig in" \("התבצרו"\)/);
  assert.match(viper, /from that front only/);
  assert.match(viper, /tank that drives through your men in the open/);
  assert.match(viper, /Seasoned at 3 times its own cost, Elite at 6 times/);
  const rhino = leaderPrompt({ rules, side: 0, faction: "aegis", station: { en: "Rhino 1", he: "קרנף 1" }, unit: aegis.units.tank });
  assert.match(rhino, /runs down enemy infantry/);
  assert.doesNotMatch(rhino, /fortify tool/);
  // A seized squad is of the other army's design, and its leader is told what that means.
  const taken = leaderPrompt({ rules, side: 1, faction: "ashfall", station: { en: "Rhino 2", he: "קרנף 2" }, unit: unitAnywhere(rules, "tank"), seized: true });
  assert.match(taken, /taken from the enemy by your side's hero/);
  assert.match(taken, /Main battle tank|tank/i);

  const anvil = operatorPrompt({ rules, side: 0, faction: "aegis" });
  assert.match(anvil, /Your hero\. Sentinel \(זקיף\), unit id "sentinel", \d+ gold, needs a Barracks, a Vehicle works, a Radar Station and takes/i);
  assert.match(anvil, /Its callsign is Ghost \(רפאים\)/);
  assert.match(anvil, /The enemy's hero is the Oracle \(חוזה\)/);
  assert.match(anvil, /kill the hero rather than the vehicle/);
  assert.match(anvil, /sentinel: Sentinel \(זקיף\), infantry, \d+ gold.*a hero/);
  const other = operatorPrompt({ rules, side: 1, faction: "ashfall" });
  assert.match(other, /Its callsign is Raven \(עורב\)/);
  assert.match(other, /A defence by what you want to keep finds it/);
});

test("a buy call names the hero by its name, the word, or its callsign", () => {
  assert.equal(wantedUnit("buy the Sentinel", aegis.units), "sentinel");
  assert.equal(wantedUnit("קנה זקיף", aegis.units), "sentinel");
  assert.equal(wantedUnit("קנה את החוזה", ashfall.units), "oracle");
  assert.equal(heroUnit("buy the hero", aegis.units, rules), "sentinel");
  assert.equal(heroUnit("קנה גיבור", ashfall.units, rules), "oracle");
  assert.equal(heroUnit("buy Ghost", aegis.units, rules), "sentinel");
  assert.equal(heroUnit("קנה את עורב", ashfall.units, rules), "oracle");
  assert.equal(heroUnit("buy a tank", aegis.units, rules), undefined);
});

test("rule-brain leaders dig in, plant and seize when told to, in both languages", async () => {
  const brain = ruleBrain();
  const viper = { role: "squad", side: 0, squad: 2, tier: 1, station: { key: "infantry-2", en: "Viper 2", he: "צפע 2" }, lang: "en", unit: aegis.units.commandos };
  assert.deepEqual(await think(brain, { agent: viper, wake: wake(call("Dig in")) }), [
    ["fortify", {}],
    ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }],
  ]);
  assert.deepEqual(await think(brain, { agent: viper, wake: wake(call("התבצרו", { lang: "he" })) }), [
    ["fortify", {}],
    ["radio", { to: ["Hammer"], body: "רות, יבוצע", end: "out" }],
  ]);
  // A tank told to dig in does not, and says why.
  const rhino = { ...viper, station: { key: "vehicle-1", en: "Rhino 1", he: "קרנף 1" }, unit: aegis.units.tank };
  assert.deepEqual(await think(brain, { agent: rhino, wake: wake(call("Dig in")) }), [["radio", { to: ["Hammer"], body: "Negative, this squad cannot dig in", end: "over" }]]);

  const ghost = { ...viper, station: { key: "ghost-1", en: "Ghost 1", he: "רפאים 1" }, unit: aegis.units.sentinel };
  const status = { structures: [{ id: "s8", kind: "chopShop", name: "Chop shop", role: "works", side: 1, x: 1510, y: 650, hp: 1 }], contacts: [] };
  assert.deepEqual(await think(brain, { agent: ghost, wake: wake(call("Plant a charge on the enemy works"), status) }), [
    ["plant", { place: "s8" }],
    ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }],
  ]);
  assert.deepEqual(await think(brain, { agent: ghost, wake: wake(call("פוצץ את הגשר הדרומי", { lang: "he", landmarks: ["bridge-south"] })) }), [
    ["plant", { place: "bridge-south" }],
    ["radio", { to: ["Hammer"], body: "רות, יבוצע", end: "out" }],
  ]);
  assert.deepEqual(await think(brain, { agent: ghost, wake: wake(call("Blow up their headquarters")) }), [
    ["plant", { place: "Z" }],
    ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }],
  ]);
  assert.deepEqual(await think(brain, { agent: ghost, wake: wake(call("Plant a charge")) }), [["radio", { to: ["Hammer"], body: "Say again: set a charge on what?", end: "over" }]]);

  const raven = { ...viper, side: 1, station: { key: "raven-1", en: "Raven 1", he: "עורב 1" }, unit: ashfall.units.oracle };
  const seen = { contacts: [{ id: 4, class: "infantry" }, { id: 9, class: "vehicle" }] };
  assert.deepEqual(await think(brain, { agent: raven, wake: wake(call("Seize that tank"), seen) }), [
    ["seize", { contact: 9 }],
    ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }],
  ]);
  assert.deepEqual(await think(brain, { agent: raven, wake: wake(call("השתלט על מטרה 12", { lang: "he" }), seen) }), [
    ["seize", { contact: 12 }],
    ["radio", { to: ["Hammer"], body: "רות, יבוצע", end: "out" }],
  ]);
  assert.deepEqual(await think(brain, { agent: raven, wake: wake(call("Seize a vehicle"), { contacts: [] }) }), [
    ["radio", { to: ["Hammer"], body: "Negative, no enemy vehicle in sight", end: "over" }],
  ]);
});

test("the rule-brain operator buys the hero and passes on an order to dig in", async () => {
  const brain = ruleBrain();
  const anvil = { role: "anvil", side: 0, squad: 0, station: { key: "operator", en: "Anvil", he: "סדן" }, lang: "en" };
  const status = {
    faction: "aegis",
    command: { mode: "orders", buy: false },
    points: [],
    squads: [
      { callsign: { en: "Viper 1" }, unit: "commandos", class: "infantry" },
      { callsign: { en: "Rhino 1" }, unit: "tank", class: "vehicle" },
      { callsign: { en: "Ghost 1" }, unit: "sentinel", class: "infantry" },
    ],
  };
  assert.deepEqual((await think(brain, { agent: anvil, wake: wake(call("Buy the hero"), status) }))[0], ["buy", { unit: "sentinel", upgrade: "" }]);
  assert.deepEqual((await think(brain, { agent: anvil, wake: wake(call("קנה את רפאים", { lang: "he" }), status) }))[0], ["buy", { unit: "sentinel", upgrade: "" }]);
  assert.deepEqual(await think(brain, { agent: anvil, wake: wake(call("All squads dig in"), status) }), [
    ["radio", { to: ["Viper 1"], body: "All squads dig in", end: "over" }],
    ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }],
  ]);
});

test("the new events are told to an agent in words, and a status carries rank and hero", () => {
  assert.match(describeHeroEvent({ kind: "hero_fielded", unit: "oracle", contact: 9 }, "A squad"), /enemy has fielded its hero/);
  assert.match(describeHeroEvent({ kind: "hero_fell", unit: "sentinel", squad: 7, point: "F" }, "Ghost 1"), /Your hero Ghost 1 .* fell near F/);
  assert.match(describeHeroEvent({ kind: "squad_lost", reason: "seized", squad: 5, point: "D" }, "Rhino 1"), /Rhino 1 was taken over by the enemy's hero/);
  assert.match(describeHeroEvent({ kind: "squad_spawned", reason: "returned", squad: 5, point: "D" }, "Rhino 1"), /Rhino 1 is yours again/);
  assert.equal(describeHeroEvent({ kind: "squad_lost", squad: 5, point: "D" }, "Rhino 1"), null, "an ordinary loss keeps its own words");
  const text = renderWake([{ kind: "event", event: { kind: "fortified", squad: 2, place: "D-sandbags-1", point: "D" } }], null, [], "en");
  assert.match(text, /dug in: the sandbag position D-sandbags-1 near D/);

  const you = { near: "D", x: 1, y: 2, order: { kind: "hold" }, alive: 1, full: 1, tier: 2, rank: "seasoned", dug: 1, hero: { charges: 1, hp: 0.5 }, teams: [], contacts: [] };
  const got = compactStatus({ timeLeft: 100, points: [], contacts: [{ id: 3, unit: "oracle", class: "infantry", hero: true, teams: [{}] }], you, friends: [] }, 0);
  assert.equal(got.you.rank, "seasoned");
  assert.deepEqual(got.you.hero, { chargesLeft: 1, health: 0.5, holdsSquad: undefined });
  assert.equal(got.you.positionsBuilt, 1);
  assert.equal(got.contacts[0].hero, true);
});
