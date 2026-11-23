// Phase 0 debug page: dots on a map, the radio log, and a box to transmit as Hammer.
// It draws only what the server sends this side. Nerve shows in what the dots do; the
// "show nerve" switch is a debugging aid, off by default.

const $ = (id) => document.getElementById(id);
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
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) el.placeholder = t(el.dataset.i18nPlaceholder);
  syncInputDirection();
  renderLog();
}

// An empty box follows the page so the placeholder reads the right way; typed text
// follows its own first letter, so Hebrew and English orders both look right.
function syncInputDirection() {
  $("text").dir = $("text").value ? "auto" : document.documentElement.dir;
}
$("text").addEventListener("input", syncInputDirection);

$("lang").addEventListener("click", () => {
  lang = lang === "he" ? "en" : "he";
  localStorage.setItem("callsign.lang", lang);
  applyLanguage();
});

// ---- match state ----

let rules = null;
let state = null;
let me = null; // this connection's station
let faction = "";
let entries = []; // radio log lines, kept as data so a language switch can redraw them
let ws = null;

const pointName = (id) => rules.map.points.find((p) => p.id === id)?.callsign[lang] ?? id;
const clock = (tick) => {
  if (!rules) return "--:--"; // before the server's greeting
  const s = Math.floor(tick / rules.tickRate);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

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
      $("banner").hidden = true;
      fit();
      break;
    case "state":
      state = frame.state;
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
  renderLog();
  renderStats();
}

function system(key, vars = {}, tone = "") {
  entries.push({ kind: "system", key, vars, tone, tick: state?.tick ?? 0 });
  renderLog();
}

// ---- radio log ----

function renderLog() {
  const log = $("log");
  const pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.replaceChildren(
    ...entries.map((e) => {
      const li = document.createElement("li");
      const time = document.createElement("time");
      const text = document.createElement("span");
      text.className = "text";
      if (e.kind === "radio") {
        const m = e.message;
        time.textContent = clock(m.tick);
        li.className = m.from.squad ? "squad" : m.from.key;
        const who = document.createElement("span");
        who.className = "who";
        who.textContent = m.from[lang];
        text.textContent = m.text; // always as transmitted, in the language it was sent in
        li.append(time, who, text);
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

$("send").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const text = $("text").value.trim();
  if (!text || ws?.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "radio", text }));
  $("text").value = "";
  syncInputDirection();
});

$("restart").addEventListener("click", () => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "restart" })));

// ---- top bar ----

function renderStats() {
  if (!state || !rules) return;
  $("gold").textContent = state.gold;
  $("income").textContent = `+${state.income}`; // the sign stays with the number in Hebrew too
  const s = Math.max(0, state.timeLeft);
  $("time").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const held = (who) => state.points.filter((p) => p.owner === who).length;
  $("held").textContent = `${held(side)} : ${held(1 - side)}`;
  $("hq-ours").value = state.hq[side];
  $("hq-enemy").value = state.hq[1 - side];
  if (state.over) {
    $("banner").hidden = false;
    $("banner-title").textContent = t(state.winner === -1 ? "over.draw" : state.winner === side ? "over.won" : "over.lost");
    $("banner-reason").textContent = t(`over.${state.reason}`);
  }
}

// ---- map ----

const canvas = $("map");
const ctx = canvas.getContext("2d");
const colors = { [-1]: "#8a9a91", 0: "#6fb1ff", 1: "#ff7a59" };
const nerveColors = { steady: "#63d68a", shaken: "#f0c04a", pinned: "#ff5a5a" };
let scale = 1;

function fit() {
  if (!rules) return;
  const wrap = $("map-wrap");
  const { width, height } = rules.map;
  scale = Math.min((wrap.clientWidth - 24) / width, (wrap.clientHeight - 24) / height);
  const dpr = devicePixelRatio || 1;
  canvas.style.width = `${width * scale}px`;
  canvas.style.height = `${height * scale}px`;
  canvas.width = Math.round(width * scale * dpr);
  canvas.height = Math.round(height * scale * dpr);
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
}
addEventListener("resize", fit);

function label(text, x, y, size = 15, color = "#dfe7e1", align = "center") {
  ctx.font = `${size}px system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.direction = /[֐-׿]/.test(text) ? "rtl" : "ltr";
  ctx.fillText(text, x, y);
}

function drawTeam(tm, cls, color, own) {
  const r = 5 + Math.min(tm.members, 4);
  ctx.fillStyle = color;
  ctx.beginPath();
  if (cls === "vehicle") ctx.rect(tm.x - r, tm.y - r, 2 * r, 2 * r);
  else if (cls === "naval") {
    ctx.moveTo(tm.x, tm.y - r - 2);
    ctx.lineTo(tm.x + r + 1, tm.y + r);
    ctx.lineTo(tm.x - r - 1, tm.y + r);
    ctx.closePath();
  } else ctx.arc(tm.x, tm.y, r, 0, 2 * Math.PI);
  ctx.fill();
  if (!own) return;
  if (tm.action === "fire") {
    // Muzzle flash: what a team is doing is visible, what it feels is not.
    ctx.strokeStyle = "#fff7c2";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(tm.x, tm.y, r + 4, 0, 2 * Math.PI);
    ctx.stroke();
  }
  if ($("nerve").checked) {
    ctx.strokeStyle = nerveColors[tm.nerve];
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(tm.x, tm.y, r + 9, 0, 2 * Math.PI);
    ctx.stroke();
  }
}

function draw() {
  requestAnimationFrame(draw);
  if (!rules || !state) return;
  const { width, height, waterY } = rules.map;
  ctx.fillStyle = "#18211d";
  ctx.fillRect(0, 0, width, waterY);
  ctx.fillStyle = "#10212e";
  ctx.fillRect(0, waterY, width, height - waterY);

  for (const p of rules.map.points) {
    const live = state.points.find((s) => s.id === p.id);
    const color = colors[live.owner];
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.fillStyle = "#0e131180";
    ctx.beginPath();
    if (p.kind === "hq") ctx.rect(p.x - 26, p.y - 26, 52, 52);
    else ctx.arc(p.x, p.y, rules.match.captureRadius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.setLineDash(p.kind === "hq" ? [] : [6, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (live.capSide !== -1 && live.progress > 0) {
      ctx.strokeStyle = colors[live.capSide];
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rules.match.captureRadius, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * live.progress);
      ctx.stroke();
    }
    label(p.id, p.x, p.y + 11, 30, color);
    label(p.callsign[lang], p.x, p.y - rules.match.captureRadius - 28, 22);
    const income = rules.rigs[p.kind].income;
    // The isolate marks keep "+15" reading left to right inside a Hebrew label.
    label(income ? `${t(`kind.${p.kind}`)} \u2066+${income}\u2069` : p.name[lang], p.x, p.y - rules.match.captureRadius - 8, 16, "#9fb0a6");
  }

  for (const sq of state.squads) {
    const color = colors[sq.side];
    const target = sq.order.point && rules.map.points.find((p) => p.id === sq.order.point);
    if (target) {
      ctx.strokeStyle = `${color}55`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 7]);
      ctx.beginPath();
      ctx.moveTo(sq.x, sq.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const tm of sq.teams ?? []) drawTeam(tm, sq.class, color, true);
    label(sq.callsign[lang], sq.x, sq.y + 52, 19, color);
  }
  for (const c of state.contacts) {
    for (const tm of c.teams ?? []) drawTeam(tm, c.class, colors[c.side], false);
  }
}

// Clicking the map helps write a call: a squad starts the message, a point is added to it.
canvas.addEventListener("click", (ev) => {
  if (!rules || !state || !me) return;
  const box = canvas.getBoundingClientRect();
  const x = (ev.clientX - box.left) / scale;
  const y = (ev.clientY - box.top) / scale;
  const near = (o, r) => Math.hypot(o.x - x, o.y - y) <= r;
  const input = $("text");
  const squad = state.squads.find((s) => s.side === side && (near(s, 40) || (s.teams ?? []).some((tm) => near(tm, 16))));
  const point = rules.map.points.find((p) => near(p, rules.match.captureRadius));
  if (squad) input.value = t("callPrefix", { to: squad.callsign[lang], from: me[lang] });
  else if (point) input.value += point.callsign[lang];
  else return;
  syncInputDirection();
  input.focus();
});

applyLanguage();
connect();
requestAnimationFrame(draw);
