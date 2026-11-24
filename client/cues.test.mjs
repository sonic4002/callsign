// The radio log's housekeeping: repeats folded, the phone's strip, cue speech.

import assert from "node:assert/strict";
import { test } from "node:test";

import { FOLD_TICKS, foldLog, spoken, stripPick } from "./cues.js";
import { fieldSeen } from "./gold.js";
import { DEPTH_BIAS, Fx } from "./fx.js";

const hammer = { key: "player", en: "Hammer", he: "פטיש" };
const anvil = { key: "operator", en: "Anvil", he: "סדן" };
const viper = { key: "infantry-1", en: "Viper 1", he: "צפע 1", squad: 1 };
const radio = (from, to, tick, extra = {}) => ({ kind: "radio", message: { from, to: [to], tick, text: `${to.en}, this is ${from.en}.`, ...extra } });
const event = (kind, tick, extra = {}) => ({ kind: "event", event: { kind, tick, side: 0, ...extra } });
const system = (key, tick, vars = {}) => ({ kind: "system", key, vars, tick });

test("squads fielded one after the other become one line, their cues notwithstanding", () => {
  const lines = foldLog([
    event("squad_spawned", 100, { squad: 4 }),
    radio(anvil, hammer, 100, { cue: "unitReady" }),
    event("squad_spawned", 110, { squad: 5 }),
    event("squad_spawned", 130, { squad: 6 }),
    radio(viper, hammer, 140),
    event("squad_spawned", 150, { squad: 7 }),
  ]);
  assert.deepEqual(lines.map((l) => [l.entry.kind, l.count]), [["event", 3], ["radio", 1], ["radio", 1], ["event", 1]]);
});

test("only the same thing folds, and only while it keeps happening", () => {
  const built = (unit, tick) => event("structure_built", tick, { unit });
  assert.deepEqual(foldLog([built("sentryGun", 10), built("sentryGun", 20), built("barracks", 30)]).map((l) => l.count), [2, 1]);
  assert.deepEqual(foldLog([event("squad_lost", 10), event("squad_lost", 10 + FOLD_TICKS + 1)]).map((l) => l.count), [1, 1]);
  // Lines that are not repeats of anything are left alone.
  assert.deepEqual(foldLog([event("captured", 10, { point: "F" }), event("captured", 12, { point: "G" })]).map((l) => l.count), [1, 1]);
  // The same refusal twice is one line; a different one is its own.
  const refusals = foldLog([system("refused", 10, { reason: "a" }), system("refused", 12, { reason: "a" }), system("refused", 14, { reason: "b" })]);
  assert.deepEqual(refusals.map((l) => l.count), [2, 1]);
  // Radio is never folded: every transmission is shown as sent.
  assert.equal(foldLog([radio(viper, hammer, 1), radio(viper, hammer, 2)]).length, 2);
});

test("the phone's strip shows radio to the player before system lines", () => {
  const lines = foldLog([
    radio(viper, hammer, 10), // 0: to the player
    system("matchStarted", 11), // 1
    event("captured", 12, { point: "F" }), // 2
    radio(hammer, viper, 13), // 3: the player's own call
    event("point_lost", 14, { point: "G" }), // 4
    radio(anvil, hammer, 15, { cue: "baseUnderAttack" }), // 5: to the player
    event("hq_under_attack", 16), // 6
    system("refused", 17, { reason: "x" }), // 7
  ]);
  // Four lines: both calls to the player, the player's own call, and the newest system line.
  assert.deepEqual(stripPick(lines, "player", 4), [0, 3, 5, 7]);
  assert.deepEqual(stripPick(lines, "player", 2), [0, 5]);
  // With nothing but system lines it is simply the newest ones, in order.
  const quiet = foldLog([1, 2, 3, 4, 5, 6].map((n) => event("captured", n, { point: String(n) })));
  assert.deepEqual(stripPick(quiet, "player", 4), [2, 3, 4, 5]);
  // A call from long ago does not sit in the strip for ever.
  const old = foldLog([radio(viper, hammer, 1), ...Array.from({ length: 12 }, (_, n) => event("captured", 10 + n, { point: String(n) }))]);
  assert.ok(!stripPick(old, "player", 4).includes(0));
  // A call to everyone is a call to the player too.
  const all = foldLog([radio(anvil, { key: "all", en: "All stations" }, 1), system("a", 2), system("b", 3), system("c", 4), system("d", 5)]);
  assert.ok(stripPick(all, "player", 2).includes(0));
});

test("a cue is written always and spoken only when the setting says so", () => {
  const cue = { cue: "noGold", text: "Hammer, this is Anvil. Not enough gold. Out." };
  assert.equal(spoken(cue, true), true);
  assert.equal(spoken(cue, false), false);
  assert.equal(spoken({ text: "Hammer, this is Viper 1. Contact. Over." }, false), true, "other radio is not the setting's business");
});

test("a field's figure is shown only once the side has seen the field", () => {
  const state = { fields: [{ gusher: "g1", gold: 1, seen: false }, { gusher: "g2", gold: 0.4, seen: true }, { gusher: "g3", gold: 0.2 }] };
  assert.equal(fieldSeen(state, "g1"), false);
  assert.equal(fieldSeen(state, "g2"), true);
  assert.equal(fieldSeen(state, "g3"), true, "an older server does not say; the figure stays");
});

test("smoke and fire are listed with the depth of the ground they rise from", () => {
  const fx = new Fx({ reducedMotion: () => false });
  fx.reset();
  const view = { w: 800, h: 600, zoom: 1, screen: (x, y) => [x - y + 400, (x + y) / 2] };
  fx.view = view;
  fx.blast(200, 100, 0, 1);
  fx.blast(60, 40, 0, 1);
  const live = fx.standing(view, 1, 50);
  assert.ok(live.length > 4, "a blast puts fire and smoke in the air");
  for (const { depth, p } of live) {
    assert.ok(Math.abs(depth - (p.x + p.y + DEPTH_BIAS)) <= 0.5, "depth is the ground position, a little to the front");
    assert.notEqual(p.kind, "ring", "what lies flat is drawn with the ground");
  }
  // Something standing between the two blasts sorts between their smoke.
  const wall = 200;
  const near = live.filter((l) => l.depth > wall).length;
  const far = live.filter((l) => l.depth < wall).length;
  assert.ok(near > 0 && far > 0, "one blast is behind the wall and one in front of it");
});
