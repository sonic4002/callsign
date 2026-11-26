// The command screen: an isometric battlefield, a radio console, and a sidebar of
// instruments. The radio is the only way to act. Every button here does one thing:
// it writes a radio call, in the page language, and the server routes it like any other.
// Nerve shows in what the troops do; the "show nerve" switch is a debugging aid.

import { Agents, mountMonitor } from "./brains/monitor.js";
import { mountAgents } from "./brains/settings.js";
import { drawUnit, loadSprites } from "./art.js";
import { wantedStructure } from "/agents/bases.mjs";
import { drawIcon } from "./bases-art.js";
import { ofRole, structureCards, structureDef, techSite, unitDef, unitLock } from "./bases.js";
import { cueMark, cued, cueVoice, foldLog, spoken, stripPick } from "./cues.js";
import { heard, onCommandNet, onSquadNet, traffic } from "./nets.js";
import { createRoom, forgetSeat, freeSeat, onlyThisMachine, pageFor, roomInfo, saveSeat, savedSeat, serverInfo, shareLink, takeSeat } from "./lobby.js";
import { Scene, sideColor } from "./map.js";
import { Music } from "./music.js";
import { Sfx } from "./sfx.js";
import { haulerRows } from "./gold.js";
import { powerTag, radarState, renderPower, repairCost, sellValue, structureActions, wouldRunShort } from "./power.js";
import { iconSvg } from "./marks.js";
import { canDigIn, digProgress, eventNames, heroEventKind, heroLock, heroOrders, heroRow, rankBadge, syncHero, withBuilt } from "./heroes.js";
import { Speech } from "./speech/speech.js";
import { matchLengths, ordersFor, parseOffset, seatState, startGold } from "./places.js";
import { RUNS, canPlace, parseSpot, runSegments, spotAt, spotForm, spotWords, tint, unitLine } from "./placement.js";
import { drawMiniMap } from "./terrain.js";
import { attachGestures, fingers } from "./touch.js";
import { Coach, seen as lessonSeen } from "./tutorial.js";
import { tidy } from "./voice/normalize.js";
import { hintCalls, hintPhrases } from "./voice/hints.js";
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
// ?room=<code> is the match this page is in. The seat this browser holds there is kept
// by the browser, so a reload sits back down in it.
let room = (query.get("room") ?? "").trim().toUpperCase();
let seat = room ? savedSeat(room) : null;
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

// labels writes every fixed text of the page in the current language.
function labels() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
  document.title = t("title");
  for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll("[data-i18n-placeholder]")) node.placeholder = t(node.dataset.i18nPlaceholder);
  for (const node of document.querySelectorAll("[data-i18n-aria]")) node.setAttribute("aria-label", t(node.dataset.i18nAria));
}

// The start screen says what it is at once, while the pictures and the music list are
// still on their way: on a slow connection that takes a while, and a screen of blank
// buttons looks broken.
labels();
$("overlay").classList.remove("booting");
$("overlay-title").textContent = t("title");
$("overlay-line").textContent = t("loading");
$("start").textContent = t("loading");
$("start").disabled = true;

function applyLanguage() {
  labels();
  syncInputDirection();
  renderVoice();
  renderLog();
  drawn.roster = drawn.build = "";
  renderSidebar();
  renderOverlay();
  brains.render();
  monitor.sync(true);
  renderTrack();
  coach.render();
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
  voice.prepare(lang); // the other language has its own speech model
  tellLanguage();
}
// tellLanguage tells the game which language this commander reads, so that what it is
// told unasked (the operator's base cues) comes in it from the first line.
function tellLanguage() {
  if (me && open()) ws.send(JSON.stringify({ type: "lang", text: lang }));
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
let lobby = null; // the room's seats and phase, as the server last told this connection
let offer = null; // what the server offers before a match exists: factions, a scripted enemy
let found = null; // a room looked up by its code, before this browser holds a seat in it
let baseRules = null; // the rules, for names in the lobby before any greeting
let lobbyError = null; // () => text: why the last lobby step failed, in the page language
let lobbyBusy = false; // a lobby request is on its way
const drawn = { roster: "", build: "" }; // what the sidebar lists show now

const scene = new Scene($("map"), $("radar-map"), { lang: () => lang, showNerve: () => $("nerve").checked, side });
const music = await new Music().load();
scene.onFinale = () => renderOverlay();
scene.sfx = new Sfx({ level: () => (music.muted ? 0 : music.volume) }); // guns and blasts follow the music's volume and mute
const speech = new Speech({ volume: () => 0.6 + 0.4 * music.volume, duck: (on) => (music.duck(on), scene.sfx.duck(on)) });
speech.bind($("speak"));
// Settings: the gear opens them. Sound, the radio procedure level and the display options
// live there, out of the sidebar.
$("settings-open").addEventListener("click", () => {
  $("voices").checked = speech.enabled;
  $("settings").showModal();
});
$("voices").addEventListener("change", (ev) => {
  speech.setEnabled(ev.target.checked);
  $("speak").classList.toggle("off", !speech.enabled);
});
$("settings").addEventListener("click", (ev) => ev.target === $("settings") && $("settings").close());
// What the page says by itself when the game goes away, kept ready while the server is there.
speech.keep({ lost: { en: strings.en.declareLost, he: strings.he.declareLost } });
let wasOnline = false; // the connection was up, so its loss is news
let lostBefore = false;
// The pictures arrive in their own time: the start screen does not wait for them, and the
// map draws its plain stand-ins until they are here.
loadSprites().then(() => {
  drawn.roster = drawn.build = "";
  if (rules) renderSidebar();
});

const pointName = (id) => rules.map.points.find((p) => p.id === id)?.callsign[lang] ?? id;
// placeName is what an order's place is called: a landmark or bridge by its name, a spot
// off a point in words, a point by its callsign.
function placeName(id) {
  const named = [...(rules.map.landmarks ?? []), ...(rules.map.bridges ?? [])].find((p) => p.id === id);
  if (named) return named.name[lang];
  const spot = parseSpot(rules, id);
  if (spot) return spotWords(t, spot, pointName(spot.point));
  const off = parseOffset(id);
  if (off) return t("place.offset", { metres: off.metres, bearing: t(`bearing.${off.bearing}`), point: pointName(off.point) });
  return pointName(id);
}
const clock = (tick) => {
  if (!rules) return "--:--"; // before the server's greeting
  const s = Math.floor(tick / rules.tickRate);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const open = () => ws?.readyState === WebSocket.OPEN;

// The player's own agents, when this browser runs them (client/brains).
// They join with the seat this page holds: the lobby's room and seat token, or the open
// room of a server without seats. A page with no connection has no seat to run agents for.
const brains = mountAgents({
  t,
  system,
  server: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
  side,
  // In the first lesson the squads always think here, with the rule brain (`lesson`);
  // `fast` is the host's choice of the fast brain for this match (brains/policy.js).
  seat: () => (!ws || role !== "hammer" ? null : room ? (seat ? { room, token: seat.token, lesson: Boolean(lobby?.tutorial), fast: Boolean(lobby?.fast) } : null) : { room: "" }),
  canAct: () => role === "hammer",
});

// The live view of this side's agents: model, context and state of each (brains/monitor.js).
const watched = new Agents();
const monitor = mountMonitor({
  agents: watched,
  list: $("monitor-list"),
  strip: $("monitor-strip"),
  side: $("monitor-side"),
  t,
  lang: () => lang,
  tierName: (tier) => tierName(tier),
  // Who should have an agent: the operator, and a leader for every squad of ours.
  stations: () =>
    !rules || !state || !me
      ? []
      : [{ squad: 0, callsign: rules.callsigns.operator, tier: 0 }, ...state.squads.filter((sq) => sq.side === side && sq.alive > 0).map((sq) => ({ squad: sq.id, callsign: sq.callsign, tier: sq.tier }))],
  onOpen: () => brains.open("live"),
});
// A squad whose leader is thinking shows it in the roster.
function markThinking() {
  const busy = watched.thinking();
  for (const li of $("roster").children) li.classList.toggle("thinking", busy.has(Number(li.dataset.squad)));
}

// The first lesson's coach (tutorial.js). It reads the match the way the player sees it.
let enemyDown = false; // an enemy squad has been destroyed in this match
const coach = new Coach({
  t,
  touch: fingers,
  scene,
  send: (frame) => open() && (ws.send(JSON.stringify(frame)), true),
  context: () => ({ side, state, rules, me, lang, selected: scene.selected, destroyed: enemyDown, log: entries.filter((e) => e.kind === "radio").map((e) => e.message) }),
  leave: () => location.assign(pageFor({})),
});

function connect() {
  system("connecting");
  const params = new URLSearchParams({ side, role });
  if (room) params.set("room", room);
  if (seat) params.set("token", seat.token);
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?${params}`);
  ws.addEventListener("message", (ev) => onFrame(JSON.parse(ev.data)));
  ws.addEventListener("open", () => {
    document.body.classList.remove("no-server");
    if (lostBefore && !wasOnline) system("reconnected");
    wasOnline = true;
    lostBefore = true;
  });
  ws.addEventListener("close", (ev) => {
    if (ev.code === 1008) return turnedAway(ev.reason); // refused: knocking again will not help
    document.body.classList.add("no-server"); // the page says so until the server is back
    // Radio still waiting to be spoken is about a net that is gone: drop it, and say so.
    if (wasOnline) speech.declare("lost", lang);
    else speech.silence();
    wasOnline = false;
    system("disconnected", {}, "warn");
    setTimeout(connect, 1000);
  });
}

// gone is what the page does when the match in its address no longer exists (it ended,
// or the server was restarted): it goes back to the start screen, where a new match can
// be made or another code typed, and says why it is there.
function gone() {
  const code = room;
  if (code) forgetSeat(code);
  room = "";
  seat = null;
  found = null;
  lobby = null;
  ws = null;
  history.replaceState(null, "", pageFor({}));
  lobbyError = () => t("lobby.noRoom", { code });
  renderOverlay();
}

// The server would not let this page into the room, and said why.
function turnedAway(reason) {
  ws = null;
  lobby = null;
  if (/no such match/.test(reason)) {
    return gone();
  } else if (/hold that seat/.test(reason)) {
    // The seat is someone else's now, or the token was for an older match with this code.
    forgetSeat(room);
    seat = null;
    lookUp();
  } else if (/spectators/.test(reason)) {
    lobbyError = () => t("lobby.noWatching");
  } else {
    lobbyError = () => t("lobby.failed", { reason });
  }
  brains.agents.sync(); // no seat, no agents
  renderOverlay();
}

function onFrame(frame) {
  switch (frame.type) {
    case "hello":
      rules = frame.rules;
      state = frame.state;
      me = frame.station ?? null;
      faction = frame.faction;
      tellLanguage();
      lobby = frame.lobby ?? null;
      lobbyError = null;
      readyUp();
      entries = frame.log.map((m) => ({ kind: "radio", message: m }));
      command = frame.command ?? { mode: "orders", buy: false };
      upgrading.clear();
      promoted.clear();
      system(me ? "matchStarted" : "spectating", { faction });
      watched.hello(frame.agents);
      monitor.sync();
      brains.agents.newMatch(frame.match);
      brains.agents.sync(); // the seat may be a new one: a match just made or joined
      withBuilt(rules, state);
      scene.setRules(rules);
      scene.setState(state);
      drawn.roster = drawn.build = "";
      hideOrders();
      enemyDown = false;
      coach.enter(room, lobby?.tutorial);
      break;
    case "telemetry":
      // What one of this side's agents says about itself (client/brains/monitor.js).
      monitor.update(watched.frame(frame));
      markThinking();
      return;
    case "state":
      state = frame.state;
      // Sandbag positions built in the match are landmarks like any; the log names them once known.
      if (withBuilt(rules, state)) renderLog();
      scene.setState(state);
      break;
    case "lobby": {
      const other = lobby?.seats[1 - side];
      lobby = frame.lobby;
      const now = lobby.seats[1 - side];
      // The other commander leaving or returning mid-match is news; their squads fight on.
      if (me && lobby.phase === "playing" && other?.taken && other.online !== now.online) system(now.online ? "lobby.back" : "lobby.left", {}, "warn");
      readyUp();
      break;
    }
    case "command":
      // Hammer handed Anvil the fight, or took command back: said once, in plain words.
      command = frame.command;
      {
        const was = shownCommand;
        shownCommand = command;
        // Said once, in plain words: who tasks the squads, and who holds the purse.
        const handed = command.mode === "fight";
        const purse = command.buy;
        if (me && was.mode !== command.mode) system(handed ? "command.nowFight" : "command.nowOrders");
        if (me && was.buy !== command.buy) system(purse ? "command.nowBuys" : "command.nowAsks");
      }
      break;
    case "radio":
      entries.push({ kind: "radio", message: frame.message });
      // Anvil turning a purchase down ends the wait for it.
      if (frame.message.from.key === "operator" && frame.message.prowords?.some((w) => w === "negative" || w === "sayAgain")) buyAnswered();
      if (frame.message.from.key === "operator" && frame.message.prowords?.some((w) => w === "negative" || w === "sayAgain")) upgrading.clear();
      // The sign-off ends the match: whatever radio was still waiting is dropped for it.
      if (frame.message.final) speech.silence();
      // Only what the command net shows at the chosen radio traffic is spoken; the squad
      // net is read, never heard. A base cue is always written; whether it is also spoken
      // is the player's choice.
      if (heard(frame.message) && spoken(frame.message)) speech.say(frame.message, { rules, faction });
      break;
    case "acted":
      acted(frame);
      return;
    case "direct":
      return; // a line for the side's agents; the page reads the state
    case "refused":
      buyAnswered();
      upgrading.clear();
      system("refused", { reason: frame.reason }, "warn");
      return;
    case "event":
      if (frame.event.side === side && frame.event.kind === "deploying") buyAnswered(frame.event.unit);
      if (frame.event.side === side && frame.event.kind === "structure_started") buyAnswered(`s:${frame.event.unit}`);
      if (frame.event.side === side && frame.event.kind === "enemy_destroyed") enemyDown = true;
      if (frame.event.side === side && frame.event.kind === "upgraded") {
        // The upgrade landed: the wait is over and the squad's row shows its new rank for a while.
        upgrading.delete(frame.event.squad);
        promoted.set(frame.event.squad, performance.now() + PROMOTED_FOR);
      }
      // A squad of engineers used up in a takeover is told by the takeover itself.
      if (frame.event.kind === "squad_lost" && frame.event.reason === "spent") break;
      // A hero's, or a squad that changed hands: whose it is decides the words.
      if (frame.event.side === side) frame.event.kind = heroEventKind(frame.event);
      // Whose structure it was decides how its loss or takeover reads.
      if (frame.event.side === side && frame.event.kind.startsWith("structure_")) frame.event.kind = structureEvent(frame.event, side);
      // A rally point put back beside the structures reads differently from one that was set.
      if (frame.event.kind === "rally_set" && !frame.event.place) frame.event.kind = "rally_home";
      // Pinned, contact and the like are for the squads to say on the radio, not for a HUD.
      // News the operator's base cue tells is left to the cue: one line, not two. Someone
      // watching hears no cues and reads the page's own lines.
      if (me && frame.event.side === side && cued(rules, frame.event)) break;
      if (frame.event.side === side && `event.${frame.event.kind}` in strings.en) {
        entries.push({ kind: "event", event: frame.event, callsign: frame.callsign });
      }
      break;
  }
  if (frame.type !== "state") renderLog();
  renderSidebar();
  renderOverlay();
  coach.update();
}

function system(key, vars = {}, tone = "") {
  entries.push({ kind: "system", key, vars, tone, tick: state?.tick ?? 0 });
  renderLog();
}

// ---- radio console ----

// Two nets (nets.js). The command net is what is said to and by the commander, as much of
// it as the radio traffic setting lets through, with the page's own lines; the squad net
// is what the squads and the operator say among themselves, drawn only while its tab is open.
function renderLog() {
  const level = traffic.level;
  // Repeats are folded into one line ("3 squads are ready"), and a phone's strip shows
  // the few lines that matter most: radio to the player before system lines.
  drawLog($("log"), foldLog(entries.filter((e) => onCommandNet(e, level))), true);
  if ($("radio").dataset.net !== "squad") return;
  const squad = entries.filter(onSquadNet).map((entry) => ({ entry, count: 1 }));
  drawLog($("squad-log"), squad, false);
  if (squad.length === 0) $("squad-log").append(el("li", "system empty", t("squadNet.empty")));
}

function drawLog(log, lines, withStrip) {
  const pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  const strip = new Set(withStrip ? stripPick(lines, "player", 4) : []);
  const strip2 = new Set(withStrip ? stripPick(lines, "player", 2) : []);
  log.replaceChildren(
    ...lines.map(({ entry: e, count }, i) => {
      const li = el("li");
      const time = el("time");
      const text = el("span", "text");
      const shown = `${strip.has(i) ? " strip" : ""}${strip2.has(i) ? " strip2" : ""}`;
      if (e.kind === "radio") {
        const m = e.message;
        time.textContent = clock(m.tick);
        li.className = `radio ${m.from.squad ? "squad" : m.from.key}${m.cue ? " cue" : ""}${shown}`;
        text.textContent = m.text; // always as transmitted, in the language it was sent in
        li.append(time, el("span", "who", m.from[lang]), ...(m.cue ? [cueMark()] : []), text);
        return li;
      }
      li.className = `system ${e.tone ?? ""}${shown}`;
      const times = (line) => (count > 1 ? `${line} \u2066×${count}\u2069` : line);
      if (e.kind === "event") {
        const ev = e.event;
        time.textContent = clock(ev.tick);
        const vars = { point: pointName(ev.point), place: ev.place ? placeName(ev.place) : "", squad: e.callsign?.[lang] ?? "", tier: ev.count, seconds: ev.count, name: tierName(ev.count), structure: ev.unit ? kindName(ev.unit) : "", unit: unitDef(rules, ev.unit ?? "")?.name[lang] ?? "", gold: ev.count, count, ...eventNames(rules, ev, lang) };
        text.textContent = count > 1 && `eventMany.${ev.kind}` in strings.en ? t(`eventMany.${ev.kind}`, vars) : times(t(`event.${ev.kind}`, vars));
      } else {
        time.textContent = clock(e.tick);
        text.textContent = times(t(e.key, { ...e.vars, from: me?.[lang] ?? "", faction: rules?.factions[e.vars.faction]?.name[lang] ?? "" }));
      }
      li.append(time, text);
      return li;
    }),
  );
  if (pinned) log.scrollTop = log.scrollHeight;
}

// The net's two tabs. The command net is the one a match opens on, every time.
function showNet(name) {
  $("radio").dataset.net = name;
  for (const tab of $("net-tabs").children) tab.setAttribute("aria-selected", String(tab.dataset.net === name));
  $("squad-log").hidden = name !== "squad";
  renderLog();
  const log = name === "squad" ? $("squad-log") : $("log");
  log.scrollTop = log.scrollHeight;
}
for (const tab of $("net-tabs").children) tab.addEventListener("click", () => showNet(tab.dataset.net));
showNet("command");

// How much radio traffic the commander is shown and hears: 1 quiet, 2 normal, 3 full.
$("traffic").value = String(traffic.level);
$("traffic").addEventListener("change", (ev) => {
  traffic.level = Number(ev.target.value);
  speech.silence(); // what was waiting to be spoken was chosen by the old level
  renderLog();
});

// Base cues are spoken unless the player turned that off; they are written either way.
$("cue-voice").checked = cueVoice.on;
$("cue-voice").addEventListener("change", (ev) => (cueVoice.on = ev.target.checked));

// transmit puts text on the net. It is the one place this page acts on the match.
function transmit(text) {
  if (!text || !open()) return false;
  ws.send(JSON.stringify({ type: "radio", text, strict }));
  noteBuy(text);
  noteUpgrade(text);
  return true;
}

// ---- who has the initiative ----
//
// Anvil acts on the player's orders only, until the player hands it the fight. The server
// holds the mode and says when it changes; the switch here only transmits the radio call.
let command = { mode: "orders", buy: false };
let shownCommand = { mode: "orders", buy: false }; // what the log last said about it

// ---- upgrades on their way ----
//
// An upgrade is instant on the server, but the call first waits on the operator. From the
// moment an upgrade call names a squad, that squad's button shows "requested", until the
// upgrade lands, the operator says Negative, the net refuses the call, or it gives up.
const upgrading = new Map(); // squad id → time the request gives up
const promoted = new Map(); // squad id → time its new rank stops being highlighted
const PROMOTED_FOR = 6000;
const upgradeWords = /\b(upgrade|promote)\b|שדרג|שדרוג|קדם/i;
const tierName = (tier) => rules?.tiers.find((x) => x.tier === tier)?.name[lang] ?? "";

function noteUpgrade(text) {
  if (!state || !upgradeWords.test(text)) return;
  const low = text.toLowerCase();
  // The longest callsign that the call names, so that "Viper 12" is not read as "Viper 1".
  const named = state.squads
    .filter((sq) => sq.side === side)
    .flatMap((sq) => [sq.callsign.en, sq.callsign.he].filter(Boolean).map((name) => [name.toLowerCase(), sq.id]))
    .filter(([name]) => new RegExp(`(^|[^0-9a-z\u0590-\u05ff])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![0-9])`).test(low))
    .sort((a, b) => b[0].length - a[0].length)[0];
  if (named) upgrading.set(named[1], performance.now() + REQUEST_TIMEOUT);
}

// live drops the entries of one of the two maps above whose time has passed, and lists the rest.
function live(map) {
  for (const [id, until] of map) if (until <= performance.now()) map.delete(id);
  return [...map.keys()];
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
  hauler: /hauler|crawler|gold truck|משאית|זחל כרייה/i,
};

function noteBuy(text) {
  if (!rules || !faction || !buyWords.test(text)) return;
  const low = text.toLowerCase();
  // A call to build a structure waits on the operator like a purchase does; its button
  // shows it until work starts.
  const structure = wantedStructure(low, rules.factions[faction]?.structures ?? {});
  if (structure) return void requested.set(`s:${structure}`, [...waiting(`s:${structure}`), performance.now() + REQUEST_TIMEOUT]);
  const units = Object.entries(rules.factions[faction]?.units ?? {});
  // The whole name first ("הנדסה קרבית"); a single word of it only when no unit is named in
  // full, and then as a whole word: "קרבית" must not pick the "מסוק קרב".
  const words = new Set(low.split(/[^\p{L}\p{N}"]+/u));
  const full = units.filter(([, u]) => [u.name.en, u.name.he].some((name) => low.includes(name.toLowerCase())));
  const says = ([, u]) => [u.name.en, u.name.he].some((name) => name.toLowerCase().split(/\s+/).some((word) => word.length >= 3 && words.has(word)));
  const named = full.length ? full : units.filter(says);
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
  if (!fingers()) $("text").focus(); // on a phone this would open the keyboard over the map
}

// Calls already sent, oldest first. Up and Down in the box walk through them.
const sent = [];
let recall = 0; // index into `sent`; sent.length means the box holds a new call
let unsent = "";

// sendBox transmits what is in the box. At the relaxed level a roughly spelled callsign
// or place is corrected first.
function sendBox(spoken = false) {
  let text = $("text").value.trim();
  if (text && strict === 1 && rules) text = tidy(text, { lang: speaks(text), rules, typed: !spoken });
  if (!transmit(text)) return;
  if (sent.at(-1) !== text) sent.push(text);
  recall = sent.length;
  draft("");
}

// order transmits a call the page wrote itself (a squad, a place and an action picked on
// the map; an upgrade button) at once, without passing through the box. It is kept with
// the sent calls, so Up brings it back to change and send again.
// ---- the commander's own hand ----
//
// Building, buying, cancelling, selling, repairing and setting a rally point from the
// panel and the menus do not go over the radio: they go straight to the game, which does
// them at once or refuses with its reason (server/room/act.go). Orders to squads are
// never sent this way. A refusal is shown on the card or button it came from, and in the log.
let actSeq = 0;
const acting = new Map(); // id of an action sent → the element to show a refusal on
function act(name, args, at = null) {
  if (!me || !open()) return false;
  const id = ++actSeq;
  acting.set(id, at);
  ws.send(JSON.stringify({ type: "act", id, name, args }));
  return true;
}

// acted takes the game's answer to a direct action: nothing to do when it was done (the
// state shows it), the reason on the card when it was refused.
function acted(frame) {
  const at = acting.get(frame.id);
  acting.delete(frame.id);
  if (frame.ok) return;
  system("refused", { reason: frame.error }, "warn");
  if (!at?.isConnected) return;
  at.classList.add("refused");
  at.dataset.refused = frame.error;
  at.title = frame.error;
  setTimeout(() => {
    at.classList.remove("refused");
    delete at.dataset.refused;
  }, 4000);
}

function order(text) {
  if (!transmit(text)) return;
  if (sent.at(-1) !== text) sent.push(text);
  recall = sent.length;
  // The opening that picking the squad put in the box has been said: take it out again,
  // unless the player has typed on from it.
  if ($("text").value === opening) {
    $("text").value = "";
    syncInputDirection();
  }
}
let opening = ""; // the start of a call that picking a squad wrote into the box

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
// by the game server when it offers that (the recording is sent there and not kept), else
// in this browser, as it is spoken; then tidied into procedure, and put in the box to
// check and send.

let voiceState = "idle";
let voiceDetail = {};
let wasMuted = null; // the music's mute switch before we started listening
const voice = new Voice({
  onState(next, detail = {}) {
    voiceState = next;
    voiceDetail = detail;
    renderVoice();
  },
  onLimit: () => talkEnd(), // the longest recording: it is sent as if the button were let go
});

function renderVoice() {
  // In the lobby the speech model is fetched ahead of the match; its progress shows there.
  const fetching = voiceState === "loading";
  $("lobby-voice").hidden = !fetching && !voice.ready.has(lang);
  $("lobby-voice").textContent = fetching ? t("voice.loading", voiceDetail) : voice.ready.has(lang) ? t("voiceReady") : "";
  const status = $("voice-status");
  status.hidden = voiceState === "idle";
  // While the button is held, a recogniser that writes as it listens shows what it has so far.
  const hearing = voiceState === "listening" && voiceDetail.text;
  status.textContent = voiceState === "idle" ? "" : t(hearing ? "voice.hearing" : `voice.${voiceState}`, voiceDetail);
  status.className = ["unsupported", "insecure", "denied", "missing", "failed"].includes(voiceState) ? "warn" : "";
  $("ptt").title = t(voice.remote ? "voiceHint.server" : "voiceHint");
  $("ptt").classList.toggle("live", voiceState === "listening");
  $("ptt").classList.toggle("busy", ["asking", "loading", "working"].includes(voiceState));
}

function talk() {
  if (role === "spectator" || voice.held) return;
  if (wasMuted === null) {
    wasMuted = music.muted; // the music would be heard as speech
    music.setMuted(true);
  }
  speech.key(true); // keyed up: the set cannot receive
  // The names and words of this net, for the recogniser in this browser to listen for.
  // Whatever goes wrong in listing them, the call is still recorded.
  let phrases = [];
  try {
    phrases = rules ? hintPhrases(rules, lang) : [];
  } catch (err) {
    console.warn("phrase list failed", err);
  }
  voice.start(lang, { phrases });
}

// callsigns lists what a call to this side can open with: its squads' class names, the
// operator and "all stations".
function callsigns(spoke) {
  const cs = rules.callsigns;
  const classes = new Set(Object.values(rules.factions).flatMap((f) => Object.values(f.units).map((u) => u.callsign ?? u.class)));
  // Not everything a side fields is a station: gold haulers have no callsign and no leader.
  const names = [...classes].map((c) => cs.classes[c]?.[spoke]).filter(Boolean);
  return [...names, cs.operator[spoke], cs.allStations[spoke]];
}

async function talkEnd() {
  speech.key(false);
  if (wasMuted !== null) music.setMuted(wasMuted);
  wasMuted = null;
  if (!voice.held) return;
  const spoke = lang;
  // Whatever goes wrong in working out the names to listen for, the key is let go: a
  // recording that never stops is worse than one transcribed without that help.
  let openers = [];
  try {
    openers = rules ? callsigns(spoke) : [];
  } catch (err) {
    console.warn("callsign list failed", err);
  }
  const text = await voice.stop(spoke, openers, rules ? hintCalls(rules, spoke) : "");
  if (!text || !rules) return;
  let said = tidy(text, { lang: spoke, rules, careful: voice.heardBy === "server" }); // the server spells well
  // Tap a squad, then speak: an order that names nobody goes to the squad that is selected.
  const picked = state?.squads.find((sq) => sq.id === scene.selected);
  const names = [...callsigns(spoke), rules.callsigns.player[spoke]].map((name) => name.toLowerCase());
  if (picked && me && !names.some((name) => said.toLowerCase().startsWith(name))) said = t("callPrefix", { to: picked.callsign[spoke], from: me[spoke] }) + said;
  // Spoken calls go out at once; the log shows what was sent, and Up brings it back to fix.
  draft(said);
  sendBox(true);
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
// A tech building is called by its own name on the map ("the clinic east of Delta").
const structureName = (st) => techSite(rules, st)?.name[lang] ?? structureDef(rules, st)?.name[lang] ?? st.kind;
// Any faction's structure by its rules id: events name a structure by its kind alone.
const kindName = (kind) => (Object.values(rules?.factions ?? {}).map((f) => f.structures?.[kind]).find(Boolean) ?? rules?.techBuildings?.[kind])?.name[lang] ?? kind;
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
  renderPower($("power"), me ? state : null, t);
  const radar = me ? radarState(state, side) : "on";
  $("radar-off").hidden = radar === "on";
  $("radar-box").classList.toggle("off", radar !== "on"); // no mini map to show: one line, not an empty box
  if (radar !== "on") $("radar-off").textContent = t(`radar.${radar}`, { structure: ofRole(rules, faction, "radar")?.def.name[lang] ?? "" });

  const mine = state.squads.filter((sq) => sq.side === side);
  const deploying = (state.deploying ?? []).filter((d) => d.side === side);
  const cap = rules.match.populationCap;
  // A squad on its way already holds its place. Haulers have a cap of their own.
  const pop = mine.length + deploying.filter((d) => d.class !== "hauler").length;
  const haulers = haulerRows(state, rules, side);
  const haulerCount = haulers.length + deploying.filter((d) => d.class === "hauler").length;
  $("pop").textContent = `${pop}/${cap}`;
  const canAct = Boolean(me) && !state.over;

  // Who has the initiative, and the one-tap way to change it: a radio call to Anvil.
  const fight = command.mode === "fight";
  $("command").hidden = !me;
  $("command").classList.toggle("fight", fight);
  $("command-mode").textContent = fight ? (command.buy ? t("command.fight") : t("command.fightNoBuy")) : command.buy ? t("command.ordersBuy") : t("command.orders");
  $("command-purse").textContent = command.buy ? t("command.revoke") : t("command.grant");
  $("command-purse").disabled = !canAct;
  $("command-switch").textContent = fight ? t("command.take") : t("command.give");
  $("command-switch").disabled = !canAct;
  // The match's pace beside the clock, when it is not the usual one.
  $("pace").hidden = !lobby || lobby.pace === 1 || !lobby.pace;
  $("pace").textContent = lobby?.pace ? ` ×${lobby.pace}` : "";

  // The lists are rebuilt only when what they show changes, so buttons stay clickable.
  // Progress bars are then moved in place on every frame.
  const afford = rules.tiers.map((tier) => state.gold >= tier.upgradeCost);
  const rosterKey = JSON.stringify([lang, scene.selected, canAct, afford, mine.map((sq) => [sq.id, sq.alive, sq.tier, sq.order, sq.rank, sq.hero?.charges, sq.hero?.seized, Math.round((sq.dig ?? 0) * 10)]), deploying.map((d) => [d.id, d.line ?? 0]), live(upgrading), live(promoted)]);
  if (rosterKey !== drawn.roster) {
    drawn.roster = rosterKey;
    const rows = [...mine.map((sq) => rosterRow(sq, canAct)), ...deploying.map(deployRow)];
    $("roster").replaceChildren(...(rows.length ? rows : [el("li", "empty", t("rosterEmpty"))]));
    monitor.sync();
    markThinking();
  }
  // A hero's health moves in place, like the other bars.
  for (const sq of mine) if (sq.hero) syncHero($("roster").querySelector(`li[data-squad="${sq.id}"]`) ?? document.createElement("li"), sq, t);
  // The faction's own units, and any a captured structure lets this side build.
  const units = [...Object.entries(rules.factions[faction]?.units ?? {}), ...(state.foreignUnits ?? []).map((id) => [id, unitDef(rules, id)])];
  const locks = units.map(([id]) => unitLock(state, rules, faction, side, id) ?? heroLock(state, rules, faction, side, id));
  const room = (u) => (u.class === "hauler" ? haulerCount < rules.match.haulerCap : pop < cap);
  const buildKey = JSON.stringify([lang, faction, canAct, units.map(([id, u]) => [id, room(u) && state.gold >= u.cost]), locks.map((l) => l?.id)]);
  if (buildKey !== drawn.build) {
    drawn.build = buildKey;
    $("build").replaceChildren(...units.map(([id, u], i) => buildButton(id, u, canAct && room(u) && state.gold >= u.cost && !locks[i], locks[i])));
  }
  renderHaulers(haulers, haulerCount);
  renderDeploying(deploying);
  renderStructures(canAct);
}

// renderHaulers lists the side's gold haulers: what each is doing and how full it is. The
// rows are rebuilt when a hauler changes what it does; the load bars move every frame.
function renderHaulers(haulers, count) {
  const any = count > 0 || (state.haulers ?? []).length > 0 || (rules.map.gushers ?? []).length > 0;
  $("haulers-title").hidden = $("haulers").hidden = !any || !me;
  if (!any || !me) return;
  $("hauler-count").textContent = `${count}/${rules.match.haulerCap}`;
  const key = JSON.stringify([lang, haulers.map((h) => [h.id, h.state, h.point])]);
  if (key !== drawn.haulers) {
    drawn.haulers = key;
    const rows = haulers.map((h) => {
      const li = el("li", h.state === "haul.fleeing" ? "fleeing" : "");
      li.dataset.hauler = h.id;
      const bar = el("i", "load");
      bar.append(el("b"));
      li.append(el("strong", "", h.callsign[lang]), el("span", "what", t(h.state, { point: h.point ? pointName(h.point) : "" })), bar);
      return li;
    });
    $("haulers").replaceChildren(...(rows.length ? rows : [el("li", "empty", t("haulersNone"))]));
  }
  for (const h of haulers) {
    const bar = $("haulers").querySelector(`[data-hauler="${h.id}"] .load b`);
    if (bar) bar.style.inlineSize = `${Math.round(h.load * 100)}%`;
  }
}

// A unit waits for the ones ahead of it in its structure's line, then for its own making.
const secondsLeft = (d) => Math.ceil(((d.ticksAhead ?? 0) + d.ticksLeft) / rules.tickRate);
const deployText = (d) => ((d.line ?? 0) > 0 ? t("deploy.waiting", { seconds: secondsLeft(d) }) : t("deployingIn", { seconds: secondsLeft(d) }));
const progress = (d) => 1 - d.ticksLeft / d.ticksTotal;

// renderDeploying moves the bars: on the roster rows, and on each unit's build button,
// which shows the squad of that unit closest to the field and how many are on their way.
function renderDeploying(deploying) {
  for (const d of deploying) {
    const row = $("roster").querySelector(`[data-deploy="${d.id}"]`);
    if (!row) continue;
    row.querySelector(".deploy-bar b").style.inlineSize = `${progress(d) * 100}%`;
    row.querySelector(".order").textContent = deployText(d);
  }
  for (const button of $("build").querySelectorAll("button[data-unit]")) {
    // The one of this unit that comes out first, wherever it is being made, and how many
    // are on their way in all (placement.js).
    const line = unitLine(state, side, button.dataset.unit);
    const first = line.first;
    button.classList.toggle("deploying", Boolean(first));
    // A locked unit is never "asked for": a purchase whose unit is not known yet marks
    // every card as waiting, and that must not light up what cannot be bought.
    const asked = button.classList.contains("locked") ? 0 : inLine(button.dataset.unit);
    button.classList.toggle("requested", !first && asked > 0);
    button.querySelector(".fill").style.blockSize = first && line.making ? `${progress(first) * 100}%` : "0";
    button.querySelector(".left").textContent = first ? t("seconds", { seconds: secondsLeft(first) }) : "";
    const count = button.querySelector(".count");
    // How many of this unit are in line: asked for and not yet answered, plus on their way.
    const total = asked + line.count;
    count.hidden = total < 2 && asked === 0;
    count.textContent = String(total);
    const cancel = button.nextElementSibling;
    cancel.hidden = line.count === 0;
    cancel.disabled = !me || Boolean(state.over);
  }
}

// deployRow is a bought squad on its way: it becomes an ordinary roster row on arrival.
function deployRow(d, i, all) {
  const unit = unitDef(rules, d.unit);
  const li = el("li", "deploying");
  li.dataset.deploy = d.id;
  const name = el("span", "name", d.callsign[lang]);
  name.append(el("span", "unit", unit.name[lang]));
  const bar = el("span", "deploy-bar");
  bar.append(el("b"));
  li.append(name, bar, el("span", "order", deployText(d)));
  // The last one bought of a unit can be taken out of its line.
  if (!all.slice(i + 1).some((o) => o.unit === d.unit)) {
    const cancel = el("button", "cancel", "×");
    cancel.type = "button";
    cancel.title = t("deploy.cancel");
    cancel.setAttribute("aria-label", t("deploy.cancel"));
    cancel.disabled = !me || Boolean(state.over);
    cancel.addEventListener("click", () => act("cancel", { unit: d.unit }, li));
    li.append(cancel);
  }
  return li;
}

$("command-switch").addEventListener("click", () => transmit(call(command.mode === "fight" ? "take" : "give", { to: anvil() })));
$("command-purse").addEventListener("click", () => transmit(call(command.buy ? "revoke" : "grant", { to: anvil() })));

function orderText(sq) {
  if (sq.order.kind === "fortify") return t("order.fortify", { percent: Math.round((digProgress(sq) ?? 0) * 100) });
  if (sq.order.kind === "plant") return t("order.plant");
  if (sq.order.kind === "seize") return t("order.seize");
  if (sq.order.contact) return t("order.contact");
  if (sq.order.kind === "capture") return t("order.capture", { percent: Math.round((sq.order.capture ?? 0) * 100) });
  if (/^s\d+$/.test(sq.order.place ?? "")) return t("order.structure");
  const where = sq.order.place ? placeName(sq.order.place) : sq.order.point ? pointName(sq.order.point) : t("order.here");
  return t(`order.${sq.order.kind}`, { point: where });
}

function rosterRow(sq, canAct) {
  const unit = unitDef(rules, sq.unit);
  const li = el("li", sq.id === scene.selected ? "selected" : "");
  li.dataset.squad = sq.id;
  const name = el("span", "name", sq.callsign[lang]);
  name.append(el("span", "unit", unit.name[lang]));
  const pips = el("span", "pips");
  for (let i = 0; i < sq.full; i++) pips.append(el("i", i < sq.alive ? "" : "lost"));
  const tier = el("span", "tier");
  tier.append(el("span", "rank", t("tier", { tier: sq.tier, name: tierName(sq.tier) })));
  // The rank a squad has earned, in silver, beside the tier it was bought.
  const earned = rankBadge(rules, sq, lang);
  if (earned) tier.append(earned);
  if (promoted.has(sq.id)) li.classList.add("promoted");
  const next = rules.tiers.find((x) => x.tier === sq.tier + 1);
  if (next && me) {
    const asked = upgrading.has(sq.id);
    const up = el("button", asked ? "requested" : "", `▲ ${next.upgradeCost}`);
    up.type = "button";
    up.disabled = !canAct || state.gold < next.upgradeCost;
    up.setAttribute("aria-label", t("upgrade", { squad: sq.callsign[lang], cost: next.upgradeCost }));
    up.title = up.getAttribute("aria-label");
    up.addEventListener("click", (ev) => {
      ev.stopPropagation();
      order(call("upgrade", { to: anvil(), squad: sq.callsign[lang] }));
    });
    tier.append(up);
    if (asked) tier.append(el("small", "asked", t("upgradeAsked")));
  }
  li.append(name, pips, el("span", "order", orderText(sq)), tier);
  if (unit.hero) heroRow(li, sq, unit, { t, name: (id) => state.squads.find((s) => s.id === id)?.callsign[lang] ?? "" });
  li.addEventListener("click", () => select(sq));
  return li;
}

function buildButton(id, unit, enabled, lock) {
  const button = el("button", lock ? "locked" : "");
  button.type = "button";
  button.disabled = !enabled;
  button.dataset.unit = id;
  // What has to be built first, when the structure this unit comes from does not stand.
  const why = lock ? (lock.text ? t("hero.one") : t("structure.needs", { structure: lock.def.name[lang] })) : "";
  if (lock) button.title = why;
  const icon = el("canvas");
  const dpr = devicePixelRatio || 1;
  icon.width = 72 * dpr;
  icon.height = 48 * dpr;
  const g = icon.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.translate(36, unit.class === "infantry" ? 38 : 36);
  g.scale(1.25, 1.25);
  drawUnit(g, { unit: id, cls: unit.class, faction, members: Math.min(unit.members, 3), moving: false, firing: false, time: 0, turn: 0.4, seed: 0, grounded: true });
  const count = el("span", "count");
  count.hidden = true;
  // The fill rises behind the picture while a squad of this unit deploys.
  button.append(el("i", "fill"), icon, el("span", "", unit.name[lang]), el("span", "cost", String(unit.cost)), el("bdi", "left"), count);
  if (lock) {
    // Locked: a padlock on the picture and what it still needs, and it takes no press.
    const mark = el("span", "lock");
    mark.innerHTML = iconSvg("lock", 16);
    button.append(mark, el("span", "needs", why));
  }
  // A press buys at once: the unit joins the line of the structure that makes it.
  button.addEventListener("click", () => act("buy", { unit: id }, button));
  // Beside it, while one of this unit is in a line: the last one taken back out.
  const cancel = el("button", "cancel", "×");
  cancel.type = "button";
  cancel.hidden = true;
  cancel.title = t("deploy.cancel");
  cancel.setAttribute("aria-label", t("deploy.cancel"));
  cancel.addEventListener("click", () => act("cancel", { unit: id }, button));
  const cell = el("div", "unit");
  cell.append(button, cancel);
  return cell;
}

// ---- structures ----

// structureEvent picks the log line for a structure event: whose it was decides the words.
function structureEvent(ev, mySide) {
  // A tech building was nobody's or somebody's: the line does not call it "the enemy's".
  if (ev.kind === "structure_captured" && rules.techBuildings?.[ev.unit]) return ev.owner === mySide ? "structure_captured_tech" : ev.reason === "seen" ? "structure_seen_taken" : "structure_taken";
  if (ev.kind === "structure_lost" && ev.owner !== mySide) return "structure_lost_theirs";
  if (ev.kind === "structure_captured" && ev.owner !== mySide) return "structure_taken";
  return ev.kind;
}

// The Structures half of the build panel. Like the unit buttons, these only write a
// radio call to the operator: pressing one puts its ghost on the map, and the spot the
// player confirms goes into the call (see "placing" below).
// The build panel shows one of its two halves. It opens on Structures, since nothing can
// be bought before something is built, and remembers the player's choice after that.
let buildTab = localStorage.getItem("callsign.buildTab") === "units" ? "units" : "structures";
function showBuildTab(name) {
  buildTab = name;
  for (const pane of document.querySelectorAll("[data-build-pane]")) pane.hidden = pane.dataset.buildPane !== name;
  for (const tab of document.querySelectorAll("[data-build-tab]")) tab.setAttribute("aria-selected", String(tab.dataset.buildTab === name));
}
for (const tab of document.querySelectorAll("[data-build-tab]")) {
  tab.addEventListener("click", () => {
    localStorage.setItem("callsign.buildTab", tab.dataset.buildTab);
    showBuildTab(tab.dataset.buildTab);
  });
}
showBuildTab(buildTab);

// buildBadges puts a count on each tab of what is under way behind it.
function buildBadges(rising, deploying) {
  for (const [id, n] of [["structures-badge", rising], ["units-badge", deploying]]) {
    $(id).hidden = n === 0;
    $(id).textContent = String(n);
  }
}

function renderStructures(canAct) {
  const cards = structureCards(state, rules, faction, side);
  const key = JSON.stringify([lang, faction, canAct, cards.map((c) => [c.id, c.state, c.have, wouldRunShort(state, c.def)])]);
  if (key !== drawn.structures) {
    drawn.structures = key;
    $("structures").replaceChildren(...cards.map((c) => structureButton(c, canAct)));
  }
  for (const card of cards) {
    const button = $("structures").querySelector(`[data-structure="${card.id}"]`);
    if (!button) continue;
    button.querySelector(".fill").style.blockSize = card.state === "rising" ? `${card.progress * 100}%` : "0";
    button.classList.toggle("requested", card.state !== "rising" && waiting(`s:${card.id}`).length > 0);
    // What a base usually builds next, as the game works it out: marked, never pressed for.
    button.classList.toggle("next", Boolean(me) && card.def.role === state.opening && ["ready", "poor"].includes(card.state));
    if (card.state === "rising") button.querySelector(".why").textContent = t("structure.rising", { percent: Math.round(card.progress * 100) });
  }
  renderRally(canAct);
  buildBadges(cards.filter((c) => c.state === "rising").length, (state.deploying ?? []).filter((d) => d.side === side).length);
}

function structureButton(card, canAct) {
  const { id, def } = card;
  const button = el("button", card.state);
  button.type = "button";
  button.dataset.structure = id;
  button.disabled = !canAct || !["ready"].includes(card.state);
  const icon = el("canvas");
  const dpr = devicePixelRatio || 1;
  icon.width = 84 * dpr;
  icon.height = 56 * dpr;
  const g = icon.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.translate(42, def.role === "fence" ? 29 : 45);
  g.scale(0.7, 0.7);
  drawIcon(g, id, def, faction, sideColor[side]);
  const names = (ids) => ids.map((u) => unitDef(rules, u)?.name[lang] ?? u).join(", ");
  const what =
    def.unlocks.length ? t("structure.unlocks", { units: names(def.unlocks) }) : def.role === "power" ? t("structure.power") : def.role === "radar" ? t("structure.radar") : def.role === "refinery" ? t("structure.refinery") : def.role === "fence" ? t("structure.fence") : def.vs?.infantry === 0 ? t("structure.antiAir") : def.role === "defence" ? t("structure.defence") : "";
  const why = {
    ready: what,
    poor: what,
    rising: t("structure.rising", { percent: Math.round(card.progress * 100) }),
    busy: t("structure.busy"),
    full: t("structure.full"),
    needs: card.needs ? t("structure.needs", { structure: card.needs.def.name[lang] }) : "",
  }[card.state];
  const count = el("span", "count", String(card.have));
  count.hidden = card.have < 1;
  button.title = what;
  button.append(
    el("i", "fill"),
    icon,
    el("span", "", def.name[lang]),
    el("span", "cost", `${def.cost} · ${t("seconds", { seconds: def.buildSeconds })}`),
    el("span", "why", why),
    count,
  );
  // What it does to the side's power, and a warning when it would leave the base short.
  const short = wouldRunShort(state, def) && ["ready", "poor"].includes(card.state);
  const tag = powerTag(def, short);
  if (tag) button.querySelector(".cost").after(tag);
  if (short) button.title = t("structure.short");
  button.addEventListener("click", () => startPlacing(id, def));
  return button;
}

// ---- placing a structure, and picking where new squads gather ----
//
// Pressing a structure puts a ghost of it on the map. Under a mouse it follows the
// pointer and a click on green ground confirms; under a finger a tap moves it and the
// button confirms. Confirming sends the structure and its spot straight to the game: it
// starts going up at once, or the refusal comes back with its reason.
let placing = null; // { mode: "build", id, def, faction, spot, why, touch } or { mode: "rally" }
let pointerKind = "mouse"; // what last touched the map

function startPlacing(id, def) {
  hideOrders();
  placing = { mode: "build", id, def, faction, spot: null, why: "", run: RUNS[0].id, segs: null, touch: matchMedia("(pointer: coarse)").matches };
  scene.placing = placing;
  // Start on ground that will take it: under the middle of the view when that fits,
  // otherwise the nearest that does, brought into view.
  const cam = scene.cam;
  const [cx, cy] = cam.world(cam.w / 2, cam.h / 2);
  let spot = spotAt(rules, cx, cy);
  if (canPlace(rules, state, side, def, spot.x, spot.y)) {
    const fits = tint(rules, state, side, def, 20)
      .filter((c) => c.ok)
      .sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))
      .map((c) => spotAt(rules, c.x, c.y))
      .find((s) => !canPlace(rules, state, side, def, s.x, s.y));
    if (fits) {
      spot = fits;
      const [sx, sy] = cam.screen(spot.x, spot.y);
      if (sx < 60 || sy < 60 || sx > cam.w - 60 || sy > cam.h - 150) cam.centerOn(spot.x, spot.y);
    }
  }
  moveGhost(spot.x, spot.y);
}

// judge works out whether the ghost can stand where it is: a structure by its spot, a
// fence by its whole run in the direction it was turned to.
function judge() {
  const { def, spot } = placing;
  if (def.role !== "fence") return (placing.why = canPlace(rules, state, side, def, spot.x, spot.y));
  const laid = runSegments(rules, state, side, def, spot.x, spot.y, placing.run);
  placing.segs = laid.segs;
  return (placing.why = laid.why);
}

function moveGhost(wx, wy) {
  if (placing?.mode !== "build") return;
  placing.spot = spotAt(rules, wx, wy);
  judge();
  renderPlacer();
}

// turnGhost turns a fence being placed to the next of the ways a run can lie.
function turnGhost(step = 1) {
  if (placing?.mode !== "build" || placing.def.role !== "fence" || !placing.spot) return false;
  const at = RUNS.findIndex((r) => r.id === placing.run);
  placing.run = RUNS[(at + step + RUNS.length) % RUNS.length].id;
  judge();
  renderPlacer();
  return true;
}

function renderPlacer() {
  $("placer").hidden = !placing;
  if (!placing) return;
  const build = placing.mode === "build";
  const from = placing.structure ? saidStructure(placing.structure) : "";
  $("placer-title").textContent = build ? t("placer.title", { structure: placing.def.name[lang] }) : from ? t("placer.rallyFrom", { structure: from }) : t("placer.rally");
  // It may be placed all the same; the panel says what it will do to the base's power.
  $("placer-warn").hidden = !(build && wouldRunShort(state, placing.def));
  const why = $("placer-why");
  // Why it cannot stand there, or the spot as the call will say it.
  if (!build) why.textContent = "";
  else if (placing.why) why.textContent = t(`placer.why.${placing.why}`);
  else why.textContent = spotWords(t, placing.spot, pointName(placing.spot.point));
  // A fence can be turned; the panel says which way it lies now.
  const fence = build && placing.def.role === "fence";
  $("placer-turn").hidden = !fence;
  $("placer-run").hidden = !fence;
  if (fence) $("placer-run").textContent = t("placer.run", { run: t(`run.${placing.run}`) });
  why.classList.toggle("bad", build && Boolean(placing.why));
  $("placer-hint").textContent = !build ? t("placer.rallyHint") : t(placing.touch ? "placer.hintTouch" : "placer.hint");
  $("placer-ok").hidden = !build;
  $("placer-ok").disabled = !build || !placing.spot || Boolean(placing.why);
  $("placer-home").hidden = build;
}

function stopPlacing() {
  placing = null;
  scene.placing = null;
  renderPlacer();
}

function confirmPlacing() {
  if (placing?.mode !== "build" || !placing.spot || !me) return;
  // The base may have changed since the ghost was put down.
  if (judge()) return renderPlacer();
  const { def, spot, run, id: placing_id } = placing;
  stopPlacing();
  // It starts at once, on that spot; a fence the way it was turned.
  const card = $("structures").querySelector(`[data-structure="${placing_id}"]`);
  act("build", { structure: placing_id, place: spotForm(spot), run: def.role === "fence" ? run : "" }, card);
}

$("placer-ok").addEventListener("click", confirmPlacing);
$("placer-turn").addEventListener("click", () => turnGhost());
// R turns a fence being placed, unless the player is typing.
addEventListener("keydown", (ev) => {
  if ((ev.key === "r" || ev.key === "R" || ev.key === "ר") && !ev.target.closest?.("input, textarea, select") && turnGhost()) ev.preventDefault();
});
$("placer-cancel").addEventListener("click", stopPlacing);
$("placer-home").addEventListener("click", () => {
  const from = placing?.structure;
  stopPlacing();
  act("rally", { place: "home", structure: from?.id ?? "" });
});
// startRally asks where new squads gather: all of them, or those one structure makes.
function startRally(structure = null) {
  hideOrders();
  scene.placing = null;
  placing = { mode: "rally", structure };
  renderPlacer();
}
$("rally-set").addEventListener("click", () => startRally());
addEventListener("keydown", (ev) => ev.key === "Escape" && placing && stopPlacing());
// A press outside the map and the build panel puts the ghost away.
addEventListener("pointerdown", (ev) => {
  if (placing && !ev.target.closest?.('#map-wrap, #placer, [data-sheet="build"]')) stopPlacing();
});

// placeRally sets the rally point to what is under a tap: a named point, a tech building
// or a landmark. A tap on open ground asks for nothing.
function placeRally(wx, wy) {
  const [sx, sy] = scene.cam.screen(wx, wy);
  const hit = scene.pick(sx, sy, side);
  const near = rules.map.points.find((p) => Math.hypot(p.x - wx, p.y - wy) <= rules.match.captureRadius * 1.15);
  const tech = hit.structure?.role === "tech" ? hit.structure : null;
  const mark = hit.landmark ?? hit.bridge;
  const where = tech?.id ?? mark?.id ?? (hit.point ?? near)?.id;
  if (!where) return;
  const from = placing?.structure;
  stopPlacing();
  act("rally", { place: where, structure: from?.id ?? "" });
}

// renderRally says where new squads gather now, as the side's structures have it.
function renderRally(canAct) {
  const rally = (state.structures ?? []).find((s) => s.side === side && !s.ruin && s.rally)?.rally;
  $("rally-place").textContent = rally ? placeName(rally.place) : t("rally.home");
  $("rally-set").disabled = !canAct;
}


// select marks a squad and starts a call to it.
function select(sq) {
  scene.selected = sq.id;
  drawn.roster = "";
  renderSidebar();
  hideOrders();
  if (me) {
    opening = t("callPrefix", { to: sq.callsign[lang], from: me[lang] });
    draft(opening);
  }
  coach.update();
}

// ---- map ----

const canvas = $("map");
// One pointer drags the map, two pinch it, and a press that did not move is a click.
attachGestures(canvas, {
  onPan(dx, dy) {
    canvas.classList.add("dragging");
    hideOrders();
    scene.cam.pan(dx, dy);
  },
  onZoom(factor, x, y) {
    const box = canvas.getBoundingClientRect();
    scene.cam.zoomAt(x - box.left, y - box.top, factor);
  },
  onEnd: () => canvas.classList.remove("dragging"),
  onTap: mapClick,
});
// Under a mouse, a landmark or a bridge shows its name.
canvas.addEventListener("pointerdown", (ev) => (pointerKind = ev.pointerType));
canvas.addEventListener("pointermove", (ev) => {
  if (ev.pointerType !== "mouse") return;
  const box = canvas.getBoundingClientRect();
  scene.hover = { x: ev.clientX - box.left, y: ev.clientY - box.top };
  // The ghost of a structure being placed follows the mouse.
  if (placing?.mode === "build" && state) moveGhost(...scene.cam.world(scene.hover.x, scene.hover.y));
});
canvas.addEventListener("pointerleave", () => (scene.hover = null));
canvas.addEventListener(
  "wheel",
  (ev) => {
    ev.preventDefault();
    // While a fence is being placed the wheel turns it; otherwise it zooms the map.
    if (turnGhost(ev.deltaY < 0 ? -1 : 1)) return;
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

$("radar-map").addEventListener("click", (ev) => rules && state?.radar !== false && scene.cam.centerOn(...scene.radarToWorld(ev)));

// A click on a squad selects it and starts a call. A click on a point, with a squad
// selected, offers the three orders; with none, it adds the point's name to the message.
function mapClick(ev) {
  if (!rules || !state || !me) return;
  const box = canvas.getBoundingClientRect();
  const sx = ev.clientX - box.left;
  const sy = ev.clientY - box.top;
  if (placing?.mode === "build") {
    moveGhost(...scene.cam.world(sx, sy));
    // A mouse click on green ground is the confirmation; a finger only moves the ghost.
    if (pointerKind === "mouse" && !placing.why) confirmPlacing();
    return;
  }
  if (placing?.mode === "rally") return placeRally(...scene.cam.world(sx, sy));
  const hit = scene.pick(sx, sy, side);
  if (hit.squad) {
    // The squad already picked, tapped again: what it can do where it stands.
    if (hit.squad.id === scene.selected && canDigIn(unitDef(rules, hit.squad.unit))) {
      return offerOrders({ title: `${hit.squad.callsign[lang]} → ${t("order.here")}`, actions: ["fortify"], say: () => call("fortify", { to: hit.squad.callsign[lang] }) }, box, sx, sy);
    }
    return select(hit.squad);
  }
  hideOrders();
  if (hit.contact) {
    const name = scene.contactName(hit.contact, lang);
    const mine = state.squads.find((sq) => sq.id === scene.selected);
    if (!mine) return draft($("text").value + name);
    // With a squad picked, an enemy offers one action: attack it. A hero may seize a vehicle.
    const acts = heroOrders(rules, mine, { kind: "contact", cls: hit.contact.class }, ["attack"]);
    return offerOrders({ title: `${mine.callsign[lang]} → ${name}`, actions: acts, say: (action) => call(action, { to: mine.callsign[lang], point: name }) }, box, sx, sy);
  }
  if (hit.structure) {
    // An enemy structure: engineers are sent to take it over, anyone else to attack it.
    const st = hit.structure;
    const mine = state.squads.find((sq) => sq.id === scene.selected);
    if (st.side === side) return offerStructure(st, mine, box, sx, sy);
    if (!mine) return draft($("text").value + structureName(st));
    // Engineers may take it over; anyone may attack it. The action pressed is sent at once.
    const actions = heroOrders(rules, mine, { kind: "structure" }, unitDef(rules, mine.unit)?.captureSeconds && structureDef(rules, st)?.capturable ? ["capture", "attack"] : ["attack"]);
    const tech = st.role === "tech"; // not "the enemy's": it may be nobody's
    const say = (action) => (action === "plant" ? call("plantStructure", { to: mine.callsign[lang], structure: structureName(st) }) : call(`${action === "capture" ? "capture" : "attackStructure"}${tech ? "Tech" : ""}`, { to: mine.callsign[lang], structure: structureName(st) }));
    return offerOrders({ title: `${mine.callsign[lang]} → ${structureName(st)}`, actions, say }, box, sx, sy);
  }
  const squad = state.squads.find((sq) => sq.id === scene.selected);
  if (hit.gusher && !hit.landmark && !hit.bridge) {
    // A gold field with no squad selected: the call that sends the haulers there. With
    // one selected, the orders go to the point the field is named after.
    if (!squad) return draft(call("haul", { to: anvil(), point: pointName(hit.gusher.point) }));
    hit.point ??= rules.map.points.find((p) => p.id === hit.gusher.point);
  }
  // A landmark, a bridge or a point: with a squad selected the orders it can be given
  // there, with none its name goes into the message.
  const place = hit.landmark ?? hit.bridge ?? hit.point;
  if (!place) return;
  const kind = hit.landmark ? "landmark" : hit.bridge ? "bridge" : "point";
  const name = kind === "point" ? place.callsign[lang] : place.name[lang];
  if (kind !== "point") scene.showName(place.id);
  if (!squad) return draft($("text").value + name);
  const said = kind === "point" ? name : placeName(place.id);
  const target = kind === "point" && place.kind === "hq" && place.owner !== side ? "enemyHQ" : kind;
  offerOrders({ title: `${squad.callsign[lang]} → ${name}`, actions: heroOrders(rules, squad, { kind: target }, ordersFor(kind)), say: (action) => call(action, { to: squad.callsign[lang], point: said }) }, box, sx, sy);
}

// offerOrders opens the one small menu of the map: the orders for a squad at a place, an
// enemy or a structure, or what can be done with one of the player's own structures.
//   title, facts: what the menu is about; actions: the buttons to show, by name;
//   gold: what a button costs or gives back, by action; say(action): the call to send.
// Pressing an order transmits its call at once. `say` may instead do the thing itself (a
// sale, a repair) or start something that needs one more choice (where a rally point
// goes), and return nothing.
let orderCall = null;
function offerOrders({ title, facts = "", actions, gold = {}, say }, box, sx, sy) {
  const menu = $("orders");
  orderCall = say;
  $("orders-title").textContent = title;
  $("orders-facts").textContent = facts;
  for (const button of menu.querySelectorAll("button")) {
    const act = button.dataset.order;
    button.hidden = !actions.includes(act);
    const icon = button.querySelector(".icon");
    if (icon && !icon.firstChild) icon.innerHTML = iconSvg(act === "sell" ? "sell" : act === "rally" ? "rally" : "repair", 14);
    const n = button.querySelector(".gold");
    if (n) n.textContent = gold[act] ?? "";
  }
  // The reminder of what the three orders mean is shown with the three orders only.
  $("orders-about").hidden = !["hold", "move", "attack"].every((a) => actions.includes(a));
  menu.style.left = `${Math.max(110, Math.min(box.width - 110, sx))}px`;
  menu.style.top = `${Math.max(8, Math.min(box.height - 130, sy))}px`;
  menu.hidden = false;
}

function hideOrders() {
  $("orders").hidden = true;
}

for (const button of document.querySelectorAll("#orders button")) {
  button.addEventListener("click", () => {
    const say = orderCall;
    hideOrders();
    const text = me && !state?.over && say ? say(button.dataset.order) : null;
    if (text) order(text);
  });
}

// ---- our own structures: rally, cancel, repair and sell ----

// saidStructure is how a call names one of our structures: by its name, and by its id as
// well when the side has more than one of the kind.
function saidStructure(st) {
  const same = (state.structures ?? []).filter((s) => s.side === side && !s.ruin && s.kind === st.kind && s.role !== "fence");
  return same.length > 1 ? `${structureName(st)} ${st.id}` : structureName(st);
}

// offerStructure opens the menu for one of the player's own structures: where the units
// it makes gather, the last unit in its line taken back, its repair and its sale. With
// an engineer squad selected it also offers to send them in to mend it.
function offerStructure(st, squad, box, sx, sy) {
  const def = structureDef(rules, st);
  const engineers = Boolean(squad && unitDef(rules, squad.unit)?.captureSeconds);
  const line = (state.deploying ?? []).filter((d) => d.side === side && d.from === st.id);
  const makes = Object.values(rules.factions[faction]?.units ?? {}).some((u) => u.requires === st.role);
  const actions = me && !state.over ? structureActions(st, side, { engineers, makes, line: line.length }) : [];
  if (!def || !actions.length) return draft($("text").value + structureName(st));
  const facts = [st.building < 1 ? t("structure.rising", { percent: Math.round(st.building * 100) }) : `${Math.round(st.hp * 100)}%`];
  if (st.repairing) facts.push(t("structure.repairing"));
  if (st.dark) facts.push(t("structure.dark"));
  if (st.rally) facts.push(`${t("rally.label")} ${placeName(st.rally.place)}`);
  const last = line.at(-1);
  // Sending engineers in is an order to a squad, so it is a radio call; the rest is the
  // commander's own hand and happens at once.
  const say = (what) => {
    if (what === "rally") return startRally(st);
    if (what === "mend") return call("mend", { to: squad.callsign[lang], structure: saidStructure(st) });
    if (what === "cancel") act("cancel", { unit: last.unit });
    else act(what, { place: st.id });
    return null;
  };
  offerOrders({ title: structureName(st), facts: facts.join(" · "), actions, gold: { sell: `+${sellValue(rules, def)}`, repair: `−${repairCost(rules, def, st)}` }, say }, box, sx, sy);
}

// ---- where the build panel sits ----
//
// On a desktop the Structures / Reinforcements panel is a bar directly under the map, both
// tabs one fixed height, so pressing a tab moves nothing else. On a phone it stays in the
// sidebar, where it opens as a sheet. The same element is moved; nothing is drawn twice.
const buildPanel = $("build-panel");
const buildHome = document.createComment("the build panel's place in the sidebar");
buildPanel.before(buildHome);
const phoneLayout = matchMedia("(max-width: 700px), (max-height: 500px), (pointer: coarse) and (max-width: 1100px)");
function seatBuildPanel() {
  const under = !phoneLayout.matches;
  if (under) $("radio").before(buildPanel);
  else buildHome.after(buildPanel);
  buildPanel.classList.toggle("under-map", under);
  scene.resize();
}
phoneLayout.addEventListener("change", seatBuildPanel);
seatBuildPanel();

// ---- the sidebar's folding sections ----
//
// A section with `data-fold` on its title folds away under it at a press, and stays so
// (the choice is kept under the fold's name). `data-folded` is how it starts.
for (const title of document.querySelectorAll("[data-fold]")) {
  const key = `callsign.fold.${title.dataset.fold}`;
  const panel = title.parentElement;
  const set = (folded) => {
    panel.classList.toggle("folded", folded);
    title.setAttribute("aria-expanded", String(!folded));
  };
  const stored = localStorage.getItem(key);
  set(stored === null ? title.hasAttribute("data-folded") : stored === "1");
  title.tabIndex = 0;
  title.setAttribute("role", "button");
  const toggle = () => {
    const folded = !panel.classList.contains("folded");
    set(folded);
    localStorage.setItem(key, folded ? "1" : "0");
    scene.resize(); // the mini map may have just come back
  };
  title.addEventListener("click", toggle);
  title.addEventListener("keydown", (ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), toggle()));
}

// ---- menus ----

// The overlay is the lobby before the match and the result screen after it.
//
// Without ?room it offers to make a match or to join one by its code. With a room it
// shows the seats: to someone without a seat, the free one to take; to the two
// commanders, who is ready. Against the scripted enemy there is nobody to wait for, so
// the match starts on the one press that made it.
const inRoom = () => Boolean(ws) && lobby !== null;
const factionName = (id) => (rules ?? baseRules)?.factions[id]?.name[lang] ?? id ?? "";
const chosen = (name) => new FormData($("lobby-new")).get(name);

function renderOverlay() {
  const over = inRoom() && Boolean(state?.over);
  const playing = inRoom() && !over && (role === "spectator" || lobby.phase === "playing");
  // A headquarters falling is watched first: the result waits, then fades in over the ruin.
  const hold = over && scene.finaleHolds();
  $("overlay").classList.toggle("after-finale", over && !hold && Boolean(scene.finale));
  $("overlay").hidden = playing || hold;
  $("overlay-title").textContent = over ? t(state.winner === -1 ? "over.draw" : state.winner === side ? "over.won" : "over.lost") : t("title");
  $("overlay-line").textContent = over ? t(`over.${state.reason}`) : t("tagline");
  $("overlay-side").hidden = !inRoom() || !me;
  $("overlay-side").textContent = t(`side.${side}`) + (faction ? ` · ${factionName(faction)}` : "");

  const making = !room && role !== "spectator";
  $("lobby-new").hidden = $("lobby-join").hidden = !making;
  // The lesson is offered first, and pressed on a browser that has not been through it.
  $("learn").hidden = !making;
  $("learn").classList.toggle("first", !lessonSeen());
  $("learn-start").disabled = lobbyBusy;
  const sides = offer?.factions ?? Object.keys(baseRules?.factions ?? {});
  $("lobby-side-0").textContent = `${t("side.0")} · ${factionName(sides[0])}`;
  $("lobby-side-1").textContent = `${t("side.1")} · ${factionName(sides[1])}`;
  $("lobby-watch").hidden = chosen("opponent") !== "friend";
  // How hard the scripted enemy presses is the player's choice, per match.
  $("lobby-level-row").hidden = chosen("opponent") !== "bot" || offer?.bot === false;
  const level = chosen("bot") ?? "easy";
  $("lobby-level-about").textContent = t(`lobby.about.${level}`);
  for (const option of $("lobby-length").options) option.textContent = t("lobby.minutes", { minutes: option.value / 60 });
  // The pace is chosen by whoever makes the match; what it does to the squads is said here.
  const speed = chosen("speed") ?? "normal";
  $("lobby-speed-about").textContent = t(`lobby.speedAbout.${speed}`);
  renderChoices();

  const view = lobby ?? found?.lobby ?? null;
  const withFriend = Boolean(room) && view?.opponent === "friend" && !over;
  $("lobby-room").hidden = !withFriend;
  if (withFriend) renderSeats(view);

  let label = "";
  if (over) label = me ? t("playAgain") : "";
  else if (making) label = chosen("opponent") === "friend" ? t("lobby.create") : t("start");
  else if (!room) label = inRoom() ? "" : t("watch"); // a spectator of the open room
  else if (inRoom()) label = me && withFriend ? (lobby.seats[side].ready ? t("lobby.unready") : t("lobby.ready")) : "";
  else if (found) label = freeSeat(found.lobby) ? t("lobby.take", { faction: factionName(freeSeat(found.lobby).faction) }) : found.lobby.watch ? t("watch") : "";
  $("start").hidden = !label;
  $("start").textContent = label;
  $("start").disabled = lobbyBusy;
  $("lobby-leave").hidden = !room;
  // Someone who followed a link to a match with no seat left is told so.
  const notice = lobbyError?.() ?? (room && !inRoom() && found && !freeSeat(found.lobby) && !withFriend ? t("lobby.full") : "");
  $("lobby-error").hidden = !notice;
  $("lobby-error").textContent = notice;
  music.setMode(playing || hold ? "battle" : "menu");

  $("credits").hidden = !music.available;
  $("credits-list").replaceChildren(
    ...music.credits.map((track) => el("li", "", [`${track.title} · ${track.artist}`, track.licence, track.attribution].filter(Boolean).join(" · "))),
  );
}

// renderChoices words the lobby's map cards and gold choices in the page language.
function renderChoices() {
  // The folded-away choices in one line: gold, length, pace, and whether Anvil holds the purse.
  const gold = $("lobby-gold").value === "other" ? $("lobby-gold-other").value : $("lobby-gold").value;
  const pace = chosen("speed") ?? "normal";
  const now = [t("lobby.goldNow", { gold: gold ?? "" }), t("lobby.minutes", { minutes: Number(chosen("length") ?? 600) / 60 }), t(`lobby.speed.${pace}`)];
  if (chosen("purse") === "on") now.push(t("lobby.purseNow"));
  $("lobby-more-now").textContent = now.join(" · ");
  for (const card of $("lobby-map-cards").children) {
    const map = baseRules?.maps?.[card.dataset.map];
    if (!map) continue;
    card.querySelector("strong").textContent = map.name[lang];
    card.querySelector("small").textContent = t("lobby.mapSize", { width: map.width, height: map.height, points: map.points.length });
  }
}

// renderSeats shows a match between two people while it waits: its code, the link to
// send, and who sits where.
function renderSeats(view) {
  $("lobby-code").textContent = room;
  // Both players see the pace before they press Ready.
  const pace = view.speed ?? "normal";
  $("lobby-pace").textContent = t("lobby.pace", { name: t(`lobby.speed.${pace}`) });
  $("lobby-link").value = shareLink(room, offer?.share);
  $("lobby-copy").textContent = t("lobby.copy");
  $("lobby-seats").replaceChildren(
    ...view.seats.map((s) => {
      const status = s.bot ? t("lobby.seatBot") : !s.taken ? t("lobby.seatFree") : !s.online ? t("lobby.seatOffline") : s.ready ? t("lobby.seatReady") : t("lobby.seatWaiting");
      const mine = Boolean(me) && s.side === side;
      // Coloured by state, so a glance says whether the other commander is there and ready.
      const li = el("li", [`side-${s.side}`, mine ? "mine" : "", seatState(s)].filter(Boolean).join(" "));
      li.append(el("strong", "", `${t(`side.${s.side}`)} · ${factionName(s.faction)}`), el("span", "who", mine ? t("lobby.seatYou") : ""), el("span", "status", status));
      return li;
    }),
  );
  // What both commanders agreed to by pressing Ready: the map, the gold and the length.
  const chosenMap = baseRules?.maps?.[view.map];
  $("lobby-match").hidden = !chosenMap;
  if (chosenMap) {
    const g = $("lobby-match-map").getContext("2d");
    g.clearRect(0, 0, 160, 100);
    drawMiniMap(g, baseRules, chosenMap, 160, 100, { points: true, sides: [sideColor[0], sideColor[1]] });
    $("lobby-options").textContent = t("lobby.options", { map: chosenMap.name[lang], gold: view.startGold, minutes: Math.round(view.length / 60) });
  }
  const both = view.seats.every((s) => s.taken);
  const full = !inRoom() && found && !freeSeat(found.lobby);
  $("lobby-status").textContent = full ? t("lobby.full") : !both ? t("lobby.waitFriend") : view.phase === "lobby" ? t("lobby.waitReady") : "";
  // Said plainly, where the code is shown: what a match on the local network does not protect.
  $("lobby-note").textContent = t("lobby.unprotected");
  if (onlyThisMachine() && !offer?.share) {
    // The command is set apart so that it reads left to right and stays on one line.
    const [before, after] = t("lobby.localOnly", { command: "\n" }).split("\n");
    $("lobby-note").append(` ${before}`, el("code", "", "make play-lan"), after);
  }
}

// Against the scripted enemy nobody else has to agree: the commander is ready on arrival.
function readyUp() {
  if (me && open() && lobby?.room && lobby.opponent !== "friend" && lobby.phase === "lobby" && !lobby.seats[side].ready) {
    ws.send(JSON.stringify({ type: "ready", ready: true }));
  }
}

// lobbyStep runs one request of the lobby and says, in the page language, why it failed.
async function lobbyStep(step) {
  if (lobbyBusy) return;
  lobbyBusy = true;
  lobbyError = null;
  renderOverlay();
  try {
    await step();
  } catch (err) {
    const reason = err.message;
    if (err.status === 404 && room) {
      lobbyBusy = false;
      return gone();
    }
    lobbyError = err.status === 404 ? () => t("lobby.noRoom", { code: "" }) : err.status === 409 ? () => t("lobby.full") : err.status === 503 ? () => t("lobby.busy") : err.status === 403 && offer?.locked ? () => t("lobby.hostOnly") : err.status === 429 ? () => t("lobby.guessing") : () => t("lobby.failed", { reason });
  }
  lobbyBusy = false;
  renderOverlay();
}

// sitDown takes the seat the server gave and goes to the match. The page is built around
// its side, so a seat on the other side loads the page again there; the saved seat lets
// that page walk straight in.
function sitDown(got) {
  saveSeat(got.room, got);
  if (got.side !== side) return location.assign(pageFor({ room: got.room, side: got.side }));
  room = got.room;
  seat = savedSeat(room);
  found = null;
  history.replaceState(null, "", pageFor({ room, side }));
  connect();
}

const makeMatch = (options) =>
  lobbyStep(async () => {
    const hostKey = $("lobby-host-key").value || localStorage.getItem("callsign.hostkey") || "";
    if (offer?.locked && !hostKey) {
      // Asked for before anything is sent: making a match here needs the host's password.
      $("lobby-host").hidden = false;
      $("lobby-host-key").focus();
      throw Object.assign(new Error("host password needed"), { status: 403 });
    }
    let seat;
    try {
      seat = await createRoom(options, hostKey);
    } catch (err) {
      if (err.status === 403 && offer?.locked) {
        // A wrong or outdated password: forget it and ask again.
        localStorage.removeItem("callsign.hostkey");
        $("lobby-host").hidden = false;
        $("lobby-host-key").select();
        $("lobby-host-key").focus();
      }
      throw err;
    }
    if (hostKey) localStorage.setItem("callsign.hostkey", hostKey); // it worked: this browser is the host's
    sitDown(seat);
  });
const takeFreeSeat = () => lobbyStep(async () => sitDown(await takeSeat(room)));

// The first lesson is a real match in a room of its own, against an enemy that waits for
// the lesson. Its squads think in this browser, so it never needs the host's password.
const startLesson = () => lobbyStep(async () => sitDown(await createRoom({ opponent: "bot", bot: "tutorial", side, length: 0, watch: false })));
$("learn-start").addEventListener("click", () => {
  music.unlock();
  startLesson();
});
// From Help, in the middle of anything: leave for the start screen and begin the lesson there.
$("help-learn").addEventListener("click", () => location.assign(`${pageFor({})}${pageFor({}).includes("?") ? "&" : "?"}learn`));

// lookUp reads a room this browser has no seat in, to offer the free one.
async function lookUp() {
  await lobbyStep(async () => {
    found = null;
    found = await roomInfo(room);
  });
}

$("start").addEventListener("click", () => {
  music.unlock();
  if (inRoom() && state?.over) return open() && ws.send(JSON.stringify({ type: "restart" }));
  if (!room && role === "spectator") return begin();
  if (!room) {
    const friend = chosen("opponent") === "friend";
    localStorage.setItem("callsign.level", chosen("bot"));
    localStorage.setItem("callsign.speed", chosen("speed"));
    localStorage.setItem("callsign.map", chosen("map") ?? "");
    return makeMatch({
      opponent: chosen("opponent"), side: Number(chosen("side")), length: Number(chosen("length")), watch: chosen("watch") === "on" && friend, bot: friend ? "" : chosen("bot"),
      speed: chosen("speed"), purse: chosen("purse") === "on",
      anvil: Number(chosen("anvil")) || 3, fast: chosen("fast") === "on",
      map: chosen("map") ?? "", startGold: chosenGold(),
    });
  }
  if (inRoom()) return me && open() && ws.send(JSON.stringify({ type: "ready", ready: !lobby.seats[side].ready }));
  if (found && freeSeat(found.lobby)) return takeFreeSeat();
  if (found?.lobby.watch) location.assign(pageFor({ room, role: "spectator" }));
});

$("lobby-new").addEventListener("change", renderOverlay);
$("lobby-new").addEventListener("submit", (ev) => ev.preventDefault());
$("lobby-join").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const code = $("lobby-join-code").value.trim().toUpperCase();
  if (code) location.assign(pageFor({ room: code }));
});
$("lobby-copy").addEventListener("click", async () => {
  $("lobby-link").select();
  // The clipboard needs a secure context; on plain http the link is left selected to copy by hand.
  if (await navigator.clipboard?.writeText($("lobby-link").value).then(() => true, () => false)) $("lobby-copy").textContent = t("lobby.copied");
});
// Leaving gives a seat back while the match has not started, then returns to the first screen.
// Exit ends this browser's part in the match and goes back to the start screen. The first
// press asks, the second within a few seconds does it. Squads keep their last orders; the
// agents stand down shortly after, and an empty match is dropped by the server.
let exitArmed = 0;
$("exit").addEventListener("click", () => {
  if (!inRoom()) return location.assign(pageFor({}));
  if (performance.now() > exitArmed) {
    exitArmed = performance.now() + 4000;
    $("exit").textContent = t("exitSure");
    $("exit").classList.add("warn");
    setTimeout(() => {
      $("exit").textContent = t("exit");
      $("exit").classList.remove("warn");
    }, 4000);
    return;
  }
  if (open()) ws.send(JSON.stringify({ type: "leave" }));
  if (room) forgetSeat(room);
  speech.silence();
  location.assign(pageFor({}));
});

$("lobby-leave").addEventListener("click", () => {
  if (inRoom() && me && open() && lobby.phase === "lobby") ws.send(JSON.stringify({ type: "leave" }));
  if (room && (!lobby || lobby.phase === "lobby")) forgetSeat(room);
  location.assign(pageFor({}));
});

// begin connects without a lobby: a spectator of the open room, as before there were rooms.
function begin() {
  if (ws) return;
  connect();
  renderOverlay();
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
  if (document.hidden) return; // nobody is looking: save the battery
  scene.draw(now);
}

applyLanguage();
// The battlefield is drawn behind the start screen before any match exists.
try {
  baseRules = await (await fetch("/shared/rules.json")).json();
  scene.setRules(baseRules);
} catch {
  // The greeting brings the rules anyway.
}
scene.resize();
requestAnimationFrame(frame);

// What the lobby can offer, and the match lengths to choose from.
offer = await serverInfo().catch(() => null);
// A server with a listening service transcribes the calls of a seated commander.
if (offer?.stt) {
  voice.useServer(() => (role !== "hammer" ? null : room ? seat && { room, side, token: seat.token } : { room: "", side }));
  renderVoice(); // the talk button's hint says where the recording goes
}
// Starting gold: the server's amounts, or one the player types, kept for next time.
const golds = offer?.startGolds ?? [];
const [goldMin, goldMax] = offer?.goldLimits ?? [400, 20000];
$("lobby-gold-row").hidden = golds.length === 0; // an older server has one amount only
for (const amount of golds) {
  const option = el("option");
  option.value = String(amount);
  option.textContent = amount.toLocaleString("en-US");
  $("lobby-gold").append(option);
}
{
  const other = el("option");
  other.value = "other";
  other.dataset.i18n = "lobby.goldOther";
  other.textContent = t("lobby.goldOther");
  $("lobby-gold").append(other);
  const kept = Number(localStorage.getItem("callsign.startGold")) || offer?.startGold || golds[0];
  $("lobby-gold").value = golds.includes(kept) ? String(kept) : "other";
  $("lobby-gold-other").value = String(kept);
  $("lobby-gold-other").min = String(goldMin);
  $("lobby-gold-other").max = String(goldMax);
  $("lobby-gold-other").step = "50";
  const show = () => ($("lobby-gold-other").hidden = $("lobby-gold").value !== "other");
  $("lobby-gold").addEventListener("change", show);
  show();
}
// chosenGold is the amount chosen, held inside what the server takes; 0 leaves it to the server.
function chosenGold() {
  const gold = startGold($("lobby-gold").value, $("lobby-gold-other").value, { min: goldMin, max: goldMax });
  if (gold) localStorage.setItem("callsign.startGold", String(gold));
  return gold;
}

// Only the host makes matches on a locked server; a browser that has done so once is remembered.
$("lobby-host").hidden = !offer?.locked || Boolean(localStorage.getItem("callsign.hostkey"));
const usual = offer?.length ?? baseRules?.match.lengthSeconds ?? 600;
for (const seconds of matchLengths(usual)) {
  const option = el("option");
  option.value = seconds;
  option.selected = seconds === usual;
  $("lobby-length").append(option);
}
$("lobby-new").elements.side.value = String(side);
// The pace the player chose last time, or the usual one.
const speeds = (offer?.speeds ?? []).map((s) => s.name);
$("lobby-speed-row").hidden = speeds.length === 0; // an older server has one pace only
$("lobby-speed").value = [localStorage.getItem("callsign.speed"), offer?.speed, "normal"].find((name) => speeds.includes(name)) ?? "normal";
// The maps on offer, each with a small drawing of itself, and the gold a match starts with.
const mapIds = offer?.maps?.map((m) => m.id) ?? Object.keys(baseRules?.maps ?? {});
const lastMap = localStorage.getItem("callsign.map");
for (const id of mapIds) {
  const map = baseRules?.maps?.[id];
  if (!map) continue;
  const card = el("label");
  const pick = el("input");
  Object.assign(pick, { type: "radio", name: "map", value: id, checked: id === (mapIds.includes(lastMap) ? lastMap : mapIds[0]) });
  const picture = el("canvas");
  Object.assign(picture, { width: 160, height: 100, dir: "ltr" });
  drawMiniMap(picture.getContext("2d"), baseRules, map, 160, 100, { points: true, sides: [sideColor[0], sideColor[1]] });
  card.dataset.map = id;
  card.append(pick, picture, el("strong"), el("small"));
  $("lobby-map-cards").append(card);
}
// A bigger map is given more time: picking a map sets the length it is usually played at,
// and the player may still change it.
const fitLength = () => {
  const usualFor = baseRules?.maps?.[chosen("map")]?.lengthSeconds;
  if (usualFor && [...$("lobby-length").options].some((o) => Number(o.value) === usualFor)) $("lobby-length").value = String(usualFor);
};
$("lobby-map-cards").addEventListener("change", fitLength);
fitLength();
// The level the player chose last time, or the server's usual one.
const levels = offer?.levels ?? ["easy", "normal", "standard"];
$("lobby-level").value = [localStorage.getItem("callsign.level"), offer?.level, "easy"].find((level) => levels.includes(level));

if (room && seat && role !== "spectator" && seat.side !== side) {
  location.replace(pageFor({ room, side: seat.side })); // the seat held here is on the other side
} else if (room && (seat || role === "spectator")) {
  connect(); // back in the seat after a reload, or watching
} else if (room) {
  await lookUp(); // a friend's link: show the match and the free seat
  if (query.has("autostart") && found && freeSeat(found.lobby)) takeFreeSeat();
} else if (query.has("autostart")) {
  // For tests and screenshots: skip the lobby. A commander gets a match against the
  // scripted enemy on the side in the address; a spectator watches the open room.
  if (role === "spectator") begin();
  else makeMatch({ opponent: "bot", side, length: 0, watch: true, map: query.get("map") ?? "", startGold: Number(query.get("gold")) || 0, speed: query.get("speed") ?? "", bot: query.get("bot") ?? "", fast: query.has("fast"), anvil: Number(query.get("anvil")) || 0 });
} else if (query.has("learn") && role !== "spectator") {
  startLesson(); // ?learn goes straight into the first lesson
}
renderOverlay();
// The speech model for the page's language is fetched now, in the lobby, so the talk
// button answers at once when the match starts. (Not when the server transcribes.)
voice.prepare(lang);

// For debugging from the console.
window.callsign = { scene, music, sideColor };
