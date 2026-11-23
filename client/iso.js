// The isometric view: one projection from the simulation's flat world to the screen and
// back, and a camera that can zoom and pan over it. West is always on the left; nothing
// here depends on the page language, so the map never mirrors.

// World (x east, y south) → iso plane, a 2:1 diamond.
export const toIso = (x, y) => [x - y, (x + y) / 2];
export const fromIso = (ix, iy) => [iy + ix / 2, iy - ix / 2];

// A circle on the ground of world radius r is an ellipse on the iso plane.
export const groundEllipse = (r) => [r * Math.SQRT2, (r * Math.SQRT2) / 2];

// Below this zoom the troops and labels are too crowded to read.
const READABLE = 0.36;

export class Camera {
  constructor() {
    this.auto = true; // still showing the opening view; the player has not moved it
    this.home = null; // world point the opening view centres on when the map does not fit
    this.zoom = 1;
    this.cx = 0; // iso point shown at the middle of the view
    this.cy = 0;
    this.w = 1; // view size in CSS pixels
    this.h = 1;
    this.fitZoom = 1;
    this.bounds = { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  }

  // setWorld records the map's extent on the iso plane.
  setWorld(width, height) {
    this.bounds = { minX: -height, maxX: width, minY: 0, maxY: (width + height) / 2 };
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    const b = this.bounds;
    this.fitZoom = Math.min(w / (b.maxX - b.minX + 120), h / (b.maxY - b.minY + 150));
    if (this.auto) this.fit();
    else this.clamp();
  }

  // fit is the opening view: the whole map when the screen is big enough to read it,
  // otherwise a readable zoom centred on `home` (the player's headquarters).
  fit() {
    this.auto = true;
    this.zoom = Math.max(this.fitZoom, READABLE);
    if (this.zoom > this.fitZoom && this.home) [this.cx, this.cy] = toIso(...this.home);
    this.clamp();
  }

  clamp() {
    const b = this.bounds;
    this.zoom = Math.max(this.fitZoom, Math.min(Math.max(this.fitZoom, READABLE) * 4, this.zoom));
    if (this.zoom <= this.fitZoom) {
      // Fully zoomed out, the map sits in the middle with room for labels above the far edge.
      this.cx = (b.minX + b.maxX) / 2;
      this.cy = (b.minY + b.maxY) / 2 - 20 / this.zoom;
      return;
    }
    this.cx = Math.max(b.minX, Math.min(b.maxX, this.cx));
    this.cy = Math.max(b.minY, Math.min(b.maxY, this.cy));
  }

  // World → CSS pixel in the view.
  screen(x, y) {
    const [ix, iy] = toIso(x, y);
    return [(ix - this.cx) * this.zoom + this.w / 2, (iy - this.cy) * this.zoom + this.h / 2];
  }

  // CSS pixel in the view → world.
  world(sx, sy) {
    return fromIso((sx - this.w / 2) / this.zoom + this.cx, (sy - this.h / 2) / this.zoom + this.cy);
  }

  zoomAt(sx, sy, factor) {
    this.auto = false;
    const [wx, wy] = this.world(sx, sy);
    this.zoom *= factor;
    this.clamp();
    // Keep the point under the cursor where it is.
    const [nx, ny] = this.screen(wx, wy);
    this.cx += (nx - sx) / this.zoom;
    this.cy += (ny - sy) / this.zoom;
    this.clamp();
  }

  pan(dx, dy) {
    this.auto = false;
    this.cx -= dx / this.zoom;
    this.cy -= dy / this.zoom;
    this.clamp();
  }

  centerOn(x, y) {
    this.auto = false;
    if (this.zoom <= this.fitZoom) this.zoom = Math.max(this.fitZoom * 1.6, READABLE);
    [this.cx, this.cy] = toIso(x, y);
    this.clamp();
  }
}
