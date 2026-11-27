// The sharp ground tiles: when they are wanted, which ones a view touches, and which are kept.

import assert from "node:assert/strict";
import { test } from "node:test";

import { LEVELS, TILE, TileCache, detailLevel, tilesIn } from "./tiles.js";

test("tiles are wanted only when the view is closer than the whole-map picture shows", () => {
  // The large map's whole picture has about half a pixel per unit.
  assert.equal(detailLevel(0.36, 0.54), 0, "the opening view of a desktop: the whole picture is sharp enough");
  assert.equal(detailLevel(0.56, 0.54), 0, "a hair closer is not worth baking for");
  assert.equal(detailLevel(0.72, 0.54), LEVELS[0], "the opening view of a phone with two pixels to the point");
  assert.equal(detailLevel(1.2, 0.54), LEVELS[1]);
  assert.equal(detailLevel(4, 0.54), LEVELS.at(-1), "closer than the sharpest tile: that tile, scaled up");
  // A small map's whole picture is as sharp as any tile, so it never needs one.
  assert.equal(detailLevel(1.4, 1.5), 0);
  assert.equal(detailLevel(4, 1.5), 0);
  // A coarse tile no sharper than the whole picture is skipped for the next level.
  assert.equal(detailLevel(0.9, 0.8), LEVELS[1]);
});

test("the tiles a view touches, the middle of the view first, never past the picture", () => {
  const picture = { x: -3290, y: -90, w: 8580, h: 4380 }; // the large map
  const level = LEVELS[1];
  const size = TILE / level;
  const view = { x: 0, y: 1000, w: 1000, h: 600 };
  const got = tilesIn(picture, level, view);
  assert.ok(got.length >= 2 && got.length <= 6, `${got.length} tiles for a close view`);
  for (const t of got) {
    assert.equal(t.size, size);
    assert.ok(t.x < view.x + view.w && t.x + size > view.x && t.y < view.y + view.h && t.y + size > view.y, "every tile touches the view");
    assert.equal(t.x, picture.x + t.i * size);
  }
  // Together they cover the view.
  for (const [x, y] of [[1, 1001], [999, 1001], [1, 1599], [999, 1599], [500, 1300]]) {
    assert.ok(got.some((t) => x >= t.x && x < t.x + size && y >= t.y && y < t.y + size), `(${x}, ${y}) is covered`);
  }
  const far = (t) => Math.hypot(t.x + size / 2 - 500, t.y + size / 2 - 1300);
  for (let i = 1; i < got.length; i++) assert.ok(far(got[i - 1]) <= far(got[i]), "nearest the middle first");
  // A view hanging off the picture gets only tiles that exist.
  for (const t of tilesIn(picture, level, { x: -5000, y: -900, w: 2500, h: 1500 })) assert.ok(t.i >= 0 && t.j >= 0);
  assert.deepEqual(tilesIn(picture, level, { x: 9000, y: 9000, w: 100, h: 100 }), []);
  // The whole picture at the coarse level is more tiles than a phone keeps: then none is drawn.
  assert.ok(tilesIn(picture, LEVELS[0], picture).length > 8);
});

test("the cache bakes on request, keeps what was used last and drops the rest", () => {
  const made = [];
  const cache = new TileCache(3, (level, t) => (made.push(`${level}:${t.i}:${t.j}`), { level, ...t }));
  const tile = (i, j) => ({ i, j, x: 0, y: 0, size: 100 });
  assert.equal(cache.get(1.5, tile(0, 0)), null, "not baked until asked for");
  assert.equal(made.length, 0);
  for (const i of [0, 1, 2]) assert.ok(cache.get(1.5, tile(i, 0), true));
  assert.deepEqual(made, ["1.5:0:0", "1.5:1:0", "1.5:2:0"]);
  assert.ok(cache.get(1.5, tile(0, 0)), "kept");
  cache.get(1.5, tile(3, 0), true); // the one used longest ago goes: tile 1
  assert.equal(cache.size, 3);
  assert.equal(cache.get(1.5, tile(1, 0)), null);
  assert.ok(cache.get(1.5, tile(0, 0)) && cache.get(1.5, tile(2, 0)) && cache.get(1.5, tile(3, 0)));
  assert.equal(cache.get(0.75, tile(0, 0)), null, "a level is a tile of its own");
  cache.clear();
  assert.equal(cache.size, 0);
});
