// The command screen: an isometric battlefield, a radio console, and a sidebar of
// instruments. The radio is the only way to act. Every button here does one thing:
// it writes a radio call, in the page language, and the server routes it like any other.
// Nerve shows in what the troops do; the "show nerve" switch is a debugging aid.

import { drawUnit, loadSprites } from "./art.js";
import { Scene, sideColor } from "./map.js";
import { Music } from "./music.js";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};
const query = new URLSearchParams(location.search);
const side = query.get("side") === "1" ? 1 : 0;
const role = query.get("role") === "spectator" ? "spectator" : "hammer";
document.body.classList.add(`side-${side}`);

// ---- language ----

const strings = {};
for (const code of ["en", "he"]) strings[code] = await (await fetch(`i18n/${code}.json`)).json();
// ?lang=he or ?lang=en in the address wins over the saved choice and the browser's language.
let lang = ["he", "en"].find((code) => code === query.get("lang")) ?? localStorage.getItem("callsign.lang") ?? (navigator.language.startsWith("he") ? "he" : "en");

function t(key, vars = {}) {
  const text = strings[lang][key];
  if (text === undefined) throw new Error(`missing string "${key}" in ${lang}.json`);
  return text.replace(/\{(\w+)\}/g, (_, name) => vars[name]);
}

function applyLanguage() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
  document.title = t("title");
  for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll("[data-i18n-placeholder]")) node.placeholder = t(node.dataset.i18nPlaceholder);
  for (const node of document.querySelectorAll("[data-i18n-aria]")) node.setAttribute("aria-label", t(node.dataset.i18nAria));
  syncInputDirection();
  renderLog();
  drawn.roster = drawn.build = "";
  renderSidebar();
  renderOverlay();
  renderTrack();
}

// An empty box follows the page so the placeholder reads the right way; typed text
// follows its own first letter, so Hebrew and English orders both look right.
function syncInputDirection() {
  $("text").dir = $("text").value ? "auto" : document.documentElement.dir;
}
$("text").addEventListener("input", syncInputDirection);

function switchLanguage() {
  lang = lang === "he" ? "en" : "he";
  localStorage.setItem("callsign.lang", lang);
  applyLanguage();
}
$("lang").addEventListener("click", switchLanguage);
$("overlay-lang").addEventListener("click", switchLanguage);

// ---- match state ----

let rules = null;
let state = null;
let me = null; // this connection's station
let faction = "";
let entries = []; // radio log lines, kept as data so a language switch can redraw them
let ws = null;
let started = false; // the player pressed Start
const drawn = { roster: "", build: "" }; // what the sidebar lists show now

const scene = new Scene($("map"), $("radar-map"), { lang: () => lang, showNerve: () => $("nerve").checked, side });
const music = await new Music().load();
await loadSprites();

const pointName = (id) => rules.map.points.find((p) => p.id === id)?.callsign[lang] ?? id;
const clock = (tick) => {
  if (!rules) return "--:--"; // before the server's greeting
  const s = Math.floor(tick / rules.tickRate);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const open = () => ws?.readyState === WebSocket.OPEN;

function connect() {
  system("connecting");
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?side=${side}&role=${role}`);
  ws.addEventListener("message", (ev) => onFrame(JSON.parse(ev.data)));
  ws.addEventListener("close", () => {
    system("disconnected", {}, "warn");
    setTimeout(connect, 1000);
  });
}

function onFrame(frame) {
  switch (frame.type) {
    case "hello":
      rules = frame.rules;
      state = frame.state;
      me = frame.station ?? null;
      faction = frame.faction;
      entries = frame.log.map((m) => ({ kind: "radio", message: m }));
      system(me ? "matchStarted" : "spectating", { faction });
      scene.setRules(rules);
      scene.setState(state);
      drawn.roster = drawn.build = "";
      hideOrders();
      break;
    case "state":
      state = frame.state;
      scene.setState(state);
      break;
    case "radio":
      entries.push({ kind: "radio", message: frame.message });
      break;
    case "refused":
      system("refused", { reason: frame.reason }, "warn");
      return;
    case "event":
      // Pinned, contact and the like are for the squads to say on the radio, not for a HUD.
      if (frame.event.side === side && `event.${frame.event.kind}` in strings.en) {
        entries.push({ kind: "event", event: frame.event, callsign: frame.callsign });
      }
      break;
  }
  if (frame.type !== "state") renderLog();
  renderSidebar();
  renderOverlay();
}

function system(key, vars = {}, tone = "") {
  entries.push({ kind: "system", key, vars, tone, tick: state?.tick ?? 0 });
  renderLog();
}

// ---- radio console ----

function renderLog() {
  const log = $("log");
  const pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.replaceChildren(
    ...entries.map((e) => {
      const li = el("li");
      const time = el("time");
      const text = el("span", "text");
      if (e.kind === "radio") {
        const m = e.message;
        time.textContent = clock(m.tick);
        li.className = m.from.squad ? "squad" : m.from.key;
        text.textContent = m.text; // always as transmitted, in the language it was sent in
        li.append(time, el("span", "who", m.from[lang]), text);
        return li;
      }
      li.className = `system ${e.tone ?? ""}`;
      if (e.kind === "event") {
        const ev = e.event;
        time.textContent = clock(ev.tick);
        text.textContent = t(`event.${ev.kind}`, { point: pointName(ev.point), squad: e.callsign?.[lang] ?? "", tier: ev.count });
      } else {
        time.textContent = clock(e.tick);
        text.textContent = t(e.key, { ...e.vars, from: me?.[lang] ?? "", faction: rules?.factions[e.vars.faction]?.name[lang] ?? "" });
      }
      li.append(time, text);
      return li;
    }),
  );
  if (pinned) log.scrollTop = log.scrollHeight;
}

// transmit puts text on the net. It is the one place this page acts on the match.
function transmit(text) {
  if (!text || !open()) return false;
  ws.send(JSON.stringify({ type: "radio", text }));
  return true;
}

// draft puts a call in the box for the player to send or edit.
function draft(text) {
  $("text").value = text;
  syncInputDirection();
  $("text").focus();
}

$("send").addEventListener("submit", (ev) => {
  ev.preventDefault();
  if (transmit($("text").value.trim())) draft("");
});

$("restart").addEventListener("click", () => open() && ws.send(JSON.stringify({ type: "restart" })));

// Calls the sidebar and the map write. `to` and `from` are callsigns in the page language.
const call = (kind, vars) => t(`call.${kind}`, { from: me[lang], ...vars });
const anvil = () => rules.callsigns.operator[lang];

// ---- sidebar ----

function renderSidebar() {
  if (!state || !rules) return;
  $("gold").textContent = state.gold;
  $("income").textContent = `+${state.income}`; // the sign stays with the number in Hebrew too
  const s = Math.max(0, state.timeLeft);
  $("time").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const held = (who) => state.points.filter((p) => p.owner === who).length;
  $("held").textContent = `${held(side)} : ${held(1 - side)}`;
  $("hq-ours").style.inlineSize = `${state.hq[side] * 100}%`;
  $("hq-enemy").style.inlineSize = `${state.hq[1 - side] * 100}%`;

  const mine = state.squads.filter((sq) => sq.side === side);
  const cap = rules.match.populationCap;
  $("pop").textContent = `${mine.length}/${cap}`;
  const canAct = Boolean(me) && !state.over;

  // The lists are rebuilt only when what they show changes, so buttons stay clickable.
  const afford = rules.tiers.map((tier) => state.gold >= tier.upgradeCost);
  const rosterKey = JSON.stringify([lang, scene.selected, canAct, afford, mine.map((sq) => [sq.id, sq.alive, sq.tier, sq.order])]);
  if (rosterKey !== drawn.roster) {
    drawn.roster = rosterKey;
    $("roster").replaceChildren(...(mine.length ? mine.map((sq) => rosterRow(sq, canAct)) : [el("li", "empty", t("rosterEmpty"))]));
  }
  const units = Object.entries(rules.factions[faction]?.units ?? {});
  const buildKey = JSON.stringify([lang, faction, canAct, mine.length >= cap, units.map(([, u]) => state.gold >= u.cost)]);
  if (buildKey !== drawn.build) {
    drawn.build = buildKey;
    $("build").replaceChildren(...units.map(([id, u]) => buildButton(id, u, canAct && mine.length < cap && state.gold >= u.cost)));
  }
}

function orderText(sq) {
  if (sq.order.contact) return t("order.contact");
  return t(`order.${sq.order.kind}`, { point: sq.order.point ? pointName(sq.order.point) : t("order.here") });
}

function rosterRow(sq, canAct) {
  const unit = rules.factions[faction].units[sq.unit];
  const li = el("li", sq.id === scene.selected ? "selected" : "");
  const name = el("span", "name", sq.callsign[lang]);
  name.append(el("span", "unit", unit.name[lang]));
  const pips = el("span", "pips");
  for (let i = 0; i < sq.full; i++) pips.append(el("i", i < sq.alive ? "" : "lost"));
  const tier = el("span", "tier", t("tier", { tier: sq.tier }));
  const next = rules.tiers.find((x) => x.tier === sq.tier + 1);
  if (next && me) {
    const up = el("button", "", `▲ ${next.upgradeCost}`);
    up.type = "button";
    up.disabled = !canAct || state.gold < next.upgradeCost;
    up.setAttribute("aria-label", t("upgrade", { squad: sq.callsign[lang], cost: next.upgradeCost }));
    up.title = up.getAttribute("aria-label");
    up.addEventListener("click", (ev) => {
      ev.stopPropagation();
      draft(call("upgrade", { to: anvil(), squad: sq.callsign[lang] }));
    });
    tier.append(up);
  }
  li.append(name, pips, el("span", "order", orderText(sq)), tier);
  li.addEventListener("click", () => select(sq));
  return li;
}

function buildButton(id, unit, enabled) {
  const button = el("button");
  button.type = "button";
  button.disabled = !enabled;
  const icon = el("canvas");
  const dpr = devicePixelRatio || 1;
  icon.width = 72 * dpr;
  icon.height = 48 * dpr;
  const g = icon.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.translate(36, unit.class === "infantry" ? 38 : 36);
  g.scale(1.25, 1.25);
  drawUnit(g, { unit: id, cls: unit.class, faction, members: Math.min(unit.members, 3), moving: false, firing: false, time: 0, turn: 0.4, seed: 0 });
  button.append(icon, el("span", "", unit.name[lang]), el("span", "cost", String(unit.cost)));
  // Buying is a radio call to the operator like any other; the button only writes and sends it.
  button.addEventListener("click", () => transmit(call("buy", { to: anvil(), class: t(`class.${unit.class}`), unit: unit.name[lang] })));
  return button;
}

// select marks a squad and starts a call to it.
function select(sq) {
  scene.selected = sq.id;
  drawn.roster = "";
  renderSidebar();
  hideOrders();
  if (me) draft(t("callPrefix", { to: sq.callsign[lang], from: me[lang] }));
}

// ---- map ----

const canvas = $("map");
let drag = null;

canvas.addEventListener("pointerdown", (ev) => {
  drag = { x: ev.clientX, y: ev.clientY, moved: false };
  canvas.setPointerCapture(ev.pointerId);
});
canvas.addEventListener("pointermove", (ev) => {
  if (!drag) return;
  const dx = ev.clientX - drag.x;
  const dy = ev.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 5) return;
  drag.moved = true;
  canvas.classList.add("dragging");
  hideOrders();
  scene.cam.pan(dx, dy);
  drag.x = ev.clientX;
  drag.y = ev.clientY;
});
canvas.addEventListener("pointerup", (ev) => {
  const wasDrag = drag?.moved;
  drag = null;
  canvas.classList.remove("dragging");
  if (!wasDrag) mapClick(ev);
});
canvas.addEventListener("pointercancel", () => (drag = null));
canvas.addEventListener(
  "wheel",
  (ev) => {
    ev.preventDefault();
    const box = canvas.getBoundingClientRect();
    hideOrders();
    scene.cam.zoomAt(ev.clientX - box.left, ev.clientY - box.top, ev.deltaY < 0 ? 1.15 : 1 / 1.15);
  },
  { passive: false },
);
const zoomBy = (f) => scene.cam.zoomAt(scene.cam.w / 2, scene.cam.h / 2, f);
$("zoom-in").addEventListener("click", () => zoomBy(1.3));
$("zoom-out").addEventListener("click", () => zoomBy(1 / 1.3));
$("zoom-fit").addEventListener("click", () => scene.cam.fit());
addEventListener("resize", () => scene.resize());

$("radar-map").addEventListener("click", (ev) => rules && scene.cam.centerOn(...scene.radarToWorld(ev)));

// A click on a squad selects it and starts a call. A click on a point, with a squad
// selected, offers the three orders; with none, it adds the point's name to the message.
function mapClick(ev) {
  if (!rules || !state || !me) return;
  const box = canvas.getBoundingClientRect();
  const sx = ev.clientX - box.left;
  const sy = ev.clientY - box.top;
  const hit = scene.pick(sx, sy, side);
  if (hit.squad) return select(hit.squad);
  hideOrders();
  if (!hit.point) return;
  const squad = state.squads.find((sq) => sq.id === scene.selected);
  if (!squad) return draft($("text").value + hit.point.callsign[lang]);
  const menu = $("orders");
  menu.dataset.point = hit.point.id;
  $("orders-title").textContent = `${squad.callsign[lang]} → ${hit.point.callsign[lang]}`;
  menu.style.left = `${Math.max(90, Math.min(box.width - 90, sx))}px`;
  menu.style.top = `${Math.min(box.height - 90, sy)}px`;
  menu.hidden = false;
}

function hideOrders() {
  $("orders").hidden = true;
}

for (const button of document.querySelectorAll("#orders button")) {
  button.addEventListener("click", () => {
    const squad = state.squads.find((sq) => sq.id === scene.selected);
    const point = rules.map.points.find((p) => p.id === $("orders").dataset.point);
    hideOrders();
    if (squad && point) draft(call(button.dataset.order, { to: squad.callsign[lang], point: point.callsign[lang] }));
  });
}

// ---- menus ----

// The overlay is the start screen before the match and the result screen after it.
function renderOverlay() {
  const over = Boolean(state?.over);
  $("overlay").hidden = started && !over;
  $("overlay-title").textContent = over ? t(state.winner === -1 ? "over.draw" : state.winner === side ? "over.won" : "over.lost") : t("title");
  $("overlay-line").textContent = over ? t(`over.${state.reason}`) : t("tagline");
  const factionName = rules?.factions[faction]?.name[lang];
  $("overlay-side").textContent = t(`side.${side}`) + (factionName ? ` · ${factionName}` : "");
  $("start").textContent = over ? t("playAgain") : role === "spectator" ? t("watch") : t("start");
  $("start").hidden = over && !me; // a spectator cannot restart
  music.setMode(!started || over ? "menu" : "battle");

  $("credits").hidden = !music.available;
  $("credits-list").replaceChildren(
    ...music.credits.map((track) => el("li", "", [`${track.title} · ${track.artist}`, track.licence, track.attribution].filter(Boolean).join(" · "))),
  );
}

$("start").addEventListener("click", () => {
  music.unlock();
  if (state?.over) return open() && ws.send(JSON.stringify({ type: "restart" }));
  begin();
});

function begin() {
  if (started) return;
  started = true;
  renderOverlay();
  connect();
}

// ---- music ----

function renderTrack() {
  const track = music.playing?.track;
  $("music").hidden = !music.available;
  $("track").textContent = track ? `${track.title} · ${track.artist}` : "";
  $("mute").classList.toggle("off", music.muted);
  $("volume").value = music.volume;
}
music.onTrack = renderTrack;
$("mute").addEventListener("click", () => {
  music.setMuted(!music.muted);
  renderTrack();
});
$("volume").addEventListener("input", (ev) => music.setVolume(Number(ev.target.value)));
// Browsers allow sound only after the player has touched the page.
for (const kind of ["pointerdown", "keydown"]) addEventListener(kind, () => music.unlock(), { once: true });

// ---- go ----

function frame(now) {
  requestAnimationFrame(frame);
  scene.draw(now);
}

applyLanguage();
// The battlefield is drawn behind the start screen before any match exists.
try {
  scene.setRules(await (await fetch("/shared/rules.json")).json());
} catch {
  // The greeting brings the rules anyway.
}
scene.resize();
requestAnimationFrame(frame);
if (query.has("autostart")) begin(); // for tests and screenshots: skip the start screen

// For debugging from the console.
window.callsign = { scene, music, sideColor };
