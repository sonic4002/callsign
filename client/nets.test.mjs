// The two nets: which lines the command net shows at each radio traffic level, which
// belong to the squad net, and which are spoken.

import assert from "node:assert/strict";
import { test } from "node:test";

import { FULL, NORMAL, QUIET, heard, onCommandNet, onSquadNet, traffic } from "./nets.js";

const radio = (kind, net, level, extra = {}) => ({ kind: "radio", message: { kind, net, level, ...extra } });
const lines = {
  order: radio("order", "command", 1),
  answer: radio("answer", "command", 1),
  baseCue: radio("cue", "command", 1, { cue: "baseUnderAttack" }),
  lesserCue: radio("cue", "command", 2, { cue: "powerRestored" }),
  hammersSquad: radio("contact", "command", 1), // a squad Hammer ordered by name
  contact: radio("contact", "command", 2),
  objective: radio("objective", "command", 2),
  routine: radio("status", "command", 3),
  squadReport: radio("contact", "squad", 3),
  squadAck: radio("ack", "squad", 3),
};

test("the command net shows what the level lets through, and the squad net the rest", () => {
  const shown = (level) => Object.keys(lines).filter((name) => onCommandNet(lines[name], level));
  assert.deepEqual(shown(QUIET), ["order", "answer", "baseCue", "hammersSquad"]);
  assert.deepEqual(shown(NORMAL), ["order", "answer", "baseCue", "lesserCue", "hammersSquad", "contact", "objective"]);
  assert.deepEqual(shown(FULL), Object.keys(lines), "full is everything, the squad net's lines too");
  assert.deepEqual(Object.keys(lines).filter((name) => onSquadNet(lines[name])), ["squadReport", "squadAck"]);
});

test("only what the command net shows is spoken", () => {
  for (const level of [QUIET, NORMAL, FULL]) {
    for (const line of Object.values(lines)) assert.equal(heard(line.message, level), onCommandNet(line, level));
  }
  assert.equal(heard(lines.squadReport.message, NORMAL), false, "the squad net is never heard below full");
  assert.equal(heard(lines.hammersSquad.message, QUIET), true, "a squad Hammer ordered is heard at every level");
});

test("the page's own lines: what needs the player always, the rest by level", () => {
  const event = (kind) => ({ kind: "event", event: { kind } });
  for (const kind of ["squad_lost", "captured", "point_lost", "structure_built", "deploying", "hq_under_attack"]) assert.ok(onCommandNet(event(kind), QUIET), kind);
  assert.equal(onCommandNet(event("enemy_destroyed"), QUIET), false);
  assert.equal(onCommandNet(event("enemy_destroyed"), NORMAL), true);
  assert.equal(onCommandNet(event("garrisoned"), NORMAL), false);
  assert.equal(onCommandNet(event("garrisoned"), FULL), true);
  assert.ok(onCommandNet({ kind: "system", key: "matchStarted" }, QUIET));
  assert.ok(onCommandNet({ kind: "radio", message: {} }, QUIET), "a message with no level is shown");
});

test("the setting is remembered, and is normal until chosen", () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  try {
    assert.equal(traffic.level, NORMAL);
    traffic.level = QUIET;
    assert.equal(traffic.level, QUIET);
    assert.equal(store.get("callsign.traffic"), "1");
    store.set("callsign.traffic", "9");
    assert.equal(traffic.level, NORMAL, "nonsense falls back to normal");
  } finally {
    delete globalThis.localStorage;
  }
});
