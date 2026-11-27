---
title: Conventions
description: "The vault contract: folders, note types, the frontmatter schema with every key and enum, tag families, and the maintenance rules."
type: meta
status: current
tags:
  - type/meta
  - status/current
  - agent/CLD
  - origin/mixed
  - area/meta
  - topic/vault
created: 2026-11-27
updated: 2026-11-27
agent: CLD
origin: mixed
confidence: high
related:
  - "[[Agent Handoff]]"
  - "[[Index]]"
  - "[[Home]]"
  - "[[Reference Map]]"
paths:
  - vault/_tools/validate_frontmatter.py
  - vault/_tools/gen_index.py
  - vault/CLAUDE.md
---

# Conventions

This is the contract every note in the vault follows. `_tools/validate_frontmatter.py` enforces it; `CLAUDE.md` at the vault root points here.

## Folders

| Folder | Holds |
|---|---|
| (root) | `Home.md`, the map of content; `CLAUDE.md` and `README.md`, which are not notes |
| `00-Meta` | this contract, [[Agent Handoff]], the generated [[Index]], and [[Reference Map]], the map of the focused notes |
| `00-Overview` to `04-Operations` | overview notes: one broad note per subject, for a first read |
| `10-Game-Design` to `17-Art-and-Assets` | focused notes: one subject each, written from the code |
| `18-Decisions` | one note per locked decision, and [[Open Questions]] |
| `19-Known-Flaws-and-Backlog` | [[Known Flaws]], [[Backlog]], [[Plan versus Code]] |
| `20-History` | the dated [[Project Log]] |
| `21-Glossary` | the [[Glossary]] |
| `_tools` | the validator and the index generator (not notes) |

An overview note and the focused notes on the same subject both stay: the overview is the summary, the focused notes are the detail. When they disagree, the focused note and the code win, and the overview is corrected.

## Note names

- File names are ASCII, at most 90 characters, with none of `/ : # ^ [ ] |`.
- `title` equals the file name exactly (without `.md`).
- No two notes share a name, in any folder: links are by name.
- A decision is named `Decision - <subject>`; a map is `Map - <size>`; a faction's units are `Units - <faction>`.

## Frontmatter

The block starts on line 1. It is a small, regular subset of YAML that the tools read with the standard library: `key: value`, or `key:` followed by `  - item` lines, or `key: []`. No duplicate keys.

| Key | Required | Value |
|---|---|---|
| `title` | yes | the file name |
| `description` | yes | one plain sentence, double-quoted, at most 200 characters: what the note tells you. The [[Index]] shows it |
| `type` | yes | `hub`, `overview`, `concept`, `system`, `reference`, `decision`, `how-to`, `log` or `meta` |
| `status` | yes | `current`, `draft` or `superseded` (a superseded note also has `superseded_by`) |
| `tags` | yes | list of `family/value` tags, see below |
| `created` | yes | `YYYY-MM-DD`; never changed afterwards |
| `updated` | yes | `YYYY-MM-DD`; bumped when the body's facts change; never before `created` |
| `agent` | yes | who wrote the note: `AGY` (Antigravity), `CLD` (Claude), `OWN` (the owner); never changed afterwards |
| `origin` | yes | what the note was written from: `code`, `docs` or `mixed` |
| `confidence` | yes | `high` (checked against the code as it runs), `medium` (written from the code or documents, not re-checked), `low` (inferred) |
| `related` | yes | up to 10 curated links, each a quoted wikilink: `- "[[Economy]]"`; may be `[]` |
| `paths` | yes | repository paths the note was written from, so it can be re-checked; each must exist; may be `[]` |
| `aliases` | no | other names the note answers to |
| `decided` | no | on a decision: the date it was made |
| `superseded_by` | no | the note that replaces this one |

### Types

| Type | Use for |
|---|---|
| `hub` | a map of content that mostly links to other notes |
| `overview` | a broad first-read note on a whole subject |
| `concept` | an idea or rule of the game or the radio net |
| `system` | how a part of the software works |
| `reference` | tables and lists to look things up in |
| `decision` | one locked decision: what, when, why, what it replaced |
| `how-to` | steps to do something |
| `log` | dated entries |
| `meta` | notes about the vault itself |

### Tags

Tags are `family/value`, lowercase (agent codes stay uppercase). Six families:

- `type/`, `status/`, `agent/`, `origin/` mirror the fields of the same name exactly. Change the field and its tag together.
- `area/<folder>`: the folder's name without its number, lowercase (`area/radio-net`).
- `topic/<kebab-case>`: the subject (`topic/economy`). Reuse a spelling that exists before making a new one.

## Writing rules

- Write from the code as it is. Where a document and the code differ, say what the code does and note the difference; [[Plan versus Code]] collects these.
- Start every note with a summary of one or two sentences.
- Give both the Hebrew and the English term where the game has both.
- Tables for numbers; take them from `shared/rules.json`, never from memory.
- **No secrets and no people:** no key, token, password or `.env` content; no e-mail address, personal name, private host name or home directory path. Say where a secret lives (an environment variable's name), never its value. Refer to "the owner".
- Update before you create: look in the [[Index]] first.
- Supersede a fact with a dated callout, `> [!note] Superseded YYYY-MM-DD`, or with `status: superseded` and `superseded_by`; never by silently rewriting history.

## Maintenance

- After adding a note or changing a `description`, run `python3 vault/_tools/gen_index.py` and commit the index with the change.
- `python3 vault/_tools/validate_frontmatter.py --all` must print "all clean" before a commit; the repository's pre-commit hook runs it.
- To add a key or an enum value, change this note and the validator in the same commit.
- Do not commit `.obsidian/workspace*.json`, `graph.json` or cache files (`.gitignore` covers them).
