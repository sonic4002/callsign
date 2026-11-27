#!/usr/bin/env python3
"""Writes the four maps into shared/rules.json.

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
    "Q": ("Quebec", "קורח"), "C": ("Charlie", "צפורה"), "O": ("Oscar", "עין"), "E": ("Echo", "חוה"),
    "W": ("Whiskey", "שמיר"), "X": ("X-ray", "טיח"),
}
# Other ways a callsign gets written, which name the point as well.
SPELLINGS = {"X": ["xray", "x ray"]}

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
# Tech buildings: kind → (short id, English, Hebrew with the article). They belong to no
# army; an engineer squad takes one for its side (see "techBuildings" in the rules).
TECH = {
    "tech_goldworks": ("assay", "assay office", "בית הבוחן"),
    "tech_clinic": ("clinic", "clinic", "המרפאה"),
    "tech_garage": ("garage", "service yard", "המוסך"),
}
ORDINAL_EN = ["", "second ", "third ", "fourth "]
ORDINAL_HE = {"m": ["", " השני", " השלישי", " הרביעי"], "f": ["", " השנייה", " השלישית", " הרביעית"], "p": ["", " השניים", " השלישיים", " הרביעיים"]}


# A home field feeds about one and a half haulers; a contested one is richer and farther;
# a poor one lies on a side's own ground, out of the way, and pays less.
HOME = {"ratePerSecond": 12, "fieldRadius": 90, "fieldCap": 1500, "startGold": 1000}
RICH = {"ratePerSecond": 18, "fieldRadius": 70, "fieldCap": 2400, "startGold": 1000}
POOR = {"ratePerSecond": 8, "fieldRadius": 70, "fieldCap": 1000, "startGold": 600}

# How far a commander's words reach. "N900 E900 of F" is the longest offset the game
# reads (server/sim/place.go), so every spot of a map must be that near a point; and a
# described place ("the grove east of Foxtrot") should never be a long walk from where
# it is wanted, so every piece of ground has something with a name this near.
SPOT_REACH = 900
NAME_REACH = 560

# The base layout around a western headquarters (baseSlots in server/sim/structures.go),
# the room the widest base structure needs at each place, and the farthest a dockyard's
# shore may be from the headquarters.
BASE_SLOTS = [(-60, -170), (-60, 170), (80, -280), (80, 280), (-60, -330), (-60, 330), (-190, -90), (-190, 90), (200, -160), (200, 160)]
BASE_ROOM = 54
DOCK_REACH = 460


class Map:
    def __init__(self, key, name, cols, rows, minutes=10, pace=1):
        self.key, self.name, self.cols, self.rows, self.minutes, self.pace = key, name, cols, rows, minutes, pace
        self.w, self.h = cols * CELL, rows * CELL
        self.grid = [["L"] * cols for _ in range(rows)]
        self.points, self.bridges, self.marks, self.fields = [], [], [], []
        self.techs = []

    # ---- terrain ----
    def rect(self, x0, y0, x1, y1, kind):
        for r in range(self.rows):
            for c in range(self.cols):
                cx, cy = (c + 0.5) * CELL, (r + 0.5) * CELL
                if x0 <= cx < x1 and y0 <= cy < y1:
                    self.grid[r][c] = kind

    def cells(self, c0, r0, c1, r1, kind):
        """A rectangle in whole cells: columns c0 up to c1 and rows r0 up to r1, c1 and r1 not included."""
        self.rect(c0 * CELL, r0 * CELL, c1 * CELL, r1 * CELL, kind)

    def oval(self, x, y, rx, ry, kind):
        for r in range(self.rows):
            for c in range(self.cols):
                cx, cy = (c + 0.5) * CELL, (r + 0.5) * CELL
                if ((cx - x) / rx) ** 2 + ((cy - y) / ry) ** 2 <= 1:
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
            "aliases": [en.lower(), he] + SPELLINGS.get(pid, []) + aliases,
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

    def gusher(self, point, x=None, y=None, rich=False, poor=False, east=None):
        """A gold gusher named after a point; by default it stands on the point. `rich` is
        a contested field in the middle of the map, `poor` a small one out of the way;
        `east` is the point its mirror image is named after."""
        p = next(q for q in self.points if q["id"] == point)
        x, y = (p["x"] if x is None else x), (p["y"] if y is None else y)
        size = RICH if rich else POOR if poor else HOME
        self.fields.append({"id": point, "point": point, "x": x, "y": y, **size})
        if east:
            self.fields.append({"id": east, "point": east, "x": self.w - x, "y": y, **size})

    def mark(self, kind, x, y, both=True):
        """A landmark at (x, y); `both` also puts its mirror image on the east half."""
        self.marks.append((kind, x, y))
        if both and abs(x - self.w / 2) > 1:
            self.marks.append((kind, self.w - x, y))

    def tech(self, kind, x, y):
        """A tech building at (x, y) and its mirror image on the east half, so that each
        side has one as near as the other's; one on the centre line stands alone."""
        self.techs.append((kind, x, y))
        if abs(x - self.w / 2) > 1:
            self.techs.append((kind, self.w - x, y))

    def tech_sites(self):
        out = []
        for kind, x, y in sorted(self.techs, key=lambda t: (t[2], t[1], t[0])):
            near = min(self.points, key=lambda p: (math.hypot(p["x"] - x, p["y"] - y), p["id"]))
            dx, dy = x - near["x"], y - near["y"]
            bearing = BEARINGS[round(math.atan2(dx, -dy) / (math.pi / 4)) % 8]
            short, en, he = TECH[kind]
            out.append({
                "id": f"tech-{short}-{'w' if x < self.w / 2 else 'e' if x > self.w / 2 else 'c'}", "kind": kind, "x": x, "y": y, "near": near["id"], "bearing": bearing,
                "name": {"en": f"the {en} {BEARING_EN[bearing]} of {near['callsign']['en']}",
                         "he": f"{he} {BEARING_HE[bearing]}{near['callsign']['he']}"},
            })
        return out

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
        # Tech buildings: on land both sides can walk to, clear of everything else, never
        # in a base, and each as far from one headquarters as its twin is from the other.
        sites = self.tech_sites()
        assert 2 <= len(sites) <= 6, f"{self.key}: {len(sites)} tech buildings"
        assert len({t["id"] for t in sites}) == len(sites), f"{self.key}: two tech buildings share an id"
        for t in sites:
            n = (int(t["x"] // CELL), int(t["y"] // CELL))
            assert g[n[1]][n[0]] == "L" and n in land and n not in deck, f"{self.key}: {t['id']} is not on land that can be reached"
            for p in self.points:
                room = 300 if p["kind"] == "hq" else 85
                assert math.hypot(p["x"] - t["x"], p["y"] - t["y"]) >= room, f"{self.key}: {t['id']} crowds point {p['id']}"
            for f in self.fields:
                assert math.hypot(f["x"] - t["x"], f["y"] - t["y"]) >= f["fieldRadius"] + 60, f"{self.key}: {t['id']} stands in the {f['id']} gold field"
            for m in self.landmarks():
                assert math.hypot(m["x"] - t["x"], m["y"] - t["y"]) >= 70, f"{self.key}: {t['id']} crowds {m['id']}"
            for b in self.bridges:
                for end in (b["from"], b["to"]):
                    assert math.hypot(end[0] - t["x"], end[1] - t["y"]) >= 90, f"{self.key}: {t['id']} blocks {b['id']}"
            for o in sites:
                assert o is t or math.hypot(o["x"] - t["x"], o["y"] - t["y"]) >= 130, f"{self.key}: {t['id']} crowds {o['id']}"
            twin = [o for o in sites if o["kind"] == t["kind"] and abs(o["x"] - (self.w - t["x"])) < 1 and o["y"] == t["y"]]
            assert twin, f"{self.key}: {t['id']} has no mirror image"
        # A base is laid out the same on both sides whatever the faction builds: every
        # place of the layout (baseSlots in server/sim/structures.go) is open land with
        # room for the widest base structure, and the shore a dockyard goes to (the land
        # with water beside it nearest a spot just inside the headquarters) is one cell,
        # not a tie that the two sides would break differently.
        marks = self.landmarks()
        for h in hq:
            inward = 1 if h["x"] < self.w / 2 else -1
            for ox, oy in BASE_SLOTS:
                x, y = h["x"] + inward * ox, h["y"] + oy
                where = f"{self.key}: the base place {ox},{oy} of {h['id']}"
                for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
                    qx, qy = x + dx * BASE_ROOM, y + dy * BASE_ROOM
                    assert 20 <= qx <= self.w - 20 and 20 <= qy <= self.h - 20 and self.at(qx, qy) == "L", f"{where} is not open land"
                for m in marks:
                    assert math.hypot(m["x"] - x, m["y"] - y) >= BASE_ROOM + 34, f"{where} is crowded by {m['id']}"
                for f in self.fields:
                    assert math.hypot(f["x"] - x, f["y"] - y) >= BASE_ROOM + f["fieldRadius"] + 10, f"{where} is in the {f['id']} gold field"
                for p in self.points:
                    assert math.hypot(p["x"] - x, p["y"] - y) >= BASE_ROOM + 70, f"{where} is in the ring of {p['id']}"
            sx, sy = h["x"] + inward * 60, h["y"]
            shore = sorted(math.hypot((c + .5) * CELL - sx, (r + .5) * CELL - sy)
                           for r in range(self.rows) for c in range(self.cols)
                           if g[r][c] == "L" and any(0 <= c + dc < self.cols and 0 <= r + dr < self.rows and g[r + dr][c + dc] == "W"
                                                     for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1))))
            assert shore[1] - shore[0] > 1, f"{self.key}: two shores are equally near {h['id']}"
            assert shore[0] <= DOCK_REACH, f"{self.key}: the shore is {shore[0]:.0f} from {h['id']}"
        # More than one way across: with every bridge down the headquarters still reach
        # each other (over ice or through a pass), and with the ice gone they still do.
        assert cell(hq[1]) in flood(cell(hq[0]), lambda n: g[n[1]][n[0]] in "LI"), f"{self.key}: the bridges are the only way across"
        assert cell(hq[1]) in flood(cell(hq[0]), lambda n: g[n[1]][n[0]] == "L" or n in deck), f"{self.key}: the ice is the only way across"
        # Everything can be named on the radio: every spot is within an exact offset of a
        # point, and every piece of ground has a point, landmark, bridge or tech building near it.
        named = [(p["x"], p["y"]) for p in self.points] + [(m["x"], m["y"]) for m in self.landmarks()] + [(t["x"], t["y"]) for t in sites]
        named += [((b["from"][0] + b["to"][0]) / 2, (b["from"][1] + b["to"][1]) / 2) for b in self.bridges]
        far = []
        for r in range(self.rows):
            for c in range(self.cols):
                x, y = (c + 0.5) * CELL, (r + 0.5) * CELL
                assert any(abs(p["x"] - x) <= SPOT_REACH and abs(p["y"] - y) <= SPOT_REACH for p in self.points), \
                    f"{self.key}: nothing can name the spot {x:.0f},{y:.0f}: no point within {SPOT_REACH} each way"
                if g[r][c] in "LI" and min(math.hypot(nx - x, ny - y) for nx, ny in named) > NAME_REACH:
                    far.append((int(x), int(y)))
        assert not far, f"{self.key}: ground with nothing named within {NAME_REACH}: {far[:12]} ({len(far)} cells)"

    def data(self):
        self.check()
        return {
            "name": {"en": self.name[0], "he": self.name[1]},
            "width": self.w, "height": self.h, "cell": CELL, "lengthSeconds": self.minutes * 60, "pace": self.pace,
            "terrain": ["".join(row) for row in self.grid],
            "points": self.points,
            "gushers": self.fields,
            "bridges": self.bridges,
            "landmarks": self.landmarks(),
            "techBuildings": self.tech_sites(),
        }

    def show(self):
        deck = {cell for b in self.bridges for cell in self.bridge_cells(b)}
        rows = [[{"L": ".", "W": "~", "I": "=", "M": "^"}[k] for k in row] for row in self.grid]
        for c, r in deck:
            rows[r][c] = "#"
        for m in self.landmarks():
            rows[int(m["y"] // CELL)][int(m["x"] // CELL)] = m["kind"][0]
        for t in self.tech_sites():
            rows[int(t["y"] // CELL)][int(t["x"] // CELL)] = "+"
        for f in self.fields:
            rows[int(f["y"] // CELL)][int(f["x"] // CELL)] = "$"
        for p in self.points:
            rows[int(p["y"] // CELL)][int(p["x"] // CELL)] = p["id"]
        print(f"{self.key}: {self.name[0]}  {self.w}x{self.h}  {len(self.points)} points, {len(self.fields)} gushers, {len(self.bridges)} bridges, "
              f"{len(self.landmarks())} landmarks, {len(self.tech_sites())} tech buildings")
        print("  . land  ~ water  = ice  ^ mountain  # bridge  A-Z point  $ gusher away from its point  + tech building  small letter: landmark")
        print("\n".join("".join(row) for row in rows))


HQ_WEST = (("West HQ", "המפקדה המערבית"), ["west hq", "המפקדה המערבית"])
HQ_EAST = (("East HQ", "המפקדה המזרחית"), ["east hq", "המפקדה המזרחית"])


def hqs(m, x, y):
    m.pair("A", "Z", "hq", x, y, HQ_WEST[0], HQ_WEST[1], owners=(0, 1), east_name=HQ_EAST[0], east_aliases=HQ_EAST[1])


def small():
    """Twin Bridges: a river down the middle and the sea along the south. Three ways
    across: the frozen ford in the north (slow, and no cover on the ice), the two
    bridges through the town island in the middle, and the long south bridge by the
    coast. Boats come round by the sea and up the river."""
    m = Map("small", ("Twin Bridges", "שני הגשרים"), 70, 44, minutes=15, pace=1.3)
    m.cells(0, 38, 35, 44, "W")              # the sea along the south
    m.oval(280, 1580, 280, 200, "W")         # a cove below each base, for its dockyard
    m.cells(33, 0, 35, 38, "W")              # the river down the middle
    m.cells(29, 17, 35, 28, "W")             # it widens around the town island
    m.cells(32, 18, 35, 27, "L")             # the island
    m.cells(33, 5, 35, 12, "I")              # the frozen ford in the north
    m.oval(1100, 20, 190, 120, "M")          # hills above the ford
    m.oval(1080, 590, 110, 80, "M")          # and below it: the way to the ford runs between them
    m.oval(720, 1160, 110, 70, "M")          # the ridge between a base and the south bridge
    m.oval(0, 0, 300, 150, "M")              # the corner hills
    m.oval(400, 420, 100, 70, "I")           # a frozen pond
    m.oval(1020, 1540, 170, 70, "W")         # a bight in the coast
    m.mirror()
    hqs(m, 280, 960)
    m.pair("B", "K", "landRig", 620, 720, ("West field", "השדה המערבי"), ["the west field", "west field", "השדה המערבי"],
           east_name=("East field", "השדה המזרחי"), east_aliases=["the east field", "east field", "השדה המזרחי"])
    m.pair("D", "H", "point", 900, 1300, ("Ridge", "הרכס"), ["the ridge", "ridge", "הרכס", "רכס"],
           east_name=("Farm", "החווה"), east_aliases=["the farm", "farm", "החווה", "חווה"])
    m.pair("T", "N", "point", 720, 280, ("West quarry", "המחצבה המערבית"), ["the west quarry", "west quarry", "המחצבה המערבית"],
           east_name=("East quarry", "המחצבה המזרחית"), east_aliases=["the east quarry", "east quarry", "המחצבה המזרחית"])
    m.point("G", "point", 1400, 340, ("Frozen ford", "המעבר הקפוא"), ["the frozen ford", "the ford", "ford", "המעבר הקפוא", "המעבר"])
    m.point("F", "point", 1400, 900, ("Town", "העיירה"), ["the town", "town", "העיירה", "עיירה", "הכפר"])
    m.point("S", "seaRig", 1400, 1640, ("Sea rig", "האסדה הימית"), ["the sea rig", "sea rig", "האסדה הימית", "אסדה ימית"])
    m.bridge("bridge-west", ("the west bridge", "הגשר המערבי"), (1160, 920), (1280, 920),
             mirrored=("bridge-east", ("the east bridge", "הגשר המזרחי")))
    m.bridge("bridge-south", ("the south bridge", "הגשר הדרומי"), (1320, 1360), (1480, 1360))
    m.gusher("B", east="K")                  # a home field each
    m.gusher("D", poor=True, east="H")       # a small one on the coast road, each side's own
    m.gusher("F", rich=True)                 # and the rich one on the town island, across the bridges
    m.around("A", [("wall", "E", 100), ("grove", "N", 100), ("rocks", "S", 100)])
    m.around("B", [("rocks", "E", 62), ("ruin", "W", 58)])
    m.around("D", [("bunker", "N", 56), ("rocks", "E", 62), ("grove", "SW", 70)])
    m.around("T", [("ruin", "N", 56), ("rocks", "S", 60), ("grove", "E", 76)])
    m.around("F", [("house", "N", 56), ("house", "S", 120), ("rocks", "NW", 130)])
    m.mark("house", 1090, 920)               # the bridgehead houses
    m.mark("house", 1040, 1010)
    m.mark("grove", 420, 500)                # woods north of each base
    m.mark("grove", 330, 420)
    m.mark("ruin", 300, 240)
    m.mark("ruin", 130, 700)
    m.mark("rocks", 900, 880)                # on the open road to the bridge
    m.mark("grove", 960, 620)
    m.mark("ruin", 1020, 400)                # the approach to the ford
    m.mark("bunker", 1240, 480)
    m.mark("rocks", 1190, 660)
    m.mark("ruin", 1060, 1180)
    m.mark("wall", 1250, 1290)               # the south bridgehead
    m.mark("house", 1130, 1420)
    m.mark("rocks", 780, 1460)
    m.mark("rocks", 560, 1300)
    m.tech("tech_goldworks", 1200, 320)      # on each bank above the frozen ford
    m.tech("tech_clinic", 620, 1370)         # on the coast behind each ridge
    return m


def medium():
    """Frozen Lake: two rivers run out of a frozen lake in the north to the sea in the
    south, with open country between them. Three ways across each river: over the lake
    ice round its head, the north bridge to the quarry, and the main bridge on the road
    to the town. Boats sail the sea and both rivers as far as the ice."""
    m = Map("medium", ("Frozen Lake", "האגם הקפוא"), 100, 62, minutes=20, pace=1.6)
    m.cells(26, 0, 50, 2, "M")               # the northern range, behind the lake
    m.oval(1000, 0, 260, 110, "M")           # and its shoulders
    m.oval(0, 0, 280, 170, "M")              # the corner hills
    m.oval(2000, 360, 900, 250, "I")         # the frozen lake below it
    m.oval(2000, 360, 130, 90, "L")          # the islet in the ice
    m.cells(32, 12, 35, 27, "W")             # the west river, out of the lake
    m.cells(31, 27, 34, 29, "W")             # bends west
    m.cells(30, 29, 33, 31, "W")
    m.cells(29, 31, 32, 48, "W")             # and runs down to the sea
    m.cells(27, 48, 34, 54, "W")             # its mouth
    m.cells(0, 54, 50, 62, "W")              # the sea
    m.oval(240, 2180, 420, 280, "W")         # a bay below each base, for its dockyard
    m.oval(2000, 1010, 190, 130, "M")        # the massif in the middle of the open country
    m.oval(800, 560, 90, 150, "M")           # the heights that shelter the north field
    m.oval(830, 760, 70, 110, "M")
    m.oval(880, 1140, 100, 110, "M")         # the spur above the main road
    m.oval(300, 960, 100, 70, "I")          # a frozen pond
    m.oval(1700, 2180, 150, 90, "W")         # a bight in the south shore
    m.mirror()
    hqs(m, 360, 1480)
    m.pair("B", "K", "landRig", 460, 760, ("North-west field", "השדה הצפון-מערבי"), ["the north-west field", "north-west field", "השדה הצפון-מערבי"],
           east_name=("North-east field", "השדה הצפון-מזרחי"), east_aliases=["the north-east field", "north-east field", "השדה הצפון-מזרחי"])
    m.pair("D", "H", "point", 860, 1900, ("West farm", "החווה המערבית"), ["the west farm", "west farm", "החווה המערבית"],
           east_name=("East farm", "החווה המזרחית"), east_aliases=["the east farm", "east farm", "החווה המזרחית"])
    m.pair("L", "M", "point", 940, 1480, ("West village", "הכפר המערבי"), ["the west village", "west village", "הכפר המערבי"],
           east_name=("East village", "הכפר המזרחי"), east_aliases=["the east village", "east village", "הכפר המזרחי"])
    m.pair("T", "Y", "point", 1000, 380, ("West fort", "המבצר המערבי"), ["the west fort", "west fort", "המבצר המערבי"],
           east_name=("East fort", "המבצר המזרחי"), east_aliases=["the east fort", "east fort", "המבצר המזרחי"])
    m.point("N", "point", 2000, 360, ("Islet", "האי הקטן"), ["the islet", "islet", "האי הקטן"])
    m.point("G", "point", 2000, 760, ("Quarry", "המחצבה"), ["the quarry", "quarry", "המחצבה", "מחצבה"])
    m.point("F", "point", 2000, 1480, ("Town", "העיירה"), ["the town", "town", "העיירה", "עיירה"])
    m.point("V", "point", 2000, 1960, ("South shore", "החוף הדרומי"), ["the south shore", "south shore", "החוף הדרומי"])
    m.point("S", "seaRig", 2000, 2320, ("Sea rig", "האסדה הימית"), ["the sea rig", "sea rig", "האסדה הימית", "אסדה ימית"])
    m.bridge("bridge-north-west", ("the north-west bridge", "הגשר הצפון-מערבי"), (1280, 800), (1400, 800),
             mirrored=("bridge-north-east", ("the north-east bridge", "הגשר הצפון-מזרחי")))
    m.bridge("bridge-west", ("the west bridge", "הגשר המערבי"), (1160, 1480), (1280, 1480),
             mirrored=("bridge-east", ("the east bridge", "הגשר המזרחי")))
    m.gusher("A", 700, 1250, east="Z")       # a home field close to each headquarters
    m.gusher("B", east="K")                  # the fields up north, behind the heights
    m.gusher("D", poor=True, east="H")       # a small one on the coast
    m.gusher("G", rich=True)                 # the rich ones between the rivers
    m.gusher("F", rich=True)
    m.around("A", [("wall", "E", 100), ("grove", "N", 100), ("rocks", "S", 100)])
    m.around("B", [("rocks", "E", 62), ("ruin", "W", 58), ("grove", "S", 90)])
    m.around("D", [("bunker", "N", 56), ("rocks", "E", 62), ("grove", "W", 70)])
    m.around("L", [("house", "N", 54), ("house", "S", 54), ("wall", "E", 64), ("grove", "W", 80)])
    m.around("T", [("bunker", "N", 56), ("wall", "E", 62), ("rocks", "S", 64)])
    m.around("N", [("rocks", "W", 60)])
    m.around("G", [("rocks", "NW", 64), ("ruin", "N", 60)])
    m.around("F", [("house", "N", 56), ("house", "S", 56), ("rocks", "NW", 64), ("house", "SW", 80)])
    m.around("V", [("house", "N", 54), ("grove", "W", 70)])
    m.mark("grove", 300, 420)                # the north-west woods
    m.mark("grove", 230, 520)
    m.mark("ruin", 640, 260)
    m.mark("rocks", 130, 1160)
    m.mark("grove", 560, 1090)
    m.mark("ruin", 1100, 980)
    m.mark("grove", 1160, 1120)
    m.mark("rocks", 1040, 1300)              # the west bridgehead
    m.mark("house", 1060, 1570)
    m.mark("wall", 1190, 880)                # the north bridgehead
    m.mark("house", 1180, 700)
    m.mark("house", 700, 1650)
    m.mark("grove", 540, 1740)
    m.mark("rocks", 1500, 620)               # the open country between the rivers
    m.mark("house", 1520, 860)
    m.mark("grove", 1600, 1060)
    m.mark("grove", 1690, 1130)
    m.mark("rocks", 1720, 1620)
    m.mark("ruin", 1620, 1840)
    m.mark("grove", 1480, 2040)
    m.mark("wall", 1420, 1400)
    m.mark("bunker", 1760, 760)
    m.tech("tech_goldworks", 1120, 640)      # between each fort and its north bridge
    m.tech("tech_clinic", 1640, 1320)        # in the open country, short of the town
    m.tech("tech_garage", 1000, 1960)        # on the coast by each river mouth
    return m


def large():
    """Mountain Passes: a range down the middle and a river with a lake across the south.
    Four ways through: over the glacier round the north end of the range, the narrow
    middle pass, the wide gap with the town and the point south of it, and over the river
    bridges and round the south shore of the lake. Boats sail the river and the lake from one base to the other."""
    m = Map("large", ("Mountain Passes", "מעברי ההרים"), 130, 80, minutes=25, pace=2)
    m.cells(61, 0, 65, 57, "M")              # the central range
    for y, rx, ry in ((440, 230, 200), (700, 190, 150), (1260, 240, 190), (1470, 200, 140), (2060, 230, 150), (2200, 170, 100)):
        m.oval(2600, y, rx, ry, "M")         # its shoulders
    m.oval(2600, 0, 540, 250, "I")           # the glacier round its north end
    m.cells(59, 21, 65, 27, "L")             # the middle pass
    m.cells(59, 40, 65, 57, "L")             # the wide gap with the town, open down to the river
    m.cells(0, 57, 65, 60, "W")              # the river
    m.cells(18, 56, 38, 59, "W")             # it swings north between the bridges
    m.cells(18, 59, 38, 60, "L")
    m.oval(2600, 2600, 620, 330, "W")        # the lake
    m.oval(0, 0, 420, 190, "M")              # the corner hills
    m.oval(1220, 660, 110, 150, "M")         # the western hills
    m.oval(1260, 860, 90, 130, "M")
    m.oval(1280, 1480, 90, 130, "M")         # the ridge between a base and its village
    m.oval(1560, 1140, 130, 100, "I")        # a frozen pond
    m.oval(2180, 560, 150, 60, "M")          # a spur of the range, below the glacier
    m.oval(1040, 2800, 170, 90, "M")         # the hills of the south shore
    m.mirror()
    hqs(m, 360, 1880)
    m.pair("B", "K", "landRig", 800, 760, ("North-west field", "השדה הצפון-מערבי"), ["the north-west field", "north-west field", "השדה הצפון-מערבי"],
           east_name=("North-east field", "השדה הצפון-מזרחי"), east_aliases=["the north-east field", "north-east field", "השדה הצפון-מזרחי"])
    m.pair("D", "H", "landRig", 760, 2800, ("South-west field", "השדה הדרום-מערבי"), ["the south-west field", "south-west field", "השדה הדרום-מערבי"],
           east_name=("South-east field", "השדה הדרום-מזרחי"), east_aliases=["the south-east field", "south-east field", "השדה הדרום-מזרחי"])
    m.pair("L", "M", "point", 1900, 1760, ("West village", "הכפר המערבי"), ["the west village", "west village", "הכפר המערבי"],
           east_name=("East village", "הכפר המזרחי"), east_aliases=["the east village", "east village", "הכפר המזרחי"])
    m.pair("T", "Y", "point", 1900, 600, ("West fort", "המבצר המערבי"), ["the west fort", "west fort", "המבצר המערבי"],
           east_name=("East fort", "המבצר המזרחי"), east_aliases=["the east fort", "east fort", "המבצר המזרחי"])
    m.point("N", "point", 2600, 120, ("Glacier", "הקרחון"), ["the glacier", "glacier", "the north pass", "north pass", "הקרחון", "קרחון", "המעבר הצפוני"])
    m.point("G", "point", 2600, 960, ("Middle pass", "המעבר האמצעי"), ["the middle pass", "middle pass", "המעבר האמצעי"])
    m.point("F", "point", 2600, 1760, ("Town", "העיירה"), ["the town", "town", "העיירה", "עיירה"])
    m.point("V", "point", 2600, 2140, ("South gap", "הפרצה הדרומית"), ["the south gap", "south gap", "הפרצה הדרומית"])
    m.point("S", "seaRig", 2600, 2600, ("Lake rig", "אסדת האגם"), ["the lake rig", "lake rig", "the sea rig", "sea rig", "אסדת האגם", "האסדה הימית"])
    m.bridge("bridge-far-west", ("the far west bridge", "הגשר המערבי הרחוק"), (560, 2280), (560, 2400),
             mirrored=("bridge-far-east", ("the far east bridge", "הגשר המזרחי הרחוק")))
    m.bridge("bridge-west", ("the west bridge", "הגשר המערבי"), (1720, 2280), (1720, 2400),
             mirrored=("bridge-east", ("the east bridge", "הגשר המזרחי")))
    m.gusher("A", 720, 1690, east="Z")       # a home field close to each headquarters
    m.gusher("B", east="K")                  # the fields up north
    m.gusher("D", poor=True, east="H")       # a small one across the river
    m.gusher("G", rich=True)                 # the rich ones in the passes
    m.gusher("F", rich=True)
    m.around("A", [("wall", "E", 100), ("grove", "N", 100), ("rocks", "S", 100)])
    m.around("B", [("rocks", "E", 62), ("ruin", "W", 58), ("grove", "S", 90)])
    m.around("D", [("rocks", "N", 62), ("ruin", "E", 58), ("grove", "W", 80)])
    m.around("L", [("house", "N", 54), ("house", "S", 54), ("wall", "E", 64), ("grove", "W", 80)])
    m.around("T", [("bunker", "N", 56), ("wall", "E", 62), ("rocks", "S", 64)])
    m.around("G", [("bunker", "N", 50), ("rocks", "S", 50)])
    m.around("F", [("house", "N", 56), ("house", "S", 56), ("rocks", "NW", 64), ("house", "SW", 80)])
    m.around("V", [("house", "N", 54), ("grove", "W", 70)])
    m.mark("grove", 300, 600)                # the north-west woods
    m.mark("grove", 400, 520)
    m.mark("grove", 240, 480)
    m.mark("ruin", 560, 260)
    m.mark("rocks", 1000, 300)
    m.mark("house", 1400, 340)               # the hamlet on the way to the fort
    m.mark("house", 1480, 420)
    m.mark("grove", 1560, 820)
    m.mark("rocks", 200, 1100)
    m.mark("grove", 620, 1240)
    m.mark("ruin", 960, 1200)
    m.mark("house", 420, 1500)
    m.mark("grove", 980, 1560)
    m.mark("rocks", 1500, 1480)
    m.mark("grove", 1760, 1340)
    m.mark("bunker", 2260, 960)              # the mouths of the middle pass
    m.mark("rocks", 2180, 1180)
    m.mark("ruin", 2100, 1420)
    m.mark("grove", 2280, 1560)
    m.mark("house", 2300, 2040)
    m.mark("rocks", 2140, 2160)
    m.mark("house", 760, 2180)               # the far west bridgehead
    m.mark("wall", 1720, 2210)               # the west bridgehead
    m.mark("house", 1300, 2060)
    m.mark("grove", 1100, 1900)
    m.mark("grove", 1560, 2560)              # the south shore
    m.mark("ruin", 1300, 2960)
    m.mark("house", 1900, 2560)
    m.mark("grove", 1960, 3000)
    m.mark("rocks", 2280, 3080)
    m.mark("ruin", 300, 2640)
    m.mark("grove", 360, 3000)
    m.mark("rocks", 900, 3080)
    m.mark("rocks", 2200, 640)
    m.mark("ruin", 2040, 320)
    m.tech("tech_goldworks", 2180, 400)      # at each end of the glacier
    m.tech("tech_clinic", 2200, 1800)        # between each village and the town
    m.tech("tech_garage", 1500, 2720)        # south of the river
    return m


def huge():
    """Great Moat: a river from one edge to the other, with a town on a moated island in
    its middle. Five ways across: over the glacier behind the northern range, down the
    north road between the range and the moat, through the island by its west and east
    bridges (or onto it from the north over the frozen moat), and through the south
    country, which the far bridges and the island's south bridges lead to. Boats sail the
    river and the moat, and round both ends of the map to the sea in the south."""
    m = Map("huge", ("Great Moat", "החפיר הגדול"), 170, 105, minutes=30, pace=2.5)
    m.cells(0, 64, 85, 67, "W")              # the river, from edge to edge
    m.cells(30, 65, 52, 68, "W")             # it swings south between the far bridge and the island
    m.cells(30, 64, 52, 65, "L")
    m.cells(63, 31, 66, 67, "W")             # the moat: the island's west side
    m.cells(63, 31, 85, 34, "W")             # and its north side
    m.cells(78, 31, 85, 34, "I")             # frozen in the middle
    m.oval(300, 2700, 500, 140, "W")         # a harbour on the river below each base, for its dockyard
    m.cells(0, 67, 3, 96, "W")               # the river's mouth runs down the edge of the map
    m.cells(0, 96, 85, 105, "W")             # to the sea in the south
    m.oval(0, 4000, 620, 560, "W")           # a bay where they meet
    m.oval(2300, 3900, 260, 130, "W")        # a bight in the south shore
    m.cells(58, 13, 85, 20, "M")             # the northern range
    for x, y, rx, ry in ((2420, 660, 190, 210), (3020, 640, 170, 190), (3400, 700, 200, 170)):
        m.oval(x, y, rx, ry, "M")            # its shoulders
    m.cells(65, 11, 70, 22, "L")             # the pass through it, on each side
    m.oval(3400, 0, 700, 300, "I")           # the glacier behind it
    m.oval(0, 0, 460, 220, "M")              # the corner hills
    m.oval(1380, 1020, 120, 170, "M")        # the western hills, between the north field and the fort
    m.oval(1440, 1240, 90, 120, "M")
    m.oval(1240, 1620, 100, 160, "M")        # the ridge between a base and its village
    m.oval(2180, 2320, 140, 80, "M")         # a spur above the river
    m.oval(860, 1420, 110, 70, "M")          # a knoll between a base and its north field
    m.oval(2080, 1460, 150, 110, "I")        # a frozen pond on the way to the north road
    m.oval(520, 1340, 120, 80, "I")          # and one behind each base
    m.oval(3080, 1560, 130, 80, "M")         # the hills of the island, north and south of its gates
    m.oval(3080, 2360, 130, 80, "M")
    m.oval(1560, 3600, 190, 90, "M")         # the hills of the south country
    m.oval(2720, 3100, 110, 150, "M")
    m.oval(420, 3080, 130, 90, "M")
    m.oval(1480, 3020, 120, 80, "I")         # a frozen pond in the south country
    m.mirror()
    hqs(m, 440, 2160)
    m.pair("B", "K", "landRig", 900, 880, ("North-west field", "השדה הצפון-מערבי"), ["the north-west field", "north-west field", "השדה הצפון-מערבי"],
           east_name=("North-east field", "השדה הצפון-מזרחי"), east_aliases=["the north-east field", "north-east field", "השדה הצפון-מזרחי"])
    m.pair("D", "H", "landRig", 900, 3320, ("South-west field", "השדה הדרום-מערבי"), ["the south-west field", "south-west field", "השדה הדרום-מערבי"],
           east_name=("South-east field", "השדה הדרום-מזרחי"), east_aliases=["the south-east field", "south-east field", "השדה הדרום-מזרחי"])
    m.pair("L", "M", "point", 1720, 2100, ("West village", "הכפר המערבי"), ["the west village", "west village", "הכפר המערבי"],
           east_name=("East village", "הכפר המזרחי"), east_aliases=["the east village", "east village", "הכפר המזרחי"])
    m.pair("T", "Y", "point", 1860, 620, ("West fort", "המבצר המערבי"), ["the west fort", "west fort", "המבצר המערבי"],
           east_name=("East fort", "המבצר המזרחי"), east_aliases=["the east fort", "east fort", "המבצר המזרחי"])
    m.pair("Q", "C", "point", 2700, 660, ("West pass", "המעבר המערבי"), ["the west pass", "west pass", "המעבר המערבי"],
           east_name=("East pass", "המעבר המזרחי"), east_aliases=["the east pass", "east pass", "המעבר המזרחי"])
    m.pair("O", "E", "point", 2140, 3320, ("West orchard", "הפרדס המערבי"), ["the west orchard", "west orchard", "הפרדס המערבי"],
           east_name=("East orchard", "הפרדס המזרחי"), east_aliases=["the east orchard", "east orchard", "הפרדס המזרחי"])
    m.pair("W", "X", "point", 2860, 1960, ("West gate", "השער המערבי"), ["the west gate", "west gate", "השער המערבי"],
           east_name=("East gate", "השער המזרחי"), east_aliases=["the east gate", "east gate", "השער המזרחי"])
    m.point("N", "point", 3400, 160, ("Glacier", "הקרחון"), ["the glacier", "glacier", "הקרחון", "קרחון"])
    m.point("G", "point", 3400, 1040, ("Mine", "המכרה"), ["the mine", "mine", "המכרה", "מכרה"])
    m.point("F", "point", 3400, 1960, ("Town", "העיירה"), ["the town", "town", "העיירה", "עיירה"])
    m.point("V", "point", 3400, 3560, ("Lighthouse", "המגדלור"), ["the lighthouse", "lighthouse", "המגדלור", "מגדלור"])
    m.point("S", "seaRig", 3400, 4020, ("Sea rig", "האסדה הימית"), ["the sea rig", "sea rig", "האסדה הימית", "אסדה ימית"])
    m.bridge("bridge-far-west", ("the far west bridge", "הגשר המערבי הרחוק"), (1000, 2560), (1000, 2680),
             mirrored=("bridge-far-east", ("the far east bridge", "הגשר המזרחי הרחוק")))
    m.bridge("bridge-west", ("the west bridge", "הגשר המערבי"), (2520, 1960), (2640, 1960),
             mirrored=("bridge-east", ("the east bridge", "הגשר המזרחי")))
    m.bridge("bridge-south-west", ("the south-west bridge", "הגשר הדרום-מערבי"), (3000, 2560), (3000, 2680),
             mirrored=("bridge-south-east", ("the south-east bridge", "הגשר הדרום-מזרחי")))
    m.gusher("A", 800, 1980, east="Z")       # a home field close to each headquarters
    m.gusher("B", east="K")                  # the fields up north
    m.gusher("D", poor=True, east="H")       # a small one across the river
    m.gusher("O", poor=True, east="E")       # and another deeper in the south country
    m.gusher("F", rich=True)                 # the rich ones: in the town on the island,
    m.gusher("G", rich=True)                 # at the mine on the north road,
    m.gusher("V", rich=True)                 # and by the lighthouse on the south shore
    m.around("A", [("wall", "E", 100), ("grove", "N", 100), ("rocks", "S", 100)])
    m.around("B", [("rocks", "E", 62), ("ruin", "W", 58), ("grove", "S", 90)])
    m.around("D", [("rocks", "N", 62), ("ruin", "E", 58), ("grove", "W", 80)])
    m.around("L", [("house", "N", 54), ("house", "S", 54), ("wall", "E", 64), ("grove", "W", 80)])
    m.around("T", [("bunker", "N", 56), ("wall", "E", 62), ("rocks", "S", 64)])
    m.around("Q", [("bunker", "N", 60), ("rocks", "S", 60)])
    m.around("O", [("house", "N", 56), ("grove", "E", 70), ("grove", "SW", 80)])
    m.around("W", [("wall", "W", 60), ("house", "N", 60), ("house", "S", 60)])
    m.around("G", [("ruin", "N", 58), ("rocks", "SW", 70)])
    m.around("F", [("house", "N", 56), ("house", "S", 56), ("rocks", "NW", 64), ("house", "SW", 80)])
    m.around("V", [("house", "N", 54), ("rocks", "W", 70)])
    m.mark("ruin", 560, 300)                 # the north-west corner
    m.mark("grove", 300, 520)
    m.mark("grove", 420, 600)
    m.mark("grove", 240, 760)
    m.mark("rocks", 1040, 300)
    m.mark("house", 1400, 340)               # the hamlet on the way to the fort
    m.mark("house", 1480, 420)
    m.mark("grove", 1100, 620)
    m.mark("rocks", 600, 1040)
    m.mark("grove", 300, 1100)
    m.mark("house", 700, 1200)
    m.mark("ruin", 1160, 1340)
    m.mark("rocks", 200, 1500)
    m.mark("ruin", 1960, 260)                # the way round the range to the glacier
    m.mark("rocks", 2560, 320)
    m.mark("grove", 2800, 300)
    m.mark("bunker", 3000, 420)
    m.mark("grove", 1620, 860)               # below the fort
    m.mark("house", 2060, 880)
    m.mark("grove", 2300, 1000)
    m.mark("rocks", 1700, 1160)
    m.mark("bunker", 2360, 1260)
    m.mark("ruin", 1820, 1380)
    m.mark("grove", 2620, 1120)              # the north road
    m.mark("bunker", 2900, 1000)
    m.mark("house", 3180, 900)
    m.mark("wall", 3100, 1140)
    m.mark("ruin", 160, 1660)                # round each base
    m.mark("grove", 700, 1700)
    m.mark("rocks", 1000, 1780)
    m.mark("house", 1000, 2240)
    m.mark("house", 1060, 2440)              # the far west bridgehead
    m.mark("grove", 150, 2380)
    m.mark("rocks", 1640, 1640)              # between a base and its village
    m.mark("grove", 1460, 1900)
    m.mark("house", 1340, 2100)
    m.mark("rocks", 1500, 2320)
    m.mark("grove", 1200, 2480)
    m.mark("grove", 1900, 2460)
    m.mark("house", 1980, 1880)              # the road to the west bridge
    m.mark("grove", 2300, 1760)
    m.mark("ruin", 2380, 1620)
    m.mark("wall", 2440, 1900)               # the west bridgehead
    m.mark("house", 2420, 2080)
    m.mark("rocks", 2400, 2460)
    m.mark("grove", 2760, 1460)              # the island
    m.mark("grove", 2760, 1700)
    m.mark("rocks", 2740, 2200)
    m.mark("ruin", 2780, 2440)
    m.mark("house", 3120, 1800)
    m.mark("wall", 3160, 1960)
    m.mark("house", 3140, 2120)
    m.mark("grove", 3300, 1480)
    m.mark("rocks", 3300, 2420)
    m.mark("bunker", 3400, 1440)             # its north shore, facing the frozen moat
    m.mark("wall", 3400, 2500)               # and its south shore
    m.mark("house", 1000, 2800)              # the south country: the far west bridgehead
    m.mark("ruin", 300, 3300)
    m.mark("grove", 560, 3560)
    m.mark("rocks", 1240, 3000)
    m.mark("grove", 1200, 3500)
    m.mark("ruin", 1300, 3780)
    m.mark("grove", 1800, 2900)
    m.mark("house", 1740, 3340)
    m.mark("rocks", 1900, 3740)
    m.mark("house", 2400, 2820)
    m.mark("ruin", 2420, 3180)
    m.mark("grove", 2520, 3520)
    m.mark("rocks", 2960, 2800)              # the south-west bridgehead
    m.mark("wall", 3060, 2880)
    m.mark("house", 3100, 3300)
    m.mark("grove", 3000, 3700)
    m.mark("grove", 3260, 3040)
    m.mark("ruin", 3400, 2900)
    m.tech("tech_goldworks", 2300, 300)      # at each end of the glacier
    m.tech("tech_clinic", 2280, 2060)        # between each village and its bridge
    m.tech("tech_garage", 1500, 3260)        # in the south country
    return m


def write(maps):
    """Replaces the "maps" value in rules.json, keeping the rest of the file as written."""
    path = ROOT / "shared" / "rules.json"
    text = path.read_text(encoding="utf-8")
    one = lambda v: json.dumps(v, ensure_ascii=False)
    blocks = []
    for key, d in maps.items():
        lines = [f'    "{key}": {{', f'      "name": {one(d["name"])},',
                 f'      "width": {d["width"]}, "height": {d["height"]}, "cell": {d["cell"]}, "lengthSeconds": {d["lengthSeconds"]}, "pace": {d["pace"]},', '      "terrain": [']
        lines += [f'        "{row}"' + ("," if i < len(d["terrain"]) - 1 else "") for i, row in enumerate(d["terrain"])]
        lines.append("      ],")
        for field in ("points", "gushers", "bridges", "landmarks", "techBuildings"):
            lines.append(f'      "{field}": [')
            lines += [f"        {one(item)}" + ("," if i < len(d[field]) - 1 else "") for i, item in enumerate(d[field])]
            lines.append("      ]" + ("," if field != "techBuildings" else ""))
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
    built = [small(), medium(), large(), huge()]
    if "--show" in sys.argv:
        for m in built:
            m.check()
            m.show()
    else:
        write({m.key: m.data() for m in built})
        print("wrote", ", ".join(f"{m.key} ({len(m.points)} points, {len(m.landmarks())} landmarks)" for m in built))
