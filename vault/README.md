# Callsign vault

An Obsidian vault documenting Callsign (אות קריאה): game design, the radio net, brains and agents, the client, speech, the server, operations, art, decisions, known flaws, history and a glossary.

## Open it

Obsidian -> "Open folder as vault" -> this folder (`vault/`). No plugins are needed. Start at `Home.md`; `00-Meta/Index.md` lists every note with a one-line description.

## How it is organised

- `00-Overview` to `04-Operations`: broad overview notes, for a first read.
- `10-Game-Design` to `21-Glossary`: focused notes, one subject each, written from the code. `00-Meta/Reference Map.md` is their map.
- `00-Meta`: the contract (`Conventions.md`), the agent's starting note (`Agent Handoff.md`) and the generated `Index.md`.

## Keep it current

    python3 vault/_tools/validate_frontmatter.py --all    # must print "all clean"
    python3 vault/_tools/gen_index.py                      # after adding a note or changing a description

Enable the checks once per clone, from the repository root: `git config core.hooksPath .githooks`. The rules are in `CLAUDE.md` here and in `00-Meta/Conventions.md`.
