// Power, the radar, selling and repairing as the agents see them: the prompts, the tools,
// and the scripted brain in both languages.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { compactStatus } from "../agent.mjs";
import { wantedStructure } from "../bases.mjs";
import { scriptedBrain } from "../brain-scripted.mjs";
import { eventLine } from "../power.mjs";
import { leaderPrompt, operatorPrompt } from "../prompts.mjs";
import { leaderToolsFor, operatorTools } from "../tools.mjs";

const rules = JSON.parse(readFileSync(new URL("../../shared/rules.json", import.meta.url), "utf8"));
rules.map ??= rules.maps.small;
const { aegis, ashfall } = rules.factions;
const hammer = { key: "player", en: "Hammer", he: "פטיש" };
const anvil = { role: "anvil", side: 0, squad: 0, tier: 1, station: { key: "operator", en: "Anvil", he: "סדן" }, lang: "en" };
const call = (body, extra = {}) => ({ from: hammer, to: [anvil.station], lang: "en", body, end: "over", points: [], prowords: [], ...extra });

async function think(ctx, fail = {}) {
  const brain = scriptedBrain();
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

const own = [
  { id: "s1", kind: "refinery", role: "refinery", side: 0, x: 1, y: 2, hp: 1, building: 1 },
  { id: "s2", kind: "barracks", role: "barracks", side: 0, x: 1, y: 2, hp: 0.4, building: 1 },
  { id: "s3", kind: "powerPlant", role: "power", side: 0, x: 1, y: 2, hp: 1, building: 1 },
  { id: "s4", kind: "radar", role: "radar", side: 0, x: 1, y: 2, hp: 1, building: 1 },
];

test("a call names the power structure and the radar in both languages", () => {
  for (const [text, want] of [
    ["build a power plant", "powerPlant"],
    ["build power", "powerPlant"],
    ["בנה תחנת כוח", "powerPlant"],
    ["build a radar", "radar"],
    ["בנה תחנת מכ״ם", "radar"],
  ]) {
    assert.equal(wantedStructure(text, aegis.structures), want, text);
  }
  assert.equal(wantedStructure("build a generator", ashfall.structures), "generatorYard");
  assert.equal(wantedStructure("בנה עמדת האזנה", ashfall.structures), "listeningPost");
});

test("scripted operator: sells and repairs what Hammer names, and says why when it cannot", async () => {
  const status = { faction: "aegis", gold: 900, points: [], squads: [], structures: own, power: { supply: 130, use: 45, low: false } };
  const wake = (c) => ({ items: [{ kind: "radio", msg: c }], call: c, status });
  const wilco = ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }];
  const rut = ["radio", { to: ["Hammer"], body: "רות, יבוצע", end: "out" }];
  assert.deepEqual(await think({ agent: anvil, wake: wake(call("Sell the radar")) }), [["sell", { place: "s4" }], wilco]);
  assert.deepEqual(await think({ agent: anvil, wake: wake(call("מכור את תחנת הכוח", { lang: "he" })) }), [["sell", { place: "s3" }], rut]);
  assert.deepEqual(await think({ agent: anvil, wake: wake(call("Repair the barracks")) }), [["repair", { place: "s2" }], wilco]);
  assert.deepEqual(await think({ agent: anvil, wake: wake(call("תקן את המכ״ם", { lang: "he" })) }), [["repair", { place: "s4" }], rut]);
  // A refusal goes back with the game's reason; a sale of nothing named is asked again.
  assert.deepEqual(await think({ agent: anvil, wake: wake(call("Fix the refinery")) }, { repair: "it is not damaged: the Refinery" }), [
    ["repair", { place: "s1" }],
    ["radio", { to: ["Hammer"], body: "Negative, it is not damaged: the Refinery", end: "over" }],
  ]);
  assert.deepEqual(await think({ agent: anvil, wake: wake(call("Sell the airbase")) }), [["radio", { to: ["Hammer"], body: "Say again", end: "over" }]]);
  // Building the two new structures is an ordinary build.
  assert.deepEqual(await think({ agent: anvil, wake: wake(call("Build a power plant")) }), [["build", { structure: "powerPlant", place: "", place2: "" }], wilco]);
});

test("scripted operator: says when power is low in a status; the change itself is the game's cue, not the operator's line", async () => {
  const low = { faction: "aegis", gold: 50, points: [], squads: [], structures: own, power: { supply: 30, use: 45, low: true }, command: { mode: "orders", buy: false } };
  const wake = (c) => ({ items: [{ kind: "radio", msg: c }], call: c, status: low });
  assert.deepEqual(await think({ agent: anvil, wake: wake(call("Status")) }), [["radio", { to: ["Hammer"], body: "0 squads, 50 gold, holding , power is low", end: "over" }]]);
  assert.match((await think({ agent: { ...anvil, lang: "he" }, wake: wake(call("מה המצב", { lang: "he" })) }))[0][1].body, /חסר חשמל$/);
  const event = (kind) => ({ items: [{ kind: "event", event: { kind, side: 0, point: "A", count: 15 } }], status: low });
  assert.deepEqual(await think({ agent: anvil, wake: event("low_power") }), []);
  assert.deepEqual(await think({ agent: { ...anvil, lang: "he" }, wake: event("power_restored") }), []);
});

test("scripted operator with the purse builds power before what would leave it short", async () => {
  const structures = own.filter((s) => s.role === "refinery" || s.role === "barracks").map((s) => ({ ...s, hp: 1 }));
  const squads = Array.from({ length: 4 }, (_, i) => ({ callsign: { en: `Viper ${i + 1}` }, class: "infantry", unit: "commandos", order: { kind: "hold" } }));
  const haulers = [{ side: 0 }, { side: 0 }];
  const status = { faction: "aegis", gold: 2000, timeLeft: 500, points: [], squads, haulers, structures, power: { supply: 30, use: 25, low: false }, command: { mode: "orders", buy: true } };
  const heard = { items: [{ kind: "heard", msg: {} }], status };
  // The next unit is a vehicle: it needs the works, and the works needs power first.
  assert.deepEqual(await think({ agent: anvil, wake: heard }), [["build", { structure: "powerPlant", place: "", place2: "" }]]);
  const powered = { ...status, structures: [...structures, own[2]], power: { supply: 130, use: 25, low: false } };
  assert.deepEqual(await think({ agent: anvil, wake: { ...heard, status: powered } }), [["build", { structure: "vehicleWorks", place: "", place2: "" }]]);
  // Short already, with nothing going up: power comes before anything else.
  const short = { ...status, structures: [...structures, { ...own[3] }], power: { supply: 30, use: 45, low: true } };
  assert.deepEqual(await think({ agent: anvil, wake: { ...heard, status: short } }), [["build", { structure: "powerPlant", place: "", place2: "" }]]);
});

test("scripted engineers mend their own side's structure; other squads do not", async () => {
  const station = { key: "infantry-2", en: "Viper 2", he: "צפע 2", squad: 2 };
  const structures = [{ id: "s2", name: "Barracks", role: "barracks", yours: true, near: "A", x: 90, y: 310, hp: 0.3 }];
  const status = { you: { near: "A", x: 0, y: 0, order: {}, alive: 6, full: 6 }, friends: [], contacts: [], points: [], structures, timeLeft: 300 };
  const wake = (c) => ({ items: [{ kind: "radio", msg: c }], call: c, status });
  const engineers = { role: "squad", side: 0, squad: 2, tier: 1, station, lang: "en", unit: aegis.units.engineers };
  assert.deepEqual(await think({ agent: engineers, wake: wake(call("Repair the barracks")) }), [
    ["repair", { place: "s2" }],
    ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }],
  ]);
  const commandos = { ...engineers, unit: aegis.units.commandos };
  assert.deepEqual(await think({ agent: commandos, wake: wake(call("Repair the barracks")) }), [["radio", { to: ["Hammer"], body: "Say again", end: "over" }]]);
});

test("the tools, the status and the prompts carry power, the radar, selling and repairing", () => {
  const names = operatorTools.map((t) => t.name);
  assert.ok(names.includes("sell") && names.includes("repair"));
  assert.ok(leaderToolsFor(aegis.units.engineers).some((t) => t.name === "repair"));
  assert.ok(!leaderToolsFor(aegis.units.commandos).some((t) => t.name === "repair" || t.name === "sell"));

  const snap = { timeLeft: 1, gold: 0, income: 0, hq: [1, 1], points: [], contacts: [], squads: [], structures: [{ ...own[1], repairing: true }], power: { supply: 30, use: 45, low: true }, radar: false };
  const compact = compactStatus(snap, 0);
  assert.deepEqual(compact.power, { supply: 30, use: 45, low: true });
  assert.equal(compact.radar, false);
  assert.equal(compact.structures[0].repairing, true);

  const op = operatorPrompt({ rules, side: 0, faction: "aegis" });
  for (const words of ["powerPlant: Power Plant", "supplies 100 power", "uses 20 power", "power is low", "Radar Station needs the Vehicle Works", "Airbase needs the Radar Station", "The sell tool", "The repair tool", "Power Plant, Refinery, Barracks, Vehicle Works, Radar Station, Airbase", "Precision rocket launcher outranges every defence"]) {
    assert.ok(op.includes(words), `operator prompt lacks "${words}"`);
  }
  const station = { en: "Viper 3", he: "צפע 3" };
  const eng = leaderPrompt({ rules, side: 0, faction: "aegis", station, unit: aegis.units.engineers });
  assert.ok(eng.includes("repair also mends a damaged structure of your own side"));
  const rockets = leaderPrompt({ rules, side: 1, faction: "ashfall", station, unit: ashfall.units.rpgTeam });
  assert.ok(rockets.includes(`reaches ${ashfall.units.rpgTeam.siegeRange} against structures`));
  const plain = leaderPrompt({ rules, side: 0, faction: "aegis", station, unit: aegis.units.commandos });
  assert.ok(plain.includes("An enemy defence outranges your squad"));

  assert.match(eventLine({ kind: "low_power", count: 15 }), /short of power by 15/);
  assert.match(eventLine({ kind: "repair_stopped", unit: "barracks", structure: "s2", point: "A" }), /no gold left/);
});

test("a scripted squad says where it is by the thing it was sent to, not by the nearest point", async () => {
  const leader = { role: "squad", side: 0, squad: 1, tier: 1, station: { key: "squad-1", en: "Viper 1", he: "צפע 1" }, lang: "en", commander: "Hammer" };
  const site = rules.map.techBuildings[2];
  const status = { structures: [{ id: "s7", name: "Field Clinic", role: "tech", holder: "nobody", site: site.name.en, siteHe: site.name.he }, { id: "s2", name: "Barracks", role: "barracks", yours: true }] };
  const arrived = (event, lang = "en") => think({ agent: { ...leader, lang }, wake: { items: [{ kind: "event", event: { kind: "arrived", side: 0, point: "D", ...event } }], status } });
  assert.deepEqual(await arrived({}), [["radio", { to: ["Hammer"], body: "In position at Delta", end: "over" }]]);
  assert.deepEqual(await arrived({ place: "D-bunker-1" }), [["radio", { to: ["Hammer"], body: "In position at the bunker north of Delta", end: "over" }]]);
  assert.deepEqual(await arrived({ structure: "s7", unit: site.kind }), [["radio", { to: ["Hammer"], body: `In position at ${site.name.en}`, end: "over" }]]);
  assert.deepEqual(await arrived({ structure: "s2", unit: "barracks" }, "he"), [["radio", { to: ["Hammer"], body: `בעמדה ב${aegis.structures.barracks.name.he}`, end: "over" }]]);
  assert.deepEqual(await arrived({ structure: "s7", unit: site.kind }, "he"), [["radio", { to: ["Hammer"], body: `בעמדה ב${site.name.he}`, end: "over" }]]);
});

test("scripted operator with the purse follows the opening, builds ahead only with gold to spare, and mends when rich", async () => {
  const st = (role) => ({ id: `o-${role}`, kind: role, role, side: 0, x: 1, y: 2, hp: 1, building: 1 });
  const squads = Array.from({ length: 2 }, (_, i) => ({ callsign: { en: `Viper ${i + 1}` }, class: "infantry", unit: "commandos", order: { kind: "hold" } }));
  const base = { faction: "aegis", timeLeft: 500, points: [], squads, haulers: [{ side: 0 }, { side: 0 }], power: { supply: 130, use: 25, low: false }, command: { mode: "orders", buy: true } };
  const heard = (status) => think({ agent: anvil, wake: { items: [{ kind: "heard", msg: {} }], status: { ...base, ...status } } });
  const build = (structure) => [["build", { structure, place: "", place2: "" }]];
  // The opening's first three come before any squad, in its order.
  assert.deepEqual(await heard({ gold: 2000, structures: [], opening: "power" }), build("powerPlant"));
  assert.deepEqual(await heard({ gold: 2000, structures: [st("power")], opening: "refinery" }), build("refinery"));
  assert.deepEqual(await heard({ gold: 2000, structures: [st("power"), st("refinery")], opening: "barracks" }), build("barracks"));
  // The works is next: with gold to spare it goes up, without it a squad is bought instead.
  const three = [st("power"), st("refinery"), st("barracks")];
  const cheap = aegis.units.commandos.cost;
  assert.deepEqual(await heard({ gold: aegis.structures.vehicleWorks.cost + 2 * cheap, structures: three, opening: "works", haulers: [{ side: 0 }] }), build("vehicleWorks"));
  assert.deepEqual(await heard({ gold: cheap, structures: three, opening: "works", haulers: [{ side: 0 }] }), [["buy", { unit: "commandos", upgrade: "" }]]);
  // Rich, with a battered barracks and nothing left of the opening: it pays for the repair.
  const all = [...three.slice(0, 2), { ...st("barracks"), hp: 0.4 }, st("works")];
  assert.deepEqual(await heard({ gold: 4 * cheap, structures: all, opening: "" }), [["repair", { place: all[2].id }]]);
  assert.deepEqual(await heard({ gold: 4 * cheap, structures: [...three, st("works")], opening: "" }), [["buy", { unit: "commandos", upgrade: "" }]]);
});
