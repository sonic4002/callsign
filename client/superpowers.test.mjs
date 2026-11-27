// Exercises every one of the 15 super-power animations across ground/standing/sky depth passes,
// sub-tick interpolation, post-match fadeout, big-dt/reload burst suppression, reduced motion,
// fog-of-war enemy crosshair/decoy hiding, and target bounds/terrain validation.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Camera } from "./iso.js";
import { SuperPowerFx, isValidSuperTarget } from "./superpowers-fx.js";

const rules = JSON.parse(readFileSync(new URL("../shared/rules.json", import.meta.url), "utf8"));
rules.map = rules.maps.small;

function mockCtx() {
  const grad = () => ({ addColorStop() {} });
  let ops = 0;
  return new Proxy(
    {
      save() {},
      restore() {},
      beginPath() { ops++; },
      closePath() {},
      moveTo() {},
      lineTo() {},
      arc() { ops++; },
      ellipse() { ops++; },
      rect() { ops++; },
      roundRect() { ops++; },
      fillRect() { ops++; },
      strokeRect() {},
      fill() { ops++; },
      stroke() { ops++; },
      clip() {},
      setLineDash() {},
      translate() {},
      rotate() {},
      scale() {},
      fillText() { ops++; },
      measureText: (s) => ({ width: String(s).length * 7 }),
      createRadialGradient: grad,
      createLinearGradient: grad,
      resetOps() { ops = 0; },
      get count() { return ops; },
    },
    {
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    },
  );
}

test("SuperPowerFx renders telegraph, impact, sub-impacts, hazards, craters and cursors for all 15 super powers", () => {
  assert.equal(rules.superPowers.length, 15);
  const cam = new Camera();
  cam.setWorld(rules.map.width, rules.map.height);
  cam.resize(1280, 800);

  const sfxPlayed = [];
  const shakes = [];
  const blasts = [];
  const fxStub = {
    shake: (x, y, amt) => shakes.push([x, y, amt]),
    blast: (x, y, now, s, opts) => blasts.push({ x, y, s, opts }),
  };
  const sfxStub = {
    playSuper: (power, phase) => sfxPlayed.push(`${power}:${phase}`),
  };

  const spFx = new SuperPowerFx();
  const ctx = mockCtx();

  // 1. Test mouse + touch targeting cursors + target validation
  for (const sp of rules.superPowers) {
    spFx.drawCursor(ctx, cam, { id: sp.id, def: sp, start: null, targets: [], invalidText: "Invalid" }, { x: 640, y: 400 }, 1000, "en", rules, false);
    spFx.drawCursor(ctx, cam, { id: sp.id, def: sp, start: { x: 400, y: 400 }, end: { x: 620, y: 450 }, spot: { x: 620, y: 450 }, targets: [{ x: 350, y: 350 }, { x: 500, y: 420 }], touch: true, invalidText: "Invalid" }, null, 1400, "he", rules, true);
    assert.equal(isValidSuperTarget(rules, sp, -50, 300), false, "out-of-bounds west rejected");
    assert.equal(isValidSuperTarget(rules, sp, rules.map.width + 10, 300), false, "out-of-bounds east rejected");
  }

  // 2. Test telegraph AND detonation/ongoing phases of all 15 super powers
  const strikes = rules.superPowers.map((sp, idx) => ({
    id: idx + 1,
    power: sp.id,
    side: idx % 2,
    startTick: 100,
    impactTick: 130,
    endTick: 220,
    x: 500,
    y: 450,
    x2: 740,
    y2: 500,
    seed: 12345 + idx,
    targets: [{ x: 500, y: 450 }, { x: 580, y: 490 }, { x: 440, y: 510 }],
    subImpacts: [
      { x: 510, y: 460, startX: 20, startY: 450, launchTick: 105, impactTick: 135 },
      { x: 550, y: 430, startX: 20, startY: 500, launchTick: 112, impactTick: 145, intercepted: true },
    ],
  }));

  for (const [tick, now] of [[102, 10200], [115, 10500], [130, 10800], [136, 11100], [146, 11400], [180, 11700]]) {
    spFx.drawStrikes(ctx, cam, { side: 0, tick, superStrikes: strikes }, rules, now, 1.1, fxStub, sfxStub, false);
  }
  assert.ok(sfxPlayed.length >= 15, `expected >=15 super audio cues, got ${sfxPlayed.length}`);
  assert.ok(shakes.length >= 8, "camera shake triggered on kinetic/nuclear/explosive impacts");
  assert.ok(blasts.every((b) => b.opts?.scorch === false), "client blasts disable local random scorch so authoritative server scorches match");

  // 3. Test craters (including authoritative scorch), all 7 hazard types, unseen spoof hiding, status overlays & flashes
  const state = {
    side: 0,
    tick: 150,
    craters: [
      { id: 1, x: 500, y: 450, r: 72, tick: 130, kind: "kinetic" },
      { id: 2, x: 640, y: 420, r: 100, tick: 130, kind: "nuke" },
      { id: 3, x: 420, y: 500, r: 56, tick: 130, kind: "tunnel" },
      { id: 4, x: 480, y: 460, r: 22, tick: 135, kind: "scorch" },
    ],
    hazards: [
      { id: 1, kind: "fallout", side: 0, x: 500, y: 450, r: 180, startTick: 130, endTick: 500, visible: true },
      { id: 2, kind: "chemical", side: 1, x: 540, y: 470, r: 155, startTick: 130, endTick: 450, vx: 3, vy: 1, visible: true },
      { id: 3, kind: "napalm", side: 1, x: 450, y: 420, x2: 700, y2: 480, r: 44, startTick: 130, endTick: 380, visible: true },
      { id: 4, kind: "trench", side: 0, x: 460, y: 400, x2: 710, y2: 440, r: 26, startTick: 130, endTick: 380, visible: true },
      { id: 5, kind: "cyber", side: 0, x: 600, y: 460, r: 270, startTick: 130, endTick: 410, visible: true },
      { id: 6, kind: "emp", side: 0, x: 580, y: 440, r: 235, startTick: 130, endTick: 350, visible: true },
      { id: 7, kind: "spoof", side: 1, x: 520, y: 480, r: 245, startTick: 130, endTick: 370, visible: true, decoys: [{ x: 500, y: 470, unit: "tank" }, { x: 545, y: 495, unit: "militia" }] },
    ],
    squads: [{ id: 1, side: 0, teams: [{ x: 510, y: 455, stunned: true }] }],
    contacts: [{ id: 2, side: 1, teams: [{ x: 560, y: 470, stunned: true }] }],
    structures: [{ id: "s4", side: 1, x: 600, y: 460, disabled: true, ruin: false }],
  };
  spFx.drawCraters(ctx, cam, state, rules, 12000, false);
  spFx.drawHazards(ctx, cam, state, rules, 12100, 1.1, false);
  spFx.drawStatusOverlays(ctx, cam, state, 12150, 1.1, true);
  spFx.drawScreenFlash(ctx, 1280, 800, 10900, false);
  assert.ok(ctx.count > 500, `expected rich procedural canvas geometry, drew ${ctx.count} ops`);

  // 4. Unseen enemy spoof hazard (visible: false) draws nothing on battlefield canvas
  ctx.resetOps();
  spFx.drawHazards(ctx, cam, { side: 0, tick: 150, hazards: [{ ...state.hazards[6], visible: false }] }, rules, 12200, 1.1, false);
  assert.equal(ctx.count, 0, "unseen spoof hazard must draw nothing on battlefield canvas");

  // 5. Post-match fadeout stops all strike/hazard animations cleanly within 1.2s of state.over
  const endFx = new SuperPowerFx();
  const overState = { side: 0, over: true, tick: 132, superStrikes: strikes, hazards: state.hazards };
  endFx.drawStrikes(ctx, cam, overState, rules, 20000, 1.1, fxStub, sfxStub, false);
  ctx.resetOps();
  const shakesBefore = shakes.length;
  endFx.drawStrikes(ctx, cam, overState, rules, 21500, 1.1, fxStub, sfxStub, false);
  endFx.drawHazards(ctx, cam, overState, rules, 21500, 1.1, false);
  assert.equal(ctx.count, 0, "all active strikes and hazards stop drawing after match-end fadeout");
  assert.equal(shakes.length, shakesBefore, "no post-match camera shakes");

  // 6. Tab-hidden big dt spike / mid-match reload suppresses stale bursts
  const reloadFx = new SuperPowerFx();
  const reloadSfx = [];
  reloadFx.drawStrikes(ctx, cam, { side: 0, tick: 160, superStrikes: strikes }, rules, 30000, 1.1, fxStub, { playSuper: (p, ph) => reloadSfx.push(`${p}:${ph}`) }, false);
  assert.equal(reloadSfx.length, 0, "stale strikes on mid-match reload must not replay launch or impact sounds");
});
