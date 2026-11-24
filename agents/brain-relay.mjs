// The relay brain: the way agents think in the shipped game. An agent never calls a model
// itself. It posts its prompt to the model relay, which looks up the squad's brain tier on
// the game server, picks the model, and calls the provider with the player's own key.
// This side holds only the seat token, never the key.
//
//   POST {base}/think   Authorization: Bearer <seat token>
//        { room, side, role, squad, system, tools, messages }
//     →  { content, stop_reason, usage: { input_tokens, output_tokens }, model, provider }
//     or { error: { code, message } }
//
// It runs unchanged in Node and in a Web Worker: it needs only fetch.

// What a failed call means for the agent. A wake that cannot be thought is skipped; the
// squad keeps its last order and the next wake tries again.
export class RelayError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = "RelayError";
    this.code = code;
    this.status = status;
  }
}

// Worth another try in a moment: the provider or the network hiccuped.
const transient = new Set(["rate_limited", "provider_error", "unreachable"]);
// Nothing will change until the player does something about their key or seat.
export const needsPlayer = new Set(["no_key", "bad_key", "not_your_seat"]);

const plain = {
  no_key: "no AI key is set for this seat",
  bad_key: "the provider rejected the AI key",
  rate_limited: "the provider is rate limiting this key",
  provider_error: "the AI provider failed",
  not_your_seat: "the relay does not accept this seat",
  bad_request: "the relay did not accept the request",
  unreachable: "the relay cannot be reached",
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// call makes one request to the relay and returns the parsed answer, or throws RelayError.
export async function call(fetcher, url, { method = "GET", token, body, timeoutMs = 45_000 } = {}) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  let res;
  let data = null;
  try {
    res = await fetcher(url, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: abort.signal,
    });
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Not the relay talking: a proxy's error page, or no relay at this address.
    }
  } catch (err) {
    throw new RelayError("unreachable", abort.signal.aborted ? "the relay did not answer in time" : plain.unreachable);
  } finally {
    clearTimeout(timer);
  }
  if (data?.error?.code) {
    const err = new RelayError(data.error.code, data.error.message || plain[data.error.code] || data.error.code, res.status);
    err.retryAfter = Number(res.headers?.get?.("retry-after")) || 0;
    throw err;
  }
  if (!res.ok || data === null) {
    // 404 and gateway errors mean there is no relay behind this address right now.
    throw new RelayError(res.status === 404 || res.status >= 502 ? "unreachable" : "provider_error", `the relay answered ${res.status}`, res.status);
  }
  return data;
}

// relayBrain is a brain like the others: think() returns { content, stop_reason, usage, model }.
// onUsage(usage, model, provider) is told what every answered call cost.
export function relayBrain({ base = "/relay/v1", room, token, fetch: fetcher = (...a) => globalThis.fetch(...a), retries = 2, backoffMs = 500, timeoutMs, onUsage, sleep = wait }) {
  return {
    name: "relay",
    slow: true,
    async think({ agent, system, tools, messages }) {
      const body = { room, side: agent.side, role: agent.role, squad: agent.squad ?? 0, system, tools, messages };
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await call(fetcher, `${base}/think`, { method: "POST", token, body, timeoutMs });
          if (!Array.isArray(res.content)) throw new RelayError("provider_error", "the relay's answer has no content");
          if (res.usage) onUsage?.(res.usage, res.model, res.provider);
          return { content: res.content, stop_reason: res.stop_reason, stop_details: res.stop_details, usage: res.usage, model: res.model };
        } catch (err) {
          if (!(err instanceof RelayError) || !transient.has(err.code) || attempt >= retries) throw err;
          // Back off, a little longer each time, and never longer than a fight can wait.
          await sleep(Math.min(5000, Math.max(err.retryAfter * 1000 || 0, backoffMs * 2 ** attempt)));
        }
      }
    },
  };
}

// The player's key on the relay. The key goes up once and never comes back: the relay
// answers only whether one is set, for which provider, and its last characters.
export function relayKeys({ base = "/relay/v1", token, fetch: fetcher = (...a) => globalThis.fetch(...a) }) {
  return {
    get: () => call(fetcher, `${base}/key`, { token, timeoutMs: 8000 }),
    set: (provider, key) => call(fetcher, `${base}/key`, { method: "PUT", token, body: { provider, key }, timeoutMs: 20_000 }),
    remove: () => call(fetcher, `${base}/key`, { method: "DELETE", token, timeoutMs: 8000 }),
  };
}
