// The fast brain: the grammar first, the decision model through the relay for what the
// grammar did not match, and the rule brain whenever the relay cannot decide. The relay
// is a fetch that answers from a script; nothing leaves the machine.

import assert from "node:assert/strict";
import { test } from "node:test";

import { choose, jevBrain, optionsFor, tiered, THRESHOLD } from "../brain-jev.mjs";
import { callOf, leader, orders, rules, run, status, viper1 } from "./orders.mjs";

const hammer = { key: "player", en: "Hammer", he: "פטיש" };
const call = (body, extra = {}) => ({ from: hammer, to: [viper1], lang: /[א-ת]/.test(body) ? "he" : "en", body, end: "over", points: [], prowords: [], landmarks: [], ...extra });
const wake = (c, st = status()) => ({ items: [{ kind: "radio", msg: c }], call: c, status: st });

// relay answers every decision with `answer(body)`: an object for 200, { error, status } otherwise.
function relay(answer) {
  const seen = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push({ url, headers: init.headers, body });
    const got = await answer(body);
    const failed = got.error ? { error: { code: got.error, message: got.error } } : null;
    return { ok: !failed, status: failed ? (got.status ?? 503) : 200, headers: new Headers(), text: async () => JSON.stringify(failed ?? got) };
  };
  return { fetch, seen };
}
const says = (choice, p, more = {}) => ({ choice, confidence: p, probabilities: { [choice]: p, ...more }, model: "jev-1.14.0", provider: "typesafe", usage: { input_tokens: 1400, output_tokens: 0 } });
const brainOn = (net, more = {}) => jevBrain({ base: "http://relay/relay/v1", room: "ROOM1", token: "player-token", seat: "seat-token", fetch: net.fetch, ...more });

test("a taught sentence never reaches the model: the grammar answers it for nothing", async () => {
  const net = relay(() => assert.fail("the relay was asked"));
  const brain = brainOn(net);
  for (const o of orders.filter((x) => x.kind === "T")) {
    const c = callOf(o);
    await run(brain, { agent: leader(o.lang), wake: wake(c) });
  }
  assert.equal(net.seen.length, 0);
  assert.equal(brain.slow, false, "no Stand by: the answer is there in a moment");
});

test("what the grammar does not match goes to the model once, and its choice is carried out in fixed words", async () => {
  const net = relay(() => says("hold:G", 0.93, { "move:G": 0.05 }));
  const used = [];
  const brain = brainOn(net, { onUsage: (...a) => used.push(a) });
  const c = call("we need you on the ford now", { points: ["G"] });
  assert.deepEqual(await run(brain, { agent: leader("en"), wake: wake(c) }), [
    ["hold", { place: "G" }],
    ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }],
  ]);
  assert.equal(net.seen.length, 1);
  const { url, headers, body } = net.seen[0];
  assert.equal(url, "http://relay/relay/v1/decide");
  assert.equal(headers.Authorization, "Bearer player-token");
  assert.equal(headers["X-Callsign-Seat"], "seat-token");
  assert.deepEqual(Object.keys(body).sort(), ["call", "options", "question", "room", "side", "situation", "squad"], "no model, no key and no address: the relay sets those");
  assert.deepEqual([body.room, body.side, body.squad, body.call], ["ROOM1", 0, 1, "we need you on the ford now"]);
  assert.match(body.question, /Viper 1/);
  // The options are what this squad can do here, each with both languages in its description.
  for (const name of ["move:G", "hold:G", "attack:G", "attack:target:3", "attack:target:7", "fallBack", "cover", "hold:here", "dig", "report", "say_again"]) assert.ok(name in body.options, name);
  assert.ok(!("hold:S" in body.options), "a land squad is not offered the sea rig");
  assert.match(body.options["hold:G"], /Golf \/ גימל/);
  assert.ok(Object.keys(body.options).length <= 64);
  for (const [name, about] of Object.entries(body.options)) assert.ok(/^[A-Za-z0-9_.:-]{1,48}$/.test(name) && about.length <= 300, name);
  assert.ok(JSON.stringify(body).length < 12000, "small enough for the relay's cap");
  assert.deepEqual(used, [[{ input_tokens: 1400, output_tokens: 0 }, "jev-1.14.0", "typesafe"]]);
  // The Hebrew net gets the Hebrew phrase; the model wrote none of it.
  const he = call("אנחנו צריכים אתכם על המעבר עכשיו");
  assert.deepEqual((await run(brain, { agent: leader("he"), wake: wake(he) })).at(-1), ["radio", { to: ["Hammer"], body: "רות, יבוצע", end: "out" }]);
});

test("below the threshold the squad asks, naming what it was torn between; the model's own 'say again' is one too", async () => {
  assert.equal(THRESHOLD, 0.67);
  const c = call("we need you on the ford now", { points: ["G"] });
  let net = relay(() => says("move:G", 0.62, { "attack:G": 0.36 }));
  assert.deepEqual(await run(brainOn(net), { agent: leader("en"), wake: wake(c) }), [["radio", { to: ["Hammer"], body: "Say again: move to Golf or attack Golf?", end: "over" }]]);
  assert.deepEqual(await run(brainOn(net), { agent: leader("he"), wake: wake({ ...c, lang: "he" }) }), [["radio", { to: ["Hammer"], body: "אמור שנית: לנוע לגימל או לתקוף את גימל?", end: "over" }]]);
  // The same answer acts when the host set the threshold lower.
  assert.deepEqual((await run(brainOn(net, { threshold: 0.6 }), { agent: leader("en"), wake: wake(c) }))[0], ["move", { place: "G" }]);
  // Sure that it is nothing: the grammar's own question stands.
  net = relay(() => says("say_again", 0.98));
  assert.deepEqual(await run(brainOn(net), { agent: leader("en"), wake: wake(c) }), [["radio", { to: ["Hammer"], body: "Say again: move, hold or attack Golf?", end: "over" }]]);
  // An option that was never offered is not acted on.
  net = relay(() => says("attack:Q", 0.99));
  assert.deepEqual((await run(brainOn(net), { agent: leader("en"), wake: wake(c) })).map(([name]) => name), ["radio"]);
  // choose, by itself.
  const options = optionsFor({ agent: leader("en"), wake: wake(c), rules });
  assert.equal(choose(says("hold:G", 0.67), options).label, "hold:G");
  assert.equal(choose(says("hold:G", 0.66), options).kind, "unclear");
  assert.equal(choose(says("say_again", 0.9, { "hold:G": 0.05 }), options), null);
  assert.equal(choose(says("attack:target:3", 0.5, { "attack:target:7": 0.45 }), options).say.vars.asks.length, 2);
});

test("when the relay cannot decide the squad answers as the rule brain would, and a relay that is off is left alone", async () => {
  const c = call("we need you on the ford now", { points: ["G"] });
  const asked = [["radio", { to: ["Hammer"], body: "Say again: move, hold or attack Golf?", end: "over" }]];
  for (const error of ["rate_limited", "provider_error", "not_your_seat", "bad_request"]) {
    const net = relay(() => ({ error, status: 429 }));
    const brain = brainOn(net);
    assert.deepEqual(await run(brain, { agent: leader("en"), wake: wake(c) }), asked, error);
    await run(brain, { agent: leader("en"), wake: wake(c) });
    assert.equal(net.seen.length, 2, `${error}: the next call tries again`);
  }
  // The day's ceiling, or no key on the relay: quiet, and no more calls for a while.
  const net = relay(() => ({ error: "decide_off", status: 503 }));
  const brain = brainOn(net);
  assert.deepEqual(await run(brain, { agent: leader("en"), wake: wake(c) }), asked);
  assert.deepEqual(await run(brain, { agent: leader("en"), wake: wake(c) }), asked);
  assert.equal(net.seen.length, 1);
  // No network at all.
  const down = jevBrain({ room: "ROOM1", fetch: async () => Promise.reject(new Error("offline")) });
  assert.deepEqual(await run(down, { agent: leader("en"), wake: wake(c) }), asked);
  // Taught orders go on working through all of it.
  assert.deepEqual((await run(brain, { agent: leader("en"), wake: wake(call("hold Delta", { points: ["D"] })) }))[0], ["hold", { place: "D" }]);
});

test("events, radio checks, other squads and Anvil never use the model", async () => {
  const net = relay(() => assert.fail("the relay was asked"));
  const brain = brainOn(net);
  const event = { items: [{ kind: "event", event: { kind: "pinned", point: "G" } }], call: null, status: status() };
  assert.equal((await run(brain, { agent: leader("en"), wake: event }))[0][0], "radio");
  assert.deepEqual(await run(brain, { agent: leader("en"), wake: wake(call("Radio check", { prowords: ["radioCheck"] })) }), [["radio", { to: ["Hammer"], body: "Five by five", end: "out" }]]);
  assert.deepEqual(await run(brain, { agent: leader("en"), wake: wake(call("blah blah", { from: { key: "infantry-2", en: "Viper 2" } })) }), []);
  const anvil = { role: "anvil", side: 0, squad: 0, tier: 1, station: { key: "operator", en: "Anvil", he: "סדן" }, lang: "en" };
  const st = { faction: "aegis", gold: 300, points: [], squads: [], command: { mode: "orders", buy: false } };
  assert.deepEqual(await run(brain, { agent: anvil, wake: wake(call("make me a sandwich"), st) }), [["radio", { to: ["Hammer"], body: "Say again", end: "over" }]]);
  assert.deepEqual((await run(brain, { agent: anvil, wake: wake(call("buy a tank"), st) }))[0], ["buy", { unit: "tank", upgrade: "" }]);
  // Without the grammar (for measuring the model alone) a radio check is still code's.
  const alone = brainOn(net, { grammar: false });
  assert.deepEqual(await run(alone, { agent: leader("en"), wake: wake(call("Radio check", { prowords: ["radioCheck"] })) }), [["radio", { to: ["Hammer"], body: "Five by five", end: "out" }]]);
});

test("the commander's view is told which brain answered: the grammar, or the model with its tokens", async () => {
  const net = relay(() => says("hold:G", 0.93));
  const brain = brainOn(net);
  const think = (c) => brain.think({ rules, messages: [{ role: "user", content: "wake" }], agent: leader("en"), wake: wake(c) });
  const byGrammar = await think(call("hold Delta", { points: ["D"] }));
  assert.equal(byGrammar.model, "grammar");
  assert.equal(byGrammar.usage, undefined);
  const byModel = await think(call("we need you on the ford now", { points: ["G"] }));
  assert.equal(byModel.model, "jev-1.14.0");
  assert.deepEqual(byModel.usage, { input_tokens: 1400, output_tokens: 0 });
  assert.equal(brain.plan({ role: "squad", tier: 2 }), "jev+rule-2");
  assert.equal(brain.plan({ role: "anvil", level: 2 }), "rule-2");
  assert.deepEqual([brain.nameFor({ role: "squad" }), brain.nameFor({ role: "anvil" })], ["jev", "rule"], "Anvil is the rule brain, and is shown as it");
});

test("with a player's key, tier-1 squads take orders through the fast brain and the rest keep the language model", async () => {
  const fast = { name: "jev", slow: false, plan: () => "jev+rule-1", think: async () => "fast" };
  const rest = { name: "relay", slow: true, plan: () => null, think: async () => "slow" };
  const brain = tiered({ fast, rest });
  const who = (role, tier) => brain.think({ agent: { role, tier } });
  assert.equal(await who("squad", 1), "fast");
  assert.equal(await who("squad", 2), "slow");
  assert.equal(await who("squad", 3), "slow");
  assert.equal(await who("anvil", 1), "slow", "Anvil stays on the language model");
  assert.deepEqual([brain.slowFor({ role: "squad", tier: 1 }), brain.slowFor({ role: "squad", tier: 2 })], [false, true], "only a language model says Stand by");
  assert.deepEqual([brain.nameFor({ role: "squad", tier: 1 }), brain.nameFor({ role: "anvil", tier: 1 })], ["jev", "relay"]);
});
