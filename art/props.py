"""Run pieces and ground props, rendered from models built here in code.

Some things on the map are laid end to end: a wall, a fence, a bridge. A painted picture
cannot be made to meet its neighbour exactly, so these are modelled like the units
(art/units.py) and rendered by Blender from the game's camera, once along the map's
east-west axis ("x") and once along its north-south axis ("y"). Every piece covers
exactly LENGTH metres of its run, so pieces drawn one after another join with no seam.

    python art/props.py                 # everything
    python art/props.py bridge wall     # only these
    python art/props.py --sheet out.png # also write a contact sheet

Writes assets/sprites/segments/*.png and assets/sprites/props/*.png, and the "segments"
and "props" parts of assets/sprites/manifest.json (see the notes on those in
assets/sprites/CREDITS.md).
"""

import argparse
import json
import math

import bpy  # isort: skip
from PIL import Image, ImageDraw

from units import AEGIS, ASHFALL, CHARRED, OUT, PPM, RAW, _object, aim_camera, ball, box, cyl, gold_heap, holdout, joint, mat, outlined, prism_y, setup_scene

LENGTH = 4.0  # metres of run one piece covers
OVERLAP = 0.06  # each piece runs this far past its ends, so no gap shows between two
UNITS_PER_METRE = 15  # world units one modelled metre stands for (the page's METRE)
HALF = LENGTH / 2 + OVERLAP
CONCRETE, ROAD, STONE = "#8d8f8a", "#4b4f53", ["#a59a80", "#8f8670", "#b3a98f", "#7e7764"]


def rnd(seed):
    """A small repeatable random stream: the same pieces every run."""
    state = [seed * 7919 + 17]

    def nxt():
        state[0] = (state[0] * 1103515245 + 12345) % (1 << 31)
        return state[0] / (1 << 31)

    return nxt


def water_cut():
    """Whatever is under the waterline is cut out of the picture."""
    plane = _object("water", [(-30, -30, 0), (30, -30, 0), (30, 30, 0), (-30, 30, 0)], [(0, 1, 2, 3)], holdout(), None)
    plane.location = (0, 0, -0.001)


def debris(root, colours, n, spread, seed, size=0.3):
    r = rnd(seed)
    for i in range(n):
        s = size * (0.5 + r())
        box(root, (s, s * (0.6 + r()), s * 0.5), ((r() - 0.5) * 2 * spread[0], (r() - 0.5) * 2 * spread[1], s * 0.2), colours[i % len(colours)],
            rot=(r() * 0.6, r() * 0.6, r() * 3))


# ---------------------------------------------------------------- walls and fences


def aegis_wall(state):
    c = AEGIS
    root = joint(None, name="root")
    box(root, (2 * HALF, 0.56, 0.24), (0, 0, 0.12), c["low"])  # plinth
    if state == "ruin":
        r = rnd(4)
        for i in range(7):
            h = 0.25 + 0.8 * r()
            box(root, (0.5, 0.34, h), (-1.8 + 0.6 * i, 0.03 * (r() - 0.5), 0.24 + h / 2), CHARRED[i % 3] if r() > 0.4 else c["hull2"], rot=(0, 0.25 * (r() - 0.5), 0))
        debris(root, [c["hull"], c["hull2"], CHARRED[0]], 12, (1.9, 0.9), 9)
        return root
    box(root, (2 * HALF, 0.34, 1.9), (0, 0, 1.19), c["hull"])  # panels
    box(root, (2 * HALF, 0.46, 0.12), (0, 0, 2.2), c["deck"])  # cap
    box(root, (2 * HALF, 0.37, 0.07), (0, 0, 1.78), c["trim"], glow=0.5)  # light strip
    box(root, (2 * HALF, 0.38, 0.16), (0, 0, 0.5), c["hull2"])  # kick plate
    for x in (-1.0, 1.0):
        box(root, (0.14, 0.44, 1.96), (x, 0, 1.2), c["hull2"])  # ribs between panels
    return root


def aegis_wall_post(state):
    c = AEGIS
    root = joint(None, name="root")
    box(root, (0.7, 0.7, 0.3), (0, 0, 0.15), c["low"])
    box(root, (0.56, 0.56, 2.3), (0, 0, 1.4), c["hull2"])
    box(root, (0.66, 0.66, 0.14), (0, 0, 2.6), c["deck"])
    box(root, (0.3, 0.3, 0.16), (0, 0, 2.74), c["trim"], glow=1.2)  # lamp
    return root


def ashfall_fence(state):
    c = ASHFALL
    root = joint(None, name="root")
    r = rnd(6)
    fallen = state == "ruin"
    for x in (-1.0, 1.0):
        lean = (0.9 + 0.5 * r()) * (1 if x > 0 else -1) if fallen else 0.08 * (r() - 0.5)
        post = joint(root, (x, 0, 0))
        post.rotation_euler = (lean if fallen else 0.05 * (r() - 0.5), lean if not fallen else 0.2, 0)
        box(post, (0.16, 0.16, 2.0), (0, 0, 1.0), c["wood"])
        box(post, (0.2, 0.2, 0.1), (0, 0, 1.98), c["low"])
    if fallen:
        for i in range(3):
            cyl(root, 0.025, 2 * HALF, (0, 0.5 * (i - 1) + 0.2 * r(), 0.06), "#3a3835", axis="X", sides=4)
        box(root, (1.5, 1.1, 0.05), (-0.7, 0.5, 0.06), c["rust"], rot=(0.05, 0.03, 0.3))
        debris(root, [c["wood"], c["rust"], CHARRED[0]], 8, (1.8, 0.9), 12, 0.25)
        return root
    for z in (0.55, 1.05, 1.55, 1.9):
        cyl(root, 0.025, 2 * HALF, (0, 0, z), "#3a3835", axis="X", sides=4)  # wire strands
    # Sheets of corrugated iron and a tarpaulin wired to the posts.
    box(root, (1.5, 0.05, 1.15), (-1.1, 0.06, 0.82), c["rust"], rot=(0.03, 0, 0))
    box(root, (1.3, 0.05, 0.95), (0.55, -0.06, 0.7), c["hull2"], rot=(-0.04, 0, 0))
    box(root, (0.9, 0.04, 0.8), (1.55, 0.07, 1.15), c["armour"], rot=(0.06, 0, 0))
    for i in range(9):
        # Loops of barbed wire along the top, seen as short rings.
        cyl(root, 0.17, 0.03, (-1.9 + 0.475 * i, 0, 2.08), "#55524d", axis="X", sides=8)
    return root


def ashfall_fence_post(state):
    c = ASHFALL
    root = joint(None, name="root")
    box(root, (0.26, 0.26, 2.3), (0, 0, 1.15), c["wood"])
    box(root, (0.34, 0.34, 0.12), (0, 0, 2.3), c["low"])
    cyl(root, 0.2, 0.36, (0, 0, 0.2), c["rust"], sides=8)  # an oil drum footing
    box(root, (0.5, 0.05, 0.36), (0, 0.16, 1.7), c["rust"], rot=(0, 0, 0.2))  # a tin plate nailed on
    return root


def field_wall(state):
    """An old dry-stone wall between fields."""
    root = joint(None, name="root")
    r = rnd(21)
    for row, z in enumerate((0.16, 0.46, 0.74)):
        x = -HALF
        i = 0
        while x < HALF:
            w = min(0.45 + 0.4 * r(), HALF - x)
            if w < 0.12:
                break
            h = 0.3 if row < 2 else 0.2 + 0.12 * r()
            box(root, (w - 0.03, 0.5 - 0.06 * row + 0.06 * r(), h), (x + w / 2, 0.03 * (r() - 0.5), z + (h - 0.3) / 2), STONE[(i + row) % 4])
            x += w
            i += 1
    return root


# ---------------------------------------------------------------- bridge

DECK_W, DECK_TOP = 7.0, 0.5


def deck(root, x0, x1, tilt=None):
    """One stretch of roadway from x0 to x1, with kerbs and a railing on both sides."""
    part = joint(root, ((x0 + x1) / 2, 0, DECK_TOP - 0.16))
    n = x1 - x0
    box(part, (n, DECK_W, 0.32), (0, 0, 0), CONCRETE)
    box(part, (n, DECK_W - 1.4, 0.03), (0, 0, 0.165), ROAD)
    for side in (1, -1):
        box(part, (n, 0.32, 0.2), (0, (DECK_W / 2 - 0.16) * side, 0.24), "#a3a59f")  # kerb
        box(part, (n, 0.5, 0.5), (0, (DECK_W / 2 - 0.5) * side, -0.4), "#6c6e69")  # girder
        box(part, (n, 0.08, 0.08), (0, (DECK_W / 2 - 0.16) * side, 1.0), "#5a5e63")  # top rail
        box(part, (n, 0.06, 0.06), (0, (DECK_W / 2 - 0.16) * side, 0.68), "#5a5e63")
    if tilt:
        part.rotation_euler = (tilt[1], tilt[0], 0)
        part.location = (part.location[0], 0, part.location[2] + tilt[2])
    return part


def bridge(state):
    root = joint(None, name="root")
    if state == "end":
        # Where the bridge meets the bank: the roadway on a stone abutment, and a pylon
        # at each side.
        deck(root, -HALF, HALF)
        box(root, (2 * HALF, DECK_W + 0.6, DECK_TOP - 0.3), (0, 0, (DECK_TOP - 0.3) / 2), STONE[1])
        for side in (1, -1):
            box(root, (1.0, 1.0, 2.4), (0, (DECK_W / 2 + 0.3) * side, 1.2), STONE[0])
            box(root, (1.16, 1.16, 0.2), (0, (DECK_W / 2 + 0.3) * side, 2.5), STONE[3])
            box(root, (0.4, 0.4, 0.3), (0, (DECK_W / 2 + 0.3) * side, 2.75), "#e9c46a", glow=0.8)  # lamp
        return root
    water_cut()
    # The pier: a concrete wall under the middle of the piece, pointed against the current.
    box(root, (1.1, DECK_W - 1.0, 1.6), (0, 0, -0.6), "#7a7c77")
    for side in (1, -1):
        prism_y(root, [(-0.55, -1.4), (0.55, -1.4), (0.55, 0.2), (-0.55, 0.2)], 0.9, "#70726d", y=(DECK_W / 2 - 0.2) * side)
    if state == "broken":
        # The roadway has snapped: a stub hangs from each neighbour and slopes into the water.
        deck(root, -HALF, -0.5, tilt=(0.5, 0.05, -0.35))
        deck(root, 0.6, HALF, tilt=(-0.42, -0.06, -0.3))
        box(root, (1.3, DECK_W - 1.2, 0.3), (0.1, 0.2, 0.05), "#6c6e69", rot=(0.2, 0.1, 0.15))  # a slab on the pier
        r = rnd(31)
        for i in range(7):
            cyl(root, 0.03, 0.7, (-0.6 + 1.3 * r(), (r() - 0.5) * 5, 0.25 + 0.3 * r()), "#5a3a2a", axis="X", sides=4)  # bent bars
        return root
    deck(root, -HALF, HALF)
    for x in (-1.5, -0.5, 0.5, 1.5):
        for side in (1, -1):
            box(root, (0.1, 0.1, 0.72), (x, (DECK_W / 2 - 0.16) * side, DECK_TOP + 0.56), "#4b4f53")  # railing posts
    for x in (-1.0, 1.0):
        box(root, (0.9, 0.12, 0.02), (x, 0, DECK_TOP + 0.02), "#d9d6c8")  # centre line
    return root


# ---------------------------------------------------------------- gold lying in a field


def gold_field(level):
    root = joint(None, name="root")
    r = rnd(40 + level)
    heaps = [3, 7, 13][level - 1]
    for i in range(heaps):
        a, d = r() * 6.283, 2.3 * math.sqrt(r())
        gold_heap(root, (d * math.cos(a), d * math.sin(a), 0.02), 0.5 + 0.5 * r() + 0.12 * level, lumps=4 + level * 2 + int(3 * r()), seed=i + 10 * level)
    for i in range(6 + 6 * level):
        a, d = r() * 6.283, 2.7 * math.sqrt(r())
        ball(root, 0.06 + 0.05 * r(), (d * math.cos(a), d * math.sin(a), 0.04), "#f4d35e", squash=0.7).active_material = mat("#f4d35e", 0.5)
    return root


# name → (builder, states, cell in metres, height the camera looks at, both axes?)
SEGMENTS = {
    "aegis_wall": (aegis_wall, ["", "ruin"], 6.4, 1.1),
    "ashfall_fence": (ashfall_fence, ["", "ruin"], 6.4, 1.0),
    "wall": (field_wall, [""], 6.0, 0.4),
    "bridge": (bridge, ["", "end", "broken"], 11.5, 0.6),
}
POSTS = {"aegis_wall": aegis_wall_post, "ashfall_fence": ashfall_fence_post}
PROPS = {f"gold_field_{n}": (lambda n=n: gold_field(n), 7.4, 0.3, 16 + 3 * n) for n in (1, 2, 3)}  # last: drawn height in px


def render(name, build, cell, centre, turn=0.0):
    scene = setup_scene()
    root = build()
    root.rotation_euler = (0, 0, turn)
    size, origin = aim_camera(scene, cell, centre)
    path = RAW / "props" / f"{name}.png"
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    return Image.open(path).convert("RGBA"), origin


def trimmed(image, origin, rel, outline=False):
    if outline:
        image = outlined(image)
    b = image.getchannel("A").point(lambda a: 255 if a > 6 else 0).getbbox()
    left, top, right, bottom = b[0] - 1, b[1] - 1, b[2] + 1, b[3] + 1
    cut = image.crop((left, top, right, bottom))
    (OUT / rel).parent.mkdir(parents=True, exist_ok=True)
    cut.save(OUT / rel, optimize=True)
    print(f"{rel}  {cut.width}x{cut.height}")
    return {"image": rel, "size": [cut.width, cut.height], "anchor": [round((origin[0] - left) / cut.width, 4), round((origin[1] - top) / cut.height, 4)]}, cut


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("names", nargs="*")
    ap.add_argument("--sheet")
    args = ap.parse_args()
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    manifest.setdefault("segments", {})
    manifest.setdefault("props", {})
    page = []
    want = lambda n: not args.names or n in args.names

    for name, (build, states, cell, centre) in SEGMENTS.items():
        if not want(name):
            continue
        # `scale` is what the page multiplies its zoom by to draw a piece true to the map:
        # one piece then covers `length` world units of its run.
        entry = {"length": round(LENGTH * UNITS_PER_METRE), "scale": round(UNITS_PER_METRE / (PPM * math.cos(math.pi / 4)), 4)}
        if name == "bridge":
            entry["width"] = round(DECK_W * UNITS_PER_METRE)
        for state in states:
            part = {}
            for axis, turn in (("x", 0.0), ("y", -math.pi / 2)):
                key = f"{name}{'_' + state if state else ''}_{axis}"
                image, origin = render(key, lambda: build(state), cell, centre, turn)
                part[axis], cut = trimmed(image, origin, f"segments/{key}.png")
                page.append((key, cut))
            if state:
                entry[state] = part
            else:
                entry.update(part)
        if name in POSTS:
            image, origin = render(f"{name}_post", lambda: POSTS[name](""), 3.4, 1.3)
            entry["post"], cut = trimmed(image, origin, f"segments/{name}_post.png")
            page.append((f"{name}_post", cut))
        manifest["segments"][name] = entry

    for name, (build, cell, centre, height) in PROPS.items():
        if not want(name):
            continue
        image, origin = render(name, build, cell, centre)
        entry, cut = trimmed(image, origin, f"props/{name}.png", outline=True)
        manifest["props"][name] = {**entry, "height": height}
        page.append((name, cut))

    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    if args.sheet:
        pad = 14
        sheet = Image.new("RGBA", (max(c.width for _, c in page) * 2 + 3 * pad, sum(c.height + 16 + pad for _, c in page) // 2 + 400), (104, 112, 70, 255))
        draw = ImageDraw.Draw(sheet)
        x, y, tall = pad, pad, 0
        for i, (label, cut) in enumerate(page):
            draw.text((x, y), f"{label} {cut.width}x{cut.height}", fill=(20, 24, 20))
            sheet.alpha_composite(cut, (x, y + 12))
            tall = max(tall, cut.height + 12 + pad)
            if i % 2:
                x, y, tall = pad, y + tall, 0
            else:
                x = sheet.width // 2
        sheet.convert("RGB").save(args.sheet)


if __name__ == "__main__":
    main()
