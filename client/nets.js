// Two nets and how much of them the commander is shown, kept apart from the page so it
// can be tested alone.
//
// The game server gives every transmission a net and a level (server/room/traffic.go):
// "command" for what is said to or by Hammer, "squad" for what squads and the operator
// say among themselves, and the least "radio traffic" level that shows it: 1 quiet,
// 2 normal, 3 full. The page shows a line on the command net when its level is within
// the level the player chose, and speaks only those. The squad net is a list of its own,
// read and never heard; at the full level the command net carries its lines too.

export const QUIET = 1;
export const NORMAL = 2;
export const FULL = 3;

const KEY = "callsign.traffic";

// traffic is the page setting: how much radio traffic the commander wants. Normal unless chosen.
export const traffic = {
  get level() {
    const kept = Number(globalThis.localStorage?.getItem(KEY));
    return [QUIET, NORMAL, FULL].includes(kept) ? kept : NORMAL;
  },
  set level(value) {
    globalThis.localStorage?.setItem(KEY, String(value));
  },
};

// The page's own lines about events, by the least level that shows them. What is not
// listed needs the player and is shown always: a squad or a point lost or taken, what
// was sold or cancelled, the base or a hauler under attack. That something was started
// or bought (a squad on its way, a structure going up, a leader upgraded) is said at the
// full level only: the build panel and the squad list show it, the operator's cue says
// when it is ready, and an operator that buys on its own would otherwise fill the net.
const eventLevels = {
  enemy_destroyed: NORMAL,
  structure_lost_theirs: NORMAL,
  structure_repaired: NORMAL,
  building_fell: NORMAL,
  bridge_under_attack: NORMAL,
  bridge_repaired: NORMAL,
  charge_planted: NORMAL,
  charge_blew: NORMAL,
  promoted: NORMAL,
  super_launched: NORMAL,
  upgraded: FULL,
  deploying: FULL,
  structure_started: FULL,
  garrisoned: FULL,
  fortified: FULL,
  crushed: FULL,
};

// onCommandNet reports whether a log entry is shown on the command net at a level. A
// message with no level (an older server) is shown.
export function onCommandNet(entry, level = traffic.level) {
  if (entry.kind === "radio") return (entry.message.level ?? QUIET) <= level;
  if (entry.kind === "event") return (eventLevels[entry.event.kind] ?? QUIET) <= level;
  return true; // what the page itself says
}

// onSquadNet reports whether a log entry belongs to the squad net.
export const onSquadNet = (entry) => entry.kind === "radio" && entry.message.net === "squad";

// heard reports whether a transmission is spoken at a level: exactly the lines the
// command net shows.
export const heard = (message, level = traffic.level) => onCommandNet({ kind: "radio", message }, level);
