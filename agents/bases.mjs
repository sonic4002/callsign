// What the agents know about bases: the words for the prompts, the structures in a
// status, and how the scripted brain reads a call about building or about a structure.
// It runs in Node and in a Web Worker alike, like the rest of the agent core.

import { leaderMend, leaderSiege, powerFact, powerWords, radarWords } from "./power.mjs";

const names = (ids, table) => ids.map((id) => table[id]?.name.en ?? id).join(", ");

// structureLines lists a faction's structures for the operator's prompt (prompts.mjs).
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
      if (powerFact(s)) facts.push(powerFact(s));
      if (s.role === "fence") facts.push(`a run of ${s.segments} segments that stops enemy ground units until it is shot down`);
      return `- ${id}: ${s.name.en} (${s.name.he}), ${facts.join("; ")}`;
    })
    .join("\n");
}

// leaderBases is a squad leader's paragraph on structures.
export function leaderBases(unit) {
  const engineer = unit.captureSeconds > 0;
  return `Structures. Your status lists the structures your side knows of, each with an id such as "s7": your own, and the enemy's as last seen. To attack an enemy structure give its id as the attack point. Enemy defences fire on their own at whatever comes in range; enemy fences stop your squad until it shoots a gap in them.${
    engineer
      ? ` Your squad are engineers: it fights poorly and exists for two jobs. capture takes over an enemy base structure: the squad walks to it, and after ${unit.captureSeconds} seconds beside it without being shot at the structure is your side's and your squad stays inside to run it, which is the end of the squad. Headquarters, defences and fences cannot be taken. repair mends a broken bridge.${leaderMend(unit)} Ask for an escort before you go; under fire the takeover stops.`
      : ""
  }${leaderSiege(unit)}`;
}

// compactStructures trims the structures in a status to what a decision needs.
export function compactStructures(status, side) {
  return (status.structures ?? [])
    .filter((s) => !s.ruin && s.role !== "fence")
    .map((s) => ({
      id: s.id,
      name: s.name ?? s.kind,
      role: s.role,
      // A tech building belongs to no army until engineers take it: "nobody".
      whose: s.holder ?? (s.side === -1 ? "nobody" : (s.yours ?? s.side === side) ? "yours" : "enemy"),
      ...(s.gives && { gives: s.gives }),
      ...(s.site && { site: s.site, siteHe: s.siteHe }),
      near: s.near,
      x: s.x,
      y: s.y,
      health: s.hp,
      ...((s.building === true || (typeof s.building === "number" && s.building < 1)) && { building: true }),
      ...(s.repairing && { repairing: true }),
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
  power: powerWords,
  radar: radarWords,
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

// Plain words for each kind of tech building, in both languages.
export const techWords = {
  tech_goldworks: /\b(assay office|assay|gold ?works|mint)\b|הבוחן|בית בוחן|מטבעה/i,
  tech_clinic: /\b(field clinic|clinic|hospital|aid station)\b|מרפא|בית החולים/i,
  tech_garage: /\b(service yard|garage|repair yard)\b|מוסך השדה|מוסך שדה|המוסך/i,
};

// namedStructure finds, among the structures in a status, the enemy (or own) one a call
// names by its name or by a word for its role. Of several, the first in the status.
export function namedStructure(text, structures, { enemy }) {
  const low = text.toLowerCase();
  // "Not ours" is the enemy's and nobody's alike: a tech building nobody holds is taken
  // the way an enemy structure is. A tech building named by its own word comes first,
  // so that "the service yard" is not read as the enemy's works.
  const theirs = (s) => (s.whose !== "yours") === enemy;
  // Called by its id ("the Barracks s9"), it is that one and no other of its kind.
  const byId = (structures ?? []).find((s) => theirs(s) && new RegExp(`(^|[^a-z0-9])${s.id}([^a-z0-9]|$)`).test(low));
  if (byId) return byId;
  // Called by its own name on the map, it is that one and no other of its kind.
  const site = (structures ?? []).find((s) => theirs(s) && s.site && (low.includes(s.site.toLowerCase()) || (s.siteHe && low.includes(s.siteHe))));
  if (site) return site;
  const tech = (structures ?? []).find((s) => theirs(s) && s.role === "tech" && (has(low, s.name) || techWords[s.kind ?? s.name]?.test(low) || Object.values(techWords).some((re) => re.test(s.name) && re.test(low))));
  if (tech) return tech;
  return (structures ?? []).find((s) => {
    if (!theirs(s) || s.role === "tech") return false;
    if (has(low, s.name) || low.includes(s.id)) return true;
    if (s.role === "defence") return defence.test(low) || antiAir.test(low);
    return roleWords[s.role]?.test(low) ?? false;
  });
}

export const captureVerb = /\b(capture|take over|seize|occupy)\b|השתלט|השתלטו|כבוש את|כבשו את|תפוס את|תפסו את/;
