// A squad leader with no model behind it: what it does with an order it understood
// (rule-grammar.mjs), what it reports, and how much it decides for itself.
//
// Initiative comes in three levels, the squad's brain tier:
//   1  does what it is told, and reports contact, pinned, arrival and losses;
//   2  also takes the cover near where it stands, falls back once when its men are shaken,
//      and goes for enemies its weapon can hurt;
//   3  also comes at a defended point from the side, asks for support when outnumbered,
//      and keeps a long weapon at its range.
// Every choice is a function of the wake and of what this leader did before: nothing is
// drawn at random.

import { intents, nearestCover, understandLeader } from "./rule-grammar.mjs";
import { phrase, placeName, pointName, targetName } from "./rule-phrases.mjs";

export const radio = (to, body, end) => ({ name: "radio", input: { to, body, end } });

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const bearings = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"]; // y grows south
const sideOf = { N: "north", S: "south", E: "east", W: "west", NE: "north", NW: "north", SE: "south", SW: "south" };
// bearing is the compass direction from one spot toward another.
const bearing = (from, to) => bearings[((Math.round(Math.atan2(to.y - from.y, to.x - from.x) / (Math.PI / 4)) % 8) + 8) % 8];
const turn = (b, quarter) => bearings[(bearings.indexOf(b) + 2 * quarter + 8) % 8];

// structureName is what a structure in a leader's report is called on the radio: a tech
// building by its own name on the map, any other by its kind's.
function structureName(rules, status, id, lang) {
  const st = id && (status?.structures ?? []).find((s) => s.id === id);
  if (!st) return "";
  if (st.site) return (lang === "he" && st.siteHe) || st.site;
  const defs = Object.values(rules.factions).flatMap((f) => Object.values(f.structures));
  return defs.find((d) => d.name.en === st.name)?.name[lang] ?? st.name ?? "";
}

// Speaker says the brain's lines for one station in one language. `mem.said` counts how
// often the station has given each kind of report, so its wording changes from one to the
// next, and the squad's number sets where it starts, so two squads do not sound alike.
export function speaker(rules, lang, agent, mem, status) {
  const num = Number(agent.station?.key?.split("-").at(-1)) || agent.squad || 0;
  const name = (id) => {
    if (typeof id !== "string") return id;
    return structureName(rules, status, id, lang) || placeName(rules, id, lang);
  };
  const say = (key, vars = {}, varied = false) => {
    const v = { ...vars };
    if (v.place !== undefined) v.place = name(v.place);
    if (v.target !== undefined && typeof v.target === "number") v.target = targetName(rules, v.target, lang);
    if (v.verb) v.verb = phrase(rules, lang, v.verb);
    if (v.side) v.side = phrase(rules, lang, `side.${v.side}`);
    if (v.options) v.options = v.options.map(name).join(phrase(rules, lang, "or"));
    if (v.orders) v.options = v.orders.map((o) => phrase(rules, lang, o)).join(phrase(rules, lang, "or"));
    return phrase(rules, lang, key, v, varied ? num + (mem.said[key] = (mem.said[key] ?? 0) + 1) - 1 : 0);
  };
  return say;
}

// fresh is the memory a leader keeps between wakes.
export const fresh = () => ({ said: {}, order: null, fellBack: false, askedAt: null, rangedAt: null, next: null });

// levelOf is a squad's initiative: its brain tier, 1 to 3.
export const levelOf = (agent) => Math.max(1, Math.min(3, Number(agent.level ?? agent.tier) || 1));

// reportLine answers "report": where the squad is, its strength, its task and what it sees.
function reportLine(say, status, rules, lang) {
  const you = status?.you;
  if (!you) return say("sayAgain");
  const o = you.order ?? { kind: "none" };
  const where = o.place || o.point;
  const doing = o.kind === "none" || !o.kind ? say("doing.none") : ["move", "hold", "attack"].includes(o.kind) && (where || o.contact) ? say(`doing.${o.kind}`, o.contact ? { place: targetName(rules, o.contact, lang) } : { place: where }) : say("doing.other");
  const seen = (you.contacts ?? []).length ? say("seen.some", { count: you.contacts.length, target: you.contacts[0] }) : say("seen.none");
  const nerves = (you.teams ?? []).map((t) => t.nerve);
  const nerve = nerves.includes("pinned") ? say("nerve.pinned") : nerves.includes("shaken") ? say("nerve.shaken") : "";
  return say("report", { place: you.near, alive: you.alive, full: you.full, doing, seen }) + nerve;
}

// The tools a refusal can fall back from to the plain order.
const plain = (intent, back, say) => [{ ...intent.tool, orElse: (why) => [radio(back, say("negative", { reason: why }), "over")] }, radio(back, say("wilco"), "out")];

// carryOut turns an intent into the steps of a wake: the tool call, then the answer.
export function carryOut(intent, ctx, mem) {
  const { agent, wake, rules } = ctx;
  const call = wake.call;
  const lang = call?.lang === "he" ? "he" : call ? "en" : agent.lang === "he" ? "he" : "en";
  const back = [call?.from.en ?? agent.commander ?? "Hammer"];
  const status = wake.status;
  const say = speaker(rules, lang, agent, mem, status);
  const level = levelOf(agent);
  const unit = agent.unit ?? {};
  const you = status?.you;

  if (intent.kind === "none") return [];
  if (intent.kind === "report") return [radio(back, reportLine(say, status, rules, lang), "over")];
  if (intent.kind === "say" || intent.kind === "unclear") {
    const s = intent.say;
    const vars = s.why ? { reason: say(s.why, s.vars) } : s.vars;
    return [radio(back, say(s.key, vars), s.end)];
  }

  // A new order: what the leader decided on its own under the last one is forgotten.
  Object.assign(mem, { order: intent, fellBack: false, next: null });
  const negative = (why) => [radio(back, say("negative", { reason: why }), "over")];
  const act = (step, ack = say("wilco"), orElse = negative) => [{ ...step, orElse }, radio(back, ack, "out")];

  if (intent.kind === "attack") {
    const target = intent.contact ? (status?.contacts ?? []).find((c) => c.id === intent.contact) : null;
    // From level 2 a squad says so when its weapon cannot touch what it is sent at.
    if (level >= 2 && target && unit.vs?.[target.class] === 0) return negative(say("why.cannotHurt", { target: target.id }));
    if (level >= 2 && intent.any && intent.contact) return act(intent.tool, say("ackTarget", { target: intent.contact }));
    const point = rules.map.points.find((p) => p.id === intent.tool.input.place);
    if (level >= 3 && point && you) {
      const far = dist(you, point);
      // A long weapon stays at its range: it holds a spot short of the point, on its own side of it.
      if ((unit.minRange > 0 || unit.siege) && unit.range >= 200) {
        const off = Math.round((unit.range * 0.8) / 10) * 10;
        if (far > off) {
          const spot = `${bearing(point, you)} of ${point.id} ${off}`;
          return act({ name: "hold", input: { place: spot } }, say("ackRange", { count: off }), () => plain(intent, back, say));
        }
      } else if (far > 260 && (status?.contacts ?? []).some((c) => dist(c, point) <= 220)) {
        // A defended point is come at from the side: first to a spot off its flank, then in.
        const straight = bearing(point, you);
        const sides = [turn(straight, 1), turn(straight, -1)];
        const cover = (b) => {
          const spot = spotAt(point, b, 120);
          return Math.min(...(rules.map.landmarks ?? []).map((l) => dist(l, spot)), 9999);
        };
        const [a, b] = sides.map(cover);
        const side = Math.abs(a - b) > 20 ? (a < b ? sides[0] : sides[1]) : sides[(agent.squad ?? 0) % 2];
        mem.next = { arrive: intent };
        return act({ name: "move", input: { place: `${side} of ${point.id} 120` } }, say("ackFlank", { side: sideOf[side] }), () => ((mem.next = null), plain(intent, back, say)));
      }
    }
    return act(intent.tool);
  }
  return act(intent.tool);
}

const offsets = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0], NE: [0.71, -0.71], NW: [-0.71, -0.71], SE: [0.71, 0.71], SW: [-0.71, 0.71] };
const spotAt = (p, b, metres) => ({ x: p.x + offsets[b][0] * metres, y: p.y + offsets[b][1] * metres });

// leaderEvent is what a leader does when something happens to its squad and nobody called.
export function leaderEvent(ctx, mem) {
  const { agent, wake, rules } = ctx;
  const e = wake.items.find((i) => i.kind === "event")?.event;
  if (!e) return [];
  const lang = agent.lang === "he" ? "he" : "en";
  const to = [agent.commander ?? "Hammer"];
  const status = wake.status;
  const say = speaker(rules, lang, agent, mem, status);
  const level = levelOf(agent);
  const unit = agent.unit ?? {};
  const you = status?.you;
  // Where it is, by the name of the thing it was sent to: a landmark, a bridge, a
  // structure or a tech building; the nearest point only when it was sent to none.
  const where = (e.place && placeName(rules, e.place, lang)) || structureName(rules, status, e.structure, lang) || pointName(rules, e.point, lang);
  const line = {
    contact: () => say("contact", { place: where, target: e.contact }, true),
    pinned: () => say("pinned", { place: where }, true),
    arrived: () => say("arrived", { place: where }, true),
    losses: () => say("losses", { place: where, count: e.count }, true),
    garrisoned: () => say("garrisoned", { place: where }, true),
    fortified: () => say("fortified", { place: pointName(rules, e.point, lang) }),
    charge_planted: () => say("planted", { place: pointName(rules, e.point, lang), count: e.count }),
    crushed: () => say("crushed", { place: pointName(rules, e.point, lang) }),
  }[e.kind];
  if (!line) return [];
  const tell = (body = line()) => radio(to, body, "over");
  if (level < 2 || !you) return [tell()];

  const teams = (you.teams ?? []).filter((t) => t.members === undefined || t.members > 0);
  const inside = teams.some((t) => t.in);
  const covered = inside || teams.some((t) => t.cover);
  const shaken = teams.filter((t) => t.nerve === "shaken" || t.nerve === "pinned").length;
  const order = you.order ?? { kind: "none" };
  const side = agent.side;
  const seen = (status.contacts ?? []).filter((c) => dist(c, you) <= 450);

  // A flank move that has reached its spot goes in.
  if (e.kind === "arrived" && mem.next?.arrive) {
    const go = mem.next.arrive;
    mem.next = null;
    return [{ ...go.tool }];
  }
  // Level 3, a long weapon with the enemy inside its reach: back to a point of its own.
  if (level >= 3 && e.kind === "contact" && (unit.minRange > 0 || unit.siege)) {
    const close = seen.find((c) => dist(c, you) < Math.max(unit.minRange ?? 0, unit.range * 0.4));
    const home = close && retreat(status, rules, side, you);
    if (home && mem.rangedAt !== status.timeLeft) {
      mem.rangedAt = status.timeLeft;
      return [{ name: "move", input: { place: home } }, tell(say("keepingRange", { place: where }))];
    }
  }
  // Level 2: shaken men are pulled back, once for each order they were given.
  if ((e.kind === "pinned" || e.kind === "losses") && !mem.fellBack && !inside && teams.length > 0 && (shaken * 2 >= teams.length || you.alive * 2 <= you.full)) {
    const home = retreat(status, rules, side, you);
    if (home && home !== order.point) {
      mem.fellBack = true;
      mem.next = null;
      return [{ name: "move", input: { place: home } }, tell(say("fallingBack", { place: home }, true))];
    }
  }
  if (e.kind === "contact") {
    // Level 3 counts heads before the fight is lost.
    const theirs = seen.reduce((n, c) => n + (c.teams?.length ?? 1), 0);
    if (level >= 3 && theirs > teams.length && seen.length > 1 && (mem.askedAt === null || mem.askedAt - status.timeLeft >= 45)) {
      mem.askedAt = status.timeLeft;
      return [tell(say("requestSupport", { place: where, count: seen.length }, true))];
    }
    // A squad with nothing to do goes for an enemy it can hurt.
    const prey = seen.filter((c) => (unit.vs?.[c.class] ?? 1) > 0).sort((a, b) => dist(a, you) - dist(b, you) || a.id - b.id)[0];
    if (order.kind === "none" && prey && unit.damage !== 0 && !unit.captureSeconds) return [{ name: "attack", input: { place: "", contact: prey.id } }, tell(say("engaging", { target: prey.id, place: where }))];
    // One that is holding gets into the cover beside it, when that does not give up its post.
    if (order.kind === "hold" && !covered && unit.class === "infantry") {
      const post = rules.map.points.find((p) => p.id === order.point);
      const near = nearestCover(status, rules, { within: 110 });
      if (near && (!post || dist(near, post) <= rules.match.captureRadius - 6)) return [{ name: "hold", input: { place: near.id } }, tell()];
    }
  }
  // Arrived after a move: nobody stands in the open when there is cover at hand.
  if (e.kind === "arrived" && mem.order?.kind === "move" && !mem.order.leave && !covered && unit.class === "infantry" && !e.place && !e.structure) {
    const near = nearestCover(status, rules, { within: 110 });
    if (near) return [{ name: "hold", input: { place: near.id } }, tell(say("arrived", { place: near.id }, true))];
  }
  return [tell()];
}

// retreat is where a squad falls back to: the nearest point its side holds that is nearer
// its own headquarters than the squad is, or the headquarters itself.
function retreat(status, rules, side, you) {
  const hq = rules.map.points.find((p) => p.kind === "hq" && p.owner === side);
  if (!hq) return null;
  const held = new Set((status.points ?? []).filter((p) => p.owner === side).map((p) => p.id));
  const back = rules.map.points
    .filter((p) => held.has(p.id) && p.kind !== "seaRig" && dist(p, hq) < dist(you, hq) - 60)
    .sort((a, b) => dist(a, you) - dist(b, you) || a.id.localeCompare(b.id))[0];
  return (back ?? hq).id;
}

// leaderPlan is one wake of a rule-brain leader: a call is understood and carried out, an
// event is reported and, from level 2 up, acted on.
export function leaderPlan(ctx, mem) {
  if (!ctx.wake.call) return leaderEvent(ctx, mem);
  const intent = understandLeader({ call: ctx.wake.call, status: ctx.wake.status, rules: ctx.rules, agent: ctx.agent, level: levelOf(ctx.agent) });
  return carryOut(intent, ctx, mem);
}

export { intents };
