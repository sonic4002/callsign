// The live view of the player's own AI agents: Anvil and every squad leader, each with the
// model that thinks for it, the size of its context and what it is doing right now.
//
// The agents report this themselves (agents/telemetry.mjs) and the game server passes it
// to their own commander only. This file keeps the latest report per station and draws
// it; the first half is free of the DOM so it can be tested.

// ---- what the page knows ----

// Agents keeps the latest report per station (squad id; 0 is the operator).
export class Agents {
  constructor(now = () => performance.now()) {
    this.now = now;
    this.byStation = new Map();
    this.ended = false;
  }

  // hello takes the list a greeting carries: a clean slate for a new match or a new seat.
  hello(agents = []) {
    this.byStation.clear();
    this.ended = false;
    for (const agent of agents) this.#take(agent);
  }

  // frame takes one telemetry frame and returns the station it was about, or null when
  // it was about all of them.
  frame(frame) {
    if (frame.ended) {
      // The match is over: the server keeps nothing, and the rows here stand as they were.
      this.ended = true;
      return null;
    }
    const agent = frame.agent;
    if (!agent || !Number.isInteger(agent.squad)) return null;
    if (agent.gone) {
      this.byStation.delete(agent.squad);
      return agent.squad;
    }
    this.#take(agent);
    return agent.squad;
  }

  #take(agent) {
    const report = agent.telemetry && typeof agent.telemetry === "object" ? agent.telemetry : null;
    this.byStation.set(agent.squad, { station: agent.station ?? null, online: agent.online !== false, report, got: this.now() });
  }

  get(squad) {
    return this.byStation.get(squad) ?? null;
  }

  // thinking lists the squads whose leader is thinking right now.
  thinking() {
    const out = new Set();
    for (const [squad, a] of this.byStation) if (a.online && !this.ended && a.report?.state === "thinking") out.add(squad);
    return out;
  }
}

// ---- numbers as people read them ----

const int = (n) => Math.round(n).toLocaleString("en");

// tokens writes a token count: exact below ten thousand, then rounded. Unknown is a dash.
export function tokens(n) {
  if (!Number.isFinite(n)) return "–";
  if (n < 10_000) return int(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`;
}

// span writes a length of time: "0.8 s", "12 s", "3 min 05 s". `units` names the second
// and the minute in the reader's language.
export function span(ms, units = { s: "s", min: "min" }) {
  if (!Number.isFinite(ms) || ms < 0) return "–";
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)} ${units.s}`;
  if (s < 60) return `${Math.round(s)} ${units.s}`;
  return `${Math.floor(s / 60)} ${units.min} ${String(Math.floor(s % 60)).padStart(2, "0")} ${units.s}`;
}

// share writes a part of a whole as a percentage that never rounds a little to nothing.
export function share(part) {
  if (!Number.isFinite(part)) return "–";
  const pct = part * 100;
  if (pct === 0) return "0%";
  if (pct < 0.1) return "<0.1%";
  return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
}

// shortModel is a model id as a name: "claude-haiku-5-5" and "anthropic/claude-haiku-5.5"
// are both "Haiku 5.5". An id it does not know is shown as it is.
export function shortModel(id) {
  if (!id) return "";
  const m = /^(?:anthropic\/)?claude-([a-z]+)-(\d+)(?:[-.](\d+))?(?:-\d{8})?$/.exec(id);
  if (!m) return String(id).replace(/^[a-z-]+\//, "");
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

// barWidth is how wide to draw the context bar, 0 to 1: true to scale, except that a
// context that exists is never drawn thinner than a sliver. null when either is unknown.
export function barWidth(input, window, sliver = 0.02) {
  if (!Number.isFinite(input) || !Number.isFinite(window) || window <= 0) return null;
  if (input <= 0) return 0;
  return Math.min(1, Math.max(sliver, input / window));
}

// ---- one row, as plain data ----

const known = new Set(["idle", "thinking", "acting", "skipped", "stopped"]);
const brains = new Set(["subscription", "claude", "relay", "scripted"]);

// rowOf turns what is known about a station into what its row shows. `agent` is the
// Agents entry (or null for a station with no report yet), `now` the page's clock in the
// same units as `agent.got`, `ended` whether the match is over.
export function rowOf(squad, agent, { now = 0, ended = false } = {}) {
  const r = agent?.report ?? null;
  const row = { squad, station: agent?.station ?? null, reported: Boolean(r), online: Boolean(agent?.online), state: "none" };
  if (!r) return row;
  const since = now - agent.got; // how long ago the report came
  const context = r.context ?? {};
  const totals = r.totals ?? {};
  const talk = r.talk ?? {};
  row.state = ended ? "ended" : !row.online ? "offline" : known.has(r.state) ? r.state : "idle";
  row.live = row.state === "thinking" || row.state === "acting";
  // How long it has been in this state: what the agent's own clock said, plus the wait since.
  row.stateMs = Number.isFinite(r.at) && Number.isFinite(r.since) ? Math.max(0, r.at - r.since) + (row.live ? since : 0) : null;
  row.standBy = Boolean(r.standBy) && row.state === "thinking";
  row.woke = row.live && r.woke ? r.woke : null;
  row.tool = row.state === "acting" ? r.tool ?? null : null;
  row.reason = (row.state === "skipped" || row.state === "stopped") && r.reason ? r.reason : null;
  row.tier = r.role === "squad" ? r.tier ?? null : null;
  row.role = r.role === "anvil" ? "anvil" : "squad";
  row.brain = r.brain === "scripted" && r.where === "browser" ? "demo" : brains.has(r.brain) ? r.brain : "other";
  row.where = r.where === "browser" ? "browser" : "server";
  // The model that answered last; before the first thought, the one its brain plans to use.
  row.model = r.model ?? r.planned ?? null;
  row.modelSeen = Boolean(r.model);
  row.input = Number.isFinite(context.input) ? context.input : null;
  row.cachedShare = row.input > 0 && Number.isFinite(context.cached) ? context.cached / row.input : null;
  row.window = Number.isFinite(context.window) ? context.window : null;
  row.bar = barWidth(row.input, row.window);
  row.used = row.input !== null && row.window ? row.input / row.window : null;
  row.output = Number.isFinite(r.output) ? r.output : null;
  row.messages = talk.messages ?? 0;
  row.wakes = talk.wakes ?? 0;
  row.limit = talk.limit ?? null;
  row.resetWhy = talk.resetWhy ?? null;
  row.resetMs = Number.isFinite(talk.resetAt) && Number.isFinite(r.at) ? Math.max(0, r.at - talk.resetAt) + since : null;
  row.thoughts = totals.thoughts ?? 0;
  row.totalIn = totals.input ?? 0;
  row.totalOut = totals.output ?? 0;
  row.avgMs = row.thoughts > 0 && Number.isFinite(totals.ms) ? totals.ms / row.thoughts : null;
  row.lastMs = Number.isFinite(totals.lastMs) ? totals.lastMs : null;
  row.actions = Array.isArray(r.actions) ? r.actions.slice(-5).map((a) => ({ text: String(a.text ?? ""), ok: a.ok !== false })) : [];
  row.said = typeof r.said === "string" && r.said ? r.said : null;
  return row;
}

// sideOf adds the rows up into the one line for the whole side.
export function sideOf(rows) {
  const reported = rows.filter((r) => r.reported);
  return {
    agents: reported.filter((r) => r.online).length,
    thinking: reported.filter((r) => r.state === "thinking" || r.state === "acting").length,
    thoughts: reported.reduce((n, r) => n + r.thoughts, 0),
    input: reported.reduce((n, r) => n + r.totalIn, 0),
    output: reported.reduce((n, r) => n + r.totalOut, 0),
  };
}

// ---- the view ----

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

// put writes text into a node only when it changed, so a busy net does not make the
// browser lay the panel out again for nothing.
const put = (node, text) => {
  if (node.textContent !== text) node.textContent = text;
};

// mountMonitor draws the agents into `list` (the full view), `strip` (the compact one in
// the sidebar) and `side` (the line for the whole side). stations() lists who should
// have an agent: [{ squad, callsign: { en, he }, tier }], the operator first.
// t(key, vars) translates, lang() is "en" or "he", tierName(tier) names a brain tier.
export function mountMonitor({ agents, list, strip, side, t, lang, tierName, stations, onOpen = () => {} }) {
  const full = new Map(); // squad → { node, cells }
  const small = new Map();

  function fullRow(squad) {
    const node = el("li", "agent");
    node.dataset.squad = squad;
    const c = {};
    const head = el("div", "head");
    head.append((c.dot = el("i", "dot")), (c.name = el("strong", "name")), (c.who = el("span", "who")), (c.state = el("span", "state")));
    const model = el("div", "line");
    model.append(el("span", "label", t("monitor.model")), (c.model = el("bdi", "value")), (c.brain = el("span", "note")));
    const ctx = el("div", "line");
    c.fill = el("b");
    const bar = el("i", "bar");
    bar.append(c.fill);
    ctx.append(el("span", "label", t("monitor.context")), (c.context = el("bdi", "value")), bar, (c.used = el("bdi", "note")));
    const talk = el("div", "line");
    talk.append(el("span", "label", t("monitor.talk")), (c.talk = el("span", "value")));
    const match = el("div", "line");
    match.append(el("span", "label", t("monitor.match")), (c.match = el("span", "value")));
    const did = el("div", "line did");
    did.append(el("span", "label", t("monitor.did")), (c.did = el("span", "value")));
    node.append(head, model, ctx, talk, match, did);
    return { node, c, ctx, talk, match, did, model };
  }

  function smallRow(squad) {
    const node = el("li", "agent");
    node.dataset.squad = squad;
    const c = {};
    c.fill = el("b");
    const bar = el("i", "bar");
    bar.append(c.fill);
    node.append((c.dot = el("i", "dot")), (c.name = el("span", "name")), (c.model = el("bdi", "model")), bar);
    return { node, c };
  }

  // Lengths of time with the units of the page's language.
  const time = (ms) => span(ms, { s: t("monitor.sec"), min: t("monitor.min") });
  const stateText = (row) => {
    const timer = row.live && row.stateMs !== null ? ` ${time(row.stateMs)}` : "";
    let text = t(`monitor.state.${row.state}`) + timer;
    if (row.woke) text += ` · ${t(`monitor.woke.${wokeKey(row.woke.kind)}`, { from: (lang() === "he" ? row.woke.fromHe : null) ?? row.woke.from ?? "", event: row.woke.event ? t(`monitor.event.${eventKey(row.woke.event)}`) : "" })}`;
    if (row.tool) text += ` · ${row.tool}`;
    if (row.standBy) text += ` · ${t("monitor.standBy")}`;
    if (row.reason) text += ` · ${t(`monitor.why.${whyKey(row.reason.code)}`)}`;
    return text;
  };

  function paint(squad, station) {
    const row = rowOf(squad, agents.get(squad), { now: agents.now(), ended: agents.ended });
    const names = row.station ?? station.callsign;
    const name = names?.[lang()] ?? names?.en ?? "";
    const f = full.get(squad);
    const s = small.get(squad);
    for (const view of [f, s]) {
      view.node.dataset.state = row.state;
      put(view.c.name, name);
    }
    const width = row.bar === null ? "0" : `${(row.bar * 100).toFixed(2)}%`;
    for (const view of [f, s]) if (view.c.fill.style.inlineSize !== width) view.c.fill.style.inlineSize = width;
    put(s.c.model, row.reported ? shortModel(row.model) || t(`monitor.brain.${row.brain}`) : "");
    s.node.title = `${name}: ${stateText(row)}`;

    put(f.c.state, stateText(row));
    f.node.classList.toggle("quiet", !row.reported);
    if (!row.reported) {
      put(f.c.who, station.tier ? t("tier", { tier: station.tier, name: tierName(station.tier) }) : t("monitor.operator"));
      for (const line of [f.model, f.ctx, f.talk, f.match, f.did]) line.hidden = true;
      return;
    }
    for (const line of [f.model, f.talk]) line.hidden = false;
    // Until a model has answered there is no context and there are no tokens to show;
    // a brain with no model behind it never has any.
    const modelled = row.input !== null || row.thoughts > 0;
    f.ctx.hidden = f.match.hidden = !modelled;
    put(f.c.who, row.role === "anvil" ? t("monitor.operator") : t("tier", { tier: row.tier ?? station.tier ?? 1, name: tierName(row.tier ?? station.tier ?? 1) }));
    put(f.c.model, row.model ? `${shortModel(row.model)} (${row.model})` : t("monitor.noModel"));
    put(f.c.brain, `${row.model && !row.modelSeen ? `${t("monitor.planned")} · ` : ""}${t(`monitor.brain.${row.brain}`)} · ${t(`monitor.where.${row.where}`)}`);
    put(f.c.context, row.input === null ? t("monitor.unknown") : t("monitor.contextIs", { input: tokens(row.input), cached: row.cachedShare === null ? "–" : share(row.cachedShare), output: tokens(row.output) }));
    put(f.c.used, row.window === null ? t("monitor.noWindow") : row.used === null ? t("monitor.window", { window: tokens(row.window) }) : t("monitor.usedOf", { used: share(row.used), window: tokens(row.window) }));
    put(
      f.c.talk,
      t("monitor.talkIs", { messages: row.messages, wakes: row.wakes, limit: row.limit ?? "–" }) +
        (row.resetWhy ? ` · ${t("monitor.resetIs", { ago: time(row.resetMs), why: t(`monitor.reset.${resetKey(row.resetWhy)}`) })}` : ""),
    );
    put(f.c.match, t("monitor.matchIs", { thoughts: row.thoughts, input: tokens(row.totalIn), output: tokens(row.totalOut), avg: time(row.avgMs), last: time(row.lastMs) }));
    f.did.hidden = row.actions.length === 0 && !row.said;
    put(f.c.did, row.actions.map((a) => (a.ok ? a.text : `${a.text} ✕`)).join("  ·  "));
  }

  // sync makes the rows match who should have an agent, then paints them all. `relabel`
  // builds every row anew, for a change of language.
  function sync(relabel = false) {
    if (relabel) {
      for (const view of [...full.values(), ...small.values()]) view.node.remove();
      full.clear();
      small.clear();
    }
    const want = stations();
    const ids = new Set(want.map((s) => s.squad));
    for (const [squad, view] of full) {
      if (ids.has(squad)) continue;
      view.node.remove();
      small.get(squad).node.remove();
      full.delete(squad);
      small.delete(squad);
    }
    for (const station of want) {
      if (!full.has(station.squad)) {
        full.set(station.squad, fullRow(station.squad));
        small.set(station.squad, smallRow(station.squad));
      }
      // Keep the order the roster has: the operator, then the squads.
      list.append(full.get(station.squad).node);
      strip.append(small.get(station.squad).node);
      paint(station.squad, station);
    }
    (strip.closest("section") ?? strip).hidden = want.length === 0;
    total(want);
  }

  function total(want = stations()) {
    const s = sideOf(want.map((st) => rowOf(st.squad, agents.get(st.squad), { now: agents.now(), ended: agents.ended })));
    put(side, t("monitor.side", { agents: s.agents, thinking: s.thinking, thoughts: s.thoughts, input: tokens(s.input), output: tokens(s.output) }));
  }

  // update repaints one station after its report changed (or all of them for null).
  function update(squad) {
    const want = stations();
    if (squad === null || !full.has(squad)) return sync();
    const station = want.find((s) => s.squad === squad);
    if (!station) return sync();
    paint(squad, station);
    total(want);
  }

  // The running timers: only the rows that are thinking or acting, a few times a second.
  setInterval(() => {
    if (document.hidden) return;
    const want = stations();
    for (const station of want) {
      const a = agents.get(station.squad);
      if (a?.online && !agents.ended && (a.report?.state === "thinking" || a.report?.state === "acting") && full.has(station.squad)) paint(station.squad, station);
    }
  }, 250);

  strip.addEventListener("click", onOpen);
  return { sync, update };
}

// The reasons the page has words for; anything else is "something went wrong".
const whys = new Set(["no_key", "bad_key", "rate_limited", "provider_error", "not_your_seat", "bad_request", "unreachable", "timeout", "stopped", "failed"]);
const whyKey = (code) => (whys.has(code) ? code : "failed");
const wokes = new Set(["call", "heard", "event"]);
const wokeKey = (kind) => (wokes.has(kind) ? kind : "event");
const events = new Set(["contact", "pinned", "losses", "arrived", "squad_lost", "point_lost", "hq_under_attack"]);
const eventKey = (kind) => (events.has(kind) ? kind : "other");
const resets = new Set(["match", "wakes", "tier", "unfinished"]);
const resetKey = (why) => (resets.has(why) ? why : "match");
