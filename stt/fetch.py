"""Downloads the speech-recognition models named in stt/models.json, from pinned revisions.

A file that is already there with the right checksum is kept. The weights are checked
against a pinned SHA-256; the small text files are pinned by revision alone.
"""
import hashlib
import json
import pathlib
import sys
import urllib.request

root = pathlib.Path(__file__).resolve().parent.parent
spec = json.loads((root / "stt" / "models.json").read_text())


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


for lang, model in spec.items():
    out = root / model["dir"]
    for name, want in model["files"].items():
        dest = out / name
        if dest.exists() and (not want or digest(dest) == want):
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        url = f"https://huggingface.co/{model['repo']}/resolve/{model['revision']}/{name}"
        print(f"fetching {lang}: {name}", flush=True)
        part = dest.with_name(dest.name + ".part")
        with urllib.request.urlopen(url) as res, open(part, "wb") as f:
            for block in iter(lambda: res.read(1 << 20), b""):
                f.write(block)
        if want and digest(part) != want:
            part.unlink()
            sys.exit(f"{model['dir']}/{name}: checksum does not match, nothing was kept")
        part.rename(dest)
    print(f"{lang}: {model['repo']} is in {out}")
