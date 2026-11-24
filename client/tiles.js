// The ground in detail. One picture of a whole big map at full sharpness would be more
// pixels than a phone will hold, so the map is baked twice: once whole and coarse, for
// looking at all of it, and in sharp square tiles for the part on screen when the view
// is closer than the coarse picture can show. Tiles are baked as they come into view and
// the ones not looked at for longest are dropped. Nothing here touches a canvas, so the
// tests can run it without a page.

export const TILE = 1024; // a tile is this many pixels square
// Pixels per unit of the iso plane a tile may be baked at, coarsest first. The last is
// the sharpest the ground is ever drawn; a closer view than that is scaled up, as before.
export const LEVELS = [0.75, 1.5];

// detailLevel is the tile resolution a view needs: `need` is screen pixels per iso unit
// (zoom times the pixel ratio), `base` what the whole-map picture has. 0 means the
// whole-map picture is sharp enough by itself.
export function detailLevel(need, base) {
  if (need <= base * 1.08) return 0;
  return LEVELS.find((res) => res >= need / 1.08 && res > base) ?? (LEVELS.at(-1) > base ? LEVELS.at(-1) : 0);
}

// tilesIn lists the tiles of a level that touch a rectangle of the iso plane, nearest
// the middle of it first. `picture` is the baked area { x, y, w, h } in iso units; a
// tile is { i, j, x, y, size } with its corner and side in iso units.
export function tilesIn(picture, level, view) {
  const size = TILE / level;
  const i0 = Math.max(0, Math.floor((view.x - picture.x) / size));
  const j0 = Math.max(0, Math.floor((view.y - picture.y) / size));
  const i1 = Math.min(Math.ceil(picture.w / size) - 1, Math.floor((view.x + view.w - picture.x) / size));
  const j1 = Math.min(Math.ceil(picture.h / size) - 1, Math.floor((view.y + view.h - picture.y) / size));
  const out = [];
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) out.push({ i, j, x: picture.x + i * size, y: picture.y + j * size, size });
  }
  const mx = view.x + view.w / 2;
  const my = view.y + view.h / 2;
  const far = (t) => Math.hypot(t.x + size / 2 - mx, t.y + size / 2 - my);
  return out.sort((a, b) => far(a) - far(b));
}

// TileCache keeps the baked tiles, at most `limit` of them: the one used longest ago goes
// when a new one needs its place. `make(level, tile)` bakes a tile and returns its canvas.
export class TileCache {
  constructor(limit, make) {
    this.limit = limit;
    this.make = make;
    this.tiles = new Map(); // "level:i:j" → { canvas, used }
    this.clock = 0;
  }

  // get returns a tile's canvas, or null when it is not baked yet. With `bake` it is
  // baked now if need be.
  get(level, tile, bake = false) {
    const key = `${level}:${tile.i}:${tile.j}`;
    let hit = this.tiles.get(key);
    if (!hit && bake) {
      while (this.tiles.size >= this.limit) {
        let oldest = null;
        for (const [k, v] of this.tiles) if (!oldest || v.used < this.tiles.get(oldest).used) oldest = k;
        this.tiles.delete(oldest);
      }
      hit = { canvas: this.make(level, tile), used: 0 };
      this.tiles.set(key, hit);
    }
    if (!hit) return null;
    hit.used = ++this.clock;
    return hit.canvas;
  }

  clear() {
    this.tiles.clear();
  }

  get size() {
    return this.tiles.size;
  }
}
