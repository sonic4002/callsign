// What the agents know about bases: the words for the prompts, the structures in a
// status, and how the scripted brain reads a call about building or about a structure.
// It runs in Node and in a Web Worker alike, like the rest of the agent core.

const names = (ids, table) => ids.map((id) => table[id]?.name.en ?? id).join(", ");

// structureLines lists a faction's structures for the operator's prompt.
export function structureLines(rules, faction) {
  const f = rules.factions[faction];
  const ofRole = (role) => Object.values(f.structures).find((s) => s.role === role)?.name.en ?? role;
  return Object.entries(f.structures)
    .filter(([, s]) => s.role !== "hq")
    .map(([id, s]) => {
      const facts = [`${s.cost} gold`, `${s.buildSeconds} s to build`];
      if (s.requires.length) facts.push(`needs a ${s.requires.map(ofRole).join(" and a ")}`);
      if (s.unlocks.length) facts.push(`lets you buy ${names(s.unlocks, f.units)}`);
      if (s.role === "refinery") facts.push("where haulers unload gold");
      if (s.role === "defence") {
        const only = s.vs && Object.values(s.vs).filter((v) => v === 0).length >= 3;
        facts.push(only ? `fires on aircraft only, out to ${s.range}` : `fires on its own at enemies within ${s.range}`);
      }
      if (s.role === "fence") facts.push(`a run of ${s.segments} segments that stops enemy ground units until it is shot down`);
      return `- ${id}: ${s.name.en} (${s.name.he}), ${facts.join("; ")}`;
    })
    .join("\n");
}

// operatorBases is the operator's paragraph on bases.
export function operatorBases(rules, faction) {
  const m = rules.match;
  return `Your base. Structures decide what you can buy: a unit whose structure does not stand is refused, and the refusal names what to build. Build with the build tool. Structures you can build:
${structureLines(rules, faction)}
Base structures (everything that is not a defence or a fence) stand in fixed places around your headquarters, one of each, and one goes up at a time; gold is taken when work begins and a structure does nothing until it stands. A defence or a fence takes a \`place\`: a point you hold, a structure of yours by id, or a side of your base ("base:north", "base:south", "base:east", "base:west", "base:front" toward the enemy, "base:rear"); it must be within ${m.buildRadius} of your headquarters, a structure of yours or a point you hold. You may hold ${m.defenceCap} defences and ${m.fenceRuns} fence runs, and one defence or fence goes up at a time beside the base structure. A fence run can also go between two places: give \`place\` and \`place2\`.
Your status lists structures: yours with their health and whether they are still going up, and the enemy's as your side last saw them. An enemy structure can be attacked by any squad that can hurt it (tell the squad its id, for example "attack s7, the enemy works") and taken over by an engineer squad. Losing a structure takes away what it lets you buy until you rebuild it; squads already in the field stay. Tell Hammer when a structure of yours is lost or taken.
Build when Hammer asks, and confirm what you started and its cost. If the build is refused, tell Hammer why.`;
}

// leaderBases is a squad leader's paragraph on structures.
export function leaderBases(unit) {
  const engineer = unit.captureSeconds > 0;
  return `Structures. Your status lists the structures your side knows of, each with an id such as "s7": your own, and the enemy's as last seen. To attack an enemy structure give its id as the attack point. Enemy defences fire on their own at whatever comes in range; enemy fences stop your squad until it shoots a gap in them.${
    engineer
      ? ` Your squad are engineers: it fights poorly and exists for two jobs. capture takes over an enemy base structure: the squad walks to it, and after ${unit.captureSeconds} seconds beside it without being shot at the structure is your side's and your squad stays inside to run it, which is the end of the squad. Headquarters, defences and fences cannot be taken. repair mends a broken bridge. Ask for an escort before you go; under fire the takeover stops.`
      : ""
  }`;
}

// compactStructures trims the structures in a status to what a decision needs.
export function compactStructures(status, side) {
  return (status.structures ?? [])
    .filter((s) => !s.ruin && s.role !== "fence")
    .map((s) => ({
      id: s.id,
      name: s.name ?? s.kind,
      role: s.role,
      whose: (s.yours ?? s.side === side) ? "yours" : "enemy",
      near: s.near,
      x: s.x,
      y: s.y,
      health: s.hp,
      ...((s.building === true || (typeof s.building === "number" && s.building < 1)) && { building: true }),
    }));
}

// ---- the scripted brain ----

// Plain words for each role, in both languages, beside the structures' own names.
const roleWords = {
  barracks: /\b(barracks|safehouse)\b|מגורי|קסרקטין|מסתור/,
  refinery: /\b(refinery|smelter)\b|זיקוק|מתכה/,
  works: /\b(works|factory|workshop)\b|מפעל|סדנ|מוסך/,
  airbase: /\b(airbase|air base|airfield|airport|airstrip|launch yard)\b|בסיס אוויר|בסיס האוויר|שדה תעופה|מנחת|שיגור/,
  dockyard: /\b(dock|docks|dockyard|shipyard|harbou?r|boat shed)\b|מספנ|נמל|מזח|סככ/,
  fence: /\b(fence|wall|wire|barrier)\b|גדר|חומ/,
};
const antiAir = /\b(anti[- ]?air(craft)?|flak|aa|rocket nest)\b|נ"מ|נ״מ|נגד מטוסים|קן טילים/;
const defence = /\b(gun|guns|turret|sentry|nest|defen[cs]e|tower)\b|תותח|מקלע|עמדה|עמדת|מגדל/;

export const buildVerb = /\b(build|construct|erect|put up|set up|place|fortify)\b|בנה|בנו|הקם|הקימו|הצב|בצר/;

const has = (text, name) => name && text.includes(name.toLowerCase());

// wantedStructure reads which structure a call names: by its own name first, then by a
// plain word for its role. The anti-aircraft defence is the one whose weapon cannot hit
// ground targets.
export function wantedStructure(text, structures) {
  const low = text.toLowerCase();
  const entries = Object.entries(structures).filter(([, s]) => s.role !== "hq");
  const named = entries.filter(([, s]) => has(low, s.name.en) || has(low, s.name.he)).sort((a, b) => b[1].name.en.length - a[1].name.en.length)[0];
  if (named) return named[0];
  const isAA = ([, s]) => s.role === "defence" && s.vs?.infantry === 0;
  if (antiAir.test(low)) return entries.find(isAA)?.[0];
  for (const [role, re] of Object.entries(roleWords)) {
    if (re.test(low)) return entries.find(([, s]) => s.role === role)?.[0];
  }
  if (defence.test(low)) return entries.find((e) => e[1].role === "defence" && !isAA(e))?.[0];
  return undefined;
}

const sides = [
  ["north", /\bnorth(ern)?\b|צפון/],
  ["south", /\bsouth(ern)?\b|דרום/],
  ["east", /\beast(ern)?\b|מזרח/],
  ["west", /\bwest(ern)?\b|מערב/],
  ["front", /\bfront\b|חזית|קדמי/],
  ["rear", /\b(rear|back|behind)\b|עורף|אחורי|מאחור/],
];

// placeOf reads where a defence or a fence should go: a named point, or a side of the base.
export function placeOf(text, points) {
  if (points?.length) return points[0];
  const side = sides.find(([, re]) => re.test(text.toLowerCase()))?.[0];
  return side ? `base:${side}` : "";
}

// namedStructure finds, among the structures in a status, the enemy (or own) one a call
// names by its name or by a word for its role. Of several, the first in the status.
export function namedStructure(text, structures, { enemy }) {
  const low = text.toLowerCase();
  return (structures ?? []).find((s) => {
    if ((s.whose === "enemy") !== enemy) return false;
    if (has(low, s.name) || low.includes(s.id)) return true;
    if (s.role === "defence") return defence.test(low) || antiAir.test(low);
    return roleWords[s.role]?.test(low) ?? false;
  });
}

export const captureVerb = /\b(capture|take over|seize|occupy)\b|השתלט|השתלטו|כבוש את|כבשו את|תפוס את|תפסו את/;
