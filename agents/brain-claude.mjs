// The Claude brain. In Phase 0 the agent process calls Anthropic itself with the key from
// .env; from Phase 2 this one function is replaced by a call to the model relay, which
// picks the model by the squad's tier on the server side.

import Anthropic from "@anthropic-ai/sdk";

// Brain tier → model. Tier 1 is the small fast model every squad starts with.
export const models = {
  tiers: { 1: "claude-haiku-5-5", 2: "claude-sonnet-5-5", 3: "claude-opus-5-5" },
  operator: "claude-opus-5-5",
};

// How hard each brain thinks. Radio answers have to come back quickly.
const effort = { 1: "low", 2: "medium", 3: "high", operator: "medium" };

// Models that can decline a request and hand it to another model on the server side.
const withFallback = (model) => !model.startsWith("claude-haiku");

export function claudeBrain({ apiKey, client = new Anthropic({ apiKey }), operatorModel = models.operator }) {
  return {
    name: "claude",
    slow: true,
    async think({ agent, system, tools, messages }) {
      const operator = agent.role === "anvil";
      const model = operator ? operatorModel : models.tiers[agent.tier] ?? models.tiers[1];
      const params = {
        model,
        max_tokens: 4096, // radio traffic is short by design
        system,
        tools,
        messages,
        cache_control: { type: "ephemeral" },
        output_config: { effort: operator ? effort.operator : effort[agent.tier] ?? effort[1] },
      };
      try {
        const res = withFallback(model)
          ? await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
          : await client.messages.create(params);
        return { content: res.content, stop_reason: res.stop_reason, stop_details: res.stop_details, usage: res.usage, model: res.model };
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError) throw new Error("the Anthropic key in CALLSIGN_ANTHROPIC_KEY was rejected");
        if (err instanceof Anthropic.RateLimitError) throw new Error("rate limited by Anthropic; this wake is skipped");
        if (err instanceof Anthropic.APIError) throw new Error(`Anthropic API error ${err.status}: ${err.message}`);
        throw err;
      }
    },
  };
}
