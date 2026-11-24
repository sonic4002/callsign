// The service worker: keeps the page and its pictures so it opens at once, and opens at
// all without a network (the page then says there is no game server).
//
// Two rules, by what a file is:
//   the page itself (scripts, styles, strings, rules): the network first, so a reload always
//     brings the newest code; the kept copy only when the network is slow or gone;
//   sprites and music: the kept copy first, refreshed behind the player's back.
// Never kept: the game connection, the speech service, the relay, speech-model weights and
// their runtime (the voice code stores those itself, on the player's first use of the mic).

const CACHE = "callsign-1";
const NEVER = [/^\/ws\b/, /^\/tts\//, /^\/relay\//, /^\/mcp\b/, /^\/assets\/models\//, /^\/assets\/voice-cache\//, /^\/vendor\//];
const PICTURES = [/^\/assets\/sprites\//, /^\/assets\/audio\//];
const SLOW = 3000; // ms to wait for the network before showing the kept page

const kept = (url) => url.origin === self.location.origin && !NEVER.some((re) => re.test(url.pathname));

self.addEventListener("install", (event) => {
  // Enough to open the page; the rest is kept as the page asks for it (see "keep" below).
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(["./", "debug.css", "mobile.css", "debug.js", "mobile.js"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

// The page's first visit loads before this worker is in charge. It then sends the list of
// what it loaded, so the second visit works offline too.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "keep") return;
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        event.data.urls
          .map((u) => new URL(u, self.location.href))
          .filter(kept)
          .map((url) => cache.match(url).then((hit) => hit ?? save(cache, new Request(url.href)).catch(() => {}))),
      ),
    ),
  );
});

// save fetches and keeps a copy under `key` (the request itself unless told otherwise).
async function save(cache, request, key = request) {
  const res = await fetch(request);
  if (res.ok && res.status === 200) await cache.put(key, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || !kept(url) || request.headers.has("range")) return; // straight to the network
  event.respondWith(PICTURES.some((re) => re.test(url.pathname)) ? keptFirst(request) : networkFirst(request));
});

async function keptFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  const fresh = save(cache, request);
  if (!hit) return fresh;
  fresh.catch(() => {}); // offline: the kept copy is all there is
  return hit;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  // The page is one document whatever its query (?lang=he, ?side=1): kept once, without it.
  const url = new URL(request.url);
  const key = request.mode === "navigate" ? url.origin + url.pathname : request;
  const hit = await cache.match(key);
  const fresh = save(cache, request, key);
  if (!hit) return fresh;
  fresh.catch(() => {});
  const slow = new Promise((resolve) => setTimeout(() => resolve(hit), SLOW));
  return Promise.race([fresh.catch(() => hit), slow]);
}
