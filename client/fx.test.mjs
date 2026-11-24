// The pure parts of the battle effects and sounds: the bounded pools, the limit on how
// many sounds play at once, and how a sound is placed by where it is on screen.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Fx, LIMITS, Pool, nearness } from "./fx.js";
import { Voices, hearing, kinds, weaponOf } from "./sfx.js";

test("a pool never grows past its cap, and only a higher priority gets into a full one", () => {
  const pool = new Pool(3);
  for (let i = 0; i < 3; i++) assert.ok(pool.add({ pri: 1, t0: i, ttl: 100 }));
  assert.equal(pool.add({ pri: 1, t0: 9, ttl: 100 }), false, "same priority is dropped");
  assert.equal(pool.add({ pri: 0, t0: 9, ttl: 100 }), false, "lower priority is dropped");
  assert.ok(pool.add({ pri: 2, t0: 9, ttl: 100 }), "higher priority replaces");
  assert.equal(pool.items.length, 3);
  assert.ok(!pool.items.some((it) => it.t0 === 0), "the oldest lower-priority item went");
  pool.sweep(105);
  assert.deepEqual(pool.items.map((it) => it.t0), [9], "items past their time are swept");
});

test("a long barrage stays inside every limit", () => {
  const fx = new Fx({ reducedMotion: () => false });
  fx.reset(820);
  fx.view = { w: 1200, h: 800, screen: (x, y) => [x, y] };
  let now = 0;
  for (let i = 0; i < 400; i++) {
    now += 16;
    const x = 200 + (i % 20) * 30;
    fx.blast(x, 300, now, 1 + (i % 3));
    fx.wreck(x, 400, now);
    fx.sinking(x, 900, now);
    fx.collapse(600, 400, now);
    fx.pop(x, 500, now);
    fx.dust(x, 500, now);
    fx.update(now, 0.016);
    assert.ok(fx.pool.items.length <= LIMITS.particles);
    assert.ok(fx.decals.items.length <= LIMITS.decals);
    assert.ok(fx.emitters.items.length <= LIMITS.emitters);
    assert.ok(fx.kick <= 12, `shake stays small, got ${fx.kick}`);
  }
  for (const p of fx.pool.items) assert.ok(Number.isFinite(p.x + p.y + p.h), "no particle flies off to NaN");
  fx.update(now + 120_000, 0.016);
  assert.equal(fx.pool.items.length + fx.decals.items.length + fx.emitters.items.length, 0, "everything ends");
});

test("effects off screen are skipped, shells in the sea make spray, and reduced motion means no shake", () => {
  const fx = new Fx({ reducedMotion: () => true });
  fx.reset(820);
  fx.view = { w: 1200, h: 800, screen: (x, y) => [x, y] };
  fx.blast(5000, 5000, 0, 2);
  assert.equal(fx.pool.items.length, 0);
  fx.shell(600, 900, 0);
  assert.ok(fx.pool.items.length > 0 && fx.pool.items.every((p) => p.tex !== "fire"), "water, not fire");
  assert.equal(fx.decals.items.length, 0, "no scorch mark on the sea");
  fx.blast(600, 400, 0, 3);
  fx.update(1, 0.016);
  assert.equal(fx.kick, 0);
  assert.deepEqual(fx.offset(1), [0, 0]);
});

test("shake is strongest at the middle of the view", () => {
  const view = { w: 1000, h: 600 };
  assert.equal(nearness(view, 500, 300), 1);
  assert.ok(nearness(view, 900, 300) < 1 && nearness(view, 900, 300) > 0);
  assert.equal(nearness(view, 3000, 300), 0);
});

test("hearing: louder and brighter at the middle, panned to its side, silent far away", () => {
  const view = { w: 1000, h: 600 };
  const mid = hearing(view, 500, 300);
  const right = hearing(view, 1000, 300);
  const far = hearing(view, 1800, 300);
  assert.equal(mid.pan, 0);
  assert.ok(mid.gain > right.gain && right.gain > far.gain && far.gain > 0);
  assert.ok(right.pan > 0.5 && hearing(view, 0, 300).pan < -0.5);
  assert.ok(mid.cutoff > 10_000 && far.cutoff < 2500 && far.cutoff >= 700);
  assert.equal(hearing(view, 9000, 300).gain, 0);
  assert.ok(hearing(view, 500, 300, 0.2).gain < mid.gain, "zoomed out is quieter");
  for (const h of [mid, right, far]) assert.ok(h.pan >= -1 && h.pan <= 1 && h.gain <= 1);
});

test("voices: a cap on how many play, a gap between repeats, and the louder kind wins", () => {
  const v = new Voices(3);
  let stopped = 0;
  const stop = () => stopped++;
  assert.ok(v.admit("rifleA", 0, stop));
  assert.equal(v.admit("rifleA", 10, stop), false, "too soon after the same kind");
  assert.ok(v.admit("rifleB", 10, stop));
  assert.ok(v.admit("mg", 20, stop));
  assert.equal(v.admit("rifleA", 200, stop), false, "full, and no quieter voice to push out");
  assert.ok(v.admit("cannon", 210, stop), "a cannon pushes a rifle out");
  assert.equal(stopped, 1);
  assert.equal(v.active.length, 3);
  assert.ok(v.admit("boomL", 220, stop) && v.admit("boomM", 230, stop));
  assert.equal(v.active.length, 3);
  assert.ok(v.admit("rifleA", 60_000, stop), "voices free up when their sound is over");
  assert.equal(v.active.length, 1);
  assert.equal(v.admit("nothing", 0), false);
});

test("every unit has a weapon whose sound exists", () => {
  for (const unit of ["commandos", "militia", "tank", "technical", "patrolBoat", "speedboat"]) {
    assert.ok(kinds[weaponOf(unit).sound], unit);
  }
  assert.ok(kinds[weaponOf("something new", "vehicle").sound]);
});
