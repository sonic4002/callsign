---
title: Decision - Open League
description: "The game is to expose an MCP endpoint with the same tools the agents use, so that any outside agent can join with its own model, on a separate ladder with no tiers."
type: decision
status: current
tags:
  - type/decision
  - status/current
  - agent/CLD
  - origin/mixed
  - area/decisions
  - topic/open-league
  - topic/mcp
  - topic/not-built
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Agent Tools]]"
  - "[[HTTP API]]"
  - "[[WebSocket Frames]]"
  - "[[Decisions]]"
  - "[[Backlog]]"
  - "[[Open Questions]]"
  - "[[Plan versus Code]]"
paths:
  - CLAUDE.md
  - docs/PLAN.html
  - docs/specs/2026-11-24-bases-harvest-maps.md
  - client/sw.js
---

# Decision - Open League

The game is to expose an MCP endpoint with the same tools the agents use, so that any outside agent can join with its own model, on a separate ladder with no tiers. This is locked as a decision and is not built.

## The decision as written

> **Open league:** the game also exposes an MCP endpoint with the same tools; any agent can join with its own model. Separate ladder, no tiers.

| | |
|---|---|
| Date | 2026-11-23 (`e21e0cb`) |
| Decided by | the plan (`docs/PLAN.html`, sections Echo and Papa) |
| Replaced | nothing |

## What the plan says

- An MCP server with the same tools: radio, move, hold, attack, report, buy.
- Any agent connects and picks its own model, so tiers do not apply; it pays its own way.
- A separate ladder: "the 'whose agent is smartest' arena".
- A player creates an open league room and gets a match token.
- Roadmap: Phase 3 (Online), together with matchmaking, ladders and replays.

## How the code stands

- No MCP server or open-league room exists in `server/`, `relay/`, `agents/` or `client/`.
- The only trace is a reserved path: `client/sw.js` lists `/mcp` among the paths its cache never handles.
- The bases spec lists "the online phase (accounts, matchmaking, ladders, the open league, replays)" as out of scope.
- The pieces it would build on do exist: the tool calls are checked on the server by role, and `docs/FRIEND-MATCH.md` documents the WebSocket roles an outside program can join with ([[Agent Tools]], [[HTTP API]], [[WebSocket Frames]]).

## Related

- [[Decisions]]
- [[Backlog]]
- [[Open Questions]]
- [[Agent Tools]]
- [[Plan versus Code]]
