# Callsign vault - agent contract

Obsidian vault documenting Callsign (אות קריאה), the game in this repository. The full contract lives in the vault; this file points to it and states the rules that are enforced mechanically. Read the linked notes before creating or restructuring notes - do not copy their content here.

- `00-Meta/Agent Handoff.md` - read first: where to start and which notes to load per area.
- `00-Meta/Conventions.md` - folders, note names, the frontmatter schema (every key, every enum), tag families, writing and maintenance rules.
- `00-Meta/Index.md` - generated table of every note (type, description). **Start navigation here**, then open only the notes you need.
- `18-Decisions/Decisions.md` - one note per locked decision. The repository's `CLAUDE.md` holds the decisions themselves and wins over the vault.

## Frontmatter validation (enforced)

`_tools/validate_frontmatter.py` (Python 3 standard library only) checks notes against the contract. It runs in two places, both local:

1. **Claude Code hook** - the repository's `.claude/settings.json` runs it after every `Edit` / `Write` of a note in `vault/`. On errors it exits 2 and prints them: fix the frontmatter in the same turn.
2. **Git pre-commit hook** - `.githooks/pre-commit` in the repository validates the vault whenever a file under `vault/` is staged, and refuses the commit on an error or a stale index. Enable once per clone: `git config core.hooksPath .githooks` (check: it must print `.githooks`). Never bypass it with `--no-verify`.

Manual runs, from the repository root:

    python3 vault/_tools/validate_frontmatter.py --all
    python3 vault/_tools/gen_index.py

## Rules the validator enforces

- The block starts on line 1. `title` equals the file name (ASCII, at most 90 characters, none of `/ : # ^ [ ] |`). No two notes share a name.
- Every note carries `title description type status tags created updated agent origin confidence related paths`; optional `aliases`, `decided`, `superseded_by`. No other key, no duplicate key.
- `description` is one double-quoted plain sentence of at most 200 characters.
- Enum values for `type`, `status`, `agent`, `origin`, `confidence` are those in Conventions. To add one, change Conventions and the validator in the same commit.
- Tags are `family/value`; `type/`, `status/`, `agent/` and `origin/` mirror the fields exactly.
- `related` holds at most 10 quoted wikilinks that resolve. Every wikilink in a body resolves.
- Every entry of `paths` exists in the repository.
- Dates are `YYYY-MM-DD`; `updated` is never earlier than `created`.
- **No secrets and no people:** nothing that looks like a key, an e-mail address or a home directory path.

## Other rules

- `created` and `agent` are never changed after a note is written. Editing a note bumps `updated` when its facts change.
- `00-Meta/Index.md` is generated: never hand-edit it. Regenerate it after adding a note or changing a `description`, and commit it with the change.
- Update before you create: search the Index first. Supersede a fact with a dated `> [!note] Superseded YYYY-MM-DD` callout, never by silent rewrite.
- The code wins over the vault, and the vault over older documents. A note's `paths` say what to re-read.
- Do not commit `.obsidian/workspace*.json`, `graph.json` or cache files.
