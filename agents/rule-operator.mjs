// Anvil with no model behind it: the operator of the rule brain.
//
// It reads Hammer's calls with fixed patterns in Hebrew and English (build, buy with a
// count, upgrade, cancel, sell, repair, rally, haulers, the fight and the purse, "attack
// with everything", "defend the base", a task for a squad or for everyone, a status
// question), several orders in one call when they are joined by "then" or "and", and it
// answers in procedure. What it does not understand gets "Say again".
//
// Initiative comes in three levels, a setting of the match (the lobby) or of the host:
//   1  carries out orders and nothing else;
//   2  with the purse, also keeps the economy going: the opening, power, haulers, squads
//      to replace the ones lost;
//   3  with the fight, also runs it: takes and holds points, guards the haulers, pulls
//      squads back to a base under attack, and masses before it attacks.
// The room enforces the purse and the fight (server/room/command.go); a refusal is passed
// on to Hammer in the words the game gave. Nothing is drawn at random.

import { buildVerb, compactStructures, namedStructure, placeOf, wantedStructure } from "./bases.mjs";
import { heroUnit, unitAnywhere } from "./heroes.mjs";
import { mendVerb, sellVerb, sparePower } from "./power.mjs";
import { canDig, haulerWords, leaderWords, numberOf, scan, tidy } from "./rule-grammar.mjs";
import { phrase, pointName } from "./rule-phrases.mjs";
import { radio } from "./rule-leader.mjs";

const buyVerb = /\b(buy|purchase|bye|get me|order me|recruit|train)\b|קנה|קנו|תקנה|תקנו|רכוש|רכשו|תרכוש|גייס|גייסו/;
const cancelVerb = /\b(cancel|scrap|call off)\b|בטל|בטלו/;
const rallyVerb = /\brall(y|ies)\b|\b(gather|assemble|muster)\b|מתכנס|התכנס|כינוס|נאספ/;
const upgradeVerb = /\b(upgrade|promote)\b|שדרג|שדרגו|תשדרג/;
const statusWords = /\b(status|sitrep|happening|situation|report|picture)\b|מצב|מה קורה|דווח|תמונת/;
const everything = /\b(everything|everyone|all squads|all units|every squad|all forces|all out|all in)\b|עם הכל|כולם|כל הכיתות|כל הכוחות|כל הכוח/;
const defendBase = /\b(defend|protect|guard|save)\b[^.]*\b(base|hq|headquarters|home)\b|הגנו על (?:ה)?(?:בסיס|מפקדה)|להגן על (?:ה)?(?:בסיס|מפקדה)|הגן על (?:ה)?(?:בסיס|מפקדה)|תגנו על (?:ה)?(?:בסיס|מפקדה)/;
// Other ways of handing over and taking back than the fixed phrases the net switches on.
const loose = {
  give: /\b(take it from here|handle it|handle the fight|you're in charge|you are in charge|take charge|it's your fight)\b|תטפל בזה|קח את זה מכאן|אתה מנהל|קח אחריות/,
  take: /\b(i'll take it from here|i will take it from here|give me back command|i'm back in command|stand down)\b|אני ממשיך מכאן|תחזיר לי את הפיקוד|אני חוזר לפקד/,
};
const sendVerb = /\b(send|dispatch|get|tell|order)\b|שלח|שלחו|תשלח/;
const then = /\s*(?:[,;.]\s*)?(?:\band then\b|\bthen\b|\bafter that\b|\bafterwards\b|ואז|אחר כך|ואחרי זה|ולאחר מכן|ואחריו|ואחריה)\s*/i;
const and = /\s+(?:and|&|וגם)\s+/i;

// wantedUnit reads which unit a buy call asks for: a unit named in either language first
// ("rocket launcher", "מסוק"), otherwise the cheapest unit of the class it mentions.
const classWords = [
  ["hauler", haulerWords],
  ["air", /\b(air|aircraft|helicopters?|choppers?|drones?)\b|אוויר|מסוק|רחפן|רחפנים|נחיל/],
  ["vehicle", /\b(tanks?|vehicles?|technicals?|armou?r)|טנק|רכב|טנדר|שריון/],
  ["naval", /\b(boats?|naval|ships?)|סירה|סירת|סירות|ימי/],
  ["infantry", /\b(infantry|squads?|soldiers?|troops?|riflemen|men)\b|חי"ר|חי״ר|חיר|כיתה|כיתת|כיתות|חיילים|לוחמים/],
];
const small = new Set(["team", "squad", "main", "cell", "the", "gold", "ore", "חוליית", "כיתת", "זהב"]);
function unitIn(text, units, anyClass) {
  const low = text.toLowerCase();
  const entries = Object.entries(units);
  const words = (u) => [...u.name.en.toLowerCase().split(/\s+/), ...u.name.he.split(/\s+/)].filter((w) => w.length >= 3 && !small.has(w));
  const score = ([, u]) => words(u).filter((w) => low.includes(w)).length;
  const named = entries.filter((e) => score(e) > 0).sort((a, b) => score(b) - score(a))[0];
  if (named) return named[0];
  const cls = classWords.find(([, re]) => re.test(low))?.[0] ?? (anyClass ? "infantry" : null);
  return cls ? entries.filter(([, u]) => u.class === cls && !u.hero && !u.captureSeconds).sort((a, b) => a[1].cost - b[1].cost)[0]?.[0] : undefined;
}
export const wantedUnit = (text, units) => unitIn(text, units, true);

const namesAUnit = (text, units) => Object.values(units).some((u) => text.includes(u.name.en.toLowerCase()) || text.includes(u.name.he));

// spotOf cuts an exact spot out of a call: from its first distance to its end ("140 metres
// north and 60 metres east of Alpha"). The game turns the words into the place.
const bearing = /north|south|east|west|צפונ|דרומ|מזרח|מערב/;
export function spotOf(body) {
  const at = body.search(/\d+\s*(?:metres?|meters?|m\b|מטר|מ')/i); // a distance, not the number in a squad's or a structure's name
  if (at < 0) return undefined;
  const spot = body.slice(at).replace(/[.!\s]+$/, "");
  return bearing.test(spot.toLowerCase()) ? spot : undefined;
}

// runOf reads the way a fence is to lie out of a call, as the build tool names it, or "".
// The words stand before the spot ("running north to south, 140 metres north of Alpha"),
// so only the call up to its first distance is read.
export function runOf(body) {
  const at = body.search(/\d/);
  const head = (at < 0 ? body : body.slice(0, at)).toLowerCase();
  const ne = /north-?\s?east|צפון[-־ ]מזרח/.test(head);
  const nw = /north-?\s?west|צפון[-־ ]מערב/.test(head);
  if (ne && /south-?\s?west|דרום[-־ ]מערב/.test(head)) return "northeast-southwest";
  if (nw && /south-?\s?east|דרום[-־ ]מזרח/.test(head)) return "northwest-southeast";
  if (/north to south|south to north|north-south|מצפון לדרום|מדרום לצפון/.test(head)) return "north-south";
  if (/east to west|west to east|east-west|ממזרח למערב|ממערב למזרח/.test(head)) return "east-west";
  return "";
}

// countIn reads how many of a thing a clause asks for ("two tanks", "3 טנקים"), 1 when it
// names no number. A number that is part of a callsign or a distance is not a count.
function countIn(text, rules) {
  const names = [...Object.values(rules.callsigns.classes), rules.callsigns.contact].flatMap((t) => [t.en.toLowerCase(), t.he]);
  const words = text.toLowerCase().replace(/[.,;:!?]/g, " ").split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const n = numberOf(words[i]);
    if (!n || names.includes(words[i - 1]) || /^(metres?|meters?|m|מטר)$/.test(words[i + 1] ?? "")) continue;
    if (["to", "too", "for", "won", "ate", "tree"].includes(words[i])) continue; // little words first, numbers second
    return Math.min(n, 5);
  }
  return 1;
}

// pointsIn finds the map points a part of a call names, in the order said.
function pointsIn(text, ids, rules) {
  const low = text.toLowerCase();
  return (ids ?? [])
    .map((id) => {
      const p = rules.map.points.find((q) => q.id === id);
      const names = [p?.callsign.en, p?.callsign.he, p?.name.en, p?.name.he, ...(p?.aliases ?? [])].filter(Boolean).map((n) => n.toLowerCase());
      return { id, at: Math.min(...names.map((n) => low.indexOf(n)).filter((i) => i >= 0), Infinity) };
    })
    .filter((p) => p.at < Infinity)
    .sort((a, b) => a.at - b.at)
    .map((p) => p.id);
}

export const freshOperator = () => ({ tasked: new Map(), told: new Map(), massing: null });
export const operatorLevel = (agent) => Math.max(1, Math.min(3, Number(agent.level) || 3));

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ownMoves is the operator acting on its own, as far as its level and Hammer's leave go:
// with the purse (level 2 up) one purchase a wake, with the fight (level 3) tasks for the
// squads. On Hammer's orders only it is never called.
function ownMoves({ wake, rules, agent }, mem) {
  const s = wake.status;
  const level = operatorLevel(agent);
  const fight = s?.command?.mode === "fight" && level >= 3;
  const purse = s?.command?.buy && level >= 2;
  if (!fight && !purse) return [];
  const lang = agent.lang === "he" ? "he" : "en";
  const moves = [];
  const units = Object.entries(rules.factions[s.faction ?? ""]?.units ?? {});
  const fielded = s.squads.length + (s.deploying?.length ?? 0);
  if (purse) {
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
      // Power first: what would leave the side short waits for another power structure.
      const plants = base.filter((st) => st.role === "power").length;
      if (role !== "power" && def?.power < 0 && sparePower(s, agent.side, defs) + def.power < 0 && plants < (rules.match.powerStructures ?? 1)) return raise("power");
      if (id && !rising && s.gold >= cost(role)) moves.push({ name: "build", input: { structure: id, place: "", place2: "" } });
    };
    const hauler = units.find(([, u]) => u.class === "hauler");
    const haulers = (s.haulers ?? []).filter((h) => h.side === agent.side).length + (s.deploying ?? []).filter((q) => q.class === "hauler").length;
    const count = (cls) => [...s.squads, ...(s.deploying ?? [])].filter((q) => q.class === cls).length;
    // Squads to replace the ones lost: infantry to hold ground first, then armour beside them.
    const cls = count("infantry") < 4 ? "infantry" : count("vehicle") < 3 ? "vehicle" : count("infantry") <= count("vehicle") ? "infantry" : "vehicle";
    const pick = units.filter(([, u]) => u.class === cls && !u.captureSeconds && !u.hero).sort((a, b) => a[1].cost - b[1].cost)[0];
    // The opening and what is put back first: the refinery, which brings a hauler, then
    // the barracks. More haulers come out of the works once it stands, a third when the
    // match is well under way; with no hauler left at all the works comes before any squad.
    const elapsed = typeof s.timeLeft === "number" ? Math.max(0, (rules.map.lengthSeconds ?? rules.match.lengthSeconds) - s.timeLeft) : 0;
    const wantHaulers = Math.min(elapsed > 240 ? 3 : 2, rules.match.haulerCap ?? 0);
    const more = hauler && haulers < wantHaulers;
    const short = s.power?.low && sparePower(s, agent.side, defs) < 0 && base.filter((st) => st.role === "power").length < (rules.match.powerStructures ?? 1);
    // The base grows in the order of the opening, which the game works out (status.opening):
    // power, the refinery and the barracks come before anything is bought, and what follows
    // them goes up when a unit needs it or when there is gold to spare for it. A structure
    // that has lost a third of itself is mended when the side is rich. Nothing is sold and
    // no rally point is set: those are Hammer's to ask for.
    const next = s.opening ?? "";
    const spare = 2 * (pick?.[1].cost ?? 0);
    const hurt = base.filter((st) => !st.building && !st.repairing && st.health < 0.66).sort((a, b) => a.health - b.health)[0];
    if (short) raise("power");
    else if (["power", "refinery", "barracks"].includes(next)) raise(next);
    else if (!stands("refinery")) raise("refinery");
    else if (!stands("barracks")) raise("barracks");
    else if (more && stands(hauler[1].requires)) {
      if (s.gold >= hauler[1].cost) moves.push({ name: "buy", input: { unit: hauler[0], upgrade: "" } });
    } else if (more && haulers === 0) raise(hauler[1].requires);
    else if (next && !rising && s.gold >= cost(next) + spare) raise(next);
    else if (hurt && s.gold >= 2 * spare) moves.push({ name: "repair", input: { place: hurt.id } });
    else if (pick && fielded < Math.min(rules.match.populationCap, 8)) {
      if (pick[1].requires && !stands(pick[1].requires)) raise(pick[1].requires);
      else if (s.gold >= pick[1].cost) moves.push({ name: "buy", input: { unit: pick[0], upgrade: "" } });
    }
  }
  if (!fight) return moves; // the purse without the fight: it buys, and tasks nobody
  return [...moves, ...fightMoves({ wake, rules, agent }, mem, lang)];
}

// fightMoves is the level-3 operator running the fight Hammer handed it. At most three
// calls a wake, so the net stays readable.
function fightMoves({ wake, rules, agent }, mem, lang) {
  const s = wake.status;
  const side = agent.side;
  const say = (key, vars) => phrase(rules, lang, key, vars);
  const name = (id) => pointName(rules, id, lang);
  const now = typeof s.timeLeft === "number" ? s.timeLeft : 0;
  // A squad just told where to go still shows its old order for a moment; it is not told twice.
  const fresh = (sq, secs = 6) => {
    const at = mem.tasked.get(sq.callsign.en);
    return typeof s.timeLeft === "number" && at !== undefined && at - now >= 0 && at - now < secs;
  };
  // The same thing is not told to Hammer twice within a while.
  const once = (what, secs) => {
    const at = mem.told.get(what);
    if (typeof s.timeLeft === "number" && at !== undefined && at - now >= 0 && at - now < secs) return false;
    mem.told.set(what, now);
    return true;
  };
  const unitOf = (sq) => rules.factions[s.faction ?? ""]?.units[sq.unit] ?? unitAnywhere(rules, sq.unit) ?? {};
  const fighter = (sq) => {
    const u = unitOf(sq);
    return !u.captureSeconds && !u.hero && u.class !== "hauler";
  };
  const hq = rules.map.points.find((p) => p.kind === "hq" && p.owner === side);
  const enemyHQ = rules.map.points.find((p) => p.kind === "hq" && p.owner !== side);
  const owner = (id) => s.points.find((q) => q.id === id)?.owner;
  const land = s.squads.filter((sq) => fighter(sq) && sq.class !== "naval");
  const moves = [];
  const task = (squads, body) => {
    for (const sq of squads) mem.tasked.set(sq.callsign.en, now);
    moves.push(radio(squads.map((sq) => sq.callsign.en), body, "over"));
  };
  const events = wake.items.filter((i) => i.kind === "event").map((i) => i.event);
  const busy = new Set(); // squads given a task in this wake

  // The base under attack: the two nearest squads come home, unless they already are.
  if (events.some((e) => e.kind === "hq_under_attack" || e.kind === "structure_attacked") && hq) {
    const back = land
      .filter((sq) => !(sq.order?.kind === "hold" && sq.order.point === hq.id) && !fresh(sq, 30))
      .sort((a, b) => dist(a, hq) - dist(b, hq))
      .slice(0, 2);
    const home = land.filter((sq) => sq.order?.point === hq.id).length;
    if (back.length && home < 2) {
      task(back, say("opHold", { place: name(hq.id) }));
      back.forEach((sq) => busy.add(sq.callsign.en));
      if (once("defending", 60)) moves.push(radio([agent.commander ?? "Hammer"], say("opDefending", { count: back.length }), "out"));
    }
  }
  // A hauler under attack: the nearest free squad guards its field.
  const hit = events.find((e) => e.kind === "hauler_attacked" || e.kind === "hauler_lost");
  if (hit && moves.length < 3) {
    const field = (rules.map.gushers ?? []).find((g) => g.id === hit.field)?.point ?? hit.point;
    const at = rules.map.points.find((p) => p.id === field);
    const guarded = land.some((sq) => sq.order?.kind === "hold" && sq.order.point === field);
    const guard = at && !guarded && land.filter((sq) => !busy.has(sq.callsign.en) && !fresh(sq, 30) && sq.order?.kind !== "attack").sort((a, b) => dist(a, at) - dist(b, at))[0];
    if (guard) {
      task([guard], say("opHold", { place: name(field) }));
      busy.add(guard.callsign.en);
      if (once(`guard:${field}`, 60)) moves.push(radio([agent.commander ?? "Hammer"], say("opGuarding", { squad: guard.callsign[lang] ?? guard.callsign.en, place: name(field) }), "out"));
    }
  }
  // Points to take: every squad without orders goes to the nearest one nobody of ours is on.
  const taken = new Set(s.squads.map((q) => q.order?.point).filter(Boolean)); // one squad per point
  const idle = s.squads.filter((q) => q.order?.kind === "none" && !fresh(q) && !busy.has(q.callsign.en));
  const waiting = [];
  for (const sq of idle) {
    if (moves.length >= 3) break;
    const u = unitOf(sq);
    if (u.hero || u.captureSeconds) continue; // heroes and engineers wait for a task of their own
    const goal = rules.map.points
      .filter((p) => p.kind !== "hq" && owner(p.id) !== side && !taken.has(p.id) && (u.domain === "air" || (u.domain === "sea") === (p.kind === "seaRig")) && !(u.noCapture && u.domain !== "sea"))
      .sort((a, b) => dist(a, sq) - dist(b, sq))[0];
    if (goal) {
      taken.add(goal.id);
      task([sq], say("opHold", { place: name(goal.id) }));
      busy.add(sq.callsign.en);
    } else if (sq.class !== "naval") waiting.push(sq);
  }
  // Nothing left to take: mass at the point nearest the enemy, and attack once three are there.
  if (moves.length < 3 && enemyHQ && hq) {
    const fieldsWorked = new Set((s.haulers ?? []).filter((h) => h.side === side && h.field).map((h) => (rules.map.gushers ?? []).find((g) => g.id === h.field)?.point));
    const forward = rules.map.points.filter((p) => p.kind !== "seaRig" && p.kind !== "hq" && owner(p.id) === side).sort((a, b) => dist(a, enemyHQ) - dist(b, enemyHQ))[0];
    const spare = land.filter((sq) => !busy.has(sq.callsign.en) && (sq.order?.kind === "none" || (sq.order?.kind === "hold" && !fieldsWorked.has(sq.order.point) && sq.order.point !== hq.id)));
    const unowned = rules.map.points.some((p) => p.kind !== "hq" && p.kind !== "seaRig" && owner(p.id) !== side);
    if (forward && !unowned && spare.length >= 3) {
      const there = spare.filter((sq) => dist(sq, forward) <= 230);
      const coming = spare.filter((sq) => dist(sq, forward) > 230 && !(sq.order?.point === forward.id) && !fresh(sq, 20));
      if (there.length >= 3 && !there.some((sq) => fresh(sq, 20))) {
        task(there, say("opAttack", { place: name(enemyHQ.id) }));
        if (once("attacking", 45)) moves.push(radio([agent.commander ?? "Hammer"], say("opAttacking", { place: name(enemyHQ.id), count: there.length }), "out"));
      } else if (coming.length) {
        task(coming, say("opHold", { place: name(forward.id) }));
        if (once("massing", 90)) moves.push(radio([agent.commander ?? "Hammer"], say("opMassing", { place: name(forward.id) }), "out"));
      }
    } else if (waiting.length && forward) {
      // Fewer than three: the ones without work stand at the forward point.
      const out = waiting.filter((sq) => dist(sq, forward) > 230);
      if (out.length) task(out, say("opHold", { place: name(forward.id) }));
    }
  }
  return moves;
}

// One part of a call: the steps it asks for, or the line that says why not.
// It returns { steps } when understood, { reply } (a radio step) when not, or null when
// the part is nothing at all.
function clause(text, ctx, part, mem) {
  const { wake, rules, agent, call, lang, back } = ctx;
  const say = (key, vars) => phrase(rules, lang, key, vars);
  const negative = (why) => [radio(back, say("negative", { reason: why }), "over")];
  const unclear = (key = "sayAgain", vars = {}) => ({ reply: radio(back, say(key, { ...vars, ...(vars.verb ? { verb: say(vars.verb) } : {}) }), "over") });
  const status = wake.status;
  const units = rules.factions[status?.faction ?? ""]?.units ?? {};
  const structures = rules.factions[status?.faction ?? ""]?.structures ?? {};
  const known = compactStructures(status ?? {}, agent.side);
  const points = part.single ? (call.points ?? []) : pointsIn(text, call.points, rules);
  const marks = part.single ? (call.landmarks ?? []) : [];
  const squads = status?.squads ?? [];

  if (upgradeVerb.test(text)) {
    const squad = squads.find((sq) => text.includes(sq.callsign.en.toLowerCase()) || (sq.callsign.he && text.includes(sq.callsign.he)));
    if (!squad) return unclear("sayAgainWhat", { verb: "verb.upgrade" });
    return { steps: [{ name: "buy", input: { unit: "", upgrade: squad.callsign.en }, orElse: negative }] };
  }
  // "Cancel the tank", "בטל את הטנק": the last one of that kind leaves its line.
  if (cancelVerb.test(text) && !(sellVerb.test(text) && namedStructure(text, known, { enemy: false }))) {
    const unit = /\b(last|that|it)\b|האחרון|האחרונה/.test(text) && !namesAUnit(text, units) ? "" : (wantedUnit(text, units) ?? "");
    return { steps: [{ name: "cancel", input: { unit }, orElse: negative }] };
  }
  // "New squads rally at Delta", "כיתות חדשות מתכנסות בדוד": where new units gather.
  if (rallyVerb.test(text)) {
    const home = /\b(home|beside|at the base|by the door)\b|ליד המבנה|הביתה|בבסיס/.test(text); // not "בבית": "בבית הבוחן" is a place
    // Where: an exact spot, a tech building by its name on the map, a landmark, or a point.
    const tech = known.find((st) => st.site && (text.includes(st.site.toLowerCase()) || (st.siteHe && text.includes(st.siteHe))));
    const place = home ? "home" : (spotOf(part.raw) ?? tech?.id ?? marks[0] ?? points[0]);
    if (!place) return unclear("sayAgainWhere", { verb: "verb.rally" });
    const from = namedStructure(text, known.filter((st) => st.role !== "tech"), { enemy: false });
    return { steps: [{ name: "rally", input: { place, structure: from?.id ?? "" }, orElse: negative }] };
  }
  if (haulerWords.test(text) && !buyVerb.test(text) && !/\bbuild\b|בנה/.test(text) && !/\b(escort|protect|guard|cover)\b|לווה|אבטח|שמור/.test(text)) {
    // "Haulers to the Kilo field", "המשאיות לשדה כרמל", "haulers on their own".
    const auto = /\b(auto|on their own|themselves|choose)\b|לבד|בעצמם|בעצמן/.test(text);
    const field = auto ? "auto" : points[0];
    if (!field) return unclear("sayAgainWhere", { verb: "verb.haul" });
    return { steps: [{ name: "haul", input: { field, hauler: 0 }, orElse: negative }] };
  }
  // Selling or mending one of the side's own structures, named by its name or its role.
  const own = (sellVerb.test(text) || mendVerb.test(text)) && namedStructure(text, known, { enemy: false });
  if (own) return { steps: [{ name: sellVerb.test(text) ? "sell" : "repair", input: { place: own.id }, orElse: negative }] };
  if (sellVerb.test(text)) return unclear("sayAgainWhat", { verb: "verb.sell" });
  // Building: a structure named with a word for building, or a defence or a fence asked
  // for by itself ("a gun at Delta", "fence the north side").
  const wanted = wantedStructure(text, structures);
  const fixed = wanted && ["defence", "fence"].includes(structures[wanted].role);
  const found = scan(tidy(text), lang, leaderWords, rules).found.filter((f) => !f.negated);
  const named = squads.filter((sq) => text.includes(sq.callsign.en.toLowerCase()) || (sq.callsign.he && text.includes(sq.callsign.he)));
  // "Send Viper 2 to Golf" is a move, though it has no word for moving.
  const verb =
    ["attack", "hold", "move"].find((v) => found.some((f) => f.cls === v)) ??
    (found.some((f) => ["cover", "enter"].includes(f.cls)) ? "hold" : found.some((f) => f.cls === "fallBack") || (named.length && sendVerb.test(text)) ? "move" : null);
  if (wanted && (buildVerb.test(text) || part.inherit === "build" || (fixed && !verb))) {
    // An exact spot in the call ("140 metres north and 60 metres east of Alpha") is passed
    // on as it was said; the game reads it. A base structure with no spot takes a point
    // named in the call, or the game's own choice.
    const input = { structure: wanted, place: spotOf(part.raw) ?? (fixed ? placeOf(text, points) : (points[0] ?? "")), place2: "" };
    // "running north to south", "מצפון-מזרח לדרום-מערב": the way a fence is to lie.
    const run = structures[wanted].role === "fence" ? runOf(part.raw) : "";
    if (run) input.run = run;
    return { steps: [{ name: "build", input, orElse: negative }], did: "build" };
  }
  if (buyVerb.test(text) || /\bbuild\b|בנה/.test(text) || part.inherit === "buy") {
    const unit = heroUnit(text, units, rules) ?? unitIn(text, units, false);
    if (!unit) return unclear("sayAgainWhat", { verb: buildVerb.test(text) && !buyVerb.test(text) ? "verb.build" : "verb.buy" });
    const count = units[unit].hero ? 1 : countIn(text, rules);
    return { steps: Array.from({ length: count }, () => ({ name: "buy", input: { unit, upgrade: "" }, orElse: negative })), did: "buy" };
  }
  if (statusWords.test(text) && !verb && status) {
    const held = status.points.filter((p) => p.owner === agent.side).map((p) => p.id);
    const body = say("opStatus", { squads: squads.length, gold: status.gold, points: held.join(" ") }) + (status.power?.low ? say("opStatusLowPower") : "");
    return { reply: radio(back, body, "over"), answered: true };
  }
  // "Everyone dig in": passed on to the infantry that can.
  if (found.some((f) => f.cls === "dig")) {
    const fit = squads.filter((s) => canDig(unitAnywhere(rules, s.unit))).map((s) => s.callsign.en);
    if (fit.length) return { steps: [radio(fit, part.raw, "over")] };
  }
  const fighters = squads.filter((sq) => {
    const u = units[sq.unit] ?? unitAnywhere(rules, sq.unit) ?? {};
    return !u.captureSeconds && !u.hero;
  });
  const ownHQ = rules.map.points.find((p) => p.kind === "hq" && p.owner === agent.side);
  const enemyHQ = rules.map.points.find((p) => p.kind === "hq" && p.owner !== agent.side);
  // "Defend the base": the nearer half of the land squads come home and hold it.
  if (defendBase.test(text) && ownHQ) {
    const landed = fighters.filter((sq) => sq.class !== "naval").sort((a, b) => dist(a, ownHQ) - dist(b, ownHQ));
    const fit = landed.slice(0, Math.ceil(landed.length / 2)).map((sq) => sq.callsign.en);
    if (!fit.length) return { reply: negative(say("why.noSquads"))[0] };
    return { steps: [radio(fit, say("opHold", { place: pointName(rules, ownHQ.id, lang) }), "over")] };
  }
  // "Attack with everything": every fighting squad that can reach the place goes.
  if (verb === "attack" && everything.test(text)) {
    const goal = rules.map.points.find((p) => p.id === points[0]) ?? enemyHQ;
    const sea = goal.kind === "seaRig";
    const fit = fighters.filter((sq) => sq.class === "air" || (sq.class === "naval") === sea).map((sq) => sq.callsign.en);
    if (!fit.length) return { reply: negative(say("why.noSquads"))[0] };
    return { steps: [radio(fit, say("opAttack", { place: pointName(rules, goal.id, lang) }), "over")] };
  }
  const point = rules.map.points.find((p) => p.id === points[0]);
  if (verb && (point || marks.length === 1)) {
    // A task for squads Hammer named goes to them, in the operator's own words; one for
    // nobody in particular goes, as Hammer said it, to every squad that can reach the place.
    const place = point ? pointName(rules, point.id, lang) : ([...(rules.map.landmarks ?? []), ...(rules.map.bridges ?? [])].find((l) => l.id === marks[0])?.name[lang] ?? marks[0]);
    if (named.length) return { steps: [radio(named.map((sq) => sq.callsign.en), say({ attack: "opAttack", hold: "opHold", move: "opMove" }[verb], { place }), "over")] };
    const sea = point?.kind === "seaRig";
    const fit = squads.filter((s) => (s.class === "naval") === sea).map((s) => s.callsign.en);
    if (fit.length === 0) return { reply: negative(say("why.noSquad"))[0] };
    return { steps: [radio(fit, part.raw, "over")] };
  }
  if (point && !verb) return unclear("sayAgainVerb", { place: pointName(rules, point.id, lang) });
  if (verb && !["cover"].includes(verb)) return unclear("sayAgainWhere", { verb: `verb.${verb}` });
  return null;
}

export function operatorPlan(ctx, mem) {
  const { wake, rules, agent } = ctx;
  const call = wake.call;
  const level = operatorLevel(agent);
  // A hauler in trouble, like the rest of the base's news, is told to the commander by the
  // server's own base cues (server/room/cues.go); the operator does not say it again.
  if (!call || call.from.key !== "player") return ownMoves(ctx, mem); // otherwise Anvil answers to Hammer only
  const lang = call.lang === "he" ? "he" : "en";
  const back = [call.from.en];
  const text = call.body.toLowerCase();
  const say = (key, vars) => phrase(rules, lang, key, vars);
  const wilco = () => radio(back, say("wilco"), "out");
  if (call.prowords?.includes("radioCheck")) return [radio(back, say("fiveByFive"), "out")];
  // Handing over the fight, or taking command back: the net has already switched the mode
  // on the fixed words, so the operator only acknowledges, and gets to work if it is its fight.
  const says = (kind) => [...rules.radio.command[kind].en, ...rules.radio.command[kind].he].some((p) => text.includes(p.toLowerCase()));
  const fixed = says("take") || says("give") || says("grant") || says("revoke");
  if (fixed) {
    // Told to do more than its level lets it, the operator says so instead of sitting silent.
    if ((says("give") || says("grant")) && !says("take") && level < 2) return [radio(back, say("negative", { reason: say("why.ordersOnly") }), "over")];
    if (says("give") && !says("take") && level < 3) return [radio(back, say("negative", { reason: say("why.economyOnly") }), "over"), ...ownMoves(ctx, mem)];
    return [wilco(), ...ownMoves(ctx, mem)];
  }
  // The same in words of Hammer's own: the operator sets it with the command tool.
  if (loose.take.test(text)) return [{ name: "command", input: { mode: "orders", buy: false }, orElse: (why) => [radio(back, say("negative", { reason: why }), "over")] }, wilco()];
  if (loose.give.test(text)) {
    if (level < 3) return [radio(back, say("negative", { reason: say(level < 2 ? "why.ordersOnly" : "why.economyOnly") }), "over")];
    return [{ name: "command", input: { mode: "fight", buy: true }, orElse: (why) => [radio(back, say("negative", { reason: why }), "over")] }, wilco()];
  }

  // Several orders in one call: "build a refinery, then a barracks", "buy a tank and a helicopter".
  const parts = [];
  for (const piece of call.body.split(then).filter((p) => p && p.trim())) {
    const halves = piece.split(and);
    // "and" joins two orders only when what follows could stand as one; otherwise it is
    // part of a name or a spot ("140 metres north and 60 metres east of Alpha").
    if (halves.length > 1 && !spotOf(piece) && !rallyVerb.test(piece.toLowerCase())) parts.push(...halves);
    else parts.push(piece);
  }
  const single = parts.length <= 1;
  const cctx = { ...ctx, call, lang, back };
  const steps = [];
  let reply = null;
  let inherit = null;
  let understood = 0;
  for (const raw of single ? [call.body] : parts) {
    const got = clause(raw.toLowerCase(), cctx, { raw, single, inherit }, mem);
    if (got?.steps) {
      steps.push(...got.steps);
      understood++;
      inherit = got.did ?? null;
    } else if (got?.reply && !reply) reply = got.reply;
  }
  // The parts were read one by one and none stood alone: read the call whole.
  if (!single && understood === 0) {
    const whole = clause(text, cctx, { raw: call.body, single: true, inherit: null }, mem);
    if (whole?.steps) return [...whole.steps, wilco()];
    return [whole?.reply ?? reply ?? radio(back, say("sayAgain"), "over")];
  }
  if (understood === 0) return [reply ?? radio(back, say("sayAgain"), "over")];
  // What was understood is done; a part that was not is asked about instead of the Wilco.
  return [...steps, reply ?? wilco()];
}
