// How a thing on the map moves on screen between the places the server reports.
//
// The server says where every team is a few times a second. Drawn straight, a team would
// jump; eased toward its place and nothing more, it slides, snaps round to a new heading
// and its legs keep pace with nothing. Here each one keeps a speed, a heading it turns
// toward, and the distance it has covered, so the drawing can match feet, wheels, dust and
// wake to the ground.

// What each kind of mover may do: how fast it turns (radians a second), and the speed, in
// map units a second, at which it counts as fully under way.
export const movers = {
  foot: { turn: 9, cruise: 22 },
  wheels: { turn: 3.2, cruise: 30 },
  boat: { turn: 2.2, cruise: 34 },
  air: { turn: 2.6, cruise: 40 },
  jet: { turn: 5.5, cruise: 110 }, // a strike aircraft: it never hangs in the air, and turns for home in a moment
};

const TAU = Math.PI * 2;

// nearer brings angle `from` toward `to` by at most `step`, the short way round.
export function nearer(from, to, step) {
  const d = ((((to - from) % TAU) + TAU + Math.PI) % TAU) - Math.PI;
  return Math.abs(d) <= step ? to : from + Math.sign(d) * step;
}

// advance moves one thing for one frame. `v` holds where it is drawn (x, y), where the
// server has it (tx, ty) and the direction it faces on screen (turn); `toward` is the
// screen direction of its target. It fills in:
//   moving    under way, with a little stickiness so it does not flicker at a halt
//   speed     map units a second, smoothed
//   go        0 at rest to 1 at its cruising speed: how hard everything about it animates
//   stride    the distance covered since it appeared, for frames that keep pace with it
//   turnRate  radians a second it is turning, negative to the left
export function advance(v, dt, kind, toward) {
  const mover = movers[kind] ?? movers.foot;
  const dx = v.tx - v.x;
  const dy = v.ty - v.y;
  const gap = Math.hypot(dx, dy);
  const ease = 1 - Math.exp(-dt * 9);
  const step = gap * ease;
  v.x += dx * ease;
  v.y += dy * ease;

  // Speed is smoothed over about a fifth of a second, so one late report is not a lurch.
  const now = dt > 0 ? step / dt : 0;
  const blend = 1 - Math.exp(-dt * 6);
  v.speed = (v.speed ?? 0) + (now - (v.speed ?? 0)) * blend;
  v.moving = v.moving ? v.speed > 2.2 && gap > 0.5 : v.speed > 5 && gap > 1.2;
  v.go = Math.max(0, Math.min(1, v.speed / mover.cruise));
  v.stride = (v.stride ?? 0) + step;

  const before = v.turn;
  if (v.moving && gap > 1.2) v.turn = nearer(v.turn, toward, mover.turn * dt);
  const turned = ((((v.turn - before) % TAU) + TAU + Math.PI) % TAU) - Math.PI;
  const rate = dt > 0 ? turned / dt : 0;
  v.turnRate = (v.turnRate ?? 0) + (rate - (v.turnRate ?? 0)) * blend;
  return v;
}

// spreadOut sets where each of a squad's teams is drawn (px, py): its true place moved away
// from the middle of the squad by `factor`. At 1 a team is drawn where it is.
export function spreadOut(visuals, factor) {
  if (visuals.length === 0) return;
  let cx = 0;
  let cy = 0;
  for (const v of visuals) {
    cx += v.x;
    cy += v.y;
  }
  cx /= visuals.length;
  cy /= visuals.length;
  for (const v of visuals) {
    v.px = cx + (v.x - cx) * factor;
    v.py = cy + (v.y - cy) * factor;
  }
}
