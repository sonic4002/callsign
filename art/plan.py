"""Block-outs: the plan of a structure that is a whole site, drawn by code for the image
model to paint over.

A building is one block and the model places it well enough from words alone. An airfield
is a site: the game parks aircraft on its apron and lands a helicopter on its pad, so the
runway, the apron, the hangars and the pad have to lie where the game expects them. Words do
not hold a layout that exactly, so the layout is drawn here as plain boxes in the game's own
projection, and the model redraws that picture (art/generate.py, a sprite with `plan`).

Everything is given in world units from the middle of the site, x east and y south, as
the game has it: on the picture `sx = x - y`, `sy = (x + y) / 2`.

    python art/plan.py out_dir [id ...]     write the block-outs as PNG, to look at them
"""

import math
import pathlib
import sys

from PIL import Image, ImageDraw

SIZE = 1024
PPU = 3.2  # picture pixels for one world unit along the picture's x axis
RISE = 1.2  # how far one world unit of height goes up the picture, in those same pixels
CENTRE = (SIZE / 2, SIZE / 2 + 40)  # where the middle of the site stands in the picture
BACKDROP = (52, 104, 190)  # not a colour of either army, so the cut-out finds the slab's edge

HALF = 70  # the slab is a square of this half-width with its corners cut off
CUT = 118  # |x| + |y| may not pass this

# What stands where, the same for both armies; only colours and the tower differ.
RUNWAY = (-66, 27, 66, 53)  # x0, y0, x1, y1
HANGARS = [(-56, -62, -18, -28), (-12, -62, 26, -28)]
HANGAR_HEIGHT = 20
PAD = (47, -43, 17)  # x, y, radius
TOWER = (-68, -50, -58, -40)

LOOKS = {
    "aegis_airbase": {
        "slab": (158, 162, 164), "edge": (104, 110, 116), "runway": (70, 74, 82), "line": (236, 236, 228),
        "wall": (202, 208, 212), "side": (150, 162, 176), "roof": (108, 128, 152), "dark": (26, 30, 38),
        "pad": (84, 92, 100), "tower": 36, "glass": (120, 176, 200), "arch": True,
    },
    "ashfall_launchYard": {
        "slab": (156, 128, 94), "edge": (104, 82, 60), "runway": (112, 100, 88), "line": (214, 200, 170),
        "wall": (140, 88, 60), "side": (106, 66, 46), "roof": (150, 110, 78), "dark": (34, 28, 24),
        "pad": (98, 90, 82), "tower": 24, "glass": (90, 80, 66), "arch": False,
    },
}


def at(x, y, z=0.0):
    """A world point as a place in the picture."""
    return (CENTRE[0] + PPU * (x - y), CENTRE[1] + PPU * (x + y) / 2 - PPU * RISE * z)


def to_world(px, py):
    """A place in the picture as a world point on the ground: the other way round."""
    ix, iy = (px - CENTRE[0]) / PPU, (py - CENTRE[1]) / PPU
    return (iy + ix / 2, iy - ix / 2)


def box(draw, x0, y0, x1, y1, h, top, left, right, z=0.0):
    """A box standing on the ground: its roof and the two walls the camera sees, which are
    the south one (toward the lower left) and the east one (toward the lower right)."""
    draw.polygon([at(x0, y1, z), at(x1, y1, z), at(x1, y1, z + h), at(x0, y1, z + h)], fill=left)
    draw.polygon([at(x1, y0, z), at(x1, y1, z), at(x1, y1, z + h), at(x1, y0, z + h)], fill=right)
    draw.polygon([at(x0, y0, z + h), at(x1, y0, z + h), at(x1, y1, z + h), at(x0, y1, z + h)], fill=top)


def vault(draw, x0, y0, x1, y1, h, look):
    """A hangar with a barrel roof: its arched front, open, looks south onto the apron."""
    n = 12
    arc = lambda k, inset=0.0: (x0 + inset + (x1 - x0 - 2 * inset) * k / n, (h - inset) * (0.45 + 0.55 * math.sin(math.pi * k / n)))
    for k in range(n):  # the roof, west to east: each strip hides part of the one before
        (xa, za), (xb, zb) = arc(k), arc(k + 1)
        shade = 0.72 + 0.28 * math.sin(math.pi * (k + 0.5) / n) if k < n / 2 else 0.62 + 0.3 * (1 - (k + 0.5) / n)
        colour = tuple(round(c * shade) for c in look["roof"])
        draw.polygon([at(xa, y0, za), at(xb, y0, zb), at(xb, y1, zb), at(xa, y1, za)], fill=colour)
    draw.polygon([at(x1, y0), at(x1, y1), at(x1, y1, arc(n)[1]), at(x1, y0, arc(n)[1])], fill=look["side"])
    front = [at(x0, y1)] + [at(arc(k)[0], y1, arc(k)[1]) for k in range(n + 1)] + [at(x1, y1)]
    draw.polygon(front, fill=look["wall"])
    opening = [at(x0 + 4, y1)] + [at(arc(k, 4)[0], y1, arc(k, 4)[1]) for k in range(n + 1)] + [at(x1 - 4, y1)]
    draw.polygon(opening, fill=look["dark"])


def draw_plan(sprite_id):
    look = LOOKS[sprite_id]
    image = Image.new("RGB", (SIZE, SIZE), BACKDROP)
    draw = ImageDraw.Draw(image)
    c = CUT - HALF
    outline = [(-HALF, -c), (-c, -HALF), (c, -HALF), (HALF, -c), (HALF, c), (c, HALF), (-c, HALF), (-HALF, c)]
    # The slab, a little thick so that it reads as a made floor and not as a stain.
    draw.polygon([at(x, y, -2) for x, y in outline], fill=look["edge"])
    draw.polygon([at(x, y) for x, y in outline], fill=look["slab"])

    x0, y0, x1, y1 = RUNWAY
    draw.polygon([at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)], fill=look["runway"])
    mid = (y0 + y1) / 2
    for i in range(7):
        a = x0 + 10 + i * 17
        draw.polygon([at(a, mid - 1), at(a + 9, mid - 1), at(a + 9, mid + 1), at(a, mid + 1)], fill=look["line"])
    for x in (x0 + 3, x1 - 5):  # the bars across each end
        draw.polygon([at(x, y0 + 3), at(x + 2, y0 + 3), at(x + 2, y1 - 3), at(x, y1 - 3)], fill=look["line"])

    px, py, r = PAD

    ring = lambda k: [at(px + math.cos(a / 24 * math.pi) * r * k, py + math.sin(a / 24 * math.pi) * r * k) for a in range(48)]
    draw.polygon(ring(1), fill=look["line"])
    draw.polygon(ring(0.88), fill=look["pad"])
    # The H, lying on the ground and read from the camera: its uprights run up the screen.
    # Up the screen is toward (-1, -1) in the world, across it is toward (+1, -1).
    def stroke(a, b, w=1.6):
        (ax, ay), (bx, by) = a, b
        dx, dy = bx - ax, by - ay
        n = math.hypot(dx, dy)
        ox, oy = -dy / n * w, dx / n * w
        draw.polygon([at(px + ax + ox, py + ay + oy), at(px + bx + ox, py + by + oy), at(px + bx - ox, py + by - oy), at(px + ax - ox, py + ay - oy)], fill=look["line"])

    u, v = (-0.5, -0.5), (0.5, -0.5)  # up the screen, across the screen (halved: the ground is foreshortened)
    P = lambda s, t: (s * v[0] * 9 + t * u[0] * 18, s * v[1] * 9 + t * u[1] * 18)
    stroke(P(-1, -1), P(-1, 1))
    stroke(P(1, -1), P(1, 1))
    stroke(P(-1, 0), P(1, 0))

    # What stands up, far to near.
    tall = [(*h, HANGAR_HEIGHT, "hangar") for h in HANGARS] + [(*TOWER, look["tower"], "tower")]
    for x0, y0, x1, y1, h, what in sorted(tall, key=lambda t: t[2] + t[3]):
        if what == "tower":
            box(draw, x0, y0, x1, y1, h, look["roof"], look["wall"], look["side"])
            box(draw, x0 - 1, y0 - 1, x1 + 1, y1 + 1, 7, look["roof"], look["glass"], look["glass"], z=h)
        elif look["arch"]:
            vault(draw, x0, y0, x1, y1, h, look)
        else:
            box(draw, x0, y0, x1, y1, h, look["roof"], look["wall"], look["side"])
            # The open front, toward the apron.
            draw.polygon([at(x0 + 4, y1), at(x1 - 4, y1), at(x1 - 4, y1, h - 4), at(x0 + 4, y1, h - 4)], fill=look["dark"])
    return image


def main(out_dir, ids):
    out_dir = pathlib.Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    for sprite_id in ids or LOOKS:
        path = out_dir / f"{sprite_id}_plan.png"
        draw_plan(sprite_id).save(path)
        print(path)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
