// The small decisions of running agents in the page, kept free of the DOM so they can be
// tested: who should be thinking for this side, and what a match has cost so far.

// How long the page may stay hidden before its agents stand down. Phones freeze a hidden
// page; squads keep their last orders, and the server's own agents (if any) take over.
export const HIDDEN_LIMIT_MS = 30_000;

// wanted says which brain this browser should run, or null to leave the side to whoever
// the server has: "relay" when the relay holds a key for this seat, "scripted" when the
// player chose the demo brain. A page hidden for long runs nothing.
export function wanted({ canAct, demo, key, hiddenLong }) {
  if (!canAct || hiddenLong) return null;
  if (demo) return "scripted";
  return key?.set ? "relay" : null;
}

// Usage adds up what the relay reports for each thought of the current match.
export class Usage {
  constructor() {
    this.reset(null);
  }

  reset(match) {
    Object.assign(this, { match, calls: 0, input: 0, output: 0, models: new Set() });
  }

  add(usage, model) {
    this.calls += 1;
    this.input += usage?.input_tokens ?? 0;
    this.output += usage?.output_tokens ?? 0;
    if (model) this.models.add(model);
  }
}

// Throttle lets one message of a kind through per window, so a relay that is down does
// not fill the radio log with the same line for every wake.
export class Throttle {
  constructor(windowMs = 20_000, now = () => performance.now()) {
    Object.assign(this, { windowMs, now, last: new Map() });
  }

  pass(kind) {
    const t = this.now();
    if (t - (this.last.get(kind) ?? -Infinity) < this.windowMs) return false;
    this.last.set(kind, t);
    return true;
  }
}
