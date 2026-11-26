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
