// What the page says of a strike aircraft squad in the roster. Its order alone does not
// tell where it is in its sortie (server/sim/sortie.go): it may hold an attack order and
// be standing at its airbase being rearmed.

// sortieText is the roster's line for a strike squad, or null when the usual words for
// its order fit (flying at a target reads as any attack does). `t` is the page's
// translator and `where()` the name of the place its order names.
export function sortieText(sq, t, where) {
  const a = sq.sortie;
  if (!a) return null;
  if (a.state === "rearming") return t("order.rearming", { percent: Math.round((a.rearm ?? 0) * 10) * 10 });
  if (a.state === "parked") return t("order.parked");
  if (a.state === "back") return t("order.return");
  if (sq.order.kind === "move") return t("order.overfly", { point: where() });
  return null;
}

// padsLock says why a strike aircraft cannot be bought although its airbase stands: every
// airbase of the side is full of planes (server/sim/sortie.go: each holds `planes`, and a
// squad's planes each take a pad). Null when one has room, or the unit is no strike
// aircraft, or no airbase stands (the card then says what to build).
export function padsLock(state, rules, faction, side, unitId) {
  const u = rules.factions[faction]?.units[unitId];
  if (!u?.bombs) return null;
  const bases = (state?.structures ?? []).filter((s) => s.side === side && !s.ruin && s.building >= 1 && s.role === u.requires);
  if (!bases.length) return null;
  const unitOf = (id) => Object.values(rules.factions).map((f) => f.units[id]).find(Boolean);
  const taken = (st) =>
    (state.squads ?? []).filter((q) => q.sortie?.home === st.id).reduce((n, q) => n + q.alive, 0) +
    (state.deploying ?? []).filter((d) => d.from === st.id && unitOf(d.unit)?.bombs).reduce((n, d) => n + (unitOf(d.unit).teams ?? 0), 0);
  const room = bases.some((st) => (rules.factions[st.faction]?.structures[st.kind]?.planes ?? 0) - taken(st) >= u.teams);
  return room ? null : { id: "pads", text: "lock.pads" };
}
