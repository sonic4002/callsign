// The lobby's dealings with the server: making a match, finding one by its join code and
// taking a seat in it. There are no accounts. A seat is held by the token the server
// hands out when it is taken; the token is kept in this browser so that a reload sits
// back down in the same seat.

const seatKey = (room) => `callsign.seat.${room}`;

// savedSeat is the seat this browser holds in a room: { side, token }, or null.
export function savedSeat(room) {
  try {
    const seat = JSON.parse(localStorage.getItem(seatKey(room)));
    return seat && typeof seat.token === "string" && (seat.side === 0 || seat.side === 1) ? seat : null;
  } catch {
    return null;
  }
}

export const saveSeat = (room, { side, token }) => localStorage.setItem(seatKey(room), JSON.stringify({ side, token }));
export const forgetSeat = (room) => localStorage.removeItem(seatKey(room));

// An answer the server refused carries its HTTP status, so the page can say why in the
// player's language.
async function call(method, path, body) {
  const res = await fetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { status: res.status });
  return data;
}

const at = (code) => `/api/rooms/${encodeURIComponent(code.trim().toUpperCase())}`;

// What this server offers: { factions: [west, east], bot, levels, level, length, share, open }.
export const serverInfo = () => call("GET", "/api/server");
// createRoom({ opponent: "bot" | "friend", side: 0 | 1 | -1, length, watch, bot: "easy" | "normal" | "standard" | "" })
//   → { room, side, token, share, lobby }
export const createRoom = (options) => call("POST", "/api/rooms", options);
// roomInfo(code) → { lobby, share }
export const roomInfo = (code) => call("GET", at(code));
// takeSeat(code) takes whichever seat is free → { room, side, token, share, lobby }
export const takeSeat = (code, side) => call("POST", `${at(code)}/seat`, side === undefined ? {} : { side });

// pageFor is this page's address for a room and side, keeping the chosen language.
export function pageFor({ room, side, role }, from = location) {
  const keep = new URLSearchParams(from.search);
  const query = new URLSearchParams();
  if (keep.has("lang")) query.set("lang", keep.get("lang"));
  if (room) query.set("room", room);
  if (room && side !== undefined) query.set("side", side);
  if (role) query.set("role", role);
  const text = query.toString();
  return from.pathname + (text ? `?${text}` : "");
}

// The link a friend opens. The server's own idea of its address wins: a page opened as
// "localhost" cannot know what other machines call this one.
export function shareLink(room, share, from = location) {
  return `${share || from.origin}/?room=${room}`;
}

export const onlyThisMachine = (from = location) => ["localhost", "127.0.0.1", "[::1]"].includes(from.hostname);

// The seat a person would get by joining: the first one that is neither a bot's nor taken.
export function freeSeat(lobby) {
  const taken = lobby.seats.filter((s) => s.taken).length;
  if (lobby.opponent !== "friend" && taken > 0) return null; // against the scripted enemy there is one seat
  return lobby.seats.find((s) => !s.bot && !s.taken) ?? null;
}
