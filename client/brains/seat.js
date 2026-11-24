// Who this browser is to the model relay: a player token the relay made, kept in this
// browser so that a key stored on the relay stays with it from one match to the next.
// The seat in a match (its room code and seat token) comes from the lobby, not from here.

const KEY = "callsign.player";

// playerToken returns the kept token, or asks the relay for one (`ask`, newPlayer of
// agents/brain-relay.mjs) and keeps it. It throws what `ask` throws when there is no relay.
export async function playerToken({ store = globalThis.localStorage, ask }) {
  const kept = store?.getItem(KEY);
  if (kept) return kept;
  const token = await ask();
  store?.setItem(KEY, token);
  return token;
}

// forgetPlayer drops a token the relay no longer takes (its signing key changed), so the
// next call gets a new one.
export const forgetPlayer = (store = globalThis.localStorage) => store?.removeItem(KEY);
