"""Shared helpers for the vault tools: find notes, read and write the frontmatter block.

The frontmatter is a small, regular subset of YAML so that it can be read with the
standard library alone: `key: scalar`, `key: [a, b]`, or `key:` followed by `  - item`
lines. Scalars may be double-quoted.
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {".obsidian", "_tools", ".trash", ".git"}
# Files at the vault root that are not notes.
NOT_NOTES = {"CLAUDE.md", "README.md"}

KEY = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$")


def notes(root=ROOT):
    out = []
    for folder, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        for name in sorted(files):
            if not name.endswith(".md"):
                continue
            if folder == root and name in NOT_NOTES:
                continue
            out.append(os.path.join(folder, name))
    return out


def unquote(text):
    text = text.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        return text[1:-1].replace('\\"', '"')
    return text


def split_inline(text):
    """Split the inside of an inline list, honouring double quotes."""
    items, cur, quoted = [], "", False
    for ch in text:
        if ch == '"':
            quoted = not quoted
            cur += ch
        elif ch == "," and not quoted:
            items.append(cur)
            cur = ""
        else:
            cur += ch
    if cur.strip():
        items.append(cur)
    return [unquote(i) for i in items]


def read(path):
    """Return (frontmatter dict, key order, body, problems). Lists are Python lists."""
    with open(path, encoding="utf-8") as f:
        text = f.read()
    problems = []
    if not text.startswith("---\n"):
        return {}, [], text, ["the frontmatter block must start on line 1"]
    end = text.find("\n---\n", 4)
    if end < 0:
        return {}, [], text, ["the frontmatter block is not closed"]
    block, body = text[4:end], text[end + 5:]
    fm, order, cur = {}, [], None
    for line in block.split("\n"):
        if not line.strip():
            continue
        if line.startswith("  - ") or line.startswith("- "):
            if cur is None or not isinstance(fm.get(cur), list):
                problems.append(f"a list item with no key above it: {line.strip()}")
                continue
            fm[cur].append(unquote(line.split("- ", 1)[1]))
            continue
        m = KEY.match(line)
        if not m:
            problems.append(f"cannot read the line: {line.strip()}")
            continue
        key, value = m.group(1), m.group(2).strip()
        if key in fm:
            problems.append(f"duplicate key: {key}")
        order.append(key)
        cur = key
        if value == "":
            fm[key] = []
        elif value.startswith("[") and value.endswith("]"):
            fm[key] = split_inline(value[1:-1])
        else:
            fm[key] = unquote(value)
    return fm, order, body, problems


def quote(text):
    return '"' + str(text).replace('"', '\\"') + '"'


QUOTED_SCALARS = {"description"}
QUOTED_LISTS = {"related"}


def write(path, fm, order, body):
    lines = ["---"]
    for key in order:
        value = fm[key]
        if isinstance(value, list):
            if not value:
                lines.append(f"{key}: []")
                continue
            lines.append(f"{key}:")
            for item in value:
                lines.append("  - " + (quote(item) if key in QUOTED_LISTS else str(item)))
        else:
            lines.append(f"{key}: " + (quote(value) if key in QUOTED_SCALARS else str(value)))
    lines.append("---")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n" + body)


LINK = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")
FENCE = re.compile(r"```.*?```", re.S)
INLINE = re.compile(r"`[^`\n]*`")


def links(body):
    """Wikilink targets in a note body, ignoring code."""
    plain = INLINE.sub("", FENCE.sub("", body))
    return [m.group(1).strip() for m in LINK.finditer(plain)]


def name(path):
    return os.path.splitext(os.path.basename(path))[0]
