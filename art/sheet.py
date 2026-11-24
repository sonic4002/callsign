"""Pictures for looking at the art before it goes into the game.

    python art/sheet.py candidates out_dir [id ...]   the raw candidates of each sprite, side by
                                                      side with their seeds, six sprites a page
    python art/sheet.py scene out.png                 every finished sprite standing on the game's
                                                      ground at the size the page draws it, runs of
                                                      wall, fence and bridge laid end to end

Runs in the callsign-art image (it only needs Pillow and numpy).
"""

import json
import pathlib
import sys

from PIL import Image, ImageDraw

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
RAW = ROOT / "assets" / "raw"
OUT = ROOT / "assets" / "sprites"
INK = (236, 240, 232)


def candidates(out_dir, ids):
    spec = json.loads((HERE / "sprites.json").read_text())
    sprites = [s for s in spec["sprites"] if (not ids or s["id"] in ids)]
    out_dir = pathlib.Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    cell, per_page = 300, 6
    for page_no in range(0, len(sprites), per_page):
        chunk = sprites[page_no : page_no + per_page]
        cols = max(len(s["seeds"]) for s in chunk)
        page = Image.new("RGB", (cols * cell, len(chunk) * (cell + 18)), (70, 76, 72))
        draw = ImageDraw.Draw(page)
        for r, sprite in enumerate(chunk):
            for c, seed in enumerate(sprite["seeds"]):
                raw = RAW / f"{sprite['id']}__{seed}.png"
                if not raw.exists():
                    continue
                image = Image.open(raw).convert("RGB")
                image.thumbnail((cell - 4, cell - 4))
                page.paste(image, (c * cell + 2, r * (cell + 18) + 16))
                mark = "  KEPT" if sprite.get("keep") == seed else ""
                draw.text((c * cell + 4, r * (cell + 18) + 2), f"{sprite['id']}  seed {seed}{mark}", fill=INK)
        path = out_dir / f"cand-{page_no // per_page:02d}.png"
        page.save(path)
        print(path, [s["id"] for s in chunk])


def tiled(image, size):
    page = Image.new("RGB", size)
    for x in range(0, size[0], image.width):
        for y in range(0, size[1], image.height):
            page.paste(image, (x, y))
    return page


def scene(out):
    """A stretch of ground seen as the page shows it at zoom 1, with everything on it."""
    m = json.loads((OUT / "manifest.json").read_text())
    W, H = 2200, 5000
    load = lambda rel: Image.open(OUT / rel).convert("RGBA")
    # The page paints the ground with the tile in iso space; here it is simply laid flat,
    # which is enough to judge colours and cut-outs against it.
    page = tiled(load(m["terrain"]["land"]).convert("RGB"), (W, H)).convert("RGBA")
    # The other kinds of ground, as wide strips at the foot of the page: the runs of wall
    # and bridge below are laid across them.
    for name, y0 in (("sea", H - 1300), ("ice", H - 520), ("mountain", H - 260)):
        if name in m["terrain"]:
            page.paste(tiled(load(m["terrain"][name]).convert("RGB"), (W, 780 if name == "sea" else 260)), (0, y0))
    draw = ImageDraw.Draw(page)
    BUILD, UNIT, METRE = 1.55, 1.9, 15  # the page's scales at zoom 1

    def stand(entry, x, y, k, label=None, frame=None):
        image = load(entry["image"])
        if frame:
            fw, fh, col, row = frame
            image = image.crop((col * fw, row * fh, (col + 1) * fw, (row + 1) * fh))
        w, h = max(1, round(image.width * k)), max(1, round(image.height * k))
        image = image.resize((w, h), Image.LANCZOS)
        ax, ay = entry.get("anchor", [0.5, 0.8])
        page.alpha_composite(image, (round(x - ax * w), round(y - ay * h)))
        if label:
            draw.text((x - 40, y + 8), label, fill=INK)

    def row(entries, y, step, k_of, x=110):
        for key, entry in entries:
            stand(entry, x, y, k_of(entry), key)
            x += step
            if x > W - 120:
                x, y = 110, y + 190
        return y + 190

    by_height = lambda e: BUILD * e["height"] / e["size"][1]
    b = m["buildings"]
    y = 200
    for prefix in ("hq_aegis", "aegis_", "hq_ashfall", "ashfall_"):
        group = [(k, e) for k, e in b.items() if k.startswith(prefix)]
        for suffix in ("", "_site", "_ruin"):
            part = [(k, e) for k, e in group if (k.endswith(suffix) if suffix else not k.endswith(("_site", "_ruin")))]
            if part:
                y = row(part, y, 215 if prefix.startswith("hq") or len(part) < 8 else 215, by_height)
    y = row([(k, e) for k, e in b.items() if not k.startswith(("hq_", "aegis_", "ashfall_"))], y, 215, by_height)
    y = row(list(m.get("landmarks", {}).items()), y + 60, 170, by_height)
    y = row(list(m.get("props", {}).items()), y, 200, by_height)

    # Units at the page's scale, one heading each, beside the buildings.
    x = 110
    for key, u in m["units"].items():
        fw, fh = u["frame"]
        stand(u, x, y, METRE / u["ppm"] * UNIT, key, frame=(fw, fh, 0, 1))
        x += 150 if u.get("per") else 210
        if x > W - 150:
            x, y = 110, y + 150
    y += 170

    # Runs: five pieces along each axis, drawn back to front, true to the map at zoom 1.
    # The walls stand on land; the bridge crosses the strip of sea.
    order = sorted(m.get("segments", {}).items(), key=lambda kv: kv[0] == "bridge")
    for key, seg in order:
        if key == "bridge":
            y = H - 1120
        k = seg["scale"]
        for axis, (dx, dy), ox in (("x", (1, 0.5), 200), ("y", (-1, 0.5), 1500)):
            states = ["end", "", "", "broken", "", "end"] if "end" in seg else (["", "", "ruin", "", ""] if "ruin" in seg else [""] * 5)
            for i, state in enumerate(states):
                part = seg[state][axis] if state else seg[axis]
                stand(part, ox + dx * seg["length"] * i, y + dy * seg["length"] * i, k)
            if "post" in seg:
                for i in (-0.5, len(states) - 0.5):
                    stand(seg["post"], ox + dx * seg["length"] * i, y + dy * seg["length"] * i, k)
        draw.text((110, y - 40), key, fill=INK)
        y += 300
    page.convert("RGB").save(out)
    print(out, page.size)


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "candidates":
        candidates(sys.argv[2], sys.argv[3:])
    elif len(sys.argv) > 2 and sys.argv[1] == "scene":
        scene(sys.argv[2])
    else:
        raise SystemExit(__doc__)
