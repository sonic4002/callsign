---
title: Staging and Releasing
description: "The repository has two long-lived branches, main and a staging branch next, and feature work is done in short-lived worktree branches that are merged in."
type: how-to
status: current
tags:
  - type/how-to
  - status/current
  - agent/CLD
  - origin/mixed
  - area/operations
  - topic/ops
  - topic/release
  - topic/git
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Service Worker and Install]]"
  - "[[Balance]]"
  - "[[Decisions]]"
  - "[[Open Questions]]"
  - "[[Operations]]"
  - "[[Make Targets]]"
  - "[[Playing in Public]]"
  - "[[Project Log]]"
paths:
  - CLAUDE.md
  - client/sw.js
  - Makefile
  - .gitignore
---

# Staging and Releasing

The repository has two long-lived branches, `main` and a staging branch `next`, and feature work is done in short-lived worktree branches that are merged in. No file in the repository describes a release procedure, so this note records what the git history shows and marks the rest as not verified.

## What the history shows

| Fact | Evidence |
|---|---|
| A staging branch `next` exists beside `main` | branches `main` and `next`; merge commits "Merge branch 'main' into next" and "Merge branch 'next' into ..." |
| `next` is checked out in its own worktree under `.claude/worktrees/` | `git worktree list`; `.gitignore` ignores `.claude/worktrees/` |
| Work happens in agent worktree branches merged into `main` or `next` | 42 merge commits in the history, 23 of them named "Merge branch 'worktree-agent-...'" |
| Big features were merged into "the staging game" in waves | `83032ee` (placement, construction, queues, rally: W2-A), `77a91cb` (power, radar, selling, repairing: W2-B), `aa8cad5` (heroes, sandbags, crushing, ranks: W2-C), all 2026-11-24 |
| Staging was "released" to `main` and merged back | `cacd2c9` "Merge main: the released staging line with the Help and orders-menu fixes", `f856a81` "Merge main: the released staging branch and its small fixes" |
| On 2026-11-26 `main` and `next` point at the same commit | `git rev-list --left-right --count main...next` gives 0 and 0 |
| No tags | `git tag` is empty |

## What a release has to touch (from the code)

- **The page's cache version.** `client/sw.js` names its cache `callsign-N` and the number is bumped by hand when page files change (commits `bd7a860` "the service worker's cache is callsign-4", `f3a25ac` "the picture cache is callsign-5"; it is `callsign-14` now). A new version no longer throws away the downloaded speech model (`3dfa29f`). See [[Service Worker and Install]].
- **The dev image.** Rebuild with `make image` only when `go.mod`, `go.sum` or `agents/package-lock.json` changed.
- **Tests.** `make test` before anything is merged; `make balance` after touching unit numbers, maps, bodies or the hauler's unload spot ([[Balance]]).
- **Rules and maps.** `shared/rules.json` is embedded in the server binary (`go:embed`) and served to the page, so server and page cannot drift; maps are regenerated with `make maps`.

## How the project says to work

From `CLAUDE.md`: build in the plan's phase order; keep the server deterministic and covered by tests; small commits, one feature each; ask before changing a locked decision ([[Decisions]]). Commit subjects in this repository are written as plain sentences saying what changed for the player.

## Not verified

- The steps that put a release on the live address (where it runs, how it is restarted, who does it) are not written down anywhere in the repository.
- Whether `next` is meant to stay a permanent staging line or was a one-off for the 2026-11-24 waves.
- There is no continuous integration configuration in the repository.

These are listed in [[Open Questions]].

## Related

- [[Operations]]
- [[Make Targets]]
- [[Playing in Public]]
- [[Service Worker and Install]]
- [[Project Log]]
- [[Open Questions]]
