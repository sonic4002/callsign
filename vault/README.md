# Callsign vault

An Obsidian vault documenting Callsign (אות קריאה): game design, the radio net, brains and agents, the client, speech, the server, operations, art, decisions, known flaws, history and a glossary.

## Open it

Obsidian -> "Open folder as vault" -> this folder (`vault/`). No plugins are needed. Start at `Home.md`; `00-Meta/Index.md` lists every note with a one-line description.

## How it is organised

- `00-Overview` to `04-Operations`: each has overview notes for a first read (listed in `Home.md`) and focused notes, one subject each, that the overviews link to under "In detail".
- `05-Decisions`: one note per locked decision. `06-Status-and-Reference`: known flaws, backlog, history, glossary.
- `00-Meta`: the contract (`Conventions.md`), the agent's starting note (`Agent Handoff.md`) and the generated `Index.md`.

## Keep it current

    python3 vault/_tools/validate_frontmatter.py --all    # must print "all clean"
    python3 vault/_tools/gen_index.py                      # after adding a note or changing a description

Enable the checks once per clone, from the repository root: `git config core.hooksPath .githooks`. The rules are in `CLAUDE.md` here and in `00-Meta/Conventions.md`.
