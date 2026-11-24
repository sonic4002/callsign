// Runs the agents: Anvil and a leader for every squad of every side a person commands,
// in every match on the server, starting and stopping leaders as squads are bought and lost.
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
//   CALLSIGN_AGENT_KEY      the server's agent key (its -agent-key), when it has one
//   CALLSIGN_SIDE           0 or 1: serve only that side of one room (CALLSIGN_ROOM, or the
//                           open room). Unset: serve every side a person commands, in every room.
//   CALLSIGN_OPERATOR       "0" to play without Anvil
//   CALLSIGN_OPERATOR_MODEL model id for Anvil (default: the top model)

import { Agent } from "./agent.mjs";
import { Link } from "./link.mjs";

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

// Host keeps one agent per station on a side in step with the match.
export class Host {
  // `join` names the room and shows the agent key: { room, key }. Empty for the open room.
  constructor({ server, side = 0, brain, operator = true, log = console.log, standByMs, join = {} }) {
    Object.assign(this, { server, side, brain, operator, log, standByMs, join });
    this.agents = new Map(); // squad id (0 for Anvil) → Agent
  }

  // start joins the match. `closed` resolves when the server drops the control connection.
  async start() {
    this.closed = new Promise((resolve) => (this.onClosed = resolve));
    // The control connection only listens: which squads exist, and when the match restarts.
    this.control = new Link(
      `${this.server}?${new URLSearchParams({ ...this.join, side: this.side, role: "anvil", state: "0" })}`,
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
    const agent = new Agent({ server: this.server, side: this.side, role, squad, brain: this.brain, log: this.log, standByMs: this.standByMs, join: this.join });
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

// Director serves every match on the server: it asks which sides have a person in the
// commander's seat and keeps a Host running for each, in every room.
export class Director {
  // brainFor({ room, side }) decides which brain a side thinks with. Today every side
  // gets the server machine's brain; a player's own key will come in through here.
  constructor({ server, key = "", brainFor, operator = true, log = console.log, standByMs, fetch = globalThis.fetch }) {
    Object.assign(this, { server, key, brainFor, operator, log, standByMs, fetch });
    this.rooms = `${server.replace(/^ws/, "http").replace(/\/ws$/, "")}/internal/rooms`;
    this.hosts = new Map(); // "ROOM:side" → Host
  }

  // sync asks the server once and starts and stops hosts to match. It resolves when the
  // new hosts have joined.
  async sync() {
    const res = await this.fetch(this.rooms, { headers: this.key ? { Authorization: `Bearer ${this.key}` } : {} });
    if (!res.ok) throw new Error(`the game server answered ${res.status} to the agent host`);
    const wanted = new Set((await res.json()).rooms.flatMap((r) => r.sides.map((side) => `${r.room}:${side}`)));
    for (const [id, host] of this.hosts) {
      if (wanted.has(id)) continue;
      host.stop();
      this.hosts.delete(id);
      this.log(`${id}: the commander is gone, agents stood down`);
    }
    await Promise.all([...wanted].filter((id) => !this.hosts.has(id)).map((id) => this.#start(id)));
  }

  async #start(id) {
    const [room, side] = [id.slice(0, id.lastIndexOf(":")), Number(id.slice(id.lastIndexOf(":") + 1))];
    const host = new Host({
      server: this.server,
      side,
      brain: await this.brainFor({ room, side }),
      operator: this.operator,
      log: (line) => this.log(`${id}: ${line}`),
      standByMs: this.standByMs,
      join: { room, ...(this.key ? { key: this.key } : {}) },
    });
    this.hosts.set(id, host);
    try {
      await host.start();
      // A host whose room went away or whose server restarted is forgotten; the next
      // sync starts it again if it is still wanted.
      host.closed.then(() => this.hosts.get(id) === host && this.hosts.delete(id));
    } catch (err) {
      this.hosts.delete(id);
      this.log(`${id}: could not join: ${err.message}`);
    }
  }

  stop() {
    for (const host of this.hosts.values()) host.stop();
    this.hosts.clear();
  }
}

if (import.meta.main) {
  const env = process.env;
  const server = env.CALLSIGN_SERVER || "ws://127.0.0.1:8080/ws";
  const brain = await makeBrain(env);
  if (brain.name === "scripted") {
    console.log("Squads run on the scripted brain. It follows plain orders (hold, move, attack a point) and nothing more.");
  }
  const operator = env.CALLSIGN_OPERATOR !== "0";
  // Without CALLSIGN_SIDE this process serves every match made in the lobby.
  if (env.CALLSIGN_SIDE === undefined) {
    // The scripted brain remembers its plans per station, so each side gets its own.
    const brainFor = async () => (brain.name === "scripted" ? scripted() : brain);
    const director = new Director({ server, key: env.CALLSIGN_AGENT_KEY || "", brainFor, operator });
    for (let down = false; ; ) {
      try {
        await director.sync();
        down = false;
      } catch (err) {
        if (!down) console.log(`waiting for the game server: ${err.message}`);
        down = true;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  // With CALLSIGN_SIDE: one side of one room, the open room unless CALLSIGN_ROOM names another.
  const join = { ...(env.CALLSIGN_ROOM ? { room: env.CALLSIGN_ROOM } : {}), ...(env.CALLSIGN_AGENT_KEY ? { key: env.CALLSIGN_AGENT_KEY } : {}) };
  for (;;) {
    const host = new Host({ server, side: Number(env.CALLSIGN_SIDE || 0), brain, operator, join });
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
