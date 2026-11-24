// The subscription brain, for testing without an API key. Each thought is one run of
// Claude Code in print mode (`claude -p`), signed in with the token from `claude setup-token`.
// Claude Code's own tools are switched off; the model answers with a list of game tool
// calls as structured output, and the agent runs them through the game server as usual.
//
// It is slower than the API brain (a process starts for every thought) and it draws on the
// subscription's usage limits, so it is a test rig, not how the game ships.

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { models } from "./brain-claude.mjs";

const effort = { 1: "low", 2: "medium", 3: "high", operator: "medium" };

// actionSchema lets the model return any number of calls, each checked against its tool.
function actionSchema(tools) {
  return {
    type: "object",
    properties: {
      actions: {
        type: "array",
        items: {
          anyOf: tools.map((t) => ({
            type: "object",
            properties: { tool: { type: "string", enum: [t.name] }, input: t.input_schema },
            required: ["tool", "input"],
            additionalProperties: false,
          })),
        },
      },
    },
    required: ["actions"],
    additionalProperties: false,
  };
}

const toolGuide = (tools) =>
  [
    "",
    "## How you act here",
    "You act only by returning `actions`: a list of tool calls, run in the order you give them. Return an empty list when there is nothing to do or you are finished.",
    "After your actions run you are asked again only if one was refused or you called `report`; then return what to do next, or an empty list.",
    ...tools.map((t) => `- ${t.name}: ${t.description}`),
  ].join("\n");

// transcript turns the agent's message history into plain text for one prompt.
export function transcript(messages) {
  const names = new Map();
  const parts = [];
  for (const m of messages) {
    if (typeof m.content === "string") {
      parts.push(m.content);
    } else if (m.role === "assistant") {
      for (const b of m.content) {
        if (b.type !== "tool_use") continue;
        names.set(b.id, b.name);
        parts.push(`You called ${b.name} ${JSON.stringify(b.input)}`);
      }
    } else {
      for (const r of m.content) {
        parts.push(`${names.get(r.tool_use_id) ?? "tool"} ${r.is_error ? "was refused" : "returned"}: ${r.content}`);
      }
    }
  }
  return parts.join("\n\n");
}

// run starts Claude Code once and resolves with its JSON result.
function run(bin, args, input, env, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env, cwd, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(e.code === "ENOENT" ? `Claude Code was not found (${bin})` : e.message));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal) return reject(new Error(`Claude Code did not answer within ${timeoutMs / 1000} s`));
      let res;
      try {
        res = JSON.parse(out);
      } catch {
        return reject(new Error(`Claude Code exited ${code}: ${(err || out).trim().slice(0, 300)}`));
      }
      if (res.is_error) return reject(new Error(`Claude Code: ${String(res.result ?? res.subtype).slice(0, 300)}`));
      resolve(res);
    });
    child.stdin.end(input);
  });
}

// reading takes from Claude Code's result what an agent reports about its thought: the
// token counts (cached input included, and each request of the run under `iterations`),
// the model that answered, and that model's context window, which the result names.
export function reading(res, asked) {
  const per = res.modelUsage && typeof res.modelUsage === "object" ? res.modelUsage : {};
  // The model that answered is the one that did the work; a run may also list helpers.
  const used = per[asked] ? asked : Object.keys(per).sort((a, b) => (per[b].outputTokens ?? 0) - (per[a].outputTokens ?? 0))[0] ?? asked;
  const u = res.usage;
  const usage = u && {
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    cache_read_input_tokens: u.cache_read_input_tokens,
    cache_creation_input_tokens: u.cache_creation_input_tokens,
    iterations: Array.isArray(u.iterations)
      ? u.iterations.map((i) => ({ input_tokens: i.input_tokens, output_tokens: i.output_tokens, cache_read_input_tokens: i.cache_read_input_tokens, cache_creation_input_tokens: i.cache_creation_input_tokens }))
      : undefined,
  };
  const window = per[used]?.contextWindow;
  return { usage, model: used, window: Number.isFinite(window) ? window : undefined };
}

export function subscriptionBrain({ token, bin = "claude", operatorModel = models.operator, timeoutMs = 60_000, exec = run }) {
  // An empty directory of its own, so Claude Code finds no project files or instructions.
  const cwd = mkdtempSync(join(tmpdir(), "callsign-brain-"));
  const env = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token };
  delete env.ANTHROPIC_API_KEY; // the subscription pays, never a key that happens to be set
  delete env.CALLSIGN_ANTHROPIC_KEY;
  let nextId = 1;

  const ask = (model, level, system, schema, prompt) =>
    exec(
      bin,
      [
        "-p",
        "--model", model,
        "--effort", level,
        "--tools", "",
        "--strict-mcp-config",
        "--setting-sources", "",
        "--no-session-persistence",
        "--output-format", "json",
        "--system-prompt", system,
        "--json-schema", JSON.stringify(schema),
      ],
      prompt,
      env,
      cwd,
      timeoutMs,
    );

  return {
    name: "subscription",
    slow: true,
    // plan names the model the next thought of an agent will use.
    plan: ({ role, tier }) => (role === "anvil" ? operatorModel : models.tiers[tier] ?? models.tiers[1]),
    // check makes one small call so a token that cannot be used is found before the match.
    async check() {
      const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
      await ask(models.tiers[1], "low", "Answer the radio check.", schema, "Radio check.");
    },
    async think({ agent, system, tools, messages }) {
      const last = messages.at(-1);
      if (typeof last.content !== "string") {
        // Our own actions just ran. Think again only when there is something new to read.
        const asked = messages.at(-2).content.some((b) => b.type === "tool_use" && b.name === "report");
        if (!asked && !last.content.some((r) => r.is_error)) return { content: [{ type: "text", text: "" }], stop_reason: "end_turn" };
      }
      const operator = agent.role === "anvil";
      const model = operator ? operatorModel : models.tiers[agent.tier] ?? models.tiers[1];
      const level = operator ? effort.operator : effort[agent.tier] ?? effort[1];
      const res = await ask(model, level, system + "\n" + toolGuide(tools), actionSchema(tools), transcript(messages));
      const actions = res.structured_output?.actions ?? [];
      const { usage, model: used, window } = reading(res, model);
      if (actions.length === 0) return { content: [{ type: "text", text: "" }], stop_reason: "end_turn", usage, model: used, window };
      return {
        content: actions.map((a) => ({ type: "tool_use", id: `toolu_sub_${nextId++}`, name: a.tool, input: a.input })),
        stop_reason: "tool_use",
        usage,
        model: used,
        window,
      };
    },
  };
}
