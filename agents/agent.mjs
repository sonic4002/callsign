// One agent: the operator (Anvil) or a squad leader. It sleeps until the net calls it or
// something happens to its squad, then thinks once and acts through the game tools.
//
// This file and what it imports run unchanged in Node and in a Web Worker in the player's
// browser: nothing here may use a Node-only module.

import { Link } from "./link.mjs";
import { leaderPrompt, operatorPrompt } from "./prompts.mjs";
import { leaderToolsFor, normalize, operatorTools } from "./tools.mjs";
import { compactStructures } from "./bases.mjs";

const leaderEvents = new Set(["contact", "pinned", "losses", "arrived", "garrisoned"]);
const operatorEvents = new Set(["squad_lost", "point_lost", "hq_under_attack", "structure_lost", "structure_captured", "structure_attacked", "structure_built", "hauler_attacked", "hauler_lost", "bridge_under_attack", "bridge_fell", "bridge_repaired", "building_fell"]);
const standBy = { en: "Stand by", he: "המתן" };

export class Agent {
  // `join` is added to the address the agent joins with: its host's id, and { room, key } or
  // { room, token } for a server that holds rooms.
  constructor({ server, side, role, squad = 0, brain, log = console.log, standByMs = 2500, wakesPerConversation = 15, join = {} }) {
    Object.assign(this, { server, side, role, squad, brain, log, standByMs, wakesPerConversation, join });
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
    const query = new URLSearchParams({ ...this.join, side: this.side, role: this.role, state: "0" });
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
    this.netLang = hello.log.findLast((m) => m.from.key === "player")?.lang; // a squad joining mid-match learns it too
    if (this.role === "squad") {
      const mine = hello.state.squads.find((s) => s.id === this.squad);
      this.tier = mine.tier;
      this.unit = this.rules.factions[this.faction].units[mine.unit];
      this.system = leaderPrompt({ rules: this.rules, side: this.side, faction: this.faction, station: this.me, unit: this.unit });
      this.tools = leaderToolsFor(this.unit);
    } else {
      this.system = operatorPrompt({ rules: this.rules, side: this.side, faction: this.faction });
      this.tools = operatorTools;
    }
    // A call made just before this station came on the net is answered now: a commander
    // who sits down and gives an order at once would otherwise be met with silence.
    const fresh = hello.state.tick - 15 * this.rules.tickRate;
    const spoke = hello.log.findLastIndex((m) => m.from.key === this.me.key);
    for (const m of hello.log.slice(spoke + 1)) {
      const forMe = m.to.some((t) => t.key === this.me.key || t.key === "all");
      if (m.tick >= fresh && forMe && m.from.key !== this.me.key && (m.end !== "out" || m.from.key === "player")) this.#enqueue({ kind: "radio", msg: m });
    }
  }

  #onFrame(frame) {
    if (frame.type === "hello") return this.#greet(frame);
    if (frame.type === "radio") {
      const m = frame.message;
      this.traffic.push(m.text);
      if (this.traffic.length > 8) this.traffic.shift();
      if (m.from.key === "player") this.netLang = m.lang; // the net follows the commander's language
      if (m.from.key === this.me.key) return;
      const forMe = m.to.some((t) => t.key === this.me.key || t.key === "all");
      // "Out" means no reply is expected, so it wakes nobody; it stays in the traffic the
      // next wake shows. Hammer is the exception: a commander may end an order with Out.
      if (forMe && (m.end !== "out" || m.from.key === "player")) this.#enqueue({ kind: "radio", msg: m });
      // The operator runs the fight, so every other transmission on the net wakes it too.
      else if (this.role === "anvil") this.#enqueue({ kind: "heard", msg: m });
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
      // An event about a landmark or a bridge carries its name, for whoever reads the wake.
      const named = e.place && [...(this.rules.map.landmarks ?? []), ...(this.rules.map.bridges ?? [])].find((p) => p.id === e.place);
      if (wanted) this.#enqueue({ kind: "event", event: e, callsign: frame.callsign, place: named ? `${named.name.en} (${e.place})` : e.place });
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
    if (call) this.commander = call.from.en;
    this.lang = this.netLang ?? call?.lang ?? this.lang;
    this.history.push({ role: "user", content: renderWake(items, compactStatus(status, this.side), this.traffic, this.lang) });

    let answered = false;
    const timer =
      call && this.brain.slow
        ? setTimeout(() => {
            // Thinking takes a moment; say so, the way a real operator would.
            if (!answered) this.link.tool("radio", { to: [call.from.en], body: standBy[this.lang] ?? standBy.en, end: "out" }).catch(() => {});
          }, this.standByMs)
        : null;

    let finished = false;
    try {
      for (let turn = 0; turn < 6 && !finished; turn++) {
        const res = await this.brain.think({
          agent: { role: this.role, side: this.side, squad: this.squad, tier: this.tier, station: this.me, lang: this.lang, commander: this.commander, unit: this.unit },
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
      // The wake is skipped. The squad keeps its last order and the fireteams keep fighting.
      this.log(`${this.name}: thinking failed: ${err.message}`);
      this.onTrouble?.(err);
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
    teams: (s.teams ?? []).map((t) => `${t.nerve}, ${t.action}${t.in ? `, inside ${t.in}` : t.cover ? ", in cover" : ""}`),
    contacts: s.contacts,
  });
  const structures = compactStructures(status, side);
  if (status.you) {
    const haulers = (status.haulers ?? []).map((h) => ({ id: h.id, state: h.state, field: h.field || undefined, x: h.x, y: h.y }));
    // The map itself is in the prompt. Here only what has changed on it: buildings that are
    // held, full, damaged or fallen, and bridges that are damaged or down.
    const ground = (status.landmarks ?? [])
      .filter((l) => l.garrison || l.kind === "rubble" || l.kind === "fallen bridge" || (l.kind === "bridge" && l.cover < 1))
      .map((l) =>
        l.kind === "bridge" || l.kind === "fallen bridge"
          ? { id: l.id, state: l.kind === "bridge" ? `standing, ${Math.round(l.cover * 100)}% strength` : "fallen" }
          : { id: l.id, state: l.kind === "rubble" ? "fallen, now rubble" : `held by ${owner(l.garrison.side, side) === "yours" ? "your side" : "the enemy"}, room for ${l.room ?? 0} more fireteams` },
      );
    return { secondsLeft: status.timeLeft, you: squad(status.you), friends: status.friends, haulers, contacts, points, structures, ...(ground.length ? { ground } : {}) };
  }
  return {
    secondsLeft: status.timeLeft,
    // Who has the initiative, and whether Hammer has just asked for a purchase.
    command: status.command,
    purchaseOrdered: status.purchaseOrdered,
    gold: status.gold,
    goldPerMinute: status.income,
    // Gold haulers work on their own; `field` is the gold field (by map point) each one works.
    haulers: (status.haulers ?? []).filter((h) => h.side === side).map((h) => ({ id: h.id, state: h.state, load: h.load, field: h.field || undefined, sentTo: h.assigned || undefined })),
    enemyHaulersSeen: (status.haulers ?? []).filter((h) => h.side !== side).map((h) => ({ contact: h.id, x: h.x, y: h.y, inSight: h.visible })),
    goldFields: (status.fields ?? []).map((f) => ({ field: f.gusher, full: f.gold, inSight: f.visible })),
    hqHealth: status.hq,
    squads: status.squads.map((s) => ({ callsign: s.callsign.en, unit: s.unit, class: s.class, ...squad(s) })),
    // Bought and on their way: they count toward the cap and cannot be ordered yet.
    deploying: (status.deploying ?? []).map((d) => ({ callsign: d.callsign.en, unit: d.unit, secondsLeft: Math.ceil(d.ticksLeft / 10) })),
    contacts,
    points,
    structures,
  };
}

function describe(item) {
  if (item.kind === "radio") {
    const m = item.msg;
    const lang = m.lang === "he" ? "Hebrew" : "English";
    const named = m.points?.length ? ` Points named: ${m.points.join(", ")}.` : "";
    const marks = m.landmarks?.length ? ` Landmarks its words fit: ${m.landmarks.join(", ")}.` : "";
    return `Radio call for you from ${m.from.en}, in ${lang}: "${m.text}"${named}${marks}`;
  }
  if (item.kind === "heard") {
    const m = item.msg;
    return `Heard on the net, ${m.from.en} to ${m.to.map((t) => t.en).join(", ")}: "${m.text}"`;
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
    case "structure_built":
      return `Your ${e.unit} (${e.structure}) near ${e.point} now stands.`;
    case "structure_attacked":
      return `Your ${e.unit} (${e.structure}) near ${e.point} is under attack.`;
    case "structure_lost":
      return e.owner === e.side ? `Your ${e.unit} (${e.structure}) near ${e.point} was destroyed; what it let you buy is gone until it is rebuilt.` : `The enemy's ${e.unit} (${e.structure}) near ${e.point} was destroyed.`;
    case "structure_captured":
      return e.owner === e.side ? `Your engineers took over the ${e.unit} (${e.structure}) near ${e.point}; you can now buy what it builds.` : `The enemy took over your ${e.unit} (${e.structure}) near ${e.point}.`;
    case "hauler_attacked":
      return `One of your gold haulers (id ${e.hauler}) is under attack near ${e.point}${e.field ? `, at the ${e.field} field` : ""}. It is running for home.`;
    case "hauler_lost":
      return `One of your gold haulers (id ${e.hauler}) was destroyed near ${e.point}${e.count ? ` with ${e.count} gold on board` : ""}.`;
    case "garrisoned":
      return `Your squad went inside ${item.place}.`;
    case "building_fell":
      return `${item.place} was brought down${e.count ? `; ${e.count} of your fireteams were inside and are out, shaken` : ""}.`;
    case "bridge_under_attack":
      return `${item.place} is under attack, and your side has troops on it, beside it or heading across.`;
    case "bridge_fell":
      return `${item.place} has fallen${e.count ? `; ${e.count} of your fireteams went down with it` : ""}.`;
    case "bridge_repaired":
      return `${item.place} stands again.`;
  }
  return `Event: ${e.kind}.`;
}

export function renderWake(items, status, traffic, lang) {
  const lines = items.map(describe);
  if (lang) lines.push(`The net language is ${lang === "he" ? "Hebrew" : "English"}: write every radio body in it, whatever language a call or the traffic below used.`);
  if (status) lines.push("", `Status: ${JSON.stringify(status)}`);
  if (traffic.length) lines.push("", "Net traffic, most recent last:", ...traffic.map((t) => `  ${t}`));
  return lines.join("\n");
}
