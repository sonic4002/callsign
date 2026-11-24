// A stand-in for the model relay, for tests and for running the browser agents with no
// provider at all. It speaks the relay's contract (see brain-relay.mjs) and answers every
// thought with the scripted brain, so nothing here costs anything or leaves the machine.
//
//   node agents/fake-relay.mjs [port]        (default 8090; then start the game server
//                                              with -relay=http://127.0.0.1:8090)
//
// It keeps "keys" in memory only, per seat token, and never stores more of one than the
// provider and its last four characters. Any non-empty key is accepted, except one that
// contains "bad", which is refused the way a provider would refuse it.

import { readFileSync } from "node:fs";
import { createServer } from "node:http";

import { scriptedBrain } from "./brain-scripted.mjs";

const providers = new Set(["anthropic", "openrouter", "gemini", "openai"]);
const status = { bad_request: 400, not_your_seat: 401, bad_key: 401, no_key: 409, rate_limited: 429, provider_error: 502 };

// ctxFrom rebuilds what the scripted brain reads from what an agent sends the relay: the
// wake text of the last user message, and the status line inside it.
function ctxFrom(body, rules, key) {
  const wakeText = body.messages.findLast((m) => typeof m.content === "string")?.content ?? "";
  const cs = rules.callsigns;
  const said = /Radio call for you from (.+?), in (Hebrew|English): "(.*)"(?: Points named: ([^.]*)\.)?$/m.exec(wakeText);
  let call = null;
  if (said) {
    const [, from, language, text, points] = said;
    const low = text.toLowerCase();
    const check = rules.radio.prowords.radioCheck;
    call = {
      from: { en: from, key: from === cs.player.en ? "player" : from === cs.operator.en ? "operator" : "squad" },
      lang: language === "Hebrew" ? "he" : "en",
      text,
      body: text,
      points: points ? points.split(",").map((p) => p.trim()) : [],
      prowords: [...check.en, ...check.he].some((w) => low.includes(w)) ? ["radioCheck"] : [],
    };
  }
  let compact = null;
  try {
    compact = JSON.parse(/^Status: (.*)$/m.exec(wakeText)?.[1] ?? "null");
  } catch {
    // No status this wake.
  }
  const faction = Object.keys(rules.factions).find((id) => body.system.includes(rules.factions[id].name.en)) ?? "";
  const statusView = compact && {
    faction,
    gold: compact.gold ?? 0,
    contacts: compact.contacts ?? [],
    squads: (compact.squads ?? []).map((s) => ({ ...s, callsign: { en: s.callsign } })),
    points: Object.entries(compact.points ?? {}).map(([id, who]) => ({ id, owner: who === "yours" ? body.side : who === "enemy" ? 1 - body.side : -1 })),
  };
  return {
    agent: { role: body.role, side: body.side, squad: body.squad, station: { key }, lang: call?.lang ?? "en", commander: call?.from.en },
    system: body.system,
    tools: body.tools,
    messages: body.messages,
    wake: { items: [], status: statusView, call },
    rules,
  };
}

// fakeRelay returns a server that is not listening yet, with a few test levers:
//   relay.failNext(code, times)   answer the next thoughts with this error
//   relay.calls                   every think request body received
//   relay.keys                    seat token → { provider, hint }
export function fakeRelay({ rules = JSON.parse(readFileSync(new URL("../shared/rules.json", import.meta.url), "utf8")), tokens = null } = {}) {
  const brain = scriptedBrain();
  const sent = new Map(); // tool_use id → the block as the brain made it (with its fallback)
  const keys = new Map();
  const calls = [];
  let failing = { code: "", times: 0 };

  const answer = (res, code, body, headers = {}) => {
    res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin", ...headers });
    res.end(JSON.stringify(body));
  };
  const refuse = (res, code, message, headers) => answer(res, status[code], { error: { code, message } }, headers);

  async function think(res, token, body) {
    if (typeof body.system !== "string" || !Array.isArray(body.messages) || !Array.isArray(body.tools) || !["anvil", "squad"].includes(body.role)) {
      return refuse(res, "bad_request", "think needs role, system, tools and messages");
    }
    calls.push(body);
    if (failing.times > 0) {
      failing.times--;
      return refuse(res, failing.code, `injected ${failing.code}`, failing.code === "rate_limited" ? { "Retry-After": "0" } : {});
    }
    const mine = keys.get(token);
    if (!mine) return refuse(res, "no_key", "no key is set for this seat");
    const seat = `${body.room ?? ""}/${token}/${body.role}/${body.squad ?? 0}`;
    // The brain's fallbacks ride on its own blocks, which do not survive the wire.
    const messages = body.messages.map((m) => (Array.isArray(m.content) ? { ...m, content: m.content.map((b) => sent.get(b.id) ?? b) } : m));
    const out = await brain.think(ctxFrom({ ...body, messages }, rules, seat));
    for (const block of out.content) if (block.type === "tool_use") sent.set(block.id, block);
    const size = (v) => Math.ceil(JSON.stringify(v).length / 4);
    answer(res, 200, {
      content: out.content.map(({ orElse, ...block }) => block),
      stop_reason: out.stop_reason,
      usage: { input_tokens: size([body.system, body.messages]), output_tokens: size(out.content) },
      model: "scripted",
      provider: mine.provider,
    });
  }

  const server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://relay").pathname.replace(/^\/relay/, "");
    if (req.method === "OPTIONS") {
      return answer(res, 204, {}, { "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE" });
    }
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
    if (!token || (tokens && !tokens.has(token))) return refuse(res, "not_your_seat", "this seat token is not known here");
    let body = {};
    if (req.method === "PUT" || req.method === "POST") {
      let text = "";
      for await (const chunk of req) text += chunk;
      try {
        body = JSON.parse(text);
      } catch {
        return refuse(res, "bad_request", "the body is not JSON");
      }
    }
    if (path === "/v1/key" && req.method === "GET") {
      const mine = keys.get(token);
      return answer(res, 200, mine ? { provider: mine.provider, set: true, hint: mine.hint } : { provider: "", set: false, hint: "" });
    }
    if (path === "/v1/key" && req.method === "PUT") {
      if (!providers.has(body.provider) || typeof body.key !== "string" || !body.key.trim()) return refuse(res, "bad_request", "a provider and a key are needed");
      if (body.key.includes("bad")) return refuse(res, "bad_key", "the provider rejected this key");
      const hint = body.key.trim().slice(-4);
      keys.set(token, { provider: body.provider, hint });
      return answer(res, 200, { provider: body.provider, set: true, hint });
    }
    if (path === "/v1/key" && req.method === "DELETE") {
      keys.delete(token);
      return answer(res, 200, { provider: "", set: false, hint: "" });
    }
    if (path === "/v1/think" && req.method === "POST") return think(res, token, body);
    refuse(res, "bad_request", `no such relay call: ${req.method} ${path}`);
  });

  return Object.assign(server, {
    keys,
    calls,
    failNext: (code, times = 1) => (failing = { code, times }),
    // up resolves with the base address once the server is up.
    up: (port = 0, host = "127.0.0.1") => new Promise((resolve) => server.listen(port, host, () => resolve(`http://${host}:${server.address().port}/relay/v1`))),
  });
}

if (import.meta.main) {
  const port = Number(process.argv[2] ?? process.env.CALLSIGN_RELAY_PORT ?? 8090);
  const base = await fakeRelay().up(port, process.env.CALLSIGN_RELAY_HOST ?? "127.0.0.1");
  console.log(`fake relay: listening at ${base}. Every thought is answered by the scripted brain; no provider is called.`);
}
