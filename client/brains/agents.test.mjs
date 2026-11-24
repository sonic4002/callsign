// The page's side of the browser agents, without a browser: the seat, the decision of who
// thinks, the match's usage, and one agent's life as a Worker.

import assert from "node:assert/strict";
import { test } from "node:test";

import { Throttle, Usage, wanted } from "./policy.js";
import { seat } from "./seat.js";
import { WorkerAgent } from "./worker-agent.js";

const store = (init = {}) => {
  const data = new Map(Object.entries(init));
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), data };
};

test("seat: the address wins, then what the lobby saved, and a token is made once and kept", () => {
  const kept = store();
  const first = seat({ query: new URLSearchParams(""), store: kept });
  assert.equal(first.room, "main");
  assert.match(first.token, /^[0-9a-f]{36}$/);
  assert.deepEqual(seat({ query: new URLSearchParams(""), store: kept }), first, "the same browser keeps its seat");
  assert.deepEqual(seat({ query: new URLSearchParams("room=ALPHA&token=given"), store: kept }), { room: "ALPHA", token: "given" });
  assert.deepEqual(seat({ query: new URLSearchParams(""), store: store({ "callsign.room": "BRAVO", "callsign.token": "saved" }) }), { room: "BRAVO", token: "saved" });
});

test("who thinks: this browser only with a key or the demo brain, never as a spectator or while hidden", () => {
  const key = { set: true, provider: "anthropic", hint: "abcd" };
  assert.equal(wanted({ canAct: true, demo: false, key: { set: false }, hiddenLong: false }), null, "no key: the server's agents keep the side");
  assert.equal(wanted({ canAct: true, demo: false, key, hiddenLong: false }), "relay");
  assert.equal(wanted({ canAct: true, demo: true, key, hiddenLong: false }), "scripted", "the demo brain is a choice, and it wins");
  assert.equal(wanted({ canAct: true, demo: true, key: { set: false }, hiddenLong: false }), "scripted");
  assert.equal(wanted({ canAct: false, demo: true, key, hiddenLong: false }), null);
  assert.equal(wanted({ canAct: true, demo: false, key, hiddenLong: true }), null);
});

test("usage: counts thoughts and tokens per match", () => {
  const u = new Usage();
  u.reset(3);
  u.add({ input_tokens: 1200, output_tokens: 80 }, "claude-haiku-5-5");
  u.add({ input_tokens: 300, output_tokens: 20 }, "claude-opus-5-5");
  u.add(undefined);
  assert.deepEqual([u.calls, u.input, u.output, [...u.models]], [3, 1500, 100, ["claude-haiku-5-5", "claude-opus-5-5"]]);
  u.reset(4);
  assert.deepEqual([u.match, u.calls, u.input, u.output], [4, 0, 0, 0]);
});

test("throttle: one line of a kind per window", () => {
  let now = 0;
  const t = new Throttle(1000, () => now);
  assert.deepEqual([t.pass("a"), t.pass("a"), t.pass("b")], [true, false, true]);
  now = 1500;
  assert.equal(t.pass("a"), true);
});

// A Worker that records what it was sent and lets the test answer as the agent would.
function fakeWorkers() {
  const made = [];
  class Worker {
    constructor(script, options) {
      Object.assign(this, { script, options, posted: [], terminated: false, listeners: {} });
      made.push(this);
    }
    addEventListener(kind, fn) {
      this.listeners[kind] = fn;
    }
    postMessage(m) {
      this.posted.push(m);
    }
    terminate() {
      this.terminated = true;
    }
    say(data) {
      this.listeners.message({ data });
    }
  }
  return { Worker, made };
}

const options = { server: "ws://game/ws", side: 0, role: "squad", squad: 2, join: { host: "page-1" }, standByMs: 2500, brain: { name: "relay" }, log: () => {} };
const relay = { kind: "relay", base: "/relay/v1", room: "main", token: "seat-token" };

test("worker agent: starts a module Worker with the seat, never a key, and joins the net", async () => {
  const { Worker, made } = fakeWorkers();
  const seen = { log: [], usage: [], trouble: [] };
  const agent = new WorkerAgent(options, relay, { log: (t) => seen.log.push(t), usage: (...a) => seen.usage.push(a), trouble: (code) => seen.trouble.push(code) }, { Worker });
  const started = agent.start();
  const [w] = made;
  assert.equal(w.script, "/agents/worker.mjs");
  assert.equal(w.options.type, "module");
  assert.deepEqual(w.posted, [{ type: "start", server: "ws://game/ws", side: 0, role: "squad", squad: 2, join: { host: "page-1" }, standByMs: 2500, brain: relay }]);
  assert.equal(JSON.stringify(w.posted).includes("sk-"), false);

  w.say({ type: "joined", station: { key: "infantry-2", en: "Viper 2", he: "צפע 2" } });
  assert.equal((await started).name, "Viper 2");
  w.say({ type: "log", text: "Viper 2: hold" });
  w.say({ type: "usage", usage: { input_tokens: 10, output_tokens: 2 }, model: "m", provider: "anthropic" });
  w.say({ type: "trouble", code: "rate_limited", message: "slow down" });
  assert.deepEqual(seen, { log: ["Viper 2: hold"], usage: [[{ input_tokens: 10, output_tokens: 2 }, "m", "anthropic"]], trouble: ["rate_limited"] });

  agent.stop();
  agent.stop();
  assert.deepEqual(w.posted.filter((m) => m.type === "stop").length, 1, "stopping twice asks once");
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(w.terminated, true, "a Worker that does not close itself is terminated");
});

test("worker agent: one that cannot join says why, and one that fails to load is cleaned up", async () => {
  let { Worker, made } = fakeWorkers();
  let agent = new WorkerAgent(options, relay, {}, { Worker });
  let started = agent.start();
  made[0].say({ type: "trouble", code: "join", message: "another host runs this side's agents" });
  made[0].say({ type: "stopped" });
  await assert.rejects(started, /another host runs this side's agents/);
  assert.equal(made[0].terminated, true);

  ({ Worker, made } = fakeWorkers());
  agent = new WorkerAgent(options, { kind: "scripted" }, {}, { Worker });
  started = agent.start();
  made[0].listeners.error({ message: "404" });
  await assert.rejects(started, /404/);
  assert.equal(agent.stopped, true);
});
