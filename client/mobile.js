// What a phone needs around the command screen: the bottom bar that opens the panels as
// sheets, a radio box that rides on the on-screen keyboard, the install manifest in the
// page language, and the service worker that keeps the page opening without a network.
// The layout itself is mobile.css; nothing here touches the match.

const PHONE = "(max-width: 700px), (max-height: 500px)"; // the same breakpoint as mobile.css
const phone = matchMedia(PHONE);
const root = document.documentElement;
const $ = (id) => document.getElementById(id);
const query = new URLSearchParams(location.search);

// ---- sheets ----

// One sheet at a time: "radio", "squads", "build", "more", or none. ?sheet=build opens the
// page with one already up (for screenshots).
function show(name) {
  const next = phone.matches && name && name !== root.dataset.sheet ? name : "";
  if (next) root.dataset.sheet = next;
  else delete root.dataset.sheet;
  for (const tab of $("dock").children) tab.setAttribute("aria-pressed", String(tab.dataset.open === next));
  // The radar and the log measure themselves; they were hidden until now.
  if (next === "more") dispatchEvent(new Event("resize"));
  if (next === "radio") $("log").scrollTop = $("log").scrollHeight;
}

for (const tab of $("dock").children) tab.addEventListener("click", () => show(tab.dataset.open));
phone.addEventListener("change", () => show(""));
// Touching the map puts the sheet away: the map is why the player is here.
$("map").addEventListener("pointerdown", () => show(""));
// The log's one visible line opens the whole log.
$("log").addEventListener("click", () => phone.matches && root.dataset.sheet !== "radio" && show("radio"));
// Picking a squad starts a call to it, so the sheet steps aside for the map and the talk button.
$("roster").addEventListener("click", (ev) => !ev.target.closest("button") && ev.target.closest("li:not(.empty):not(.deploying)") && show(""));
for (const id of ["help-open", "restart"]) $(id).addEventListener("click", () => show(""));
if (query.has("sheet")) show(query.get("sheet"));

// ---- the on-screen keyboard ----

// The keyboard covers the bottom of the page without resizing it, so the radio box would
// sit underneath. --kb is the keyboard's height; mobile.css lifts the box by it.
const view = globalThis.visualViewport;
function keyboard() {
  const covered = Math.max(0, innerHeight - view.height - view.offsetTop);
  root.style.setProperty("--kb", `${Math.round(covered)}px`);
  root.classList.toggle("typing", phone.matches && covered > 80);
}
if (view) for (const kind of ["resize", "scroll"]) view.addEventListener(kind, keyboard);

// ---- fingers ----

// A long press on the talk button must talk, not open the browser's menu; and Safari must
// not zoom the page when two fingers land outside the map.
$("ptt").addEventListener("contextmenu", (ev) => ev.preventDefault());
addEventListener("gesturestart", (ev) => ev.preventDefault());

// Browsers give the microphone only to https and localhost. Say so on the button itself;
// pressing it explains (voice.insecure).
if (globalThis.isSecureContext === false) $("ptt").classList.add("no-voice");

// ---- installing ----

// The installed app takes its name from the manifest, and there is one per language.
function manifest() {
  $("manifest").href = root.lang === "he" ? "manifest.he.webmanifest" : "manifest.webmanifest";
}
new MutationObserver(manifest).observe(root, { attributes: true, attributeFilter: ["lang"] });
manifest();

// The service worker keeps the page and its pictures for the next visit, online or not.
// ?nosw removes it, for when a stale copy is suspected.
if ("serviceWorker" in navigator) {
  if (query.has("nosw")) {
    for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
    for (const name of await caches.keys()) await caches.delete(name);
  } else {
    navigator.serviceWorker.register("sw.js").catch(() => {}); // the page works without it
    // On a first visit the page loaded before the worker took charge. Tell it what was
    // loaded, so the next visit opens offline too.
    setTimeout(async () => {
      const reg = await navigator.serviceWorker.ready;
      const urls = performance.getEntriesByType("resource").map((entry) => entry.name);
      reg.active?.postMessage({ type: "keep", urls: [location.pathname, ...urls] });
    }, 5000);
  }
}
