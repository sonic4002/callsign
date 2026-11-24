// Fog of war. The server says which ground this side has ever seen (a grid of cells);
// what is in sight right now follows from where our own teams and headquarters are.
// Never seen is black, seen before is dimmed, in sight is clear. The fog is painted on
// a small flat picture of the whole map, then laid over the isometric view and the radar.

import { smoothing } from "./touch.js";

const UNIT = 8; // map units per fog pixel
const PAD = 160; // the fog reaches this far past the map edge, in map units
const DIM = 0.5; // darkness left over ground seen before
const INK = "#04070a";

export class Fog {
  constructor(rules) {
    this.rules = rules;
    const { width, height } = rules.map;
    this.canvas = document.createElement("canvas");
    this.canvas.width = Math.ceil((width + 2 * PAD) / UNIT);
    this.canvas.height = Math.ceil((height + 2 * PAD) / UNIT);
    this.g = this.canvas.getContext("2d");
    this.cells = document.createElement("canvas"); // one pixel per fog cell, plus the pad
    this.key = null;
    this.on = false;
  }

  // explored redraws the cell picture when the server's grid changes.
  explored(fog) {
    if (fog.seen === this.key) return;
    this.key = fog.seen;
    const pad = Math.ceil(PAD / fog.cell);
    const w = fog.cols + 2 * pad;
    const h = fog.rows + 2 * pad;
    this.cells.width = w;
    this.cells.height = h;
    this.pad = pad;
    const bits = atob(fog.seen);
    const seen = (col, row) => {
      // Past the map edge the fog follows the nearest cell on the map.
      const i = Math.max(0, Math.min(fog.rows - 1, row)) * fog.cols + Math.max(0, Math.min(fog.cols - 1, col));
      return (bits.charCodeAt(i >> 3) >> (i & 7)) & 1;
    };
    const g = this.cells.getContext("2d");
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        img.data[(y * w + x) * 4 + 3] = seen(x - pad, y - pad) ? 255 : 0;
      }
    }
    g.putImageData(img, 0, 0);
  }

  // render paints this frame's fog. `eyes` are [x, y, sight] for everything of ours that sees.
  render(fog, eyes) {
    this.on = Boolean(fog);
    if (!fog) return;
    this.explored(fog);
    const { g, canvas } = this;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.fillStyle = INK;
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.globalCompositeOperation = "destination-out";
    // Ground seen before: scaled up smoothly, so the cells blur into soft edges.
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.globalAlpha = 1 - DIM;
    const k = fog.cell / UNIT;
    // Half a cell of offset puts each cell's pixel centre on the cell's centre.
    g.drawImage(this.cells, (PAD - this.pad * fog.cell) / UNIT, (PAD - this.pad * fog.cell) / UNIT, this.cells.width * k, this.cells.height * k);
    g.globalAlpha = 1;
    // Ground in sight now.
    for (const [x, y, sight] of eyes) {
      const cx = (x + PAD) / UNIT;
      const cy = (y + PAD) / UNIT;
      const r = (sight * 1.04) / UNIT;
      const light = g.createRadialGradient(cx, cy, r * 0.72, cx, cy, r);
      light.addColorStop(0, "rgba(0,0,0,1)");
      light.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = light;
      g.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    }
    g.globalCompositeOperation = "source-over";
  }

  // draw lays the fog over the isometric view. `ctx` is in CSS pixels.
  draw(ctx, cam) {
    if (!this.on) return;
    const z = cam.zoom;
    ctx.save();
    // World (x, y) → screen is ((x - y - cx) z + w/2, ((x + y)/2 - cy) z + h/2).
    ctx.transform(z, z / 2, -z, z / 2, cam.w / 2 - cam.cx * z, cam.h / 2 - cam.cy * z);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = smoothing();
    ctx.drawImage(this.canvas, -PAD, -PAD, this.canvas.width * UNIT, this.canvas.height * UNIT);
    ctx.restore();
  }

  // drawRadar lays the fog over the radar, where k is radar pixels per map unit.
  drawRadar(g, k) {
    if (!this.on) return;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.canvas, -PAD * k, -PAD * k, this.canvas.width * UNIT * k, this.canvas.height * UNIT * k);
  }
}
