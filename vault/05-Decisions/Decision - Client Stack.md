---
title: Decision - Client Stack
description: "CLAUDE.md locks the client as TypeScript with Phaser 3, an installable web app that works in Chrome, Safari and Edge on Mac, Windows and phones."
type: decision
status: current
tags:
  - type/decision
  - status/current
  - agent/CLD
  - origin/mixed
  - area/decisions
  - topic/client
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Open Questions]]"
  - "[[Locked Decisions]]"
  - "[[Client]]"
  - "[[Service Worker and Install]]"
  - "[[Mobile Layout]]"
  - "[[Plan versus Code]]"
paths:
  - CLAUDE.md
  - docs/PLAN.html
  - docs/specs/2026-11-24-bases-harvest-maps.md
  - client/index.html
  - client/syntax.test.mjs
  - client/manifest.webmanifest
---

# Decision - Client Stack

`CLAUDE.md` locks the client as TypeScript with Phaser 3, an installable web app that works in Chrome, Safari and Edge on Mac, Windows and phones. The client that exists is plain JavaScript modules drawing on a canvas, with no TypeScript, no Phaser and no build step; the installable web app part is built.

## The decision as written

> **Client:** TypeScript + Phaser 3, installable web app. Must work in Chrome, Safari and Edge on Mac, Windows and phones.

| | |
|---|---|
| Date | 2026-11-23 (`e21e0cb`) |
| Decided by | the plan (`docs/PLAN.html` says "Phaser 3 or PixiJS, TypeScript"; its roadmap puts the Phaser client in Phase 1) |
| Replaced | nothing |

## How the code stands

| Part of the decision | Code |
|---|---|
| TypeScript | none: no `.ts` file and no compiler configuration; the page is ES modules (`client/*.js`) |
| Phaser 3 | none: no vendored engine; the map is drawn with the canvas API (`client/map.js`, `client/iso.js`) |
| Build step | none: `client/syntax.test.mjs` says "The page has no build step"; the server serves the files as they are |
| Installable web app | yes: manifests in both languages, icons and a service worker (commit `bcd03ca`) |
| Phones | a phone layout exists (commits `b8f7e67`, `90f26df`); behaviour on real phones is not verified in the repository |

The page grew out of the Phase 0 "bare debug web page" of `KICKOFF.md`, and its main script and stylesheet are still named `client/debug.js` and `client/debug.css`.

## What the documents say about the difference

- The bases spec lists "Porting the page to Phaser or TypeScript" as out of scope.
- The Layout block of `CLAUDE.md` still reads "client/ TypeScript + Phaser web app".
- No commit or document records a decision to drop the port or to do it. It is listed in [[Open Questions]].

## Related

- [[Locked Decisions]]
- [[Client]]
- [[Service Worker and Install]]
- [[Mobile Layout]]
- [[Plan versus Code]]
- [[Open Questions]]
