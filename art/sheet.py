"""Pictures for looking at the art before it goes into the game.

    python art/sheet.py candidates out_dir [id ...]   the raw candidates of each sprite, side by
                                                      side with their seeds, six sprites a page
    python art/sheet.py scene out.png                 every finished sprite standing on the game's
                                                      ground at the size the page draws it, runs of
                                                      wall, fence and bridge laid end to end
    python art/sheet.py stages out.png [key ...]      each structure going up: its stages in order,
                                                      then finished, then its door open and lit
    python art/sheet.py leaving out.png [key ...]     a unit coming out of each producing structure
                                                      and walking to its rally point, in six steps
    python art/sheet.py strip out.png zoom unit[:rows[:anims]] ...
                                                      chosen animations of chosen heading rows of
                                                      unit sheets, e.g. tank:0,1,2:idle,move

Runs in the callsign-art image (it only needs Pillow and numpy).
"""

import json
import pathlib
import re
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
        for suffix in ("", "_ruin"):
            part = [(k, e) for k, e in group if (k.endswith(suffix) if suffix else not re.search(r"_(site|ruin|stage\d)$", k))]
            if part:
                y = row(part, y, 215 if prefix.startswith("hq") or len(part) < 8 else 215, by_height)
    y = row([(k, e) for k, e in b.items() if not k.startswith(("hq_", "aegis_", "ashfall_"))], y, 215, by_height)
    y = row([(k, e) for k, e in m.get("landmarks", {}).items() if "size" in e], y + 60, 170, by_height)
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


GROUND = (150, 140, 96, 255)
MAKES = {"barracks": "commandos", "safehouse": "militia", "works": "tank", "chopShop": "technical", "airbase": "helicopter",
         "launchYard": "fpvSwarm", "dockyard": "patrolBoat", "boatShed": "speedboat", "refinery": "aegis_hauler", "smelter": "ashfall_hauler"}


def structures(m, keys):
    names = [k for k, e in m["buildings"].items() if e.get("stages")]
    return [k for k in names if not keys or k in keys]


def with_door(m, key, state):
    """A structure's finished picture with its door patch laid over it."""
    entry = m["buildings"][key]
    image = Image.open(OUT / entry["image"]).convert("RGBA")
    patch = entry.get("door", {}).get("frames", {}).get(state)
    if patch:
        image.alpha_composite(Image.open(OUT / patch["image"]).convert("RGBA"), tuple(patch["at"]))
    return image


def stages(out, keys):
    m = json.loads((OUT / "manifest.json").read_text())
    rows = []
    for key in structures(m, keys):
        entry = m["buildings"][key]
        frames = [(name, Image.open(OUT / m["buildings"][name]["image"]).convert("RGBA")) for name in entry["stages"]]
        frames.append((key, Image.open(OUT / entry["image"]).convert("RGBA")))
        for state in ("open", "lit"):
            if entry.get("door", {}).get("frames", {}).get(state):
                frames.append((f"{key} door {state}", with_door(m, key, state)))
        rows.append(frames)
    cw = max(im.width for row in rows for _, im in row) + 12
    ch = max(im.height for row in rows for _, im in row) + 22
    page = Image.new("RGBA", (cw * max(len(r) for r in rows), ch * len(rows)), GROUND)
    draw = ImageDraw.Draw(page)
    for r, row in enumerate(rows):
        for c, (name, im) in enumerate(row):
            page.alpha_composite(im, (c * cw + 6, r * ch + 16))
            draw.text((c * cw + 6, r * ch + 2), name, fill=(20, 20, 20))
    page.convert("RGB").save(out)
    print(out, page.size)


def leaving(out, keys):
    """Six moments of a unit leaving each producing structure, with the door as the page
    shows it at that moment (see doorAt and emergence in client/art.js)."""
    m = json.loads((OUT / "manifest.json").read_text())
    BUILD, UNIT, METRE = 1.55, 1.9, 15
    rows = [k for k in structures(m, keys) if m["buildings"][k].get("door")]
    cw, ch = 330, 250
    page = Image.new("RGBA", (cw * 6, ch * len(rows)), GROUND)
    draw = ImageDraw.Draw(page)
    for r, key in enumerate(rows):
        entry = m["buildings"][key]
        k = BUILD * entry["height"] / entry["size"][1]
        unit = m["units"][MAKES[key.split("_", 1)[1]]]
        sheet = Image.open(OUT / unit["image"]).convert("RGBA")
        fw, fh = unit["frame"]
        for c, t in enumerate((0.0, 0.1, 0.3, 0.55, 0.8, 1.0)):
            door = "closed" if t >= 1 else "lit" if t < 0.12 or t >= 0.86 else "open"
            building = with_door(m, key, door)
            building = building.resize((round(building.width * k), round(building.height * k)), Image.LANCZOS)
            ox, oy = c * cw + 190, r * ch + 150
            page.alpha_composite(building, (round(ox - entry["anchor"][0] * building.width), round(oy - entry["anchor"][1] * building.height)))
            at = lambda name: ((entry["door"][name][0] - entry["anchor"][0]) * building.width, (entry["door"][name][1] - entry["anchor"][1]) * building.height)
            (ex, ey), (rx, ry) = at("exit"), at("rally")
            go = max(0.0, min(1.0, (t - 0.12) / 0.74))
            go = go * go * (3 - 2 * go)
            x, y = ex + (rx - ex) * go, ey + (ry - ey) * go
            alpha = min(1.0, max(0.0, (t - 0.12) / 0.74) * 4)
            if alpha > 0:
                # The heading row that points from the door to the rally point.
                import math

                screen = math.atan2(ry - ey, rx - ex) if (rx, ry) != (ex, ey) else math.pi / 4
                heading = math.atan2(math.sin(screen) - math.cos(screen) / 2, math.sin(screen) + math.cos(screen) / 2)
                row = round(heading / (2 * math.pi / unit["facings"])) % unit["facings"]
                col = unit["anims"].get("walk", unit["anims"].get("move", unit["anims"]["idle"]))[0] + (c % 2)
                frame = sheet.crop((col * fw, row * fh, (col + 1) * fw, (row + 1) * fh))
                uk = METRE / unit["ppm"] * UNIT
                frame = frame.resize((max(1, round(fw * uk)), max(1, round(fh * uk))), Image.LANCZOS)
                if alpha < 1:
                    frame.putalpha(frame.getchannel("A").point(lambda a: int(a * alpha)))
                lift = unit.get("altitude", 0) * METRE * UNIT * go if entry["door"].get("lift") else 0
                page.alpha_composite(frame, (round(ox + x - unit["anchor"][0] * frame.width), round(oy + y - lift - unit["anchor"][1] * frame.height)))
            draw.text((c * cw + 6, r * ch + 4), f"{key}  t={t}  door {door}" if c == 0 else f"t={t}  {door}", fill=(20, 20, 20))
    page.convert("RGB").save(out)
    print(out, page.size)


def strip(out, zoom, wanted):
    m = json.loads((OUT / "manifest.json").read_text())
    strips = []
    for arg in wanted:
        name, rows, anims = (arg.split(":") + ["", ""])[:3]
        turret = name.endswith("_turret")
        unit = m["units"][name[:-7] if turret else name]
        part = unit["turret"] if turret else unit
        image = Image.open(OUT / part["image"]).convert("RGBA")
        fw, fh = part["frame"]
        for r in [int(x) for x in rows.split(",")] if rows else [0, 2, 4, 6]:
            cols = []
            for anim in anims.split(",") if anims else list(part["anims"]):
                start, count = part["anims"][anim]
                cols += [(anim if i == 0 else "", start + i) for i in range(count)]
            line = Image.new("RGBA", (len(cols) * fw, fh), GROUND)
            for i, (_, c) in enumerate(cols):
                line.alpha_composite(image.crop((c * fw, r * fh, (c + 1) * fw, (r + 1) * fh)), (i * fw, 0))
            line = line.resize((round(line.width * zoom), round(line.height * zoom)), Image.LANCZOS)
            draw = ImageDraw.Draw(line)
            for i, (label, _) in enumerate(cols):
                if label:
                    draw.text((round(i * fw * zoom) + 2, 1), label, fill=(20, 20, 20))
            draw.text((2, line.height - 12), f"{name} {unit['order'][r]}", fill=(70, 20, 20))
            strips.append(line)
    page = Image.new("RGB", (max(l.width for l in strips), sum(l.height for l in strips)), GROUND[:3])
    y = 0
    for line in strips:
        page.paste(line.convert("RGB"), (0, y))
        y += line.height
    page.save(out)
    print(out, page.size)


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "candidates":
        candidates(sys.argv[2], sys.argv[3:])
    elif len(sys.argv) > 2 and sys.argv[1] == "scene":
        scene(sys.argv[2])
    elif len(sys.argv) > 2 and sys.argv[1] == "stages":
        stages(sys.argv[2], sys.argv[3:])
    elif len(sys.argv) > 2 and sys.argv[1] == "leaving":
        leaving(sys.argv[2], sys.argv[3:])
    elif len(sys.argv) > 4 and sys.argv[1] == "strip":
        strip(sys.argv[2], float(sys.argv[3]), sys.argv[4:])
    else:
        raise SystemExit(__doc__)
