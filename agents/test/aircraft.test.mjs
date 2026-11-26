// Strike aircraft on the agents' side: what a plane's leader does with each order in both
// languages, what it says of its sorties, what the operator buys and sends it at, and
// what the prompts and the tools tell a model.

import assert from "node:assert/strict";
import { test } from "node:test";

import { describeStrikeEvent, isStrike, strikeFacts } from "../aircraft.mjs";
import { optionsFor } from "../brain-jev.mjs";
import { ruleBrain, wantedUnit } from "../brain-rule.mjs";
import { leaderPrompt, operatorPrompt } from "../prompts.mjs";
import { leaderToolsFor } from "../tools.mjs";
import { hintCalls, hintPhrases, hintWords } from "../../client/voice/hints.js";
import { rules, run, status } from "./orders.mjs";

const aegis = rules.factions.aegis.units;
const ashfall = rules.factions.ashfall.units;
const hammer = { key: "player", en: "Hammer", he: "פטיש" };
const comet1 = { key: "comet-1", en: "Comet 1", he: "שביט 1", squad: 9 };
const pilot = (lang, tier = 1, unit = aegis.strikeJet) => ({ role: "squad", side: 0, squad: 9, tier, station: comet1, lang, unit });
const call = (body, extra = {}) => ({ from: hammer, to: [comet1], lang: /[א-ת]/.test(body) ? "he" : "en", body, end: "over", points: [], prowords: [], landmarks: [], ...extra });
const wake = (c, st) => ({ items: [{ kind: "radio", msg: c }], call: c, status: st });
const event = (e, st) => ({ items: [{ kind: "event", event: e }], call: null, status: st });
// The plane stands armed at its airbase, with an enemy drone swarm and a technical in sight.
const parked = (sortie = { state: "parked", bombs: 2, full: 2, home: "s4" }) => {
  const st = status();
  st.contacts.push({ id: 12, unit: "fpvSwarm", class: "air", near: "B", x: 470, y: 240, teams: [{}] });
  st.structures.push({ id: "s4", kind: "airbase", name: "Airbase", role: "airbase", side: 0, yours: true, near: "A", x: 150, y: 300, hp: 1, building: 1 });
  st.you = { id: 9, near: "A", x: 150, y: 300, order: { kind: "none" }, alive: 2, full: 2, tier: 1, teams: [{ nerve: "steady", action: "idle", members: 1 }, { nerve: "steady", action: "idle", members: 1 }], contacts: [], sortie };
  return st;
};
const ask = (body, { lang, tier = 1, st = parked(), extra = {} } = {}) => run(ruleBrain(), { agent: pilot(lang ?? (/[א-ת]/.test(body) ? "he" : "en"), tier), wake: wake(call(body, extra), st) });

test("both armies have a strike aircraft, dearer than the helicopter, under one callsign that clashes with nothing", () => {
  assert.ok(isStrike(aegis.strikeJet) && isStrike(ashfall.propBomber));
  assert.ok(aegis.strikeJet.cost > aegis.helicopter.cost && ashfall.propBomber.cost > aegis.helicopter.cost);
  const cs = rules.callsigns;
  assert.deepEqual(cs.classes.comet, { en: "Comet", he: "שביט" });
  const taken = [cs.player, cs.operator, cs.contact, cs.hauler, ...Object.entries(cs.classes).filter(([k]) => k !== "comet").map(([, v]) => v)].flatMap((t) => [t.en.toLowerCase(), t.he]);
  for (const map of Object.values(rules.maps)) for (const p of map.points) taken.push(p.callsign.en.toLowerCase(), p.callsign.he, ...(p.aliases ?? []).map((a) => a.toLowerCase()));
  assert.ok(!taken.includes("comet") && !taken.includes("שביט"));
  // The recognisers are told the new callsign with the others, glued the Hebrew way too.
  assert.ok(hintWords(rules, "en").includes("Comet") && hintWords(rules, "he").includes("שביט"));
  assert.ok(hintPhrases(rules, "he").includes("ושביט"));
  assert.match(hintCalls(rules, "en"), /Comet \d, this is Hammer/);
  assert.match(hintCalls(rules, "he"), /שביט \d, כאן פטיש/);
  for (const u of [aegis.strikeJet, ashfall.propBomber]) {
    assert.equal(u.requires, "airbase");
    assert.equal(u.callsign, "comet");
    assert.equal(u.vs.air, 0);
    assert.ok(u.noCapture);
  }
});

test("a plane's leader flies strikes and looks, goes home on any word for it, and refuses to hold ground, in both languages", async () => {
  const foxtrot = { points: ["F"] };
  assert.deepEqual(await ask("attack Foxtrot", { extra: foxtrot }), [
    ["attack", { place: "F", contact: 0 }],
    ["radio", { to: ["Hammer"], body: "Wilco, rolling in on Foxtrot", end: "out" }],
  ]);
  assert.deepEqual(await ask("הפציצו את פסל", { extra: foxtrot }), [
    ["attack", { place: "F", contact: 0 }],
    ["radio", { to: ["Hammer"], body: "רות, יבוצע, יוצאים לתקיפה על פסל", end: "out" }],
  ]);
  assert.deepEqual(await ask("bomb the smelter"), [
    ["attack", { place: "s7", contact: 0 }],
    ["radio", { to: ["Hammer"], body: "Wilco, rolling in on Smelter", end: "out" }],
  ]);
  assert.deepEqual(await ask("attack Target 3"), [
    ["attack", { place: "", contact: 3 }],
    ["radio", { to: ["Hammer"], body: "Wilco, rolling in on Target 3", end: "out" }],
  ]);
  // Unarmed, it takes the order and says when it will fly it.
  assert.deepEqual((await ask("attack Foxtrot", { extra: foxtrot, st: parked({ state: "rearming", bombs: 0, full: 2, rearm: 0.3 }) }))[1][1].body, "Wilco, striking Foxtrot as soon as we are rearmed");
  // A move is a flight to look.
  assert.deepEqual(await ask("move to Foxtrot", { extra: foxtrot }), [
    ["move", { place: "F" }],
    ["radio", { to: ["Hammer"], body: "Wilco, flying over Foxtrot for a look", end: "out" }],
  ]);
  assert.deepEqual((await ask("טוסו לפסל", { extra: foxtrot }))[1][1].body, "רות, יבוצע, טסים מעל פסל לתצפית");
  // Home, however it is said.
  for (const body of ["return to base", "fall back", "RTB", "hold", "stop", "חזרו לבסיס", "נסיגה"]) {
    const got = await ask(body);
    assert.deepEqual(got[0], ["hold", { place: "here" }], body);
    assert.equal(got[1][1].body, /[א-ת]/.test(body) ? "רות, יבוצע, חוזרים לבסיס" : "Wilco, returning to base", body);
  }
  assert.deepEqual((await ask("move to Alpha", { extra: { points: ["A"] } }))[0], ["hold", { place: "here" }]);
  // What ground squads do is refused in words, with no tool call for the game to refuse.
  assert.deepEqual(await ask("hold Foxtrot", { extra: foxtrot }), [["radio", { to: ["Hammer"], body: "Negative, aircraft cannot hold ground; give me a target or send me back to base", end: "over" }]]);
  assert.deepEqual(await ask("תחזיקו את פסל", { extra: foxtrot }), [["radio", { to: ["Hammer"], body: "שלילי, מטוסים לא מחזיקים שטח; תן מטרה או שלח אותי לבסיס", end: "over" }]]);
  assert.deepEqual(await ask("take cover"), [["radio", { to: ["Hammer"], body: "Negative, aircraft cannot hold ground; give me a target or send me back to base", end: "over" }]]);
  assert.deepEqual(await ask("dig in"), [["radio", { to: ["Hammer"], body: "Negative, this squad cannot dig in", end: "over" }]]);
  assert.equal((await ask("capture the smelter"))[0][1].body, "Negative, only engineers take over structures");
  // Bombs do not hit aircraft: named, the target is refused; unnamed, another is chosen.
  assert.deepEqual(await ask("attack Target 12"), [["radio", { to: ["Hammer"], body: "Negative, our weapons cannot hurt Target 12", end: "over" }]]);
  const st = parked();
  st.contacts = [st.contacts.at(-1), ...st.contacts.slice(0, -1)]; // the drones are nearest
  st.contacts[0].x = 160;
  assert.deepEqual((await ask("attack", { st }))[0], ["attack", { place: "", contact: 3 }]);
});

test("a plane's leader reports its strike, what it saw, and that it is armed; and where it is in its sortie", async () => {
  const st = parked({ state: "back", bombs: 0, full: 2, home: "s4" });
  st.you.order = { kind: "return" };
  const say = async (e, lang, s = st) => (await run(ruleBrain(), { agent: pilot(lang), wake: event(e, s) })).map(([, input]) => input.body);
  assert.deepEqual(await say({ kind: "strike", squad: 9, point: "F", place: "F", count: 4 }, "en"), ["Strike on Foxtrot complete, heading home to rearm"]);
  assert.deepEqual(await say({ kind: "strike", squad: 9, point: "K", structure: "s7", unit: "smelter", count: 4 }, "he"), ["התקיפה על המתכה בוצעה, חוזרים לבסיס להתחמש"]);
  assert.deepEqual(await say({ kind: "strike", squad: 9, point: "G", contact: 3, count: 4 }, "en"), ["Strike on Target 3 complete, heading home to rearm"]);
  assert.deepEqual(await say({ kind: "overhead", squad: 9, point: "H", place: "H" }, "en"), ["Over Hotel, no contact, returning to base"]);
  st.you.contacts = [7];
  assert.deepEqual(await say({ kind: "overhead", squad: 9, point: "H", place: "H", count: 1 }, "he"), ["מעל הגר, 1 כוחות אויב בטווח ראייה, הקרוב מטרה 7, חוזרים לבסיס"]);
  assert.deepEqual(await say({ kind: "rearmed", squad: 9, point: "A" }, "en", parked()), ["Rearmed at base, ready for a target"]);
  // With a strike still ordered it flies again at once, and says nothing.
  const again = parked();
  again.you.order = { kind: "attack", place: "s7" };
  assert.deepEqual(await say({ kind: "rearmed", squad: 9, point: "A" }, "en", again), []);
  // "Report" says where it is in its sortie.
  assert.match((await ask("report", { st: parked() }))[0][1].body, /2 of 2 men, at base, armed, /);
  assert.match((await ask("דווח", { st: parked({ state: "rearming", bombs: 0, full: 2 }) }))[0][1].body, /מתחמשים בבסיס/);
  assert.match((await ask("report", { st }))[0][1].body, /returning to base/);
});

test("the operator knows a plane when it is asked for one, buys one when the ground is in hand, and sends it at what the squads cannot reach", async () => {
  assert.equal(wantedUnit("buy a strike jet", aegis), "strikeJet");
  assert.equal(wantedUnit("buy a plane", aegis), "strikeJet");
  assert.equal(wantedUnit("קנה מטוס תקיפה", aegis), "strikeJet");
  assert.equal(wantedUnit("קנה מטוס", ashfall), "propBomber");
  assert.equal(wantedUnit("buy a bomber", ashfall), "propBomber");
  assert.equal(wantedUnit("קנה מפציץ", ashfall), "propBomber");
  assert.equal(wantedUnit("buy an aircraft", aegis), "helicopter", "the cheapest aircraft is still the helicopter");
  assert.equal(wantedUnit("buy a helicopter", aegis), "helicopter");

  const anvil = { role: "anvil", side: 0, level: 3, station: { key: "operator", en: "Anvil", he: "סדן" }, lang: "en" };
  const quiet = (s) => ({ items: [{ kind: "event", event: { kind: "quiet" } }], call: null, status: s });
  const squad = (id, cls, unit, n, more = {}) => ({ id, callsign: { en: `${cls} ${n}`, he: `${cls} ${n}` }, unit, class: { Viper: "infantry", Rhino: "vehicle", Comet: "air" }[cls], near: "A", x: 150, y: 480, order: { kind: "hold", point: "B" }, alive: 2, full: 2, tier: 3, ...more });
  const base = ["powerPlant", "refinery", "barracks", "vehicleWorks", "radar", "airbase"].map((kind, i) => ({ id: `s${20 + i}`, kind, name: rules.factions.aegis.structures[kind].name.en, role: rules.factions.aegis.structures[kind].role, side: 0, yours: true, near: "A", x: 100 + 40 * i, y: 400, hp: 1, building: 1 }));
  const st = {
    ...status(),
    faction: "aegis",
    gold: 900,
    command: { mode: "orders", buy: true },
    power: { supply: 200, use: 100, low: false },
    opening: "",
    deploying: [],
    structures: [...base, { id: "s7", kind: "smelter", name: "Smelter", role: "refinery", side: 1, near: "K", x: 1200, y: 180, hp: 1, building: 1 }, { id: "s9", kind: "rocketNest", name: "Rocket Nest", role: "defence", side: 1, near: "K", x: 1150, y: 260, hp: 1, building: 1 }],
    squads: [squad(1, "Viper", "commandos", 1), squad(2, "Viper", "commandos", 2), squad(3, "Viper", "commandos", 3), squad(4, "Viper", "commandos", 4), squad(5, "Rhino", "tank", 1), squad(6, "Rhino", "tank", 2)],
    haulers: [{ id: 1001, side: 0, field: "B" }, { id: 1002, side: 0, field: "B" }, { id: 1003, side: 0, field: "B" }],
    contacts: [],
  };
  assert.deepEqual(await run(ruleBrain(), { agent: anvil, wake: quiet(st) }), [["buy", { unit: "strikeJet", upgrade: "" }]]);
  // One is enough; and without its airbase it is not asked for.
  const one = { ...st, squads: [...st.squads, squad(9, "Comet", "strikeJet", 1, { order: { kind: "none" }, sortie: { state: "parked", bombs: 2, full: 2 } })] };
  assert.notDeepEqual((await run(ruleBrain(), { agent: anvil, wake: quiet(one) }))[0]?.[1]?.unit, "strikeJet");
  const bare = { ...st, structures: st.structures.filter((s) => s.role !== "airbase") };
  assert.notDeepEqual((await run(ruleBrain(), { agent: anvil, wake: quiet(bare) }))[0]?.[1]?.unit, "strikeJet");

  // Running the fight: the plane is never told to hold, and goes for the enemy's defence.
  const fight = { ...one, gold: 0, command: { mode: "fight", buy: false } };
  const calls = await run(ruleBrain(), { agent: anvil, wake: quiet(fight) });
  const toComet = calls.filter(([name, input]) => name === "radio" && input.to.includes("Comet 1"));
  assert.deepEqual(toComet, [["radio", { to: ["Comet 1"], body: "Attack Rocket Nest s9", end: "over" }]]);
  // And the plane's leader understands that call.
  const order = { from: { key: "operator", en: "Anvil", he: "סדן" }, to: [comet1], lang: "en", body: "Attack Rocket Nest s9", end: "over", points: [], prowords: [], landmarks: [] };
  const heard = parked();
  heard.structures.push({ id: "s9", kind: "rocketNest", name: "Rocket Nest", role: "defence", side: 1, near: "K", x: 1150, y: 260, hp: 1, building: 1 });
  assert.deepEqual((await run(ruleBrain(), { agent: pilot("en"), wake: wake(order, heard) }))[0], ["attack", { place: "s9", contact: 0 }]);
  // An enemy squad near the base comes first, in the net's language.
  const raid = { ...fight, contacts: [{ id: 7, unit: "technical", class: "vehicle", near: "A", x: 300, y: 480, teams: [{}] }] };
  const he = await run(ruleBrain(), { agent: { ...anvil, lang: "he" }, wake: quiet(raid) });
  assert.ok(he.some(([name, input]) => name === "radio" && input.to.includes("Comet 1") && input.body === "תקפו את מטרה 7"), JSON.stringify(he));
});

test("the prompts, the tools and the fast brain's options say what a strike aircraft is", () => {
  assert.match(strikeFacts(aegis.strikeJet), /one pass drops 4 bombs/);
  assert.match(strikeFacts(ashfall.propBomber), /one pass drops 3 bombs/);
  const anvil = operatorPrompt({ rules, side: 0, faction: "aegis" });
  assert.match(anvil, /Comet \(שביט\) for strike aircraft/);
  assert.match(anvil, /strikeJet: Strike jet \(מטוס תקיפה\), air, 500 gold, needs a Airbase; a strike aircraft/);
  assert.match(anvil, /Strike aircraft\. Your Strike jet/);
  assert.match(operatorPrompt({ rules, side: 1, faction: "ashfall" }), /Your Prop bomber \(מפציץ מדחף\), unit id "propBomber"/);
  const lead = leaderPrompt({ rules, side: 0, faction: "aegis", station: comet1, unit: aegis.strikeJet });
  assert.match(lead, /Your squad is strike aircraft/);
  assert.match(lead, /first act with attack, move \(a flight to look\) or hold here \(return to base\)/);
  assert.doesNotMatch(lead, /Your squad flies: it can go to any point/);
  assert.deepEqual(leaderToolsFor(aegis.strikeJet).map((t) => t.name), ["radio", "report", "move", "hold", "attack"]);
  assert.match(leaderToolsFor(ashfall.propBomber).find((t) => t.name === "hold").description, /return to your airbase/);
  assert.match(leaderToolsFor(aegis.helicopter).find((t) => t.name === "hold").description, /defend it/);
  assert.match(describeStrikeEvent({ kind: "strike", point: "K", structure: "s7", unit: "smelter", count: 4 }, "Comet 1"), /bombs have fallen on the smelter \(s7\)/);
  assert.match(describeStrikeEvent({ kind: "squad_lost", reason: "no_airbase", point: "A" }, "Comet 1"), /no airbase left/);
  assert.equal(describeStrikeEvent({ kind: "squad_lost", point: "A" }, "Comet 1"), null);
  // The fast brain is offered a strike and a look at each point, the way home, and no hold.
  const options = optionsFor({ agent: pilot("en"), wake: wake(call("attack Foxtrot"), parked()), rules });
  const labels = [...options.keys()];
  assert.ok(labels.includes("attack:F") && labels.includes("move:F") && labels.includes("fallBack") && labels.includes("attack:target:3"));
  assert.ok(!labels.some((l) => l.startsWith("hold")) && !labels.includes("cover") && !labels.includes("attack:target:12"), labels.join(" "));
  assert.match(options.get("attack:F").about, /^strike /);
});
