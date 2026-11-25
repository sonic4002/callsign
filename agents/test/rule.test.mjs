// The rule brain: what its grammar understands, what it says, and what each level of
// initiative adds, for squad leaders and for the operator.

import assert from "node:assert/strict";
import { test } from "node:test";

import { ruleBrain } from "../brain-rule.mjs";
import { leaderWords, scan, tidy } from "../rule-grammar.mjs";
import { fill, heGlue, phrase } from "../rule-phrases.mjs";
import { callOf, leader, measure, orders, rules, run, score, status, viper1 } from "./orders.mjs";

const hammer = { key: "player", en: "Hammer", he: "פטיש" };
const call = (body, extra = {}) => ({ from: hammer, to: [viper1], lang: /[א-ת]/.test(body) ? "he" : "en", body, end: "over", points: [], prowords: [], landmarks: [], ...extra });
const wake = (c, st = status()) => ({ items: [{ kind: "radio", msg: c }], call: c, status: st });
const event = (e, st = status()) => ({ items: [{ kind: "event", event: e }], call: null, status: st });

test("the grammar on the order set: every taught sentence in both languages, nine in ten of all, and never an action that was not ordered", async () => {
  const results = await measure(() => ruleBrain());
  const all = score(results);
  assert.ok(orders.length >= 120, "the set holds at least 120 orders");
  for (const lang of ["en", "he"]) {
    for (const kind of ["T", "P", "A"]) assert.ok(orders.filter((o) => o.lang === lang && o.kind === kind).length >= 20, `${lang} ${kind} has 20 orders`);
    const taught = score(results.filter((r) => r.order.lang === lang && r.order.kind === "T"));
    assert.equal(taught.right, taught.n, `taught ${lang}: ${taught.misses.join("; ")}`);
  }
  assert.equal(all.wrong, 0, `acted on what was not ordered: ${all.misses.join("; ")}`);
  assert.ok(all.right / all.n >= 0.9, `${all.right} of ${all.n} understood`);
  // What is not understood is asked about, with the place named when one was heard.
  const kilo = results.find((r) => r.order.text === "whole kilo");
  assert.deepEqual(kilo.calls, [["radio", { to: ["Hammer"], body: "Say again: move, hold or attack Kilo?", end: "over" }]]);
});

test("the same wake gives the same answer: nothing is drawn at random", async () => {
  for (const o of orders.slice(0, 40)) {
    const c = callOf(o);
    const once = await run(ruleBrain(), { agent: leader(o.lang, 3), wake: wake(c) });
    const twice = await run(ruleBrain(), { agent: leader(o.lang, 3), wake: wake(c) });
    assert.deepEqual(once, twice, o.text);
  }
});

test("order words are found in any order, behind filler, and not when negated", () => {
  const found = (s) => scan(tidy(s), /[א-ת]/.test(s) ? "he" : "en", leaderWords, rules).found.filter((f) => !f.negated).map((f) => f.cls);
  assert.deepEqual(found("Could you please hold Foxtrot for me"), ["hold"]);
  assert.deepEqual(found("move to Kilo, don't stop to fight"), ["move"]);
  assert.deepEqual(found("take out that technical"), ["attack"], "the longer wording wins: not 'take'");
  assert.deepEqual(found("a tack foxtrot"), ["attack"], "a recogniser's slip");
  assert.deepEqual(found("אל תתקפו, תחזיקו את פסל"), ["hold"]);
  assert.deepEqual(found("fence the north side"), [], "'side' is not 'shoot'");
});

test("the brain's lines: one table, both languages, Hebrew letters glued the Hebrew way", () => {
  for (const [key, w] of Object.entries(rules.radio.brain)) assert.equal(w.en.length, w.he.length, key);
  assert.equal(heGlue("ב", "הגשר המערבי"), "בגשר המערבי");
  assert.equal(heGlue("ל", "פסל"), "לפסל");
  assert.equal(fill("הגענו {l_place}, {count}", { place: "הבונקר", count: 2 }), "הגענו לבונקר, 2");
  assert.equal(phrase(rules, "he", "pinned", { place: "גימל" }, 0), "מרותקים בגימל, מבקש סיוע");
  assert.notEqual(phrase(rules, "en", "arrived", { place: "Golf" }, 0), phrase(rules, "en", "arrived", { place: "Golf" }, 1), "two squads do not sound alike");
  assert.throws(() => phrase(rules, "en", "no such line"));
});

test("a squad answers a status question from what it sees", async () => {
  const st = status();
  assert.deepEqual(await run(ruleBrain(), { agent: leader("en"), wake: wake(call("report"), st) }), [
    ["radio", { to: ["Hammer"], body: "Near Bravo, 6 of 6 men, awaiting orders, 1 enemy in sight, nearest Target 3", end: "over" }],
  ]);
  st.you.order = { kind: "hold", point: "D" };
  st.you.contacts = [];
  st.you.teams[0].nerve = "shaken";
  assert.deepEqual(await run(ruleBrain(), { agent: leader("he"), wake: wake(call("מה המצב"), st) }), [
    ["radio", { to: ["Hammer"], body: "ליד בועז, 6 מתוך 6 לוחמים, מחזיקים בדוד, אין מגע, אנחנו מעורערים", end: "over" }],
  ]);
});

test("level 1 does what it is told and reports; level 2 also takes cover, falls back once and picks what it can hurt", async () => {
  const tank = (tier) => ({ ...leader("en", tier), unit: rules.factions.aegis.units.tank, station: { key: "vehicle-1", en: "Rhino 1", he: "קרנף 1" } });
  const air = () => {
    const st = status();
    st.contacts = [{ id: 9, unit: "fpvSwarm", class: "air", near: "B", x: 470, y: 240, teams: [{}] }, ...st.contacts];
    return st;
  };
  // "Attack" with nothing named: level 1 goes for the nearest, level 2 for one its gun can hit.
  assert.deepEqual((await run(ruleBrain(), { agent: tank(1), wake: wake(call("attack"), air()) }))[0], ["attack", { place: "", contact: 9 }]);
  assert.deepEqual(await run(ruleBrain(), { agent: tank(2), wake: wake(call("attack"), air()) }), [
    ["attack", { place: "", contact: 3 }],
    ["radio", { to: ["Hammer"], body: "Wilco, engaging Target 3", end: "out" }],
  ]);
  // Sent at what it cannot hurt, level 2 says so; level 1 goes.
  const at9 = call("attack Target 9");
  assert.deepEqual((await run(ruleBrain(), { agent: tank(1), wake: wake(at9, air()) }))[0], ["attack", { place: "", contact: 9 }]);
  assert.deepEqual(await run(ruleBrain(), { agent: tank(2), wake: wake(at9, air()) }), [["radio", { to: ["Hammer"], body: "Negative, our weapons cannot hurt Target 9", end: "over" }]]);

  // Pinned with its men shaken: level 1 reports, level 2 pulls back to ground its side holds, once.
  const shaken = () => {
    const st = status();
    st.you = { ...st.you, near: "G", x: 780, y: 250, order: { kind: "hold", point: "G" }, teams: [{ nerve: "pinned", members: 2 }, { nerve: "shaken", members: 3 }] };
    return st;
  };
  const pinned = { kind: "pinned", point: "G" };
  const one = await run(ruleBrain(), { agent: leader("en", 1), wake: event(pinned, shaken()) });
  assert.deepEqual(one.map(([name]) => name), ["radio"]);
  const brain = ruleBrain();
  assert.deepEqual(await run(brain, { agent: leader("en", 2), wake: event(pinned, shaken()) }), [
    ["move", { place: "B" }],
    ["radio", { to: ["Hammer"], body: "We are shaken, pulling back to Bravo", end: "over" }],
  ]);
  assert.deepEqual((await run(brain, { agent: leader("en", 2), wake: event(pinned, shaken()) })).map(([name]) => name), ["radio"], "it falls back once for an order, not again and again");

  // Holding in the open with the enemy in sight: level 2 gets into the cover beside its post.
  const open = status();
  open.you.order = { kind: "hold", point: "B" };
  const contact = { kind: "contact", point: "G", contact: 3 };
  assert.deepEqual((await run(ruleBrain(), { agent: leader("en", 1), wake: event(contact, open) })).map(([name]) => name), ["radio"]);
  assert.deepEqual((await run(ruleBrain(), { agent: leader("en", 2), wake: event(contact, open) }))[0], ["hold", { place: "B-ruin-1" }]);
  // With nothing to do, it goes for the enemy it can hurt.
  assert.deepEqual(await run(ruleBrain(), { agent: leader("en", 2), wake: event(contact, status()) }), [
    ["attack", { place: "", contact: 3 }],
    ["radio", { to: ["Hammer"], body: "Engaging Target 3 near Golf", end: "over" }],
  ]);
});

test("level 3 comes at a defended point from the side, keeps a long weapon at its range and asks for support", async () => {
  // Foxtrot is defended (Target 7 stands on it): the squad goes to a spot off its flank, then in.
  const brain = ruleBrain();
  const flank = await run(brain, { agent: leader("en", 3), wake: wake(call("attack Foxtrot", { points: ["F"] })) });
  assert.equal(flank[0][0], "move");
  assert.match(flank[0][1].place, /^(N|S|E|W|NE|NW|SE|SW) of F 120$/);
  assert.match(flank[1][1].body, /^Wilco, going in from the (north|south|east|west)$/);
  assert.deepEqual(await run(brain, { agent: leader("en", 3), wake: event({ kind: "arrived", point: "F" }) }), [["attack", { place: "F", contact: 0 }]], "at the flank spot it goes in");
  // Level 2 goes straight, and so does level 3 at an undefended point.
  assert.deepEqual((await run(ruleBrain(), { agent: leader("en", 2), wake: wake(call("attack Foxtrot", { points: ["F"] })) }))[0], ["attack", { place: "F", contact: 0 }]);
  assert.deepEqual((await run(ruleBrain(), { agent: leader("en", 3), wake: wake(call("attack Hotel", { points: ["H"] })) }))[0], ["attack", { place: "H", contact: 0 }]);
  // The flank spot refused (water, a mountain): the plain order instead.
  const refuse = ruleBrain();
  const messages = [{ role: "user", content: "wake" }];
  const c = call("attack Foxtrot", { points: ["F"] });
  const ctx = { rules, messages, agent: leader("en", 3), wake: wake(c) };
  const first = await refuse.think(ctx);
  messages.push({ role: "assistant", content: first.content }, { role: "user", content: [{ type: "tool_result", tool_use_id: first.content[0].id, content: "that squad cannot reach that place", is_error: true }] });
  const second = await refuse.think(ctx);
  assert.deepEqual([second.content[0].name, second.content[0].input], ["attack", { place: "F", contact: 0 }]);

  // A rocket launcher holds short of the point, at four fifths of its reach, on its own side of it.
  const rockets = { ...leader("en", 3), unit: rules.factions.aegis.units.rocketLauncher, station: { key: "vehicle-2", en: "Rhino 2", he: "קרנף 2" } };
  assert.deepEqual(await run(ruleBrain(), { agent: rockets, wake: wake(call("attack Zulu", { points: ["Z"] })) }), [
    ["hold", { place: "W of Z 340" }],
    ["radio", { to: ["Hammer"], body: "Wilco, engaging from 340 metres", end: "out" }],
  ]);
  // And with the enemy inside its reach it backs off to a point of its own.
  const close = status();
  close.contacts = [{ id: 3, unit: "technical", class: "vehicle", near: "B", x: 500, y: 240, teams: [{}] }];
  close.you = { ...close.you, near: "G", x: 560, y: 240 };
  assert.deepEqual((await run(ruleBrain(), { agent: rockets, wake: event({ kind: "contact", point: "B", contact: 3 }, close) }))[0], ["move", { place: "B" }]);

  // Outnumbered: it says so, and not again within the next moments.
  const many = status();
  many.you.order = { kind: "hold", point: "B" };
  many.you.teams = [{ nerve: "steady", members: 3, cover: 0.7 }];
  many.contacts = [3, 7].map((id, i) => ({ id, unit: "militia", class: "infantry", near: "B", x: 500 + 40 * i, y: 260, teams: [{}, {}] }));
  const asks = ruleBrain();
  const said = (await run(asks, { agent: leader("en", 3), wake: event({ kind: "contact", point: "B", contact: 3 }, many) })).at(-1)[1].body;
  assert.match(said, /request support/i);
  assert.doesNotMatch((await run(asks, { agent: leader("en", 3), wake: event({ kind: "contact", point: "B", contact: 3 }, many) })).at(-1)[1].body, /request support/i);
  assert.doesNotMatch((await run(ruleBrain(), { agent: leader("en", 2), wake: event({ kind: "contact", point: "B", contact: 3 }, many) })).at(-1)[1].body, /request support/i);
});

// ---- the operator ----

const anvil = (level, lang = "en") => ({ role: "anvil", side: 0, squad: 0, tier: 1, station: { key: "operator", en: "Anvil", he: "סדן" }, lang, level });
const squad = (n, more = {}) => ({ callsign: { en: `Viper ${n}`, he: `צפע ${n}` }, class: "infantry", unit: "commandos", x: 150 + 20 * n, y: 480, order: { kind: "none" }, alive: 6, full: 6, ...more });
const base = (mode, buy, extra = {}) => ({
  faction: "aegis",
  gold: 900,
  timeLeft: 500,
  command: { mode, buy },
  points: [{ id: "A", owner: 0 }, { id: "B", owner: -1 }, { id: "D", owner: -1 }, { id: "F", owner: -1 }, { id: "G", owner: -1 }, { id: "H", owner: -1 }, { id: "K", owner: -1 }, { id: "S", owner: -1 }, { id: "Z", owner: 1 }],
  squads: [squad(1), squad(2, { order: { kind: "hold", point: "D" } })],
  deploying: [],
  structures: [
    { id: "s1", kind: "barracks", role: "barracks", name: "Barracks", side: 0, yours: true, hp: 1, building: 1 },
    { id: "s2", kind: "refinery", role: "refinery", name: "Refinery", side: 0, yours: true, hp: 1, building: 1 },
  ],
  haulers: [{ id: 1001, side: 0 }, { id: 1002, side: 0 }],
  ...extra,
});
const toAnvil = (body, extra) => call(body, { to: [anvil(3).station], ...extra });
const ask = (level, body, st, extra) => run(ruleBrain(), { agent: anvil(level, /[א-ת]/.test(body) ? "he" : "en"), wake: wake(toAnvil(body, extra), st) });

test("the operator reads counts, several orders in one call, and orders for everyone", async () => {
  const st = base("orders", false);
  const wilco = ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }];
  const tank = ["buy", { unit: "tank", upgrade: "" }];
  assert.deepEqual(await ask(1, "buy two tanks", st), [tank, tank, wilco]);
  assert.deepEqual(await ask(1, "קנה שלושה טנקים", st), [tank, tank, tank, ["radio", { to: ["Hammer"], body: "רות, יבוצע", end: "out" }]]);
  assert.deepEqual(await ask(1, "build a refinery, then a barracks", st), [
    ["build", { structure: "refinery", place: "", place2: "" }],
    ["build", { structure: "barracks", place: "", place2: "" }],
    wilco,
  ]);
  assert.deepEqual(await ask(1, "buy a tank and a helicopter", st), [tank, ["buy", { unit: "helicopter", upgrade: "" }], wilco]);
  // A spot is one place, not two orders.
  assert.deepEqual(await ask(1, "build a vehicle works 140 metres north and 60 metres east of Alpha", st, { points: ["A"] }), [
    ["build", { structure: "vehicleWorks", place: "140 metres north and 60 metres east of Alpha", place2: "" }],
    wilco,
  ]);
  // The second purchase refused: the reason goes to Hammer and the third is not tried.
  const brain = ruleBrain();
  const messages = [{ role: "user", content: "wake" }];
  const ctx = { rules, messages, agent: anvil(1), wake: wake(toAnvil("buy three tanks"), st) };
  const seen = [];
  for (let i = 0; i < 6; i++) {
    const res = await brain.think(ctx);
    const use = res.content.find((b) => b.type === "tool_use");
    if (!use) break;
    seen.push([use.name, use.input.body ?? use.input.unit]);
    messages.push({ role: "assistant", content: res.content }, { role: "user", content: [{ type: "tool_result", tool_use_id: use.id, ...(seen.length === 2 ? { content: "not enough gold: need 250, have 50", is_error: true } : { content: "{}" }) }] });
  }
  assert.deepEqual(seen, [["buy", "tank"], ["buy", "tank"], ["radio", "Negative, not enough gold: need 250, have 50"]]);

  assert.deepEqual(await ask(1, "attack with everything", st), [["radio", { to: ["Viper 1", "Viper 2"], body: "Attack Zulu", end: "over" }], wilco]);
  assert.deepEqual((await ask(1, "תקפו עם הכל את כרמל", st, { points: ["K"] }))[0], ["radio", { to: ["Viper 1", "Viper 2"], body: "תקפו את כרמל", end: "over" }]);
  assert.deepEqual(await ask(1, "defend the base", st), [["radio", { to: ["Viper 1"], body: "Hold Alpha", end: "over" }], wilco]);
  assert.deepEqual(await ask(1, "send Viper 2 to Golf", st, { points: ["G"] }), [["radio", { to: ["Viper 2"], body: "Move to Golf", end: "over" }], wilco]);
  assert.deepEqual(await ask(1, "take point Delta", st, { points: ["D"] }), [["radio", { to: ["Viper 1", "Viper 2"], body: "take point Delta", end: "over" }], wilco]);
  // Not understood: asked about, with what was heard.
  assert.deepEqual(await ask(1, "buy", st), [["radio", { to: ["Hammer"], body: "Say again: buy what?", end: "over" }]]);
  assert.deepEqual(await ask(1, "Delta", st, { points: ["D"] }), [["radio", { to: ["Hammer"], body: "Say again: move, hold or attack Delta?", end: "over" }]]);
  assert.deepEqual(await ask(1, "sing me a song", st), [["radio", { to: ["Hammer"], body: "Say again", end: "over" }]]);
});

test("a squad does not report an enemy the net has just heard named", async () => {
  const contact = { kind: "contact", point: "G", contact: 3 };
  const heardIt = (traffic) => run(ruleBrain(), { agent: leader("en", 1), wake: { ...event(contact), traffic } });
  assert.equal((await heardIt([])).length, 1);
  assert.equal((await heardIt(["Anvil, this is Rhino 2. Contact, Target 3 near Golf. Over."])).length, 0);
  assert.equal((await heardIt(["סדן, כאן קרנף 2, מגע, מטרה 3 ליד גימל, עבור."])).length, 0);
  assert.equal((await heardIt(["Anvil, this is Rhino 2. Contact, Target 31 near Golf. Over."])).length, 1, "Target 31 is not Target 3");
  // What it does about the enemy is not silenced, only the report.
  assert.deepEqual((await run(ruleBrain(), { agent: leader("en", 2), wake: { ...event(contact), traffic: ["Hammer, this is Viper 2. Contact, Target 3 near Golf. Over."] } }))[0], ["attack", { place: "", contact: 3 }]);
});

test("a squad does not report what the net says another squad met first, and still acts on it", async () => {
  const known = (e, level) => run(ruleBrain(), { agent: leader("en", level), wake: { items: [{ kind: "event", event: e, known: true }], call: null, status: status() } });
  assert.deepEqual(await known({ kind: "contact", point: "G", contact: 3 }, 1), []);
  assert.deepEqual(await known({ kind: "arrived", point: "G" }, 1), []);
  assert.deepEqual(await known({ kind: "contact", point: "G", contact: 3 }, 2), [["attack", { place: "", contact: 3 }]], "it goes for the enemy, and says nothing");
});

test("the operator tells Hammer of a fight once, by its place, and passes on no squad's report word for word", async () => {
  const brain = ruleBrain();
  const report = (who, body, extra = {}) => ({ kind: "heard", forMe: true, msg: { from: { key: `infantry-${who}`, en: `Viper ${who}`, he: `צפע ${who}`, squad: who }, to: [{ key: "operator", en: "Anvil", he: "סדן" }], lang: "en", body, end: "over", kind: "contact", points: ["G"], prowords: [], landmarks: [], ...extra } });
  const on = (items, timeLeft, lang = "en") => run(brain, { agent: { ...anvil(1), lang }, wake: { items, call: null, status: base("orders", false, { timeLeft }) } });
  // Two squads report the same fight in one wake: one line to Hammer, marked as a contact.
  assert.deepEqual(await on([report(1, "Contact, Target 3 near Golf"), report(2, "Contact, Target 4 near Golf")], 500), [["radio", { to: ["Hammer"], body: "Viper 1 in contact near Golf", end: "out", kind: "contact" }]]);
  // The same fight a little later is not told again; another place is; and after a while the first is news again.
  assert.deepEqual(await on([report(2, "Eyes on Target 5 near Golf")], 480), []);
  assert.deepEqual(await on([report(2, "Contact near Foxtrot", { points: ["F"] })], 470, "he"), [["radio", { to: ["Hammer"], body: "צפע 2 במגע ליד פסל", end: "out", kind: "contact" }]]);
  assert.deepEqual((await on([report(2, "Contact near Golf")], 400)).length, 1);
  // What is not a contact, and what was not said to the operator, is not passed on.
  assert.deepEqual(await on([report(1, "In position at Golf", { kind: "objective" })], 300), []);
  assert.deepEqual(await on([{ ...report(1, "Contact near Kilo", { points: ["K"] }), forMe: false }], 300), []);
});

test("the operator's three levels: orders only, the economy with the purse, the fight when handed it", async () => {
  const heard = (level, st) => run(ruleBrain(), { agent: anvil(level), wake: { items: [{ kind: "heard", msg: call("Wilco", { from: viper1, end: "out" }) }], call: null, status: st } });
  // Level 1 never acts on its own, whatever it holds, and says so when handed more.
  assert.deepEqual(await heard(1, base("fight", true)), []);
  assert.deepEqual(await ask(1, "run the fight", base("fight", true)), [["radio", { to: ["Hammer"], body: "Negative, I act on your orders only; give me the order", end: "over" }]]);
  assert.deepEqual(await ask(1, "you may buy", base("orders", true)), [["radio", { to: ["Hammer"], body: "Negative, I act on your orders only; give me the order", end: "over" }]]);
  // Level 2 spends when it holds the purse and tasks nobody.
  assert.deepEqual(await heard(2, base("orders", false)), [], "without the purse it does nothing");
  assert.deepEqual(await heard(2, base("fight", true)), [["buy", { unit: "commandos", upgrade: "" }]]);
  assert.deepEqual(await ask(2, "run the fight", base("fight", true)), [
    ["radio", { to: ["Hammer"], body: "Negative, I keep the base and the purse; the squads are yours to order", end: "over" }],
    ["buy", { unit: "commandos", upgrade: "" }],
  ]);
  assert.deepEqual(await ask(2, "you may buy", base("orders", true)), [["radio", { to: ["Hammer"], body: "Wilco", end: "out" }], ["buy", { unit: "commandos", upgrade: "" }]]);
  // The field full and gold to spare: a better leader for a squad instead of gold lying unspent.
  const full = base("orders", true, { gold: 1200, squads: [1, 2, 3, 4].map((n) => squad(n, { id: n, tier: n === 1 ? 2 : 1, order: { kind: "hold", point: "D" } })).concat([5, 6, 7, 8].map((n) => squad(n, { id: n, tier: 1, class: "vehicle", unit: "tank", callsign: { en: `Rhino ${n - 4}` }, order: { kind: "hold", point: "D" } }))), structures: [...base("orders", true).structures, { id: "s3", kind: "vehicleWorks", role: "works", name: "Vehicle Works", side: 0, yours: true, hp: 1, building: 1 }] });
  assert.deepEqual(await heard(2, full), [["buy", { unit: "", upgrade: "Viper 2" }]]);
  // A hauler shot at: no new hauler is sent into the same guns; a squad is bought instead.
  const works = base("orders", true, { haulers: [{ id: 1001, side: 0 }], structures: [...base("orders", true).structures, { id: "s3", kind: "vehicleWorks", role: "works", name: "Vehicle Works", side: 0, yours: true, hp: 1, building: 1 }] });
  assert.deepEqual(await heard(2, works), [["buy", { unit: "crawler", upgrade: "" }]]);
  const shot = ruleBrain();
  const lost = { items: [{ kind: "event", event: { kind: "hauler_lost", hauler: 1002, point: "B" } }], call: null, status: works };
  assert.deepEqual(await run(shot, { agent: anvil(2), wake: lost }), [["buy", { unit: "commandos", upgrade: "" }]]);
  assert.deepEqual(await run(shot, { agent: anvil(2), wake: { items: [{ kind: "heard", msg: call("Wilco", { from: viper1, end: "out" }) }], call: null, status: { ...works, timeLeft: 440 } } }), [["buy", { unit: "commandos", upgrade: "" }]], "a minute later, still not");
  assert.deepEqual(await run(shot, { agent: anvil(2), wake: { items: [{ kind: "heard", msg: call("Wilco", { from: viper1, end: "out" }) }], call: null, status: { ...works, timeLeft: 400 } } }), [["buy", { unit: "crawler", upgrade: "" }]], "once the field has been quiet, the hauler is replaced");
  // Level 3 with the fight also sends the idle squad to the nearest point nobody of ours is on.
  assert.deepEqual(await heard(3, base("fight", true)), [["buy", { unit: "commandos", upgrade: "" }], ["radio", { to: ["Viper 1"], body: "Hold Bravo", end: "over" }]]);
  assert.deepEqual(await heard(3, base("orders", false)), [], "on orders it waits, at every level");
});

test("the level-3 operator guards its haulers, comes home to a base under attack, and masses before it attacks", async () => {
  const held = (extra = {}) => base("fight", false, { points: [{ id: "A", owner: 0 }, { id: "B", owner: 0 }, { id: "D", owner: 0 }, { id: "F", owner: 0 }, { id: "G", owner: 0 }, { id: "H", owner: 0 }, { id: "K", owner: 0 }, { id: "S", owner: -1 }, { id: "Z", owner: 1 }], ...extra });
  const on = (st, ...events) => run(ruleBrain(), { agent: anvil(3), wake: { items: events.map((e) => ({ kind: "event", event: e })), call: null, status: st } });

  // A hauler shot at: the nearest free squad holds its field, and Hammer is told once.
  const st = held({ squads: [squad(1, { order: { kind: "hold", point: "D" } }), squad(2, { x: 500, y: 300, order: { kind: "hold", point: "G" } })], haulers: [{ id: 1001, side: 0, field: "B" }] });
  assert.deepEqual(await on(st, { kind: "hauler_attacked", hauler: 1001, point: "B", field: "B" }), [
    ["radio", { to: ["Viper 2"], body: "Hold Bravo", end: "over" }],
    ["radio", { to: ["Hammer"], body: "Viper 2 is going to guard the haulers at Bravo", end: "out", kind: "contact" }],
  ]);
  // The headquarters under attack: the two nearest come home.
  const far = held({ squads: [squad(1, { x: 800, y: 500, order: { kind: "hold", point: "F" } }), squad(2, { x: 450, y: 690, order: { kind: "hold", point: "D" } }), squad(3, { x: 1150, y: 690, order: { kind: "hold", point: "H" } })] });
  assert.deepEqual(await on(far, { kind: "hq_under_attack" }), [
    ["radio", { to: ["Viper 2", "Viper 1"], body: "Hold Alpha", end: "over" }],
    ["radio", { to: ["Hammer"], body: "Pulling back to defend the base: Viper 2 and Viper 1", end: "out", kind: "contact" }],
  ]);
  // Every point ours, one squad on each, and three more without work: those three gather at the
  // point nearest the enemy, then go in together. The squads on the points stay.
  const posts = [squad(1, { x: 800, y: 500, order: { kind: "hold", point: "F" } }), squad(2, { x: 450, y: 690, order: { kind: "hold", point: "D" } }), squad(3, { x: 450, y: 230, order: { kind: "hold", point: "B" } })];
  const gather = await on(held({ squads: [...posts, squad(4), squad(5), squad(6)] }), { kind: "quiet" });
  assert.deepEqual(gather, [
    ["radio", { to: ["Viper 4", "Viper 5", "Viper 6"], body: "Hold Hotel", end: "over" }],
    ["radio", { to: ["Hammer"], body: "Massing at Hotel before the attack", end: "out", kind: "status" }],
  ]);
  const atHotel = [4, 5, 6].map((n) => squad(n, { x: 1150 + 10 * n, y: 690, order: { kind: "hold", point: "H" } }));
  assert.deepEqual(await on(held({ squads: [...posts, ...atHotel] }), { kind: "quiet" }), [
    ["radio", { to: ["Viper 4", "Viper 5", "Viper 6"], body: "Attack Zulu", end: "over" }],
    ["radio", { to: ["Hammer"], body: "Attacking Zulu with 3 squads", end: "out", kind: "contact" }],
  ]);
  // A free point in the middle is taken by one squad, unless an enemy squad is seen by it.
  const middle = (contacts) => base("fight", false, { squads: [squad(1, { order: { kind: "hold", point: "B" } }), squad(2, { order: { kind: "hold", point: "D" } }), squad(3)], points: [{ id: "A", owner: 0 }, { id: "B", owner: 0 }, { id: "D", owner: 0 }, { id: "F", owner: -1 }, { id: "G", owner: 0 }, { id: "H", owner: 1 }, { id: "K", owner: 1 }, { id: "S", owner: -1 }, { id: "Z", owner: 1 }], contacts });
  assert.deepEqual(await on(middle([]), { kind: "quiet" }), [["radio", { to: ["Viper 3"], body: "Hold Foxtrot", end: "over" }]]);
  assert.deepEqual(await on(middle([{ id: 9, class: "vehicle", unit: "technical", x: 840, y: 560 }]), { kind: "quiet" }), [["radio", { to: ["Viper 3"], body: "Hold Golf", end: "over" }]], "with the enemy on it, the squad waits at the forward point instead");
  // What Anvil says about it goes to Hammer, also when a squad was the last to call it.
  const toHammer = await run(ruleBrain(), { agent: { ...anvil(3), commander: "Rhino 1" }, wake: { items: [{ kind: "event", event: { kind: "quiet" } }], call: null, status: held({ squads: [...posts, ...atHotel] }) } });
  assert.deepEqual(toHammer[1][1].to, ["Hammer"]);
  // A point that is not ours is taken the same way: together, and to hold. Never one squad at a
  // time, and never one squad alone onto the enemy's half of the map.
  const kiloLost = (squads, kilo = 1) => held({ squads, points: [{ id: "A", owner: 0 }, { id: "B", owner: 0 }, { id: "D", owner: 0 }, { id: "F", owner: 0 }, { id: "G", owner: 0 }, { id: "H", owner: 0 }, { id: "K", owner: kilo }, { id: "S", owner: -1 }, { id: "Z", owner: 1 }] });
  assert.deepEqual(await on(kiloLost([...posts, squad(4)]), { kind: "quiet" }), [["radio", { to: ["Viper 4"], body: "Hold Hotel", end: "over" }]], "one idle squad waits at the forward point");
  assert.deepEqual(await on(kiloLost([...posts, squad(4)], -1), { kind: "quiet" }), [["radio", { to: ["Viper 4"], body: "Hold Hotel", end: "over" }]], "and does not walk alone to a free point by the enemy's base");
  assert.deepEqual(await on(kiloLost([...posts, ...atHotel]), { kind: "quiet" }), [
    ["radio", { to: ["Viper 4", "Viper 5", "Viper 6"], body: "Hold Kilo", end: "over" }],
    ["radio", { to: ["Hammer"], body: "Attacking Kilo with 3 squads", end: "out", kind: "contact" }],
  ]);
  // A structure shot at away from the headquarters: the squads go to it, not home.
  assert.deepEqual((await on(far, { kind: "structure_attacked", point: "B", structure: "s2", unit: "refinery" }))[0], ["radio", { to: ["Viper 1", "Viper 2"], body: "Hold Bravo", end: "over" }]);
  // A squad Hammer ordered by name is left alone: three at the forward point, one of them
  // Hammer's, are two to spare, and an idle one of Hammer's is given no task.
  assert.deepEqual(await on(held({ squads: [...posts, ...atHotel], hammerOrdered: ["Viper 5"] }), { kind: "quiet" }), []);
  assert.deepEqual(await on(middle([]), { kind: "quiet" }), [["radio", { to: ["Viper 3"], body: "Hold Foxtrot", end: "over" }]]);
  assert.deepEqual(await on({ ...middle([]), hammerOrdered: ["Viper 3"] }, { kind: "quiet" }), []);
  // With two squads to spare it holds what it has and attacks nothing.
  assert.deepEqual(await on(held({ squads: [...posts, ...atHotel.slice(0, 2)] }), { kind: "quiet" }), []);
});
