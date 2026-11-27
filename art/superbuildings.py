"""Renders the two Super Weapon complexes (Aegis `strategicCommand` and Ashfall `blackSite`),
their 4 construction stages, their battle ruins, and their 144x96 build-panel icons in
Blender 4.2 Cycles AgX PBR, and updates assets/sprites/manifest.json.
"""
import json
import math
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import bpy
from PIL import Image
from units import (
    AEGIS, ASHFALL, CHARRED, OUT, RAW, ball, box, char, cyl, joint, mat, prism_y, prism_z, save_small, setup_scene, show, taper_box, aim_camera,
)


def build_strategic_command():
    """Aegis Strategic Command: armoured octagonal orbital bunker, recessed blast doors,
    vertical plasma/laser uplink tower, gold-foil satcom dish and cooling banks."""
    c = AEGIS
    root = joint(None, name="strategicCommand")
    s1 = joint(root, name="stage1")
    s2 = joint(root, name="stage2")
    s3 = joint(root, name="stage3")
    s4 = joint(root, name="stage4")
    fin = joint(root, name="finished")
    ruin_extra = joint(root, name="ruin_extra")

    # Stage 1: Heavy octagonal concrete foundation pad + perimeter anchor bolts + rebar
    octa = [(3.4 * math.cos(i * math.pi / 4 + math.pi / 8), 3.4 * math.sin(i * math.pi / 4 + math.pi / 8)) for i in range(8)]
    prism_z(s1, octa, 0.0, 0.42, "#464d54", bottom=1.04, top=1.0, bevel=0.05, finish="paint")
    for sx in (-2.2, 2.2):
        for sy in (-2.2, 2.2):
            box(s1, (0.55, 0.55, 0.24), (sx, sy, 0.48), c["low"], bevel=0.03, finish="metal")

    # Stage 2: Sloped composite armoured bunker walls + side capacitor cooling banks
    prism_z(s2, octa, 0.40, 1.85, c["hull"], bottom=0.92, top=0.78, bevel=0.06, finish="paint")
    for side in (-1, 1):
        box(s2, (2.2, 0.72, 1.05), (-0.4, 2.55 * side, 0.92), c["hull2"], bevel=0.04, finish="paint")
        for k in range(-2, 3):
            box(s2, (0.18, 0.78, 0.78), (-0.4 + k * 0.4, 2.55 * side, 0.94), c["gun"], bevel=0.015, finish="metal")

    # Stage 3: Upper command deck + central recessed orbital silo iris + reinforced blast shutters
    prism_z(s3, octa, 1.84, 2.35, c["deck"], bottom=0.78, top=0.70, bevel=0.04, finish="paint")
    cyl(s3, 1.38, 0.28, (0.2, 0.0, 2.42), c["low"], sides=16, bevel=0.03, finish="metal")
    cyl(s3, 1.05, 0.16, (0.2, 0.0, 2.52), "#141d26", sides=16, bevel=0.02, finish="glass")
    for i in range(4):
        ang = i * math.pi / 2 + math.pi / 4
        box(s3, (0.85, 0.28, 0.14), (0.2 + math.cos(ang) * 0.95, math.sin(ang) * 0.95, 2.58), c["hull2"], rot=(0, 0, ang), bevel=0.02, finish="metal")

    # Stage 4: Rear orbital laser uplink tower + braced lattice + power conduits
    taper_box(s4, (1.1, 1.1), (0.65, 0.65), 2.35, (-1.65, -1.15, 3.35), c["hull2"], bevel=0.04, finish="paint")
    cyl(s4, 0.22, 1.35, (-1.65, -1.15, 4.95), c["deck"], sides=12, bevel=0.02, finish="metal")
    for z in (2.8, 3.6, 4.3):
        cyl(s4, 0.42, 0.10, (-1.65, -1.15, z), c["gun"], sides=12, bevel=0.015, finish="metal")

    # Finished details: glowing cyan orbital core, gold-foil satcom dish, warning beacon
    core = cyl(fin, 0.56, 0.08, (0.2, 0.0, 2.59), "#66e3ff", sides=16, glow=3.2)
    _ = core
    orb = ball(fin, 0.24, (-1.65, -1.15, 5.72), "#7ce8ff")
    orb.active_material = mat("#7ce8ff", 3.5)
    # Steerable satcom dish on opposite corner
    cyl(fin, 0.16, 0.95, (-1.45, 1.55, 2.75), c["gun"], sides=10, finish="metal")
    dish = cyl(fin, 0.78, 0.16, (-1.35, 1.55, 3.35), c["deck"], sides=16, top=0.2, bevel=0.02, finish="paint")
    dish.rotation_euler = (0.35, 0.45, -0.4)
    ball(fin, 0.14, (-1.15, 1.38, 3.55), "#e0a82e", finish="metal")
    # Warning lamp
    wlamp = ball(fin, 0.13, (1.75, -1.35, 2.48), "#ff5238")
    wlamp.active_material = mat("#ff5238", 2.6)

    # Ruin extra: broken tilted mast & collapsed rubble slabs
    box(ruin_extra, (1.8, 0.9, 0.35), (0.4, 0.3, 0.8), "#2a2826", rot=(0.3, -0.4, 0.5), bevel=0.03, finish="rust")
    cyl(ruin_extra, 0.20, 2.4, (-0.5, -0.8, 1.1), "#242628", sides=10, rot_extra=(0.9, 0.6, 0.2), finish="metal")

    return root, [s1, s2, s3, s4], fin, ruin_extra


def build_black_site():
    """Ashfall Black-Site Silo: reinforced concrete desert missile pit, open rusted blast doors,
    erector gantry frame, ballistic missile nosecone, sandbags, fuel drums & camo tarp."""
    c = ASHFALL
    root = joint(None, name="blackSite")
    s1 = joint(root, name="stage1")
    s2 = joint(root, name="stage2")
    s3 = joint(root, name="stage3")
    s4 = joint(root, name="stage4")
    fin = joint(root, name="finished")
    ruin_extra = joint(root, name="ruin_extra")

    # Stage 1: Sunken concrete silo apron + recessed dark launch shaft + sandbag berm
    box(s1, (6.4, 6.0, 0.42), (0, 0, 0.21), "#7d6d54", bevel=0.05, finish="cloth")
    cyl(s1, 1.65, 0.48, (0.25, -0.15, 0.38), "#4c4337", sides=18, bevel=0.04, finish="rust")
    cyl(s1, 1.28, 0.52, (0.25, -0.15, 0.40), "#12100e", sides=18, finish="metal")

    # Stage 2: Bolted rust-armoured control bunker + generator exhaust + fuel drums
    taper_box(s2, (2.6, 5.2), (2.3, 4.8), 1.55, (-1.85, 0.0, 1.15), c["hull"], bevel=0.05, finish="rust")
    box(s2, (2.45, 4.9, 0.48), (-1.85, 0.0, 0.85), c["rust"], bevel=0.03, finish="rust")
    for dy in (-1.4, -0.85):
        cyl(s2, 0.32, 0.88, (1.85, dy, 0.84), c["armour"], sides=12, bevel=0.02, finish="paint")
    # Sandbag wall along front edge
    for k in range(-2, 3):
        box(s2, (0.68, 0.34, 0.26), (2.55, k * 0.72, 0.54), "#b59a66", bevel=0.06, finish="cloth")

    # Stage 3: Heavy hinged open steel blast doors flanking the missile shaft + camo tarp roof
    for side in (-1, 1):
        box(s3, (2.35, 0.22, 1.55), (0.25, -0.15 + side * 1.55, 1.15), c["rust"], rot=(side * -0.42, 0, 0), bevel=0.03, finish="rust")
        box(s3, (2.15, 0.25, 0.24), (0.25, -0.15 + side * 1.78, 1.65), "#d99b26", rot=(side * -0.42, 0, 0), bevel=0.015, finish="paint")
    cyl(s3, 0.26, 2.8, (-1.75, 0.2, 2.08), c["armour"], axis="Y", sides=12, bevel=0.04, finish="cloth")

    # Stage 4: Tall welded steel erector gantry frame + crane boom over the silo
    for sy in (-1.35, 1.05):
        cyl(s4, 0.11, 3.8, (-0.75, sy, 2.25), c["low"], sides=8, finish="metal")
    box(s4, (2.2, 2.6, 0.22), (0.15, -0.15, 4.12), c["low"], bevel=0.02, finish="metal")
    cyl(s4, 0.09, 1.6, (-1.95, -1.85, 2.75), c["gun"], sides=8, finish="metal")

    # Finished details: Heavy ballistic missile warhead emerging in shaft + warm warning lamp!
    cyl(fin, 0.54, 2.1, (0.25, -0.15, 1.35), "#575a42", sides=16, bevel=0.02, finish="paint")
    cyl(fin, 0.54, 1.05, (0.25, -0.15, 2.92), c["rust"], sides=16, top=0.06, finish="rust")
    # Silo shaft warm under-glow + warning strobe
    cyl(fin, 1.05, 0.05, (0.25, -0.15, 0.52), "#ff7a29", sides=16, glow=2.4)
    slamp = ball(fin, 0.14, (-0.75, 1.05, 4.32), "#ff5a2c")
    slamp.active_material = mat("#ff5a2c", 2.8)

    # Ruin extra: collapsed gantry beam & shattered concrete
    box(ruin_extra, (2.6, 0.35, 0.32), (0.3, 0.1, 0.95), "#2e2620", rot=(0.25, 0.35, -0.5), finish="rust")
    box(ruin_extra, (1.5, 1.2, 0.4), (-1.2, 0.4, 0.7), "#3a3026", rot=(-0.2, 0.3, 0.4), finish="rust")

    return root, [s1, s2, s3, s4], fin, ruin_extra


def render_structure(key, builder):
    scene = setup_scene(freestyle=False)
    scene.cycles.samples = 28
    root, stages, fin, ruin_extra = builder()
    size, origin = aim_camera(scene, 8.8, 1.55, ss=1)

    raw_dir = RAW / key
    raw_dir.mkdir(parents=True, exist_ok=True)
    renders = {}

    # 1. Render finished
    show(root, True)
    show(ruin_extra, False)
    p = raw_dir / "finished.png"
    scene.render.filepath = str(p)
    bpy.ops.render.render(write_still=True)
    renders[key] = Image.open(p).convert("RGBA")

    # 2. Render 4 progressive stages
    for idx in range(4):
        for j, st in enumerate(stages):
            show(st, j <= idx)
        show(fin, False)
        show(ruin_extra, False)
        sp = raw_dir / f"stage{idx + 1}.png"
        scene.render.filepath = str(sp)
        bpy.ops.render.render(write_still=True)
        renders[f"{key}_stage{idx + 1}"] = Image.open(sp).convert("RGBA")

    # 3. Render charred ruin (stages 1..2 + ruin_extra, charred!)
    show(stages[0], True)
    show(stages[1], True)
    show(stages[2], False)
    show(stages[3], False)
    show(fin, False)
    show(ruin_extra, True)
    char(root, True)
    rp = raw_dir / "ruin.png"
    scene.render.filepath = str(rp)
    bpy.ops.render.render(write_still=True)
    renders[f"{key}_ruin"] = Image.open(rp).convert("RGBA")

    # Crop all images to a single shared bounding box so every stage & ruin shares exact size & anchor!
    bbox = None
    for im in renders.values():
        b = im.getchannel("A").point(lambda a: 255 if a > 6 else 0).getbbox()
        if b:
            bbox = b if bbox is None else (min(bbox[0], b[0]), min(bbox[1], b[1]), max(bbox[2], b[2]), max(bbox[3], b[3]))
    left, top, right, bottom = max(0, bbox[0] - 3), max(0, bbox[1] - 3), min(size, bbox[2] + 3), min(size, bbox[3] + 3)
    w, h = right - left, bottom - top
    anchor = [round((origin[0] - left) / w, 4), round((origin[1] - top) / h, 4)]

    (OUT / "buildings").mkdir(parents=True, exist_ok=True)
    (OUT / "icons").mkdir(parents=True, exist_ok=True)

    for name, im in renders.items():
        cropped = im.crop((left, top, right, bottom))
        save_small(cropped, OUT / "buildings" / f"{name}.png")

    # Build-panel icon: 144x96 crisp render over dark slate studio backdrop
    fin_crop = renders[key].crop((left, top, right, bottom))
    icon = Image.new("RGBA", (144, 96), (18, 25, 31, 255))
    sc = min(132 / w, 88 / h)
    iw, ih = max(1, int(round(w * sc))), max(1, int(round(h * sc)))
    resized = fin_crop.resize((iw, ih), Image.LANCZOS)
    icon.alpha_composite(resized, ((144 - iw) // 2, (96 - ih) // 2))
    save_small(icon, OUT / "icons" / f"{key}.png")

    print(f"buildings/{key}.png  {w}x{h} anchor={anchor}")
    return w, h, anchor


def main():
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    b = manifest.setdefault("buildings", {})
    icons = manifest.setdefault("icons", {})

    specs = [
        ("strategicCommand", build_strategic_command, [0.72, 0.56]),
        ("blackSite", build_black_site, [0.42, 0.14]),
    ]
    for key, builder, lamp in specs:
        w, h, anchor = render_structure(key, builder)
        stages = [f"{key}_stage1", f"{key}_stage2", f"{key}_stage3", f"{key}_stage4"]
        base = {"size": [w, h], "anchor": anchor, "height": 78}
        b[key] = {"image": f"buildings/{key}.png", **base, "lamp": lamp, "stages": stages}
        b[f"{key}_ruin"] = {"image": f"buildings/{key}_ruin.png", **base}
        for st in stages:
            b[st] = {"image": f"buildings/{st}.png", **base}
        b[f"{key}_site"] = {"image": f"buildings/{key}_stage1.png", **base}
        icons[key] = {"image": f"icons/{key}.png", "size": [144, 96]}

    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print("Updated manifest.json with strategicCommand and blackSite!")


if __name__ == "__main__":
    main()
