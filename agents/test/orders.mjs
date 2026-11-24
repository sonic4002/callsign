// The order set of fixtures/orders.json and how a brain is scored on it: shared by the
// test that holds the grammar to its numbers and by the live measurement of the fast brain.

import { readFileSync } from "node:fs";

export const rules = JSON.parse(readFileSync(new URL("../../shared/rules.json", import.meta.url)));
rules.map ??= rules.maps.small; // the default map, as the server sends it to a page
export const { orders } = JSON.parse(readFileSync(new URL("./fixtures/orders.json", import.meta.url)));

const hammer = { key: "player", en: "Hammer", he: "פטיש" };
export const viper1 = { key: "infantry-1", en: "Viper 1", he: "צפע 1", squad: 1 };

// The situation every order is given in.
export const status = () => ({
  timeLeft: 500,
  points: [{ id: "A", owner: 0 }, { id: "B", owner: 0 }, { id: "D", owner: -1 }, { id: "F", owner: -1 }, { id: "G", owner: -1 }, { id: "H", owner: -1 }, { id: "K", owner: 1 }, { id: "S", owner: -1 }, { id: "Z", owner: 1 }],
  contacts: [
    { id: 3, unit: "technical", class: "vehicle", near: "G", x: 760, y: 240, teams: [{}] },
    { id: 7, unit: "militia", class: "infantry", near: "F", x: 800, y: 500, teams: [{}, {}] },
  ],
  structures: [
    { id: "s7", kind: "smelter", name: "Smelter", role: "refinery", side: 1, near: "K", x: 1200, y: 180, hp: 1, building: 1 },
    { id: "s2", kind: "barracks", name: "Barracks", role: "barracks", side: 0, yours: true, near: "A", x: 200, y: 420, hp: 1, building: 1 },
  ],
  haulers: [],
  landmarks: [],
  friends: [],
  you: { id: 1, near: "B", x: 450, y: 230, order: { kind: "none" }, alive: 6, full: 6, tier: 1, teams: [{ nerve: "steady", action: "idle", members: 3 }, { nerve: "steady", action: "idle", members: 3 }], contacts: [3] },
});

export const leader = (lang, tier = 1) => ({ role: "squad", side: 0, squad: 1, tier, station: viper1, lang, unit: rules.factions.aegis.units.commandos });
export const callOf = (o) => ({ from: hammer, to: [viper1], lang: o.lang, body: o.body, end: o.end || "over", points: o.points, prowords: o.prowords, landmarks: o.landmarks });

// run drives a brain through one wake the way the agent loop does, every tool succeeding.
export async function run(brain, ctx) {
  const messages = [{ role: "user", content: "wake" }];
  const calls = [];
  for (let i = 0; i < 8; i++) {
    const res = await brain.think({ rules, messages, ...ctx });
    messages.push({ role: "assistant", content: res.content });
    const uses = res.content.filter((b) => b.type === "tool_use");
    if (!uses.length) return calls;
    calls.push(...uses.map((u) => [u.name, u.input]));
    messages.push({ role: "user", content: uses.map((u) => ({ type: "tool_result", tool_use_id: u.id, content: "{}" })) });
  }
  throw new Error("the brain never ended its turn");
}

// did names what a wake's tool calls amount to, in the words the fixture expects.
export function did(calls) {
  const act = calls.find(([name]) => name !== "radio");
  if (act) {
    const [name, input] = act;
    if (name === "attack" && input.contact) return `attack #${input.contact}`;
    const place = input.place ?? "";
    return `${name} ${/\d/.test(place) && / of /.test(place) ? "spot" : place}`.trim();
  }
  const said = calls.find(([name]) => name === "radio")?.[1].body ?? "";
  const starts = (key) => rules.radio.brain[key].en.concat(rules.radio.brain[key].he).some((line) => said.startsWith(line.split("{")[0].trim()));
  if (!said) return "silence";
  if (starts("sayAgain")) return "sayAgain";
  if (starts("fiveByFive")) return "check";
  if (starts("negative")) return "negative";
  return "report";
}

// score sorts the answers into right, a harmless "Say again" (or a Negative) where an
// action was wanted, and wrong: an action that was not ordered, which is what must not happen.
export function score(results) {
  const out = { n: results.length, right: 0, asked: 0, wrong: 0, misses: [] };
  for (const r of results) {
    const ok = r.order.expect.split("|").includes(r.got);
    if (ok) out.right++;
    else if (["sayAgain", "negative", "silence"].includes(r.got)) out.asked++;
    else out.wrong++;
    if (!ok) out.misses.push(`${r.order.kind} ${r.order.lang} "${r.order.text}" → ${r.got}, wanted ${r.order.expect}`);
  }
  return out;
}

// measure runs every order through a brain made by `make()` and scores the lot.
export async function measure(make, pick = () => true) {
  const results = [];
  for (const order of orders.filter(pick)) {
    const brain = make();
    const c = callOf(order);
    const calls = await run(brain, { agent: leader(order.lang), wake: { items: [{ kind: "radio", msg: c }], call: c, status: status() } });
    results.push({ order, got: did(calls), calls });
  }
  return results;
}
