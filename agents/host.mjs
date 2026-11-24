// Host keeps one agent per station on a side in step with the match: the operator, and a
// leader for every squad, started and stopped as squads deploy and are lost.
//
// The same class runs in Node (agents/main.mjs) and in the player's browser, where each
// agent lives in its own Web Worker (client/agents/host.js). Only `spawn` differs.
//
// Several hosts may be connected for one side; the game server lets one of them run the
// agents and tells each where it stands in its greeting (`active`). A host standing by
// runs nothing and takes over when the server says so.

import { Agent } from "./agent.mjs";
import { Link } from "./link.mjs";

export const RANK_SERVER = 1; // agents run for the player on the server machine
export const RANK_BROWSER = 2; // the player's own browser outranks them

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export class Host {
  // spawn(options) makes one agent: an object with start(), stop() and, once it has
  // joined, `me` (its station) and `name`. The default runs it in this thread.
  constructor({ server, side = 0, brain, operator = true, log = console.log, standByMs, id = newId(), rank = RANK_SERVER, join = {}, spawn = (options) => new Agent(options), link = (...args) => new Link(...args) }) {
    Object.assign(this, { server, side, brain, operator, log, standByMs, id, rank, join, spawn, link });
    this.agents = new Map(); // squad id (0 for Anvil) → agent
    this.active = false;
    this.match = null;
  }

  // start joins the match. `closed` resolves when the server drops the control connection.
  async start() {
    this.closed = new Promise((resolve) => (this.onClosed = resolve));
    // The control connection only listens: which squads exist, when the match restarts,
    // and whether this host is the one running the side.
    this.control = this.link(
      `${this.server}?${new URLSearchParams({ ...this.join, side: this.side, role: "host", host: this.id, rank: this.rank, state: "0" })}`,
      (frame) => this.#onFrame(frame),
      () => {
        this.#stopAgents();
        this.active = false;
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
    this.#stopAgents();
    this.control?.close();
  }

  #stopAgents() {
    for (const agent of this.agents.values()) agent.stop();
    this.agents.clear();
  }

  #onFrame(frame) {
    if (frame.type === "hello") {
      // A greeting is a clean slate: a new match, or a change in who runs the side.
      this.#stopAgents();
      const was = this.active;
      this.active = frame.active !== false;
      this.match = frame.match;
      if (this.active) {
        this.log(`match ${frame.match}: side ${this.side} (${frame.faction}), brain: ${this.brain?.name ?? "none"}`);
        if (this.operator) this.#add("anvil", 0);
        for (const sq of frame.state.squads) this.#add("squad", sq.id);
      } else {
        this.log(`side ${this.side}: another host runs the agents; standing by`);
      }
      if (was !== this.active || frame.match !== undefined) this.onChange?.({ active: this.active, match: frame.match });
    } else if (!this.active) {
      // Standing by: the match goes on without us.
    } else if (frame.type === "event" && frame.event.kind === "squad_spawned") {
      this.#add("squad", frame.event.squad);
    } else if (frame.type === "event" && frame.event.kind === "squad_lost") {
      this.agents.get(frame.event.squad)?.stop();
      this.agents.delete(frame.event.squad);
      this.onAgents?.();
    }
  }

  async #add(role, squad) {
    if (this.agents.has(squad)) return;
    const agent = this.spawn({
      server: this.server, side: this.side, role, squad, brain: this.brain, log: this.log, standByMs: this.standByMs,
      join: { ...this.join, host: this.id },
    });
    this.agents.set(squad, agent);
    this.onAgents?.();
    try {
      await agent.start();
      this.log(`${agent.name} is on the net`);
    } catch (err) {
      if (this.agents.get(squad) === agent) this.agents.delete(squad);
      this.log(`could not start the agent for ${role} ${squad || ""}: ${err.message}`);
    }
    this.onAgents?.();
  }
}
