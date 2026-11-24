// The order radio voices are played in. One voice at a time; a backlog is cut short
// instead of talking for a minute about a fight that has moved on.

export class Queue {
  constructor({ staleMs = 9000, max = 3, repeatMs = 6000 } = {}) {
    this.staleMs = staleMs;
    this.max = max;
    this.repeatMs = repeatMs;
    this.items = [];
    this.last = null; // the line handed out most recently
  }

  get size() {
    return this.items.length;
  }

  // push adds a line: { station, text, filler, at (ms it arrived), ... }. It returns false
  // when the line is not taken: the same station saying the same thing again right away.
  push(item) {
    const same = (other) => other && other.station === item.station && other.text === item.text && item.at - other.at < this.repeatMs;
    if (this.items.some(same) || same(this.last)) {
      item.cancel?.();
      return false;
    }
    // A station's "Stand by" is pointless once its real answer is waiting behind it.
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i].filler && this.items[i].station === item.station) this.#drop(i);
    }
    this.items.push(item);
    while (this.items.length > this.max) this.#drop(0);
    return true;
  }

  // next returns the line to play now, or null. Lines that waited too long are dropped,
  // except the newest: the last word on the net is always heard.
  next(now) {
    while (this.items.length > 1 && now - this.items[0].at > this.staleMs) this.#drop(0);
    const item = this.items.shift() ?? null;
    if (item) this.last = item;
    return item;
  }

  clear() {
    while (this.items.length) this.#drop(0);
  }

  #drop(i) {
    this.items.splice(i, 1)[0].cancel?.();
  }
}
