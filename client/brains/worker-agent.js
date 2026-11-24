// One agent as the page's host sees it: a Web Worker running agents/worker.mjs. It has the
// same shape as the Agent the Node host runs in its own thread (start, stop, me, name),
// so agents/host.mjs drives both alike.

export class WorkerAgent {
  // options are what Host hands every agent; brain is what the Worker should think with:
  // { kind: "relay", base, room, token }, { kind: "jev", ... } or { kind: "rule" }. hooks: log(text),
  // usage(usage, model, provider), trouble(code, message, agent).
  constructor(options, brain, hooks = {}, { Worker = globalThis.Worker, script = "/agents/worker.mjs" } = {}) {
    Object.assign(this, { options, brain, hooks, Worker, script });
    this.me = null;
    this.stopped = false;
  }

  get name() {
    return this.me?.en ?? this.options.role;
  }

  // start resolves once the agent is on the net, and rejects if it could not join.
  start() {
    return new Promise((resolve, reject) => {
      this.worker = new this.Worker(this.script, { type: "module", name: `${this.options.role}${this.options.squad || ""}` });
      this.worker.addEventListener("message", ({ data }) => {
        if (data.type === "joined") {
          this.me = data.station;
          resolve(this);
        } else if (data.type === "log") {
          this.hooks.log?.(data.text);
        } else if (data.type === "usage") {
          this.hooks.usage?.(data.usage, data.model, data.provider);
        } else if (data.type === "trouble") {
          this.lastTrouble = data;
          this.hooks.trouble?.(data.code, data.message, this);
        } else if (data.type === "stopped") {
          const joined = Boolean(this.me);
          this.#end();
          if (!joined) reject(new Error(this.lastTrouble?.message ?? "the agent could not join"));
        }
      });
      this.worker.addEventListener("error", (ev) => {
        this.#end();
        reject(new Error(ev.message || "the agent's worker failed to load"));
      });
      const { server, side, role, squad, join, standByMs } = this.options;
      this.worker.postMessage({ type: "start", server, side, role, squad, join, standByMs, brain: this.brain });
    });
  }

  stop() {
    if (this.stopped) return;
    // The Worker closes its connection and itself; terminate is the backstop.
    this.worker?.postMessage({ type: "stop" });
    const worker = this.worker;
    setTimeout(() => worker?.terminate(), 300);
    this.stopped = true;
  }

  #end() {
    this.stopped = true;
    this.worker?.terminate();
  }
}
