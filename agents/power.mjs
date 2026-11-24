// What the agents know about power, the radar, selling and repairing: the words for the
// prompts, and how the scripted brain reads a call about them. It runs in Node and in a
// Web Worker alike, like the rest of the agent core.

const ofRole = (structures, role) => Object.entries(structures ?? {}).find(([, s]) => s.role === role);

// powerFact is a structure's power as its line in the operator's list says it.
export function powerFact(s) {
  if (s.power > 0) return `supplies ${s.power} power`;
  if (s.power < 0) return `uses ${-s.power} power`;
  return "";
}

// operatorPower is the operator's paragraph on power, the radar, selling and repairing.
export function operatorPower(rules, faction) {
  const m = rules.match;
  const f = rules.factions[faction];
  const [, hq] = ofRole(f.structures, "hq") ?? [];
  const [, plant] = ofRole(f.structures, "power") ?? [];
  const [, radar] = ofRole(f.structures, "radar") ?? [];
  const name = (role) => ofRole(f.structures, role)?.[1].name.en ?? role;
  const opening = (m.opening ?? []).map(name).join(", ");
  const siege = Object.values(f.units)
    .filter((u) => u.siege)
    .map((u) => u.name.en)
    .join(", ");
  return `Power. Every structure supplies or uses power, and your status shows the total as power: {supply, use, low}. Your headquarters supplies ${hq?.power ?? 0}, enough for the ${name("refinery")} and the ${name("barracks")} and no more; a ${plant?.name.en} supplies ${plant?.power} and you may have ${m.powerStructures} of them. When use is above supply, power is low: structures go up and squads deploy at ${Math.round(m.lowPowerFactor * 100)}% speed, your defences stop firing, and the radar goes dark, until you build power or use less. Check power before you build: if the new structure would take use above supply, build a ${plant?.name.en} first. When you are woken because power is low, tell Hammer in one short line, and build a ${plant?.name.en} if you hold the purse. Losing a ${plant?.name.en} can silence every defence at once, so it is worth guarding, and the enemy's is worth destroying.
Radar. The ${radar?.name.en} needs the ${name("works")}, and the ${name("airbase")} needs the ${radar?.name.en}. While it stands and has power (status radar: true) Hammer has the mini map; without it Hammer's mini map is dark, so tell Hammer when it is lost.
A good opening with the purse builds in this order: ${opening}.
Selling and repairing. The sell tool removes one of your structures at once and gives back ${Math.round(m.sellShare * 100)}% of its cost; what it let you buy, and the power it gave, go with it. The headquarters cannot be sold. The repair tool mends a damaged structure of yours over time for gold, up to ${Math.round(m.repairCostShare * 100)}% of its cost for one that is nearly gone; it stops when the structure is whole or your gold runs out. An engineer squad sent into a damaged structure of yours ("repair s5") mends it fully for no gold, and is used up. Sell and repair are spending decisions like building: do them when Hammer asks, or on your own only while command.buy is true.
Defences outrange every ordinary weapon, so a squad sent against one alone is shot before it can answer. ${siege ? `Your ${siege} outranges every defence: send it, screened by another squad that can see the target, or cut the enemy's power.` : "Cut the enemy's power to silence them."}`;
}

// leaderMend is what an engineer leader is told about mending its own side's structures.
export const leaderMend = (unit) => ` repair also mends a damaged structure of your own side: give its id, the squad walks in, and after ${unit.captureSeconds} seconds beside it without being shot at the structure is whole again and the squad stays inside, which is the end of the squad.`;

// leaderSiege is what a leader is told about defences and its own reach.
export function leaderSiege(unit) {
  if (unit.siege) return ` Your squad is a siege unit: it reaches ${unit.siegeRange || unit.range} against structures, farther than any defence fires, so engage defences from as far back as you can and ask for a squad to spot the target.`;
  return " An enemy defence outranges your squad: do not attack one alone, and say so when ordered to; a siege unit breaks it from beyond its reach, and it falls silent when the enemy is short of power.";
}

// ---- the scripted brain ----

export const sellVerb = /\b(sell|scrap|dismantle)\b|מכור|מכרו|למכור|פרק את/;
export const mendVerb = /\b(repair|fix|mend)\b|תקן|תקנו|לתקן|שקם|שקמו/;

// Plain words for the two new roles, in both languages.
export const powerWords = /\b(power plant|power station|generators?|generator yard|power)\b|תחנת כוח|תחנת הכוח|גנרטור|חשמל/;
export const radarWords = /\b(radar|listening post)\b|מכ"ם|מכ״ם|מכם|האזנה/;

// spare is the power a side will have to spare once everything going up stands.
export function sparePower(status, side, defs) {
  if (!status.power) return Infinity; // a status from before power: nothing to keep to
  let spare = (status.power?.supply ?? 0) - (status.power?.use ?? 0);
  for (const st of status.structures ?? []) {
    const rising = st.building === true || (typeof st.building === "number" && st.building < 1);
    if ((st.yours ?? st.side === side) && !st.ruin && rising) spare += Object.values(defs).find((d) => d.role === st.role)?.power ?? 0;
  }
  return spare;
}

// eventLine describes a power or repair event to a model-driven operator.
export function eventLine(e) {
  switch (e.kind) {
    case "low_power":
      return `Your base is short of power by ${e.count}: building and deploying are slowed, your defences have stopped firing and the radar is dark. Build a power structure, or sell something that uses power.`;
    case "power_restored":
      return "Your base has enough power again: defences fire and the radar works.";
    case "structure_repaired":
      return `Your ${e.unit} (${e.structure}) near ${e.point} is whole again.`;
    case "repair_stopped":
      return `The repair of your ${e.unit} (${e.structure}) near ${e.point} stopped: no gold left.`;
  }
  return "";
}
