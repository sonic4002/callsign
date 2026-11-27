#!/usr/bin/env python3
"""Check vault notes against the contract in 00-Meta/Conventions.md.

    python3 vault/_tools/validate_frontmatter.py --all        every note
    python3 vault/_tools/validate_frontmatter.py NOTE.md ...  some notes
    python3 vault/_tools/validate_frontmatter.py --hook       one note named by a Claude Code hook on stdin

Standard library only. Exit 0 when clean, 2 when a note breaks the contract.
"""
import datetime
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vaultlib as v

REQUIRED = ["title", "description", "type", "status", "tags", "created", "updated", "agent", "origin", "confidence", "related", "paths"]
LISTS = {"tags", "related", "paths", "aliases"}
OPTIONAL = {"aliases", "decided", "superseded_by"}
ENUMS = {
    "type": {"hub", "overview", "concept", "system", "reference", "decision", "how-to", "log", "meta"},
    "status": {"current", "draft", "superseded"},
    "agent": {"AGY", "CLD", "OWN"},  # Antigravity, Claude, the owner
    "origin": {"code", "docs", "mixed"},
    "confidence": {"high", "medium", "low"},
}
MIRRORED = ["type", "status", "agent", "origin"]  # each has a tag family of the same name
FAMILIES = {"type", "status", "agent", "origin", "area", "topic"}
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
BAD_NAME = re.compile(r"[/:#^\[\]|]")
# No secrets, addresses or people in the vault: say where a secret lives, never what it is.
SECRETS = [
    (re.compile(r"sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9]{32,}|ghp_[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY"), "something that looks like a key"),
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.(?:com|io|net|org|co\.il)\b"), "an e-mail address"),
    (re.compile(r"/home/[a-z][a-z0-9_-]+/"), "a home directory path"),
]
ALLOWED_ADDRESSES = {"noreply@anthropic.com"}


def check(path, names):
    fm, order, body, errors = v.read(path)
    if not order:
        return errors
    rel = os.path.relpath(path, v.ROOT)
    for key in REQUIRED:
        if key not in fm:
            errors.append(f"missing key: {key}")
    for key in order:
        if key not in REQUIRED and key not in OPTIONAL:
            errors.append(f"unknown key: {key} (add it to Conventions and the validator first)")
        if (key in LISTS) != isinstance(fm[key], list):
            errors.append(f"{key} must be {'a list' if key in LISTS else 'a single value'}")
    if errors:
        return errors
    stem = v.name(path)
    if fm["title"] != stem:
        errors.append(f"title must equal the file name: {stem!r}")
    if BAD_NAME.search(stem) or len(stem) > 90 or not stem.isascii():
        errors.append("file name: ASCII, at most 90 characters, none of / : # ^ [ ] |")
    for key, allowed in ENUMS.items():
        if fm[key] not in allowed:
            errors.append(f"{key}: {fm[key]!r} is not one of {sorted(allowed)}")
    d = fm["description"]
    if not d or len(d) > 200 or "\n" in d:
        errors.append("description: one plain sentence of at most 200 characters")
    raw = open(path, encoding="utf-8").read().split("\n---\n", 1)[0]
    if not re.search(r'^description: ".*"$', raw, re.M):
        errors.append("description must be double-quoted")
    for key in ("created", "updated"):
        if not DATE.match(fm[key]):
            errors.append(f"{key}: use YYYY-MM-DD")
        else:
            try:
                datetime.date.fromisoformat(fm[key])
            except ValueError:
                errors.append(f"{key}: not a real date")
    if DATE.match(fm["created"]) and DATE.match(fm["updated"]) and fm["updated"] < fm["created"]:
        errors.append("updated is earlier than created")
    tags = fm["tags"]
    for tag in tags:
        family, _, value = tag.partition("/")
        if family not in FAMILIES or not value or not re.fullmatch(r"[A-Za-z0-9-]+", value):
            errors.append(f"tag {tag!r}: use family/value with a family of {sorted(FAMILIES)}")
        elif family != "agent" and value != value.lower():
            errors.append(f"tag {tag!r}: lowercase")
    for key in MIRRORED:
        want = f"{key}/{fm[key]}"
        if want not in tags:
            errors.append(f"tags must mirror the field: add {want}")
        for tag in tags:
            if tag.startswith(key + "/") and tag != want:
                errors.append(f"tag {tag!r} disagrees with {key}: {fm[key]}")
    if len(fm["related"]) > 10:
        errors.append("related: at most 10 links")
    for item in fm["related"]:
        m = re.fullmatch(r"\[\[([^\]|#]+)\]\]", item)
        if not m:
            errors.append(f"related: {item!r} is not a wikilink")
        elif m.group(1) not in names:
            errors.append(f"related: no note named {m.group(1)!r}")
    if fm["related"] and not re.search(r'^  - "\[\[', raw, re.M):
        errors.append("related: quote each wikilink")
    for target in sorted(set(v.links(body))):
        if target not in names:
            errors.append(f"link to a note that does not exist: [[{target}]]")
    repo = os.path.dirname(v.ROOT)
    for p in fm["paths"]:
        if not os.path.exists(os.path.join(repo, p)):
            errors.append(f"paths: {p} is not in the repository")
    if fm["status"] == "superseded" and "superseded_by" not in fm:
        errors.append("a superseded note names its successor in superseded_by")
    if len(body.split()) < 20 and fm["type"] != "meta":
        errors.append("the note is empty")
    whole = raw + "\n" + body
    for pattern, what in SECRETS:
        for m in pattern.finditer(whole):
            if m.group(0) not in ALLOWED_ADDRESSES:
                errors.append(f"{what} does not belong in the vault: {m.group(0)[:24]}")
    return errors


def main(argv):
    all_notes = v.notes()
    names = {v.name(p) for p in all_notes}
    if "--hook" in argv:
        try:
            path = json.load(sys.stdin).get("tool_input", {}).get("file_path", "")
        except ValueError:
            return 0
        path = os.path.abspath(path)
        if not path.endswith(".md") or path not in {os.path.abspath(p) for p in all_notes}:
            return 0
        targets = [path]
    elif "--all" in argv:
        targets = all_notes
    else:
        targets = [os.path.abspath(a) for a in argv if not a.startswith("--")]
        known = {os.path.abspath(p) for p in all_notes}
        targets = [t for t in targets if t in known]
    seen = {}
    for p in all_notes:
        seen.setdefault(v.name(p), []).append(os.path.relpath(p, v.ROOT))
    bad = 0
    for stem, where in seen.items():
        if len(where) > 1 and any(os.path.join(v.ROOT, w) in targets for w in where):
            print(f"two notes share the name {stem!r}: {', '.join(where)}", file=sys.stderr)
            bad += 1
    for path in targets:
        errors = check(path, names)
        if errors:
            bad += 1
            print(os.path.relpath(path, v.ROOT), file=sys.stderr)
            for e in errors:
                print(f"  - {e}", file=sys.stderr)
    if bad:
        print(f"{bad} note(s) break the contract in 00-Meta/Conventions.md", file=sys.stderr)
        return 2
    if "--hook" not in argv:
        print(f"{len(targets)} note(s) checked, all clean")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
