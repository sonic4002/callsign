// End to end for a match between two people: the real game server with an agent key, the
// lobby over HTTP, two commanders on their own seats, and one agent host serving both
// sides of the room through the Director.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { scriptedBrain } from "../brain-scripted.mjs";
import { Director } from "../main.mjs";

const bin = process.env.CALLSIGN_BIN;
const skip = bin ? false : "set CALLSIGN_BIN to the built game server (make test does)";
const clientDir = fileURLToPath(new URL("../../client", import.meta.url));
const key = "test-agent-key";

async function startServer(t) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(bin, ["-addr", `127.0.0.1:${port}`, "-speed", "20", "-client", clientDir, "-agent-key", key]);
  t.after(() => proc.kill());
  await new Promise((resolve, reject) => {
    proc.stderr.on("data", (d) => String(d).includes("listening") && resolve());
    proc.on("exit", (code) => reject(new Error(`game server exited with ${code}`)));
  });
  return `127.0.0.1:${port}`;
}

async function eventually(what, check, ms = 10000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const post = async (url, body) => {
  const res = await fetch(url, { method: "POST", body: JSON.stringify(body) });
  return { status: res.status, ...(await res.json()) };
};

// A commander's connection: the frames it was sent, and whether it was turned away.
function commander(t, host, room, side, token) {
  const c = { frames: [], closed: null };
  c.ws = new WebSocket(`ws://${host}/ws?${new URLSearchParams({ room, side, role: "hammer", token })}`);
  t.after(() => c.ws.close());
  c.ws.addEventListener("message", (ev) => c.frames.push(JSON.parse(ev.data)));
  c.ws.addEventListener("close", (ev) => (c.closed = ev.reason || "closed"));
  c.send = (frame) => c.ws.send(JSON.stringify(frame));
  c.radio = () => c.frames.filter((f) => f.type === "radio").map((f) => f.message.text);
  c.lobby = () => c.frames.findLast((f) => f.type === "lobby" || f.type === "hello")?.lobby;
  return c;
}

test("two commanders share a room: each has its own agents and hears only its own net", { skip }, async (t) => {
  const host = await startServer(t);
  const made = await post(`http://${host}/api/rooms`, { opponent: "friend", side: 0, length: 120 });
  assert.equal(made.status, 201);
  const sat = await post(`http://${host}/api/rooms/${made.room}/seat`, {});
  assert.deepEqual([sat.status, sat.side], [200, 1]);
  assert.equal((await post(`http://${host}/api/rooms/${made.room}/seat`, {})).status, 409, "a third seat");

  // Someone with the code but no seat cannot command, watch, or pose as an agent.
  const intruder = commander(t, host, made.room, 0, "not-a-token");
  await eventually("the intruder to be turned away", () => intruder.closed);
  assert.match(intruder.closed, /do not hold that seat/);
  assert.equal(intruder.frames.length, 0, "nothing was sent before the refusal");
  assert.equal((await fetch(`http://${host}/internal/rooms`)).status, 401);

  const west = commander(t, host, made.room, 0, made.token);
  const east = commander(t, host, made.room, 1, sat.token);
  await eventually("both greetings", () => west.lobby() && east.lobby());

  const director = new Director({ server: `ws://${host}/ws`, key, brainFor: async () => scriptedBrain(), log: () => {} });
  t.after(() => director.stop());
  await director.sync();
  assert.deepEqual([...director.hosts.keys()].sort(), [`${made.room}:0`, `${made.room}:1`]);
  await eventually("both sides' agents on the net", () => [...director.hosts.values()].every((h) => h.ready));

  // Orders before both are ready reach the squads, but the clock has not started.
  west.send({ type: "ready" });
  await eventually("west ready", () => east.lobby().seats[0].ready);
  assert.equal(east.lobby().phase, "lobby");
  east.send({ type: "ready" });
  await eventually("the match to start", () => west.lobby().phase === "playing" && east.lobby().phase === "playing");

  west.send({ type: "radio", text: "Viper 1, this is Hammer. Hold Bravo. Over." });
  east.send({ type: "radio", text: "צפע 1, כאן פטיש, תחזיקו את כרמל, עבור." });
  await eventually("each side's Wilco", () => west.radio().length >= 2 && east.radio().length >= 2);
  assert.deepEqual(west.radio().slice(0, 2), ["Viper 1, this is Hammer. Hold Bravo. Over.", "Hammer, this is Viper 1. Wilco. Out."]);
  assert.deepEqual(east.radio().slice(0, 2), ["צפע 1, כאן פטיש, תחזיקו את כרמל, עבור.", "פטיש, כאן צפע 1, רות, יבוצע, סוף."]);
  for (const [c, side] of [[west, 0], [east, 1]]) {
    for (const f of c.frames) {
      if (f.type === "state") assert.ok(f.state.squads.every((s) => s.side === side), `side ${side} was sent the other side's squads`);
      if (f.type === "event") assert.equal(f.event.side, side);
    }
  }

  // The match plays to its end at 20x; then one asks for a rematch and both must ready up.
  await eventually("the result", () => west.lobby().phase === "over", 20000);
  assert.match(west.radio().at(-1), /^Hammer, this is Anvil\./);
  east.send({ type: "restart" });
  await eventually("the lobby again", () => west.lobby().phase === "lobby" && west.lobby().match === 1);
  assert.deepEqual(west.lobby().seats.map((s) => [s.taken, s.ready]), [[true, false], [true, false]]);
  west.send({ type: "ready" });
  east.send({ type: "ready" });
  await eventually("the rematch to start", () => east.lobby().phase === "playing");

  // A commander who leaves: the other is told, and the agents of the one who left stand down
  // only after the grace period, so nothing changes at once.
  west.ws.close();
  await eventually("east to be told", () => east.lobby().seats[0].online === false);
  assert.equal(east.lobby().phase, "playing");
  await director.sync();
  assert.equal(director.hosts.size, 2, "a reload must not cost the squads their leaders");
});
