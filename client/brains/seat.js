// Which seat this browser sits in: the room it plays in and the token that proves the
// seat to the model relay. This one function is the seam to the lobby: when rooms and
// seat tokens are issued by the game server, they are handed over here and nothing else
// in the agent code changes.
//
// Until then: the room is "main" unless the address says ?room=…, and the token is a
// random one made in this browser and kept in its storage, so a key set on the relay
// stays with this browser. ?token=… in the address wins, for a seat given out by link.

const random = () => {
  const bytes = new Uint8Array(18);
  (globalThis.crypto ?? {}).getRandomValues?.(bytes) ?? bytes.forEach((_, i) => (bytes[i] = Math.floor(Math.random() * 256)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
};

export function seat({ query = new URLSearchParams(globalThis.location?.search ?? ""), store = globalThis.localStorage } = {}) {
  const room = query.get("room") || store?.getItem("callsign.room") || "main";
  let token = query.get("token") || store?.getItem("callsign.token");
  if (!token) {
    token = random();
    store?.setItem("callsign.token", token);
  }
  return { room, token };
}
