"""Unit sprite sheets, rendered from models built here in code.

Every unit is an original low-poly model made of boxes, prisms and cylinders. It is posed
by turning its joints, turned to eight headings under one fixed light, and rendered by
Blender (Cycles, CPU) from the game's isometric camera. The frames are then packed into
one sheet per unit: a row per heading, a column per frame.

    python art/units.py                 # every unit
    python art/units.py tank militia    # only these
    python art/units.py --sheet out.png # also write a contact sheet

Writes assets/sprites/units/*.png and the "units" part of assets/sprites/manifest.json.
"""

import argparse
import json
import math
import pathlib

import bpy  # isort: skip (bmesh and mathutils only exist once bpy is loaded)
import bmesh
from mathutils import Vector
from PIL import Image, ImageDraw, ImageFilter

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / "assets" / "sprites"
RAW = HERE.parent / "assets" / "raw" / "blender"

PPM = 40  # rendered pixels per metre
FACINGS = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"]  # map headings, clockwise from east
FACINGS16 = ["E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW", "N", "NNE", "NE", "ENE"]
ELEVATION = math.radians(30)  # gives the game's 2:1 diamond
OUTLINE = (22, 26, 30)

# ---------------------------------------------------------------- scene


def srgb(hex_colour):
    h = hex_colour.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i : i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1)


_materials = {}


def mat(colour, glow=0.0):
    key = (colour, glow)
    if key in _materials:
        return _materials[key]
    m = bpy.data.materials.new(f"m{len(_materials)}")
    m.use_nodes = True
    shader = m.node_tree.nodes["Principled BSDF"]
    shader.inputs["Base Color"].default_value = srgb(colour)
    shader.inputs["Roughness"].default_value = 1
    shader.inputs["Specular IOR Level"].default_value = 0
    if glow:
        shader.inputs["Emission Color"].default_value = srgb(colour)
        shader.inputs["Emission Strength"].default_value = glow
    _materials[key] = m
    return m


def holdout():
    m = bpy.data.materials.new("holdout")
    m.use_nodes = True
    nodes = m.node_tree.nodes
    nodes.remove(nodes["Principled BSDF"])
    node = nodes.new("ShaderNodeHoldout")
    m.node_tree.links.new(node.outputs[0], nodes["Material Output"].inputs["Surface"])
    return m


def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _materials.clear()
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 48
    scene.cycles.use_adaptive_sampling = False
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 2
    scene.cycles.filter_width = 1.2
    scene.render.film_transparent = True
    scene.render.use_persistent_data = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"

    world = bpy.data.worlds.new("world")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.75, 0.8, 0.9, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    scene.world = world

    # The camera looks from the south-east of the model, so the model's +X (map east)
    # runs down and to the right on screen and map south runs down and to the left.
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    # One sun from the upper left of the picture, and a weak fill from the right.
    for name, direction, energy in (("sun", (-0.5, -1.5, 1.6), 3.2), ("fill", (1.5, 0.2, 0.7), 0.7)):
        light = bpy.data.lights.new(name, "SUN")
        light.energy = energy
        light.angle = math.radians(8)
        obj = bpy.data.objects.new(name, light)
        obj.rotation_euler = (-Vector(direction)).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(obj)
    return scene


def aim_camera(scene, cell, centre_z):
    """Square cell of `cell` metres, looking at a point centre_z above the origin."""
    cam = scene.camera
    cam.data.ortho_scale = cell
    back = Vector((1, -1, math.sqrt(2) * math.tan(ELEVATION))).normalized()
    target = Vector((0, 0, centre_z))
    cam.location = target + back * 40
    cam.rotation_euler = (-back).to_track_quat("-Z", "Y").to_euler()
    size = round(cell * PPM)
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    # Where the origin (the unit's place on the ground) lands in the cell, in pixels.
    return size, (size / 2, size / 2 + centre_z * math.cos(ELEVATION) * PPM)


# ---------------------------------------------------------------- building blocks


def _object(name, verts, faces, material, parent, loc=(0, 0, 0), rot=(0, 0, 0)):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    obj.parent = parent
    obj.location = loc
    obj.rotation_euler = rot
    bpy.context.scene.collection.objects.link(obj)
    return obj


def joint(parent, loc=(0, 0, 0), name="joint"):
    obj = bpy.data.objects.new(name, None)
    obj.parent = parent
    obj.location = loc
    bpy.context.scene.collection.objects.link(obj)
    return obj


def box(parent, size, loc, colour, rot=(0, 0, 0), glow=0.0):
    x, y, z = (s / 2 for s in size)
    verts = [(sx * x, sy * y, sz * z) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return _object("box", verts, faces, mat(colour, glow), parent, loc, rot)


def cyl(parent, radius, length, loc, colour, axis="Z", sides=10, glow=0.0, top=None):
    """A cylinder centred on loc along `axis`; `top` gives a different radius at the far end."""
    top = radius if top is None else top
    verts, faces = [], []
    for i in range(sides):
        a = 2 * math.pi * i / sides
        verts.append((radius * math.cos(a), radius * math.sin(a), -length / 2))
        verts.append((top * math.cos(a), top * math.sin(a), length / 2))
    for i in range(sides):
        j = (i + 1) % sides
        faces.append((2 * i, 2 * j, 2 * j + 1, 2 * i + 1))
    faces.append(tuple(2 * i for i in range(sides)))
    faces.append(tuple(2 * i + 1 for i in reversed(range(sides))))
    rot = {"Z": (0, 0, 0), "X": (0, math.pi / 2, 0), "Y": (-math.pi / 2, 0, 0)}[axis]
    return _object("cyl", verts, faces, mat(colour, glow), parent, loc, rot)


def prism_y(parent, profile, width, colour, y=0.0):
    """A side profile of (x, z) points, extruded across the model."""
    n = len(profile)
    verts = [(x, y - width / 2, z) for x, z in profile] + [(x, y + width / 2, z) for x, z in profile]
    faces = [tuple(range(n)), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    return _object("prism", verts, faces, mat(colour), parent)


def prism_z(parent, outline, z0, z1, colour, bottom=1.0, top=1.0):
    """A plan outline of (x, y) points, raised from z0 to z1, narrowed at either end."""
    n = len(outline)
    verts = [(x * bottom, y * bottom, z0) for x, y in outline] + [(x * top, y * top, z1) for x, y in outline]
    faces = [tuple(range(n)), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    return _object("prism", verts, faces, mat(colour), parent)


def ball(parent, radius, loc, colour, squash=1.0):
    mesh = bpy.data.meshes.new("ball")
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=radius)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat(colour))
    obj = bpy.data.objects.new("ball", mesh)
    obj.parent = parent
    obj.location = loc
    obj.scale = (1, 1, squash)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def flash(parent, loc, size):
    """A muzzle flash pointing along +X, hidden until a frame shows it."""
    root = joint(parent, loc, "flash")
    cyl(root, 0.16 * size, 0.9 * size, (0.45 * size, 0, 0), "#ffd27a", axis="X", sides=6, glow=9, top=0.02)
    cyl(root, 0.3 * size, 0.3 * size, (0.12 * size, 0, 0), "#ff9a3c", axis="X", sides=6, glow=6, top=0.1 * size)
    ball(root, 0.14 * size, (0.05 * size, 0, 0), "#fff3c4").active_material = mat("#fff3c4", 12)
    return root


def tree(obj):
    yield obj
    for child in obj.children:
        yield from tree(child)


def show(obj, visible):
    for o in tree(obj):
        o.hide_render = not visible


CHARRED = ["#2a2622", "#1c1a18", "#35302a"]


def char(root, burnt):
    """Burn a model out, every part gone dark, or put its own colours back."""
    for i, obj in enumerate(tree(root)):
        if obj.type != "MESH" or obj.active_material.name == "holdout":
            continue
        if "paint" not in obj:
            obj["paint"] = obj.active_material.name
        obj.active_material = mat(CHARRED[i % len(CHARRED)]) if burnt else bpy.data.materials[obj["paint"]]


# ---------------------------------------------------------------- infantry

AEGIS = dict(cloth="#7590a8", dark="#3d4c5a", armour="#9db4c6", head="#4a5f72", trim="#9fe8f2", skin="#d8b08a",
             gun="#1b1f22", hull="#6f8799", hull2="#566b7b", low="#39454f", track="#1b2025", deck="#8aa0b0")
ASHFALL = dict(cloth="#a88a57", dark="#4b3a27", armour="#6b6e42", head="#b8862f", trim="#f1dfb0", skin="#b98a62",
               gun="#1b1f22", wood="#6b4526", hull="#b79560", hull2="#8e7347", low="#3a2e22", rust="#8a4a2a", track="#1c1a17")


class Soldier:
    cell, centre = 3.4, 0.75
    facings = FACINGS
    scale = 1.0
    # New animations go at the end of the row, so the columns older code knows stay put.
    sheets = {"": [("idle", [0]), ("walk", [i / 12 for i in range(12)]), ("fire", [0, 1]), ("cover", [0]),
                   ("coverFire", [0]), ("die", [0.2, 0.45, 0.7, 0.9, 1]), ("stop", [0])]}
    manifest = {"per": "member", "fps": {"walk": 16, "die": 9}}

    def __init__(self, look, militia, rocket=False):
        c = look
        self.root = joint(None, name="root")
        self.size = joint(self.root)  # a hero stands a little taller than the rank and file
        self.size.scale = (self.scale,) * 3
        self.fall = joint(self.size)  # tips the whole body over when it dies
        self.pelvis = joint(self.fall, (0, 0, 0.8))
        self.torso = joint(self.pelvis)
        box(self.torso, (0.3, 0.5, 0.52), (0, 0, 0.27), c["cloth"])
        box(self.torso, (0.1, 0.44, 0.3), (0.17, 0, 0.3), c["armour"])  # chest plate or rig
        box(self.pelvis, (0.28, 0.46, 0.14), (0, 0, 0.0), c["dark"])  # belt
        if militia:
            box(self.torso, (0.34, 0.1, 0.5), (0, 0, 0.3), c["dark"], rot=(0.55, 0, 0))  # bandolier
            box(self.torso, (0.16, 0.3, 0.26), (-0.22, 0, 0.26), c["armour"])  # small bag
        else:
            box(self.torso, (0.18, 0.36, 0.42), (-0.23, 0, 0.3), c["dark"])  # pack
            box(self.torso, (0.04, 0.04, 0.3), (-0.26, 0.14, 0.62), c["gun"])  # aerial

        self.head = joint(self.torso, (0, 0, 0.56))
        ball(self.head, 0.17, (0.01, 0, 0.17), c["skin"])
        if militia:
            ball(self.head, 0.19, (-0.02, 0, 0.21), c["head"], squash=0.85)  # wrapped headscarf
            box(self.head, (0.08, 0.2, 0.3), (-0.2, 0.03, 0.06), c["head"], rot=(0, 0.25, 0))  # its tail
            box(self.head, (0.3, 0.36, 0.08), (0.0, 0, 0.02), c["head"])  # wrap at the neck
        else:
            ball(self.head, 0.2, (-0.01, 0, 0.2), c["head"], squash=0.9)  # helmet
            box(self.head, (0.06, 0.3, 0.1), (0.17, 0, 0.17), c["trim"], glow=0.6)  # visor

        self.legs = []
        for side in (1, -1):
            hip = joint(self.pelvis, (0, 0.13 * side, 0))
            box(hip, (0.2, 0.2, 0.42), (0, 0, -0.2), c["cloth"])
            knee = joint(hip, (0, 0, -0.4))
            box(knee, (0.18, 0.18, 0.4), (0, 0, -0.18), c["armour"] if militia else c["dark"])
            box(knee, (0.3, 0.2, 0.13), (0.05, 0, -0.34), "#22201d")
            self.legs.append((hip, knee))

        self.arms = []
        for side in (1, -1):
            shoulder = joint(self.torso, (0, 0.31 * side, 0.46))
            box(shoulder, (0.16, 0.16, 0.32), (0, 0, -0.13), c["cloth"])
            elbow = joint(shoulder, (0, 0, -0.28))
            box(elbow, (0.14, 0.14, 0.28), (0, 0, -0.12), c["cloth"] if militia else c["armour"])
            box(elbow, (0.13, 0.13, 0.1), (0, 0, -0.29), c["skin"])
            self.arms.append((shoulder, elbow))

        self.rifle = joint(self.torso, (0.3, -0.08, 0.3))
        if rocket:
            # A shoulder launcher: a long tube, the rocket's head at the front, a flared end.
            cyl(self.rifle, 0.055, 1.05, (0.0, 0, 0.04), c["armour"], axis="X", sides=8)
            cyl(self.rifle, 0.09, 0.16, (-0.56, 0, 0.04), c["gun"], axis="X", sides=8, top=0.055)  # flared rear
            cyl(self.rifle, 0.1, 0.3, (0.66, 0, 0.04), c["rust"], axis="X", sides=8, top=0.02)  # warhead
            box(self.rifle, (0.07, 0.06, 0.2), (0.05, 0, -0.1), c["wood"])  # grip
            box(self.rifle, (0.06, 0.05, 0.12), (0.22, 0, 0.14), c["gun"])  # sight
            self.muzzle = flash(self.rifle, (0.85, 0, 0.04), 0.95)
            # Two spare rockets carried on the back.
            for dy in (0.09, -0.09):
                cyl(self.torso, 0.045, 0.5, (-0.3, dy, 0.42), c["armour"], sides=6)
                cyl(self.torso, 0.07, 0.2, (-0.3, dy, 0.76), c["rust"], sides=6, top=0.02)
        elif militia:
            box(self.rifle, (0.34, 0.07, 0.13), (-0.3, 0, -0.03), c["wood"])  # stock
            box(self.rifle, (0.5, 0.08, 0.11), (0.05, 0, 0), c["gun"])
            box(self.rifle, (0.3, 0.07, 0.07), (0.3, 0, -0.01), c["wood"])  # handguard
            box(self.rifle, (0.42, 0.04, 0.04), (0.6, 0, 0.01), c["gun"])
            box(self.rifle, (0.09, 0.06, 0.26), (0.08, 0, -0.14), c["gun"], rot=(0, -0.35, 0))  # curved magazine
            self.muzzle = flash(self.rifle, (0.82, 0, 0.01), 0.55)
        else:
            box(self.rifle, (0.62, 0.09, 0.13), (0, 0, 0), c["gun"])
            box(self.rifle, (0.2, 0.06, 0.06), (0.4, 0, 0.01), c["dark"])
            box(self.rifle, (0.08, 0.07, 0.2), (0.02, 0, -0.14), c["gun"])
            box(self.rifle, (0.16, 0.05, 0.06), (0.0, 0, 0.1), c["trim"], glow=0.4)  # sight
            self.muzzle = flash(self.rifle, (0.52, 0, 0.01), 0.5)

    def pose(self, anim, t):
        show(self.root, True)
        show(self.muzzle, False)
        self.fall.rotation_euler = (0, 0, 0)
        self.fall.location = (0, 0, 0)
        self.torso.rotation_euler = (0, 0.06, 0)
        self.head.rotation_euler = (0, 0, 0)
        # Standing with the rifle held low across the body.
        z, legs = 0.8, [(0.08, 0.05), (-0.08, 0.05)]
        rifle, tilt = (0.3, -0.06, 0.26), 0.3
        arms = [(0.95, 0.5, 0.5), (0.45, 1.2, 0.35)]  # (swing forward, elbow bend, in toward the body)
        if anim == "walk":
            # One stride over the cycle. A leg swings forward with its knee bent and lands
            # almost straight; the body is lowest as the feet are furthest apart and rises
            # over the standing leg; the shoulders turn against the hips and the head stays
            # on the line of march.
            p = 2 * math.pi * t
            sn, cs = math.sin(p), math.cos(p)
            legs = [(0.74 * sn, 0.12 + 1.0 * max(0, cs) ** 1.3), (-0.74 * sn, 0.12 + 1.0 * max(0, -cs) ** 1.3)]
            z = 0.775 + 0.03 * math.cos(2 * p)
            self.torso.rotation_euler = (0.05 * cs, 0.2, -0.17 * sn)
            self.head.rotation_euler = (0, -0.06, 0.13 * sn)
            rifle = (0.3 + 0.02 * sn, -0.06, 0.26 + 0.025 * math.cos(2 * p))
            arms = [(0.95 + 0.1 * sn, 0.5, 0.5), (0.45 - 0.1 * sn, 1.2, 0.35)]
        if anim == "stop":
            # The last step: the front foot planted, the weight held back.
            legs = [(0.38, 0.3), (-0.22, 0.12)]
            z = 0.77
            self.torso.rotation_euler = (0, 0.02, 0)
        if anim in ("fire", "coverFire", "cover"):
            legs = [(0.3, 0.1), (-0.3, 0.15)]
            z = 0.78
            rifle, tilt = (0.36, -0.14, 0.44), 0
            arms = [(1.45, 0.15, 0.45), (1.0, 1.0, 0.1)]
            self.torso.rotation_euler = (0, 0.12, 0)
        if anim in ("cover", "coverFire"):
            # Down on one knee.
            legs = [(1.35, 1.45), (-0.25, 1.5)]
            z = 0.47
            self.torso.rotation_euler = (0, 0.22, 0)
            if anim == "cover":
                rifle, tilt = (0.32, -0.1, 0.3), 0.15
                arms = [(1.1, 0.4, 0.45), (0.6, 1.2, 0.3)]
                self.head.rotation_euler = (0, 0.3, 0)
        if (anim == "fire" and t == 1) or anim == "coverFire":
            show(self.muzzle, True)
            rifle = (rifle[0] - 0.05, rifle[1], rifle[2])
        if anim == "die":
            # Knees give way, then the body falls on its back and the rifle drops.
            self.fall.rotation_euler = (0, -math.radians(90) * t**1.5, 0)
            self.fall.location = (-0.25 * t, 0, 0.14 * t)
            legs = [(0.5 * t, 0.7 * t * (1 - t) * 4 * 0.5), (0.15 * t, 0.9 * t * (1 - t) * 4 * 0.5)]
            arms = [(0.95 - 2.0 * t, 0.5 * (1 - t), 0.5 - 1.3 * t), (0.45 - 1.6 * t, 1.2 * (1 - t), 0.35 - 0.9 * t)]
            rifle, tilt = (0.3 + 0.2 * t, -0.06 - 0.45 * t, 0.26 - 0.1 * t), 0.3 + 0.9 * t
            self.head.rotation_euler = (0, -0.4 * t, 0)
        self.pelvis.location = (0, 0, z)
        for (hip, knee), (swing, bend) in zip(self.legs, legs):
            hip.rotation_euler = (0, -swing, 0)
            knee.rotation_euler = (0, bend, 0)
        for (shoulder, elbow), (swing, bend, inward), side in zip(self.arms, arms, (1, -1)):
            shoulder.rotation_euler = (-inward * side, -swing, 0)
            elbow.rotation_euler = (0, -bend, 0)
        self.rifle.location = rifle
        self.rifle.rotation_euler = (0, tilt, 0.5 * t if anim == "die" else 0)


# ---------------------------------------------------------------- vehicles and boats


def crew(parent, loc, look, height=0.55, scarf=True):
    """A crewman from the waist up."""
    box(parent, (0.3, 0.46, height), (loc[0], loc[1], loc[2] + height / 2), look["cloth"])
    ball(parent, 0.17, (loc[0] + 0.01, loc[1], loc[2] + height + 0.16), look["skin"])
    ball(parent, 0.19, (loc[0] - 0.02, loc[1], loc[2] + height + 0.2), look["head"], squash=0.85)
    if scarf:
        box(parent, (0.08, 0.2, 0.28), (loc[0] - 0.2, loc[1] + 0.03, loc[2] + height + 0.06), look["head"])


class Vehicle:
    """A hull that faces where it drives and a weapon that turns on its own pivot."""

    water = False
    pivot = 0.0  # where the weapon turns, in metres ahead of the unit's centre
    manifest = {}
    facings = FACINGS16  # a hull turns through sixteen headings, so it does not snap round

    def __init__(self, look):
        self.look = look
        self.root = joint(None, name="root")
        self.body = joint(self.root, name="body")
        self.turret = joint(self.root, name="turret")
        self.wheels = []  # joints that turn about their axle when the vehicle moves
        self.links = []  # track links: (object, where it sits along the track, the track's length)
        self.build(look)
        if self.water:
            # Whatever is under the waterline is cut out of the picture.
            plane = _object("water", [(-30, -30, 0), (30, -30, 0), (30, 30, 0), (-30, 30, 0)], [(0, 1, 2, 3)], holdout(), None)
            plane.location = (0, 0, -0.001)
        # "move" comes last, so the columns older code knows stay where they were.
        self.sheets = {
            "": [("idle", [0]), ("sink", [0.3, 0.6, 0.85]) if self.water else ("wreck", [0]), ("move", [0, 1] if self.water else [0, 1, 2])],
            "_turret": [("idle", [0]), ("fire", [0, 1, 2])],
        }

    def wheel(self, loc, radius, width, tyre, hub):
        """A wheel on its own axle, with a hub bar across it so that its turning shows."""
        axle = joint(self.body, loc)
        cyl(axle, radius, width, (0, 0, 0), tyre, axis="Y", sides=10)
        cyl(axle, radius * 0.46, width + 0.02, (0, 0, 0), hub, axis="Y", sides=6)
        box(axle, (radius * 1.5, width + 0.04, radius * 0.22), (0, 0, 0), "#0f1113")
        self.wheels.append(axle)
        return axle

    def roll(self, t):
        """Turns the wheels and runs the tracks on by one step of three."""
        for axle in self.wheels:
            axle.rotation_euler = (0, t * math.pi / 3, 0)  # the hub bar repeats every half turn
        for link, at, pitch in self.links:
            link.location.x = at - pitch * t / 3

    def pose(self, anim, t, sheet):
        turret_only = sheet == "_turret"
        show(self.body, not turret_only)
        show(self.turret, turret_only or anim in ("wreck", "sink"))
        show(self.muzzle, turret_only and anim == "fire" and t == 0)
        self.turret.location = (0 if turret_only else self.pivot, 0, 0)
        self.turret.rotation_euler = (0, 0, 0)
        self.body.rotation_euler = (0, 0, 0)
        self.body.location = (0, 0, 0)
        self.recoil(([0.8, 1, 0.35][int(t)] if anim == "fire" else 0))
        char(self.root, anim == "wreck")
        self.roll(t if anim == "move" else 0)
        if anim == "move":
            if self.water:
                # Under way a boat lifts its bow and settles by the stern.
                self.body.rotation_euler = (0, -0.075 - 0.02 * t, 0)
                self.body.location = (0, 0, 0.05 + 0.03 * t)
            else:
                # The hull rocks on its springs as the ground passes under it.
                self.body.rotation_euler = (0, 0.012 * (1 - t), 0)
                self.body.location = (0, 0, 0.02 * (t % 2))
        if anim == "wreck":
            self.body.rotation_euler = (0.05, -0.03, 0)
            self.turret.rotation_euler = (0.12, 0.1, 0.7)
            self.turret.location = (self.pivot - 0.15, 0.1, -0.05)
        if anim == "sink":
            # Going down by the stern.
            for part in (self.body, self.turret):
                part.rotation_euler = (0.25 * t, -0.9 * t, 0)
            self.body.location = (0, 0, -1.1 * t)
            self.turret.location = (self.pivot * math.cos(0.9 * t), 0, -1.1 * t + self.pivot * math.sin(0.9 * t))


class Tank(Vehicle):
    cell, centre = 7.8, 0.7

    def build(self, c):
        b = self.body
        tread = [(-1.75, 0.0), (1.75, 0.0), (2.05, 0.32), (1.9, 0.62), (-1.9, 0.62), (-2.05, 0.32)]
        for side in (1, -1):
            prism_y(b, tread, 0.5, c["track"], y=0.9 * side)
            for i in range(5):
                self.wheel((-1.4 + 0.7 * i, 1.16 * side, 0.26), 0.2, 0.06, c["low"], c["hull2"])
            for i in range(11):
                link = box(b, (0.07, 0.03, 0.2), (-1.6 + 0.32 * i, 1.165 * side, 0.52), "#33393f")
                self.links.append((link, -1.6 + 0.32 * i, 0.32))
            box(b, (3.9, 0.6, 0.08), (0, 0.9 * side, 0.67), c["hull2"])  # fender
            box(b, (1.6, 0.5, 0.2), (-0.6, 0.93 * side, 0.82), c["hull"])  # side armour panel
        prism_y(b, [(-1.95, 0.42), (1.55, 0.42), (2.1, 0.68), (1.25, 1.02), (-1.95, 1.02)], 1.34, c["hull"])
        box(b, (0.9, 1.1, 0.06), (-1.35, 0, 1.04), c["low"])  # engine grille
        box(b, (0.5, 0.06, 0.06), (1.72, 0.3, 0.86), c["trim"], rot=(0, -0.38, 0), glow=0.5)  # running light
        box(b, (0.5, 0.06, 0.06), (1.72, -0.3, 0.86), c["trim"], rot=(0, -0.38, 0), glow=0.5)

        t = self.turret
        outline = [(1.05, 0.32), (1.05, -0.32), (0.45, -0.78), (-0.95, -0.72), (-1.15, 0), (-0.95, 0.72), (0.45, 0.78)]
        prism_z(t, outline, 1.02, 1.5, c["deck"], top=0.82)
        box(t, (0.5, 0.5, 0.1), (-0.35, -0.2, 1.53), c["hull2"])  # hatch
        box(t, (0.26, 0.22, 0.22), (-0.2, 0.42, 1.6), c["low"])  # sensor pod
        box(t, (0.05, 0.16, 0.12), (-0.06, 0.42, 1.6), c["trim"], glow=0.8)
        cyl(t, 0.02, 0.9, (-0.95, -0.45, 1.9), c["low"], sides=4)  # aerial
        self.barrel = joint(t, (0.95, 0, 1.24))
        cyl(self.barrel, 0.095, 2.0, (1.0, 0, 0), c["hull2"], axis="X", sides=8)
        cyl(self.barrel, 0.15, 0.6, (0.25, 0, 0), c["hull"], axis="X", sides=8)  # mantlet sleeve
        cyl(self.barrel, 0.14, 0.28, (2.0, 0, 0), c["low"], axis="X", sides=8)  # muzzle brake
        self.muzzle = flash(self.barrel, (2.15, 0, 0), 1.5)

    def recoil(self, k):
        self.barrel.location = (0.95 - 0.35 * k, 0, 1.24)


class Technical(Vehicle):
    cell, centre = 7.0, 0.9
    pivot = -1.05

    def build(self, c):
        b = self.body
        for x in (1.3, -1.25):
            for side in (1, -1):
                self.wheel((x, 0.82 * side, 0.4), 0.4, 0.3, "#1a1917", c["hull2"])
        box(b, (4.3, 1.5, 0.22), (0, 0, 0.62), c["low"])  # frame
        box(b, (1.0, 1.6, 0.42), (1.65, 0, 0.93), c["hull"])  # bonnet
        box(b, (0.12, 1.7, 0.2), (2.2, 0, 0.7), c["low"])  # bumper
        box(b, (0.06, 1.0, 0.24), (2.16, 0, 0.95), c["low"])  # grille
        prism_y(b, [(0.15, 0.72), (1.18, 0.72), (1.18, 1.14), (0.92, 1.62), (0.25, 1.62), (0.15, 1.2)], 1.6, c["hull"])
        prism_y(b, [(1.2, 1.16), (0.95, 1.6), (0.9, 1.6), (1.15, 1.16)], 1.36, "#1f2a33")  # windscreen
        box(b, (0.5, 1.63, 0.3), (0.6, 0, 1.38), "#1f2a33")  # side windows
        box(b, (0.75, 1.66, 0.4), (0.65, 0, 0.98), c["rust"])  # plates welded on the doors
        box(b, (0.5, 0.9, 0.16), (0.55, 0.1, 1.7), c["armour"])  # bedroll on the roof
        box(b, (2.1, 1.6, 0.1), (-1.05, 0, 0.76), c["hull2"])  # bed
        for side in (1, -1):
            box(b, (2.1, 0.08, 0.36), (-1.05, 0.78 * side, 0.96), c["hull"])
        box(b, (0.08, 1.6, 0.36), (-2.08, 0, 0.96), c["rust"])
        box(b, (0.4, 0.3, 0.34), (-0.25, 0.5, 0.98), c["armour"])  # fuel can

        t = self.turret
        cyl(t, 0.07, 0.8, (0, 0, 1.2), c["gun"], sides=6)  # post
        self.gun = joint(t, (0, 0, 1.66))
        box(self.gun, (0.7, 0.16, 0.18), (0.1, 0, 0), c["gun"])
        cyl(self.gun, 0.045, 0.9, (0.85, 0, 0.02), c["gun"], axis="X", sides=6)
        box(self.gun, (0.3, 0.26, 0.22), (0.05, 0.2, -0.06), c["armour"])  # ammunition box
        box(self.gun, (0.05, 0.6, 0.5), (0.3, 0, 0.1), c["rust"])  # gun shield
        crew(t, (-0.5, 0, 0.82), c, height=0.62)
        box(t, (0.5, 0.12, 0.12), (-0.22, 0.2, 1.4), c["cloth"], rot=(0, -0.5, 0))  # arms on the grips
        box(t, (0.5, 0.12, 0.12), (-0.22, -0.2, 1.4), c["cloth"], rot=(0, -0.5, 0))
        self.muzzle = flash(self.gun, (1.32, 0, 0.02), 0.9)

    def recoil(self, k):
        self.gun.location = (-0.08 * k, 0, 1.66)


class PatrolBoat(Vehicle):
    cell, centre = 8.4, 0.7
    pivot = 1.55
    water = True

    def build(self, c):
        b = self.body
        hull = [(3.0, 0), (1.7, 0.8), (-2.5, 0.86), (-2.75, 0.62), (-2.75, -0.62), (-2.5, -0.86), (1.7, -0.8)]
        prism_z(b, hull, -0.4, 0.5, c["hull"], bottom=0.8)
        prism_z(b, hull, 0.0, 0.1, c["low"], bottom=0.975, top=0.99)  # boot stripe at the waterline
        prism_z(b, hull, 0.5, 0.56, c["deck"], bottom=0.93, top=0.93)
        prism_y(b, [(-1.5, 0.56), (0.55, 0.56), (0.2, 1.32), (-1.4, 1.32)], 1.1, c["hull2"])  # cabin
        prism_y(b, [(0.52, 0.86), (0.3, 1.22), (0.22, 1.22), (0.44, 0.86)], 0.9, "#1f2a33")  # windows
        box(b, (1.0, 1.13, 0.22), (-0.6, 0, 1.08), "#1f2a33")
        box(b, (1.7, 1.2, 0.07), (-0.6, 0, 1.35), c["deck"])  # roof
        cyl(b, 0.04, 0.9, (-0.9, 0, 1.82), c["low"], sides=5)  # mast
        box(b, (0.1, 0.8, 0.09), (-0.9, 0, 2.2), c["deck"])  # radar bar
        box(b, (0.1, 0.1, 0.1), (-0.9, 0, 2.34), c["trim"], glow=1.5)
        box(b, (0.7, 0.9, 0.3), (-2.1, 0, 0.7), c["low"])  # engine housing

        t = self.turret
        cyl(t, 0.34, 0.2, (0, 0, 0.66), c["low"], sides=10)
        self.gun = joint(t, (0, 0, 0.95))
        prism_y(self.gun, [(-0.35, -0.2), (0.3, -0.2), (0.38, 0.05), (0.1, 0.22), (-0.35, 0.22)], 0.5, c["deck"])
        cyl(self.gun, 0.06, 1.1, (0.85, 0, 0.04), c["low"], axis="X", sides=6)
        self.muzzle = flash(self.gun, (1.42, 0, 0.04), 1.0)

    def recoil(self, k):
        self.gun.location = (-0.12 * k, 0, 0.95)


class Speedboat(Vehicle):
    cell, centre = 6.6, 0.6
    pivot = 0.85
    water = True

    def build(self, c):
        b = self.body
        hull = [(2.35, 0), (1.3, 0.62), (-1.75, 0.68), (-1.95, 0.48), (-1.95, -0.48), (-1.75, -0.68), (1.3, -0.62)]
        prism_z(b, hull, -0.3, 0.42, c["rust"], bottom=0.78)
        prism_z(b, hull, 0.3, 0.46, c["hull"], bottom=1.02, top=1.03)  # gunwale
        prism_z(b, hull, 0.44, 0.47, c["low"], bottom=0.86, top=0.86)  # open well
        box(b, (0.7, 0.06, 0.2), (0.2, 0.69, 0.2), c["hull2"], rot=(0, 0, -0.02))  # patches on the side
        box(b, (0.5, 0.06, 0.22), (-0.9, -0.7, 0.18), c["armour"])
        box(b, (0.5, 0.06, 0.22), (-0.9, 0.7, 0.2), c["hull2"])
        box(b, (0.5, 0.06, 0.2), (0.4, -0.68, 0.2), c["hull2"])
        box(b, (0.36, 0.42, 0.5), (-2.1, 0, 0.62), c["gun"])  # outboard motor
        box(b, (0.42, 0.46, 0.16), (-2.1, 0, 0.92), c["hull2"])
        cyl(b, 0.2, 0.5, (-0.4, 0.3, 0.7), c["armour"], sides=8)  # fuel drum
        crew(b, (-1.35, -0.1, 0.44), c, height=0.5)  # the man at the tiller

        t = self.turret
        cyl(t, 0.26, 0.5, (0, 0, 0.68), c["gun"], sides=3, top=0.03)  # tripod
        self.gun = joint(t, (0, 0, 0.98))
        box(self.gun, (0.6, 0.14, 0.16), (0.1, 0, 0), c["gun"])
        cyl(self.gun, 0.04, 0.8, (0.75, 0, 0.02), c["gun"], axis="X", sides=6)
        box(self.gun, (0.26, 0.22, 0.2), (0.05, 0.18, -0.05), c["armour"])
        crew(t, (-0.5, 0, 0.44), c, height=0.42)
        box(t, (0.45, 0.12, 0.12), (-0.24, 0.19, 0.84), c["cloth"], rot=(0, -0.3, 0))
        box(t, (0.45, 0.12, 0.12), (-0.24, -0.19, 0.84), c["cloth"], rot=(0, -0.3, 0))
        self.muzzle = flash(self.gun, (1.17, 0, 0.02), 0.8)

    def recoil(self, k):
        self.gun.location = (-0.07 * k, 0, 0.98)


class RocketLauncher(Vehicle):
    """A six-wheeled carrier with a pod of rockets that turns and elevates on the bed."""

    cell, centre = 8.6, 1.0
    pivot = -1.2

    def build(self, c):
        b = self.body
        for x in (1.75, -0.55, -1.75):
            for side in (1, -1):
                self.wheel((x, 0.9 * side, 0.42), 0.42, 0.34, "#17191b", c["hull2"])
        box(b, (5.0, 1.5, 0.26), (0, 0, 0.72), c["low"])  # frame
        # Armoured cab, sloped at the front, with a slit windscreen.
        prism_y(b, [(1.0, 0.85), (2.5, 0.85), (2.5, 1.35), (2.05, 1.95), (1.0, 1.95)], 1.7, c["hull"])
        prism_y(b, [(2.52, 1.4), (2.1, 1.92), (2.02, 1.92), (2.44, 1.4)], 1.4, "#1f2a33")
        box(b, (0.5, 1.72, 0.26), (1.45, 0, 1.6), "#1f2a33")  # side windows
        box(b, (0.14, 1.76, 0.22), (2.52, 0, 0.82), c["low"])  # bumper
        box(b, (0.3, 0.06, 0.06), (2.5, 0.5, 1.12), c["trim"], glow=0.6)
        box(b, (0.3, 0.06, 0.06), (2.5, -0.5, 1.12), c["trim"], glow=0.6)
        box(b, (3.4, 1.7, 0.12), (-0.75, 0, 0.9), c["hull2"])  # bed
        box(b, (0.6, 1.5, 0.5), (0.55, 0, 1.2), c["hull2"])  # generator and reload stowage
        for side in (1, -1):
            box(b, (0.16, 0.16, 0.5), (-2.2, 0.75 * side, 0.6), c["low"])  # stabiliser legs
        cyl(b, 0.02, 1.1, (1.1, -0.7, 2.5), c["low"], sides=4)  # aerial

        t = self.turret
        cyl(t, 0.5, 0.16, (0, 0, 1.04), c["low"], sides=10)  # turntable
        box(t, (0.3, 1.0, 0.5), (-0.35, 0, 1.3), c["hull2"])  # cradle
        self.pod = joint(t, (-0.2, 0, 1.55))
        self.pod.rotation_euler = (0, -0.38, 0)  # raised to fire over the cab
        box(self.pod, (2.3, 1.2, 0.74), (0.75, 0, 0.2), c["deck"])
        box(self.pod, (2.34, 1.24, 0.08), (0.75, 0, 0.2), c["hull"])  # band round the pod
        for y in (-0.38, 0, 0.38):
            for z in (0.03, 0.37):
                cyl(self.pod, 0.14, 0.06, (1.91, y, z), "#14181b", axis="X", sides=8)  # tube mouths
        box(self.pod, (0.1, 1.24, 0.1), (-0.42, 0, 0.6), c["trim"], glow=0.5)
        self.muzzle = flash(self.pod, (2.0, 0, 0.2), 1.9)

    def recoil(self, k):
        self.pod.location = (-0.2 - 0.12 * k, 0, 1.55)


class Helicopter(Vehicle):
    """An attack helicopter. It is rendered standing on its skids; the page lifts it and
    lays its shadow on the ground. The rotor turns through the three idle frames."""

    cell, centre = 10.4, 1.5
    pivot = 1.5
    manifest = {"altitude": 3.0, "fps": {"idle": 16, "move": 16, "bankLeft": 16, "bankRight": 16}}
    facings = FACINGS

    def __init__(self, look):
        super().__init__(look)
        self.sheets[""] = [("idle", [0, 1, 2]), ("wreck", [0]), ("move", [0, 1, 2]), ("bankLeft", [0, 1, 2]), ("bankRight", [0, 1, 2])]

    def build(self, c):
        b = self.body
        # Fuselage: a narrow body, stepped cockpits, a tail boom rising to the fin.
        prism_y(b, [(2.6, 0.75), (2.9, 1.05), (2.2, 1.55), (1.2, 2.05), (-0.9, 2.05), (-1.5, 1.5), (-1.5, 0.95), (-0.6, 0.6), (1.7, 0.6)], 0.95, c["hull"])
        prism_y(b, [(2.28, 1.55), (1.3, 2.04), (0.35, 2.04), (0.6, 1.55)], 0.8, "#1f2a33")  # canopy
        box(b, (0.08, 0.84, 0.5), (1.3, 0, 1.78), c["hull2"])  # frame between the two seats
        prism_y(b, [(-1.4, 1.5), (-4.4, 1.62), (-4.4, 1.3), (-1.4, 1.0)], 0.34, c["hull2"])  # tail boom
        prism_y(b, [(-3.9, 1.6), (-4.5, 2.6), (-4.85, 2.6), (-4.5, 1.45)], 0.1, c["hull"])  # fin
        box(b, (0.5, 1.5, 0.06), (-4.3, 0, 1.75), c["hull2"])  # tailplane
        cyl(b, 0.5, 0.04, (-4.7, 0.12, 2.35), c["low"], axis="Y", sides=10)  # tail rotor disc
        box(b, (1.1, 0.7, 0.4), (-0.1, 0, 2.2), c["hull2"])  # engine housing
        box(b, (0.3, 0.74, 0.2), (-0.75, 0, 2.2), c["low"])  # exhaust
        for side in (1, -1):
            box(b, (0.9, 1.3, 0.08), (0.3, 0.95 * side, 1.2), c["hull2"])  # stub wing
            cyl(b, 0.17, 1.0, (0.4, 1.4 * side, 1.02), c["deck"], axis="X", sides=8)  # rocket pod
            cyl(b, 0.17, 0.04, (0.92, 1.4 * side, 1.02), "#14181b", axis="X", sides=8)
            box(b, (2.4, 0.07, 0.07), (0.6, 0.62 * side, 0.04), c["low"])  # skid
            for x in (1.3, -0.1):
                box(b, (0.07, 0.07, 0.62), (x, 0.56 * side, 0.34), c["low"], rot=(0.18 * side, 0, 0))
        box(b, (0.3, 0.06, 0.06), (2.7, 0, 1.12), c["trim"], glow=0.8)  # sensor at the nose
        cyl(b, 0.08, 0.5, (0.3, 0, 2.6), c["low"], sides=6)  # mast
        self.rotor = joint(b, (0.3, 0, 2.86))
        for a in (0, math.pi / 2):
            blade = box(self.rotor, (7.6, 0.2, 0.04), (0, 0, 0), c["low"], rot=(0, 0, a))
            blade["blade"] = True
        cyl(self.rotor, 0.2, 0.1, (0, 0, 0), c["hull2"], sides=8)

        t = self.turret
        self.gun = joint(t, (0, 0, 0.72))
        box(self.gun, (0.4, 0.3, 0.26), (0, 0, 0), c["low"])
        cyl(self.gun, 0.05, 0.9, (0.55, 0, -0.04), c["gun"], axis="X", sides=6)
        self.muzzle = flash(self.gun, (1.05, 0, -0.04), 0.9)

    def recoil(self, k):
        self.gun.location = (-0.08 * k, 0, 0.72)

    def pose(self, anim, t, sheet):
        super().pose(anim, t, sheet)
        self.rotor.rotation_euler = (0, 0, 0.5 if anim == "wreck" else t * math.pi / 6)
        if anim == "move":
            self.body.rotation_euler = (0, 0.15, 0)  # nose down, pulling itself forward
        if anim in ("bankLeft", "bankRight"):
            # Leaning into the turn: the left side drops in a turn to the left.
            self.body.rotation_euler = (0.34 * (-1 if anim == "bankLeft" else 1), 0.1, 0)
        if anim == "wreck":
            # Down on its side with the boom broken and the blades bent to the ground.
            self.body.rotation_euler = (0.5, -0.1, 0)
            self.body.location = (0, 0.3, -0.35)
            self.rotor.rotation_euler = (0.35, 0.25, 0.5)
            self.turret.location = (self.pivot - 0.3, 0.5, -0.4)


class Drone:
    """One small attack drone of a swarm: four arms, four rotors, a charge slung under it.
    Rendered at ground level; the page lifts it to its height and lays the shadow."""

    cell, centre = 3.6, 0.8
    facings = FACINGS
    sheets = {"": [("idle", [0, 1]), ("walk", [0, 1, 2, 3]), ("fire", [0, 1]), ("die", [0.2, 0.45, 0.7, 0.9, 1])]}
    manifest = {"per": "member", "altitude": 1.5, "fps": {"walk": 14, "idle": 10, "die": 9}}
    height = 1.5  # the height it flies at, which it falls from when it is shot down

    def __init__(self, look):
        c = look
        self.root = joint(None, name="root")
        self.body = joint(self.root, (0, 0, 0.2))
        box(self.body, (0.46, 0.2, 0.1), (0, 0, 0), c["gun"])  # frame
        box(self.body, (0.24, 0.16, 0.1), (-0.04, 0, 0.09), c["rust"])  # battery, taped on
        box(self.body, (0.26, 0.05, 0.03), (-0.04, 0, 0.15), c["trim"])  # the tape
        box(self.body, (0.08, 0.1, 0.08), (0.25, 0, 0.03), "#14181b")  # camera
        cyl(self.body, 0.02, 0.26, (-0.2, 0.05, 0.2), c["gun"], sides=4)  # aerial
        cyl(self.body, 0.075, 0.42, (0.06, 0, -0.12), c["armour"], axis="X", sides=8)  # the charge
        cyl(self.body, 0.09, 0.18, (0.36, 0, -0.12), c["rust"], axis="X", sides=8, top=0.02)
        self.props = []
        for sx in (1, -1):
            for sy in (1, -1):
                box(self.body, (0.5, 0.05, 0.04), (0.2 * sx, 0.2 * sy, 0.02), c["low"], rot=(0, 0, sx * sy * 0.78))  # arm
                cyl(self.body, 0.035, 0.08, (0.36 * sx, 0.36 * sy, 0.06), c["gun"], sides=6)  # motor
                prop = joint(self.body, (0.36 * sx, 0.36 * sy, 0.12))
                box(prop, (0.44, 0.05, 0.015), (0, 0, 0), c["trim"])
                self.props.append(prop)
        self.muzzle = flash(self.body, (0.46, 0, -0.12), 0.8)

    def pose(self, anim, t):
        show(self.root, True)
        show(self.muzzle, False)
        tilt, z, roll, turn = 0.0, 0.0, 0.0, 0.0
        spin = t * 1.3
        if anim == "idle":
            z = 0.04 * t
        if anim == "walk":
            tilt, z, spin = 0.3, 0.05 * math.sin(t * math.pi / 2), t * 0.9
        if anim == "fire":
            tilt = 0.55
            show(self.muzzle, t == 1)
        if anim == "die":
            # It tumbles out of the air and lies broken where it lands.
            z = self.height * (1 - t**1.6)
            roll, tilt, turn, spin = 2.4 * t, 1.1 * t, 1.5 * t, 0.4
            if t == 1:
                z, roll, tilt = -0.08, 2.9, 0.35
        self.body.location = (0, 0, 0.2 + z)
        self.body.rotation_euler = (roll, tilt, turn)
        for i, prop in enumerate(self.props):
            prop.rotation_euler = (0, 0, spin + i * 0.8)


GOLD = ["#e8b830", "#f4d35e", "#c9931c"]


def gold_heap(parent, loc, size, lumps=9, seed=3):
    """A heap of gold lumps centred on loc, `size` metres across. The lumps glow a little so
    the load reads at game size."""
    root = joint(parent, loc, "gold")
    state = seed * 7919 + 13
    for i in range(lumps):
        state = (state * 1103515245 + 12345) % (1 << 31)
        a = (state % 628) / 100
        state = (state * 1103515245 + 12345) % (1 << 31)
        r = (state % 100) / 100 * size / 2 * (0.25 + 0.75 * i / lumps)
        z = 0.07 * (lumps - i) / lumps * size * 2
        lump = ball(root, 0.1 + 0.07 * ((i * 5) % 3) / 2, (r * math.cos(a), r * math.sin(a), z), GOLD[i % 3], squash=0.8)
        lump.active_material = mat(GOLD[i % 3], 0.35)
    return root


class Hauler:
    """The gold collector: a cab, an open hopper that tips to unload, and a loading arm at
    the front that reaches down into the field. It carries no weapon."""

    cell, centre = 8.2, 1.0
    facings = FACINGS
    sheets = {"": [("idle", [0]), ("move", [0, 1]), ("full", [0]), ("moveFull", [0, 1]),
                   ("load", [0.2, 0.55, 0.9]), ("unload", [0.35, 0.7, 1.0]), ("wreck", [0])]}
    manifest = {"fps": {"move": 6, "moveFull": 6, "load": 4, "unload": 4}}

    def __init__(self, look, improvised):
        c = look
        self.improvised = improvised
        self.root = joint(None, name="root")
        self.body = joint(self.root, name="body")
        b = self.body
        tyre = "#1a1917" if improvised else "#17191b"
        for x in ((1.7, -0.4, -1.6) if not improvised else (1.6, -1.35)):
            for side in (1, -1):
                cyl(b, 0.46, 0.36, (x, 0.95 * side, 0.46), tyre, axis="Y", sides=10)
                cyl(b, 0.2, 0.38, (x, 0.95 * side, 0.46), c["hull2"], axis="Y", sides=6)
        box(b, (4.9, 1.5, 0.26), (0, 0, 0.78), c["low"])  # frame
        if improvised:
            # An old tipper lorry: a rounded bonnet, a patched cab, a plank-sided body.
            box(b, (1.0, 1.5, 0.5), (2.0, 0, 1.15), c["hull"])  # bonnet
            box(b, (0.1, 1.2, 0.34), (2.52, 0, 1.12), c["low"])  # grille
            box(b, (0.14, 1.76, 0.2), (2.55, 0, 0.8), c["rust"])  # bumper
            prism_y(b, [(0.55, 0.9), (1.5, 0.9), (1.5, 1.45), (1.3, 2.05), (0.55, 2.05)], 1.66, c["hull"])
            prism_y(b, [(1.52, 1.5), (1.33, 2.0), (1.27, 2.0), (1.46, 1.5)], 1.4, "#1f2a33")  # windscreen
            box(b, (0.5, 1.7, 0.3), (0.95, 0, 1.75), "#1f2a33")  # side windows
            box(b, (0.6, 1.72, 0.36), (1.0, 0, 1.2), c["rust"])  # patched doors
            box(b, (0.7, 1.0, 0.14), (0.95, 0.1, 2.12), c["armour"])  # bedroll on the roof
        else:
            # A clean forward-control cab with a light bar.
            prism_y(b, [(1.2, 0.9), (2.55, 0.9), (2.55, 1.5), (2.2, 2.1), (1.2, 2.1)], 1.72, c["hull"])
            prism_y(b, [(2.57, 1.52), (2.24, 2.06), (2.16, 2.06), (2.49, 1.52)], 1.44, "#1f2a33")  # windscreen
            box(b, (0.6, 1.76, 0.3), (1.65, 0, 1.78), "#1f2a33")  # side windows
            box(b, (0.14, 1.78, 0.22), (2.58, 0, 0.84), c["low"])  # bumper
            box(b, (0.3, 0.06, 0.06), (2.56, 0.55, 1.16), c["trim"], glow=0.6)
            box(b, (0.3, 0.06, 0.06), (2.56, -0.55, 1.16), c["trim"], glow=0.6)
            box(b, (0.5, 1.2, 0.08), (1.7, 0, 2.16), "#e0a82e", glow=0.5)  # amber light bar
        # The hopper tips about a hinge at the rear of the frame.
        back = -2.25 if not improvised else -2.2
        self.hopper = joint(b, (back, 0, 0.95))
        h = self.hopper
        length = 3.2 if not improvised else 2.6
        wall = c["hull2"] if not improvised else c["wood"]
        box(h, (length, 1.7, 0.1), (length / 2, 0, 0.04), c["low"])  # floor
        for side in (1, -1):
            box(h, (length, 0.1, 0.8), (length / 2, 0.82 * side, 0.45), wall)
            if improvised:
                box(h, (length, 0.12, 0.1), (length / 2, 0.83 * side, 0.62), c["rust"])  # iron strap
            else:
                box(h, (length, 0.12, 0.1), (length / 2, 0.83 * side, 0.8), c["trim"], glow=0.3)
        box(h, (0.1, 1.7, 0.95), (length, 0, 0.52), wall)  # head board behind the cab
        box(h, (0.1, 1.7, 0.6), (0.02, 0, 0.35), wall if improvised else c["hull"])  # tail gate
        self.load = gold_heap(h, (length / 2, 0, 0.12), 1.7, lumps=26)
        self.load.scale = (length / 2.1, 1.0, 1.0)
        # The loading arm: a boom from beside the cab to a scoop at the front.
        self.arm = joint(b, (2.2 if not improvised else 2.3, -0.98, 1.3))
        box(self.arm, (1.5, 0.14, 0.14), (0.7, 0, 0), c["hull2"] if not improvised else c["rust"])
        self.scoop = joint(self.arm, (1.45, 0, 0))
        box(self.scoop, (0.5, 0.7, 0.08), (0.15, 0.3, -0.25), c["low"])
        box(self.scoop, (0.08, 0.7, 0.4), (-0.08, 0.3, -0.08), c["low"])
        box(self.scoop, (0.1, 0.1, 0.4), (0, 0, -0.12), c["hull2"] if not improvised else c["rust"])
        self.scoopload = gold_heap(self.scoop, (0.15, 0.3, -0.2), 0.45, lumps=5, seed=5)

    def pose(self, anim, t):
        show(self.root, True)
        char(self.root, anim == "wreck")
        self.body.location = (0, 0, 0)
        self.body.rotation_euler = (0, 0, 0)
        self.hopper.rotation_euler = (0, 0, 0)
        self.arm.rotation_euler = (0, -0.75, 0)  # stowed, raised over the bonnet
        self.scoop.rotation_euler = (0, 0.75, 0)
        level = {"idle": 0, "move": 0, "full": 1, "moveFull": 1, "load": t, "unload": 1 - t, "wreck": 0}[anim]
        show(self.load, level > 0.05)
        self.load.scale = (self.load.scale[0], 1.0, max(0.05, 1.5 * level))
        self.load.location = (self.load.location[0], 0, 0.12)
        show(self.scoopload, False)
        if anim in ("move", "moveFull"):
            self.body.location = (0, 0, 0.03 * t)
            self.body.rotation_euler = (0, 0.012 * (1 - 2 * t), 0)
        if anim == "load":
            # The arm swings down to the ground and comes up full.
            down = math.sin(math.pi * min(1, t * 1.25))
            self.arm.rotation_euler = (0, -0.75 + 1.4 * down, 0)
            self.scoop.rotation_euler = (0, 0.75 - 1.4 * down, 0)
            show(self.scoopload, t > 0.4)
        if anim == "unload":
            # The front of the hopper rises and the load slides out over the tail gate.
            self.hopper.rotation_euler = (0, -0.8 * math.sin(math.pi * min(1, t) / 2) * (1 if t < 1 else 0.5), 0)
        if anim == "wreck":
            self.body.rotation_euler = (0.07, -0.04, 0)
            self.hopper.rotation_euler = (0.1, -0.2, 0.06)
            self.arm.rotation_euler = (0.3, 0.5, 0.4)


class Engineer(Soldier):
    """An infantryman who builds and breaks: a tool pack, a bright helmet or scarf, and a
    working pose down on one knee with a hammer."""

    sheets = {"": Soldier.sheets[""] + [("work", [0, 1])]}
    manifest = {"per": "member", "fps": {"walk": 16, "die": 9, "work": 5}}

    def __init__(self, look, militia):
        super().__init__({**look, "head": "#e0a82e" if not militia else "#c9682c"}, militia)
        c = look
        box(self.torso, (0.24, 0.42, 0.34), (-0.3, 0, 0.3), "#e0a82e" if not militia else c["rust"])  # tool pack
        box(self.torso, (0.06, 0.06, 0.5), (-0.34, -0.16, 0.5), c["gun"])  # a bar strapped to it
        cyl(self.torso, 0.14, 0.1, (-0.4, 0.1, 0.52), "#d8d2c0", axis="X", sides=8)  # coil of wire
        self.tool = joint(self.torso, (0.5, -0.1, 0.3))
        box(self.tool, (0.06, 0.06, 0.44), (0, 0, 0.1), c.get("wood", "#6b4526"))
        box(self.tool, (0.22, 0.1, 0.1), (0, 0, 0.34), "#5a6068")
        self.spark = joint(self.torso, (0.75, -0.1, -0.05))
        ball(self.spark, 0.09, (0, 0, 0), "#fff3c4").active_material = mat("#fff3c4", 14)
        ball(self.spark, 0.05, (0.12, 0.08, 0.08), "#ffd27a").active_material = mat("#ffd27a", 10)
        ball(self.spark, 0.04, (-0.05, -0.1, 0.12), "#ffd27a").active_material = mat("#ffd27a", 10)

    def pose(self, anim, t):
        super().pose("cover" if anim == "work" else anim, t)
        show(self.tool, anim == "work")
        show(self.spark, anim == "work" and t == 1)
        if anim == "work":
            show(self.rifle, False)
            show(self.muzzle, False)
            self.torso.rotation_euler = (0, 0.38, 0)
            self.head.rotation_euler = (0, 0.35, 0)
            swing = 0.9 if t == 0 else 1.5
            for (shoulder, elbow), (sw, bend, inward), side in zip(self.arms, [(swing, 0.5, 0.3), (1.2, 0.7, 0.3)], (1, -1)):
                shoulder.rotation_euler = (-inward * side, -sw, 0)
                elbow.rotation_euler = (0, -bend, 0)
            self.tool.rotation_euler = (0, 0.3 if t == 0 else 1.3, 0)



def strip(parent):
    """Takes away everything built under a joint, to build something else there."""
    for child in list(parent.children):
        strip(child)
        bpy.data.objects.remove(child, do_unlink=True)


class Sentinel(Soldier):
    """The Aegis hero: a lone marksman under a hooded cloak, with a rifle as long as he is
    tall and a satchel of demolition charges. A head taller than the rank and file."""

    cell, centre, scale = 5.6, 0.9, 1.16
    sheets = {"": Soldier.sheets[""] + [("prone", [0]), ("proneFire", [0, 1]), ("plant", [0, 1, 2])]}
    manifest = {"per": "member", "hero": True, "fps": {"walk": 16, "die": 9, "plant": 4}}

    def __init__(self):
        c = {**AEGIS, "cloth": "#3c4d5e", "armour": "#5b7186", "head": "#2b3844", "dark": "#232e38"}
        super().__init__(c, militia=False)
        pale = "#d5e3ec"
        # The hood, peaked at the back, and the cloak hanging in three ragged strips.
        ball(self.head, 0.25, (-0.04, 0, 0.2), c["head"], squash=0.95)
        box(self.head, (0.26, 0.3, 0.2), (-0.24, 0, 0.12), c["head"], rot=(0, 0.5, 0))
        self.cloak = joint(self.torso, (-0.24, 0, 0.5))
        for dy, length, lean in ((-0.2, 0.86, 0.16), (0.0, 1.02, 0.1), (0.2, 0.8, 0.2)):
            box(self.cloak, (0.07, 0.2, length), (-0.04 - lean * length / 2, dy, -length / 2), c["dark"], rot=(0, -lean, 0))
            box(self.cloak, (0.075, 0.2, 0.07), (-0.04 - lean * length, dy, -length), pale)  # the pale hem
        box(self.torso, (0.34, 0.6, 0.12), (0.0, 0, 0.5), c["dark"])  # the cloak across the shoulders
        box(self.torso, (0.1, 0.5, 0.1), (0.14, 0, 0.5), pale)  # a pale scarf at the throat
        # The satchel of charges on the hip.
        box(self.pelvis, (0.26, 0.14, 0.3), (-0.02, -0.3, -0.06), "#e0a82e")
        box(self.pelvis, (0.27, 0.15, 0.06), (-0.02, -0.3, -0.02), "#1b1f22")
        # The long rifle: a heavy barrel with a muzzle brake, a big sight, a folded bipod.
        strip(self.rifle)
        r = self.rifle
        box(r, (0.5, 0.09, 0.15), (-0.28, 0, -0.02), c["dark"])  # stock
        box(r, (0.5, 0.1, 0.13), (0.15, 0, 0), c["gun"])  # receiver
        cyl(r, 0.035, 1.25, (1.0, 0, 0.02), c["gun"], axis="X", sides=6)  # barrel
        cyl(r, 0.06, 0.22, (1.68, 0, 0.02), "#3a4148", axis="X", sides=6)  # muzzle brake
        cyl(r, 0.065, 0.5, (0.2, 0, 0.15), "#3a4148", axis="X", sides=8)  # sight
        cyl(r, 0.066, 0.03, (0.46, 0, 0.15), c["trim"], axis="X", sides=8, glow=1.6)  # its lens
        box(r, (0.08, 0.07, 0.2), (0.05, 0, -0.14), c["gun"])  # grip
        box(r, (0.3, 0.04, 0.04), (0.78, 0.05, -0.07), c["gun"])  # bipod, folded
        box(r, (0.3, 0.04, 0.04), (0.78, -0.05, -0.07), c["gun"])
        self.muzzle = flash(r, (1.92, 0, 0.02), 0.9)
        # A charge, for the planting pose: it is put down a step in front of him.
        self.charge = joint(self.size, (0.75, 0, 0.09))
        box(self.charge, (0.34, 0.26, 0.16), (0, 0, 0), "#e0a82e")
        box(self.charge, (0.36, 0.06, 0.17), (0, 0, 0), "#1b1f22")
        self.lamp = ball(self.charge, 0.055, (0.08, 0.08, 0.1), "#ff5a3c")
        self.lamp.active_material = mat("#ff5a3c", 12)

    def pose(self, anim, t):
        prone = anim in ("prone", "proneFire")
        super().pose("cover" if anim == "plant" else "idle" if prone else anim, t)
        show(self.charge, anim == "plant")
        show(self.lamp, anim == "plant" and t == 2)
        self.cloak.rotation_euler = (0, 0.5 if anim == "walk" else 0.12, 0)  # it streams out behind a walking man
        if prone:
            # Flat on his front along the line of fire, on his elbows behind the rifle.
            self.fall.rotation_euler = (0, 1.42, 0)
            self.fall.location = (-0.95, 0, 0.2)
            self.pelvis.location = (0, 0, 0.8)
            self.torso.rotation_euler = (0, -0.14, 0)
            self.head.rotation_euler = (0, -1.0, 0)
            self.cloak.rotation_euler = (0, -0.1, 0)
            for (hip, knee), spread in zip(self.legs, (0.22, -0.22)):
                hip.rotation_euler = (spread, 0.12, 0)
                knee.rotation_euler = (0, 0.05, 0)
            for (shoulder, elbow), side in zip(self.arms, (1, -1)):
                shoulder.rotation_euler = (-0.5 * side, -2.3, 0)
                elbow.rotation_euler = (0, -1.2, 0)
            self.rifle.location = (0.2, -0.1, 0.72)
            self.rifle.rotation_euler = (0, -1.3, 0)
            show(self.muzzle, anim == "proneFire" and t == 1)
        if anim == "plant":
            # On one knee, the rifle slung, setting the charge down and arming it.
            self.rifle.location = (-0.3, 0.0, 0.2)
            self.rifle.rotation_euler = (0, -1.2, 0.3)
            reach = [0.8, 1.25, 0.9][int(t)]
            for (shoulder, elbow), side in zip(self.arms, (1, -1)):
                shoulder.rotation_euler = (-0.25 * side, -reach, 0)
                elbow.rotation_euler = (0, -0.5, 0)
            self.torso.rotation_euler = (0, 0.3 + 0.18 * (t == 1), 0)
            self.head.rotation_euler = (0, 0.4, 0)
            self.charge.location = (0.75, 0, 0.42 if t == 0 else 0.09)


class Oracle(Soldier):
    """The Ashfall hero: a hooded figure in a long travelling robe. Seen plainly there is an
    ochre scarf down the back, a lit amulet and a short carbine; in disguise there is only a
    drab cloak, a bundle and a staff, and nothing to tell him from a traveller."""

    cell, centre, scale = 4.4, 0.95, 1.16
    sheets = {"": Soldier.sheets[""] + [("disguise", [0]), ("disguiseWalk", [i / 12 for i in range(12)]), ("seize", [0, 1, 2])]}
    manifest = {"per": "member", "hero": True, "fps": {"walk": 16, "disguiseWalk": 13, "die": 9, "seize": 5}}

    def __init__(self):
        c = {**ASHFALL, "cloth": "#c9b488", "armour": "#b09a6e", "dark": "#6a5236", "head": "#c9b488"}
        super().__init__(c, militia=True)
        ochre, drab = "#d9772b", "#8b8474"
        eight = [(0.3 * math.cos(i * math.pi / 4), 0.3 * math.sin(i * math.pi / 4)) for i in range(8)]
        # The robe, to the ankles, and a deep hood.
        prism_z(self.pelvis, eight, -0.74, 0.08, c["cloth"], bottom=1.45, top=0.95)
        ball(self.head, 0.26, (-0.04, 0, 0.2), c["cloth"], squash=1.0)
        box(self.head, (0.06, 0.24, 0.22), (0.17, 0, 0.16), "#2a2018")  # the face, lost in the hood's shadow
        box(self.head, (0.24, 0.3, 0.26), (-0.24, 0, 0.1), c["cloth"], rot=(0, 0.6, 0))  # the hood's point
        # What marks him out: a long ochre scarf, a sash, an amulet that glows.
        self.marks = joint(self.torso)
        box(self.marks, (0.07, 0.24, 0.95), (-0.25, 0.04, 0.08), ochre, rot=(0, -0.12, 0))
        box(self.marks, (0.36, 0.56, 0.1), (0.0, 0, 0.5), ochre)
        box(self.marks, (0.33, 0.52, 0.09), (0.0, 0, 0.02), ochre)  # sash
        amulet = ball(self.marks, 0.06, (0.2, 0, 0.36), "#ffd27a")
        amulet.active_material = mat("#ffd27a", 5)
        # The disguise: a drab cloak over everything, a bundle on the back, a staff.
        self.cover = joint(self.torso)
        box(self.cover, (0.4, 0.62, 0.6), (-0.02, 0, 0.28), drab)
        box(self.cover, (0.3, 0.44, 0.36), (-0.32, 0, 0.34), "#6f6656")  # bundle
        cyl(self.cover, 0.09, 0.5, (-0.3, 0, 0.6), "#a39a84", axis="Y", sides=8)  # bedroll on it
        self.skirt = prism_z(self.pelvis, [(x * 1.06, y * 1.06) for x, y in eight], -0.6, 0.1, drab, bottom=1.42, top=0.95)
        self.staff = joint(self.torso, (0.34, -0.36, 0.0))
        cyl(self.staff, 0.03, 1.7, (0, 0, 0.1), "#5b4127", sides=6)
        # A short carbine in place of the rifle.
        strip(self.rifle)
        r = self.rifle
        box(r, (0.42, 0.08, 0.13), (0.0, 0, 0), c["gun"])
        box(r, (0.2, 0.06, 0.08), (-0.26, 0, -0.02), ASHFALL["wood"])
        cyl(r, 0.035, 0.28, (0.34, 0, 0.02), c["gun"], axis="X", sides=6)
        box(r, (0.07, 0.06, 0.24), (0.04, 0, -0.14), c["gun"], rot=(0, -0.3, 0))
        self.muzzle = flash(r, (0.56, 0, 0.02), 0.5)
        # The seizing: a ring of light opening over the raised hand.
        self.orb = joint(self.torso, (0.62, 0.3, 0.86))
        for i in range(8):
            spark = ball(self.orb, 0.045, (0, 0.2 * math.cos(i * math.pi / 4), 0.2 * math.sin(i * math.pi / 4)), "#ffd27a")
            spark.active_material = mat("#ffd27a", 14)
        core = ball(self.orb, 0.07, (0, 0, 0), "#fff3c4")
        core.active_material = mat("#fff3c4", 16)

    def pose(self, anim, t):
        hidden = anim in ("disguise", "disguiseWalk")
        super().pose({"disguise": "idle", "disguiseWalk": "walk", "seize": "idle"}.get(anim, anim), t)
        show(self.cover, hidden)
        show(self.skirt, hidden)
        show(self.staff, hidden)
        show(self.marks, not hidden)
        show(self.orb, anim == "seize")
        if hidden:
            show(self.rifle, False)
            show(self.muzzle, False)
            # Hands low, one on the staff, which swings with the stride.
            swing = 0.3 * math.sin(2 * math.pi * t) if anim == "disguiseWalk" else 0
            for (shoulder, elbow), (sw, bend, inward), side in zip(self.arms, [(0.35, 0.5, 0.2), (0.55 + swing, 0.7, 0.05)], (1, -1)):
                shoulder.rotation_euler = (-inward * side, -sw, 0)
                elbow.rotation_euler = (0, -bend, 0)
            self.torso.rotation_euler = (0, 0.24 if anim == "disguiseWalk" else 0.14, 0)  # bent under the bundle
            self.head.rotation_euler = (0, 0.25, 0)
            self.staff.rotation_euler = (0, 0.16 + 0.5 * swing, 0)
        if anim == "seize":
            # The carbine drops to his side and the open hand comes up toward the machine.
            self.rifle.location = (0.12, -0.3, 0.04)
            self.rifle.rotation_euler = (0, 1.1, 0)
            lift = [1.5, 2.0, 2.15][int(t)]
            (ls, le), (rs, re) = self.arms
            ls.rotation_euler = (-0.1, -lift, 0)
            le.rotation_euler = (0, -0.25, 0)
            rs.rotation_euler = (0.2, -0.3, 0)
            re.rotation_euler = (0, -0.6, 0)
            self.torso.rotation_euler = (0, -0.06, 0)
            self.head.rotation_euler = (0, -0.2, 0)
            self.orb.scale = ([0.45, 0.8, 1.15][int(t)],) * 3
            self.orb.rotation_euler = (t * 0.35, 0, 0)


UNITS = {
    "commandos": lambda: Soldier(AEGIS, militia=False),
    "militia": lambda: Soldier(ASHFALL, militia=True),
    "tank": lambda: Tank(AEGIS),
    "technical": lambda: Technical(ASHFALL),
    "patrolBoat": lambda: PatrolBoat(AEGIS),
    "speedboat": lambda: Speedboat(ASHFALL),
    "helicopter": lambda: Helicopter(AEGIS),
    "rocketLauncher": lambda: RocketLauncher(AEGIS),
    "fpvSwarm": lambda: Drone(ASHFALL),
    "rpgTeam": lambda: Soldier(ASHFALL, militia=True, rocket=True),
    "aegis_hauler": lambda: Hauler(AEGIS, improvised=False),
    "ashfall_hauler": lambda: Hauler(ASHFALL, improvised=True),
    "aegis_engineer": lambda: Engineer(AEGIS, militia=False),
    "ashfall_sapper": lambda: Engineer(ASHFALL, militia=True),
    "aegis_sentinel": Sentinel,
    "ashfall_oracle": Oracle,
}

# ---------------------------------------------------------------- render and pack


def render_unit(name):
    scene = setup_scene()
    model = UNITS[name]()
    size, origin = aim_camera(scene, model.cell, model.centre)
    frames = {}  # sheet suffix → rows of images, one row per heading
    for suffix, anims in model.sheets.items():
        rows = [[] for _ in model.facings]
        for anim, times in anims:
            for i, t in enumerate(times):
                if isinstance(model, Vehicle):
                    model.pose(anim, t, suffix)
                else:
                    model.pose(anim, t)
                for f in range(len(model.facings)):
                    # Map headings run clockwise seen from above; Blender's turn the other way.
                    model.root.rotation_euler = (0, 0, -f * 2 * math.pi / len(model.facings))
                    path = RAW / name / f"{suffix or 'body'}_{anim}_{i}_{f}.png"
                    scene.render.filepath = str(path)
                    bpy.ops.render.render(write_still=True)
                    rows[f].append(Image.open(path).convert("RGBA"))
        frames[suffix] = rows
    return model, size, origin, frames


def outlined(image):
    """A one-pixel dark edge, so the unit reads against any ground."""
    alpha = image.getchannel("A")
    edge = alpha.filter(ImageFilter.MaxFilter(3))
    under = Image.new("RGBA", image.size, OUTLINE + (0,))
    under.putalpha(edge.point(lambda a: int(a * 0.85)))
    return Image.alpha_composite(under, image)


def save_small(image, path):
    """Saves a sheet with a palette of 256 colours. The models are flat-shaded, so this is
    about a sixth of the size of full colour and differs from it by two levels in 255."""
    image.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(path, optimize=True)


def pack(name, suffix, rows, origin):
    rows = [[outlined(im) for im in row] for row in rows]
    # Every frame is cropped to the one box that holds them all, so the origin stays put.
    box_ = None
    for row in rows:
        for im in row:
            b = im.getchannel("A").point(lambda a: 255 if a > 6 else 0).getbbox()
            if b:
                box_ = b if box_ is None else (min(box_[0], b[0]), min(box_[1], b[1]), max(box_[2], b[2]), max(box_[3], b[3]))
    left, top, right, bottom = box_[0] - 1, box_[1] - 1, box_[2] + 1, box_[3] + 1
    w, h = right - left, bottom - top
    sheet = Image.new("RGBA", (w * len(rows[0]), h * len(rows)), (0, 0, 0, 0))
    for r, row in enumerate(rows):
        for c, im in enumerate(row):
            sheet.paste(im.crop((left, top, right, bottom)), (c * w, r * h))
    rel = f"units/{name}{suffix}.png"
    (OUT / "units").mkdir(parents=True, exist_ok=True)
    save_small(sheet, OUT / rel)
    anchor = [round((origin[0] - left) / w, 4), round((origin[1] - top) / h, 4)]
    print(f"{rel}  {sheet.width}x{sheet.height}, frame {w}x{h}")
    return rel, [w, h], anchor, sheet


def anim_table(anims):
    table, at = {}, 0
    for anim, times in anims:
        table[anim] = [at, len(times)]
        at += len(times)
    return table


def contact_sheet(sheets, path, tall=2600):
    """Every sheet on one page, in as many columns as it takes."""
    pad, gap = 16, 28
    places, x, y, wide = [], pad, pad, 0
    for label, sheet in sheets:
        if y > pad and y + sheet.height > tall:
            x, y, wide = x + wide + gap, pad, 0
        places.append((label, sheet, x, y))
        y += sheet.height + gap
        wide = max(wide, sheet.width)
    page = Image.new("RGBA", (x + wide + pad, tall + pad), (104, 112, 70, 255))
    draw = ImageDraw.Draw(page)
    for label, sheet, x, y in places:
        draw.text((x, y - 2), label, fill=(20, 24, 20))
        page.alpha_composite(sheet, (x, y + 12))
    page.convert("RGB").save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("units", nargs="*", help="units to render (default: all)")
    ap.add_argument("--sheet", help="also write a contact sheet to this path")
    args = ap.parse_args()

    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    manifest.setdefault("units", {})
    page = []
    for name in args.units or UNITS:
        model, _, origin, frames = render_unit(name)
        entry = {"facings": len(model.facings), "order": model.facings, "heading": "map", "ppm": PPM, **model.manifest}
        for suffix, rows in frames.items():
            rel, frame, anchor, sheet = pack(name, suffix, rows, origin)
            part = {"image": rel, "frame": frame, "anchor": anchor, "anims": anim_table(model.sheets[suffix])}
            if suffix:
                entry["turret"] = {**part, "pivot": model.pivot}
            else:
                entry.update(part)
            page.append((f"{name}{suffix}: " + ", ".join(f"{a} x{len(t)}" for a, t in model.sheets[suffix]), sheet))
        manifest["units"][name] = entry
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    if args.sheet:
        contact_sheet(page, args.sheet)


if __name__ == "__main__":
    main()
