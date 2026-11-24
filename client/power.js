// Power, the radar, and selling and repairing as the page shows them, worked out from a
// snapshot and the rules. The first half touches nothing on the page and is tested as it
// is (power.test.mjs); the second half draws.

import { iconSvg } from "./marks.js";

// powerOf is a side's power as the sidebar shows it. A snapshot from before power has none.
export function powerOf(state) {
  const p = state?.power;
  if (!p) return null;
  return { supply: p.supply ?? 0, use: p.use ?? 0, low: Boolean(p.low), share: p.supply > 0 ? Math.min(1, (p.use ?? 0) / p.supply) : p.use > 0 ? 1 : 0 };
}

// powerFigure is what a structure does to the side's power, as its build button says it:
// "+100" for one that supplies, "−20" for one that uses, "" for neither.
export function powerFigure(def) {
  const p = def?.power ?? 0;
  return p > 0 ? `+${p}` : p < 0 ? `−${-p}` : "";
}

// wouldRunShort reports whether starting a structure would leave the side short of power.
export function wouldRunShort(state, def) {
  const p = powerOf(state);
  return Boolean(p) && (def?.power ?? 0) < 0 && p.use - def.power > p.supply;
}

// radarState is why the mini map is on or off:
//   "on"     the radar structure stands and has power (or the side has no such structure in its rules)
//   "none"   it has not been built, or it fell
//   "rising" it is going up
//   "dark"   it stands, and the side is short of power
export function radarState(state, side) {
  if (!state || state.radar !== false) return "on";
  const radars = (state.structures ?? []).filter((s) => s.side === side && s.role === "radar" && !s.ruin);
  if (radars.some((s) => s.building >= 1)) return "dark";
  return radars.length ? "rising" : "none";
}

// sellValue is the gold a structure gives back when sold; a fence is sold a segment at a time.
export function sellValue(rules, def) {
  const cost = def.role === "fence" && def.segments > 0 ? def.cost / def.segments : def.cost;
  return Math.round(cost * (rules.match.sellShare ?? 0));
}

// repairCost is the gold it takes to make a structure whole from where it is now.
export const repairCost = (rules, def, st) => Math.ceil(def.cost * (rules.match.repairCostShare ?? 0) * (1 - Math.max(0, Math.min(1, st.hp))));

// structureActions is what the player can do with one of their own structures: sell it,
// have it repaired for gold, or send the engineer squad they have selected in to mend it.
// Each is a radio call; the page only writes and sends it.
export function structureActions(st, side, { engineers = false } = {}) {
  if (!st || st.side !== side || st.ruin) return [];
  const damaged = st.building >= 1 && st.hp < 0.999; // a finished structure can stand a hair under full
  return ["sell", ...(damaged && !st.repairing ? ["repair"] : []), ...(damaged && engineers ? ["mend"] : [])];
}

// siegeReach is how far a unit reaches against structures.
export const siegeReach = (unit) => unit.siegeRange || unit.range;

// ---- the page ----

// renderPower fills the sidebar's power line: an icon, supply against use, and a bar that
// turns to the warning colour when the side is short.
export function renderPower(box, state, t) {
  const p = powerOf(state);
  box.hidden = !p;
  if (!p) return;
  const key = `${p.supply}/${p.use}/${p.low}/${t("power.low")}`;
  if (box.dataset.shown === key) return;
  box.dataset.shown = key;
  box.classList.toggle("low", p.low);
  box.querySelector(".icon").innerHTML = iconSvg(p.low ? "lowPower" : "power", 16);
  box.querySelector(".figures").textContent = `${p.use} / ${p.supply}`;
  box.querySelector(".bar b").style.inlineSize = `${p.share * 100}%`;
  box.querySelector(".state").textContent = p.low ? t("power.low") : t("power.ok");
  box.title = t("power.title", { use: p.use, supply: p.supply });
}

// powerTag is the small "⚡ +100" on a build button.
export function powerTag(def, short) {
  const figure = powerFigure(def);
  if (!figure) return null;
  const tag = document.createElement("span");
  tag.className = `power${def.power > 0 ? " gives" : ""}${short ? " short" : ""}`;
  tag.innerHTML = iconSvg(short ? "lowPower" : "power", 11);
  const n = document.createElement("bdi");
  n.dir = "ltr";
  n.textContent = figure;
  tag.append(n);
  return tag;
}

// drawRadarOff paints the mini map dark with a little static, for a side without radar.
export function drawRadarOff(g, w, h, time) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = "#070a0b";
  g.fillRect(0, 0, w, h);
  // Slow static: a few faint lines that drift, so the screen reads as off and not broken.
  g.strokeStyle = "rgba(140,190,170,0.07)";
  g.lineWidth = 1;
  const step = Math.max(6, Math.round(h / 22));
  const drift = Math.floor(time * 6) % step;
  for (let y = drift; y < h; y += step) {
    g.beginPath();
    g.moveTo(0, y + 0.5);
    g.lineTo(w, y + 0.5);
    g.stroke();
  }
}
