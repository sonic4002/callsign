// Fingers and mice on the map: one pointer pans, two pinch, and a press that never moved
// is a tap. The arithmetic is kept apart from the browser so it can be tested.

// Gesture follows the pointers that are down and says what each movement means.
export class Gesture {
  // slop is how far (CSS pixels) a pointer may wander and still be a tap.
  constructor({ slop = 6 } = {}) {
    this.slop = slop;
    this.pointers = new Map(); // id → { x, y, startX, startY }
    this.moved = false; // some pointer left its slop since the gesture began
    this.pinched = false; // a second pointer joined: this gesture can no longer be a tap
    this.grip = null; // centre and spread of the first two pointers, when two are down
  }

  get active() {
    return this.pointers.size > 0;
  }

  down(id, x, y) {
    this.pointers.set(id, { x, y, startX: x, startY: y });
    if (this.pointers.size >= 2) this.pinched = true;
    this.grip = this.#measure();
  }

  // move returns { pan: [dx, dy] } and, with two fingers down, { zoom: { factor, x, y } }
  // as well: the fingers' midpoint is where the zoom is anchored.
  move(id, x, y) {
    const p = this.pointers.get(id);
    if (!p) return {};
    if (this.pointers.size === 1) {
      if (!this.moved && Math.hypot(x - p.startX, y - p.startY) < this.slop) return {};
      const pan = [x - p.x, y - p.y];
      this.moved = true;
      p.x = x;
      p.y = y;
      return { pan };
    }
    p.x = x;
    p.y = y;
    this.moved = true;
    const before = this.grip;
    const now = (this.grip = this.#measure());
    if (!before || !now) return {};
    const out = { pan: [now.x - before.x, now.y - before.y] };
    if (before.spread > 8 && now.spread > 8) out.zoom = { factor: now.spread / before.spread, x: now.x, y: now.y };
    return out;
  }

  // up returns { tap: { x, y } } when the last pointer lifts from a press that was neither
  // a drag nor a pinch.
  up(id) {
    const p = this.pointers.get(id);
    if (!p) return {};
    this.pointers.delete(id);
    this.grip = this.#measure();
    if (this.pointers.size > 0) return {};
    const tap = !this.moved && !this.pinched ? { x: p.x, y: p.y } : null;
    this.moved = this.pinched = false;
    return tap ? { tap } : {};
  }

  cancel(id) {
    this.pointers.delete(id);
    this.grip = this.#measure();
    if (this.pointers.size === 0) this.moved = this.pinched = false;
  }

  #measure() {
    if (this.pointers.size < 2) return null;
    const [a, b] = [...this.pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, spread: Math.hypot(a.x - b.x, a.y - b.y) };
  }
}

// attachGestures wires an element's pointer events to a Gesture. The callbacks get client
// coordinates: onPan(dx, dy), onZoom(factor, clientX, clientY), onTap({ clientX, clientY }),
// onStart() when the first pointer goes down and onEnd() when the last one lifts.
export function attachGestures(el, { onPan, onZoom, onTap, onStart, onEnd }) {
  const g = new Gesture();
  el.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    if (!g.active) onStart?.();
    // A finger needs more room than a mouse before a press counts as a drag.
    g.slop = ev.pointerType === "mouse" ? 5 : 10;
    g.down(ev.pointerId, ev.clientX, ev.clientY);
    el.setPointerCapture?.(ev.pointerId);
  });
  el.addEventListener("pointermove", (ev) => {
    const { pan, zoom } = g.move(ev.pointerId, ev.clientX, ev.clientY);
    if (pan) onPan?.(pan[0], pan[1]);
    if (zoom) onZoom?.(zoom.factor, zoom.x, zoom.y);
  });
  el.addEventListener("pointerup", (ev) => {
    const { tap } = g.up(ev.pointerId);
    if (!g.active) onEnd?.();
    if (tap) onTap?.({ clientX: tap.x, clientY: tap.y });
  });
  el.addEventListener("pointercancel", (ev) => {
    g.cancel(ev.pointerId);
    if (!g.active) onEnd?.();
  });
  // Safari's own pinch would zoom the whole page, and a long press would open a menu.
  for (const kind of ["gesturestart", "gesturechange", "contextmenu"]) el.addEventListener(kind, (ev) => ev.preventDefault());
  return g;
}

// pixelRatio is how many canvas pixels to draw per CSS pixel. Phones report 3 and more,
// which is nine times the work for a picture the eye cannot tell from 2.
export function pixelRatio(win = globalThis) {
  return capRatio(win.devicePixelRatio, fingers(win));
}

export function capRatio(ratio, coarse) {
  return Math.max(1, Math.min(ratio || 1, coarse ? 2 : 3));
}

// How carefully pictures are scaled. The best filter costs a phone's processor about half
// of every frame (measured), for a difference a small screen does not show.
const coarse = globalThis.matchMedia?.("(pointer: coarse)");
export const smoothing = () => (coarse?.matches ? "low" : "high");

// Whether the main way in is a finger. Also used to keep the on-screen keyboard from
// opening every time the page writes into the radio box.
export const fingers = (win = globalThis) => Boolean(win.matchMedia?.("(pointer: coarse)").matches);
