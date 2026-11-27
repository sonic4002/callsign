---
title: Service Worker and Install
description: "The page is an installable web app: it has a manifest in each language, icons, and a service worker (client/sw.js) that keeps the page and its pictures so it opens at once and opens at all ..."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/code
  - area/architecture
  - topic/client
  - topic/pwa
  - topic/offline
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Client]]"
  - "[[Mobile Layout]]"
  - "[[In-Browser Recognition]]"
  - "[[Speech on Phones]]"
  - "[[Settings]]"
  - "[[Running, Deploying and Testing]]"
paths:
  - client/sw.js
  - client/mobile.js
  - client/index.html
  - client/manifest.webmanifest
  - client/manifest.he.webmanifest
  - client/icons/render.mjs
  - client/icons/mark.svg
  - client/icons/maskable.svg
---

# Service Worker and Install

The page is an installable web app: it has a manifest in each language, icons, and a service worker (`client/sw.js`) that keeps the page and its pictures so it opens at once and opens at all without a network. The game itself still needs the server; offline, the page opens and says there is none.

## Cache

| Item | Value |
|---|---|
| Cache name | `callsign-14` (`CACHE` in `sw.js`; the number is bumped by hand when kept files must be thrown away — the history mentions `callsign-4` and `callsign-5`) |
| Voice caches | Names matching `/^callsign-voice-/` belong to the speech worker (`client/voice/worker.js`) and are **left alone** on activation |
| Precached on install | `./`, `debug.css`, `mobile.css`, `debug.js`, `mobile.js` |
| Scope | Same-origin `GET` requests without a `Range` header |

### Never cached (`NEVER`)

`/ws` (the game connection), `/tts/` (speech service), `/relay/` (model relay), `/mcp`, `/assets/models/` (speech-model weights), `/assets/voice-cache/`, `/vendor/` (the recognition runtime). The voice code stores model weights itself in its own caches.

### Two strategies, by what a file is

| Files | Strategy | Why |
|---|---|---|
| The page itself: scripts, styles, strings, rules | **Network first** (`networkFirst`), with `cache: "no-cache"` to get past the browser's own cache; the kept copy only when the network is gone | So the page is never a mix of new and old files. That mix "broke the page on a slow phone" (commit b39488c) |
| Sprites and music: `/assets/sprites/`, `/assets/audio/` | **Kept copy first** (`keptFirst`), refreshed in the background | Large, rarely change, fine to be one visit behind |

A page navigation is kept once without its query string, so `?lang=he` and `?side=1` are the same document.

## Life cycle

1. `mobile.js` registers `sw.js` with `updateViaCache: "none"`. The page works without it; registration failure is ignored.
2. **install**: precache the five files, then `skipWaiting()`.
3. **activate**: delete every cache except `callsign-14` and the `callsign-voice-…` caches, then `clients.claim()`. Keeping the voice caches was added in commit 3dfa29f so that a new version of the page does not make a phone download about 70 MB of speech model again.
4. **First visit**: the page loaded before the worker was in charge, so five seconds later it posts `{type:"keep", urls}` with everything it loaded (from `performance.getEntriesByType("resource")`); the worker fetches and keeps those, so the second visit works offline too.
5. **A newer worker takes over** (`controllerchange`): the page reloads once (guarded by `sessionStorage` `callsign.swReload`) so every file comes from the same version.

## Self-repair

Two safety nets exist for a stale or mixed copy:

- An inline script in `index.html` waits 20 seconds; if the start screen is still booting or its button is still disabled, and the browser is online, it unregisters every service worker, deletes every cache and reloads once (guarded by `sessionStorage` `callsign.repair`).
- Opening the page with `?nosw` unregisters the worker and deletes all caches without registering again.

Note that both of these delete **all** caches, including the voice caches the activation step takes care to keep.

## Manifest

| File | Language | Name |
|---|---|---|
| `client/manifest.webmanifest` | English, `dir: ltr` | Callsign |
| `client/manifest.he.webmanifest` | Hebrew, `dir: rtl`, `start_url: ./?lang=he` | אות קריאה |

Common fields: `display: standalone`, `orientation: any`, `scope: ./`, `id: /` (`start_url` is `./` in the English file), background and theme colour `#0b1013`, category `games`. `mobile.js` swaps the `<link rel="manifest">` between the two whenever `<html lang>` changes, because the installed app takes its name from the manifest.

`index.html` also sets `theme-color`, `mobile-web-app-capable`, `apple-mobile-web-app-capable` and a translucent black status bar.

## Icons

| File | Size | Made from |
|---|---|---|
| `icons/mark.svg` | any | The mark with rounded corners; also the favicon |
| `icons/icon-192.png`, `icons/icon-512.png` | 192, 512 | `mark.svg` |
| `icons/maskable-512.png` | 512, `purpose: maskable` | `maskable.svg` (fills the square, mark kept inside the safe middle) |
| `icons/apple-touch-icon.png` | 180 | `maskable.svg` (iOS rounds the corners itself) |

`node client/icons/render.mjs` renders the PNGs from the two SVGs with headless Chrome (`CHROME` env var or `google-chrome`); run it again after changing either SVG. It is not a `make` target.

## Related

- [[Client]]
- [[Mobile Layout]]
- [[In-Browser Recognition]]
- [[Speech on Phones]]
- [[Settings]]
- [[Running, Deploying and Testing]]
