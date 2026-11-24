"""Pins the radio's own words to one pronunciation.

The Hebrew reader turns text into phonemes word for word, so its output lines up with the
text it was given. For every word of the text that is in the table, the matching phoneme
word is rewritten to the table's reading. Only the vowels and the stress change: the word
is found by its consonants, so a prefix glued to the front (ב, ל, ו ...) keeps the
phonemes the reader gave it.
"""
import json
import pathlib
import re

TABLE = json.loads((pathlib.Path(__file__).parent / "pronounce.json").read_text(encoding="utf-8"))

_EDGE = ".,;:!?\"'()[]…-–—"
_VOWELS = "ˈˌaeiouː"
_PREFIXES = "ובלמהשכ"
_TAG = re.compile(r"</?[a-z]{2}>")


def _skeleton(ipa):
    """A pattern for a word with these consonants and any vowels, at the end of a word."""
    consonants = [ch for ch in ipa if ch not in _VOWELS]
    gap = f"[{_VOWELS}]*"
    # The glottal stop is often dropped by the reader; a word may also start without it.
    parts = [re.escape(c) + ("?" if c == "ʔ" else "") for c in consonants]
    return re.compile(gap.join(parts) + gap + "$")


def _stem(word, table):
    """The table entry for a word, allowing up to two prefix letters in front of it."""
    for cut in range(3):
        if cut and (len(word) <= cut or word[cut - 1] not in _PREFIXES):
            break
        if word[cut:] in table:
            return word[cut:]
    return None


def _count(words, stem, table):
    return sum(1 for w in words if _stem(w.strip(_EDGE), table) == stem)


def fix(original, prepared, phonemes, lang):
    """Returns `phonemes` with the table's readings.

    `original` is the message as written, `prepared` the same text after numbers were
    spelled out, and `phonemes` the reader's output for `prepared`.
    """
    table = TABLE.get(lang)
    if not table:
        return phonemes
    # The reader puts a space before punctuation that follows a foreign word.
    phonemes = re.sub(r"\s+([,.;:!?])", r"\1", phonemes)
    words = prepared.split()
    spoken = phonemes.split()
    if len(words) != len(spoken):
        return phonemes  # not word for word this time; leave the reading alone
    written = original.split()
    bare = [w.strip(_EDGE) for w in words]
    last = max((i for i, w in enumerate(bare) if w), default=-1)
    for i, word in enumerate(bare):
        stem = _stem(word, table)
        if stem is None:
            continue
        entry = table[stem]
        if entry.get("last") and i != last:
            continue
        if "before" in entry and (i + 1 >= len(bare) or bare[i + 1] != entry["before"]):
            continue
        # A number spelled out can be the same word as a name (1000 is אלף): leave those.
        if _count(words, stem, table) != _count(written, stem, table):
            continue
        token = spoken[i]
        tags = _TAG.findall(token)
        core = _TAG.sub("", token)
        body = core.rstrip(_EDGE)
        tail = core[len(body):]
        head = body[: len(body) - len(body.lstrip(_EDGE))]
        body = body[len(head):]
        fixed, n = _skeleton(entry["ipa"]).subn(entry["ipa"], body, count=1)
        if n:
            opening = "".join(t for t in tags if not t.startswith("</") and token.startswith(t))
            closing = "".join(t for t in tags if t.startswith("</"))
            spoken[i] = opening + head + fixed + tail + closing
    return " ".join(spoken)
