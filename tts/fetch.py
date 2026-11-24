"""Downloads the speech model files named in tts/models.json, from pinned revisions.

A file that is already there with the right checksum is kept. Files with a pinned SHA-256
are checked against it; the small text files are pinned by revision alone.
"""
import hashlib
import json
import pathlib
import sys
import urllib.request

root = pathlib.Path(__file__).resolve().parent.parent
spec = json.loads((root / "tts" / "models.json").read_text())
out = root / spec["dir"]


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


for item in spec["files"]:
    dest = out / item["dest"]
    want = item.get("sha256")
    if dest.exists() and (not want or digest(dest) == want):
        continue
    dest.parent.mkdir(parents=True, exist_ok=True)
    url = f"https://huggingface.co/{item['repo']}/resolve/{item['revision']}/{item['path']}"
    print(f"fetching {item['dest']}", flush=True)
    part = dest.with_name(dest.name + ".part")
    with urllib.request.urlopen(url) as res, open(part, "wb") as f:
        for block in iter(lambda: res.read(1 << 20), b""):
            f.write(block)
    if want and digest(part) != want:
        part.unlink()
        sys.exit(f"{item['dest']}: checksum does not match, nothing was kept")
    part.rename(dest)
print(f"speech models are in {out}")
