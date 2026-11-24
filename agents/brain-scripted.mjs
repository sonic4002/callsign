// A brain with no model behind it. It understands a handful of plain orders by pattern
// and answers in procedure, in Hebrew or English. Tests run on it, and so does a match
// started without an API key. It answers in the same shape the Claude brain does.

const verbs = [
  ["attack", /\b(attack|assault|destroy|hit)\b|תקוף|תקפו|לתקוף|השמד/],
  ["move", /\b(move|go|advance|head)\b|נוע|נועו|זוז|זוזו|התקדם/],
  ["hold", /\b(hold|defend|take|capture|secure|guard)\b|תחזיק|החזק|להחזיק|הגן|קח|כבוש|תפוס|תפסו/],
];
const say = {
  wilco: { en: "Wilco", he: "רות, יבוצע" },
  sayAgain: { en: "Say again", he: "אמור שנית" },
  fiveByFive: { en: "Five by five", he: "חמש על חמש" },
  negative: { en: "Negative", he: "שלילי" },
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
  const verb = verbOf(call.body);
  const point = call.points?.[0];
  if (!verb || (!point && verb === "move")) return [radio(back, say.sayAgain[lang], "over")];
  // "Attack" with no target: the nearest enemy in sight, or else the enemy headquarters.
  const contact = (!point && wake.status?.contacts?.[0]?.id) || 0;
  const enemyHQ = rules.map.points.find((p) => p.kind === "hq" && p.owner !== agent.side)?.id;
  const input = verb === "attack" ? { point: contact ? "" : point ?? enemyHQ, contact } : { point: point ?? "here" };
  return [
    { name: verb, input, orElse: (why) => radio(back, `${say.negative[lang]}, ${why}`, "over") },
    radio(back, say.wilco[lang], "out"),
  ];
}

function operatorPlan({ wake, rules, agent }) {
  const call = wake.call;
  if (!call || call.from.key !== "player") return []; // Anvil answers to Hammer only
  const lang = call.lang;
  const back = [call.from.en];
  const text = call.body.toLowerCase();
  const negative = (why) => radio(back, `${say.negative[lang]}, ${why}`, "over");
  if (call.prowords?.includes("radioCheck")) return [radio(back, say.fiveByFive[lang], "out")];

  if (/\bupgrade\b|שדרג/.test(text)) {
    const squad = (wake.status?.squads ?? []).find((sq) => text.includes(sq.callsign.en.toLowerCase()) || (sq.callsign.he && text.includes(sq.callsign.he)));
    if (!squad) return [radio(back, say.sayAgain[lang], "over")];
    return [{ name: "buy", input: { unit: "", upgrade: squad.callsign.en }, orElse: negative }, radio(back, say.wilco[lang], "out")];
  }
  if (/\b(buy|purchase)\b|קנה|קנו|רכוש/.test(text)) {
    const wanted = /\b(tank|vehicle|technical)|טנק|רכב|טנדר/.test(text) ? "vehicle" : /\b(boat|naval|ship)|סירה|ימי/.test(text) ? "naval" : "infantry";
    const [unit] = Object.entries(rules.factions[wake.status?.faction ?? ""]?.units ?? {}).find(([, u]) => u.class === wanted) ?? [];
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
