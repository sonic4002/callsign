// A brain with no model behind it. It understands a handful of plain orders by pattern
// and answers in procedure, in Hebrew or English. Tests run on it, and so does a match
// started without an API key. It answers in the same shape the Claude brain does.

import { buildVerb, captureVerb, namedStructure, placeOf, wantedStructure } from "./bases.mjs";
import { compactStructures } from "./bases.mjs";

const verbs = [
  ["attack", /\b(attack|assault|destroy|hit)\b|תקוף|תקפו|לתקוף|השמד/],
  ["move", /\b(move|go|advance|head)\b|נוע|נועו|זוז|זוזו|התקדם/],
  ["hold", /\b(hold|defend|take|capture|secure|guard)\b|תחזיק|החזק|להחזיק|הגן|קח|כבוש|תפוס|תפסו/],
];
// Words for the gold haulers, and for guarding them.
const haulerWords = /\b(haulers?|trucks?|crawlers?|miners?|harvesters?)\b|משאית|משאיות|מוביל|מובילים|זחל|זחלים/;
const escortWords = /\b(escort|protect|cover|guard)\b|לווה|ליווי|אבטח|שמור/;
const say = {
  wilco: { en: "Wilco", he: "רות, יבוצע" },
  sayAgain: { en: "Say again", he: "אמור שנית" },
  fiveByFive: { en: "Five by five", he: "חמש על חמש" },
  negative: { en: "Negative", he: "שלילי" },
};
const haulerLines = {
  hauler_attacked: { en: (p) => `Hauler under attack near ${p}`, he: (p) => `מוביל זהב מותקף ליד ${p}` },
  hauler_lost: { en: (p) => `Hauler lost near ${p}`, he: (p) => `מוביל זהב אבד ליד ${p}` },
};
const eventLines = {
  pinned: { en: (p) => `Pinned at ${p}, request support`, he: (p) => `מרותקים ב${p}, מבקש סיוע` },
  contact: { en: (p) => `Contact near ${p}`, he: (p) => `מגע ליד ${p}` },
  arrived: { en: (p) => `In position at ${p}`, he: (p) => `בעמדה ב${p}` },
  losses: { en: (p) => `Taking losses at ${p}`, he: (p) => `נפגעים ב${p}` },
};

const radio = (to, body, end) => ({ name: "radio", input: { to, body, end } });
const verbOf = (text) => verbs.find(([, re]) => re.test(text.toLowerCase()))?.[0];

function leaderPlan({ agent, wake, rules }) {
  const call = wake.call;
  if (!call) {
    const e = wake.items.find((i) => i.kind === "event")?.event;
    const line = e && eventLines[e.kind]?.[agent.lang];
    if (!line) return [];
    const point = rules.map.points.find((p) => p.id === e.point);
    return [radio([agent.commander ?? "Hammer"], line(point.callsign[agent.lang]), "over")];
  }
  if (call.from.key !== "player" && call.from.key !== "operator") return []; // squads do not order squads
  const lang = call.lang;
  const back = [call.from.en];
  if (call.prowords?.includes("radioCheck")) return [radio(back, say.fiveByFive[lang], "out")];
  const orElse = (why) => radio(back, `${say.negative[lang]}, ${why}`, "over");
  // An enemy structure named in the call: engineers take it over, anyone else attacks it.
  const structures = compactStructures(wake.status ?? {}, agent.side);
  const theirs = namedStructure(call.body, structures, { enemy: true });
  if (theirs && captureVerb.test(call.body.toLowerCase()) && agent.unit?.captureSeconds > 0) {
    return [{ name: "capture", input: { place: theirs.id }, orElse }, radio(back, say.wilco[lang], "out")];
  }
  const escort = escortWords.test(call.body.toLowerCase()) && haulerWords.test(call.body.toLowerCase());
  const verb = escort ? "hold" : verbOf(call.body);
  if (theirs && verb === "attack") {
    return [{ name: "attack", input: { point: theirs.id, contact: 0 }, orElse }, radio(back, say.wilco[lang], "out")];
  }
  // "Escort the haulers": hold the field they work, or the one nearest home when they are not out.
  const point = escort ? call.points?.[0] ?? workedField(wake.status, rules, agent.side) : call.points?.[0];
  if (!verb || (!point && verb === "move")) return [radio(back, say.sayAgain[lang], "over")];
  // "Attack" with no target: the nearest enemy in sight, or else the enemy headquarters.
  const named = Number(new RegExp(`(?:${rules.callsigns.contact.en}|${rules.callsigns.contact.he})\\s*#?(\\d+)`, "i").exec(call.body)?.[1] ?? 0);
  const contact = named || (!point && wake.status?.contacts?.[0]?.id) || 0;
  const enemyHQ = rules.map.points.find((p) => p.kind === "hq" && p.owner !== agent.side)?.id;
  const input = verb === "attack" ? { point: contact ? "" : point ?? enemyHQ, contact } : { point: point ?? "here" };
  return [
    { name: verb, input, orElse: (why) => radio(back, `${say.negative[lang]}, ${why}`, "over") },
    radio(back, say.wilco[lang], "out"),
  ];
}

// workedField is the map point of the gold field a side's haulers work now, or of the
// field nearest its headquarters.
function workedField(status, rules, side) {
  const gushers = rules.gushers ?? [];
  const working = (status?.haulers ?? []).find((h) => h.field)?.field;
  const hq = rules.map.points.find((p) => p.kind === "hq" && p.owner === side);
  const near = [...gushers].sort((a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y))[0];
  return (gushers.find((g) => g.id === working) ?? near)?.point;
}

// wantedUnit reads which unit a buy call asks for: a unit named in either language first
// ("rocket launcher", "מסוק"), otherwise the cheapest unit of the class it mentions.
const classWords = [
  ["hauler", haulerWords],
  ["air", /\b(air|aircraft|helicopter|chopper|drones?)\b|אוויר|מסוק|רחפן|רחפנים|נחיל/],
  ["vehicle", /\b(tank|vehicle|technical|armou?r)|טנק|רכב|טנדר|שריון/],
  ["naval", /\b(boat|naval|ship)|סירה|סירת|ימי/],
];
const small = new Set(["team", "squad", "main", "cell", "the", "gold", "ore", "חוליית", "כיתת", "זהב"]);
export function wantedUnit(text, units) {
  const low = text.toLowerCase();
  const entries = Object.entries(units);
  const words = (u) => [...u.name.en.toLowerCase().split(/\s+/), ...u.name.he.split(/\s+/)].filter((w) => w.length >= 3 && !small.has(w));
  const score = ([, u]) => words(u).filter((w) => low.includes(w)).length;
  const named = entries.filter((e) => score(e) > 0).sort((a, b) => score(b) - score(a))[0];
  if (named) return named[0];
  const cls = classWords.find(([, re]) => re.test(low))?.[0] ?? "infantry";
  return entries.filter(([, u]) => u.class === cls).sort((a, b) => a[1].cost - b[1].cost)[0]?.[0];
}

// ownMoves is the scripted operator running the fight after Hammer handed it over: one
// purchase when gold allows, and a point to hold for every squad that has no orders. In
// the default mode it is never called: the operator acts on Hammer's orders only.
const tasked = new Map(); // "side:callsign" → seconds left in the match when the operator last tasked it
function ownMoves({ wake, rules, agent }) {
  const s = wake.status;
  const fight = s?.command?.mode === "fight";
  if (!fight && !s?.command?.buy) return [];
  // A squad just told where to go still shows no order for a moment; it is not told twice.
  const fresh = (sq) => {
    const at = tasked.get(`${agent.side}:${sq.callsign.en}`);
    return typeof s.timeLeft === "number" && at !== undefined && at - s.timeLeft >= 0 && at - s.timeLeft < 6;
  };
  const lang = agent.lang === "he" ? "he" : "en";
  const moves = [];
  const units = Object.entries(rules.factions[s.faction ?? ""]?.units ?? {});
  const fielded = s.squads.length + (s.deploying?.length ?? 0);
  if (s.command.buy) {
    // With the purse the operator spends the way the scripted enemy does: the economy
    // first, then what its next unit needs, then the unit. One purchase a wake; the net
    // announces whatever it buys or builds on its own, so nothing is said here.
    const base = compactStructures(s, agent.side).filter((st) => st.whose === "yours");
    const stands = (role) => base.some((st) => st.role === role && !st.building);
    const rising = base.some((st) => st.building && !["defence", "fence"].includes(st.role));
    const defs = rules.factions[s.faction ?? ""]?.structures ?? {};
    const cost = (role) => Object.values(defs).find((d) => d.role === role)?.cost ?? Infinity;
    const raise = (role) => {
      const [id, def] = Object.entries(defs).find(([, d]) => d.role === role) ?? [];
      const missing = (def?.requires ?? []).find((need) => !stands(need));
      if (missing) return raise(missing);
      if (id && !rising && s.gold >= cost(role)) moves.push({ name: "build", input: { structure: id, place: "", place2: "" } });
    };
    const hauler = units.find(([, u]) => u.class === "hauler");
    const haulers = (s.haulers ?? []).filter((h) => h.side === agent.side).length + (s.deploying ?? []).filter((q) => q.class === "hauler").length;
    const infantry = [...s.squads, ...(s.deploying ?? [])].filter((q) => q.class === "infantry").length;
    const cls = infantry < 4 ? "infantry" : "vehicle";
    const pick = units.filter(([, u]) => u.class === cls && !u.captureSeconds).sort((a, b) => a[1].cost - b[1].cost)[0];
    if (!stands("barracks")) raise("barracks");
    else if (!stands("refinery")) raise("refinery");
    else if (hauler && haulers < Math.min(2, rules.match.haulerCap ?? 0)) {
      if (s.gold >= hauler[1].cost) moves.push({ name: "buy", input: { unit: hauler[0], upgrade: "" } });
    } else if (pick && fielded < Math.min(rules.match.populationCap, 8)) {
      if (pick[1].requires && !stands(pick[1].requires)) raise(pick[1].requires);
      else if (s.gold >= pick[1].cost) moves.push({ name: "buy", input: { unit: pick[0], upgrade: "" } });
    }
  }
  if (!fight) return moves; // the purse without the fight: it buys, and tasks nobody
  const mine = (p) => s.points.find((q) => q.id === p.id)?.owner === agent.side;
  const taken = new Set(s.squads.map((q) => q.order?.point).filter(Boolean)); // one squad per point
  for (const sq of s.squads.filter((q) => q.order?.kind === "none" && !fresh(q)).slice(0, 2)) {
    tasked.set(`${agent.side}:${sq.callsign.en}`, s.timeLeft);
    const domain = units.find(([id]) => id === sq.unit)?.[1].domain;
    const goal = rules.map.points
      .filter((p) => p.kind !== "hq" && !mine(p) && !taken.has(p.id) && (domain === "air" || (domain === "sea") === p.y >= rules.map.waterY))
      .sort((a, b) => Math.hypot(a.x - sq.x, a.y - sq.y) - Math.hypot(b.x - sq.x, b.y - sq.y))[0];
    if (goal) taken.add(goal.id);
    if (goal) moves.push(radio([sq.callsign.en], lang === "he" ? `תחזיקו את ${goal.callsign.he}` : `Hold ${goal.callsign.en}`, "over"));
  }
  return moves;
}

function operatorPlan(ctx) {
  const { wake, rules, agent } = ctx;
  const call = wake.call;
  if (!call) {
    // A hauler in trouble is the one thing the scripted operator reports unasked.
    const e = wake.items.find((i) => i.kind === "event" && haulerLines[i.event.kind])?.event;
    if (e) {
      const point = rules.map.points.find((p) => p.id === e.point);
      const lang = agent.lang ?? "en";
      // To the commander, whoever spoke to the operator last.
      return [radio([rules.callsigns.player.en], haulerLines[e.kind][lang](point?.callsign[lang] ?? e.point), "out"), ...ownMoves(ctx)];
    }
  }
  if (!call || call.from.key !== "player") return ownMoves(ctx); // otherwise Anvil answers to Hammer only
  const lang = call.lang;
  const back = [call.from.en];
  const text = call.body.toLowerCase();
  const negative = (why) => radio(back, `${say.negative[lang]}, ${why}`, "over");
  if (call.prowords?.includes("radioCheck")) return [radio(back, say.fiveByFive[lang], "out")];
  // Handing over the fight, or taking command back: the net has already switched the mode
  // on the fixed words, so the operator only acknowledges, and gets to work if it is its fight.
  const says = (kind) => [...rules.radio.command[kind].en, ...rules.radio.command[kind].he].some((phrase) => text.includes(phrase.toLowerCase()));
  if (says("take") || says("give") || says("grant") || says("revoke")) return [radio(back, say.wilco[lang], "out"), ...ownMoves(ctx)];

  if (/\bupgrade\b|שדרג/.test(text)) {
    const squad = (wake.status?.squads ?? []).find((sq) => text.includes(sq.callsign.en.toLowerCase()) || (sq.callsign.he && text.includes(sq.callsign.he)));
    if (!squad) return [radio(back, say.sayAgain[lang], "over")];
    return [{ name: "buy", input: { unit: "", upgrade: squad.callsign.en }, orElse: negative }, radio(back, say.wilco[lang], "out")];
  }
  if (haulerWords.test(text) && !/\b(buy|purchase)\b|קנה|קנו|רכוש/.test(text)) {
    // "Haulers to the Kilo field", "המשאיות לשדה כרמל", "haulers on their own".
    const auto = /\b(auto|on their own|themselves|choose)\b|לבד|בעצמם|בעצמן/.test(text);
    const field = auto ? "auto" : call.points?.[0];
    if (!field) return [radio(back, say.sayAgain[lang], "over")];
    return [{ name: "haul", input: { field, hauler: 0 }, orElse: negative }, radio(back, say.wilco[lang], "out")];
  }
  // Building: a structure named with a word for building, or a defence or a fence asked
  // for by itself ("a gun at Delta", "fence the north side").
  const structures = rules.factions[wake.status?.faction ?? ""]?.structures ?? {};
  const wanted = wantedStructure(text, structures);
  const fixed = wanted && ["defence", "fence"].includes(structures[wanted].role);
  if (wanted && (buildVerb.test(text) || (fixed && !verbOf(text)))) {
    const input = { structure: wanted, place: fixed ? placeOf(text, call.points) : "", place2: "" };
    return [{ name: "build", input, orElse: negative }, radio(back, say.wilco[lang], "out")];
  }
  if (/\b(buy|purchase|build)\b|קנה|קנו|רכוש|בנה/.test(text)) {
    const unit = wantedUnit(text, rules.factions[wake.status?.faction ?? ""]?.units ?? {});
    if (!unit) return [radio(back, say.sayAgain[lang], "over")];
    return [{ name: "buy", input: { unit, upgrade: "" }, orElse: negative }, radio(back, say.wilco[lang], "out")];
  }
  if (/\b(status|sitrep|happening)\b|מצב|מה קורה/.test(text) && wake.status) {
    const s = wake.status;
    const held = s.points.filter((p) => p.owner === agent.side).map((p) => p.id);
    const body = lang === "he" ? `${s.squads.length} כיתות, ${s.gold} זהב, מחזיקים ב ${held.join(" ")}` : `${s.squads.length} squads, ${s.gold} gold, holding ${held.join(" ")}`;
    return [radio(back, body, "over")];
  }
  const verb = verbOf(text);
  const point = rules.map.points.find((p) => p.id === call.points?.[0]);
  if (!verb || !point) return [radio(back, say.sayAgain[lang], "over")];
  // Pass the task to every squad that can reach the point, then confirm to Hammer.
  const sea = point.y >= rules.map.waterY;
  const fit = (wake.status?.squads ?? []).filter((s) => (s.class === "naval") === sea).map((s) => s.callsign.en);
  if (fit.length === 0) return [negative(lang === "he" ? "אין כיתה שיכולה להגיע לשם" : "no squad can reach that point")];
  return [radio(fit, call.body, "over"), radio(back, say.wilco[lang], "out")];
}

export function scriptedBrain() {
  const plans = new Map(); // station key → steps still to run in the current wake
  let nextId = 1;
  return {
    name: "scripted",
    slow: false,
    async think(ctx) {
      const key = `${ctx.agent.side}:${ctx.agent.station.key}`;
      const last = ctx.messages.at(-1);
      let plan;
      if (typeof last.content === "string") {
        plan = (ctx.agent.role === "anvil" ? operatorPlan : leaderPlan)(ctx);
      } else {
        plan = plans.get(key) ?? [];
        const failed = last.content.find((r) => r.is_error);
        const step = failed && ctx.messages.at(-2).content.find((b) => b.id === failed.tool_use_id);
        if (step?.orElse) plan = [step.orElse(failed.content)];
        else if (failed) plan = [];
      }
      const step = plan.shift();
      plans.set(key, plan);
      if (!step) return { content: [{ type: "text", text: "" }], stop_reason: "end_turn" };
      // orElse rides along on the block so the next turn can find it; the server never sees it.
      return { content: [{ type: "tool_use", id: `toolu_scripted_${nextId++}`, name: step.name, input: step.input, orElse: step.orElse }], stop_reason: "tool_use" };
    },
  };
}
