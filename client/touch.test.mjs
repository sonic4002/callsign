// The gesture arithmetic of the map: tap, drag and pinch.

import assert from "node:assert/strict";
import { test } from "node:test";

import { Camera } from "./iso.js";
import { Gesture, capRatio } from "./touch.js";

test("a press that stays put is a tap; one that wanders is a drag", () => {
  const g = new Gesture({ slop: 10 });
  g.down(1, 100, 100);
  assert.deepEqual(g.move(1, 104, 103), {});
  assert.deepEqual(g.up(1), { tap: { x: 100, y: 100 } });

  g.down(1, 100, 100);
  assert.deepEqual(g.move(1, 100, 112), { pan: [0, 12] });
  assert.deepEqual(g.move(1, 105, 112), { pan: [5, 0] });
  assert.deepEqual(g.up(1), {}, "a drag does not end in a tap");
  assert.equal(g.active, false);
});

test("two fingers pinch about their midpoint and pan with it", () => {
  const g = new Gesture();
  g.down(1, 100, 200);
  g.down(2, 200, 200);
  const out = g.move(2, 300, 200); // spread 100 → 200, midpoint 150 → 200
  assert.deepEqual(out.pan, [50, 0]);
  assert.equal(out.zoom.factor, 2);
  assert.deepEqual([out.zoom.x, out.zoom.y], [200, 200]);
  // Lifting one finger must not jump the map, and the gesture is no tap.
  assert.deepEqual(g.up(2), {});
  assert.deepEqual(g.move(1, 101, 200), { pan: [1, 0] });
  assert.deepEqual(g.up(1), {});
  // The next press starts clean.
  g.down(3, 10, 10);
  assert.deepEqual(g.up(3), { tap: { x: 10, y: 10 } });
});

test("a cancelled pointer leaves nothing behind", () => {
  const g = new Gesture();
  g.down(1, 0, 0);
  g.down(2, 50, 0);
  g.cancel(1);
  g.cancel(2);
  assert.equal(g.active, false);
  g.down(1, 5, 5);
  assert.deepEqual(g.up(1), { tap: { x: 5, y: 5 } });
});

test("a pinch keeps the ground under the fingers where it was", () => {
  const cam = new Camera();
  cam.setWorld(1600, 1000);
  cam.resize(390, 600);
  cam.centerOn(800, 500);
  const before = cam.world(120, 300);
  cam.zoomAt(120, 300, 1.5);
  const after = cam.world(120, 300);
  assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) < 1e-6);
});

test("the canvas resolution is capped, harder on phones", () => {
  assert.equal(capRatio(3, true), 2);
  assert.equal(capRatio(1.5, true), 1.5);
  assert.equal(capRatio(4, false), 3);
  assert.equal(capRatio(undefined, false), 1);
  assert.equal(capRatio(0.5, true), 1);
});
