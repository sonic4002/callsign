// One agent: the operator (Anvil) or a squad leader. It sleeps until the net calls it or
// something happens to its squad, then thinks once and acts through the game tools.

import { Link } from "./link.mjs";
import { leaderPrompt, operatorPrompt } from "./prompts.mjs";
import { leaderTools, normalize, operatorTools } from "./tools.mjs";

const leaderEvents = new Set(["contact", "pinned", "losses", "arrived"]);
const operatorEvents = new Set(["squad_lost", "point_lost", "hq_under_attack"]);
const standBy = { en: "Stand by", he: "המתן" };

export class Agent {
  constructor({ server, side, role, squad = 0, brain, log = console.log, standByMs = 2500, wakesPerConversation = 15 }) {
    Object.assign(this, { server, side, role, squad, brain, log, standByMs, wakesPerConversation });
    this.inbox = [];
    this.traffic = []; // the last few transmissions on the net, ours included
    this.history = [];
    this.wakes = 0;
    this.busy = false;
    this.stopped = false;
    this.over = false;
    this.lang = "en";
    this.tier = 1;
  }

  async start() {
    const query = new URLSearchParams({ side: this.side, role: this.role, state: "0" });
    if (this.squad) query.set("squad", this.squad);
    this.link = new Link(
      `${this.server}?${query}`,
      (frame) => this.#onFrame(frame),
      () => {
        this.stopped = true;
        this.onStop?.();
      },
    );
    await this.link.open();
    return this;
  }

  stop() {
    this.stopped = true;
    this.link?.close();
  }

  get name() {
    return this.me?.en ?? this.role;
  }

  // The server greets on join and again when the match restarts.
  #greet(hello) {
    this.rules = hello.rules;
    this.me = hello.station;
    this.faction = hello.faction;
    this.inbox = [];
    this.history = [];
    this.wakes = 0;
    this.over = hello.state.over;
    this.traffic = hello.log.slice(-8).map((m) => m.text);
    if (this.role === "squad") {
      const mine = hello.state.squads.find((s) => s.id === this.squad);
      this.tier = mine.tier;
      this.unit = this.rules.factions[this.faction].units[mine.unit];
      this.system = leaderPrompt({ rules: this.rules, side: this.side, faction: this.faction, station: this.me, unit: this.unit });
      this.tools = leaderTools;
    } else {
      this.system = operatorPrompt({ rules: this.rules, side: this.side, faction: this.faction });
      this.tools = operatorTools;
    }
  }

  #onFrame(frame) {
    if (frame.type === "hello") return this.#greet(frame);
    if (frame.type === "radio") {
      const m = frame.message;
      this.traffic.push(m.text);
      if (this.traffic.length > 8) this.traffic.shift();
      if (m.from.key === this.me.key) return;
      const forMe = m.to.some((t) => t.key === this.me.key || t.key === "all");
      // "Out" means no reply is expected, so it wakes nobody; it stays in the traffic the
      // next wake shows. Hammer is the exception: a commander may end an order with Out.
      if (forMe && (m.end !== "out" || m.from.key === "player")) this.#enqueue({ kind: "radio", msg: m });
      return;
    }
    if (frame.type === "event") {
      const e = frame.event;
      if (e.kind === "match_end") {
        this.over = true;
        this.inbox = [];
        return;
      }
      const wanted = this.role === "squad" ? leaderEvents.has(e.kind) && e.squad === this.squad : operatorEvents.has(e.kind);
      if (wanted) this.#enqueue({ kind: "event", event: e, callsign: frame.callsign });
    }
  }

  #enqueue(item) {
    this.inbox.push(item);
    this.#pump();
  }

  // One wake at a time. Whatever arrives while thinking is handled together in the next one.
  async #pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.inbox.length && !this.over && !this.stopped) {
        await this.#wake(this.inbox.splice(0));
      }
    } finally {
      this.busy = false;
      this.onIdle?.();
    }
  }

  async #wake(items) {
    let status = null;
    try {
      status = await this.link.tool("report");
    } catch {
      // The squad may be gone or the match over; the wake still says what happened.
    }
    if (status?.you && status.you.tier !== this.tier) {
      // An upgrade changes the model. A new brain starts a fresh conversation.
      this.tier = status.you.tier;
      this.history = [];
    }
    const call = items.findLast((i) => i.kind === "radio")?.msg ?? null;
    if (call) {
      this.lang = call.lang;
      this.commander = call.from.en;
    }
    this.history.push({ role: "user", content: renderWake(items, compactStatus(status, this.side), this.traffic) });

    let answered = false;
    const timer =
      call && this.brain.slow
        ? setTimeout(() => {
            // Thinking takes a moment; say so, the way a real operator would.
            if (!answered) this.link.tool("radio", { to: [call.from.en], body: standBy[call.lang] ?? standBy.en, end: "out" }).catch(() => {});
          }, this.standByMs)
        : null;

    let finished = false;
    try {
      for (let turn = 0; turn < 6 && !finished; turn++) {
        const res = await this.brain.think({
          agent: { role: this.role, side: this.side, squad: this.squad, tier: this.tier, station: this.me, lang: this.lang, commander: this.commander },
          system: this.system,
          tools: this.tools,
          messages: this.history,
          wake: { items, status, call },
          rules: this.rules,
        });
        this.history.push({ role: "assistant", content: res.content });
        if (res.usage) this.log(`${this.name}: ${res.model} in=${res.usage.input_tokens} out=${res.usage.output_tokens}`);
        if (res.stop_reason === "refusal") {
          this.log(`${this.name}: the model declined this wake (${res.stop_details?.category ?? "no category"})`);
          break;
        }
        const calls = res.content.filter((b) => b.type === "tool_use");
        if (calls.length === 0) {
          finished = true;
          break;
        }
        const results = [];
        for (const c of calls) {
          if (c.name === "radio") answered = true;
          try {
            const data = await this.link.tool(c.name, normalize(c.name, c.input));
            this.log(`${this.name}: ${c.name} ${JSON.stringify(c.input)}`);
            results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(data ?? {}) });
          } catch (err) {
            this.log(`${this.name}: ${c.name} ${JSON.stringify(c.input)} refused: ${err.message}`);
            results.push({ type: "tool_result", tool_use_id: c.id, content: err.message, is_error: true });
          }
        }
        this.history.push({ role: "user", content: results });
      }
    } catch (err) {
      this.log(`${this.name}: thinking failed: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }
    // A conversation that did not end cleanly, or has grown long, is dropped whole. The
    // next wake starts fresh: the status and the net traffic carry what matters.
    if (!finished || ++this.wakes >= this.wakesPerConversation) {
      this.history = [];
      this.wakes = 0;
    }
  }
}

const owner = (o, side) => (o === side ? "yours" : o === -1 ? "neutral" : "enemy");

// compactStatus trims the server's report to what a decision needs.
export function compactStatus(status, side) {
  if (!status) return null;
  const points = Object.fromEntries(status.points.map((p) => [p.id, owner(p.owner, side)]));
  const contacts = status.contacts.map((c) => ({ id: c.id, unit: c.unit, class: c.class, near: c.near, x: c.x, y: c.y, teams: c.teams.length }));
  const squad = (s) => ({
    near: s.near,
    x: s.x,
    y: s.y,
    order: s.order,
    strength: `${s.alive}/${s.full}`,
    tier: s.tier,
    teams: (s.teams ?? []).map((t) => `${t.nerve}, ${t.action}`),
    contacts: s.contacts,
  });
  if (status.you) {
    return { secondsLeft: status.timeLeft, you: squad(status.you), friends: status.friends, contacts, points };
  }
  return {
    secondsLeft: status.timeLeft,
    gold: status.gold,
    goldPerSecond: status.income,
    hqHealth: status.hq,
    squads: status.squads.map((s) => ({ callsign: s.callsign.en, unit: s.unit, class: s.class, ...squad(s) })),
    contacts,
    points,
  };
}

function describe(item) {
  if (item.kind === "radio") {
    const m = item.msg;
    const lang = m.lang === "he" ? "Hebrew" : "English";
    const named = m.points?.length ? ` Points named: ${m.points.join(", ")}.` : "";
    return `Radio call for you from ${m.from.en}, in ${lang}: "${m.text}"${named}`;
  }
  const e = item.event;
  const who = item.callsign?.en ?? "A squad";
  switch (e.kind) {
    case "contact":
      return `Your squad made contact: enemy squad Target ${e.contact} near ${e.point}.`;
    case "pinned":
      return `Your squad is pinned near ${e.point}.`;
    case "losses":
      return `Your squad lost a fireteam near ${e.point}; ${e.count} fireteams left.`;
    case "arrived":
      return `Your squad arrived at ${e.point}.`;
    case "squad_lost":
      return `${who} was destroyed near ${e.point}.`;
    case "point_lost":
      return `The enemy took ${e.point}.`;
    case "hq_under_attack":
      return "Your headquarters is under attack.";
  }
  return `Event: ${e.kind}.`;
}

export function renderWake(items, status, traffic) {
  const lines = items.map(describe);
  if (status) lines.push("", `Status: ${JSON.stringify(status)}`);
  if (traffic.length) lines.push("", "Net traffic, most recent last:", ...traffic.map((t) => `  ${t}`));
  return lines.join("\n");
}
