// Runs one side's agents: Anvil and a leader for every squad, starting and stopping
// leaders as squads are bought and lost.
//
//   node --env-file-if-exists=.env agents/main.mjs
//
// Environment:
//   CALLSIGN_ANTHROPIC_KEY  Anthropic key. Without it the scripted brain is used.
//   CALLSIGN_BRAIN          "claude" or "scripted" (default: claude when a key is set)
//   CALLSIGN_SERVER         game server WebSocket URL (default ws://127.0.0.1:8080/ws)
//   CALLSIGN_SIDE           0 or 1 (default 0)
//   CALLSIGN_OPERATOR       "0" to play without Anvil
//   CALLSIGN_OPERATOR_MODEL model id for Anvil (default: the top model)

import { Agent } from "./agent.mjs";
import { Link } from "./link.mjs";

export async function makeBrain(env = process.env) {
  const key = env.CALLSIGN_ANTHROPIC_KEY ?? "";
  const kind = env.CALLSIGN_BRAIN || (key ? "claude" : "scripted");
  if (kind === "claude") {
    if (!key) throw new Error("CALLSIGN_BRAIN=claude needs CALLSIGN_ANTHROPIC_KEY in .env");
    const { claudeBrain } = await import("./brain-claude.mjs");
    return claudeBrain({ apiKey: key, operatorModel: env.CALLSIGN_OPERATOR_MODEL || undefined });
  }
  if (kind !== "scripted") throw new Error(`unknown CALLSIGN_BRAIN "${kind}"`);
  const { scriptedBrain } = await import("./brain-scripted.mjs");
  return scriptedBrain();
}

// Host keeps one agent per station on a side in step with the match.
export class Host {
  constructor({ server, side = 0, brain, operator = true, log = console.log, standByMs }) {
    Object.assign(this, { server, side, brain, operator, log, standByMs });
    this.agents = new Map(); // squad id (0 for Anvil) → Agent
  }

  // start joins the match. `closed` resolves when the server drops the control connection.
  async start() {
    this.closed = new Promise((resolve) => (this.onClosed = resolve));
    // The control connection only listens: which squads exist, and when the match restarts.
    this.control = new Link(
      `${this.server}?${new URLSearchParams({ side: this.side, role: "anvil", state: "0" })}`,
      (frame) => this.#onFrame(frame),
      () => {
        this.stop();
        this.onClosed();
      },
    );
    await this.control.open();
  }

  // ready reports whether every agent that should exist has joined the net.
  get ready() {
    return this.agents.size > 0 && [...this.agents.values()].every((a) => a.me);
  }

  stop() {
    for (const agent of this.agents.values()) agent.stop();
    this.agents.clear();
    this.control?.close();
  }

  #onFrame(frame) {
    if (frame.type === "hello") {
      for (const agent of this.agents.values()) agent.stop();
      this.agents.clear();
      this.log(`match ${frame.match}: side ${this.side} (${frame.faction}), brain: ${this.brain.name}`);
      if (this.operator) this.#add("anvil", 0);
      for (const sq of frame.state.squads) this.#add("squad", sq.id);
    } else if (frame.type === "event" && frame.event.kind === "squad_spawned") {
      this.#add("squad", frame.event.squad);
    } else if (frame.type === "event" && frame.event.kind === "squad_lost") {
      this.agents.get(frame.event.squad)?.stop();
      this.agents.delete(frame.event.squad);
    }
  }

  async #add(role, squad) {
    if (this.agents.has(squad)) return;
    const agent = new Agent({ server: this.server, side: this.side, role, squad, brain: this.brain, log: this.log, standByMs: this.standByMs });
    this.agents.set(squad, agent);
    try {
      await agent.start();
      this.log(`${agent.name} is on the net`);
    } catch (err) {
      this.agents.delete(squad);
      this.log(`could not start the agent for ${role} ${squad || ""}: ${err.message}`);
    }
  }
}

if (import.meta.main) {
  const env = process.env;
  const server = env.CALLSIGN_SERVER || "ws://127.0.0.1:8080/ws";
  const brain = await makeBrain(env);
  if (brain.name === "scripted") {
    console.log("No Anthropic key: squads run on the scripted brain. It follows plain orders (hold, move, attack a point) and nothing more.");
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
