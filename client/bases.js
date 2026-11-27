// Bases as the page shows them, worked out from a snapshot and the rules. Nothing here
// touches the page, so it is tested as it is (bases.test.mjs).

// unitDef finds a unit's rules entry in any faction: a captured structure lets a side
// field the other faction's units.
export function unitDef(rules, id) {
  for (const f of Object.values(rules.factions)) if (f.units[id]) return f.units[id];
  return null;
}

// structureDef is the rules entry of a structure in a snapshot.
// A tech building belongs to no faction: its entry is in rules.techBuildings.
export const structureDef = (rules, st) => rules.factions[st.faction]?.structures[st.kind] ?? rules.techBuildings?.[st.kind] ?? null;

// techSite is the map's entry for a tech building in a snapshot (its name on this map).
export const techSite = (rules, st) => (st.site ? (rules.map.techBuildings ?? []).find((t) => t.id === st.site) ?? null : null);

// ofRole is a faction's structure for a role: the first by id, as the server picks it.
export function ofRole(rules, faction, role) {
  const all = rules.factions[faction]?.structures ?? {};
  const id = Object.keys(all).sort().find((k) => all[k].role === role);
  return id ? { id, def: all[id] } : null;
}

const base = (def) => !["hq", "defence", "fence"].includes(def.role);
const mine = (state, side) => (state.structures ?? []).filter((s) => s.side === side && !s.ruin);

// stands reports whether a side has a finished structure with a role, its own or captured.
export const stands = (state, side, role) => mine(state, side).some((s) => s.role === role && s.building >= 1);

// unitLock is the structure a side still has to build before it can buy a unit, or null
// when the unit is unlocked.
export function unitLock(state, rules, faction, side, unitId) {
  const u = rules.factions[faction]?.units[unitId];
  // A base short of power makes no units: what is needed first is power.
  const p = state?.power;
  if (u && p && (p.use ?? 0) > (p.supply ?? 0)) return ofRole(rules, faction, "power");
  if (!u?.requires || stands(state, side, u.requires)) return null;
  return ofRole(rules, faction, u.requires);
}

// structureCards is the Structures half of the build panel: one card per structure the
// faction can build, with what it costs, what it unlocks, and why it cannot be started.
//   state: "ready" | "rising" (with progress 0…1) | "needs" | "busy" | "full" | "poor"
export function structureCards(state, rules, faction, side) {
  const all = rules.factions[faction]?.structures ?? {};
  const own = mine(state, side);
  const rising = (isBase) => own.find((s) => s.building < 1 && base(structureDef(rules, s) ?? { role: s.role }) === isBase);
  const count = (role) => own.filter((s) => s.role === role).length;
  // Base structures are placed by the player, and a second one of a kind is a second
  // production line; the base as a whole has a cap.
  const bases = own.filter((s) => base(structureDef(rules, s) ?? { role: s.role })).length;
  const runs = new Set(own.filter((s) => s.role === "fence").map((s) => s.run)).size;
  return Object.keys(all)
    .filter((id) => all[id].role !== "hq" && !(all[id].role === "superweapon" && state?.superPowers?.limit === 0))
    .map((id) => {
      const def = all[id];
      const card = { id, def, unlocks: def.unlocks, state: "ready", progress: 0, needs: null, have: 0 };
      const up = own.filter((s) => s.kind === id && s.faction === faction);
      card.have = def.role === "fence" ? new Set(up.map((s) => s.run)).size : up.length;
      const going = up.find((s) => s.building < 1);
      const skipReq = def.role === "superweapon" && Boolean(state?.superPowers?.fast);
      const missing = skipReq ? null : def.requires.find((role) => !stands(state, side, role));
      if (going) Object.assign(card, { state: "rising", progress: going.building });
      else if (def.role === "superweapon" && count("superweapon") >= 1) card.state = "full";
      else if (def.role === "power" && count("power") >= (rules.match.powerStructures ?? Infinity)) card.state = "full";
      else if (missing) Object.assign(card, { state: "needs", needs: ofRole(rules, faction, missing) });
      // Nothing that uses power is started on power the side does not have.
      else if ((def.power ?? 0) < 0 && state?.power && (state.power.use ?? 0) - def.power > (state.power.supply ?? 0)) Object.assign(card, { state: "needs", needs: ofRole(rules, faction, "power") });
      else if (rising(base(def))) card.state = "busy";
      else if (base(def) && bases >= (rules.match.baseCap ?? Infinity)) card.state = "full";
      else if (def.role === "defence" && count("defence") >= rules.match.defenceCap) card.state = "full";
      else if (def.role === "fence" && runs >= rules.match.fenceRuns) card.state = "full";
      else if (state.gold < def.cost) card.state = "poor";
      return card;
    });
}

// structureRows is the list of what a side has built, for the sidebar: base structures
// and defences one by one, and each fence run as one row.
export function structureRows(state, rules, side) {
  const rows = [];
  const seenRuns = new Set();
  for (const s of mine(state, side)) {
    if (s.role === "fence") {
      if (seenRuns.has(s.run)) continue;
      seenRuns.add(s.run);
      const run = mine(state, side).filter((o) => o.role === "fence" && o.run === s.run);
      rows.push({ id: s.id, kind: s.kind, faction: s.faction, role: s.role, hp: run.reduce((a, o) => a + o.hp, 0) / run.length, building: Math.min(...run.map((o) => o.building)), segments: run.length });
      continue;
    }
    rows.push({ id: s.id, kind: s.kind, faction: s.faction, role: s.role, hp: s.hp, building: s.building });
  }
  return rows;
}

// enemyStructures are the other side's structures as last seen, for names on the map.
export const enemyStructures = (state, side) => (state.structures ?? []).filter((s) => s.side !== side && !s.ruin);

// structureAt finds the structure under a point of the map: the nearest whose footprint
// (a little generous, for fingers) holds it.
export function structureAt(state, rules, x, y) {
  let best = null;
  let bd = Infinity;
  for (const s of state.structures ?? []) {
    if (s.ruin || s.role === "fence") continue;
    const def = structureDef(rules, s);
    const d = Math.hypot(s.x - x, s.y - y);
    if (d <= (def?.footprint ?? 30) + 14 && d < bd) [best, bd] = [s, d];
  }
  return best;
}
