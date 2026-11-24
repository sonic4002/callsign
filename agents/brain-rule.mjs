// The rule brain: squad leaders and the operator with no AI at all. It is the game's
// default, so that anyone can play without a key: orders are understood by a grammar in
// Hebrew and English (rule-grammar.mjs), answered in fixed radio phrases (shared/rules.json,
// radio.brain), and carried out with as much initiative as the station's level gives it
// (rule-leader.mjs, rule-operator.mjs). A squad's level is its brain tier; the operator's
// is a setting of the match.
//
// It answers in the same shape the model brains do, costs no call and no noticeable CPU,
// and runs unchanged in Node and in a Web Worker.

import { fresh, leaderPlan } from "./rule-leader.mjs";
import { freshOperator, operatorPlan } from "./rule-operator.mjs";

export { runOf, spotOf, wantedUnit } from "./rule-operator.mjs";

// stepper runs a plan one tool call a turn, the way the agent loop asks for thoughts. A
// step may carry `orElse(reason)`: what to do instead of the rest when the game refuses it.
export function stepper(prefix = "rule") {
  const plans = new Map(); // station key → steps still to run in the current wake
  let nextId = 1;
  return {
    // next gives the turn's answer. `plan()` is asked for on the first turn of a wake.
    async next(ctx, plan) {
      const key = `${ctx.agent.side}:${ctx.agent.station.key}`;
      const last = ctx.messages.at(-1);
      let steps;
      if (typeof last.content === "string") {
        steps = await plan();
      } else {
        steps = plans.get(key) ?? [];
        const failed = last.content.find((r) => r.is_error);
        const step = failed && ctx.messages.at(-2).content.find((b) => b.id === failed.tool_use_id);
        if (step?.orElse) steps = [step.orElse(failed.content)].flat();
        else if (failed) steps = [];
      }
      const step = steps.shift();
      plans.set(key, steps);
      if (!step) return { content: [{ type: "text", text: "" }], stop_reason: "end_turn" };
      // orElse rides along on the block so the next turn can find it; the server never sees it.
      return { content: [{ type: "tool_use", id: `toolu_${prefix}_${nextId++}`, name: step.name, input: step.input, orElse: step.orElse }], stop_reason: "tool_use" };
    },
  };
}

// memories keeps what each station remembers between wakes, one per brain.
export function memories() {
  const all = new Map();
  return (agent) => {
    const key = `${agent.side}:${agent.station.key}`;
    if (!all.has(key)) all.set(key, agent.role === "anvil" ? freshOperator() : fresh());
    return all.get(key);
  };
}

// ruleBrain makes a brain. `operatorLevel` is Anvil's initiative when the match does not
// set one (agent.level); a squad's is its tier.
export function ruleBrain({ operatorLevel = 3 } = {}) {
  const steps = stepper("rule");
  const memory = memories();
  return {
    name: "rule",
    slow: false,
    plan: ({ role, tier, level }) => `rule-${role === "anvil" ? (level ?? operatorLevel) : Math.max(1, Math.min(3, tier || 1))}`,
    think(ctx) {
      const agent = ctx.agent.role === "anvil" ? { ...ctx.agent, level: ctx.agent.level ?? operatorLevel } : ctx.agent;
      const c = { ...ctx, agent };
      return steps.next(ctx, () => (agent.role === "anvil" ? operatorPlan : leaderPlan)(c, memory(agent)));
    },
  };
}
