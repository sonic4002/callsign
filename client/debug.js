// The command screen: an isometric battlefield, a radio console, and a sidebar of
// instruments. The radio is the only way to act. Every button here does one thing:
// it writes a radio call, in the page language, and the server routes it like any other.
// Nerve shows in what the troops do; the "show nerve" switch is a debugging aid.

import { drawUnit, loadSprites } from "./art.js";
import { Scene, sideColor } from "./map.js";
import { Music } from "./music.js";
import { Sfx } from "./sfx.js";
import { Speech } from "./speech/speech.js";
import { tidy } from "./voice/normalize.js";
import { Voice } from "./voice/voice.js";

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
  renderVoice();
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
scene.sfx = new Sfx({ level: () => (music.muted ? 0 : music.volume) }); // guns and blasts follow the music's volume and mute
const speech = new Speech({ volume: () => 0.6 + 0.4 * music.volume, duck: (on) => (music.duck(on), scene.sfx.duck(on)) });
speech.bind($("speak"));
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
      // Anvil turning a purchase down ends the wait for it.
      if (frame.message.from.key === "operator" && frame.message.prowords?.some((w) => w === "negative" || w === "sayAgain")) buyAnswered();
      // The sign-off ends the match: whatever radio was still waiting is dropped for it.
      if (frame.message.final) speech.silence();
      speech.say(frame.message, { rules, faction });
      break;
    case "refused":
      buyAnswered();
      system("refused", { reason: frame.reason }, "warn");
      return;
    case "event":
      if (frame.event.side === side && frame.event.kind === "deploying") buyAnswered(frame.event.unit);
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
        text.textContent = t(`event.${ev.kind}`, { point: pointName(ev.point), squad: e.callsign?.[lang] ?? "", tier: ev.count, seconds: ev.count });
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
  ws.send(JSON.stringify({ type: "radio", text, strict }));
  noteBuy(text);
  return true;
}

// ---- purchases on their way ----
//
// A purchase has two waits. First the operator has to hear the call and decide: the unit's
// button shows "requested" from the moment a buy call is sent, however it was sent. Then
// the server deploys the squad: the button and the roster show a bar that fills.

const REQUEST_TIMEOUT = 25_000; // ms a call may go unanswered before the button gives up
// Every buy call still waiting on the operator: unit id, or "*" when the call did not say
// which → the times its calls give up, oldest first. Three clicks are three in line.
const requested = new Map();
const buyWords = /\b(buy|purchase|order|deploy|raise|build|recruit)\b|קנה|קנו|רכוש|הזמן|גייס|הקם/i;
const classWords = {
  infantry: /infantry|soldier|squad of men|חי"ר|חיר|רגלים|חיילים/i,
  vehicle: /vehicle|armou?r|tank|truck|רכב|שריון|טנק|טנדר/i,
  naval: /boat|naval|ship|סירה|סירת|סירות|ימי/i,
  air: /\bair\b|aircraft|helicopter|drone|אוויר|מסוק|רחפן|נחיל/i,
};

function noteBuy(text) {
  if (!rules || !faction || !buyWords.test(text)) return;
  const low = text.toLowerCase();
  const units = Object.entries(rules.factions[faction]?.units ?? {});
  const says = ([, u]) => [u.name.en, u.name.he].some((name) => name.toLowerCase().split(/\s+/).some((word) => word.length >= 3 && low.includes(word)));
  const named = units.filter(says);
  const hit = named.length ? named : units.filter(([, u]) => classWords[u.class]?.test(text));
  const until = performance.now() + REQUEST_TIMEOUT;
  for (const id of hit.length ? hit.map(([id]) => id) : ["*"]) requested.set(id, [...waiting(id), until]);
}

// waiting lists the calls for a unit that have not been answered and have not given up.
function waiting(unit) {
  const live = (requested.get(unit) ?? []).filter((until) => until > performance.now());
  requested.set(unit, live);
  return live;
}

// The operator answered, or the server did: nothing is waiting on a decision any more.
// A deployment that starts answers the oldest call for that unit; a Negative answers them all.
function buyAnswered(unit) {
  if (!unit) return requested.clear();
  for (const key of [unit, "*"]) requested.set(key, waiting(key).slice(1));
}

const inLine = (unit) => waiting(unit).length + waiting("*").length;

// How closely the net holds the player to radio procedure: 1 relaxed, 2 standard, 3 strict.
let strict = [1, 2, 3].find((n) => String(n) === localStorage.getItem("callsign.strict")) ?? 1;
$("strict").value = String(strict);
$("strict").addEventListener("change", (ev) => {
  strict = Number(ev.target.value);
  localStorage.setItem("callsign.strict", String(strict));
});

const speaks = (text) => (/[\u0590-\u05ff]/.test(text) ? "he" : "en");

for (const id of ["help-open", "help-close"]) $(id).addEventListener("click", () => ($("help").hidden = id === "help-close"));
$("help").addEventListener("click", (ev) => ev.target === $("help") && ($("help").hidden = true));
addEventListener("keydown", (ev) => ev.key === "Escape" && ($("help").hidden = true));
$("help").hidden = !query.has("help");

// The help window has two panes; clicking an example call puts it in the radio box.
function helpTab(name) {
  for (const pane of document.querySelectorAll("#help [data-pane]")) pane.hidden = pane.dataset.pane !== name;
  for (const tab of document.querySelectorAll("#help [data-tab]")) tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
}
for (const tab of document.querySelectorAll("#help [data-tab]")) tab.addEventListener("click", () => helpTab(tab.dataset.tab));
helpTab(query.get("help") === "examples" ? "examples" : "guide");
for (const example of document.querySelectorAll("#help .examples code")) {
  example.addEventListener("click", () => {
    $("help").hidden = true;
    draft(example.textContent);
  });
} // ?help opens the page on the help window

// draft puts a call in the box for the player to send or edit.
function draft(text) {
  $("text").value = text;
  syncInputDirection();
  $("text").focus();
}

// Calls already sent, oldest first. Up and Down in the box walk through them.
const sent = [];
let recall = 0; // index into `sent`; sent.length means the box holds a new call
let unsent = "";

// sendBox transmits what is in the box. At the relaxed level a roughly spelled callsign
// or place is corrected first.
function sendBox() {
  let text = $("text").value.trim();
  if (text && strict === 1 && rules) text = tidy(text, { lang: speaks(text), rules });
  if (!transmit(text)) return;
  if (sent.at(-1) !== text) sent.push(text);
  recall = sent.length;
  draft("");
}

$("send").addEventListener("submit", (ev) => {
  ev.preventDefault();
  sendBox();
});

$("text").addEventListener("keydown", (ev) => {
  if (ev.key !== "ArrowUp" && ev.key !== "ArrowDown") return;
  const next = recall + (ev.key === "ArrowUp" ? -1 : 1);
  if (next < 0 || next > sent.length) return;
  ev.preventDefault();
  if (recall === sent.length) unsent = $("text").value;
  recall = next;
  draft(recall === sent.length ? unsent : sent[recall]);
});

// ---- voice ----
// Push-to-talk: hold the button, or the key left of 1, and speak a call. It is recognised
// in this browser, tidied into procedure, and put in the box to check and send.

let voiceState = "idle";
let voiceDetail = {};
let wasMuted = null; // the music's mute switch before we started listening
const voice = new Voice({
  onState(next, detail = {}) {
    voiceState = next;
    voiceDetail = detail;
    renderVoice();
  },
});

function renderVoice() {
  const status = $("voice-status");
  status.hidden = voiceState === "idle";
  status.textContent = voiceState === "idle" ? "" : t(`voice.${voiceState}`, voiceDetail);
  status.className = ["unsupported", "denied", "missing", "failed"].includes(voiceState) ? "warn" : "";
  $("ptt").title = t("voiceHint");
  $("ptt").classList.toggle("live", voiceState === "listening");
  $("ptt").classList.toggle("busy", ["asking", "loading", "working"].includes(voiceState));
}

function talk() {
  if (role === "spectator" || voice.held) return;
  if (wasMuted === null) {
    wasMuted = music.muted; // the music would be heard as speech
    music.setMuted(true);
  }
  voice.start(lang);
}

// callsigns lists what a call to this side can open with: its squads' class names, the
// operator and "all stations".
function callsigns(spoke) {
  const cs = rules.callsigns;
  const classes = new Set(Object.values(rules.factions).flatMap((f) => Object.values(f.units).map((u) => u.class)));
  return [...[...classes].map((c) => cs.classes[c][spoke]), cs.operator[spoke], cs.allStations[spoke]];
}

async function talkEnd() {
  if (wasMuted !== null) music.setMuted(wasMuted);
  wasMuted = null;
  if (!voice.held) return;
  const spoke = lang;
  const text = await voice.stop(spoke, rules ? callsigns(spoke) : []);
  if (!text || !rules) return;
  // Spoken calls go out at once; the log shows what was sent, and Up brings it back to fix.
  draft(tidy(text, { lang: spoke, rules }));
  sendBox();
}

$("ptt").addEventListener("pointerdown", (ev) => {
  ev.preventDefault();
  $("ptt").setPointerCapture(ev.pointerId);
  talk();
});
for (const kind of ["pointerup", "pointercancel"]) $("ptt").addEventListener(kind, talkEnd);
addEventListener("keydown", (ev) => {
  if (ev.code !== "Backquote" || ev.ctrlKey || ev.altKey || ev.metaKey) return;
  ev.preventDefault();
  if (!ev.repeat) talk();
});
addEventListener("keyup", (ev) => ev.code === "Backquote" && talkEnd());
addEventListener("blur", talkEnd);

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
  const deploying = (state.deploying ?? []).filter((d) => d.side === side);
  const cap = rules.match.populationCap;
  const pop = mine.length + deploying.length; // a squad on its way already holds its place
  $("pop").textContent = `${pop}/${cap}`;
  const canAct = Boolean(me) && !state.over;

  // The lists are rebuilt only when what they show changes, so buttons stay clickable.
  // Progress bars are then moved in place on every frame.
  const afford = rules.tiers.map((tier) => state.gold >= tier.upgradeCost);
  const rosterKey = JSON.stringify([lang, scene.selected, canAct, afford, mine.map((sq) => [sq.id, sq.alive, sq.tier, sq.order]), deploying.map((d) => d.id)]);
  if (rosterKey !== drawn.roster) {
    drawn.roster = rosterKey;
    const rows = [...mine.map((sq) => rosterRow(sq, canAct)), ...deploying.map(deployRow)];
    $("roster").replaceChildren(...(rows.length ? rows : [el("li", "empty", t("rosterEmpty"))]));
  }
  const units = Object.entries(rules.factions[faction]?.units ?? {});
  const buildKey = JSON.stringify([lang, faction, canAct, pop >= cap, units.map(([, u]) => state.gold >= u.cost)]);
  if (buildKey !== drawn.build) {
    drawn.build = buildKey;
    $("build").replaceChildren(...units.map(([id, u]) => buildButton(id, u, canAct && pop < cap && state.gold >= u.cost)));
  }
  renderDeploying(deploying);
}

const secondsLeft = (d) => Math.ceil(d.ticksLeft / rules.tickRate);
const progress = (d) => 1 - d.ticksLeft / d.ticksTotal;

// renderDeploying moves the bars: on the roster rows, and on each unit's build button,
// which shows the squad of that unit closest to the field and how many are on their way.
function renderDeploying(deploying) {
  for (const d of deploying) {
    const row = $("roster").querySelector(`[data-deploy="${d.id}"]`);
    if (!row) continue;
    row.querySelector(".deploy-bar b").style.inlineSize = `${progress(d) * 100}%`;
    row.querySelector(".order").textContent = t("deployingIn", { seconds: secondsLeft(d) });
  }
  for (const button of $("build").children) {
    const queue = deploying.filter((d) => d.unit === button.dataset.unit);
    const first = queue[0];
    button.classList.toggle("deploying", Boolean(first));
    const asked = inLine(button.dataset.unit);
    button.classList.toggle("requested", !first && asked > 0);
    button.querySelector(".fill").style.blockSize = first ? `${progress(first) * 100}%` : "0";
    button.querySelector(".left").textContent = first ? t("seconds", { seconds: secondsLeft(first) }) : "";
    const count = button.querySelector(".count");
    // How many of this unit are in line: asked for and not yet answered, plus on their way.
    const total = asked + queue.length;
    count.hidden = total < 2 && asked === 0;
    count.textContent = String(total);
  }
}

// deployRow is a bought squad on its way: it becomes an ordinary roster row on arrival.
function deployRow(d) {
  const unit = rules.factions[faction].units[d.unit];
  const li = el("li", "deploying");
  li.dataset.deploy = d.id;
  const name = el("span", "name", d.callsign[lang]);
  name.append(el("span", "unit", unit.name[lang]));
  const bar = el("span", "deploy-bar");
  bar.append(el("b"));
  li.append(name, bar, el("span", "order", t("deployingIn", { seconds: secondsLeft(d) })));
  return li;
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
  button.dataset.unit = id;
  const icon = el("canvas");
  const dpr = devicePixelRatio || 1;
  icon.width = 72 * dpr;
  icon.height = 48 * dpr;
  const g = icon.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.translate(36, unit.class === "infantry" ? 38 : 36);
  g.scale(1.25, 1.25);
  drawUnit(g, { unit: id, cls: unit.class, faction, members: Math.min(unit.members, 3), moving: false, firing: false, time: 0, turn: 0.4, seed: 0 });
  const count = el("span", "count");
  count.hidden = true;
  // The fill rises behind the picture while a squad of this unit deploys.
  button.append(el("i", "fill"), icon, el("span", "", unit.name[lang]), el("span", "cost", String(unit.cost)), el("bdi", "left"), count);
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
  if (hit.contact) {
    const name = scene.contactName(hit.contact, lang);
    const mine = state.squads.find((sq) => sq.id === scene.selected);
    return draft(mine ? call("attack", { to: mine.callsign[lang], point: name }) : $("text").value + name);
  }
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
