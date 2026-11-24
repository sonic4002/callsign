// Runs one side's agents: Anvil and a leader for every squad, starting and stopping
// leaders as squads are bought and lost.
//
//   node --env-file-if-exists=.env agents/main.mjs
//
// Environment:
//   CALLSIGN_ANTHROPIC_KEY  Anthropic API key. Without it the scripted brain is used.
//   CALLSIGN_CLAUDE_TOKEN   Claude subscription token from `claude setup-token`, for testing.
//                           A token put in CALLSIGN_ANTHROPIC_KEY is recognised too.
//   CALLSIGN_BRAIN          "claude", "subscription" or "scripted" (default: by what is set)
//   CALLSIGN_CLAUDE_BIN     Claude Code executable for the subscription brain (default: claude)
//   CALLSIGN_SERVER         game server WebSocket URL (default ws://127.0.0.1:8080/ws)
//   CALLSIGN_SIDE           0 or 1 (default 0)
//   CALLSIGN_OPERATOR       "0" to play without Anvil
//   CALLSIGN_OPERATOR_MODEL model id for Anvil (default: the top model)

import { Host } from "./host.mjs";

export { Host };

export async function makeBrain(env = process.env) {
  const key = env.CALLSIGN_ANTHROPIC_KEY ?? "";
  // A token from `claude setup-token` (sk-ant-oat...) is a Claude subscription, not an API key.
  const token = env.CALLSIGN_CLAUDE_TOKEN || (key.startsWith("sk-ant-oat") ? key : "");
  const kind = env.CALLSIGN_BRAIN || (token ? "subscription" : key ? "claude" : "scripted");
  if (kind === "scripted") return scripted();
  let brain;
  if (kind === "claude") {
    if (!key) throw new Error("CALLSIGN_BRAIN=claude needs CALLSIGN_ANTHROPIC_KEY in .env");
    const { claudeBrain } = await import("./brain-claude.mjs");
    brain = claudeBrain({ apiKey: key, operatorModel: env.CALLSIGN_OPERATOR_MODEL || undefined });
  } else if (kind === "subscription") {
    if (!token) throw new Error("CALLSIGN_BRAIN=subscription needs a token from `claude setup-token` in CALLSIGN_CLAUDE_TOKEN");
    const { subscriptionBrain } = await import("./brain-subscription.mjs");
    brain = subscriptionBrain({ token, bin: env.CALLSIGN_CLAUDE_BIN || undefined, operatorModel: env.CALLSIGN_OPERATOR_MODEL || undefined });
  } else {
    throw new Error(`unknown CALLSIGN_BRAIN "${kind}"`);
  }
  if (env.CALLSIGN_BRAIN) return brain; // asked for by name: fail loudly later, never swap
  try {
    await brain.check();
    return brain;
  } catch (err) {
    console.log(`Claude is not usable: ${err.message}.`);
    return scripted();
  }
}

async function scripted() {
  const { scriptedBrain } = await import("./brain-scripted.mjs");
  return scriptedBrain();
}

if (import.meta.main) {
  const env = process.env;
  const server = env.CALLSIGN_SERVER || "ws://127.0.0.1:8080/ws";
  const brain = await makeBrain(env);
  if (brain.name === "scripted") {
    console.log("Squads run on the scripted brain. It follows plain orders (hold, move, attack a point) and nothing more.");
  }
  for (;;) {
    const host = new Host({ server, side: Number(env.CALLSIGN_SIDE || 0), brain, operator: env.CALLSIGN_OPERATOR !== "0" });
    try {
      await host.start();
      await host.closed;
      console.log("the game server closed the connection; reconnecting");
    } catch {
      // The server is not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
