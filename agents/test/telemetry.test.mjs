// What an agent reports about itself: the numbers it reads from a brain's answer, the
// order of its states, and the trip through the real game server to its own commander.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { Agent } from "../agent.mjs";
import { reading, subscriptionBrain } from "../brain-subscription.mjs";
import { Telemetry, WINDOWS, contextOf, plain, troubleCode, windowOf, wokeBy } from "../telemetry.mjs";

const recorded = JSON.parse(readFileSync(new URL("fixtures/claude-code-result.json", import.meta.url), "utf8"));

test("contextOf: the request's size includes cached input, and unknown stays unknown", () => {
  assert.deepEqual(contextOf({ input_tokens: 2, cache_read_input_tokens: 900, cache_creation_input_tokens: 182, output_tokens: 40 }), { input: 1084, cached: 900, output: 40 });
  assert.deepEqual(contextOf({ input_tokens: 1200, output_tokens: 30 }), { input: 1200, cached: null, output: 30 });
  assert.deepEqual(contextOf(undefined), { input: null, cached: null, output: null });
  assert.deepEqual(contextOf({ output_tokens: 5 }), { input: null, cached: null, output: 5 });
  // A run of several requests is sized by its last one; what it wrote is the whole run's.
  const run = { input_tokens: 10, cache_read_input_tokens: 500, output_tokens: 90, iterations: [{ input_tokens: 4, cache_read_input_tokens: 0, cache_creation_input_tokens: 500 }, { input_tokens: 6, cache_read_input_tokens: 500, cache_creation_input_tokens: 60 }] };
  assert.deepEqual(contextOf(run), { input: 566, cached: 500, output: 90 });
});

test("windowOf: what the response said, else the table, else unknown", () => {
  assert.equal(windowOf("claude-haiku-5-5", 200_000), 200_000);
  assert.equal(windowOf("claude-opus-5-5"), WINDOWS["claude-opus-5-5"]);
  assert.equal(windowOf("anthropic/claude-sonnet-5.5"), WINDOWS["claude-sonnet-5-5"]);
  assert.equal(windowOf("some-other-model"), null);
  assert.equal(windowOf(null), null);
});

test("a recorded Claude Code result gives the cached tokens, the model and its window", () => {
  const { usage, model, window } = reading(recorded, "claude-haiku-5-5");
  assert.equal(model, "claude-haiku-5-5");
  assert.equal(window, recorded.modelUsage["claude-haiku-5-5"].contextWindow);
  assert.equal(usage.cache_creation_input_tokens, recorded.usage.cache_creation_input_tokens);
  const c = contextOf(usage);
  // The old reading showed "in=2" for this request; its real size is over a thousand tokens.
  assert.equal(recorded.usage.input_tokens, 2);
  assert.equal(c.input, 2 + recorded.usage.cache_creation_input_tokens + recorded.usage.cache_read_input_tokens);
  assert.ok(c.input > 1000);
  assert.equal(c.output, recorded.usage.output_tokens);
  // A model the run used instead of the one asked for is the one reported.
  const other = reading({ ...recorded, modelUsage: { "claude-sonnet-5-5": { outputTokens: 9, contextWindow: 1_000_000 } } }, "claude-haiku-5-5");
  assert.equal(other.model, "claude-sonnet-5-5");
  assert.deepEqual(reading({ structured_output: {} }, "claude-haiku-5-5"), { usage: undefined, model: "claude-haiku-5-5", window: undefined });
});

test("the subscription brain hands the whole reading to the agent", async () => {
  const brain = subscriptionBrain({ token: "sk-ant-oat01-x", exec: async () => recorded });
  assert.equal(brain.plan({ role: "squad", tier: 2 }), "claude-sonnet-5-5");
  assert.equal(brain.plan({ role: "anvil", tier: 1 }), "claude-opus-5-5");
  const res = await brain.think({ agent: { role: "squad", tier: 1 }, system: "s", tools: [], messages: [{ role: "user", content: "Hammer: hold Foxtrot" }] });
  assert.equal(res.model, "claude-haiku-5-5");
  assert.equal(res.window, 1_000_000);
  assert.equal(contextOf(res.usage).input, 1084);
});

test("plain: a tool call in a few words", () => {
  assert.equal(plain("hold", { point: "F" }), "hold F");
  assert.equal(plain("attack", { point: "", contact: 4 }), "attack Target 4");
  assert.equal(plain("radio", { to: ["Hammer"], body: "Wilco", end: "out" }), "radio Hammer: Wilco");
  assert.equal(plain("buy", { unit: "tank", upgrade: "" }), "buy tank");
  assert.equal(plain("buy", { unit: "", upgrade: "Viper 1" }), "upgrade Viper 1");
  assert.equal(plain("command", { mode: "fight", buy: false }), "command fight, no buying");
  assert.equal(plain("report", {}), "report");
});

test("wokeBy and troubleCode name the cause", () => {
  const call = { kind: "radio", msg: { from: { en: "Hammer", he: "פטיש" } } };
  assert.deepEqual(wokeBy([{ kind: "event", event: { kind: "contact" } }, call]), { kind: "call", from: "Hammer", fromHe: "פטיש" });
  assert.deepEqual(wokeBy([{ kind: "event", event: { kind: "pinned" } }]), { kind: "event", event: "pinned" });
  assert.deepEqual(wokeBy([{ kind: "heard", msg: { from: { en: "Viper 2", he: "צפע 2" } } }]), { kind: "heard", from: "Viper 2", fromHe: "צפע 2" });
  assert.equal(troubleCode(Object.assign(new Error("x"), { code: "bad_key" })), "bad_key");
  assert.equal(troubleCode(new Error("rate limited by Anthropic; this wake is skipped")), "rate_limited");
  assert.equal(troubleCode(new Error("Claude Code did not answer within 60 s")), "timeout");
  assert.equal(troubleCode(new Error("the Anthropic key in CALLSIGN_ANTHROPIC_KEY was rejected")), "bad_key");
  assert.equal(troubleCode(new Error("boom")), "failed");
});

// A Telemetry on a clock the test moves by hand.
function onClock(options = {}) {
  let t = 1000;
  const sent = [];
  const timers = [];
  const tele = new Telemetry({
    role: "squad", squad: 2, brain: "fake", where: "server", limit: 3, gapMs: 150, ...options,
    send: (r) => sent.push(r),
    now: () => t,
    later: (fn, ms) => timers.push({ fn, at: t + ms }) && timers.length,
    cancel: (id) => (timers[id - 1] = null),
  });
  const pass = (ms) => {
    t += ms;
    for (let i = 0; i < timers.length; i++) {
      const due = timers[i];
      if (due && due.at <= t) {
        timers[i] = null;
        due.fn();
      }
    }
  };
  return { tele, sent, pass };
}

test("states go out in order, at once when they can and never faster than the gap", () => {
  const { tele, sent, pass } = onClock();
  tele.joined({ tier: 1, planned: "claude-haiku-5-5" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].state, "idle");
  assert.equal(sent[0].planned, "claude-haiku-5-5");
  assert.equal(sent[0].talk.resetWhy, "match");

  // A whole wake inside one gap: nothing more is sent until the gap has passed, and
  // then the latest state is, not every step in between.
  tele.conversation(1, 0);
  tele.thinking([{ kind: "radio", msg: { from: { en: "Hammer" } } }]);
  tele.thought({ usage: { input_tokens: 2, cache_read_input_tokens: 1000, cache_creation_input_tokens: 82, output_tokens: 40 }, model: "claude-haiku-5-5" }, 2100);
  tele.acting("hold");
  assert.equal(sent.length, 1);
  pass(150);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].state, "acting");
  assert.equal(sent[1].tool, "hold");
  assert.equal(sent[1].woke.kind, "call");
  assert.equal(sent[1].woke.from, "Hammer");
  assert.deepEqual(sent[1].context, { input: 1084, cached: 1000, window: 1_000_000 });
  assert.equal(sent[1].model, "claude-haiku-5-5");

  // Slow steps are each seen as they happen.
  pass(400);
  tele.acted("hold", { point: "F" }, true);
  tele.acting("radio");
  pass(400);
  tele.acted("radio", { to: ["Hammer"], body: "Wilco", end: "out" }, true);
  tele.conversation(3, 1);
  tele.idle();
  pass(400);
  const states = sent.map((r) => r.state);
  assert.deepEqual(states.slice(1), ["acting", "acting", "idle"]);
  const last = sent.at(-1);
  assert.equal(last.said, "Wilco");
  assert.deepEqual(last.actions.map((a) => a.text), ["hold F", "radio Hammer: Wilco"]);
  assert.deepEqual(last.totals, { thoughts: 1, input: 1084, output: 40, cached: 1000, ms: 2100, lastMs: 2100 });
  assert.deepEqual({ messages: last.talk.messages, wakes: last.talk.wakes, limit: last.talk.limit }, { messages: 3, wakes: 1, limit: 3 });
  assert.ok(sent.every((r, i) => i === 0 || r.seq > sent[i - 1].seq));
});

test("stand by, a skipped wake, the reset reasons and leaving the net", () => {
  const { tele, sent, pass } = onClock();
  tele.joined({ tier: 1 });
  pass(200);
  tele.thinking([{ kind: "event", event: { kind: "pinned" } }]);
  pass(200);
  tele.saidStandBy();
  pass(200);
  assert.equal(sent.at(-1).state, "thinking");
  assert.equal(sent.at(-1).standBy, true);
  tele.reset("unfinished");
  tele.skipped("rate_limited", "rate limited by Anthropic; this wake is skipped");
  pass(200);
  assert.equal(sent.at(-1).state, "skipped");
  assert.deepEqual(sent.at(-1).reason, { code: "rate_limited", text: "rate limited by Anthropic; this wake is skipped" });
  assert.equal(sent.at(-1).talk.resetWhy, "unfinished");
  assert.equal(sent.at(-1).standBy, false);
  // Unknown numbers are not reported as zero.
  assert.deepEqual(sent.at(-1).context, { input: null, cached: null, window: null });
  assert.equal(sent.at(-1).model, null);

  tele.reset("tier");
  tele.tier(2, "claude-sonnet-5-5");
  pass(200);
  assert.equal(sent.at(-1).tier, 2);
  assert.equal(sent.at(-1).planned, "claude-sonnet-5-5");
  assert.equal(sent.at(-1).talk.resetWhy, "tier");
  tele.reset("wakes");
  tele.idle();
  pass(200);
  assert.equal(sent.at(-1).talk.resetWhy, "wakes");

  // Leaving is said at once, gap or no gap.
  const before = sent.length;
  tele.stopped("stopped");
  assert.equal(sent.length, before + 1);
  assert.equal(sent.at(-1).state, "stopped");
});

test("a brain with no usage (the scripted one) counts nothing and names no model", () => {
  const { tele, sent, pass } = onClock();
  tele.joined({ tier: 1 });
  tele.thought({ content: [], stop_reason: "tool_use" }, 1);
  pass(200);
  assert.equal(sent.at(-1).totals.thoughts, 0);
  assert.equal(sent.at(-1).model, null);
});

// ---- through the real game server ----

const bin = process.env.CALLSIGN_BIN;
const skip = bin ? false : "set CALLSIGN_BIN to the built game server (make test does)";
const clientDir = fileURLToPath(new URL("../../client", import.meta.url));

async function eventually(what, check, ms = 10000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("an agent's report reaches its own commander through the game server, and nobody else", { skip }, async (t) => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(bin, ["-addr", `127.0.0.1:${port}`, "-bot", "", "-speed", "20", "-client", clientDir]);
  t.after(() => proc.kill());
  await new Promise((resolve, reject) => {
    proc.stderr.on("data", (d) => String(d).includes("listening") && resolve());
    proc.on("exit", (code) => reject(new Error(`game server exited with ${code}`)));
  });
  const server = `ws://127.0.0.1:${port}/ws`;
  const listen = async (query) => {
    const frames = [];
    const ws = new WebSocket(`${server}?${query}`);
    t.after(() => ws.close());
    ws.addEventListener("message", (ev) => frames.push(JSON.parse(ev.data)));
    await eventually(`a greeting for ${query}`, () => frames.some((f) => f.type === "hello"));
    return { ws, frames, reports: () => frames.filter((f) => f.type === "telemetry" && f.agent?.telemetry).map((f) => f.agent) };
  };
  const hammer = await listen("side=0&role=hammer");
  const enemy = await listen("side=1&role=hammer");
  const watcher = await listen("side=0&role=spectator");

  // A brain that answers like a model would: one order carried out, then an acknowledgement.
  let thoughts = 0;
  const brain = {
    name: "fake",
    slow: false,
    plan: () => "claude-haiku-5-5",
    async think({ messages }) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      thoughts += 1;
      const usage = { input_tokens: 3, cache_read_input_tokens: 2000, cache_creation_input_tokens: 97, output_tokens: 25 };
      if (typeof messages.at(-1).content !== "string") return { content: [{ type: "text", text: "" }], stop_reason: "end_turn", usage, model: "claude-haiku-5-5", window: 1_000_000 };
      return {
        content: [
          { type: "tool_use", id: `t${thoughts}a`, name: "hold", input: { point: "F" } },
          { type: "tool_use", id: `t${thoughts}b`, name: "radio", input: { to: ["Hammer"], body: "Wilco", end: "out" } },
        ],
        stop_reason: "tool_use", usage, model: "claude-haiku-5-5", window: 1_000_000,
      };
    },
  };
  const agent = new Agent({ server, side: 0, role: "squad", squad: 2, brain, log: () => {}, wakesPerConversation: 1 });
  agent.tele.gapMs = 60; // quick enough to see every state, slower than the server's own limit
  await agent.start();
  t.after(() => agent.stop());

  await eventually("the first report", () => hammer.reports().length > 0);
  assert.equal(hammer.reports()[0].station.en, "Viper 2");
  assert.equal(hammer.reports()[0].telemetry.state, "idle");
  assert.equal(hammer.reports()[0].telemetry.planned, "claude-haiku-5-5");
  assert.equal(hammer.reports()[0].telemetry.where, "server");

  hammer.ws.send(JSON.stringify({ type: "radio", text: "Viper 2, this is Hammer. Hold Foxtrot. Over." }));
  await eventually("the agent to finish the wake", () => hammer.reports().at(-1).telemetry.state === "idle" && hammer.reports().at(-1).telemetry.totals.thoughts === 2, 15000);
  const states = hammer.reports().map((a) => a.telemetry.state);
  const order = states.filter((s, i) => i === 0 || s !== states[i - 1]);
  assert.deepEqual(order, ["idle", "thinking", "acting", "thinking", "idle"]);

  const last = hammer.reports().at(-1).telemetry;
  assert.equal(last.model, "claude-haiku-5-5");
  assert.deepEqual(last.context, { input: 2100, cached: 2000, window: 1_000_000 });
  assert.equal(last.output, 25);
  assert.equal(last.totals.thoughts, 2);
  assert.equal(last.totals.input, 4200);
  assert.ok(last.totals.ms >= 350, `two thoughts of 200 ms took ${last.totals.ms} ms`);
  assert.deepEqual(last.actions.map((a) => [a.text, a.ok]), [["hold F", true], ["radio Hammer: Wilco", true]]);
  assert.equal(last.said, "Wilco");
  // One wake per conversation: it was reset when the wake ended, and says why.
  assert.deepEqual({ messages: last.talk.messages, wakes: last.talk.wakes, why: last.talk.resetWhy }, { messages: 0, wakes: 0, why: "wakes" });
  const thinking = hammer.reports().find((a) => a.telemetry.state === "thinking").telemetry;
  assert.deepEqual(thinking.woke, { kind: "call", from: "Hammer", fromHe: "פטיש" });
  assert.equal(thinking.talk.messages, 1);

  // Nobody else was told: not the other side, not a spectator.
  assert.equal(enemy.frames.filter((f) => f.type === "telemetry").length, 0);
  assert.equal(watcher.frames.filter((f) => f.type === "telemetry").length, 0);

  // A commander who joins now learns the latest at once; the agent leaving marks it offline.
  const late = await listen("side=0&role=hammer");
  assert.equal(late.frames.find((f) => f.type === "hello").agents.find((a) => a.squad === 2).telemetry.totals.thoughts, 2);
  agent.stop();
  await eventually("the row to go offline", () => hammer.frames.some((f) => f.type === "telemetry" && f.agent?.squad === 2 && f.agent.online === false));
  assert.equal(hammer.reports().at(-1).telemetry.state, "stopped");
});
