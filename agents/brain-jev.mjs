// The fast brain: the rule brain, with a decision model for the orders its grammar does
// not understand. The model is Jev (TypeSafe): it writes nothing, it picks one option
// from a list and gives each a probability, in about a quarter of a second.
//
// A call is read by the grammar first (rule-grammar.mjs), which costs nothing and is all a
// taught sentence needs. Only a call the grammar cannot place goes to the model, through
// the relay and on the game's own key: this code lists what the squad could be told to do
// in its situation, the model chooses, and the choice becomes a tool call and a fixed
// phrase exactly as the grammar's would. Below a threshold of probability the squad says
// "Say again", naming the order it came closest to. The model never writes on the net.
//
// When the relay cannot decide (no key, the day's ceiling, a limit, no network) the squad
// answers as the rule brain would, without a word about it. The operator does not use the
// model at all: Anvil here is the rule brain's.
//
//   POST {base}/decide   Authorization: Bearer <player token>   X-Callsign-Seat: <seat token>
//        { room, side, squad, situation, call, question, options: { name: description } }
//     →  { choice, confidence, probabilities, model, usage: { input_tokens, output_tokens } }
//
// It runs unchanged in Node and in a Web Worker: it needs only fetch.

import { isStrike } from "./aircraft.mjs";
import { compactStructures } from "./bases.mjs";
import { call as ask } from "./brain-relay.mjs";
import { memories, stepper } from "./brain-rule.mjs";
import { canDig, intents, nearestCover, understandLeader } from "./rule-grammar.mjs";
import { carryOut, leaderEvent, levelOf } from "./rule-leader.mjs";
import { operatorPlan } from "./rule-operator.mjs";

export const THRESHOLD = 0.67; // the vendor's example; see docs/research/2026-11-24-jev-decision-model.md
const SAY_AGAIN = "say_again";

// optionsFor lists what a squad could be ordered to do right now: for each option the
// description the model reads and the intent the code carries out. Only things this
// squad can do are offered, so the model cannot choose what the game would refuse.
export function optionsFor({ agent, wake, rules }) {
  const unit = agent.unit ?? {};
  const status = wake.status ?? {};
  const call = wake.call;
  const out = new Map();
  const add = (intent, about) => out.size < 62 && !out.has(intent.label) && out.set(intent.label, { intent, about });
  const reach = (p) => unit.domain === "air" || (unit.domain === "sea") === (p.kind === "seaRig");
  const strike = isStrike(unit); // flies sorties: it bombs a place or looks at it, and holds none
  for (const p of rules.map.points.filter(reach)) {
    const name = `${p.callsign.en} / ${p.callsign.he} (${p.name.en}, ${p.name.he})`;
    add(intents.move(p.id), strike ? `fly over ${name} to look at it, and come home` : `go to ${name} without stopping to fight on the way`);
    if (!strike) add(intents.hold(p.id), `go to ${name} and hold, defend, take or capture it`);
    add(intents.attack(p.id), strike ? `strike ${name}: bomb the enemy there` : `attack ${name}: assault it and destroy the enemy there`);
  }
  for (const c of (status.contacts ?? []).filter((c) => !strike || c.class !== "air").slice(0, 8)) {
    add(intents.attackContact(c.id), `attack the enemy ${c.unit} squad ${rules.callsigns.contact.en} ${c.id} / ${rules.callsigns.contact.he} ${c.id}, in sight near ${c.near}`);
  }
  const marks = [...(rules.map.landmarks ?? []), ...(rules.map.bridges ?? [])];
  for (const id of (call?.landmarks ?? []).slice(0, 4)) {
    const l = marks.find((m) => m.id === id);
    if (l && strike) add(intents.attack(id, `attack:lm:${id}`), `strike ${l.name.en} / ${l.name.he}: bomb it`);
    else if (l) add(intents.hold(id, `hold:lm:${id}`), `go to ${l.name.en} / ${l.name.he} and take cover or position there`);
  }
  for (const s of compactStructures(status, agent.side).filter((st) => st.whose !== "yours").slice(0, 4)) {
    add(intents.attack(s.id), `attack the enemy structure ${s.name} (${s.id}) near ${s.near}`);
    if (unit.captureSeconds > 0) add(intents.capture(s.id), `take over the structure ${s.name} (${s.id}) near ${s.near} with your engineers`);
  }
  const hq = rules.map.points.find((p) => p.kind === "hq" && p.owner === agent.side);
  if (hq && reach(hq)) add(intents.move(hq.id, "fallBack", { back: true }), strike ? "return to base: break off, abort, come home, land" : "fall back: retreat, withdraw, pull out, get out of there, return to your own headquarters");
  const cover = nearestCover(status, rules, { within: 400 });
  if (!strike) add(cover ? intents.hold(cover.id, "cover", { shelter: cover.id }) : intents.hold("here", "cover"), "take cover: get down, hide, find shelter close to where you are now");
  if (!strike) add(intents.hold("here", "hold:here"), "stop and stay where you are now, and defend this spot");
  if (canDig(unit)) add(intents.fortify(), "dig in: build a sandbag position where you stand");
  add(intents.report(), "report: say where you are, your strength and what you see; a question about your status or situation");
  return out;
}

// situationOf is what the model reads beside the call: the squad's own picture, small.
function situationOf({ agent, wake }) {
  const you = wake.status?.you;
  return {
    squad: `${agent.station.en} (${agent.unit?.name?.en ?? "squad"}, ${agent.unit?.class ?? ""})`,
    from: wake.call.from.en,
    ...(you ? { near: you.near, order: you.order?.kind ?? "none", strength: `${you.alive}/${you.full}` } : {}),
    contacts: (wake.status?.contacts ?? []).slice(0, 8).map((c) => ({ id: c.id, unit: c.unit, near: c.near })),
  };
}

// describe says an intent back as an order, for "Say again: hold Foxtrot or move to Foxtrot?".
function describe(intent) {
  if (intent.label === "fallBack") return { key: "order.fallBack" };
  if (intent.label === "cover") return { key: "order.cover" };
  if (intent.kind === "report") return { key: "order.report" };
  if (intent.contact) return { key: "order.attack", vars: { place: intent.contact } }; // a number is said as "Target 3"
  if (["move", "hold", "attack"].includes(intent.kind) && intent.tool.input.place && intent.tool.input.place !== "here") return { key: `order.${intent.kind}`, vars: { place: intent.tool.input.place } };
  return null;
}

// choose turns the model's answer into an intent: the option it chose when it is sure
// enough, otherwise a "Say again" that names what it was torn between, or null to leave
// the answer to the grammar.
export function choose(answer, options, threshold = THRESHOLD) {
  const probs = answer?.probabilities ?? {};
  const top = answer?.choice;
  const p = probs[top] ?? 0;
  if (top && top !== SAY_AGAIN && options.has(top) && p >= threshold) return options.get(top).intent;
  const close = Object.entries(probs)
    .filter(([name, q]) => name !== SAY_AGAIN && options.has(name) && q >= 0.12)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([name]) => describe(options.get(name).intent))
    .filter(Boolean);
  return close.length ? intents.unclear("sayAgainWhich", { asks: close }) : null;
}

// jevBrain makes the brain. `fetch`, `base`, `room`, `token` and `seat` are the relay brain's.
// `threshold` is the least probability the model must give an order for the squad to act
// on it. onDecision({ ms, model, choice, p, acted }) is told of every call made, and
// `grammar: false` sends every order to the model, both for measuring the model alone.
export function jevBrain({ base = "/relay/v1", room, token, seat, fetch: fetcher = (...a) => globalThis.fetch(...a), threshold = THRESHOLD, timeoutMs = 2500, operatorLevel = 3, grammar = true, onUsage, onDecision } = {}) {
  const steps = stepper("jev");
  const memory = memories();
  let offUntil = 0; // after "decide_off" the relay is left alone for a while

  async function decide(ctx, options) {
    const { agent, wake } = ctx;
    const body = {
      room,
      side: agent.side,
      squad: agent.squad,
      situation: situationOf(ctx),
      call: wake.call.body.slice(0, 600),
      question: `Which single action does the radio call order ${agent.station.en} to take?`,
      options: Object.fromEntries([...[...options].map(([name, o]) => [name, o.about]), [SAY_AGAIN, "the call is unclear, incomplete, a radio check, or asks for none of the other options"]]),
    };
    return ask(fetcher, `${base}/decide`, { method: "POST", token, seat, body, timeoutMs });
  }

  return {
    name: "jev",
    slow: false,
    // Anvil here is the rule brain, and the commander's view says so.
    nameFor: ({ role }) => (role === "anvil" ? "rule" : "jev"),
    plan: ({ role, tier, level }) => (role === "anvil" ? `rule-${level ?? operatorLevel}` : `jev+rule-${Math.max(1, Math.min(3, tier || 1))}`),
    async think(ctx) {
      let seen = null; // what this thought used, for the commander's view
      const res = await steps.next(ctx, async () => {
        if (ctx.agent.role === "anvil") {
          const agent = { ...ctx.agent, level: ctx.agent.level ?? operatorLevel };
          seen = { model: `rule-${agent.level}` };
          return operatorPlan({ ...ctx, agent }, memory(agent));
        }
        const mem = memory(ctx.agent);
        seen = { model: "grammar" };
        if (!ctx.wake.call) return leaderEvent(ctx, mem);
        const commanded = ["player", "operator"].includes(ctx.wake.call.from.key);
        // A radio check, and a call from another squad, are settled by code either way.
        const byCode = grammar || !commanded || ctx.wake.call.prowords?.includes("radioCheck");
        let intent = byCode ? understandLeader({ call: ctx.wake.call, status: ctx.wake.status, rules: ctx.rules, agent: ctx.agent, level: levelOf(ctx.agent) }) : intents.unclear();
        if (intent.kind === "unclear" && Date.now() >= offUntil) {
          const options = optionsFor(ctx);
          const began = Date.now();
          try {
            const answer = await decide(ctx, options);
            const picked = choose(answer, options, threshold);
            seen = { model: answer.model ?? "jev", usage: answer.usage };
            if (answer.usage) onUsage?.(answer.usage, answer.model, answer.provider);
            onDecision?.({ ms: Date.now() - began, model: answer.model, choice: answer.choice, p: answer.probabilities?.[answer.choice] ?? 0, acted: Boolean(picked && picked.kind !== "unclear") });
            if (picked) intent = picked;
          } catch (err) {
            // No decision to be had: the grammar's own answer stands. A relay that says
            // the model is off is not asked again for a minute.
            if (err?.code === "decide_off") offUntil = Date.now() + 60_000;
            onDecision?.({ ms: Date.now() - began, error: err?.code ?? "failed" });
          }
        }
        return carryOut(intent, ctx, mem);
      });
      return seen ? { ...res, ...seen } : res;
    },
  };
}

// tiered thinks with `fast` for the squads of the tiers it is given and with `rest` for
// everything else: a player with a key keeps a language model for Anvil and the higher
// tiers while tier-1 squads take orders at once.
export function tiered({ fast, rest, tiers = [1] }) {
  const pick = ({ role, tier }) => (role === "squad" && tiers.includes(tier) ? fast : rest);
  return {
    name: rest.name,
    get slow() {
      return rest.slow;
    },
    slowFor: (agent) => pick(agent).slow,
    nameFor: (agent) => pick(agent).nameFor?.(agent) ?? pick(agent).name,
    plan: (agent) => pick(agent).plan?.(agent) ?? null,
    think: (ctx) => pick(ctx.agent).think(ctx),
  };
}
