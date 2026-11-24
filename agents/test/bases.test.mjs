// Bases as the agents see them: which structure a call names, where it should go, what
// the rule brain does about it, and what the prompts say.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { compactStatus } from "../agent.mjs";
import { compactStructures, namedStructure, placeOf, wantedStructure } from "../bases.mjs";
import { ruleBrain, spotOf } from "../brain-rule.mjs";
import { operatorTools } from "../tools.mjs";
import { leaderPrompt, operatorPrompt } from "../prompts.mjs";

const rules = JSON.parse(readFileSync(new URL("../../shared/rules.json", import.meta.url)));
rules.map ??= rules.maps.small; // the default map, as the server sends it to a page
const { aegis, ashfall } = rules.factions;
const hammer = { key: "player", en: "Hammer", he: "פטיש" };
const anvil = { role: "anvil", side: 0, squad: 0, tier: 1, station: { key: "operator", en: "Anvil", he: "סדן" }, lang: "en" };
const call = (body, extra = {}) => ({ from: hammer, to: [anvil.station], lang: "en", body, end: "over", points: [], prowords: [], ...extra });

// think drives the rule brain through one wake, every tool succeeding unless `fail` names it.
async function think(ctx, fail = {}) {
  const brain = ruleBrain();
  const messages = [{ role: "user", content: "wake" }];
  const calls = [];
  for (let i = 0; i < 6; i++) {
    const res = await brain.think({ rules, messages, ...ctx });
    messages.push({ role: "assistant", content: res.content });
    const uses = res.content.filter((b) => b.type === "tool_use");
    if (!uses.length) return calls;
    calls.push(...uses.map((u) => [u.name, u.input]));
    messages.push({ role: "user", content: uses.map((u) => ({ type: "tool_result", tool_use_id: u.id, content: fail[u.name] ?? "{}", ...(fail[u.name] && { is_error: true }) })) });
  }
  assert.fail("the brain never ended its turn");
}

test("every unit names a structure its faction can build, and every structure has both names", () => {
  for (const f of [aegis, ashfall]) {
    const roles = new Set(Object.values(f.structures).map((s) => s.role));
    for (const [id, u] of Object.entries(f.units)) assert.ok(roles.has(u.requires), `${id} requires ${u.requires}`);
    for (const role of ["hq", "barracks", "works", "airbase", "dockyard", "refinery", "defence", "fence"]) assert.ok(roles.has(role), `no ${role}`);
    for (const [id, s] of Object.entries(f.structures)) {
      assert.ok(s.name.en && /[֐-׿]/.test(s.name.he), `${id} needs a name in both languages`);
      for (const u of s.unlocks) assert.equal(f.units[u].requires, s.role, `${id} unlocks ${u}`);
    }
  }
});

test("a call names a structure by its own name or by a plain word, in both languages", () => {
  const s = aegis.structures;
  assert.equal(wantedStructure("build a works", s), "vehicleWorks");
  assert.equal(wantedStructure("build a vehicle works", s), "vehicleWorks");
  assert.equal(wantedStructure("we need a factory", s), "vehicleWorks");
  assert.equal(wantedStructure("בנה סדנת רכב", s), "vehicleWorks");
  assert.equal(wantedStructure("בנה את מפעל הרכב", s), "vehicleWorks");
  assert.equal(wantedStructure("put up an airfield", s), "airbase");
  assert.equal(wantedStructure("בנה שדה תעופה", s), "airbase");
  assert.equal(wantedStructure("build a dock", s), "dockyard");
  assert.equal(wantedStructure("בנה מספנה", s), "dockyard");
  assert.equal(wantedStructure("a gun at Delta", s), "sentryGun");
  assert.equal(wantedStructure("תותח בדוד", s), "sentryGun");
  assert.equal(wantedStructure("build anti-air at the base", s), "flakBattery");
  assert.equal(wantedStructure("fence the north side", s), "barrierWall");
  assert.equal(wantedStructure("בנה חומה בצפון", s), "barrierWall");
  assert.equal(wantedStructure("build a refinery", s), "refinery");
  assert.equal(wantedStructure("hold Foxtrot", s), undefined);
  assert.equal(wantedStructure("build a tank", s), undefined);
  // The other faction's words for the same roles.
  assert.equal(wantedStructure("build a chop shop", ashfall.structures), "chopShop");
  assert.equal(wantedStructure("build a works", ashfall.structures), "chopShop");
  assert.equal(wantedStructure("a gun nest at the front", ashfall.structures), "gunNest");
  assert.equal(wantedStructure("build a rocket nest", ashfall.structures), "rocketNest");
  assert.equal(wantedStructure("גדר תיל בחזית", ashfall.structures), "wireFence");
});

test("a place is a named point or a side of the base", () => {
  assert.equal(placeOf("a gun at Delta", ["D"]), "D");
  assert.equal(placeOf("fence the north side", []), "base:north");
  assert.equal(placeOf("גדר בחזית", []), "base:front");
  assert.equal(placeOf("a wall behind the base", []), "base:rear");
  assert.equal(placeOf("build a gun", []), "");
});

test("rule-brain operator: builds what Hammer names, and says why when it cannot", async () => {
  const status = { faction: "aegis", gold: 900, points: [], squads: [] };
  const wake = (c) => ({ items: [{ kind: "radio", msg: c }], call: c, status });
  const wilco = ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }];
  assert.deepEqual(await think({ agent: anvil, wake: wake(call("Build a works")) }), [["build", { structure: "vehicleWorks", place: "", place2: "" }], wilco]);
  assert.deepEqual(await think({ agent: anvil, wake: wake(call("בנה סדנת רכב", { lang: "he" })) }), [
    ["build", { structure: "vehicleWorks", place: "", place2: "" }],
    ["radio", { to: ["Hammer"], body: "רות, יבוצע", end: "out" }],
  ]);
  assert.deepEqual(await think({ agent: anvil, wake: wake(call("A gun at Delta", { points: ["D"] })) }), [["build", { structure: "sentryGun", place: "D", place2: "" }], wilco]);
  assert.deepEqual(await think({ agent: anvil, wake: wake(call("Fence the north side")) }), [["build", { structure: "barrierWall", place: "base:north", place2: "" }], wilco]);
  // A refusal goes back to Hammer with the game's reason.
  assert.deepEqual(await think({ agent: anvil, wake: wake(call("Build an airbase")) }, { build: "a structure is missing: the Airbase needs a Vehicle Works first" }), [
    ["build", { structure: "airbase", place: "", place2: "" }],
    ["radio", { to: ["Hammer"], body: "Negative, a structure is missing: the Airbase needs a Vehicle Works first", end: "over" }],
  ]);
  // "Build a tank" is still a purchase, and an order to hold a point is still relayed.
  assert.deepEqual((await think({ agent: anvil, wake: wake(call("Build a tank")) }))[0], ["buy", { unit: "tank", upgrade: "" }]);
});

test("rule-brain operator: a structure goes on the spot the call names; cancel and rally", async () => {
  const structures = [{ id: "s2", name: "Barracks", role: "barracks", yours: true, near: "A", x: 90, y: 310, hp: 1 }];
  const status = { faction: "aegis", gold: 900, points: [], squads: [], structures };
  const wake = (c) => ({ items: [{ kind: "radio", msg: c }], call: c, status });
  const wilco = ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }];
  const roger = ["radio", { to: ["Hammer"], body: "רות, יבוצע", end: "out" }];
  const one = async (body, extra) => await think({ agent: anvil, wake: wake(call(body, extra)) });
  // The page writes the spot into the call; the operator passes the words on untouched.
  assert.deepEqual(await one("Build a Vehicle Works 140 metres north and 60 metres east of Alpha.", { points: ["A"] }), [
    ["build", { structure: "vehicleWorks", place: "140 metres north and 60 metres east of Alpha", place2: "" }],
    wilco,
  ]);
  assert.deepEqual(await one("בנה סדנת רכב 140 מטר צפונית ו-60 מטר מזרחית לאלף", { points: ["A"], lang: "he" }), [
    ["build", { structure: "vehicleWorks", place: "140 מטר צפונית ו-60 מטר מזרחית לאלף", place2: "" }],
    roger,
  ]);
  assert.deepEqual(await one("Build a Sentry Gun 20 metres south and 200 metres east of Alpha", { points: ["A"] }), [
    ["build", { structure: "sentryGun", place: "20 metres south and 200 metres east of Alpha", place2: "" }],
    wilco,
  ]);
  // A point alone means "near there".
  assert.deepEqual((await one("Build a barracks at Alpha", { points: ["A"] }))[0], ["build", { structure: "barracks", place: "A", place2: "" }]);
  assert.equal(spotOf("Build a works"), undefined);
  assert.equal(spotOf("Buy 2 tanks"), undefined);

  assert.deepEqual(await one("Cancel the tank"), [["cancel", { unit: "tank" }], wilco]);
  assert.deepEqual(await one("בטל את הטנק", { lang: "he" }), [["cancel", { unit: "tank" }], roger]);
  assert.deepEqual(await one("Cancel the last one"), [["cancel", { unit: "" }], wilco]);
  assert.deepEqual(await think({ agent: anvil, wake: wake(call("Cancel the tank")) }, { cancel: "nothing of that kind is on its way" }), [
    ["cancel", { unit: "tank" }],
    ["radio", { to: ["Hammer"], body: "Negative, nothing of that kind is on its way", end: "over" }],
  ]);

  assert.deepEqual(await one("New squads rally at Delta", { points: ["D"] }), [["rally", { place: "D", structure: "" }], wilco]);
  assert.deepEqual(await one("כיתות חדשות מתכנסות בדוד", { points: ["D"], lang: "he" }), [["rally", { place: "D", structure: "" }], roger]);
  assert.deepEqual(await one("The barracks rallies at Bravo", { points: ["B"] }), [["rally", { place: "B", structure: "s2" }], wilco]);
  assert.deepEqual(await one("New squads rally 100 metres north and 40 metres east of Alpha", { points: ["A"] }), [
    ["rally", { place: "100 metres north and 40 metres east of Alpha", structure: "" }],
    wilco,
  ]);
  assert.deepEqual(await one("New squads rally at home"), [["rally", { place: "home", structure: "" }], wilco]);
  assert.deepEqual(await one("New squads rally"), [["radio", { to: ["Hammer"], body: "Say again: rally where?", end: "over" }]]);
});

test("the operator is told about placing, lines, cancelling and rally points", () => {
  const prompt = operatorPrompt({ rules, side: 0, faction: "aegis" });
  for (const words of ["140 metres north and 60 metres east of Alpha", "one unit at a time", "cancel tool", "rally tool", `${rules.match.queueLimit} wait in its line`]) {
    assert.ok(prompt.includes(words), `the operator prompt should say: ${words}`);
  }
  const names = operatorTools.map((t) => t.name);
  assert.ok(names.includes("cancel") && names.includes("rally"));
});

test("rule-brain leaders: attack an enemy structure by name; only engineers take one over", async () => {
  const station = { key: "infantry-2", en: "Viper 2", he: "צפע 2", squad: 2 };
  const structures = [
    { id: "s2", name: "Barracks", role: "barracks", yours: true, near: "A", x: 90, y: 310, hp: 1 },
    { id: "s9", name: "Chop Shop", role: "works", yours: false, near: "Z", x: 1370, y: 200, hp: 0.8 },
    { id: "s11", name: "Gun Nest", role: "defence", yours: false, near: "Z", x: 1250, y: 480, hp: 1 },
  ];
  const status = { you: { near: "H", x: 0, y: 0, order: {}, alive: 6, full: 6 }, friends: [], contacts: [], points: [], structures, timeLeft: 300 };
  const wake = (c) => ({ items: [{ kind: "radio", msg: c }], call: c, status });
  const wilco = ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }];
  const commandos = { role: "squad", side: 0, squad: 2, tier: 1, station, lang: "en", unit: aegis.units.commandos };
  const engineers = { ...commandos, unit: aegis.units.engineers };

  assert.deepEqual(await think({ agent: commandos, wake: wake(call("Attack the enemy works")) }), [["attack", { place: "s9", contact: 0 }], wilco]);
  assert.deepEqual(await think({ agent: commandos, wake: wake(call("תקפו את המוסך של האויב", { lang: "he" })) }), [
    ["attack", { place: "s9", contact: 0 }],
    ["radio", { to: ["Hammer"], body: "רות, יבוצע", end: "out" }],
  ]);
  assert.deepEqual(await think({ agent: commandos, wake: wake(call("Destroy the gun nest")) }), [["attack", { place: "s11", contact: 0 }], wilco]);
  assert.deepEqual(await think({ agent: engineers, wake: wake(call("Take over the enemy works")) }), [["capture", { place: "s9" }], wilco]);
  // Commandos told to capture a point still hold it; a structure nobody has seen is not guessed at.
  assert.deepEqual(await think({ agent: commandos, wake: wake(call("Capture Foxtrot", { points: ["F"] })) }), [["hold", { place: "F" }], wilco]);
  assert.equal(namedStructure("attack the enemy airbase", compactStructures(status, 0), { enemy: true }), undefined);
});

test("a status lists structures compactly for leaders and for the operator", () => {
  const forLeader = compactStructures({ structures: [{ id: "s9", name: "Chop Shop", role: "works", yours: false, near: "Z", x: 1, y: 2, hp: 0.5 }, { id: "s3", name: "Wire Fence", role: "fence", yours: true }] }, 0);
  assert.deepEqual(forLeader, [{ id: "s9", name: "Chop Shop", role: "works", whose: "enemy", near: "Z", x: 1, y: 2, health: 0.5 }]);
  const snap = { timeLeft: 1, gold: 0, income: 0, hq: [1, 1], points: [], contacts: [], squads: [], structures: [{ id: "s1", kind: "barracks", role: "barracks", side: 0, x: 1, y: 2, hp: 1, building: 0.4 }, { id: "s4", kind: "den", role: "works", side: 1, x: 3, y: 4, hp: 1, building: 1, ruin: true }] };
  assert.deepEqual(compactStatus(snap, 0).structures, [{ id: "s1", name: "barracks", role: "barracks", whose: "yours", near: undefined, x: 1, y: 2, health: 1, building: true }]);
});

test("the prompts explain the build tree, defences, fences and capture", () => {
  const op = operatorPrompt({ rules, side: 0, faction: "aegis" });
  for (const words of ["vehicleWorks: Vehicle Works", "needs a Barracks", "lets you buy Main battle tank, Precision rocket launcher", "base:front", "fence", "taken over by an engineer squad", "tank: Main battle tank (טנק מערכה), vehicle, 250 gold, needs a Vehicle Works"]) {
    assert.ok(op.includes(words), `operator prompt lacks "${words}"`);
  }
  assert.ok(!op.includes("Chop Shop"), "the operator is told of its own faction's structures only");
  const station = { en: "Viper 3", he: "צפע 3" };
  const plain = leaderPrompt({ rules, side: 0, faction: "aegis", station, unit: aegis.units.commandos });
  const eng = leaderPrompt({ rules, side: 0, faction: "aegis", station, unit: aegis.units.engineers });
  assert.ok(plain.includes('such as "s7"') && !plain.includes("Your squad are engineers"));
  assert.ok(eng.includes("Your squad are engineers") && eng.includes(`after ${aegis.units.engineers.captureSeconds} seconds`));
});

// ---- tech buildings and base cues ----

test("a status lists tech buildings with who holds them and what they give", () => {
  const status = {
    structures: [
      { id: "s3", name: "Barracks", role: "barracks", yours: true, near: "A", x: 1, y: 1, hp: 1 },
      { id: "s13", name: "Field Clinic", role: "tech", yours: false, holder: "nobody", gives: "heals your infantry standing by it", near: "D", x: 330, y: 790, hp: 1 },
      { id: "s15", name: "Assay Office", role: "tech", yours: true, holder: "yours", gives: "gold", near: "G", x: 630, y: 170, hp: 1 },
    ],
  };
  const got = compactStructures(status, 0);
  assert.deepEqual(got.map((s) => s.whose), ["yours", "nobody", "yours"]);
  assert.equal(got[1].gives, "heals your infantry standing by it");
  // A raw snapshot structure of no side reads the same way.
  assert.equal(compactStructures({ structures: [{ id: "s9", kind: "tech_clinic", role: "tech", side: -1, x: 0, y: 0, hp: 1 }] }, 0)[0].whose, "nobody");
});

test("engineers told to take a tech building capture it, in both languages", async () => {
  const structures = [
    { id: "s20", name: "Vehicle Works", role: "works", yours: false, near: "Z", x: 1, y: 1, hp: 1 },
    { id: "s13", name: "Field Clinic", role: "tech", yours: false, holder: "nobody", near: "D", x: 330, y: 790, hp: 1 },
    { id: "s14", name: "Service Yard", role: "tech", yours: false, holder: "enemy", near: "E", x: 1, y: 1, hp: 1 },
    { id: "s15", name: "Assay Office", role: "tech", yours: true, holder: "yours", near: "G", x: 1, y: 1, hp: 1 },
  ];
  const list = compactStructures({ structures }, 0);
  assert.equal(namedStructure("capture the clinic east of Delta", list, { enemy: true })?.id, "s13");
  assert.equal(namedStructure("השתלטו על המרפאה", list, { enemy: true })?.id, "s13");
  assert.equal(namedStructure("take over the service yard", list, { enemy: true })?.id, "s14");
  assert.equal(namedStructure("השתלטו על מוסך השדה", list, { enemy: true })?.id, "s14");
  assert.equal(namedStructure("capture the assay office", list, { enemy: true }), undefined, "ours already");
  assert.equal(namedStructure("guard the assay office", list, { enemy: false })?.id, "s15");

  const station = { key: "engineer-1", en: "Wrench 1", he: "מפתח 1", squad: 7 };
  const engineers = { role: "squad", side: 0, squad: 7, tier: 1, lang: "en", unit: aegis.units.engineers, station };
  const en = await think({ agent: engineers, wake: { call: call("capture the clinic east of Delta", { to: [station] }), status: { structures } } });
  assert.deepEqual(en[0], ["capture", { place: "s13" }]);
  const he = await think({ agent: { ...engineers, lang: "he" }, wake: { call: call("השתלטו על מוסך השדה", { to: [station], lang: "he" }), status: { structures } } });
  assert.deepEqual(he[0], ["capture", { place: "s14" }]);
});

test("the prompts tell of the map's tech buildings", () => {
  const station = { key: "engineer-1", en: "Wrench 1", he: "מפתח 1", squad: 7 };
  const text = leaderPrompt({ rules, side: 0, faction: "aegis", station, unit: aegis.units.engineers });
  for (const t of rules.map.techBuildings) assert.ok(text.includes(t.id) && text.includes(t.name.he), `${t.id} is not in the leader's prompt`);
  assert.match(text, /Tech buildings\. These belong to no army/);
  assert.match(text, /Assay Office/);
  assert.match(operatorPrompt({ rules, side: 0, faction: "aegis" }), /Tech buildings\./);
});

test("a base cue wakes nobody", async () => {
  const { callsFor } = await import("../agent.mjs");
  const cue = { from: anvil.station, to: [hammer], end: "out", cue: "unitReady", text: "Hammer, this is Anvil. Rhino 1 in the field. Out." };
  assert.equal(callsFor(cue, hammer), false);
  assert.equal(callsFor({ ...cue, to: [{ key: "all" }] }, { key: "infantry-1" }), false);
  assert.equal(callsFor({ ...cue, cue: undefined, to: [{ key: "all" }] }, { key: "infantry-1" }), true, "an order from the operator still does");
});
