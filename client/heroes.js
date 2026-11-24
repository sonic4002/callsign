// Heroes, sandbag positions, crushing and earned ranks as the page shows them. What can
// be worked out from a snapshot and the rules is here as plain functions, tested without a
// page (heroes.test.mjs); the few that draw take the canvas or the element they draw on.

import { drawCasualty, drawSandbags, sprites } from "./art.js";
import { rankSvg } from "./marks.js";

const unitOf = (rules, id) => Object.values(rules?.factions ?? {}).map((f) => f.units[id]).find(Boolean) ?? null;

// ---- sandbag positions ----

// withBuilt gives the map's landmarks with the positions built during the match that
// this side knows of put among them, so that everything that reads the map (names, taps,
// orders) finds them like any landmark. It changes `rules.map.landmarks` in place and
// reports whether the list changed.
export function withBuilt(rules, state) {
  if (!rules?.map) return false;
  const base = (rules.map.landmarks ?? []).filter((l) => !l.built);
  const built = (state?.landmarks ?? [])
    .filter((l) => l.built && l.name)
    .map((l) => ({ id: l.id, kind: "sandbags", x: l.x, y: l.y, name: l.name, built: true, face: l.face ?? 0, by: l.by, state: sandbagState(l) }));
  const before = (rules.map.landmarks ?? []).filter((l) => l.built);
  const same = before.length === built.length && before.every((l, i) => l.id === built[i].id && l.state === built[i].state);
  rules.map.landmarks = [...base, ...built];
  return !same;
}

// sandbagState is the picture a position shows: whole, damaged, or flat once knocked down.
export function sandbagState(l) {
  if (l.kind === "sandbagsFlat") return "flat";
  return (l.hp ?? 1) < 0.5 ? "damaged" : "whole";
}

// drawBuilt draws one built position where the canvas stands.
export function drawBuilt(ctx, l) {
  drawSandbags(ctx, l.face ?? 0, l.state ?? "whole");
}

// canDigIn reports whether a squad of this unit can be told to dig in.
export const canDigIn = (unit) => unit?.class === "infantry" && unit.domain === "land" && !unit.hero;

// ---- heroes ----

// heroLock says why a hero cannot be bought yet beyond its first structure: the next
// structure it needs, or the hero already in the field. Null when nothing holds it.
export function heroLock(state, rules, faction, side, unitId) {
  const u = rules.factions[faction]?.units[unitId];
  if (!u?.hero) return null;
  const mine = (state.structures ?? []).filter((s) => s.side === side && !s.ruin && s.building >= 1);
  const missing = (u.needs ?? []).find((role) => !mine.some((s) => s.role === role));
  if (missing) {
    const all = rules.factions[faction].structures ?? {};
    const id = Object.keys(all).sort().find((k) => all[k].role === missing);
    return id ? { id, def: all[id] } : null;
  }
  const out = [...(state.squads ?? []), ...(state.deploying ?? [])].some((s) => s.side === side && unitOf(rules, s.unit)?.hero);
  return out ? { id: "hero", text: "hero.one" } : null;
}

// heroPose is the named pose a hero is drawn in, or undefined for the usual ones.
//   view: the squad or contact as the snapshot gives it; v: what the map knows of how it moves.
export function heroPose(rules, view, v = {}) {
  const u = unitOf(rules, view?.unit);
  if (!u?.hero) return undefined;
  const working = (view.hero?.work ?? 0) > 0;
  if (u.chargeDamage) {
    if (working && view.order?.kind === "plant") return "plant";
    if (v.moving) return undefined;
    return v.firing ? "proneFire" : "prone"; // a marksman lies up when it is still
  }
  if (u.disguise) {
    if (working && view.order?.kind === "seize") return "seize";
    // Its own side sees the bystander's clothes until it shoots; the enemy as long as it passes.
    const hidden = view.disguised ?? !v.firing;
    if (!hidden) return undefined;
    return v.moving ? "disguiseWalk" : "disguise";
  }
  return undefined;
}

// heroRow fills a roster row for a hero: its portrait, its health, and what it carries.
// `t` is the page's string function and `name` gives a squad's callsign by id.
export function heroRow(li, sq, unit, { t, name }) {
  li.classList.add("hero");
  const face = sprites.portraits[sq.unit];
  if (face?.src) {
    const img = document.createElement("img");
    img.className = "portrait";
    img.src = face.src;
    img.alt = "";
    img.width = img.height = 40;
    li.prepend(img);
  }
  const bar = document.createElement("span");
  bar.className = "hero-health";
  bar.setAttribute("role", "img");
  const fill = document.createElement("i");
  bar.append(fill);
  const note = document.createElement("small");
  note.className = "hero-note";
  if (unit.chargeDamage) note.textContent = t("hero.charges", { n: sq.hero?.charges ?? 0 });
  else if (sq.hero?.seized) note.textContent = t("hero.holds", { squad: name(sq.hero.seized) });
  li.append(bar, note);
  syncHero(li, sq, t);
}

// syncHero moves a hero row's health bar without rebuilding the row.
export function syncHero(li, sq, t) {
  const bar = li.querySelector(".hero-health");
  if (!bar || !sq.hero) return;
  const hp = Math.max(0, Math.min(1, sq.hero.hp ?? 1));
  bar.firstChild.style.inlineSize = `${Math.round(hp * 100)}%`;
  bar.classList.toggle("low", hp < 0.35);
  bar.setAttribute("aria-label", t("hero.health", { percent: Math.round(hp * 100) }));
  bar.title = bar.getAttribute("aria-label");
}

// rankBadge is the silver mark of an earned rank for the roster, as an element, or null.
export function rankBadge(rules, sq, lang) {
  const rank = rules.ranks?.find((r) => r.id === sq.rank);
  if (!rank) return null;
  const span = document.createElement("span");
  span.className = "earned";
  span.innerHTML = rankSvg(rank.id, 14, rank.name[lang]);
  span.title = rank.name[lang];
  return span;
}

// ---- the log ----

// heroEventKind picks the log line for the events whose words depend on whose it is:
// a hero's (ours or theirs) and a squad that changed hands.
export function heroEventKind(ev) {
  if (ev.kind === "hero_fielded" || ev.kind === "hero_fell") return ev.squad ? ev.kind : `enemy_${ev.kind}`;
  if (ev.kind === "squad_lost" && ev.reason === "seized") return "squad_seized";
  if (ev.kind === "squad_lost" && ev.reason === "returned") return "squad_released";
  if (ev.kind === "squad_spawned" && ev.reason === "seized") return "squad_taken";
  if (ev.kind === "squad_spawned" && ev.reason === "returned") return "squad_returned";
  return ev.kind;
}

// eventNames are the words an event's ids stand for: the hero's unit, the rank earned.
export function eventNames(rules, ev, lang) {
  return {
    hero: unitOf(rules, ev.unit)?.name[lang] ?? "",
    rank: rules.ranks?.find((r) => r.id === ev.unit)?.name[lang] ?? "",
  };
}

// ---- the map ----

// crusherNear reports whether a vehicle that runs men down is close enough to a spot to
// have done it: the page shows a man lost that way pressed flat. `groups` are the map's
// unit groups, each with `side`, `unit` and `visuals` ({ px, py }).
export function crusherNear(rules, groups, side, x, y) {
  const reach = (rules.match?.crushRadius ?? 13) * 2.2;
  for (const g of groups) {
    if (g.side === side || !unitOf(rules, g.unit)?.crushes) continue;
    if ((g.visuals ?? []).some((v) => Math.hypot(v.px - x, v.py - y) <= reach)) return true;
  }
  return false;
}

// drawFlat draws a man run down: his last frame pressed into the ground, with the track
// marks across him.
export function drawFlat(ctx, { unit, cls, turn, age }) {
  ctx.save();
  ctx.scale(1.25, 0.42);
  drawCasualty(ctx, { unit, cls, turn, age: Math.max(age, 0.7) });
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = Math.max(0, 0.5 - age * 0.06);
  ctx.strokeStyle = "#2a2118";
  ctx.lineWidth = 2.2;
  ctx.setLineDash([3, 3]);
  for (const dy of [-4, 4]) {
    ctx.beginPath();
    ctx.moveTo(-15, dy + 3);
    ctx.lineTo(15, dy - 3);
    ctx.stroke();
  }
  ctx.restore();
}

// drawCharge draws a demolition charge burning down at a point of the screen: a blinking
// lamp that quickens, and the seconds left.
export function drawCharge(ctx, sx, sy, charge, now, color) {
  const left = Math.max(0, charge.left);
  const rate = left < 2 ? 90 : 220;
  const on = Math.floor(now / rate) % 2 === 0;
  ctx.save();
  ctx.fillStyle = "rgba(10,14,16,0.8)";
  ctx.beginPath();
  ctx.arc(sx, sy, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = on ? "#ff4a3a" : "#5a1c16";
  ctx.beginPath();
  ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "bold 11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffd9d2";
  ctx.strokeStyle = "rgba(0,0,0,0.8)";
  ctx.lineWidth = 3;
  const text = String(Math.ceil(left));
  ctx.strokeText(text, sx, sy + 11);
  ctx.fillText(text, sx, sy + 11);
  ctx.restore();
}

// digProgress is how far a squad is into digging in, 0…1, or null when it is not.
export const digProgress = (sq) => (sq.order?.kind === "fortify" ? (sq.dig ?? 0) : null);

// heroOrders adds to the orders the map offers what a hero can do with the thing tapped:
// a charge on an enemy structure, a bridge or the enemy headquarters; a seizure of an
// enemy vehicle squad.
export function heroOrders(rules, squad, target, actions) {
  const u = unitOf(rules, squad?.unit);
  if (!u?.hero) return actions;
  if (u.chargeDamage && (squad.hero?.charges ?? 0) > 0 && ["structure", "bridge", "enemyHQ"].includes(target.kind)) return ["plant", ...actions];
  if (u.seizeRadius && target.kind === "contact" && target.cls === "vehicle") return ["seize", ...actions];
  return actions;
}
