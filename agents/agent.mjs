// One agent: the operator (Anvil) or a squad leader. It sleeps until the net calls it or
// something happens to its squad, then thinks once and acts through the game tools.
//
// This file and what it imports run unchanged in Node and in a Web Worker in the player's
// browser: nothing here may use a Node-only module.

import { Link } from "./link.mjs";
import { leaderPrompt, operatorPrompt } from "./prompts.mjs";
import { Telemetry, troubleCode } from "./telemetry.mjs";
import { leaderToolsFor, normalize, operatorTools } from "./tools.mjs";
import { compactStructures } from "./bases.mjs";
import { eventLine as powerEventLine } from "./power.mjs";
import { describeHeroEvent, heroLeaderEvents, heroOperatorEvents, unitAnywhere } from "./heroes.mjs";
import { describeStrikeEvent, strikeLeaderEvents } from "./aircraft.mjs";

const leaderEvents = new Set(["contact", "pinned", "losses", "arrived", "garrisoned", "salvo", ...heroLeaderEvents, ...strikeLeaderEvents]);
const operatorEvents = new Set(["squad_lost", "point_lost", "hq_under_attack", "structure_lost", "structure_captured", "structure_attacked", "structure_built", "hauler_attacked", "hauler_lost", "bridge_under_attack", "bridge_fell", "bridge_repaired", "building_fell", "low_power", "power_restored", "structure_repaired", "repair_stopped", ...heroOperatorEvents]);
const standBy = { en: "Stand by", he: "המתן" };

export class Agent {
  // `join` is added to the address the agent joins with: its host's id, and { room, key } or
  // { room, token } for a server that holds rooms.
  // `where` says where this agent runs, for its commander's view: "server" or "browser".
  constructor({ server, side, role, squad = 0, brain, log = console.log, standByMs = 12_000, wakesPerConversation = 15, quietMs = 30_000, gatherMs = 1500, join = {}, where = typeof WorkerGlobalScope === "undefined" ? "server" : "browser" }) {
    Object.assign(this, { server, side, role, squad, brain, log, standByMs, wakesPerConversation, quietMs, gatherMs, join });
    // What this agent tells its own commander about itself; see telemetry.mjs.
    this.tele = new Telemetry({ role, squad, brain: brain?.name ?? "", where, limit: wakesPerConversation, send: (report) => this.link.send({ type: "telemetry", telemetry: report }) });
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
        clearInterval(this.quiet);
        this.onStop?.();
      },
    );
    await this.link.open();
    // An operator that holds the initiative is not left asleep on a quiet map: see #lookUp.
    if (this.role === "anvil" && this.quietMs > 0) this.quiet = setInterval(() => this.#lookUp(), this.quietMs);
    this.quiet?.unref?.();
    return this;
  }

  // #lookUp wakes the operator when nothing has for a while and there is something only it
  // can do: it runs the fight and a squad has no orders, or it holds the purse and there
  // is gold for a squad. Events wake it otherwise, and on a big quiet map none may come
  // for minutes while gold piles up. An operator on Hammer's orders is never woken by this.
  async #lookUp() {
    if (this.busy || this.inbox.length || this.over || this.stopped || !this.rules || Date.now() - (this.wokeAt ?? 0) < this.quietMs) return;
    let status;
    try {
      status = await this.link.tool("report");
    } catch {
      return;
    }
    const units = Object.values(this.rules.factions[this.faction]?.units ?? {}).filter((u) => u.damage > 0);
    const cheapest = Math.min(...units.map((u) => u.cost));
    const idle = status.command?.mode === "fight" && (status.squads ?? []).some((sq) => sq.order?.kind === "none");
    const spend = status.command?.buy && status.gold >= cheapest && (status.squads ?? []).length + (status.deploying ?? []).length < this.rules.match.populationCap;
    if ((idle || spend) && !this.busy && !this.over && !this.stopped) this.#enqueue({ kind: "event", event: { kind: "quiet" } });
  }

  stop(why = "stopped") {
    if (!this.stopped) this.tele.stopped(why);
    this.stopped = true;
    clearInterval(this.quiet);
    clearTimeout(this.gathering);
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
    // A squad joining mid-match learns the net's language too: what Hammer last spoke, or
    // the language of the commander's page before a word was said.
    this.netLang = hello.log.findLast((m) => m.from.key === "player")?.lang ?? (["he", "en"].includes(hello.netlang) ? hello.netlang : undefined);
    // What the match's host chose for the brains that need no key: the operator's
    // initiative (1 to 3), and whether squads take orders through the fast decision model.
    this.level = hello.lobby?.anvil || undefined;
    if (this.role === "squad") {
      const mine = hello.state.squads.find((s) => s.id === this.squad);
      this.tier = mine.tier;
      // A squad its side's hero has seized is of the other army's design.
      const own = this.rules.factions[this.faction].units[mine.unit];
      this.unit = own ?? unitAnywhere(this.rules, mine.unit);
      this.system = leaderPrompt({ rules: this.rules, side: this.side, faction: this.faction, station: this.me, unit: this.unit, seized: !own });
      this.tools = leaderToolsFor(this.unit);
    } else {
      this.system = operatorPrompt({ rules: this.rules, side: this.side, faction: this.faction });
      this.tools = operatorTools;
    }
    this.tele.r.brain = this.#brainName();
    this.tele.joined({ tier: this.tier, planned: this.#planned() });
    // A call made just before this station came on the net is answered now: a commander
    // who sits down and gives an order at once would otherwise be met with silence.
    const fresh = hello.state.tick - 15 * this.rules.tickRate;
    const spoke = hello.log.findLastIndex((m) => m.from.key === this.me.key);
    for (const m of hello.log.slice(spoke + 1)) {
      if (m.tick >= fresh && m.from.key !== this.me.key && callsFor(m, this.me)) this.#enqueue({ kind: "radio", msg: m });
    }
  }

  // The model the brain means to use for the next thought, when it chooses one itself.
  #planned() {
    return this.brain?.plan?.({ role: this.role, tier: this.tier, level: this.level }) ?? null;
  }

  // Which brain thinks for this station: one brain may hand its squads to another by tier.
  #brainName() {
    return this.brain?.nameFor?.({ role: this.role, tier: this.tier }) ?? this.brain?.name ?? "";
  }

  #onFrame(frame) {
    if (frame.type === "hello") return this.#greet(frame);
    if (frame.type === "radio") {
      const m = frame.message;
      this.traffic.push(m.text);
      if (this.traffic.length > 8) this.traffic.shift();
      if (m.from.key === "player") this.netLang = m.lang; // the net follows the commander's language
      if (m.from.key === this.me.key) return;
      if (m.cue) return; // a base cue is the server's fixed line to the commander: it wakes nobody
      const mine = callsFor(m, this.me);
      if (this.role !== "anvil") {
        if (mine) this.#enqueue({ kind: "radio", msg: m });
        return;
      }
      // The operator runs the fight, so the net's traffic wakes it too, but only Hammer's
      // call is a call with a wake of its own. What squads report, to it or to anyone, is
      // read together in one wake; a bare Roger or Wilco (the net marks them) needs no
      // thought at all and stays in the traffic the next wake shows.
      if (m.kind === "ack") return;
      if (mine && m.from.key === "player") this.#enqueue({ kind: "radio", msg: m });
      else this.#enqueue({ kind: "heard", msg: m, ...(mine ? { forMe: true } : {}) });
      return;
    }
    if (frame.type === "netlang") {
      // The language of the commander's page: the net is in it before a word is said.
      if (frame.lang === "he" || frame.lang === "en") this.netLang = frame.lang;
      return;
    }
    if (frame.type === "direct") {
      // Hammer built, bought, cancelled, sold, repaired or set a rally point by hand, from
      // the panel. The operator keeps it in its picture of the net; it is not a call, and
      // nobody is woken for it.
      // A squad Hammer sent somewhere by hand has its order already and has answered
      // "Wilco" by the game's own code; its leader notes whose order it is on, unwoken.
      const mine = frame.act === "order" && this.role === "squad" && frame.result?.id === this.squad;
      if (mine) this.commander = "Hammer";
      if (frame.lang === "he" || frame.lang === "en") this.netLang = frame.lang; // the net follows the commander's language
      if (this.role === "anvil" || mine) {
        this.traffic.push(directLine(frame));
        if (this.traffic.length > 8) this.traffic.shift();
      }
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
      if (!wanted) return;
      // Another squad met the same enemy first and has it to report (the net marks the
      // event `known`). The fireteams fight on their own, so a leader whose thought costs
      // a model call is not woken for it; one that thinks for free still acts, in silence.
      if (frame.known && e.kind === "contact" && this.#costly()) return;
      this.#enqueue({ kind: "event", event: e, callsign: frame.callsign, place: named ? `${named.name.en} (${e.place})` : e.place, ...(frame.known ? { known: true } : {}) });
    }
  }

  // Whether a thought of this station's is a call to a model.
  #costly() {
    return Boolean(this.brain?.slowFor?.({ role: this.role, tier: this.tier }) ?? this.brain?.slow);
  }

  #enqueue(item) {
    this.inbox.push(item);
    // An operator that pays for its thoughts lets a burst of traffic land before it reads
    // it: eight squads reporting in two seconds are one wake, not eight. A call is never
    // kept waiting.
    if (item.kind !== "radio" && this.role === "anvil" && this.gatherMs > 0 && this.#costly()) {
      this.gathering ??= setTimeout(() => {
        this.gathering = null;
        this.#pump();
      }, this.gatherMs);
      this.gathering?.unref?.();
      return;
    }
    this.#pump();
  }

  // One wake at a time, and one call to a wake. News that arrives while thinking is handled
  // together in the next wake, up to and including the first call for this station; a
  // second call waits for a wake of its own, so each call is acted on and answered. Three
  // purchases asked for in a burst are three purchases.
  async #pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.inbox.length && !this.over && !this.stopped) {
        const call = this.inbox.findIndex((i) => i.kind === "radio");
        await this.#wake(this.inbox.splice(0, call < 0 ? this.inbox.length : call + 1));
      }
    } finally {
      this.busy = false;
      this.onIdle?.();
    }
  }

  async #wake(items) {
    this.wokeAt = Date.now();
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
      this.tele.reset("tier");
      this.tele.r.brain = this.#brainName();
      this.tele.tier(this.tier, this.#planned());
    }
    const call = items.findLast((i) => i.kind === "radio")?.msg ?? null;
    if (call) this.commander = call.from.en;
    this.lang = this.netLang ?? call?.lang ?? this.lang;
    this.history.push({ role: "user", content: renderWake(items, compactStatus(status, this.side), this.traffic, this.lang) });
    this.tele.conversation(this.history.length, this.wakes);
    this.tele.thinking(items);

    let answered = false;
    const timer =
      call && (this.brain.slowFor?.({ role: this.role, tier: this.tier }) ?? this.brain.slow)
        ? setTimeout(() => {
            // Only a long wait is worth a line on the net: the page already shows who is
            // thinking, and a "Stand by" before every answer just crowds the radio.
            if (answered) return;
            this.link.tool("radio", { to: [call.from.en], body: standBy[this.lang] ?? standBy.en, end: "out" }).catch(() => {});
            this.tele.saidStandBy();
          }, this.standByMs)
        : null;

    let finished = false;
    let trouble = null;
    try {
      for (let turn = 0; turn < 6 && !finished; turn++) {
        if (turn > 0) this.tele.thinking(null);
        const began = Date.now();
        const res = await this.brain.think({
          agent: { role: this.role, side: this.side, squad: this.squad, tier: this.tier, station: this.me, lang: this.lang, commander: this.commander, unit: this.unit, ...(this.role === "anvil" && this.level ? { level: this.level } : {}) },
          system: this.system,
          tools: this.tools,
          messages: this.history,
          wake: { items, status, call, traffic: this.traffic },
          rules: this.rules,
        });
        this.history.push({ role: "assistant", content: res.content });
        this.tele.thought(res, Date.now() - began);
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
          this.tele.acting(c.name);
          try {
            const data = await this.link.tool(c.name, normalize(c.name, c.input));
            this.tele.acted(c.name, c.input, true);
            this.log(`${this.name}: ${c.name} ${JSON.stringify(c.input)}`);
            results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(data ?? {}) });
          } catch (err) {
            this.tele.acted(c.name, c.input, false);
            this.log(`${this.name}: ${c.name} ${JSON.stringify(c.input)} refused: ${err.message}`);
            results.push({ type: "tool_result", tool_use_id: c.id, content: err.message, is_error: true });
          }
        }
        this.history.push({ role: "user", content: results });
      }
    } catch (err) {
      trouble = err;
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
      this.tele.reset(finished ? "wakes" : "unfinished");
    } else {
      this.tele.conversation(this.history.length, this.wakes);
    }
    if (trouble) this.tele.skipped(troubleCode(trouble), trouble.message);
    else this.tele.idle();
  }
}

const owner = (o, side) => (o === side ? "yours" : o === -1 ? "neutral" : "enemy");

// compactStatus trims the server's report to what a decision needs.
export function compactStatus(status, side) {
  if (!status) return null;
  const points = Object.fromEntries(status.points.map((p) => [p.id, owner(p.owner, side)]));
  const contacts = status.contacts.map((c) => ({ id: c.id, unit: c.unit, class: c.class, near: c.near, x: c.x, y: c.y, teams: c.teams.length, ...(c.hero ? { hero: true } : {}) }));
  const squad = (s) => ({
    near: s.near,
    x: s.x,
    y: s.y,
    order: s.order,
    strength: `${s.alive}/${s.full}`,
    tier: s.tier,
    ...(s.rank ? { rank: s.rank } : {}),
    ...(s.hero ? { hero: { chargesLeft: s.hero.charges || undefined, health: s.hero.hp, holdsSquad: s.hero.seized || undefined } } : {}),
    ...(s.dug ? { positionsBuilt: s.dug } : {}),
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
    // Squads Hammer ordered by name: Hammer's until the operator is handed the fight again.
    ...(status.hammerOrdered?.length ? { hammerOrdered: status.hammerOrdered } : {}),
    gold: status.gold,
    ...(status.taken ? { taken: status.taken } : {}),
    goldPerMinute: status.income,
    // Gold haulers work on their own; `field` is the gold field (by map point) each one works.
    haulers: (status.haulers ?? []).filter((h) => h.side === side).map((h) => ({ id: h.id, state: h.state, load: h.load, field: h.field || undefined, sentTo: h.assigned || undefined })),
    enemyHaulersSeen: (status.haulers ?? []).filter((h) => h.side !== side).map((h) => ({ contact: h.id, x: h.x, y: h.y, inSight: h.visible })),
    goldFields: (status.fields ?? []).map((f) => ({ field: f.gusher, full: f.gold, inSight: f.visible })),
    hqHealth: status.hq,
    // What the structures supply and use; low power slows building and silences defences.
    power: status.power,
    radar: status.radar,
    // The role a base usually builds next, "" once the opening is complete.
    opening: status.opening ?? "",
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
    return item.forMe ? `Report to you from ${m.from.en}: "${m.text}"` : `Heard on the net, ${m.from.en} to ${m.to.map((t) => t.en).join(", ")}: "${m.text}"`;
  }
  const e = item.event;
  const who = item.callsign?.en ?? "A squad";
  const heroic = describeHeroEvent(e, who) ?? describeStrikeEvent(e, who);
  if (heroic) return heroic;
  return eventLine(item, e, who) + (item.known ? " Another squad has already reported this on the net: act if you need to, and do not report it again." : "");
}

function eventLine(item, e, who) {
  switch (e.kind) {
    case "quiet":
      return "Nothing has woken you for a while and you hold the initiative: your status shows a squad without orders or gold you could spend. Act if it helps; otherwise do nothing.";
    case "contact":
      return `Your squad made contact: enemy squad Target ${e.contact} near ${e.point}.`;
    case "pinned":
      return `Your squad is pinned near ${e.point}.`;
    case "losses":
      return `Your squad lost a fireteam near ${e.point}; ${e.count} fireteams left.`;
    case "arrived":
      return `Your squad arrived at ${item.place ?? (e.structure ? `the ${e.unit} (${e.structure}) near ${e.point}` : e.point)}.`;
    case "salvo":
      return `Your squad fired its missile salvo, ${e.count} missiles, over ${e.place || e.point}. The pods are empty until they are loaded again; you hold where you fired.`;
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
  return powerEventLine(e) || `Event: ${e.kind}.`;
}

// directLine says, for the operator's picture of the net, what Hammer did by hand.
export function directLine(frame) {
  const r = frame.result ?? {};
  const what = {
    build: `started a ${r.name ?? "structure"}${r.near ? ` near ${r.near}` : ""}`,
    buy: `bought ${r.unit ?? "a unit"}${r.squad?.en ? ` (${r.squad.en})` : ""}`,
    cancel: `cancelled ${r.unit ?? "a unit"} in its line`,
    sell: `sold the ${r.name ?? "structure"}`,
    repair: `began repairing the ${r.name ?? "structure"}`,
    rally: "set a rally point",
    order: `ordered ${r.squad?.en ?? "a squad"} to ${r.order?.order ?? "move"}${r.order?.place || r.order?.point ? ` at ${r.order.place || r.order.point}` : r.order?.contact ? ` contact ${r.order.contact}` : ""}; it is on Hammer's order and has acknowledged`,
  }[frame.act];
  return `(no call) Hammer, by hand, ${what ?? frame.act}.`;
}

// callsFor reports whether a transmission is a call this station must act on. "Out" means
// no reply is expected, so an Out from a squad wakes nobody; it stays in the traffic the
// next wake shows. Those who give orders are the exception: Hammer and the operator may
// end an order with Out, and it is still an order.
export function callsFor(m, me) {
  if (m.cue) return false;
  const forMe = m.to.some((t) => t.key === me.key || t.key === "all");
  const commander = m.from.key === "player" || m.from.key === "operator";
  return forMe && m.from.key !== me.key && (m.end !== "out" || commander);
}

export function renderWake(items, status, traffic, lang) {
  const lines = items.map(describe);
  if (lang) lines.push(`The net language is ${lang === "he" ? "Hebrew" : "English"}: write every radio body in it, whatever language a call or the traffic below used.`);
  if (status) lines.push("", `Status: ${JSON.stringify(status)}`);
  if (traffic.length) lines.push("", "Net traffic, most recent last:", ...traffic.map((t) => `  ${t}`));
  return lines.join("\n");
}
