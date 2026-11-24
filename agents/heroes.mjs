// What the agents know about heroes, digging in, crushing and earned ranks: the words for
// the prompts, what the new events mean, and how the scripted brain reads the orders.
// It runs in Node and in a Web Worker alike, like the rest of the agent core.

// unitAnywhere finds a unit by id in whichever army has it: a side may hold a squad that
// is not of its own design (a vehicle its hero has seized).
export const unitAnywhere = (rules, id) => Object.values(rules.factions).map((f) => f.units[id]).find(Boolean);

const heroOf = (rules, faction) => Object.entries(rules.factions[faction]?.units ?? {}).find(([, u]) => u.hero);
const canDig = (u) => u?.class === "infantry" && u.domain === "land" && !u.hero;
const callsign = (rules, u) => rules.callsigns.classes[u.callsign ?? u.class];

// heroFacts says in words what a hero's numbers mean.
export function heroFacts(u) {
  const facts = ["a hero: one soldier with a leader of its own, and only one may be alive at a time"];
  if (u.stealth) facts.push(`seen only from within ${u.stealth} until it fires, though an enemy defence sees it at its range`);
  if (u.chargeDamage) facts.push(`outranges infantry (${u.range}) and carries ${u.charges} demolition charges for an enemy structure, a bridge or the enemy headquarters`);
  if (u.disguise) facts.push(`passes for a bystander: enemy squads do not shoot it from beyond ${u.disguise} unless it fires, though defences do`);
  if (u.seizeRadius) facts.push(`takes over one enemy vehicle squad for as long as it lives and stays within ${u.seizeRadius} of it`);
  if (u.dread) facts.push(`shakes the nerve of enemy fireteams within ${u.dreadRadius}`);
  return facts.join("; ");
}

// leaderHeroes is a squad leader's paragraph on what this workstream gave its squad.
export function leaderHeroes(unit, rules, { seized = false } = {}) {
  const m = rules.match;
  const out = [];
  if (seized) {
    out.push("Your squad was taken from the enemy by your side's hero. It is yours for as long as the hero lives and stays near it; when the hero falls or goes too far it goes back to the enemy, and you are off the net.");
  }
  if (unit.chargeDamage) {
    out.push(
      `You are a hero: one soldier, not a squad. Nobody sees you from beyond ${unit.stealth} until you fire, except an enemy defence, which sees you at its range; a shot gives you away for a few seconds. Your rifle outranges infantry (${unit.range}). The plant tool sets a demolition charge: you walk to an enemy structure, a bridge, or the enemy headquarters, work beside it for ${unit.plantSeconds} seconds, and ${unit.fuseSeconds} seconds later it goes off. One charge wrecks most structures and brings down a bridge; a headquarters takes only a share. You carry ${unit.charges}, and your status shows how many are left. Stay away from groups: you die like any one soldier.`,
    );
  }
  if (unit.seizeRadius) {
    out.push(
      `You are a hero: one soldier, not a squad. You pass for a bystander: enemy squads do not shoot you from beyond ${unit.disguise} unless you fire, though their defences do, so move rather than hold when you are near them. The seize tool takes over an enemy vehicle squad in sight: you close to within ${unit.seizeRadius / 2} of it, and after ${unit.seizeSeconds} seconds it is your side's, with a leader of its own on your net, for as long as you live and stay within ${unit.seizeRadius} of it. You hold one at a time. Enemy fireteams within ${unit.dreadRadius} of you lose their nerve. You die like any one soldier.`,
    );
  }
  if (canDig(unit)) {
    out.push(
      `Digging in. The fortify tool builds a sandbag position where your squad stands, after about ${m.fortifySeconds} seconds in which it does not move and is not shot at; "dig in" ("התבצרו") is the order for it. The position faces the nearest enemy in sight, or else the nearest point your side does not hold, and covers your men from that front only: an enemy on the flank or behind shoots as if it were not there. Heavy weapons knock it down and a vehicle driving over it flattens it. Your squad may build ${m.sandbagLimit}. A position has a name and an id like any landmark, and your status lists it.`,
    );
    out.push("Tanks. An enemy tank that drives through your men in the open runs them down. Inside a building, behind standing sandbags or in a grove they are safe.");
  }
  if (unit.crushes) {
    out.push("Your vehicle runs down enemy infantry it drives through in the open, a man each pass; they are safe inside a building, behind standing sandbags or in a grove, and steady fireteams step out of the way. Driving over a sandbag position flattens it. A move order through them does it; an attack order stops to shoot.");
  }
  if (rules.ranks?.length) {
    out.push(
      `Ranks. A squad earns a rank by what it destroys: ${rules.ranks.map((r) => `${r.name.en} at ${r.kills} times its own cost`).join(", ")}. A ranked squad shoots straighter and keeps its nerve longer, and the top rank mends its wounds out of combat. This is apart from the brain tier, which is bought. Your status shows your rank.`,
    );
  }
  return out.join("\n\n");
}

// heroLines is what the operator is told about its own hero, in the part on production.
export function heroLines(rules, faction) {
  const mine = heroOf(rules, faction);
  if (!mine) return "";
  const [id, u] = mine;
  const cs = callsign(rules, u);
  const structure = (role) => Object.values(rules.factions[faction].structures ?? {}).find((s) => s.role === role)?.name.en ?? role;
  return `Your hero. ${u.name.en} (${u.name.he}), unit id "${id}", ${u.cost} gold, needs a ${structure(u.requires)}${(u.needs ?? []).map((role) => `, a ${structure(role)}`).join("")} and takes ${u.deploySeconds} seconds to arrive. It is ${heroFacts(u)}. Its callsign is ${cs.en} (${cs.he}) with a number, and it starts one brain tier up. A second one is refused while the first lives. A hero is costly and fragile: send it with a task, not into a firefight.`;
}

// fightLines is what the operator is told about the enemy's hero, digging in, armour
// against infantry, and ranks, in the part on the fight.
export function fightLines(rules, faction) {
  const m = rules.match;
  const out = [];
  for (const [, u] of Object.keys(rules.factions).filter((f) => f !== faction).map((f) => heroOf(rules, f)).filter(Boolean)) {
    out.push(
      `The enemy's hero is the ${u.name.en} (${u.name.he}): ${heroFacts(u)}.${u.stealth ? " A defence by what you want to keep finds it." : ""}${u.seizeRadius ? " A squad it has seized comes back when it dies or is driven off, so kill the hero rather than the vehicle; your status counts squads it holds as `taken`." : ""}`,
    );
  }
  out.push(
    `Digging in. An infantry squad told to dig in ("התבצרו") builds a sandbag position in about ${m.fortifySeconds} seconds that covers it from the front only; each squad may build ${m.sandbagLimit}. Tanks run down infantry in the open and flatten sandbags they drive over, so dig infantry in where armour cannot simply drive through, or keep an anti-armour squad by them.`,
  );
  if (rules.ranks?.length) {
    out.push(`Ranks. Squads earn ${rules.ranks.map((r) => r.name.en).join(" and then ")} by what they destroy; your status shows each squad's rank. A ranked squad is worth keeping alive, and its rank stays when you upgrade its brain.`);
  }
  return out.join("\n");
}

// describeHeroEvent is what one of the new events means to an agent, or null when the
// event is none of them.
export function describeHeroEvent(e, who) {
  switch (e.kind) {
    case "hero_fielded":
      return e.squad ? `Your hero (${e.unit}) has reached the field as ${who}.` : `The enemy has fielded its hero (${e.unit}).`;
    case "hero_fell":
      return e.squad ? `Your hero ${who} (${e.unit}) fell near ${e.point}. Another may be bought.` : `The enemy's hero (${e.unit}) fell near ${e.point}.`;
    case "charge_planted":
      return `Your charge is set on ${e.structure ? `the ${e.unit} (${e.structure})` : e.place} near ${e.point}; it goes off in ${e.count} seconds. Get clear.`;
    case "charge_blew":
      return `A demolition charge went off on ${e.structure ? `the ${e.unit} (${e.structure})` : e.place} near ${e.point}.`;
    case "fortified":
      return `Your squad has dug in: the sandbag position ${e.place} near ${e.point} stands, and you hold it.`;
    case "crushed":
      return `An enemy vehicle (Target ${e.contact}) ran down one of your men near ${e.point}. Get out of the open: a building, sandbags or a grove.`;
    case "promoted":
      return `${who} has earned the rank ${e.unit}.`;
    case "squad_lost":
      if (e.reason === "seized") return `${who} was taken over by the enemy's hero near ${e.point}. It fights for them until the hero dies or is driven away from it.`;
      if (e.reason === "returned") return `${who}, the squad your hero had seized, went back to the enemy near ${e.point}.`;
      return null;
    case "squad_spawned":
      if (e.reason === "seized") return `Your hero seized an enemy squad near ${e.point}: it is now ${who} on your net.`;
      if (e.reason === "returned") return `${who} is yours again near ${e.point}: the enemy's hero lost its hold.`;
      return null;
  }
  return null;
}

// The events of this workstream that wake a squad's own leader, and the operator.
export const heroLeaderEvents = ["fortified", "charge_planted", "crushed"];
export const heroOperatorEvents = ["hero_fell"];

// ---- the rule brain ----

const heroWords = /\bheroe?s?\b|גיבור/;

// heroUnit reads a buy call for the hero: the word itself, or the hero's callsign.
export function heroUnit(text, units, rules) {
  const low = text.toLowerCase();
  const hero = Object.entries(units).find(([, u]) => u.hero);
  if (!hero) return undefined;
  const cs = callsign(rules, hero[1]);
  return heroWords.test(low) || low.includes(cs.en.toLowerCase()) || low.includes(cs.he) ? hero[0] : undefined;
}
