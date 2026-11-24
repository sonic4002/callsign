// The browser path without a browser: the relay brain, the host's lifecycle, and the
// rule that only one host runs a side. The model relay is the fake one (fake-relay.mjs),
// which answers with the scripted brain; the game server is the real one.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { Agent } from "../agent.mjs";
import { RelayError, relayBrain, relayKeys } from "../brain-relay.mjs";
import { fakeRelay } from "../fake-relay.mjs";
import { Host, RANK_BROWSER, RANK_SERVER } from "../host.mjs";
import { scriptedBrain } from "../brain-scripted.mjs";

const rules = JSON.parse(readFileSync(new URL("../../shared/rules.json", import.meta.url), "utf8"));

// ---- the relay brain, against a fetch that is scripted ----

const reply = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
const good = { content: [{ type: "tool_use", id: "t1", name: "hold", input: { point: "F" } }], stop_reason: "tool_use", usage: { input_tokens: 120, output_tokens: 30 }, model: "claude-haiku-5-5", provider: "anthropic" };
const ask = { agent: { side: 0, role: "squad", squad: 2, tier: 1 }, system: "You lead Viper 2.", tools: [{ name: "hold" }], messages: [{ role: "user", content: "Hold Foxtrot" }] };

function scripted(...answers) {
  const requests = [];
  const waits = [];
  const fetch = async (url, init) => {
    requests.push({ url, ...init, body: init.body && JSON.parse(init.body) });
    const next = answers[Math.min(requests.length, answers.length) - 1];
    if (next instanceof Error) throw next;
    return next;
  };
  return { requests, waits, fetch, sleep: async (ms) => void waits.push(ms) };
}

test("relay brain: sends the seat and the prompt, never a key, and returns the model's answer", async () => {
  const net = scripted(reply(200, good));
  const used = [];
  const brain = relayBrain({ base: "http://relay/relay/v1", room: "ALPHA", token: "seat-1", onUsage: (...a) => used.push(a), ...net });
  const res = await brain.think(ask);
  assert.deepEqual(res.content, good.content);
  assert.equal(res.stop_reason, "tool_use");
  assert.equal(res.model, "claude-haiku-5-5");
  const [req] = net.requests;
  assert.equal(req.url, "http://relay/relay/v1/think");
  assert.equal(req.method, "POST");
  assert.equal(req.headers.Authorization, "Bearer seat-1");
  assert.deepEqual(req.body, { room: "ALPHA", side: 0, role: "squad", squad: 2, system: ask.system, tools: ask.tools, messages: ask.messages });
  assert.deepEqual(used, [[good.usage, "claude-haiku-5-5", "anthropic"]]);
  assert.equal(brain.slow, true, "a relay thought is slow enough for a Stand by");
});

test("relay brain: a passing failure is tried again, a failure only the player can fix is not", async () => {
  const limited = reply(429, { error: { code: "rate_limited", message: "slow down" } }, { "retry-after": "2" });
  const down = reply(502, { error: { code: "provider_error", message: "upstream" } });

  let net = scripted(limited, down, reply(200, good));
  assert.deepEqual((await relayBrain({ token: "s", ...net }).think(ask)).content, good.content);
  assert.equal(net.requests.length, 3);
  assert.deepEqual(net.waits, [2000, 1000], "the provider's Retry-After first, then a growing pause");

  net = scripted(down);
  await assert.rejects(relayBrain({ token: "s", ...net }).think(ask), (err) => err instanceof RelayError && err.code === "provider_error");
  assert.equal(net.requests.length, 3, "two retries, then the wake is given up");

  for (const code of ["no_key", "bad_key", "not_your_seat", "bad_request"]) {
    net = scripted(reply(code === "no_key" ? 409 : 401, { error: { code, message: code } }));
    await assert.rejects(relayBrain({ token: "s", ...net }).think(ask), (err) => err.code === code);
    assert.equal(net.requests.length, 1, `${code} is not retried`);
  }
});

test("relay brain: no relay at the address reads as unreachable, not as a model's answer", async () => {
  for (const answer of [new TypeError("fetch failed"), reply(404, "404 page not found"), reply(502, "<html>bad gateway</html>")]) {
    const net = scripted(answer);
    await assert.rejects(relayBrain({ token: "s", retries: 1, ...net }).think(ask), (err) => err instanceof RelayError && err.code === "unreachable");
    assert.equal(net.requests.length, 2);
  }
  const net = scripted(reply(200, { stop_reason: "end_turn" }));
  await assert.rejects(relayBrain({ token: "s", retries: 0, ...net }).think(ask), (err) => err.code === "provider_error");
});

// ---- the host's lifecycle, fed frames by hand ----

function riggedHost(options = {}) {
  const made = [];
  let feed;
  const host = new Host({
    server: "ws://game/ws",
    side: 0,
    log: () => {},
    link: (url, onFrame, onClose) => {
      feed = { url, onFrame, onClose };
      return { open: async () => {}, close: () => {} };
    },
    spawn: (o) => {
      const agent = { ...o, started: false, stopped: false, start: async () => void (agent.started = true), stop: () => void (agent.stopped = true), name: `${o.role}${o.squad}` };
      made.push(agent);
      return agent;
    },
    ...options,
  });
  return { host, made, frame: (f) => feed.onFrame(f), close: () => feed.onClose(), url: () => feed.url };
}
const hello = (squads, extra = {}) => ({ type: "hello", match: 0, faction: "aegis", state: { squads: squads.map((id) => ({ id })) }, ...extra });
const live = (made) => made.filter((a) => !a.stopped).map((a) => a.name);

test("host: one agent per station, in step with squads deploying, falling and the match restarting", async () => {
  const { host, made, frame, url } = riggedHost({ id: "page-1", rank: RANK_BROWSER, join: { room: "ALPHA" } });
  await host.start();
  const joined = new URL(url()).searchParams;
  assert.deepEqual([joined.get("role"), joined.get("host"), joined.get("rank"), joined.get("room")], ["host", "page-1", "2", "ALPHA"]);

  frame(hello([1, 2], { active: true }));
  assert.deepEqual(live(made), ["anvil0", "squad1", "squad2"]);
  assert.deepEqual(made[1].join, { room: "ALPHA", host: "page-1" }, "every agent names its host when it joins");

  frame({ type: "event", event: { kind: "deploying", squad: 5 } });
  assert.equal(live(made).length, 3, "a squad still deploying has no leader yet");
  frame({ type: "event", event: { kind: "squad_spawned", squad: 5 } });
  frame({ type: "event", event: { kind: "squad_spawned", squad: 5 } });
  assert.deepEqual(live(made), ["anvil0", "squad1", "squad2", "squad5"]);

  frame({ type: "event", event: { kind: "squad_lost", squad: 1 } });
  assert.deepEqual(live(made), ["anvil0", "squad2", "squad5"]);
  assert.equal(host.agents.has(1), false);

  // A new match: everyone is replaced.
  frame(hello([7, 8], { active: true, match: 1 }));
  assert.deepEqual(live(made), ["anvil0", "squad7", "squad8"]);
  assert.equal(made.filter((a) => a.stopped).length, 4);
});

test("host: standing by runs nothing, and takes over when the server says so", async () => {
  const { host, made, frame, close } = riggedHost();
  const changes = [];
  host.onChange = (c) => changes.push(c.active);
  await host.start();
  frame(hello([1, 2], { active: false }));
  frame({ type: "event", event: { kind: "squad_spawned", squad: 3 } });
  assert.deepEqual(live(made), [], "a host standing by starts no agents");
  assert.equal(host.active, false);

  frame(hello([1, 2, 3], { active: true }));
  assert.deepEqual(live(made), ["anvil0", "squad1", "squad2", "squad3"]);

  frame(hello([1, 2, 3], { active: false }));
  assert.deepEqual(live(made), [], "a host that lost the side stops its agents");
  assert.deepEqual(changes, [false, true, false]);

  frame(hello([1], { active: true }));
  close();
  assert.deepEqual(live(made), [], "a dropped control connection stops everything");
  assert.equal(host.active, false);
});

// ---- end to end: real game server, fake relay, the browser's rank ----

const bin = process.env.CALLSIGN_BIN;
const skip = bin ? false : "set CALLSIGN_BIN to the built game server (make test does)";
const clientDir = fileURLToPath(new URL("../../client", import.meta.url));

async function startServer(t) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(bin, ["-addr", `127.0.0.1:${port}`, "-bot", "", "-speed", "20", "-client", clientDir]);
  t.after(() => proc.kill());
  await new Promise((resolve, reject) => {
    proc.stderr.on("data", (d) => String(d).includes("listening") && resolve());
    proc.on("exit", (code) => reject(new Error(`game server exited with ${code}`)));
  });
  return `ws://127.0.0.1:${port}/ws`;
}

async function eventually(what, check, ms = 10000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function hammerOn(t, server) {
  const frames = [];
  const ws = new WebSocket(`${server}?side=0&role=hammer`);
  t.after(() => ws.close());
  ws.addEventListener("message", (ev) => frames.push(JSON.parse(ev.data)));
  await eventually("Hammer's greeting", () => frames.some((f) => f.type === "hello"));
  const radio = () => frames.filter((f) => f.type === "radio").map((f) => f.message.text);
  return { frames, radio, say: (text) => ws.send(JSON.stringify({ type: "radio", text })) };
}

test("a browser-ranked host on the relay takes the side from the server's agents, and gives it back", { skip }, async (t) => {
  const server = await startServer(t);
  const relay = fakeRelay({ rules });
  const base = await relay.up();
  t.after(() => relay.close());

  const node = new Host({ server, side: 0, brain: scriptedBrain(), rank: RANK_SERVER, log: () => {} });
  await node.start();
  t.after(() => node.stop());
  await eventually("the server-side agents", () => node.agents.size === 3 && node.ready);

  // The player sets a key, and their own host starts thinking through the relay.
  const keys = relayKeys({ base, token: "seat-west" });
  assert.deepEqual(await keys.get(), { provider: "", set: false, hint: "" });
  await assert.rejects(keys.set("anthropic", "sk-bad-key"), (err) => err.code === "bad_key");
  assert.deepEqual(await keys.set("anthropic", "sk-test-0000abcd"), { provider: "anthropic", set: true, hint: "abcd" });
  assert.equal(JSON.stringify([...relay.keys]).includes("sk-test"), false, "the relay keeps a hint, not the key");

  const troubles = [];
  const usage = { calls: 0, in: 0 };
  const brain = relayBrain({ base, room: "main", token: "seat-west", backoffMs: 1, onUsage: (u) => ((usage.calls += 1), (usage.in += u.input_tokens)) });
  const page = new Host({
    server, side: 0, brain, rank: RANK_BROWSER, log: () => {}, standByMs: 60_000,
    spawn: (o) => Object.assign(new Agent(o), { onTrouble: (err) => troubles.push(`${o.role}${o.squad}:${err.code}`) }),
  });
  await page.start();
  await eventually("the browser's agents on the net and the server's standing by", () => page.agents.size === 3 && page.ready && node.agents.size === 0 && !node.active);

  const hammer = await hammerOn(t, server);
  hammer.say("Viper 2, this is Hammer. Hold Foxtrot. Over.");
  await eventually("Viper 2's answer", () => hammer.radio().includes("Hammer, this is Viper 2. Wilco. Out."));
  await eventually("Viper 2 holding Foxtrot", () => hammer.frames.findLast((f) => f.type === "state")?.state.squads.find((s) => s.id === 2)?.order.point === "F");
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(hammer.radio().filter((l) => l.startsWith("Hammer, this is Viper 2. Wilco")).length, 1, "one host answered, not two");
  const thought = relay.calls.find((c) => c.role === "squad" && c.squad === 2);
  assert.equal(thought.room, "main");
  assert.match(thought.system, /You lead squad Viper 2/);
  assert.ok(usage.calls >= 1 && usage.in > 0, "the relay's usage reached the host");

  // The relay goes down: the wake is skipped, nothing freezes, and the next order works.
  relay.failNext("provider_error", 1000);
  hammer.say("Viper 1, this is Hammer. Hold Golf. Over.");
  await eventually("the skipped wake", () => troubles.includes("squad1:provider_error"));
  assert.equal(hammer.radio().some((l) => l.startsWith("Hammer, this is Viper 1")), false);
  relay.failNext("", 0);
  hammer.say("Viper 1, this is Hammer. Hold Golf. Over.");
  await eventually("Viper 1's answer once the relay is back", () => hammer.radio().includes("Hammer, this is Viper 1. Wilco. Out."));

  // Anvil buys through the relay; the new squad's leader starts when it reaches the field.
  hammer.say("Anvil, this is Hammer. Buy a tank. Over.");
  await eventually("a leader for Rhino 1", () => page.agents.size === 4 && page.ready, 20_000);

  // The key is removed: thinking stops being possible, and says why.
  await keys.remove();
  hammer.say("Viper 2, this is Hammer. Hold Delta. Over.");
  await eventually("the wake that had no key", () => troubles.includes("squad2:no_key"));

  // The browser leaves: the server's agents take the side back.
  page.stop();
  await eventually("the server-side agents resuming", () => node.active && node.agents.size === 4 && node.ready);
  hammer.say("Rhino 1, this is Hammer. Radio check. Over.");
  await eventually("Rhino 1's answer from the server's agents", () => hammer.radio().includes("Hammer, this is Rhino 1. Five by five. Out."));
});
