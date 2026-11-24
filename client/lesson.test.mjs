// The first lesson's steps move on when the player has really done the thing. These
// tests walk a made-up match through the lesson, one fact at a time.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { STEPS, advance, answered, bought, canGoOn, engaged, holds, indexOf, nearest, ordered, released, upgraded, stands, hauling } from "./lesson.js";

const rules = JSON.parse(readFileSync(new URL("../shared/rules.json", import.meta.url), "utf8"));
rules.map ??= rules.maps.small; // the default map, as the server sends it to a page
const en = JSON.parse(readFileSync(new URL("i18n/en.json", import.meta.url), "utf8"));

const squad = (id, more = {}) => ({ id, side: 0, tier: 1, order: { kind: "none" }, callsign: { en: `Viper ${id}`, he: `צפע ${id}` }, ...more });
const player = { key: "player", en: "Hammer" };
const viper1 = { key: "infantry-1", en: "Viper 1", squad: 1 };
const say = (from, to, text) => ({ from, to: [to], text });

// A match as it stands at the start: two squads, nothing held, nothing said.
function match(more = {}) {
  return {
    side: 0,
    rules,
    rig: nearest(rules, 0, "landRig"),
    selected: 0,
    destroyed: false,
    log: [],
    state: { faction: "aegis", squads: [squad(1), squad(2)], deploying: [], contacts: [], points: rules.map.points.map((p) => ({ id: p.id, owner: p.kind === "hq" ? p.owner : -1 })) },
    ...more,
  };
}

test("the map's own names: the rig to capture and the first point to hold, for either side", () => {
  assert.equal(nearest(rules, 0, "landRig"), "B");
  assert.equal(nearest(rules, 1, "landRig"), "K");
  assert.equal(nearest(rules, 0, "point"), "D");
  assert.equal(nearest(rules, 1, "point"), "H");
});

test("a step that is only read waits for Next; one the player acts in waits for the act", () => {
  const c = match();
  assert.equal(advance(0, c), 0, "the welcome stays until Next");
  assert.equal(advance(0, c, { next: true }), indexOf("select"));
  assert.equal(advance(indexOf("select"), c), indexOf("select"), "nothing selected yet");
  assert.equal(advance(indexOf("select"), c, { next: true }), indexOf("select"), "Next does nothing on a step to act in");
  assert.equal(advance(indexOf("select"), match({ selected: 2 })), indexOf("order"));
});

test("the first order: a call from the commander to a squad, however it was sent", () => {
  const none = match({ selected: 1, log: [say(player, { key: "operator", en: "Anvil" }, "Anvil, what is the situation?")] });
  assert.equal(ordered(none), false, "a call to the operator is not an order to a squad");
  const sent = match({ log: [say(player, viper1, "Viper 1 hold Delta")] });
  assert.equal(ordered(sent), true);
  // Typed without ever selecting a squad: the select step is passed over with it.
  assert.equal(advance(indexOf("select"), sent), indexOf("answer"));
});

test("the answer step offers Next only once a squad has answered", () => {
  const waiting = match({ log: [say(player, viper1, "Viper 1 hold Delta")] });
  assert.equal(answered(waiting), false);
  assert.equal(canGoOn(indexOf("answer"), waiting), false);
  assert.equal(advance(indexOf("answer"), waiting, { next: true }), indexOf("answer"));
  const heard = match({ log: [...waiting.log, say(viper1, player, "Hammer, this is Viper 1. Wilco. Out.")] });
  assert.equal(canGoOn(indexOf("answer"), heard), true);
  assert.equal(advance(indexOf("answer"), heard, { next: true }), indexOf("orders"));
  // Talk between a squad and the operator is not an answer to the commander.
  assert.equal(answered(match({ log: [say(viper1, { key: "operator" }, "Anvil, this is Viper 1. Contact. Over.")] })), false);
});

test("the refinery and its hauler, the barracks, buying, the squad arriving and the upgrade are read from the match", () => {
  const c = match();
  const built = (role, more = {}) => ({ id: `s-${role}`, kind: role, role, side: 0, building: 1, ...more });
  assert.equal(advance(indexOf("refinery"), c), indexOf("refinery"));
  // Going up is not standing, and a refinery with no hauler out yet is not an economy.
  const rising = match();
  rising.state.structures = [built("refinery", { building: 0.6 })];
  assert.equal(stands(rising, "refinery"), false);
  const empty = match();
  empty.state.structures = [built("refinery")];
  assert.equal(hauling(empty), false);
  const working = match();
  working.state.structures = [built("refinery")];
  working.state.haulers = [{ id: 1001, side: 0, state: "out" }];
  assert.equal(advance(indexOf("refinery"), working), indexOf("fog"));
  // The enemy's refinery and hauler are not ours.
  const theirs0 = match();
  theirs0.state.structures = [built("refinery", { side: 1 })];
  theirs0.state.haulers = [{ id: 1002, side: 1, state: "out" }];
  assert.equal(hauling(theirs0), false);
  assert.equal(holds(match(), "B"), false);

  assert.equal(advance(indexOf("barracks"), working), indexOf("barracks"));
  working.state.structures.push(built("barracks"));
  assert.equal(advance(indexOf("barracks"), working), indexOf("buy"));

  assert.equal(bought(c), false);
  const coming = match();
  coming.state.deploying = [{ id: 5, side: 0, unit: "commandos" }];
  assert.equal(bought(coming), true);
  assert.equal(advance(indexOf("buy"), coming), indexOf("deploy"));
  assert.equal(canGoOn(indexOf("deploy"), coming), false, "still on its way");
  const here = match();
  here.state.squads.push(squad(5));
  assert.equal(canGoOn(indexOf("deploy"), here), true);
  // The enemy's deployments are not ours.
  const theirs = match();
  theirs.state.deploying = [{ id: 9, side: 1, unit: "militia" }];
  assert.equal(bought(theirs), false);

  assert.equal(upgraded(here), false);
  here.state.squads[0].tier = 2;
  assert.equal(advance(indexOf("upgrade"), here), indexOf("enemy"));
});

test("the fight: a squad sent at a named enemy, by click, by voice or by typing", () => {
  assert.equal(engaged(match()), false);
  const clicked = match();
  clicked.state.squads[0].order = { kind: "attack", contact: 4 };
  assert.equal(engaged(clicked), true);
  assert.equal(engaged(match({ log: [say(player, viper1, "Viper 1 attack Target 4")] })), true);
  assert.equal(engaged(match({ log: [say(player, viper1, "צפע 1 תקוף את מטרה 4")] })), true);
  assert.equal(engaged(match({ log: [say(player, viper1, "Viper 1 attack Foxtrot")] })), false, "a point is not an enemy squad");
  assert.equal(engaged(match({ log: [say(viper1, player, "Contact, Target 4 near Bravo")] })), false, "a report is not an order");
  assert.equal(engaged(match({ destroyed: true })), true, "already beaten");
});

test("skip ends any step, steps already done are passed over, and the lesson ends after the last", () => {
  const c = match();
  assert.equal(advance(indexOf("refinery"), c, { skip: true }), indexOf("fog"));
  // Everything up to the fight was done ahead of the coach: reading steps still wait.
  const ahead = match({ selected: 1, log: [say(player, viper1, "Viper 1 hold Delta"), say(viper1, player, "Wilco")] });
  ahead.state.structures = ["refinery", "barracks"].map((role) => ({ id: role, kind: role, role, side: 0, building: 1 }));
  ahead.state.haulers = [{ id: 1001, side: 0, state: "out" }];
  ahead.state.squads.push(squad(5, { tier: 2 }));
  assert.equal(advance(indexOf("select"), ahead), indexOf("answer"));
  assert.equal(advance(indexOf("orders"), ahead, { next: true }), indexOf("fog"));
  assert.equal(advance(indexOf("fog"), ahead, { next: true }), indexOf("deploy"));
  const last = STEPS.length - 1;
  assert.equal(STEPS[last].id, "win");
  assert.equal(advance(last, c, { next: true }), STEPS.length);
  assert.equal(advance(STEPS.length, c, { next: true }), STEPS.length);
});

test("the enemy is released when the lesson reaches buying, and stays released", () => {
  assert.equal(released(indexOf("fog")), false);
  assert.equal(released(indexOf("buy")), true);
  assert.equal(released(STEPS.length - 1), true);
});

test("every step has its line, and a finger line where the words differ", () => {
  for (const step of STEPS) {
    assert.ok(en[`tut.${step.id}`], `tut.${step.id}`);
    assert.equal(Boolean(en[`tutTouch.${step.id}`]), Boolean(step.touch), `tutTouch.${step.id}`);
    assert.ok(step.manual || typeof step.done === "function", `${step.id} can end`);
  }
});
