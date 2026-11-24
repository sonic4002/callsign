// The fall of a headquarters: thresholds, which side fell, and the order of the sequence.

import assert from "node:assert/strict";
import { test } from "node:test";

import { FIRE_AT, Finale, SMOKE_AT, damageState, fallen, timing } from "./finale.js";
import { Fx } from "./fx.js";

test("damage states: smoke at two thirds, fire at one third, fallen at zero", () => {
  assert.equal(damageState(1), 0);
  assert.equal(damageState(SMOKE_AT + 0.01), 0);
  assert.equal(damageState(SMOKE_AT), 1);
  assert.equal(damageState(FIRE_AT + 0.01), 1);
  assert.equal(damageState(FIRE_AT), 2);
  assert.equal(damageState(0.01), 2);
  assert.equal(damageState(0), 3);
  assert.equal(damageState(-0.2), 3);
  assert.equal(damageState(undefined), 0, "no health known is no damage shown");
});

test("fallen: only a match ended by a destroyed headquarters has one, and it is the loser's", () => {
  assert.equal(fallen(null), -1);
  assert.equal(fallen({ over: false, reason: "", winner: -1 }), -1);
  assert.equal(fallen({ over: true, reason: "timer", winner: 0 }), -1);
  assert.equal(fallen({ over: true, reason: "hq_destroyed", winner: 0 }), 1);
  assert.equal(fallen({ over: true, reason: "hq_destroyed", winner: 1 }), 0);
  assert.equal(fallen({ over: true, reason: "hq_destroyed", winner: -1 }), -1);
});

test("timing: the view arrives, then the blast, then the ruin, then the result screen", () => {
  for (const reduced of [false, true]) {
    const at = timing(reduced);
    assert.ok(at.glide <= at.blast && at.blast < at.ruin, "the ruin is swapped in behind the fireball");
    assert.ok(at.ruin - at.blast < 400, "and soon enough that the fireball still hides it");
    assert.ok(at.aftershocks.every((ms) => ms > at.ruin && ms < at.overlay));
    assert.ok(at.overlay - at.blast >= 3000, "the fall is watched for a few seconds");
    assert.ok(at.overlay <= 6000, "and the result does not keep the player waiting");
  }
  assert.equal(timing(true).glide, 0, "with reduced motion the view cuts, it does not glide");
});

test("a finale glides the view once, hands out each step once, and then lets go", () => {
  const from = { cx: 0, cy: 0, zoom: 0.5 };
  const to = { cx: 400, cy: 200, zoom: 1 };
  const f = new Finale({ owner: 0, x: 150, y: 480, from, to, t0: 1000 });
  assert.deepEqual(f.camera(1000), from);
  const mid = f.camera(1000 + f.at.glide / 2);
  assert.ok(mid.cx > 150 && mid.cx < 250 && mid.zoom > 0.7 && mid.zoom < 0.8, "half way there at half time");
  assert.deepEqual(f.due(1000 + f.at.glide), [], "nothing blows up before the view has arrived");
  assert.equal(f.holds(1000 + f.at.glide), true);
  assert.deepEqual(f.camera(1000 + f.at.glide), to);
  assert.equal(f.camera(1000 + f.at.glide + 16), null, "after arriving, the player has the view back");

  const steps = [];
  for (let now = 1000; now <= 1000 + f.at.overlay + 500; now += 16) steps.push(...f.due(now));
  assert.deepEqual(steps, ["blast", "ruin", "aftershock", "aftershock", "aftershock", "overlay"]);
  assert.equal(f.holds(1000 + f.at.overlay - 1), true);
  assert.equal(f.holds(1000 + f.at.overlay), false);
  assert.deepEqual(f.due(1e9), [], "no step is handed out twice");

  // A slow frame that skips past several moments still gets them all, in order.
  const late = new Finale({ owner: 1, x: 0, y: 0, from, to, t0: 0, reduced: true });
  assert.deepEqual(late.camera(0), to, "reduced motion: a cut");
  assert.deepEqual(late.due(60_000), ["blast", "ruin", "aftershock", "aftershock", "aftershock", "overlay"]);
});

test("a burning building and its collapse stay inside the effect pool's limits", () => {
  const fx = new Fx({ reducedMotion: () => false });
  fx.view = { w: 1200, h: 800, screen: (x, y) => [x, y] };
  let now = 0;
  fx.collapse(600, 400, now);
  const afterCollapse = fx.pool.items.length;
  assert.ok(afterCollapse > 80, "the collapse is a big effect");
  assert.ok(fx.kicks.length > 0, "and it shakes the view");
  for (let frame = 0; frame < 60 * 30; frame++) {
    now += 16;
    for (const [id, level] of [["hq0", 3], ["hq1", 2]]) fx.smolder(id, id === "hq0" ? 600 : 300, 400, now, level);
    fx.update(now, 0.016);
  }
  assert.ok(fx.pool.items.length < 200, `two fires burning for 30 s hold ${fx.pool.items.length} particles`);
  const before = fx.pool.items.length;
  fx.smolder("hq1", 300, 400, now, 0);
  assert.equal(fx.pool.items.length, before, "level 0 is no fire");

  const still = new Fx({ reducedMotion: () => true });
  still.view = fx.view;
  still.collapse(600, 400, 0);
  assert.equal(still.kicks.length, 0, "no shake under reduced motion");
});
