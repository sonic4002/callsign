// The live view of the agents, as pure functions: what the page keeps from the frames,
// how numbers are written, and what one row shows.

import assert from "node:assert/strict";
import { test } from "node:test";

import { Agents, barWidth, rowOf, share, shortModel, sideOf, span, tokens } from "./monitor.js";

test("numbers are written the way people read them", () => {
  assert.equal(tokens(1084), "1,084");
  assert.equal(tokens(9999), "9,999");
  assert.equal(tokens(12_340), "12.3k");
  assert.equal(tokens(234_000), "234k");
  assert.equal(tokens(1_000_000), "1.00M");
  assert.equal(tokens(null), "–");
  assert.equal(tokens(undefined), "–");
  assert.equal(span(840), "0.8 s");
  assert.equal(span(12_400), "12 s");
  assert.equal(span(185_000), "3 min 05 s");
  assert.equal(span(null), "–");
  assert.equal(share(0.92), "92%");
  assert.equal(share(0.0011), "0.1%");
  assert.equal(share(0.0004), "<0.1%");
  assert.equal(share(0), "0%");
  assert.equal(share(null), "–");
});

test("a model id becomes a name, and an unknown one stays as it is", () => {
  assert.equal(shortModel("claude-haiku-5-5"), "Haiku 5.5");
  assert.equal(shortModel("claude-opus-5-5"), "Opus 5.5");
  assert.equal(shortModel("anthropic/claude-sonnet-5.5"), "Sonnet 5.5");
  assert.equal(shortModel("claude-sonnet-5"), "Sonnet 5");
  assert.equal(shortModel("openai/gpt-6-luna"), "gpt-6-luna");
  assert.equal(shortModel("gemini-4-carbon"), "gemini-4-carbon");
  assert.equal(shortModel(null), "");
});

test("the context bar is true to scale, never thinner than a sliver, and unknown is unknown", () => {
  assert.equal(barWidth(500_000, 1_000_000), 0.5);
  assert.equal(barWidth(1084, 1_000_000), 0.02); // 0.1% would be invisible
  assert.equal(barWidth(0, 1_000_000), 0);
  assert.equal(barWidth(2_000_000, 1_000_000), 1);
  assert.equal(barWidth(1084, null), null);
  assert.equal(barWidth(null, 1_000_000), null);
});

const report = (over = {}) => ({
  v: 1, role: "squad", squad: 2, tier: 1, brain: "subscription", where: "server",
  model: "claude-haiku-5-5", planned: "claude-haiku-5-5",
  state: "thinking", since: 50_000, at: 52_000, woke: { kind: "call", from: "Hammer" }, tool: null, standBy: true, reason: null,
  context: { input: 2100, cached: 2000, window: 1_000_000 }, output: 25,
  talk: { messages: 3, wakes: 1, limit: 15, resetAt: 20_000, resetWhy: "match" },
  totals: { thoughts: 4, input: 8400, output: 100, cached: 8000, ms: 12_000, lastMs: 2500 },
  actions: [{ tool: "hold", text: "hold F", ok: true }, { tool: "buy", text: "buy tank", ok: false }], said: "Wilco",
  ...over,
});
const station = { key: "infantry-2", en: "Viper 2", he: "צפע 2", squad: 2 };

test("a row from a report: model, context, state with its running time, conversation, totals", () => {
  const agents = new Agents(() => 1000);
  agents.hello([{ squad: 2, station, online: true, telemetry: report() }]);
  // Half a second after the report came: the agent had been thinking for 2 s by its own clock.
  const row = rowOf(2, agents.get(2), { now: 1500 });
  assert.equal(row.state, "thinking");
  assert.equal(row.stateMs, 2500);
  assert.equal(row.standBy, true);
  assert.deepEqual(row.woke, { kind: "call", from: "Hammer" });
  assert.equal(row.model, "claude-haiku-5-5");
  assert.equal(row.modelSeen, true);
  assert.equal(row.brain, "subscription");
  assert.equal(row.where, "server");
  assert.equal(row.input, 2100);
  assert.ok(Math.abs(row.cachedShare - 2000 / 2100) < 1e-9);
  assert.equal(row.window, 1_000_000);
  assert.equal(row.used, 0.0021);
  assert.equal(row.bar, 0.02);
  assert.equal(row.output, 25);
  assert.deepEqual([row.messages, row.wakes, row.limit, row.resetWhy], [3, 1, 15, "match"]);
  assert.equal(row.resetMs, 32_500); // 32 s on the agent's clock, plus the half second since
  assert.deepEqual([row.thoughts, row.totalIn, row.totalOut, row.avgMs, row.lastMs], [4, 8400, 100, 3000, 2500]);
  assert.deepEqual(row.actions, [{ text: "hold F", ok: true }, { text: "buy tank", ok: false }]);
  assert.equal(row.said, "Wilco");
});

test("what is not known is not invented", () => {
  const agents = new Agents(() => 0);
  // No report at all: the station is listed and says so.
  assert.deepEqual(rowOf(3, agents.get(3)), { squad: 3, station: null, reported: false, online: false, state: "none" });
  // A scripted agent: no model, no context, no window.
  agents.frame({ agent: { squad: 3, station, online: true, telemetry: report({ brain: "scripted", where: "browser", model: null, planned: null, state: "idle", context: { input: null, cached: null, window: null }, output: null, totals: { thoughts: 0, input: 0, output: 0, cached: 0, ms: 0, lastMs: null } }) } });
  const row = rowOf(3, agents.get(3));
  assert.equal(row.brain, "demo");
  assert.equal(row.model, null);
  assert.equal(row.input, null);
  assert.equal(row.bar, null);
  assert.equal(row.used, null);
  assert.equal(row.cachedShare, null);
  assert.equal(row.avgMs, null);
  assert.equal(row.woke, null); // only a busy agent says what woke it
  // Before the first thought the planned model is shown, and marked as not yet seen.
  agents.frame({ agent: { squad: 4, online: true, telemetry: report({ model: null, state: "idle" }) } });
  const planned = rowOf(4, agents.get(4));
  assert.equal(planned.model, "claude-haiku-5-5");
  assert.equal(planned.modelSeen, false);
  // A model with no known window still shows its context, without a bar.
  agents.frame({ agent: { squad: 5, online: true, telemetry: report({ model: "gpt-6-luna", brain: "relay", where: "browser", context: { input: 900, cached: null, window: null } }) } });
  const other = rowOf(5, agents.get(5));
  assert.deepEqual([other.input, other.window, other.bar, other.brain, other.where], [900, null, null, "relay", "browser"]);
});

test("frames: an agent going offline, a squad lost, the match ending", () => {
  let now = 0;
  const agents = new Agents(() => now);
  agents.hello([{ squad: 0, online: true, telemetry: report({ role: "anvil", state: "idle" }) }, { squad: 2, station, online: true, telemetry: report() }]);
  assert.deepEqual([...agents.thinking()], [2]);
  assert.equal(rowOf(0, agents.get(0)).role, "anvil");
  assert.equal(rowOf(0, agents.get(0)).tier, null);

  // A skipped wake says why.
  assert.equal(agents.frame({ agent: { squad: 2, station, online: true, telemetry: report({ state: "skipped", reason: { code: "rate_limited", text: "" }, standBy: false }) } }), 2);
  const skipped = rowOf(2, agents.get(2));
  assert.deepEqual([skipped.state, skipped.reason.code, skipped.live], ["skipped", "rate_limited", false]);
  assert.equal(agents.thinking().size, 0);

  // Its connection closes: the row stays, off the net, with the last numbers.
  agents.frame({ agent: { squad: 2, station, online: false, telemetry: report() } });
  assert.equal(rowOf(2, agents.get(2)).state, "offline");
  assert.equal(rowOf(2, agents.get(2)).input, 2100);
  assert.equal(agents.thinking().size, 0);

  // The squad is lost: the row goes.
  assert.equal(agents.frame({ agent: { squad: 2, gone: true } }), 2);
  assert.equal(agents.get(2), null);

  // The match ends: what is shown stands, marked as over; a new greeting starts clean.
  assert.equal(agents.frame({ ended: true }), null);
  assert.equal(rowOf(0, agents.get(0), { ended: agents.ended }).state, "ended");
  agents.hello([]);
  assert.equal(agents.ended, false);
  assert.equal(agents.get(0), null);
  // A frame that is not about an agent is ignored.
  assert.equal(agents.frame({ agent: { squad: "x" } }), null);
  now = 1;
});

test("the line for the whole side adds the rows up", () => {
  const agents = new Agents(() => 0);
  agents.hello([
    { squad: 0, online: true, telemetry: report({ role: "anvil", state: "idle", totals: { thoughts: 10, input: 50_000, output: 900, cached: 0, ms: 30_000, lastMs: 3000 } }) },
    { squad: 1, online: true, telemetry: report() },
    { squad: 2, online: false, telemetry: report({ state: "idle" }) },
  ]);
  const rows = [0, 1, 2, 3].map((squad) => rowOf(squad, agents.get(squad)));
  assert.deepEqual(sideOf(rows), { agents: 2, thinking: 1, thoughts: 18, input: 66_800, output: 1100 });
});
