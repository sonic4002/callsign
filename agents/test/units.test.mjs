import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { compactStatus, renderWake } from "../agent.mjs";
import { claudeBrain, models } from "../brain-claude.mjs";
import { scriptedBrain } from "../brain-scripted.mjs";
import { makeBrain } from "../main.mjs";
import { leaderPrompt, operatorPrompt } from "../prompts.mjs";
import { leaderTools, leaderToolsFor, normalize, operatorTools } from "../tools.mjs";

const rules = JSON.parse(readFileSync(new URL("../../shared/rules.json", import.meta.url)));
const viper2 = { key: "infantry-2", en: "Viper 2", he: "צפע 2", squad: 2 };
const hammer = { key: "player", en: "Hammer", he: "פטיש" };

test("the game tools: the six in the design, build and haul for the operator, capture and repair for engineers only", () => {
  const names = (tools) => tools.map((t) => t.name).sort();
  assert.deepEqual(names(leaderTools), ["attack", "hold", "move", "radio", "report"]);
  assert.deepEqual(names(operatorTools), ["build", "buy", "command", "haul", "radio", "report"]);
  const { units } = rules.factions.aegis;
  assert.deepEqual(names(leaderToolsFor(units.commandos)), names(leaderTools));
  assert.deepEqual(names(leaderToolsFor(units.engineers)), ["attack", "capture", "hold", "move", "radio", "repair", "report"]);
  for (const t of [...leaderToolsFor(units.engineers), ...operatorTools]) {
    assert.equal(t.strict, true);
    assert.equal(t.input_schema.additionalProperties, false);
    assert.deepEqual(t.input_schema.required, Object.keys(t.input_schema.properties));
  }
});

test("normalize drops the placeholders strict schemas force", () => {
  assert.deepEqual(normalize("attack", { point: "", contact: 3 }), { contact: 3 });
  assert.deepEqual(normalize("attack", { point: "Zulu", contact: 0 }), { point: "Zulu" });
  assert.deepEqual(normalize("hold", { point: "here" }), {});
  assert.deepEqual(normalize("hold", { point: "F" }), { point: "F" });
  assert.deepEqual(normalize("buy", { unit: "tank", upgrade: "" }), { unit: "tank" });
  assert.deepEqual(normalize("report", {}), {});
});

test("prompts name the agent, both languages of the procedure, and every map point", () => {
  const unit = rules.factions.aegis.units.commandos;
  const leader = leaderPrompt({ rules, side: 0, faction: "aegis", station: viper2, unit });
  const operator = operatorPrompt({ rules, side: 1, faction: "ashfall" });
  for (const text of [leader, operator]) {
    for (const p of rules.map.points) assert.ok(text.includes(p.callsign.en) && text.includes(p.callsign.he), p.id);
    for (const word of ["Wilco", "רות, יבוצע", "Say again", "אמור שנית", "Never both"]) assert.ok(text.includes(word), word);
    assert.ok(!/over and out/i.test(text));
  }
  assert.ok(leader.includes("Viper 2") && leader.includes("צפע 2") && leader.includes("Aegis Directorate doctrine"));
  assert.ok(leader.includes("A: Alpha / אלף") && leader.includes("your headquarters"));
  assert.ok(operator.includes("technical") && operator.includes("Ashfall Network doctrine"));
  assert.ok(/Z: Zulu[^\n]*your headquarters/.test(operator), "side 1's own headquarters is Zulu");
});

test("a wake shows the call, the status and the net traffic", () => {
  const msg = { from: hammer, to: [viper2], lang: "he", text: "צפע 2, כאן פטיש, תחזיקו את פסל, עבור.", points: ["F"] };
  const status = compactStatus(
    {
      timeLeft: 500,
      points: [{ id: "A", owner: 0 }, { id: "F", owner: -1 }, { id: "Z", owner: 1 }],
      contacts: [{ id: 3, unit: "militia", class: "infantry", near: "G", x: 1, y: 2, teams: [{}, {}] }],
      friends: [],
      you: { near: "A", x: 220, y: 450, order: { kind: "none" }, alive: 6, full: 6, tier: 1, teams: [{ nerve: "steady", action: "idle" }], contacts: [3] },
    },
    0,
  );
  assert.deepEqual(status.points, { A: "yours", F: "neutral", Z: "enemy" });
  assert.equal(status.contacts[0].teams, 2);
  const text = renderWake([{ kind: "radio", msg }, { kind: "event", event: { kind: "pinned", point: "G" } }], status, ["earlier line"]);
  assert.ok(text.includes('Radio call for you from Hammer, in Hebrew: "צפע 2, כאן פטיש, תחזיקו את פסל, עבור." Points named: F.'));
  assert.ok(text.includes("Your squad is pinned near G."));
  assert.ok(text.includes('"strength":"6/6"') && text.includes("earlier line"));
});

// think drives a brain through one wake the way the agent loop does, with every tool succeeding
// unless `fail` names it.
async function think(brain, ctx, fail = {}) {
  const messages = [{ role: "user", content: "wake" }];
  const calls = [];
  for (let i = 0; i < 6; i++) {
    const res = await brain.think({ rules, messages, ...ctx });
    messages.push({ role: "assistant", content: res.content });
    const uses = res.content.filter((b) => b.type === "tool_use");
    if (!uses.length) return calls;
    calls.push(...uses.map((u) => [u.name, u.input]));
    messages.push({
      role: "user",
      content: uses.map((u) => (fail[u.name] ? { type: "tool_result", tool_use_id: u.id, content: fail[u.name], is_error: true } : { type: "tool_result", tool_use_id: u.id, content: "{}" })),
    });
  }
  assert.fail("the brain never ended its turn");
}

const leader = { role: "squad", side: 0, squad: 2, tier: 1, station: viper2, lang: "en" };
const call = (body, extra = {}) => ({ from: hammer, to: [viper2], lang: "en", body, end: "over", points: [], prowords: [], ...extra });

test("scripted leader: order, act, then Wilco, in the caller's language", async () => {
  const brain = scriptedBrain();
  const wake = (c) => ({ items: [{ kind: "radio", msg: c }], call: c, status: null });
  assert.deepEqual(await think(brain, { agent: leader, wake: wake(call("Hold Foxtrot", { points: ["F"] })) }), [
    ["hold", { point: "F" }],
    ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }],
  ]);
  assert.deepEqual(await think(brain, { agent: leader, wake: wake(call("תחזיקו את פסל", { lang: "he", points: ["F"] })) }), [
    ["hold", { point: "F" }],
    ["radio", { to: ["Hammer"], body: "רות, יבוצע", end: "out" }],
  ]);
  assert.deepEqual(await think(brain, { agent: leader, wake: wake(call("Attack Zulu", { points: ["Z"] })) }), [
    ["attack", { point: "Z", contact: 0 }],
    ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }],
  ]);
  assert.deepEqual(await think(brain, { agent: leader, wake: wake(call("Move to the bridge", { points: ["G"] })) }), [
    ["move", { point: "G" }],
    ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }],
  ]);
  assert.deepEqual(await think(brain, { agent: leader, wake: wake(call("Hold")) }), [
    ["hold", { point: "here" }],
    ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }],
  ]);
});

test("scripted leader: Negative with the reason, Say again, radio check, and silence", async () => {
  const brain = scriptedBrain();
  const wake = (c) => ({ items: [{ kind: "radio", msg: c }], call: c, status: null });
  assert.deepEqual(await think(brain, { agent: leader, wake: wake(call("Hold Sierra", { points: ["S"] })) }, { hold: "that squad cannot reach that point" }), [
    ["hold", { point: "S" }],
    ["radio", { to: ["Hammer"], body: "Negative, that squad cannot reach that point", end: "over" }],
  ]);
  assert.deepEqual(await think(brain, { agent: leader, wake: wake(call("Do the thing with the stuff")) }), [["radio", { to: ["Hammer"], body: "Say again", end: "over" }]]);
  assert.deepEqual(await think(brain, { agent: leader, wake: wake(call("מה?", { lang: "he" })) }), [["radio", { to: ["Hammer"], body: "אמור שנית", end: "over" }]]);
  assert.deepEqual(await think(brain, { agent: leader, wake: wake(call("Radio check", { prowords: ["radioCheck"] })) }), [["radio", { to: ["Hammer"], body: "Five by five", end: "out" }]]);
  // Another squad is not in this squad's chain of command.
  assert.deepEqual(await think(brain, { agent: leader, wake: wake(call("Hold Foxtrot", { from: { key: "infantry-1", en: "Viper 1" }, points: ["F"] })) }), []);
  // Events are reported to whoever gave the current order.
  const pinned = { items: [{ kind: "event", event: { kind: "pinned", point: "G" } }], call: null, status: null };
  assert.deepEqual(await think(brain, { agent: { ...leader, commander: "Anvil" }, wake: pinned }), [["radio", { to: ["Anvil"], body: "Pinned at Golf, request support", end: "over" }]]);
  assert.deepEqual(await think(brain, { agent: { ...leader, lang: "he" }, wake: pinned }), [["radio", { to: ["Hammer"], body: "מרותקים בגימל, מבקש סיוע", end: "over" }]]);
});

test("scripted operator: relays tasks, buys, reports", async () => {
  const brain = scriptedBrain();
  const anvil = { role: "anvil", side: 0, squad: 0, tier: 1, station: { key: "operator", en: "Anvil", he: "סדן" }, lang: "en" };
  const status = {
    faction: "aegis",
    gold: 300,
    points: [{ id: "A", owner: 0 }, { id: "B", owner: 0 }, { id: "Z", owner: 1 }],
    squads: [
      { callsign: { en: "Viper 1" }, class: "infantry" },
      { callsign: { en: "Viper 2" }, class: "infantry" },
      { callsign: { en: "Shark 1" }, class: "naval" },
    ],
  };
  const wake = (c) => ({ items: [{ kind: "radio", msg: c }], call: c, status });
  assert.deepEqual(await think(brain, { agent: anvil, wake: wake(call("Hold Foxtrot", { points: ["F"] })) }), [
    ["radio", { to: ["Viper 1", "Viper 2"], body: "Hold Foxtrot", end: "over" }],
    ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }],
  ]);
  assert.deepEqual(await think(brain, { agent: anvil, wake: wake(call("Take the sea rig", { points: ["S"] })) }), [
    ["radio", { to: ["Shark 1"], body: "Take the sea rig", end: "over" }],
    ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }],
  ]);
  assert.deepEqual(await think(brain, { agent: anvil, wake: wake(call("Buy a tank")) }), [
    ["buy", { unit: "tank", upgrade: "" }],
    ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }],
  ]);
  assert.deepEqual(await think(brain, { agent: anvil, wake: wake(call("Buy a tank")) }, { buy: "not enough gold: need 250, have 50" }), [
    ["buy", { unit: "tank", upgrade: "" }],
    ["radio", { to: ["Hammer"], body: "Negative, not enough gold: need 250, have 50", end: "over" }],
  ]);
  assert.deepEqual(await think(brain, { agent: anvil, wake: wake(call("Upgrade Viper 2 to the next brain tier")) }), [
    ["buy", { unit: "", upgrade: "Viper 2" }],
    ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }],
  ]);
  assert.deepEqual(await think(brain, { agent: anvil, wake: wake(call("Upgrade Viper 9")) }), [["radio", { to: ["Hammer"], body: "Say again", end: "over" }]]);
  assert.deepEqual(await think(brain, { agent: anvil, wake: wake(call("What's the status?")) }), [["radio", { to: ["Hammer"], body: "3 squads, 300 gold, holding A B", end: "over" }]]);
  // A squad's Wilco must not start a conversation.
  assert.deepEqual(await think(brain, { agent: anvil, wake: wake(call("Wilco", { from: viper2, end: "out" })) }), []);
});

test("claude brain: model and effort by tier, fallback where the model has one, no forced tool choice", async () => {
  const seen = [];
  const reply = { content: [{ type: "text", text: "" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
  const client = {
    messages: { create: async (p) => (seen.push(["stable", p]), { ...reply, model: p.model }) },
    beta: { messages: { create: async (p) => (seen.push(["beta", p]), { ...reply, model: p.model }) } },
  };
  const brain = claudeBrain({ client });
  const ask = (agent) => brain.think({ agent, system: "s", tools: leaderTools, messages: [{ role: "user", content: "wake" }] });
  await ask({ ...leader, tier: 1 });
  await ask({ ...leader, tier: 2 });
  await ask({ ...leader, tier: 3 });
  await ask({ role: "anvil", tier: 1 });
  assert.deepEqual(seen.map(([path, p]) => [path, p.model, p.output_config.effort]), [
    ["stable", "claude-haiku-5-5", "low"],
    ["beta", "claude-sonnet-5-5", "medium"],
    ["beta", "claude-opus-5-5", "high"],
    ["beta", "claude-opus-5-5", "medium"],
  ]);
  assert.deepEqual(models.tiers, { 1: "claude-haiku-5-5", 2: "claude-sonnet-5-5", 3: "claude-opus-5-5" });
  for (const [path, p] of seen) {
    assert.equal(p.tool_choice, undefined);
    assert.equal(p.thinking, undefined);
    assert.equal(p.temperature, undefined);
    assert.equal(p.fallbacks, path === "beta" ? "default" : undefined);
    assert.equal(p.system, "s");
  }
});

test("makeBrain: scripted without a usable key, and never a downgrade when Claude was asked for by name", async () => {
  assert.equal((await makeBrain({})).name, "scripted");
  assert.equal((await makeBrain({ CALLSIGN_ANTHROPIC_KEY: "" })).name, "scripted");
  assert.equal((await makeBrain({ CALLSIGN_ANTHROPIC_KEY: "sk-test", CALLSIGN_BRAIN: "claude" })).name, "claude");
  // A subscription token is not an API key: it selects the Claude Code brain.
  assert.equal((await makeBrain({ CALLSIGN_ANTHROPIC_KEY: "sk-ant-oat01-x", CALLSIGN_BRAIN: "subscription" })).name, "subscription");
  assert.equal((await makeBrain({ CALLSIGN_ANTHROPIC_KEY: "sk-ant-oat01-x", CALLSIGN_CLAUDE_BIN: "/no/such/claude" })).name, "scripted");
  assert.equal((await makeBrain({ CALLSIGN_ANTHROPIC_KEY: "sk-test", CALLSIGN_BRAIN: "scripted" })).name, "scripted");
  await assert.rejects(makeBrain({ CALLSIGN_BRAIN: "claude" }), /needs CALLSIGN_ANTHROPIC_KEY/);
  await assert.rejects(makeBrain({ CALLSIGN_BRAIN: "gpt" }), /unknown CALLSIGN_BRAIN/);
});

test("subscription brain: actions become tool calls, and it thinks again only on a refusal or a report", async () => {
  const { subscriptionBrain, transcript } = await import("../brain-subscription.mjs");
  const runs = [];
  const exec = async (bin, args, input, env) => {
    runs.push({ args, input, env });
    return { structured_output: { actions: [{ tool: "hold", input: { point: "F" } }, { tool: "radio", input: { to: ["Hammer"], body: "Wilco", end: "out" } }] } };
  };
  const brain = subscriptionBrain({ token: "sk-ant-oat01-x", exec });
  const ctx = { agent: { role: "squad", tier: 1 }, system: "You are Viper 2.", tools: leaderTools, messages: [{ role: "user", content: "Hammer: hold Foxtrot" }] };
  const res = await brain.think(ctx);
  assert.deepEqual(res.content.map((b) => b.name), ["hold", "radio"]);
  assert.equal(runs[0].env.CLAUDE_CODE_OAUTH_TOKEN, "sk-ant-oat01-x");
  assert.equal(runs[0].env.CALLSIGN_ANTHROPIC_KEY, undefined);
  assert.equal(runs[0].args[runs[0].args.indexOf("--model") + 1], "claude-haiku-5-5");
  assert.equal(runs[0].args[runs[0].args.indexOf("--tools") + 1], "");

  const ok = res.content.map((b) => ({ type: "tool_result", tool_use_id: b.id, content: "{}" }));
  ctx.messages.push({ role: "assistant", content: res.content }, { role: "user", content: ok });
  assert.equal((await brain.think(ctx)).stop_reason, "end_turn");
  assert.equal(runs.length, 1);

  ok[0] = { ...ok[0], content: "no such point", is_error: true };
  assert.equal((await brain.think(ctx)).stop_reason, "tool_use");
  assert.equal(runs.length, 2);
  assert.match(transcript(ctx.messages), /hold was refused: no such point/);
});

test("scripted operator: acts on orders only until Hammer hands it the fight, and stops when command is taken back", async () => {
  const brain = scriptedBrain();
  const anvil = { role: "anvil", side: 0, squad: 0, tier: 1, station: { key: "operator", en: "Anvil", he: "סדן" }, lang: "en" };
  const status = (mode, extra = {}) => ({
    faction: "aegis",
    gold: 900,
    command: { mode, buy: mode === "fight" },
    points: [{ id: "A", owner: 0 }, { id: "B", owner: -1 }, { id: "D", owner: -1 }, { id: "Z", owner: 1 }],
    squads: [
      { callsign: { en: "Viper 1" }, class: "infantry", unit: "commandos", x: 150, y: 480, order: { kind: "none" } },
      { callsign: { en: "Viper 2" }, class: "infantry", unit: "commandos", x: 150, y: 480, order: { kind: "hold", point: "D" } },
    ],
    deploying: [],
    // A standing base and a working economy, so the next thing to spend on is a squad.
    structures: [
      { id: "s1", kind: "barracks", role: "barracks", side: 0, yours: true, hp: 1, building: 1 },
      { id: "s2", kind: "refinery", role: "refinery", side: 0, yours: true, hp: 1, building: 1 },
    ],
    haulers: [{ id: 1001, side: 0 }, { id: 1002, side: 0 }],
    ...extra,
  });
  const heard = (mode, extra) => ({ items: [{ kind: "heard", msg: call("Wilco", { from: viper2, end: "out" }) }], call: null, status: status(mode, extra) });
  // On orders: gold piles up, a squad sits idle, and the operator does nothing about either.
  assert.deepEqual(await think(brain, { agent: anvil, wake: heard("orders") }), []);
  assert.deepEqual(await think(brain, { agent: anvil, wake: { items: [{ kind: "event", event: { kind: "point_lost", point: "B" } }], call: null, status: status("orders") } }), []);
  // Hammer hands over the fight: acknowledge, then buy and task without being asked.
  const give = call("Run the fight", { to: [anvil.station] });
  assert.deepEqual(await think(brain, { agent: anvil, wake: { items: [{ kind: "radio", msg: give }], call: give, status: status("fight") } }), [
    ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }],
    ["buy", { unit: "commandos", upgrade: "" }],
    ["radio", { to: ["Viper 1"], body: "Hold Bravo", end: "over" }],
  ]);
  // It keeps going on later traffic, in Hebrew when that is the net's language.
  assert.deepEqual(await think(brain, { agent: { ...anvil, lang: "he" }, wake: heard("fight") }), [
    ["buy", { unit: "commandos", upgrade: "" }],
    ["radio", { to: ["Viper 1"], body: "תחזיקו את בועז", end: "over" }],
  ]);
  // Told not to spend: it still tasks squads but buys nothing.
  assert.deepEqual(await think(brain, { agent: anvil, wake: heard("fight", { command: { mode: "fight", buy: false } }) }), [["radio", { to: ["Viper 1"], body: "Hold Bravo", end: "over" }]]);
  // The purse is spent on the opening and the economy before squads: the refinery first
  // (it brings a hauler), then the barracks; a second hauler once the works stands, and
  // the works itself first when no hauler is left; a unit's structure before the unit.
  const own = async (extra) => (await think(brain, { agent: anvil, wake: heard("orders", { command: { mode: "orders", buy: true }, ...extra }) }))[0];
  const st = (id, kind, role) => ({ id, kind, role, side: 0, yours: true, hp: 1, building: 1 });
  assert.deepEqual(await own({ structures: [], haulers: [] }), ["build", { structure: "refinery", place: "", place2: "" }]);
  assert.deepEqual(await own({ structures: [st("s1", "refinery", "refinery")], haulers: [{ id: 1001, side: 0 }] }), ["build", { structure: "barracks", place: "", place2: "" }]);
  assert.deepEqual(await own({ haulers: [{ id: 1001, side: 0 }] }), ["buy", { unit: "commandos", upgrade: "" }], "one hauler and no works: squads come first");
  assert.deepEqual(await own({ haulers: [] }), ["build", { structure: "vehicleWorks", place: "", place2: "" }], "no hauler left: the works, to buy one");
  const works = [st("s1", "barracks", "barracks"), st("s2", "refinery", "refinery"), st("s3", "vehicleWorks", "works")];
  assert.deepEqual(await own({ structures: works, haulers: [{ id: 1001, side: 0 }] }), ["buy", { unit: "crawler", upgrade: "" }]);
  const four = [1, 2, 3, 4].map((n) => ({ callsign: { en: `Viper ${n}` }, class: "infantry", unit: "commandos", x: 150, y: 480, order: { kind: "hold", point: "D" } }));
  assert.deepEqual(await own({ squads: four }), ["build", { structure: "vehicleWorks", place: "", place2: "" }]);
  // Hammer takes command back: one Wilco and nothing more, now or on later traffic.
  const take = call("I have command", { to: [anvil.station] });
  assert.deepEqual(await think(brain, { agent: anvil, wake: { items: [{ kind: "radio", msg: take }], call: take, status: status("orders") } }), [["radio", { to: ["Hammer"], body: "Wilco", end: "out" }]]);
  assert.deepEqual(await think(brain, { agent: anvil, wake: heard("orders") }), []);
});

test("command tool: the operator's own switch keeps a false `buy`", () => {
  assert.deepEqual(normalize("command", { mode: "fight", buy: false }), { mode: "fight", buy: false });
  assert.deepEqual(normalize("command", { mode: "orders", buy: true }), { mode: "orders", buy: true });
  const prompt = operatorPrompt({ rules, side: 0, faction: "aegis" });
  assert.match(prompt, /you give no squad a new task on your own/);
  assert.match(prompt, /buy and upgrade only on Hammer's order/);
  assert.match(prompt, /Never give yourself the fight or the purse/);
  assert.match(prompt, /Buy troops and push forward/);
});

test("scripted operator: buys haulers, sends them to a field, and reports one in trouble", async () => {
  const brain = scriptedBrain();
  // The last station to call Anvil was a squad; a hauler in trouble is still reported to Hammer.
  const anvil = (lang) => ({ role: "anvil", side: 0, squad: 0, tier: 1, station: { key: "operator", en: "Anvil", he: "סדן" }, lang, commander: "Viper 1" });
  const status = (faction) => ({ faction, gold: 600, points: [], squads: [], haulers: [] });
  const wake = (c, faction = "aegis") => ({ items: [{ kind: "radio", msg: c }], call: c, status: status(faction) });
  // Each faction's own hauler, whatever the caller calls it.
  for (const [text, lang, faction, unit] of [
    ["Buy a hauler", "en", "aegis", "crawler"],
    ["Buy a gold truck", "en", "ashfall", "dumpTruck"],
    ["קנה משאית זהב", "he", "aegis", "crawler"],
    ["קנה משאית זהב", "he", "ashfall", "dumpTruck"],
    ["Buy a tank, we have the gold", "en", "aegis", "tank"],
  ]) {
    const steps = await think(brain, { agent: anvil(lang), wake: wake(call(text, { lang }), faction) });
    assert.deepEqual(steps[0], ["buy", { unit, upgrade: "" }], `${faction}: "${text}"`);
  }
  assert.deepEqual(await think(brain, { agent: anvil("en"), wake: wake(call("Haulers to the Kilo field", { points: ["K"] })) }), [
    ["haul", { field: "K", hauler: 0 }],
    ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }],
  ]);
  assert.deepEqual(await think(brain, { agent: anvil("he"), wake: wake(call("המשאיות לשדה כרמל", { lang: "he", points: ["K"] })) }), [
    ["haul", { field: "K", hauler: 0 }],
    ["radio", { to: ["Hammer"], body: "רות, יבוצע", end: "out" }],
  ]);
  assert.deepEqual(await think(brain, { agent: anvil("en"), wake: wake(call("Let the haulers choose on their own")) }), [
    ["haul", { field: "auto", hauler: 0 }],
    ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }],
  ]);
  assert.deepEqual(await think(brain, { agent: anvil("en"), wake: wake(call("Haulers to the field")) }), [["radio", { to: ["Hammer"], body: "Say again", end: "over" }]]);
  assert.deepEqual(await think(brain, { agent: anvil("en"), wake: wake(call("Haulers to Golf", { points: ["G"] })) }, { haul: 'no such gold field: "G"' }), [
    ["haul", { field: "G", hauler: 0 }],
    ["radio", { to: ["Hammer"], body: 'Negative, no such gold field: "G"', end: "over" }],
  ]);
  // Woken by the event, with no call: one short line to the commander.
  const event = (kind) => ({ items: [{ kind: "event", event: { kind, hauler: 1001, point: "B" } }], call: null, status: status("aegis") });
  assert.deepEqual(await think(brain, { agent: anvil("en"), wake: event("hauler_attacked") }), [["radio", { to: ["Hammer"], body: "Hauler under attack near Bravo", end: "out" }]]);
  assert.deepEqual(await think(brain, { agent: anvil("he"), wake: event("hauler_lost") }), [["radio", { to: ["Hammer"], body: "מוביל זהב אבד ליד בועז", end: "out" }]]);
  assert.deepEqual(await think(brain, { agent: anvil("en"), wake: event("squad_lost") }), []);
});

test("scripted leader: escorting the haulers means holding the field they work", async () => {
  const brain = scriptedBrain();
  const status = (haulers) => ({ you: {}, friends: [], contacts: [], points: [], haulers });
  const wake = (c, haulers) => ({ items: [{ kind: "radio", msg: c }], call: c, status: status(haulers) });
  const hold = (point) => [
    ["hold", { point }],
    ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }],
  ];
  assert.deepEqual(await think(brain, { agent: leader, wake: wake(call("Escort the haulers"), [{ id: 1001, state: "loading", field: "F" }]) }), hold("F"));
  // Nobody is out: the field nearest home.
  assert.deepEqual(await think(brain, { agent: leader, wake: wake(call("Escort the haulers"), [{ id: 1001, state: "waiting", field: "" }]) }), hold("B"));
  assert.deepEqual(await think(brain, { agent: { ...leader, lang: "he" }, wake: wake(call("לווה את המשאיות", { lang: "he" }), [{ id: 1001, state: "out", field: "B" }]) }), [
    ["hold", { point: "B" }],
    ["radio", { to: ["Hammer"], body: "רות, יבוצע", end: "out" }],
  ]);
  // A named point wins over the guess.
  assert.deepEqual(await think(brain, { agent: leader, wake: wake(call("Escort the haulers at Kilo", { points: ["K"] }), []) }), hold("K"));
});

test("status and prompts: the operator is told about haulers, fields and income per minute", () => {
  const status = compactStatus(
    {
      timeLeft: 500, gold: 420, income: 900, hq: [1, 1], points: [], contacts: [], squads: [], deploying: [],
      haulers: [
        { id: 1001, side: 0, state: "loading", load: 0.4, field: "B", assigned: "", x: 1, y: 2, visible: true },
        { id: 1002, side: 1, state: "out", load: 0, x: 900, y: 300, visible: false },
      ],
      fields: [{ gusher: "B", gold: 0.5, visible: true }],
    },
    0,
  );
  assert.equal(status.goldPerMinute, 900);
  assert.deepEqual(status.haulers, [{ id: 1001, state: "loading", load: 0.4, field: "B", sentTo: undefined }]);
  assert.deepEqual(status.enemyHaulersSeen, [{ contact: 1002, x: 900, y: 300, inSight: false }]);
  assert.deepEqual(status.goldFields, [{ field: "B", full: 0.5, inSight: true }]);
  const prompt = operatorPrompt({ rules, side: 0, faction: "aegis" });
  assert.match(prompt, /haulers drive out, load, and bring it home to your refinery/);
  assert.match(prompt, /opens with the headquarters alone: the refinery is the first thing to build/);
  assert.match(prompt, /crawler: Ore crawler \(זחל כרייה\), hauler, 150 gold, needs a Vehicle Works; an unarmed gold hauler/);
  assert.match(prompt, /on your own you build only while command\.buy is true/);
  assert.match(prompt, /- B: Bravo \/ בועז .*a gold field/);
  assert.doesNotMatch(prompt, /oil rigs; there are/);
});
