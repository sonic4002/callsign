// The player's own agents, in the player's own browser: Anvil and a leader for every
// squad, each in a Web Worker. The Workers think through the model relay with the player
// token and the seat token; the key itself lives on the relay and is never in this page
// after it is saved.
//
// This browser runs the agents only when it has a reason to: the relay holds a key for
// this seat, or the player chose the demo brain. Otherwise the side is left to whoever
// the server has (the agents on the server machine). The game server makes sure that
// only one host runs a side at a time; this one outranks the server's.

import { needsPlayer, newPlayer, relayKeys } from "/agents/brain-relay.mjs";
import { Host, RANK_BROWSER } from "/agents/host.mjs";

import { HIDDEN_LIMIT_MS, Throttle, Usage, wanted } from "./policy.js";
import { forgetPlayer, playerToken } from "./seat.js";
import { WorkerAgent } from "./worker-agent.js";

const RELAY = "/relay/v1";

// tidy makes the relay's answer about a key what the page shows: the hint is the key's last
// characters alone (the relay writes an ellipsis in front), and nothing is ever null.
const tidy = (key) => ({ provider: key?.provider ?? "", set: Boolean(key?.set), hint: String(key?.hint ?? "").replace(/^…/, "") });

export class BrowserAgents {
  // seat() gives the seat this page holds right now, from the lobby: { room, token }, with
  // an empty room for the open room of a server without seats, or null for none.
  // say(what, vars, tone) writes a line for the player; onChange() redraws whatever shows
  // this object's state.
  constructor({ server, side, seat, canAct, say = () => {}, onChange = () => {} }) {
    Object.assign(this, { server, side, seat, canAct, say, onChange });
    this.player = null; // this browser's token on the relay, once it has one
    this.sat = ""; // the seat the running host joined with
    this.blocked = ""; // why the stored key cannot be used (a trouble code), until it is changed
    this.key = { provider: "", set: false, hint: "" };
    this.relayUp = null; // null until the relay has been asked
    this.demo = localStorage.getItem("callsign.agents") === "demo";
    this.mode = null; // what runs here now: "relay", "scripted" or null
    this.host = null;
    this.usage = new Usage();
    this.throttle = new Throttle();
    this.hiddenLong = false;
    document.addEventListener("visibilitychange", () => this.#visibility());
  }

  // Where the side's thinking happens right now, for the dialog.
  get status() {
    if (this.mode && this.host && !this.host.active) return "standby";
    return this.mode === "relay" ? "relay" : this.mode === "scripted" ? "demo" : "server";
  }

  get workers() {
    return this.host?.active ? this.host.agents.size : 0;
  }

  // refresh asks the relay whether a key is set for this seat, then starts or stops the
  // agents to match.
  async refresh() {
    try {
      this.key = tidy(await (await this.#keys()).get());
      this.relayUp = true;
    } catch (err) {
      if (err.code === "not_your_seat" && this.player) {
        // The relay no longer takes this browser's token; the next look gets a new one.
        forgetPlayer();
        this.player = null;
      }
      this.key = { provider: "", set: false, hint: "" };
      this.relayUp = err.code !== "unreachable" && err.code !== "bad_request";
    }
    await this.sync();
  }

  // #keys is the player's key on the relay, under this browser's player token.
  async #keys() {
    this.player ??= await playerToken({ ask: () => newPlayer({ base: RELAY }) });
    return relayKeys({ base: RELAY, token: this.player });
  }

  async saveKey(provider, key) {
    this.key = tidy(await (await this.#keys()).set(provider, key));
    this.blocked = "";
    await this.sync(true);
  }

  async removeKey() {
    this.key = tidy(await (await this.#keys()).remove());
    this.blocked = "";
    await this.sync();
  }

  async setDemo(on) {
    this.demo = on;
    localStorage.setItem("callsign.agents", on ? "demo" : "auto");
    await this.sync();
  }

  // newMatch is called on every greeting from the game server.
  newMatch(match) {
    if (this.usage.match !== match) this.usage.reset(match);
    this.onChange();
  }

  // sync brings what runs here in line with what should. `restart` forces new Workers,
  // for a key that changed under a running host.
  async sync(restart = false) {
    const seat = this.seat();
    const sat = seat ? `${seat.room}/${seat.token ?? ""}` : "";
    // A key the provider turned down is not tried again until the player changes it.
    const key = this.blocked ? { set: false } : this.key;
    // In the first lesson the squads always think here with the scripted brain: the game
    // server sends none of its own agents to a lesson, and a lesson spends nobody's key.
    const want = wanted({ canAct: this.canAct() && seat !== null, demo: this.demo || Boolean(seat?.lesson), key, hiddenLong: this.hiddenLong, seated: Boolean(seat?.room && seat.token && this.player) });
    // A host joined for another seat is of no use: a new match means a new host.
    if (want === this.mode && sat === this.sat && !restart) return this.onChange();
    this.sat = sat;
    this.#stop();
    this.mode = want;
    if (want) await this.#start(want);
    else if (!this.hiddenLong) this.say("server");
    this.onChange();
  }

  async #start(mode) {
    const seat = this.seat();
    const brain = mode === "relay" ? { kind: "relay", base: RELAY, room: seat.room, token: this.player, seat: seat.token } : { kind: "scripted" };
    const hooks = {
      log: (text) => console.debug(`[agents] ${text}`),
      usage: (usage, model) => {
        this.usage.add(usage, model);
        this.onChange();
      },
      trouble: (code) => this.#trouble(code),
    };
    const host = new Host({
      server: this.server,
      side: this.side,
      rank: RANK_BROWSER,
      brain: { name: mode },
      // The seat token is what lets this browser run its own side's agents, and what
      // makes the game server rank it above the agents run on the server machine.
      join: seat.room ? { room: seat.room, token: seat.token } : {},
      log: hooks.log,
      spawn: (options) => new WorkerAgent(options, brain, hooks),
    });
    host.onChange = host.onAgents = () => this.onChange();
    this.host = host;
    try {
      await host.start();
      this.say(mode === "relay" ? "relay" : "demo", { provider: this.key.provider });
      // If the game server drops us while we still mean to run, come back.
      host.closed.then(() => {
        if (this.host !== host) return;
        this.#stop();
        this.mode = null;
        setTimeout(() => this.sync(), 1500);
      });
    } catch {
      this.#stop();
      this.mode = null;
    }
  }

  #stop() {
    const host = this.host;
    this.host = null;
    host?.stop();
  }

  // A wake that could not be thought was skipped. Most of the time that passes by itself;
  // when only the player can fix it, the side goes back to the server's agents.
  async #trouble(code) {
    if (needsPlayer.has(code) && this.mode === "relay") {
      // Only the player can mend this. The side goes back to the server's agents, and
      // stays there until the key is saved again or removed.
      this.blocked = code;
      this.say("stopped", { code }, "warn");
      await this.sync();
      return;
    }
    if (this.throttle.pass(code)) this.say("skipped", { code }, "warn");
  }

  #visibility() {
    clearTimeout(this.hideTimer);
    if (document.hidden) {
      this.hideTimer = setTimeout(() => this.#hidden(true), HIDDEN_LIMIT_MS);
    } else if (this.hiddenLong) {
      this.#hidden(false);
    }
  }

  async #hidden(long) {
    const ran = this.mode;
    this.hiddenLong = long;
    if (long && ran) this.say("paused", {}, "warn");
    await this.sync();
  }
}
