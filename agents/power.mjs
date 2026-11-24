// What the agents know about power, the radar, selling and repairing: words for the
// prompts (the operator's own paragraphs are in prompts.mjs), and how the scripted brain reads a call about them. It runs in Node and in a
// Web Worker alike, like the rest of the agent core.

// powerFact is a structure's power as its line in the operator's list says it.
export function powerFact(s) {
  if (s.power > 0) return `supplies ${s.power} power`;
  if (s.power < 0) return `uses ${-s.power} power`;
  return "";
}

// leaderMend is what an engineer leader is told about mending its own side's structures.
export const leaderMend = () => ` repair also mends a damaged structure of your own side: give its id from your status ("s5"), or its name ("the refinery"). The squad walks to it and, standing beside it without being shot at, mends it a little every second for no gold, as with a bridge; when it is whole the squad stands by it and you report. The tool refuses a structure that is whole, still going up, or not your side's: answer Negative with that reason.`;

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
