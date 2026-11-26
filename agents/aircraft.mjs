// What the agents know about strike aircraft (server/sim/sortie.go): the words for the
// prompts, what their events mean, and how the rule brain reads and gives their orders.
// A strike squad stands at its airbase, flies out to drop its whole load in one pass,
// and must fly home to be rearmed; it holds no ground and waits nowhere.
// It runs in Node and in a Web Worker alike, like the rest of the agent core.

import { compactStructures } from "./bases.mjs";

export const isStrike = (u) => (u?.bombs ?? 0) > 0;

const callsign = (rules, u) => rules.callsigns.classes[u.callsign ?? u.class];
const load = (u) => u.bombs * u.teams * u.members;

// strikeFacts says in words what a strike aircraft's numbers mean.
export function strikeFacts(u) {
  return `a strike aircraft: ${u.teams} planes that stand at the airbase and fly sorties from it; one pass drops ${load(u)} bombs on what it is sent at (blast ${u.blastRadius}), then it must fly home and rearm for ${u.rearmSeconds} seconds; it cannot hold, wait or capture anywhere, cannot hit aircraft, and is lost when its side has no airbase left`;
}

// leaderStrike is a strike squad leader's paragraph on what its squad is.
export function leaderStrike(unit) {
  if (!isStrike(unit)) return "";
  return `Your squad is strike aircraft, not a squad that stands anywhere. It waits at its airbase, armed. Your orders:
- attack with a place, an enemy structure's id, a bridge, a building or a contact id: the planes fly straight there over everything, drop all their bombs in one pass (everything of the enemy's within ${unit.blastRadius} of where they fall is hit, less toward the edge; aircraft are never hit), fly home and are rearmed for ${unit.rearmSeconds} seconds. A structure, a bridge, a building, an enemy squad that stays in sight and the enemy headquarters are flown at again and again until they are gone; open ground gets one pass. An attack ordered while you are being rearmed is flown as soon as you are armed.
- move with a place: a flight over it and straight home with nothing dropped, to see what is there. Your side cannot name an enemy structure it has never seen, so look first.
- hold with the place "here", or move to your own headquarters: break off and return to base. That is also what "return to base", "abort" and "fall back" mean for you.
Holding or guarding a place, capturing, digging in and repairing are refused: answer Negative and say that aircraft cannot hold ground. Your status shows \`sortie\`: state (parked, out, back, rearming), the bombs on each plane, and your airbase. You are woken when your bombs have fallen (report it in one line), when a flight to look has passed over its place (report what you saw), and when you are armed again (say so only if an order is waiting). Anti-aircraft defences and most infantry shoot at you on the way in and out: a defended target costs planes. If your side's last airbase is lost while you are on the ground you are lost with it; in the air you finish the pass and have nowhere to land.`;
}

// strikeLines is what the operator is told about its own strike aircraft and the enemy's.
export function strikeLines(rules, faction) {
  const mine = Object.entries(rules.factions[faction]?.units ?? {}).find(([, u]) => isStrike(u));
  if (!mine) return "";
  const [id, u] = mine;
  const cs = callsign(rules, u);
  const flak = Object.values(rules.factions[faction]?.structures ?? {}).find((s) => s.role === "defence" && s.vs?.infantry === 0);
  return `Strike aircraft. Your ${u.name.en} (${u.name.he}), unit id "${id}", ${u.cost} gold, answers to ${cs.en} (${cs.he}) with a number. It is not a squad to station anywhere: it stands at the airbase and you send it at a target ("${cs.en} 1, attack s7", "attack Target 3", "attack the east bridge"); it drops its load in one pass, flies home and needs ${u.rearmSeconds} seconds before the next. Never tell it to hold, guard or capture: it refuses. Tell it to move to a place for a look at it from the air (your side cannot order an attack on a structure it has never seen), and to return to base to call it off. Buy one when the airbase stands and the ground squads are in hand: it is for what they cannot reach or should not walk into, such as a defence, a power structure behind the lines, siege weapons, haulers, a bridge the enemy needs. It is wasted on infantry in buildings and it loses planes over anti-aircraft fire, so strike defences that cannot shoot up first. Keep an airbase standing: with none, the planes on the ground are lost with it. The enemy has the same kind of aircraft; ${flak ? `a ${flak.name.en} by what you want to keep shoots them down` : "anti-aircraft defences shoot them down"}, and their airbase is worth destroying.`;
}

// describeStrikeEvent is what one of the strike events means to an agent, or null when
// the event is none of them.
export function describeStrikeEvent(e, who) {
  switch (e.kind) {
    case "strike":
      return `Your bombs have fallen on ${e.structure ? `the ${e.unit} (${e.structure})` : e.contact ? `Target ${e.contact}` : (e.place ?? e.point)} near ${e.point} (${e.count} dropped). You are flying home to rearm${e.structure || e.contact ? ", and will fly at it again while it stands unless told otherwise" : ""}.`;
    case "overhead":
      return `Your flight has passed over ${e.place ?? e.point}${e.count ? ` with ${e.count} enemy squads in sight` : " and saw no enemy"}; you are flying home with your bombs still on.`;
    case "rearmed":
      return "Your planes are armed again at the airbase.";
    case "squad_lost":
      return e.reason === "no_airbase" ? `${who} was lost: its side had no airbase left for it to land at.` : null;
  }
  return null;
}

// The events that wake a strike squad's own leader.
export const strikeLeaderEvents = ["strike", "overhead", "rearmed"];

// ---- the rule brain ----

// Words that ask for an aircraft by what it is, when the call does not name the unit.
export const strikeWords = /\b(air ?planes?|aeroplanes?|planes?|jets?|bombers?|strike aircraft)\b|מטוס|מטוסי|מפציץ|מפציצים/;

// strikeUnit is the strike aircraft among a faction's units, as [id, unit], or undefined.
export const strikeUnit = (units) => Object.entries(units ?? {}).find(([, u]) => isStrike(u));

// strikeIntent turns what the grammar understood into what a strike squad can do with
// it: holding its own base, falling back and stopping are the way home; holding anywhere
// else, and the work of ground squads, is refused in words; an aircraft is no target.
// `make` is the grammar's table of intents.
export function strikeIntent(intent, { rules, agent, status, make }) {
  const home = rules.map.points.find((p) => p.kind === "hq" && p.owner === agent.side)?.id;
  const back = () => ({ ...make.hold("here", "return"), kind: "return" });
  const place = intent.tool?.input?.place;
  const base = compactStructures(status ?? {}, agent.side).some((s) => s.id === place && s.role === "airbase" && s.whose === "yours");
  switch (intent.kind) {
    case "hold":
      return place === "here" || place === home || base ? back() : make.negative("noLoiter");
    case "move":
      return intent.back || intent.leave || place === home || base ? back() : intent;
    case "repair":
      return make.negative("onlyEngineersMend");
    case "attack": {
      const target = intent.contact && (status?.contacts ?? []).find((c) => c.id === intent.contact);
      if (!target || target.class !== "air") return intent;
      // "Attack" with no target named chose the nearest enemy: an aircraft is not one for bombs.
      if (!intent.any) return make.negative("cannotHurt", { target: intent.contact });
      const prey = (status?.contacts ?? []).filter((c) => c.class !== "air").sort((a, b) => a.id - b.id)[0];
      const enemy = rules.map.points.find((p) => p.kind === "hq" && p.owner !== agent.side)?.id;
      return prey ? make.attackContact(prey.id, { any: true, label: "attack:any" }) : { ...make.attack(enemy), label: "attack:any", any: true };
    }
  }
  return intent;
}

// strikeAck is the line a strike squad answers an order with, or undefined for a plain Wilco.
export function strikeAck(intent, say, status) {
  const place = intent.contact || intent.tool?.input?.place;
  const named = typeof place === "number" || (typeof place === "string" && place.length <= 24 && !/\s/.test(place));
  if (intent.kind === "return") return say("ackReturn");
  if (!named) return undefined; // a spot given in words: the game reads it, and Wilco is enough
  if (intent.kind === "move") return say("ackOverfly", { place });
  if (intent.kind !== "attack") return undefined;
  const a = status?.you?.sortie;
  return say(a && (a.state === "rearming" || a.bombs === 0) ? "ackStrikeLater" : "ackStrike", { place });
}

// strikeDoing is the "what we are doing" of a strike squad's report, or undefined when
// the usual words fit (flying at a target is "attacking X").
export function strikeDoing(you, say) {
  const a = you?.sortie;
  if (!a) return undefined;
  if (a.state === "rearming") return say("doing.rearming");
  if (a.state === "parked") return say("doing.parked");
  if (a.state === "back") return say("doing.return");
  return undefined;
}

// strikeEventLines are the lines a strike leader says of its own events.
export function strikeEventLines(e, say, where, status) {
  const what = e.contact || e.structure || e.place || e.point;
  const seen = (status?.you?.contacts ?? []).length;
  return {
    strike: () => say("struck", { place: e.structure ? e.structure : e.contact ? e.contact : where }, true),
    overhead: () => say("overhead", { place: what === e.point ? where : (e.place ?? where), seen: seen ? say("seen.some", { count: seen, target: status.you.contacts[0] }) : say("seen.none") }),
    rearmed: () => say("rearmed"),
  };
}

// strikeTasks is the level-3 operator's use of its strike squads while it runs the
// fight: one that stands armed with no order is sent at the enemy squad nearest the
// base that bombs can hurt, else at an enemy defence or power structure its side has
// seen, else at any other structure of the enemy's. It returns { squad, contact } and
// { squad, structure } tasks; the operator puts them into words.
export function strikeTasks({ status, rules, side, squads, structures, dist }) {
  const hq = rules.map.points.find((p) => p.kind === "hq" && p.owner === side);
  const out = [];
  const taken = new Set((status.squads ?? []).map((q) => q.order?.place || q.order?.contact).filter(Boolean));
  const prey = (status.contacts ?? []).filter((c) => c.class !== "air" && !c.parked && hq && dist(c, hq) <= 700).sort((a, b) => dist(a, hq) - dist(b, hq) || a.id - b.id);
  const worth = { defence: 0, power: 1, airbase: 2, refinery: 3 };
  const marks = structures.filter((st) => st.whose === "enemy" && !st.building).sort((a, b) => (worth[a.role] ?? 9) - (worth[b.role] ?? 9) || a.id.localeCompare(b.id));
  for (const sq of squads) {
    if (sq.sortie?.state !== "parked" || sq.order?.kind !== "none") continue;
    const c = prey.find((t) => !taken.has(t.id));
    const st = marks.find((t) => !taken.has(t.id));
    if (c) {
      taken.add(c.id);
      out.push({ squad: sq, contact: c.id });
    } else if (st) {
      taken.add(st.id);
      out.push({ squad: sq, structure: st });
    }
  }
  return out;
}
