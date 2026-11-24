// The order radio voices are played in. One voice at a time; a backlog is cut short
// instead of talking for a minute about a fight that has moved on.

export class Queue {
  constructor({ staleMs = 9000, directStaleMs = 25000, max = 3, repeatMs = 6000 } = {}) {
    this.staleMs = staleMs;
    this.directStaleMs = directStaleMs; // lines addressed to the player wait much longer

    this.max = max;
    this.repeatMs = repeatMs;
    this.items = [];
    this.last = null; // the line handed out most recently
  }

  get size() {
    return this.items.length;
  }

  // push adds a line: { station, text, filler, direct, at (ms it arrived), ... }. `direct`
  // marks a line addressed to the player; chatter between stations never pushes one out. It returns false
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
    while (this.items.length > this.max) {
      const chatter = this.items.findIndex((it) => !it.direct);
      if (chatter < 0 && this.items.length <= this.max * 2) break; // answers to the player pile up a little
      this.#drop(Math.max(chatter, 0));
    }
    return true;
  }

  // next returns the line to play now, or null. Lines that waited too long are dropped,
  // except the newest: the last word on the net is always heard.
  next(now) {
    for (let i = 0; i < this.items.length - 1; ) {
      const it = this.items[i];
      if (now - it.at > (it.direct ? this.directStaleMs : this.staleMs)) this.#drop(i);
      else i++;
    }
    // What was said to the player is heard before talk between stations.
    const first = Math.max(this.items.findIndex((it) => it.direct), 0);
    const item = this.items.splice(first, 1)[0] ?? null;
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
