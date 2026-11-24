// Small decisions about places and the lobby's choices, kept apart from the page so they
// can be tested without one.

// parseOffset reads the written form of a spot off a point, "NE of D 150", as
// { bearing, point, metres }, or null when the text is something else.
export function parseOffset(place) {
  const m = /^(N|NE|E|SE|S|SW|W|NW) of ([A-Z]) (\d+)$/.exec(place ?? "");
  return m ? { bearing: m[1], point: m[2], metres: Number(m[3]) } : null;
}

// ordersFor lists the orders the map offers on a tapped thing, in the order of the buttons.
// A landmark is somewhere to be; a bridge and a point can also be attacked.
export function ordersFor(kind) {
  return kind === "landmark" ? ["hold", "move", "cover"] : ["hold", "move", "attack"];
}

// seatState is one word for a seat in the waiting room, which the page colours by.
export function seatState(seat) {
  if (seat.bot) return "bot";
  if (!seat.taken) return "empty";
  if (!seat.online) return "offline";
  return seat.ready ? "ready" : "taken";
}

// startGold is the gold a match maker chose: a preset, or the number typed under "other"
// held to the server's limits. It returns 0, the server's own default, for nonsense.
export function startGold(choice, typed, { min = 100, max = 20000 } = {}) {
  const n = Math.round(Number(choice === "other" ? typed : choice));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(min, Math.min(max, n));
}

// matchLengths are the lengths the lobby offers, in seconds, with the server's usual one
// among them.
export function matchLengths(usual) {
  return [...new Set([300, 600, 900, 1200, usual])].filter((s) => s > 0).sort((a, b) => a - b);
}
