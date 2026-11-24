// What an agent says about itself, for its own commander's "AI" view: which model thinks
// for it, how big its context is, and what it is doing right now. It never carries the
// prompt, the model's reasoning or any key.
//
// The agent reports over the connection it already has to the game server
// ({ type: "telemetry", telemetry }); the server keeps the latest report per station and
// passes it to that side's commander only. Nothing in the game reads it.
//
// This file runs unchanged in Node and in a Web Worker.

// Context windows of the models this game's own brains use, in tokens. A response that
// names its window (Claude Code's result does) wins over this table, and a model that is
// in neither shows as "window unknown".
// Source: Anthropic's Claude API model reference (models overview table), read
// 2026-11-24: Haiku 5.5, Sonnet 5.5 and Opus 5.5 each list a 1M context window. The
// Haiku figure was also seen in a live Claude Code result (`modelUsage.contextWindow`).
export const WINDOWS = {
  "claude-haiku-5-5": 1_000_000,
  "claude-sonnet-5-5": 1_000_000,
  "claude-opus-5-5": 1_000_000,
};

// windowOf is the context window of a model: what the response said, else the table, else
// null for unknown. OpenRouter writes Anthropic's ids with a vendor prefix and dots.
export function windowOf(model, given) {
  if (Number.isFinite(given) && given > 0) return given;
  if (!model) return null;
  const plain = String(model).replace(/^anthropic\//, "").replace(/(\d)\.(\d)/g, "$1-$2");
  return WINDOWS[plain] ?? null;
}

const num = (v) => (Number.isFinite(v) ? v : null);

// contextOf reads a response's usage: the size of the request that produced it (everything
// the model read, cached or not), how much of that came from the cache, and what it wrote.
// A result made of several requests (Claude Code lists them as `iterations`) is sized by
// its last one, which is the context as it stood. Unknown stays null, never zero.
export function contextOf(usage) {
  if (!usage || typeof usage !== "object") return { input: null, cached: null, output: null };
  const last = Array.isArray(usage.iterations) && usage.iterations.length ? usage.iterations.at(-1) : usage;
  const fresh = num(last.input_tokens);
  const read = num(last.cache_read_input_tokens);
  const written = num(last.cache_creation_input_tokens);
  const input = fresh === null ? null : fresh + (read ?? 0) + (written ?? 0);
  return { input, cached: fresh === null ? null : read, output: num(usage.output_tokens) };
}

// What woke the agent, in a few words the page can translate.
export function wokeBy(items) {
  const call = items.findLast((i) => i.kind === "radio");
  if (call) return { kind: "call", from: call.msg.from.en, fromHe: call.msg.from.he };
  const event = items.findLast((i) => i.kind === "event");
  if (event) return { kind: "event", event: event.event.kind };
  const heard = items.findLast((i) => i.kind === "heard");
  if (heard) return { kind: "heard", from: heard.msg.from.en, fromHe: heard.msg.from.he };
  return null;
}

// plain puts one tool call in a few words: "hold F", "radio Hammer: Wilco", "buy tank".
export function plain(name, input = {}) {
  const v = (x) => (x === undefined || x === null || x === "" || x === 0 ? "" : String(x));
  switch (name) {
    case "radio":
      return `radio ${[].concat(input.to ?? []).join(", ")}: ${v(input.body)}`.slice(0, 120);
    case "attack":
      return `attack ${v(input.contact) ? `Target ${input.contact}` : v(input.point)}`.trim();
    case "buy":
      return v(input.upgrade) ? `upgrade ${input.upgrade}` : `buy ${v(input.unit)}`;
    case "command":
      return `command ${[v(input.mode), input.buy === true ? "may buy" : input.buy === false ? "no buying" : ""].filter(Boolean).join(", ")}`;
    case "report":
      return "report";
  }
  const where = v(input.place) || v(input.point) || v(input.structure) || v(input.field) || v(input.unit);
  return `${name} ${where}`.trim().slice(0, 120);
}

// troubleCode names why a wake was skipped. The relay brain says so itself; the others
// are read from what they wrote.
export function troubleCode(err) {
  if (typeof err?.code === "string" && err.code) return err.code;
  const text = String(err?.message ?? "").toLowerCase();
  if (/rate.?limit|usage limit|limit reached|overloaded|429/.test(text)) return "rate_limited";
  if (/rejected|unauthori[sz]ed|invalid.*(key|token)|401/.test(text)) return "bad_key";
  if (/did not answer|timed? ?out/.test(text)) return "timeout";
  if (/not found/.test(text)) return "unreachable";
  return "failed";
}

export class Telemetry {
  // send(report) delivers one report. `gapMs` is the least time between two of them: a
  // change of state within it is sent as soon as the gap has passed, so the commander
  // sees what the agent is doing within a moment and the server is never flooded.
  constructor({ send, role, squad = 0, brain = "", where = "", limit = 15, now = Date.now, gapMs = 150, later = setTimeout, cancel = clearTimeout }) {
    Object.assign(this, { send, now, gapMs, later, cancel });
    this.sent = -Infinity;
    this.timer = null;
    this.seq = 0;
    this.r = {
      v: 1, role, squad, tier: 1, brain, where,
      model: null, planned: null,
      state: "idle", since: now(), woke: null, tool: null, standBy: false, reason: null,
      context: { input: null, cached: null, window: null }, output: null,
      talk: { messages: 0, wakes: 0, limit, resetAt: null, resetWhy: null },
      totals: { thoughts: 0, input: 0, output: 0, cached: 0, ms: 0, lastMs: null },
      actions: [], said: null,
    };
  }

  // report is a copy of what would be sent now.
  get report() {
    // `at` is this agent's clock when the report was made: with `since` and `resetAt` it
    // gives durations that do not depend on the reader's clock agreeing with ours.
    return structuredClone({ ...this.r, seq: this.seq, at: this.now() });
  }

  // Only a change of state is sent. The numbers in between (a thought's tokens, an action
  // done, the conversation's length) ride on the change that always follows them, so the
  // state a commander sees is never pushed aside by a report about a detail.
  #changed() {
    const wait = Math.max(0, this.sent + this.gapMs - this.now());
    if (wait === 0 && this.timer === null) return this.#flush();
    if (this.timer === null) this.timer = this.later(() => this.#flush(), wait);
  }

  #flush() {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    this.sent = this.now();
    this.seq += 1;
    try {
      this.send(this.report);
    } catch {
      // The connection is gone; the next change tries again.
    }
  }

  #state(state, extra = {}) {
    Object.assign(this.r, { tool: null, reason: null }, extra, { state, since: this.now() });
    this.#changed();
  }

  // The agent joined a match (or the match restarted): a clean slate.
  joined({ tier = 1, planned = null } = {}) {
    const { role, squad, brain, where, talk } = this.r;
    const fresh = new Telemetry({ send: () => {}, role, squad, brain, where, limit: talk.limit, now: this.now }).r;
    this.r = { ...fresh, tier, planned, talk: { ...fresh.talk, resetAt: this.now(), resetWhy: "match" } };
    this.#changed();
  }

  // A brain upgrade: the model planned for the next thought changes with it.
  tier(tier, planned = null) {
    Object.assign(this.r, { tier, planned });
    this.#changed();
  }

  conversation(messages, wakes) {
    Object.assign(this.r.talk, { messages, wakes });
  }

  // The conversation was dropped and the next wake starts fresh. why: "wakes" (it had
  // reached its limit), "tier" (a new brain), "unfinished" (a thought did not end cleanly).
  reset(why) {
    Object.assign(this.r.talk, { messages: 0, wakes: 0, resetAt: this.now(), resetWhy: why });
  }

  thinking(items) {
    this.#state("thinking", { woke: items ? wokeBy(items) : this.r.woke, standBy: items ? false : this.r.standBy });
  }

  saidStandBy() {
    this.r.standBy = true;
    this.#changed();
  }

  // One answer came back from the brain. `window` is the context window when the brain
  // was told it; `ms` is how long the thought took.
  thought({ usage, model, window } = {}, ms = null) {
    const c = contextOf(usage);
    const t = this.r.totals;
    if (usage || model) {
      t.thoughts += 1;
      t.input += c.input ?? 0;
      t.cached += c.cached ?? 0;
      t.output += c.output ?? 0;
      if (ms !== null) {
        t.ms += ms;
        t.lastMs = ms;
      }
      this.r.model = model ?? this.r.model;
      this.r.context = { input: c.input, cached: c.cached, window: windowOf(model ?? this.r.model, window) };
      this.r.output = c.output;
    }
  }

  acting(tool) {
    this.#state("acting", { tool });
  }

  // A tool call ran, or was refused by the game.
  acted(tool, input, ok) {
    this.r.actions = [...this.r.actions, { tool, text: plain(tool, input), ok }].slice(-5);
    if (tool === "radio" && ok) this.r.said = String(input?.body ?? "").slice(0, 160);
  }

  idle() {
    this.#state("idle", { woke: null, standBy: false });
  }

  // A wake could not be thought and was skipped; the squad keeps its last order.
  skipped(code, message = "") {
    this.#state("skipped", { reason: { code, text: String(message).slice(0, 160) }, standBy: false });
  }

  // The agent is leaving the net. Sent at once: there may be no later.
  stopped(code = "stopped") {
    Object.assign(this.r, { state: "stopped", since: this.now(), tool: null, reason: { code, text: "" }, standBy: false });
    this.#flush();
  }
}
