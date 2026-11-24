// The first lesson, as data: its steps in order, and when each one is over.
//
// Nothing here touches the page. A step is over when the player has really done the thing,
// read from the match itself: the server's state for this side and the radio log. So a
// reload, or doing two things at once, never leaves the lesson stuck or out of step.
//
// What a step looks at (`c`):
//   side       the learner's side
//   state      the server's snapshot for that side (squads, deploying, points, contacts)
//   log        every radio message of the match so far, oldest first
//   selected   id of the squad picked on the map or in the list, 0 for none
//   destroyed  an enemy squad has been destroyed
//   rules      the rules, for the map and the names
//
// A step is one of two kinds. One the player acts in ends by itself, when `done(c)`. One
// the player only reads (`manual`) ends on Next, which is offered once `ready(c)`.

const mine = (c) => (c.state?.squads ?? []).filter((sq) => sq.side === c.side);
const said = (c, test) => (c.log ?? []).some(test);

// ordered: the commander has called a squad on the radio.
export const ordered = (c) => said(c, (m) => m.from?.key === "player" && (m.to ?? []).some((to) => to.squad));
// answered: a squad has answered the commander.
export const answered = (c) => said(c, (m) => Boolean(m.from?.squad) && (m.to ?? []).some((to) => to.key === "player"));
// holds: this side holds the point.
export const holds = (c, id) => (c.state?.points ?? []).some((p) => p.id === id && p.owner === c.side);
// stands: this side has a finished structure of a role (a refinery, a barracks).
export const stands = (c, role) => (c.state?.structures ?? []).some((s) => s.side === c.side && s.role === role && !s.ruin && s.building >= 1);
// placed: this side has put a structure of a role on the map, standing or still going up.
export const placed = (c, role) => (c.state?.structures ?? []).some((s) => s.side === c.side && s.role === role && !s.ruin);
// hauling: the refinery stands and its hauler has come out of it.
export const hauling = (c) => stands(c, "refinery") && (c.state?.haulers ?? []).some((h) => h.side === c.side);
// bought: a squad beyond the ones the match started with is on its way or in the field.
export const bought = (c) => mine(c).length + (c.state?.deploying ?? []).filter((d) => d.side === c.side).length > startSquads(c);
// arrived: that squad has reached the field.
export const arrived = (c) => mine(c).length > startSquads(c);
// upgraded: one of the squads has a brain above the first tier.
export const upgraded = (c) => mine(c).some((sq) => sq.tier > 1);
// engaged: a squad was sent at an enemy squad by its name, or the enemy is already beaten.
export const engaged = (c) => {
  const name = c.rules?.callsigns.contact;
  const named = name ? new RegExp(`(?:${name.en}|${name.he})\\s*#?\\d`, "i") : null;
  return Boolean(c.destroyed) || mine(c).some((sq) => sq.order?.contact > 0) || (named !== null && said(c, (m) => m.from?.key === "player" && named.test(m.text ?? "")));
};

// How many squads a side starts with: the lesson's "you bought one" is measured from it.
export function startSquads(c) {
  const faction = c.state?.faction ?? "";
  return c.rules?.factions[faction]?.startUnits.length ?? 2;
}

// nearest gives the id of the point of a kind closest to a side's headquarters, skipping
// `skip` of them: the land rig to capture, the first point to hold.
export function nearest(rules, side, kind, skip = 0) {
  const hq = rules.map.points.find((p) => p.kind === "hq" && p.owner === side);
  const far = (p) => Math.hypot(p.x - hq.x, p.y - hq.y);
  return rules.map.points.filter((p) => p.kind === kind).sort((a, b) => far(a) - far(b))[skip]?.id ?? "";
}

// The steps. `mark` is what the map points at ("squad", "first" the first point,
// "contact"); `focus` is what the page lights up, `tab` the phone sheet it lives in, and
// `pane` the half of the build panel it is on.
// `touch` says the step is worded differently for fingers.
export const STEPS = [
  { id: "welcome", manual: true },
  { id: "select", touch: true, mark: "squad", focus: "#roster", done: (c) => c.selected > 0 || ordered(c) },
  { id: "order", touch: true, mark: "first", focus: "#send", done: ordered },
  { id: "answer", manual: true, focus: "#log", tab: "radio", ready: answered },
  { id: "orders", manual: true },
  { id: "cover", manual: true },
  // The base, in the order every base opens in: power, the refinery, the barracks. Each
  // is placed with the ghost; the refinery's step ends when its hauler has driven out.
  { id: "power", touch: true, focus: "#structures", tab: "build", pane: "structures", done: (c) => placed(c, "power") },
  { id: "refinery", touch: true, focus: "#structures", tab: "build", pane: "structures", done: hauling },
  { id: "fog", manual: true },
  { id: "barracks", focus: "#structures", tab: "build", pane: "structures", done: (c) => stands(c, "barracks") },
  { id: "buy", touch: true, focus: "#build", tab: "build", pane: "units", done: bought },
  { id: "deploy", manual: true, focus: "#roster", tab: "squads", ready: arrived },
  { id: "upgrade", touch: true, focus: "#roster", tab: "squads", done: upgraded },
  { id: "enemy", touch: true, mark: "contact", done: engaged },
  { id: "voice", manual: true, focus: "#ptt" },
  { id: "win", manual: true },
];

export const indexOf = (id) => STEPS.findIndex((s) => s.id === id);

// The lesson's enemy stands still until the learner has a base and is buying a squad:
// from this step on it is released, and walks in while the next two are read.
export const released = (index) => index >= indexOf("buy");

// canGoOn says whether Next is offered on a step that is only read.
export const canGoOn = (index, c) => {
  const step = STEPS[index];
  return Boolean(step?.manual) && (step.ready ? step.ready(c) : true);
};

// advance gives the step the lesson should be on. Steps the player has already done are
// passed over in one go; a step that is only read ends on `next` (and only once it is
// ready), or on `skip`, which ends any step. Past the last step the lesson is over:
// STEPS.length.
export function advance(index, c, { next = false, skip = false } = {}) {
  let at = Math.max(0, Math.min(index, STEPS.length));
  if (at < STEPS.length && (skip || (next && canGoOn(at, c)))) at++;
  while (at < STEPS.length && !STEPS[at].manual && STEPS[at].done(c)) at++;
  return at;
}
