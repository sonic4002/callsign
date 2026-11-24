// One agent in a Web Worker: the operator or a squad leader, in the player's browser.
// The page's host (client/agents/host.js) starts one Worker per station and talks to it
// in small messages. The Worker holds the seat token, never the player's key.
//
//   page → worker   { type: "start", server, side, role, squad, join, standByMs,
//                     brain: { kind: "relay", base, room, token } | { kind: "scripted" } }
//                   { type: "stop" }
//   worker → page   { type: "joined", station }      on the net
//                   { type: "log", text }
//                   { type: "usage", usage, model, provider }
//                   { type: "trouble", code, message }   a wake was skipped, and why
//                   { type: "stopped" }               the server closed the connection

import { Agent } from "./agent.mjs";
import { RelayError, relayBrain } from "./brain-relay.mjs";
import { scriptedBrain } from "./brain-scripted.mjs";

const post = (message) => self.postMessage(message);
let agent = null;

function makeBrain(spec) {
  if (spec.kind === "scripted") return scriptedBrain();
  if (spec.kind === "relay") {
    return relayBrain({ base: spec.base, room: spec.room, token: spec.token, onUsage: (usage, model, provider) => post({ type: "usage", usage, model, provider }) });
  }
  throw new Error(`unknown brain "${spec.kind}"`);
}

self.addEventListener("message", async ({ data }) => {
  if (data.type === "stop") {
    agent?.stop();
    self.close();
    return;
  }
  if (data.type !== "start" || agent) return;
  try {
    agent = new Agent({
      server: data.server, side: data.side, role: data.role, squad: data.squad, join: data.join, standByMs: data.standByMs,
      brain: makeBrain(data.brain),
      log: (text) => post({ type: "log", text }),
    });
    agent.onStop = () => post({ type: "stopped" });
    agent.onTrouble = (err) => post({ type: "trouble", code: err instanceof RelayError ? err.code : "failed", message: err.message });
    await agent.start();
    post({ type: "joined", station: agent.me });
  } catch (err) {
    post({ type: "trouble", code: "join", message: err.message });
    post({ type: "stopped" });
  }
});
