#!/usr/bin/env python3
"""Writes the three maps into shared/rules.json.

    python3 tools/mapgen.py            # rewrite the "maps" block of shared/rules.json
    python3 tools/mapgen.py --show     # print each map as text and change nothing

A map is drawn here as shapes on its west half and mirrored west to east, so that
neither side starts better. Everything the game reads (terrain grid, points, bridges,
gushers, landmarks and their names) comes out of this file; nothing is edited by hand.
"""
import json
import math
import pathlib
import sys

CELL = 40  # one terrain cell, in map units
ROOT = pathlib.Path(__file__).resolve().parent.parent

CALLSIGNS = {
    "A": ("Alpha", "אלף"), "B": ("Bravo", "בועז"), "G": ("Golf", "גימל"), "D": ("Delta", "דוד"),
    "H": ("Hotel", "הגר"), "F": ("Foxtrot", "פסל"), "K": ("Kilo", "כרמל"), "S": ("Sierra", "סמך"),
    "Z": ("Zulu", "זאב"), "L": ("Lima", "לאה"), "M": ("Mike", "משה"), "N": ("November", "נשר"),
    "T": ("Tango", "תמר"), "Y": ("Yankee", "יואב"), "V": ("Victor", "ואו"),
}

# Compass bearings, clockwise from north, as (dx, dy) with y growing south.
BEARINGS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
VEC = {"N": (0, -1), "NE": (1, -1), "E": (1, 0), "SE": (1, 1), "S": (0, 1), "SW": (-1, 1), "W": (-1, 0), "NW": (-1, -1)}
MIRROR = {"N": "N", "S": "S", "E": "W", "W": "E", "NE": "NW", "NW": "NE", "SE": "SW", "SW": "SE"}
BEARING_EN = {"N": "north", "NE": "north-east", "E": "east", "SE": "south-east", "S": "south", "SW": "south-west", "W": "west", "NW": "north-west"}
BEARING_HE = {"N": "מצפון ל", "NE": "מצפון-מזרח ל", "E": "ממזרח ל", "SE": "מדרום-מזרח ל", "S": "מדרום ל", "SW": "מדרום-מערב ל", "W": "ממערב ל", "NW": "מצפון-מערב ל"}
# kind → (English, Hebrew with the article, Hebrew gender for ordinals)
KIND = {
    "house": ("house", "הבית", "m"), "bunker": ("bunker", "הבונקר", "m"), "ruin": ("ruin", "החורבה", "f"),
    "grove": ("grove", "החורשה", "f"), "rocks": ("rocks", "הסלעים", "p"), "wall": ("wall", "החומה", "f"),
}
ORDINAL_EN = ["", "second ", "third ", "fourth "]
ORDINAL_HE = {"m": ["", " השני", " השלישי", " הרביעי"], "f": ["", " השנייה", " השלישית", " הרביעית"], "p": ["", " השניים", " השלישיים", " הרביעיים"]}


# A home field feeds about one and a half haulers; a contested one is richer and farther.
HOME = {"ratePerSecond": 12, "fieldRadius": 90, "fieldCap": 1500, "startGold": 1000}
RICH = {"ratePerSecond": 18, "fieldRadius": 70, "fieldCap": 2400, "startGold": 1000}


class Map:
    def __init__(self, key, name, cols, rows):
        self.key, self.name, self.cols, self.rows = key, name, cols, rows
        self.w, self.h = cols * CELL, rows * CELL
        self.grid = [["L"] * cols for _ in range(rows)]
        self.points, self.bridges, self.marks, self.fields = [], [], [], []

    # ---- terrain ----
    def rect(self, x0, y0, x1, y1, kind):
        for r in range(self.rows):
            for c in range(self.cols):
                cx, cy = (c + 0.5) * CELL, (r + 0.5) * CELL
                if x0 <= cx < x1 and y0 <= cy < y1:
                    self.grid[r][c] = kind

    def mirror(self):
        for row in self.grid:
            for c in range(self.cols // 2):
                row[self.cols - 1 - c] = row[c]

    def at(self, x, y):
        c, r = int(x // CELL), int(y // CELL)
        return self.grid[r][c] if 0 <= c < self.cols and 0 <= r < self.rows else "M"

    # ---- things on the map ----
    def point(self, pid, kind, x, y, name, aliases, owner=-1):
        en, he = CALLSIGNS[pid]
        self.points.append({
            "id": pid, "kind": kind, "owner": owner, "x": x, "y": y,
            "callsign": {"en": en, "he": he}, "name": {"en": name[0], "he": name[1]},
            "aliases": [en.lower(), he] + aliases,
        })

    def pair(self, west, east, kind, x, y, name, aliases, owners=(-1, -1), east_name=None, east_aliases=None):
        self.point(west, kind, x, y, name, aliases, owners[0])
        self.point(east, kind, self.w - x, y, east_name or name, east_aliases if east_aliases is not None else aliases, owners[1])

    def bridge(self, bid, name, a, b, width=80, hp=900, mirrored=None):
        self.bridges.append({"id": bid, "name": {"en": name[0], "he": name[1]}, "from": list(a), "to": list(b), "width": width, "hp": hp})
        if mirrored:
            mid, mname = mirrored
            self.bridges.append({"id": mid, "name": {"en": mname[0], "he": mname[1]},
                                 "from": [self.w - a[0], a[1]], "to": [self.w - b[0], b[1]], "width": width, "hp": hp})

    def gusher(self, point, x=None, y=None, rich=False, east=None):
        """A gold gusher named after a point; by default it stands on the point. `rich` is
        a contested field in the middle of the map; `east` is the point its mirror image
        is named after."""
        p = next(q for q in self.points if q["id"] == point)
        x, y = (p["x"] if x is None else x), (p["y"] if y is None else y)
        size = RICH if rich else HOME
        self.fields.append({"id": point, "point": point, "x": x, "y": y, **size})
        if east:
            self.fields.append({"id": east, "point": east, "x": self.w - x, "y": y, **size})

    def mark(self, kind, x, y, both=True):
        """A landmark at (x, y); `both` also puts its mirror image on the east half."""
        self.marks.append((kind, x, y))
        if both and abs(x - self.w / 2) > 1:
            self.marks.append((kind, self.w - x, y))

    def around(self, pid, items, both=True):
        """Landmarks around a point: items are (kind, bearing, distance)."""
        p = next(q for q in self.points if q["id"] == pid)
        for kind, bearing, d in items:
            dx, dy = VEC[bearing]
            n = math.hypot(dx, dy)
            self.mark(kind, round(p["x"] + dx / n * d), round(p["y"] + dy / n * d), both)

    # ---- output ----
    def bridge_cells(self, b):
        """Terrain cells whose centre lies on the bridge deck."""
        (ax, ay), (bx, by) = b["from"], b["to"]
        out = []
        for r in range(self.rows):
            for c in range(self.cols):
                px, py = (c + 0.5) * CELL, (r + 0.5) * CELL
                t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)
                if 0 <= t <= 1 and math.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay)) <= b["width"] / 2:
                    out.append((c, r))
        return out

    def landmarks(self):
        seen, out, count = {}, [], {}
        on_bridge = {cell for b in self.bridges for cell in self.bridge_cells(b)}
        for kind, x, y in sorted(self.marks, key=lambda m: (m[2], m[1], m[0])):
            cell = (int(x // CELL), int(y // CELL))
            if self.at(x, y) != "L" or cell in on_bridge:
                continue  # a landmark stands on dry land only
            near = min(self.points, key=lambda p: (math.hypot(p["x"] - x, p["y"] - y), p["id"]))
            dx, dy = x - near["x"], y - near["y"]
            bearing = BEARINGS[round(math.atan2(dx, -dy) / (math.pi / 4)) % 8]
            n = seen.get((kind, bearing, near["id"]), 0)
            seen[(kind, bearing, near["id"])] = n + 1
            k = count.get((near["id"], kind), 0) + 1
            count[(near["id"], kind)] = k
            en, he, gender = KIND[kind]
            out.append({
                "id": f"{near['id']}-{kind}-{k}", "kind": kind, "x": x, "y": y, "near": near["id"], "bearing": bearing,
                "name": {
                    "en": f"the {ORDINAL_EN[n]}{en} {BEARING_EN[bearing]} of {near['callsign']['en']}",
                    "he": f"{he}{ORDINAL_HE[gender][n]} {BEARING_HE[bearing]}{near['callsign']['he']}",
                },
            })
        return out

    def check(self):
        g = self.grid
        for r in range(self.rows):
            assert g[r] == g[r][::-1], f"{self.key}: row {r} is not mirrored"
        kinds = {k for row in g for k in row}
        assert kinds == set("LWIM"), f"{self.key}: terrain kinds {kinds}"
        assert self.bridges, f"{self.key}: no bridge"
        deck = {cell for b in self.bridges for cell in self.bridge_cells(b)}
        for b in self.bridges:
            cells = self.bridge_cells(b)
            assert cells and all(g[r][c] == "W" for c, r in cells), f"{self.key}: bridge {b['id']} must span water only"

        def flood(start, ok):
            todo, seen = [start], {start}
            while todo:
                c, r = todo.pop()
                for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    n = (c + dc, r + dr)
                    if 0 <= n[0] < self.cols and 0 <= n[1] < self.rows and n not in seen and ok(n):
                        seen.add(n)
                        todo.append(n)
            return seen

        cell = lambda p: (int(p["x"] // CELL), int(p["y"] // CELL))
        ground = lambda n: g[n[1]][n[0]] in "LI" or n in deck
        water = lambda n: g[n[1]][n[0]] == "W"
        hq = [p for p in self.points if p["kind"] == "hq"]
        assert len(hq) == 2
        land = flood(cell(hq[0]), ground)
        for p in self.points:
            if p["kind"] == "seaRig":
                assert water(cell(p)), f"{self.key}: sea rig {p['id']} is not in water"
                # Boats of both sides must be able to reach it from the water nearest their base.
                sea = flood(cell(p), water)
                for h in hq:
                    best = min(((c, r) for r in range(self.rows) for c in range(self.cols) if g[r][c] == "W"),
                               key=lambda n: (math.hypot((n[0] + .5) * CELL - h["x"], (n[1] + .5) * CELL - h["y"]), n))
                    assert best in sea, f"{self.key}: boats from {h['id']} cannot reach {p['id']}"
            else:
                assert g[cell(p)[1]][cell(p)[0]] in "LI", f"{self.key}: point {p['id']} is not on ground"
                assert cell(p) in land, f"{self.key}: point {p['id']} cannot be reached on foot"
        ids = [p["id"] for p in self.points]
        assert len(ids) == len(set(ids))
        gids = [f["id"] for f in self.fields]
        assert len(gids) == len(set(gids)) and len(gids) >= 3, f"{self.key}: gushers {gids}"
        for f in self.fields:
            n = (int(f["x"] // CELL), int(f["y"] // CELL))
            assert g[n[1]][n[0]] == "L" and n in land, f"{self.key}: gusher {f['id']} is not on land a hauler can reach"
        # Every side has a field within a short hauler trip of its headquarters.
        for h in hq:
            near = min(math.hypot(f["x"] - h["x"], f["y"] - h["y"]) for f in self.fields)
            assert near <= 420, f"{self.key}: the nearest field to {h['id']} is {near:.0f} away"
        names = [m["name"]["en"] for m in self.landmarks()]
        assert len(names) == len(set(names)), f"{self.key}: two landmarks share a name"

    def data(self):
        self.check()
        return {
            "name": {"en": self.name[0], "he": self.name[1]},
            "width": self.w, "height": self.h, "cell": CELL,
            "terrain": ["".join(row) for row in self.grid],
            "points": self.points,
            "gushers": self.fields,
            "bridges": self.bridges,
            "landmarks": self.landmarks(),
        }

    def show(self):
        deck = {cell for b in self.bridges for cell in self.bridge_cells(b)}
        rows = [[{"L": ".", "W": "~", "I": "=", "M": "^"}[k] for k in row] for row in self.grid]
        for c, r in deck:
            rows[r][c] = "#"
        for m in self.landmarks():
            rows[int(m["y"] // CELL)][int(m["x"] // CELL)] = m["kind"][0]
        for p in self.points:
            rows[int(p["y"] // CELL)][int(p["x"] // CELL)] = p["id"]
        print(f"{self.key}: {self.name[0]}  {self.w}x{self.h}  {len(self.points)} points, {len(self.bridges)} bridges, {len(self.landmarks())} landmarks")
        print("\n".join("".join(row) for row in rows))


HQ_WEST = (("West HQ", "המפקדה המערבית"), ["west hq", "המפקדה המערבית"])
HQ_EAST = (("East HQ", "המפקדה המזרחית"), ["east hq", "המפקדה המזרחית"])


def hqs(m, x, y):
    m.pair("A", "Z", "hq", x, y, HQ_WEST[0], HQ_WEST[1], owners=(0, 1), east_name=HQ_EAST[0], east_aliases=HQ_EAST[1])


def small():
    m = Map("small", ("Twin Bridges", "שני הגשרים"), 40, 25)
    m.rect(0, 840, 1600, 1000, "W")          # the sea along the south
    m.rect(720, 0, 800, 840, "W")            # the river down the middle
    m.rect(640, 400, 800, 640, "W")          # it widens around the town island
    m.rect(720, 440, 800, 600, "L")          # the island
    m.rect(720, 160, 800, 320, "I")          # the frozen ford in the north
    m.rect(560, 0, 680, 120, "M")            # hills above the ford
    m.rect(280, 560, 360, 640, "M")          # the ridge
    m.mirror()
    hqs(m, 150, 480)
    m.pair("B", "K", "landRig", 450, 230, ("West field", "השדה המערבי"), ["the west field", "west field", "השדה המערבי"],
           east_name=("East field", "השדה המזרחי"), east_aliases=["the east field", "east field", "השדה המזרחי"])
    m.pair("D", "H", "point", 450, 690, ("Ridge", "הרכס"), ["the ridge", "ridge", "הרכס", "רכס"],
           east_name=("Farm", "החווה"), east_aliases=["the farm", "farm", "החווה", "חווה"])
    m.point("G", "point", 800, 240, ("Frozen ford", "המעבר הקפוא"), ["the frozen ford", "the ford", "ford", "המעבר הקפוא", "המעבר"])
    m.point("F", "point", 800, 520, ("Town", "העיירה"), ["the town", "town", "העיירה", "עיירה", "הכפר"])
    m.point("S", "seaRig", 800, 920, ("Sea rig", "האסדה הימית"), ["the sea rig", "sea rig", "האסדה הימית", "אסדה ימית"])
    m.bridge("bridge-west", ("the west bridge", "הגשר המערבי"), (640, 520), (720, 520),
             mirrored=("bridge-east", ("the east bridge", "הגשר המזרחי")))
    m.bridge("bridge-south", ("the south bridge", "הגשר הדרומי"), (720, 760), (880, 760))
    m.gusher("B", east="K")                  # a home field each
    m.gusher("F", rich=True)                 # and the rich one on the town island, across the bridges
    m.around("A", [("wall", "E", 100), ("grove", "N", 110)])
    m.around("B", [("rocks", "E", 62), ("ruin", "W", 58)])
    m.around("D", [("bunker", "N", 56), ("rocks", "E", 62), ("grove", "SW", 70)])
    m.around("F", [("house", "N", 50), ("house", "S", 54)])
    m.around("F", [("rocks", "NW", 62)])
    m.mark("grove", 300, 300)
    m.mark("house", 590, 520)                # the bridgehead houses
    m.mark("rocks", 600, 330)
    m.mark("wall", 640, 740)
    return m


def medium():
    m = Map("medium", ("Frozen River", "הנהר הקפוא"), 60, 38)
    m.rect(400, 0, 1040, 160, "M")           # the northern range, open at the pass
    m.rect(0, 1280, 2400, 1520, "W")         # the sea
    m.rect(1120, 160, 1200, 1280, "W")       # the river
    m.rect(1120, 240, 1200, 600, "I")        # its frozen stretch
    m.rect(1160, 360, 1200, 440, "L")        # the islet in the ice
    m.rect(1000, 640, 1200, 920, "W")        # the river widens around the town island
    m.rect(1120, 680, 1200, 880, "L")        # the island
    m.rect(640, 480, 760, 640, "M")          # the inner hills
    m.rect(280, 1040, 400, 1120, "I")        # a frozen pond
    m.mirror()
    hqs(m, 160, 760)
    m.pair("B", "K", "landRig", 520, 300, ("West field", "השדה המערבי"), ["the west field", "west field", "השדה המערבי"],
           east_name=("East field", "השדה המזרחי"), east_aliases=["the east field", "east field", "השדה המזרחי"])
    m.pair("D", "H", "point", 560, 1100, ("Ridge", "הרכס"), ["the ridge", "ridge", "הרכס", "רכס"],
           east_name=("Farm", "החווה"), east_aliases=["the farm", "farm", "החווה", "חווה"])
    m.pair("L", "M", "point", 880, 780, ("West village", "הכפר המערבי"), ["the west village", "west village", "הכפר המערבי"],
           east_name=("East village", "הכפר המזרחי"), east_aliases=["the east village", "east village", "הכפר המזרחי"])
    m.point("N", "point", 1200, 80, ("Pass", "המעבר"), ["the pass", "pass", "המעבר"])
    m.point("G", "point", 1200, 400, ("Islet", "האי הקטן"), ["the islet", "islet", "האי הקטן"])
    m.point("F", "point", 1200, 780, ("Town", "העיירה"), ["the town", "town", "העיירה", "עיירה"])
    m.point("S", "seaRig", 1200, 1400, ("Sea rig", "האסדה הימית"), ["the sea rig", "sea rig", "האסדה הימית", "אסדה ימית"])
    m.bridge("bridge-west", ("the west bridge", "הגשר המערבי"), (1000, 780), (1120, 780),
             mirrored=("bridge-east", ("the east bridge", "הגשר המזרחי")))
    m.bridge("bridge-south", ("the south bridge", "הגשר הדרומי"), (1120, 1120), (1280, 1120))
    m.gusher("A", 440, 640, east="Z")        # a home field close to each headquarters
    m.gusher("B", east="K")                  # the fields up north
    m.gusher("F", rich=True)                 # the rich one on the town island
    m.around("A", [("wall", "E", 100), ("grove", "N", 110), ("rocks", "S", 110)])
    m.around("B", [("rocks", "E", 62), ("ruin", "W", 58), ("grove", "S", 90)])
    m.around("D", [("bunker", "N", 56), ("rocks", "E", 62), ("grove", "W", 70)])
    m.around("L", [("house", "N", 54), ("house", "S", 54), ("wall", "E", 64), ("grove", "W", 80)])
    m.around("N", [("rocks", "W", 62), ("bunker", "S", 56)])
    m.around("F", [("house", "N", 56), ("house", "S", 56), ("rocks", "NW", 64)])
    m.mark("grove", 360, 520)
    m.mark("rocks", 960, 1000)
    m.mark("house", 960, 1180)
    m.mark("ruin", 900, 300)
    return m


def large():
    m = Map("large", ("Mountain Passes", "מעברי ההרים"), 80, 50)
    m.rect(1440, 0, 1600, 1400, "M")         # the central range
    m.rect(1440, 120, 1600, 320, "L")        # north pass
    m.rect(1440, 520, 1600, 720, "L")        # middle pass
    m.rect(1440, 920, 1600, 1200, "L")       # the wide pass with the town
    m.rect(0, 1400, 1600, 1520, "W")         # the river
    m.rect(1200, 1400, 1600, 1840, "W")      # the lake
    m.rect(800, 520, 920, 720, "M")          # western hills
    m.rect(800, 280, 1000, 440, "I")         # a frozen pond on the way to the fort
    m.rect(0, 0, 320, 120, "M")
    m.mirror()
    hqs(m, 200, 1000)
    m.pair("B", "K", "landRig", 640, 480, ("North-west field", "השדה הצפון-מערבי"), ["the north-west field", "north-west field", "השדה הצפון-מערבי"],
           east_name=("North-east field", "השדה הצפון-מזרחי"), east_aliases=["the north-east field", "north-east field", "השדה הצפון-מזרחי"])
    m.pair("D", "H", "landRig", 600, 1720, ("South-west field", "השדה הדרום-מערבי"), ["the south-west field", "south-west field", "השדה הדרום-מערבי"],
           east_name=("South-east field", "השדה הדרום-מזרחי"), east_aliases=["the south-east field", "south-east field", "השדה הדרום-מזרחי"])
    m.pair("L", "M", "point", 1080, 1060, ("West village", "הכפר המערבי"), ["the west village", "west village", "הכפר המערבי"],
           east_name=("East village", "הכפר המזרחי"), east_aliases=["the east village", "east village", "הכפר המזרחי"])
    m.pair("T", "Y", "point", 1100, 320, ("West fort", "המבצר המערבי"), ["the west fort", "west fort", "המבצר המערבי"],
           east_name=("East fort", "המבצר המזרחי"), east_aliases=["the east fort", "east fort", "המבצר המזרחי"])
    m.point("N", "point", 1600, 220, ("North pass", "המעבר הצפוני"), ["the north pass", "north pass", "המעבר הצפוני"])
    m.point("G", "point", 1600, 620, ("Middle pass", "המעבר האמצעי"), ["the middle pass", "middle pass", "המעבר האמצעי"])
    m.point("F", "point", 1600, 1060, ("Town", "העיירה"), ["the town", "town", "העיירה", "עיירה"])
    m.point("V", "point", 1600, 1920, ("South shore", "החוף הדרומי"), ["the south shore", "south shore", "החוף הדרומי"])
    m.point("S", "seaRig", 1600, 1640, ("Lake rig", "אסדת האגם"), ["the lake rig", "lake rig", "the sea rig", "sea rig", "אסדת האגם", "האסדה הימית"])
    m.bridge("bridge-far-west", ("the far west bridge", "הגשר המערבי הרחוק"), (400, 1400), (400, 1520),
             mirrored=("bridge-far-east", ("the far east bridge", "הגשר המזרחי הרחוק")))
    m.bridge("bridge-west", ("the west bridge", "הגשר המערבי"), (1080, 1400), (1080, 1520),
             mirrored=("bridge-east", ("the east bridge", "הגשר המזרחי")))
    m.gusher("A", 500, 880, east="Z")        # a home field close to each headquarters
    m.gusher("B", east="K")
    m.gusher("D", east="H")                  # across the river
    m.gusher("F", rich=True)                 # the rich ones in the passes
    m.gusher("G", rich=True)
    m.around("A", [("wall", "E", 100), ("grove", "N", 110), ("rocks", "S", 110)])
    m.around("B", [("rocks", "E", 62), ("ruin", "W", 58), ("grove", "S", 90)])
    m.around("D", [("rocks", "N", 62), ("ruin", "E", 58), ("grove", "W", 80)])
    m.around("L", [("house", "N", 54), ("house", "S", 54), ("wall", "E", 64), ("grove", "W", 80)])
    m.around("T", [("bunker", "N", 56), ("wall", "E", 62), ("rocks", "S", 64)])
    m.around("N", [("rocks", "N", 44), ("rocks", "S", 44)])
    m.around("G", [("bunker", "N", 46), ("rocks", "S", 46)])
    m.around("F", [("house", "N", 56), ("house", "S", 56), ("rocks", "NW", 64), ("house", "SW", 80)])
    m.around("V", [("house", "N", 54), ("grove", "W", 70)])
    m.mark("grove", 400, 700)
    m.mark("rocks", 1280, 760)
    m.mark("house", 420, 1300)
    m.mark("wall", 1080, 1330)
    m.mark("grove", 1000, 1620)
    m.mark("ruin", 1300, 1920)
    return m


def write(maps):
    """Replaces the "maps" value in rules.json, keeping the rest of the file as written."""
    path = ROOT / "shared" / "rules.json"
    text = path.read_text(encoding="utf-8")
    one = lambda v: json.dumps(v, ensure_ascii=False)
    blocks = []
    for key, d in maps.items():
        lines = [f'    "{key}": {{', f'      "name": {one(d["name"])},',
                 f'      "width": {d["width"]}, "height": {d["height"]}, "cell": {d["cell"]},', '      "terrain": [']
        lines += [f'        "{row}"' + ("," if i < len(d["terrain"]) - 1 else "") for i, row in enumerate(d["terrain"])]
        lines.append("      ],")
        for field in ("points", "gushers", "bridges", "landmarks"):
            lines.append(f'      "{field}": [')
            lines += [f"        {one(item)}" + ("," if i < len(d[field]) - 1 else "") for i, item in enumerate(d[field])]
            lines.append("      ]" + ("," if field != "landmarks" else ""))
        lines.append("    }")
        blocks.append("\n".join(lines))
    block = '"maps": {\n' + ",\n".join(blocks) + "\n  }"
    start = text.index('"maps": {')
    depth, i = 0, text.index("{", start)
    while True:
        depth += {"{": 1, "}": -1}.get(text[i], 0)
        i += 1
        if depth == 0:
            break
    path.write_text(text[:start] + block + text[i:], encoding="utf-8")


if __name__ == "__main__":
    built = [small(), medium(), large()]
    if "--show" in sys.argv:
        for m in built:
            m.check()
            m.show()
    else:
        write({m.key: m.data() for m in built})
        print("wrote", ", ".join(f"{m.key} ({len(m.points)} points, {len(m.landmarks())} landmarks)" for m in built))
