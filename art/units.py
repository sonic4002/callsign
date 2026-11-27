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
import os
import pathlib
import time

import bpy  # isort: skip (bmesh and mathutils only exist once bpy is loaded)
import bmesh
from mathutils import Vector
from PIL import Image, ImageDraw, ImageFilter

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = pathlib.Path(os.environ.get("CALLSIGN_OUT_ROOT", ROOT / "assets" / "sprites"))
RAW = pathlib.Path(os.environ.get("CALLSIGN_RAW_ROOT", ROOT / "assets" / "raw" / "blender"))
PLAIN = pathlib.Path(os.environ.get("CALLSIGN_PLAIN_ROOT", ROOT / "assets" / "raw" / "plain"))
BASE_MANIFEST = pathlib.Path(os.environ.get("CALLSIGN_BASE_MANIFEST", ROOT / "assets" / "sprites" / "manifest.json"))

PPM = 52  # output pixels per metre (client/art.js scales via manifest ppm; <=56 keeps phone sheet memory compact)
SS = 2  # 2x CUDA GPU supersampling downsampled via Lanczos + subtle crispness pass for razor-sharp isometric silhouettes
DEVICE_MODE = os.environ.get("CALLSIGN_DEVICE", "auto")  # auto (CUDA GPU -> CPU fallback), gpu, or cpu
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
_collections = {}
_textures = {}
_dust_enabled = True
_cuda_ready = None


def _fx_collection():
    return _collections.get("fx") or bpy.context.scene.collection


def _ink_collection():
    return _collections.get("ink") or bpy.context.scene.collection


def _configure_device(scene):
    """Enable RTX CUDA GPU rendering when available (0.1s/frame, <0.6 GB VRAM), else CPU."""
    global _cuda_ready
    if DEVICE_MODE == "cpu":
        scene.cycles.device = "CPU"
        return
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "CUDA"
        devices = prefs.get_devices_for_type("CUDA")
        gpus = [d for d in devices if d.type == "CUDA"]
        if gpus:
            for d in prefs.devices:
                d.use = d.type == "CUDA"
            scene.cycles.device = "GPU"
            _cuda_ready = True
            return
    except Exception:
        pass
    scene.cycles.device = "CPU"
    _cuda_ready = False


def mat(colour, glow=0.0, finish="paint", dust=None, wear=None):
    """Realistic Cycles PBR military material with varied roughness, bare-steel edge wear,
    deep AO cavity darkening, fabric wrinkle bump, vertical grime, and desert dust."""
    if dust is None:
        dust = 0.0 if (not _dust_enabled or finish in ("glass", "skin", "ribbon")) else (
            0.38 if finish == "rubber" else 0.20 if finish in ("paint", "armor", "rust") else 0.14
        )
    if wear is None:
        wear = 0.42 if finish in ("paint", "armor") else 0.36 if finish == "metal" else 0.28 if finish == "rust" else 0.0
    key = (colour, glow, finish, dust, wear)
    if key in _materials:
        return _materials[key]
    m = bpy.data.materials.new(f"m{len(_materials)}")
    m.use_nodes = True
    nt = m.node_tree
    nodes = nt.nodes
    links = nt.links
    shader = nodes["Principled BSDF"]
    base = srgb(colour)

    if glow and finish != "ribbon":
        shader.inputs["Base Color"].default_value = base
        shader.inputs["Roughness"].default_value = 0.20
        shader.inputs["Specular IOR Level"].default_value = 0.3
        shader.inputs["Emission Color"].default_value = base
        shader.inputs["Emission Strength"].default_value = glow
        _materials[key] = m
        return m

    tex_coord = nodes.new("ShaderNodeTexCoord")
    geom = nodes.new("ShaderNodeNewGeometry")

    # 1. Multi-scale organic mottled paint / fabric tonal variation (breaks flat CG plastic look)
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 14.0 if finish == "cloth" else 4.8 if finish in ("paint", "armor", "rust") else 8.0
    noise.inputs["Detail"].default_value = 8.0
    noise.inputs["Roughness"].default_value = 0.72
    links.new(tex_coord.outputs["Object"], noise.inputs["Vector"])

    var_lo = 0.72 if finish in ("rust", "wood") else 0.78 if finish == "cloth" else 0.80
    var_hi = 1.16 if finish in ("rust", "wood") else 1.15
    ramp_var = nodes.new("ShaderNodeValToRGB")
    ramp_var.color_ramp.elements[0].position = 0.24
    ramp_var.color_ramp.elements[0].color = (base[0] * var_lo, base[1] * var_lo, base[2] * var_lo, 1)
    ramp_var.color_ramp.elements[1].position = 0.76
    ramp_var.color_ramp.elements[1].color = (min(1.0, base[0] * var_hi), min(1.0, base[1] * var_hi), min(1.0, base[2] * var_hi), 1)
    links.new(noise.outputs["Fac"], ramp_var.inputs["Fac"])
    final_col = ramp_var.outputs["Color"]

    # Wood grain streaking for AK stocks, crates, and floorboards
    if finish == "wood":
        mapping = nodes.new("ShaderNodeMapping")
        mapping.inputs["Scale"].default_value = (1.5, 14.0, 14.0)
        links.new(tex_coord.outputs["Object"], mapping.inputs["Vector"])
        wave = nodes.new("ShaderNodeTexWave")
        wave.wave_type = "BANDS"
        wave.inputs["Scale"].default_value = 6.0
        wave.inputs["Distortion"].default_value = 4.5
        wave.inputs["Detail"].default_value = 4.0
        links.new(mapping.outputs["Vector"], wave.inputs["Vector"])
        wr = nodes.new("ShaderNodeValToRGB")
        wr.color_ramp.elements[0].color = (base[0] * 0.55, base[1] * 0.55, base[2] * 0.55, 1)
        wr.color_ramp.elements[1].color = (min(1.0, base[0] * 1.15), min(1.0, base[1] * 1.15), min(1.0, base[2] * 1.15), 1)
        links.new(wave.outputs["Fac"], wr.inputs["Fac"])
        final_col = wr.outputs["Color"]

    # 2. Chipped-paint bare-steel edge wear broken up by noise (catches crisp rim highlights)
    wear_fac = None
    if wear > 0 and finish in ("paint", "armor", "metal", "rust"):
        w_ramp = nodes.new("ShaderNodeValToRGB")
        w_ramp.color_ramp.elements[0].position = 0.512
        w_ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
        w_ramp.color_ramp.elements[1].position = 0.575
        w_ramp.color_ramp.elements[1].color = (wear, wear, wear, 1)
        links.new(geom.outputs["Pointiness"], w_ramp.inputs["Fac"])
        # Break up uniform edge highlight with patchy noise so wear looks organically chipped
        w_mul = nodes.new("ShaderNodeMath")
        w_mul.operation = "MULTIPLY"
        links.new(w_ramp.outputs["Color"], w_mul.inputs[0])
        links.new(noise.outputs["Fac"], w_mul.inputs[1])
        wear_fac = w_mul.outputs["Value"]
        mix_w = nodes.new("ShaderNodeMix")
        mix_w.data_type = "RGBA"
        links.new(wear_fac, mix_w.inputs["Factor"])
        links.new(final_col, mix_w.inputs["A"])
        mix_w.inputs["B"].default_value = srgb("#adb6bd" if finish == "metal" else "#8e969c")
        final_col = mix_w.outputs["Result"]

    # 3. Deep Ambient Occlusion cavity grime (replaces cartoon black outlines with natural 3D depth!)
    ao = nodes.new("ShaderNodeAmbientOcclusion")
    ao.samples = 12
    ao.only_local = True
    ao.inputs["Distance"].default_value = 0.24 if finish in ("cloth", "ribbon", "skin") else 0.44
    ao_ramp = nodes.new("ShaderNodeValToRGB")
    ao_ramp.color_ramp.elements[0].position = 0.14
    ao_ramp.color_ramp.elements[0].color = (0.16, 0.17, 0.19, 1)
    ao_ramp.color_ramp.elements[1].position = 0.88
    ao_ramp.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1)
    links.new(ao.outputs["AO"], ao_ramp.inputs["Fac"])

    mix_ao = nodes.new("ShaderNodeMix")
    mix_ao.data_type = "RGBA"
    mix_ao.blend_type = "MULTIPLY"
    mix_ao.inputs["Factor"].default_value = 0.90 if finish != "ribbon" else 0.55
    links.new(final_col, mix_ao.inputs["A"])
    links.new(ao_ramp.outputs["Color"], mix_ao.inputs["B"])
    final_col = mix_ao.outputs["Result"]

    # 4. Vertical oil/rain streaks + rust weathering patches on painted armor/rust
    if finish in ("paint", "armor", "rust"):
        st_map = nodes.new("ShaderNodeMapping")
        st_map.inputs["Scale"].default_value = (4.5, 4.5, 0.8)  # vertically stretched grime
        links.new(tex_coord.outputs["Object"], st_map.inputs["Vector"])
        st_noise = nodes.new("ShaderNodeTexNoise")
        st_noise.inputs["Scale"].default_value = 3.2
        st_noise.inputs["Detail"].default_value = 5.0
        links.new(st_map.outputs["Vector"], st_noise.inputs["Vector"])
        st_ramp = nodes.new("ShaderNodeValToRGB")
        st_ramp.color_ramp.elements[0].position = 0.56
        st_ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
        st_ramp.color_ramp.elements[1].position = 0.78
        st_ramp.color_ramp.elements[1].color = (0.48 if finish == "rust" else 0.22, 0.48 if finish == "rust" else 0.22, 0.48 if finish == "rust" else 0.22, 1)
        links.new(st_noise.outputs["Fac"], st_ramp.inputs["Fac"])
        mix_st = nodes.new("ShaderNodeMix")
        mix_st.data_type = "RGBA"
        links.new(st_ramp.outputs["Color"], mix_st.inputs["Factor"])
        links.new(final_col, mix_st.inputs["A"])
        mix_st.inputs["B"].default_value = srgb("#5c2414" if finish == "rust" else "#232520")
        final_col = mix_st.outputs["Result"]

    # 5. Battlefield desert dust along lower height (grounds tracks, tires, skirts, boots)
    if dust > 0:
        sep = nodes.new("ShaderNodeSeparateXYZ")
        links.new(geom.outputs["Position"], sep.inputs["Vector"])
        d_ramp = nodes.new("ShaderNodeValToRGB")
        d_ramp.color_ramp.elements[0].position = 0.0
        d_ramp.color_ramp.elements[0].color = (dust, dust, dust, 1)
        d_ramp.color_ramp.elements[1].position = 0.72 if finish in ("paint", "armor", "rubber", "rust") else 0.36
        d_ramp.color_ramp.elements[1].color = (0, 0, 0, 1)
        links.new(sep.outputs["Z"], d_ramp.inputs["Fac"])
        mix_d = nodes.new("ShaderNodeMix")
        mix_d.data_type = "RGBA"
        links.new(d_ramp.outputs["Color"], mix_d.inputs["Factor"])
        links.new(final_col, mix_d.inputs["A"])
        mix_d.inputs["B"].default_value = srgb("#938364")
        final_col = mix_d.outputs["Result"]

    links.new(final_col, shader.inputs["Base Color"])

    # 6. Physical surface bump: sculpted cloth wrinkle folds vs cast steel / pitted paint
    if finish != "glass":
        bn = nodes.new("ShaderNodeTexNoise")
        bn.inputs["Scale"].default_value = 18.0 if finish in ("cloth", "ribbon") else 34.0 if finish in ("paint", "armor", "metal") else 46.0
        bn.inputs["Detail"].default_value = 8.0
        bn.inputs["Roughness"].default_value = 0.75
        links.new(tex_coord.outputs["Object"], bn.inputs["Vector"])
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.26 if finish in ("cloth", "ribbon") else 0.14 if finish in ("paint", "armor") else 0.20
        bump.inputs["Distance"].default_value = 0.022 if finish in ("cloth", "ribbon") else 0.015
        links.new(bn.outputs["Fac"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], shader.inputs["Normal"])

    # 7. Physically accurate roughness variation + dielectric/metallic separation
    if finish == "glass":
        shader.inputs["Roughness"].default_value = 0.05
        shader.inputs["Specular IOR Level"].default_value = 0.95
        shader.inputs["Metallic"].default_value = 0.20
        shader.inputs["Coat Weight"].default_value = 1.0
        shader.inputs["Coat Roughness"].default_value = 0.03
    elif finish == "metal":
        r_ramp = nodes.new("ShaderNodeValToRGB")
        r_ramp.color_ramp.elements[0].color = (0.24, 0.24, 0.24, 1)
        r_ramp.color_ramp.elements[1].color = (0.46, 0.46, 0.46, 1)
        links.new(noise.outputs["Fac"], r_ramp.inputs["Fac"])
        links.new(r_ramp.outputs["Color"], shader.inputs["Roughness"])
        shader.inputs["Specular IOR Level"].default_value = 0.65
        shader.inputs["Metallic"].default_value = 0.84
    elif finish == "ribbon":
        shader.inputs["Roughness"].default_value = 0.82
        shader.inputs["Specular IOR Level"].default_value = 0.15
        shader.inputs["Metallic"].default_value = 0.0
        shader.inputs["Sheen Weight"].default_value = 0.35
        shader.inputs["Emission Color"].default_value = base
        shader.inputs["Emission Strength"].default_value = glow if glow else 0.08
    elif finish == "cloth":
        shader.inputs["Roughness"].default_value = 0.93
        shader.inputs["Specular IOR Level"].default_value = 0.07
        shader.inputs["Metallic"].default_value = 0.0
        shader.inputs["Sheen Weight"].default_value = 0.35
    elif finish == "wood":
        shader.inputs["Roughness"].default_value = 0.70
        shader.inputs["Specular IOR Level"].default_value = 0.22
        shader.inputs["Metallic"].default_value = 0.0
    elif finish == "rubber":
        shader.inputs["Roughness"].default_value = 0.88
        shader.inputs["Specular IOR Level"].default_value = 0.15
        shader.inputs["Metallic"].default_value = 0.0
    elif finish == "skin":
        shader.inputs["Roughness"].default_value = 0.58
        shader.inputs["Subsurface Weight"].default_value = 0.18
    elif finish == "rust":
        r_ramp = nodes.new("ShaderNodeValToRGB")
        r_ramp.color_ramp.elements[0].color = (0.58, 0.58, 0.58, 1)
        r_ramp.color_ramp.elements[1].color = (0.86, 0.86, 0.86, 1)
        links.new(noise.outputs["Fac"], r_ramp.inputs["Fac"])
        links.new(r_ramp.outputs["Color"], shader.inputs["Roughness"])
        shader.inputs["Specular IOR Level"].default_value = 0.22
        shader.inputs["Metallic"].default_value = 0.14
    else:  # "paint" / "armor" — true dielectric CARC military matte paint with worn metallic edges
        r_ramp = nodes.new("ShaderNodeValToRGB")
        r_ramp.color_ramp.elements[0].color = (0.40, 0.40, 0.40, 1)
        r_ramp.color_ramp.elements[1].color = (0.72, 0.72, 0.72, 1)
        links.new(noise.outputs["Fac"], r_ramp.inputs["Fac"])
        links.new(r_ramp.outputs["Color"], shader.inputs["Roughness"])
        shader.inputs["Specular IOR Level"].default_value = 0.48
        if wear_fac is not None:
            m_map = nodes.new("ShaderNodeMapRange")
            m_map.inputs["From Min"].default_value = 0.0
            m_map.inputs["From Max"].default_value = 0.45
            m_map.inputs["To Min"].default_value = 0.05
            m_map.inputs["To Max"].default_value = 0.75
            links.new(wear_fac, m_map.inputs["Value"])
            links.new(m_map.outputs["Result"], shader.inputs["Metallic"])
        else:
            shader.inputs["Metallic"].default_value = 0.06

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


def setup_scene(freestyle=False):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _materials.clear()
    _collections.clear()
    _textures.clear()
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    _configure_device(scene)
    scene.cycles.samples = 32
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.018
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    scene.cycles.max_bounces = 4
    scene.cycles.diffuse_bounces = 2
    scene.cycles.glossy_bounces = 2
    scene.cycles.filter_width = 1.1
    scene.render.film_transparent = True
    scene.render.use_persistent_data = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    # Filmic AgX with crisp punchy contrast for small-scale isometric readability without outlines
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = 0.14

    ink_col = bpy.data.collections.new("ink")
    fx_col = bpy.data.collections.new("fx")
    scene.collection.children.link(ink_col)
    scene.collection.children.link(fx_col)
    _collections["ink"] = ink_col
    _collections["fx"] = fx_col

    # Controlled desert sky dome: lower fill lets cast shadows & AO carve real 3D depth!
    world = bpy.data.worlds.new("world")
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes["Background"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0.38, 0.32, 0.23, 1)  # warm desert ground bounce
    e1 = ramp.color_ramp.elements.new(0.48)
    e1.color = (0.55, 0.59, 0.63, 1)  # hazy desert horizon
    ramp.color_ramp.elements[2].position = 0.85
    ramp.color_ramp.elements[2].color = (0.28, 0.45, 0.72, 1)  # crisp cool zenith sky
    nt.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.54
    scene.world = world

    # The camera looks from the south-east of the model, so the model's +X (map east)
    # runs down and to the right on screen and map south runs down and to the left.
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    # Crisp directional desert sunlight from upper left + cool silhouette-carving rim + subtle warm sand bounce
    lights = (
        ("sun", (-0.68, -1.35, 1.48), 5.6, (1.0, 0.94, 0.84), 1.4),
        ("rim", (1.35, 0.85, 0.55), 1.55, (0.70, 0.86, 1.0), 6.0),
        ("bounce", (0.30, -0.30, -1.00), 0.28, (0.95, 0.82, 0.62), 35.0),
    )
    for name, direction, energy, rgb, ang in lights:
        light = bpy.data.lights.new(name, "SUN")
        light.energy = energy
        light.color = rgb
        light.angle = math.radians(ang)
        obj = bpy.data.objects.new(name, light)
        obj.rotation_euler = (-Vector(direction)).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(obj)
    return scene


def aim_camera(scene, cell, centre_z, ss=1):
    """Square cell of `cell` metres, looking at a point centre_z above the origin."""
    cam = scene.camera
    cam.data.ortho_scale = cell
    back = Vector((1, -1, math.sqrt(2) * math.tan(ELEVATION))).normalized()
    target = Vector((0, 0, centre_z))
    cam.location = target + back * 40
    cam.rotation_euler = (-back).to_track_quat("-Z", "Y").to_euler()
    size = round(cell * PPM)
    scene.render.resolution_x = scene.render.resolution_y = size * ss
    scene.render.resolution_percentage = 100
    # Where the origin (the unit's place on the ground) lands in the output cell, in pixels.
    return size, (size / 2, size / 2 + centre_z * math.cos(ELEVATION) * PPM)


# ---------------------------------------------------------------- building blocks


def _object(name, verts, faces, material, parent, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0, fx=False, smooth=False, segs=2, subsurf=0):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bevel > 0 and len(bm.edges) > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segs, affect="EDGES", clamp_overlap=True)
    if smooth or subsurf > 0:
        for f in bm.faces:
            f.smooth = True
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    obj.parent = parent
    obj.location = loc
    obj.rotation_euler = rot
    (_fx_collection() if fx else _ink_collection()).objects.link(obj)
    if subsurf > 0:
        mod = obj.modifiers.new("sub", "SUBSURF")
        mod.levels = subsurf
        mod.render_levels = subsurf
    return obj


def cloth_fold(obj, strength=0.015, scale=0.16, tex_type="STUCCI"):
    """Adds subtle physical 3D cloth creases/folds via subdivision + displacement so uniforms,
    cloaks, keffiyehs, sandbags and tarps never look like smooth plastic."""
    key = (tex_type, round(scale, 4))
    tex = _textures.get(key)
    if tex is None:
        tex = bpy.data.textures.new(f"cloth_{len(_textures)}", type=tex_type)
        tex.noise_scale = scale
        if tex_type == "STUCCI":
            tex.turbulence = 3.5
        _textures[key] = tex
    mod = obj.modifiers.new("fold", "DISPLACE")
    mod.texture = tex
    mod.strength = strength
    mod.direction = "NORMAL"
    return obj


def loft(parent, rings, colour, loc=(0, 0, 0), rot=(0, 0, 0), finish="paint", glow=0.0, cap_start=True, cap_end=True, smooth=True, subsurf=0, bevel=0.0, fx=False):
    """Builds a smoothly lofted 3D mesh from a sequence of equal-length 3D cross-section rings.
    Used for sculpted limbs, draped hoods, curved aircraft fuselages, V-hull boats, and boots."""
    n = len(rings[0])
    m = len(rings)
    verts = [pt for ring in rings for pt in ring]
    faces = []
    for k in range(m - 1):
        base = k * n
        nxt = (k + 1) * n
        for i in range(n):
            j = (i + 1) % n
            faces.append((base + i, base + j, nxt + j, nxt + i))
    if cap_start:
        faces.append(tuple(reversed(range(n))))
    if cap_end:
        faces.append(tuple(range((m - 1) * n, m * n)))
    return _object("loft", verts, faces, mat(colour, glow, finish), parent, loc=loc, rot=rot, bevel=bevel, fx=fx, smooth=smooth, subsurf=subsurf)


def ellipse_ring(cx, cy, cz, rx, ry, sides=12, axis="Z", tilt_x=0.0, tilt_y=0.0):
    """Returns a 3D ring of `sides` points around (cx, cy, cz) perpendicular to `axis`."""
    pts = []
    for i in range(sides):
        a = 2 * math.pi * i / sides
        u, v = rx * math.cos(a), ry * math.sin(a)
        if axis == "Z":
            pts.append((cx + u, cy + v, cz + u * tilt_x + v * tilt_y))
        elif axis == "X":
            pts.append((cx + u * tilt_x + v * tilt_y, cy + u, cz + v))
        else:
            pts.append((cx + u, cy + u * tilt_x + v * tilt_y, cz + v))
    return pts


def sculpted_limb(parent, stations, colour, finish="cloth", sides=12, fold=0.012, subsurf=1, loc=(0, 0, 0), rot=(0, 0, 0)):
    """Organic clothed limb lofted along Z from `(z, rx, ry, ox, oy)` stations with cloth creases."""
    rings = [ellipse_ring(ox, oy, z, rx, ry, sides=sides) for z, rx, ry, ox, oy in stations]
    obj = loft(parent, rings, colour, loc=loc, rot=rot, finish=finish, smooth=True, subsurf=subsurf)
    if fold > 0:
        cloth_fold(obj, strength=fold, scale=0.14)
    return obj


def combat_boot(parent, loc, colour="#22201d", sole="#151412"):
    """Sculpted military combat boot: heel counter, laced instep, rounded toe box, lugged rubber sole."""
    # Upper leather/Cordura boot lofted along X from heel (-0.09) to toe (+0.16)
    stations = [
        (-0.095, 0.056, 0.045, 0.055),
        (-0.055, 0.068, 0.068, 0.062),
        (0.015,  0.070, 0.058, 0.052),
        (0.095,  0.064, 0.040, 0.036),
        (0.155,  0.044, 0.024, 0.022),
    ]
    rings = [ellipse_ring(x, 0.0, zc, ry, rz, sides=10, axis="X") for x, ry, rz, zc in stations]
    loft(parent, rings, colour, loc=loc, finish="rubber", smooth=True, subsurf=1)
    # Ankle shaft collar
    cyl(parent, 0.064, 0.11, (loc[0] - 0.02, loc[1], loc[2] + 0.095), colour, top=0.072, sides=12, bevel=0.012, finish="rubber")
    # Heavy lugged rubber sole & heel block
    box(parent, (0.25, 0.135, 0.028), (loc[0] + 0.03, loc[1], loc[2] + 0.008), sole, bevel=0.008, finish="rubber")
    box(parent, (0.09, 0.132, 0.024), (loc[0] - 0.045, loc[1], loc[2] - 0.006), sole, bevel=0.006, finish="rubber")


def gloved_hand(parent, loc, colour="#232528", finish="rubber", rot=(0, 0, 0)):
    """Sculpted tactical gloved hand with palm, curled fingers, and thumb (no sphere/ball hands!)."""
    h = joint(parent, loc, "hand")
    h.rotation_euler = rot
    # Wrist cuff + sculpted palm
    taper_box(h, (0.072, 0.052), (0.062, 0.046), 0.088, (0.0, 0.0, -0.025), colour, bevel=0.014, finish=finish, subsurf=1, smooth=True)
    # Curled gripping finger block
    taper_box(h, (0.068, 0.044), (0.056, 0.036), 0.058, (0.026, 0.0, -0.072), colour, rot=(0, 0.42, 0), bevel=0.012, finish=finish, subsurf=1, smooth=True)
    # Opposing thumb
    cyl(h, 0.018, 0.065, (0.034, 0.030, -0.035), colour, rot_extra=(0.45, 0.55, 0), sides=8, finish=finish)
    return h


def grate(parent, size, loc, slats=5, frame_col="#25282c", slat_col="#3c4248", axis="X"):
    """Recessed dark intake/radiator grille with crisp angled steel louver slats."""
    # Deep shadow backing
    box(parent, size, loc, "#0e1012", bevel=0.004, finish="metal")
    sx, sy, sz = size
    for i in range(slats):
        f = (i + 0.5) / slats - 0.5
        if axis == "X":  # horizontal deck radiator louvers along X
            box(parent, (sx / (slats * 1.45), sy * 0.92, sz * 0.55), (loc[0] + f * sx * 0.88, loc[1], loc[2] + sz * 0.32), slat_col, rot=(0, 0.25, 0), bevel=0.005, finish="metal")
        elif axis == "Y":  # vertical front radiator grille bars across Y
            box(parent, (sx * 0.7, sy * 0.90, sz / (slats * 1.65)), (loc[0] + sx * 0.22, loc[1], loc[2] + f * sz * 0.82), slat_col, bevel=0.004, finish="metal")
        else:
            box(parent, (sx * 0.90, sy * 0.65, sz / (slats * 1.6)), (loc[0], loc[1], loc[2] + f * sz * 0.82), slat_col, bevel=0.004, finish="metal")


def bolt_row(parent, start, end, count, radius=0.024, colour="#2c3035"):
    """A line of crisp steel bolts/rivets along an armor seam or plate edge."""
    for i in range(count):
        t = i / max(1, count - 1)
        p = tuple(start[k] + (end[k] - start[k]) * t for k in range(3))
        cyl(parent, radius, radius * 1.1, p, colour, sides=6, finish="metal")


def pennant(parent, loc, look, length=0.42, height=0.16):
    """A realistic fluttering 3D cloth recognition pennant streaming back from an aerial/mast."""
    if "ribbon" not in look:
        return None
    x0, y0, z0 = loc
    rings = []
    segs = 6
    for i in range(segs):
        t = i / (segs - 1)
        x = x0 - t * length
        y = y0 + 0.045 * math.sin(t * math.pi * 1.8) * t
        hh = (height * 0.5) * (1.0 - 0.72 * t)
        zc = z0 - 0.025 * t
        th = 0.010
        rings.append([
            (x, y - th, zc - hh), (x, y + th, zc - hh),
            (x, y + th, zc + hh), (x, y - th, zc + hh),
        ])
    return loft(parent, rings, look["ribbon"], finish="ribbon", glow=0.10, smooth=True, subsurf=1)


def joint(parent, loc=(0, 0, 0), name="joint"):
    obj = bpy.data.objects.new(name, None)
    obj.parent = parent
    obj.location = loc
    bpy.context.scene.collection.objects.link(obj)
    return obj


def box(parent, size, loc, colour, rot=(0, 0, 0), glow=0.0, bevel=0.015, finish="paint", fx=False, subsurf=0, smooth=False):
    x, y, z = (s / 2 for s in size)
    verts = [(sx * x, sy * y, sz * z) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    b = 0.0 if (fx or min(size) < 0.03) else min(bevel, min(size) * 0.25)
    return _object("box", verts, faces, mat(colour, glow, finish), parent, loc, rot, bevel=b, fx=fx, subsurf=subsurf, smooth=smooth)


def taper_box(parent, size_bot, size_top, height, loc, colour, rot=(0, 0, 0), bevel=0.02, finish="paint", subsurf=0, smooth=False):
    """A tapered rectangular frustum centred on loc (good for limbs, torsos, sloped armour)."""
    bx, by = size_bot[0] / 2, size_bot[1] / 2
    tx, ty = size_top[0] / 2, size_top[1] / 2
    hz = height / 2
    verts = [
        (-bx, -by, -hz), (bx, -by, -hz), (bx, by, -hz), (-bx, by, -hz),
        (-tx, -ty, hz), (tx, -ty, hz), (tx, ty, hz), (-tx, ty, hz),
    ]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return _object("taper", verts, faces, mat(colour, 0.0, finish), parent, loc, rot, bevel=bevel, subsurf=subsurf, smooth=smooth)


def cyl(parent, radius, length, loc, colour, axis="Z", sides=14, glow=0.0, top=None, bevel=0.0, finish="paint", fx=False, smooth=True, rot_extra=(0, 0, 0)):
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
    base_rot = {"Z": (0, 0, 0), "X": (0, math.pi / 2, 0), "Y": (-math.pi / 2, 0, 0)}[axis]
    rot = tuple(base_rot[i] + rot_extra[i] for i in range(3))
    return _object("cyl", verts, faces, mat(colour, glow, finish), parent, loc, rot, bevel=bevel, segs=1, fx=fx, smooth=smooth)


def prism_y(parent, profile, width, colour, y=0.0, bevel=0.02, finish="paint", smooth=False):
    """A side profile of (x, z) points, extruded across the model."""
    n = len(profile)
    verts = [(x, y - width / 2, z) for x, z in profile] + [(x, y + width / 2, z) for x, z in profile]
    faces = [tuple(range(n)), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    return _object("prism", verts, faces, mat(colour, 0.0, finish), parent, bevel=bevel, smooth=smooth)


def prism_z(parent, outline, z0, z1, colour, bottom=1.0, top=1.0, bevel=0.02, finish="paint", smooth=False):
    """A plan outline of (x, y) points, raised from z0 to z1, narrowed at either end."""
    n = len(outline)
    verts = [(x * bottom, y * bottom, z0) for x, y in outline] + [(x * top, y * top, z1) for x, y in outline]
    faces = [tuple(range(n)), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    return _object("prism", verts, faces, mat(colour, 0.0, finish), parent, bevel=bevel, smooth=smooth)


def ball(parent, radius, loc, colour, squash=1.0, finish="paint", fx=False, smooth=True, scale=None):
    mesh = bpy.data.meshes.new("ball")
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=18, v_segments=12, radius=radius)
    if smooth:
        for f in bm.faces:
            f.smooth = True
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat(colour, 0.0, finish))
    obj = bpy.data.objects.new("ball", mesh)
    obj.parent = parent
    obj.location = loc
    obj.scale = scale if scale is not None else (1, 1, squash)
    (_fx_collection() if fx else _ink_collection()).objects.link(obj)
    return obj


def flash(parent, loc, size):
    """A clean stylized muzzle flash pointing along +X, placed in `fx` so it gets no black ink lines."""
    root = joint(parent, loc, "flash")
    # Forward hot flame jet
    cyl(root, 0.14 * size, 0.85 * size, (0.44 * size, 0, 0), "#ffd875", axis="X", sides=8, glow=8, top=0.01, fx=True)
    # Side star-flare fins
    cyl(root, 0.28 * size, 0.26 * size, (0.12 * size, 0, 0), "#ff9c38", axis="X", sides=6, glow=6, top=0.06 * size, fx=True)
    box(root, (0.14 * size, 0.62 * size, 0.08 * size), (0.10 * size, 0, 0), "#ffbe55", glow=7, fx=True)
    box(root, (0.14 * size, 0.08 * size, 0.52 * size), (0.10 * size, 0, 0), "#ffbe55", glow=7, fx=True)
    # Bright incandescent core
    core = ball(root, 0.14 * size, (0.06 * size, 0, 0), "#fff7d6", fx=True)
    core.active_material = mat("#fff7d6", 12)
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

# Aegis wears what a modern army wears: rich olive drab combat cloth & CARC steel, high-contrast
# coyote-tan tactical webbing/pouches, dark boots/weapons, marked unmistakably by bright cobalt-blue
# cloth recognition ribbons (armbands, tied helmet band, barrel bands, fluttering aerial pennants).
AEGIS = dict(
    cloth="#555e43", dark="#31362a", armour="#6d7556", head="#4d553d", trim="#3a7a8c", skin="#c79772",
    gun="#1f2328", hull="#5a6347", hull2="#434a35", low="#262921", track="#1c1d1e", deck="#727b5c",
    tan="#8d7c5b", web="#786a4e", ribbon="#1664f0", pants="#4a513a", boot="#40372b",
)
# Aircraft and naval craft wear realistic low-vis military tactical haze grey + blue ribbons.
AEGIS_GREY = {**AEGIS, "hull": "#7c848a", "hull2": "#5d6469", "low": "#2a2e32", "deck": "#91999e"}
# Ashfall wears weathered earth-khaki tunics with high-contrast dark olive rigs, dark trousers/boots,
# warm terracotta/rust armor patches and desert keffiyehs so they pop sharply against the sand ground.
ASHFALL = dict(
    cloth="#9c8259", dark="#31281e", armour="#4e5236", head="#be9856", trim="#d6be8c", skin="#ac7a54",
    gun="#1e2024", wood="#613a1c", hull="#a4895f", hull2="#745f40", low="#2b231b", rust="#843d29",
    track="#1c1a17", tan="#8b734e", pants="#4e4638", boot="#2c241b",
)


class Soldier:
    cell, centre = 3.5, 0.82
    facings = FACINGS
    scale = 1.0
    # New animations go at the end of the row, so the columns older code knows stay put.
    sheets = {"": [("idle", [0]), ("walk", [i / 12 for i in range(12)]), ("fire", [0, 1]), ("cover", [0]),
                   ("coverFire", [0]), ("die", [0.2, 0.45, 0.7, 0.9, 1]), ("stop", [0])]}
    manifest = {"per": "member", "fps": {"walk": 16, "die": 9}}

    def __init__(self, look, militia, rocket=False, bare_torso=False):
        c = look
        tan = c.get("tan", "#8d7c5b")
        pants = c.get("pants", c["cloth"])
        boot_col = c.get("boot", "#24201c")
        self.root = joint(None, name="root")
        self.size = joint(self.root)  # a hero stands a little taller than the rank and file
        self.size.scale = (self.scale,) * 3
        self.fall = joint(self.size)  # tips the whole body over when it dies
        self.pelvis = joint(self.fall, (0, 0, 0.84))
        self.torso = joint(self.pelvis)

        # Anatomically tapered combat jacket torso (lofted waist -> ribcage -> broad shoulders) + cloth folds
        sculpted_limb(
            self.torso,
            [
                (-0.04, 0.145, 0.185, -0.01, 0.0),
                (0.10,  0.140, 0.175,  0.00, 0.0),
                (0.28,  0.155, 0.215,  0.01, 0.0),
                (0.45,  0.158, 0.242,  0.00, 0.0),
                (0.55,  0.120, 0.190, -0.01, 0.0),
            ],
            c["cloth"], finish="cloth", sides=14, fold=0.014, subsurf=1,
        )
        # Pelvis / combat trousers seat + tactical gun belt with buckle, drop-leg holster & IFAK pouch
        sculpted_limb(
            self.pelvis,
            [
                (-0.10, 0.135, 0.185, 0.0, 0.0),
                (0.00,  0.152, 0.205, 0.0, 0.0),
                (0.08,  0.148, 0.195, 0.0, 0.0),
            ],
            pants, finish="cloth", sides=14, fold=0.010, subsurf=1,
        )
        if not bare_torso:
            cyl(self.pelvis, 0.192, 0.068, (0, 0, 0.04), c["dark"], sides=16, bevel=0.012, finish="rubber")
            box(self.pelvis, (0.04, 0.08, 0.065), (0.185, 0, 0.04), "#383c40", bevel=0.008, finish="metal")
            box(self.pelvis, (0.10, 0.068, 0.16), (0.03, -0.215, -0.03), c["gun"], bevel=0.014, finish="rubber")
            box(self.pelvis, (0.13, 0.085, 0.14), (-0.06, 0.21, 0.02), tan if not militia else c["armour"], bevel=0.018, finish="cloth")
            box(self.pelvis, (0.10, 0.14, 0.12), (-0.19, 0.0, 0.02), c["dark"], bevel=0.018, finish="cloth")

        if bare_torso:
            pass
        elif militia:
            # Layered guerrilla tunic hem + structured olive Chicom chest rig + 4 curved mag pouches + rucksack
            skirt_rings = [
                ellipse_ring(-0.01, 0, -0.14, 0.175, 0.225, 14),
                ellipse_ring(0.0,   0, -0.04, 0.165, 0.210, 14),
                ellipse_ring(0.0,   0,  0.04, 0.155, 0.198, 14),
            ]
            cloth_fold(loft(self.pelvis, skirt_rings, c["cloth"], finish="cloth", subsurf=1), strength=0.016, scale=0.14)
            taper_box(self.torso, (0.29, 0.36), (0.31, 0.41), 0.34, (0.025, 0, 0.29), c["armour"], bevel=0.03, finish="cloth", subsurf=1, smooth=True)
            for dy in (-0.12, -0.04, 0.04, 0.12):
                box(self.torso, (0.075, 0.064, 0.165), (0.188, dy, 0.22), c["dark"], bevel=0.014, finish="cloth")
                box(self.torso, (0.082, 0.068, 0.045), (0.192, dy, 0.29), c["armour"], bevel=0.01, finish="cloth")
            for side in (1, -1):
                box(self.torso, (0.28, 0.065, 0.055), (0.0, 0.14 * side, 0.51), c["dark"], bevel=0.012, finish="cloth")
            box(self.torso, (0.34, 0.065, 0.48), (0.01, 0, 0.31), c["dark"], rot=(0.56, 0, 0), bevel=0.012, finish="rubber")
            pack = box(self.torso, (0.21, 0.33, 0.37), (-0.22, 0, 0.28), c["armour"], bevel=0.04, finish="cloth", subsurf=1, smooth=True)
            cloth_fold(pack, strength=0.014, scale=0.16)
            box(self.torso, (0.06, 0.24, 0.14), (-0.32, 0, 0.21), c["hull2"], bevel=0.02, finish="cloth")
            roll = cyl(self.torso, 0.078, 0.37, (-0.23, 0, 0.49), c["hull2"], axis="Y", sides=14, bevel=0.02, finish="cloth")
            cloth_fold(roll, strength=0.010, scale=0.14)
            collar = cyl(self.torso, 0.135, 0.11, (0.0, 0, 0.54), c["head"], sides=14, bevel=0.02, finish="cloth")
            cloth_fold(collar, strength=0.012, scale=0.12)
        else:
            # High-contrast Coyote-Tan Cordura SAPI plate carrier + MOLLE webbing straps + 3 mag pouches + radio + assault pack
            web = c.get("web", tan)
            taper_box(self.torso, (0.28, 0.36), (0.30, 0.41), 0.37, (0.018, 0, 0.30), web, bevel=0.032, finish="cloth", subsurf=1, smooth=True)
            prism_z(self.torso, [(0.155, -0.125), (0.155, 0.125), (0.190, 0.095), (0.190, -0.095)], 0.18, 0.46, tan, bottom=1.0, top=0.88, bevel=0.012, finish="cloth")
            # Horizontal MOLLE PALS webbing loops across upper chest plate (breaks up flat plate!)
            for mz in (0.35, 0.41):
                box(self.torso, (0.024, 0.19, 0.026), (0.190, 0, mz), c["dark"], bevel=0.004, finish="cloth")
            for side in (1, -1):
                box(self.torso, (0.28, 0.085, 0.06), (0.0, 0.155 * side, 0.51), tan, bevel=0.015, finish="cloth")
                box(self.torso, (0.035, 0.055, 0.055), (0.145, 0.145 * side, 0.47), c["gun"], bevel=0.006, finish="metal")  # buckle
            for dy in (-0.095, 0.0, 0.095):
                box(self.torso, (0.068, 0.072, 0.145), (0.205, dy, 0.22), c["armour"], bevel=0.014, finish="cloth")
                box(self.torso, (0.048, 0.056, 0.055), (0.202, dy, 0.30), c["gun"], bevel=0.008, finish="metal")
            box(self.torso, (0.055, 0.05, 0.09), (0.17, 0.145, 0.42), c["gun"], bevel=0.01, finish="metal")
            pack = box(self.torso, (0.19, 0.30, 0.39), (-0.22, 0, 0.30), web, bevel=0.04, finish="cloth", subsurf=1, smooth=True)
            cloth_fold(pack, strength=0.012, scale=0.16)
            box(self.torso, (0.07, 0.24, 0.16), (-0.31, 0, 0.23), tan, bevel=0.02, finish="cloth")
            cyl(self.torso, 0.010, 0.46, (-0.25, 0.13, 0.67), c["gun"], sides=6, finish="metal")
            cyl(self.torso, 0.115, 0.085, (0.0, 0, 0.55), c["dark"], sides=14, bevel=0.015, finish="cloth")

        # Anatomical head & headgear (lofted cranium/jawline — NO sphere/doll head!)
        self.head = joint(self.torso, (0.01, 0, 0.56))
        cyl(self.head, 0.074, 0.12, (0, 0, 0.04), c["head"] if militia else c["dark"], sides=12, finish="cloth")
        head_rings = [
            ellipse_ring(0.015, 0, 0.085, 0.082, 0.068, 12),
            ellipse_ring(0.025, 0, 0.145, 0.105, 0.088, 12),
            ellipse_ring(0.010, 0, 0.205, 0.118, 0.102, 12),
            ellipse_ring(-0.005, 0, 0.275, 0.106, 0.094, 12),
        ]
        loft(self.head, head_rings, c["skin"], finish="skin", subsurf=1)
        if militia:
            # Smoothly draped desert keffiyeh headwrap (natural cloth dome + nestled double agal cord + jaw scarf)
            wrap_rings = [
                ellipse_ring(-0.005, 0, 0.15, 0.142, 0.132, 16),
                ellipse_ring(-0.010, 0, 0.21, 0.160, 0.148, 16),
                ellipse_ring(-0.012, 0, 0.27, 0.148, 0.138, 16),
                ellipse_ring(-0.015, 0, 0.315, 0.088, 0.082, 16),
            ]
            cloth_fold(loft(self.head, wrap_rings, c["head"], finish="cloth", subsurf=1), strength=0.016, scale=0.14)
            # Double black agal rope cord nestled flush around crown (no mushroom overhang!)
            cyl(self.head, 0.155, 0.026, (-0.010, 0, 0.262), c["dark"], sides=16, bevel=0.008, finish="cloth")
            cyl(self.head, 0.158, 0.024, (-0.010, 0, 0.236), c["dark"], sides=16, bevel=0.008, finish="cloth")
            # Lower cheek/chin cloth wrap + asymmetric draped scarf tail over shoulder
            cloth_fold(cyl(self.head, 0.125, 0.082, (0.005, 0, 0.095), c["head"], sides=14, bevel=0.018, finish="cloth"), strength=0.010, scale=0.12)
            tail_rings = [
                [(-0.09, -0.10, 0.19), (-0.09, 0.11, 0.19), (-0.15, 0.11, 0.19), (-0.15, -0.10, 0.19)],
                [(-0.14, -0.11, 0.06), (-0.14, 0.13, 0.06), (-0.21, 0.12, 0.06), (-0.21, -0.11, 0.06)],
                [(-0.19, -0.09, -0.08), (-0.19, 0.14, -0.08), (-0.25, 0.12, -0.08), (-0.25, -0.08, -0.08)],
            ]
            cloth_fold(loft(self.head, tail_rings, c["head"], finish="cloth", subsurf=1), strength=0.016, scale=0.14)
            box(self.head, (0.055, 0.11, 0.065), (0.088, 0, 0.135), c["dark"], bevel=0.016, finish="cloth")
        else:
            # High-cut FAST ballistic helmet + NVG mount + counterweight + Peltor + goggles + prominent tied blue helmet ribbon!
            box(self.head, (0.09, 0.135, 0.09), (0.045, 0, 0.125), c["dark"], bevel=0.025, finish="cloth", subsurf=1, smooth=True)
            helm_rings = [
                ellipse_ring(-0.025, 0, 0.175, 0.155, 0.136, 16, tilt_x=0.16),
                ellipse_ring(-0.008, 0, 0.235, 0.166, 0.148, 16, tilt_x=0.06),
                ellipse_ring(-0.010, 0, 0.295, 0.142, 0.128, 16),
                ellipse_ring(-0.015, 0, 0.332, 0.082, 0.074, 16),
            ]
            loft(self.head, helm_rings, c["head"], finish="paint", subsurf=1)
            box(self.head, (0.046, 0.068, 0.076), (0.156, 0, 0.268), c["gun"], bevel=0.01, finish="metal")
            box(self.head, (0.055, 0.12, 0.075), (-0.162, 0, 0.205), tan, bevel=0.014, finish="cloth")
            for side in (1, -1):
                cyl(self.head, 0.052, 0.048, (-0.01, 0.156 * side, 0.172), tan, axis="Y", sides=12, bevel=0.012, finish="paint")
                box(self.head, (0.15, 0.028, 0.036), (0.0, 0.152 * side, 0.232), c["gun"], bevel=0.008, finish="metal")
            box(self.head, (0.062, 0.195, 0.066), (0.126, 0, 0.196), "#101a22", bevel=0.018, finish="glass")
            box(self.head, (0.038, 0.215, 0.078), (0.112, 0, 0.196), c["gun"], bevel=0.01, finish="rubber")
            if "ribbon" in c:
                # Prominent tied cobalt-blue cloth recognition band high on helmet brow (clearly readable from ALL 8 facings!)
                band_rings = [
                    ellipse_ring(-0.008, 0, 0.225, 0.174, 0.156, 16, tilt_x=0.05),
                    ellipse_ring(-0.010, 0, 0.292, 0.154, 0.140, 16, tilt_x=0.03),
                ]
                cloth_fold(loft(self.head, band_rings, c["ribbon"], finish="ribbon", glow=0.12, subsurf=1), strength=0.007, scale=0.12)
                for dy, tilt in ((-0.025, 0.32), (0.025, 0.20)):
                    box(self.head, (0.09, 0.028, 0.024), (-0.195, dy, 0.245), c["ribbon"], rot=(0, tilt, dy * 3.0), glow=0.12, bevel=0.005, finish="ribbon")
        self.head.scale = (0.90, 0.90, 0.90)

        # Sculpted seamless baggy combat trousers (overlapping knee joint so zero pinch!) + kneepads + lug-sole combat boots!
        self.legs = []
        for side in (1, -1):
            hip = joint(self.pelvis, (0, 0.13 * side, -0.02))
            sculpted_limb(
                hip,
                [
                    (0.02,  0.118, 0.120, 0.0,   0.0),
                    (-0.14, 0.120, 0.116, 0.005, 0.008 * side),
                    (-0.28, 0.110, 0.108, 0.004, 0.006 * side),
                    (-0.46, 0.098, 0.098, 0.0,   0.0),
                ],
                pants, finish="cloth", sides=12, fold=0.014, subsurf=1,
            )
            if not bare_torso:
                box(hip, (0.095, 0.048, 0.145), (-0.005, 0.112 * side, -0.21), c["dark"] if not militia else c["armour"], bevel=0.015, finish="cloth")
            knee = joint(hip, (0, 0, -0.42))
            if not militia:
                taper_box(knee, (0.062, 0.118), (0.068, 0.128), 0.138, (0.056, 0, -0.025), tan, bevel=0.022, finish="paint", subsurf=1, smooth=True)
                cyl(knee, 0.100, 0.032, (0, 0, -0.025), c["dark"], sides=12, finish="rubber")
            sculpted_limb(
                knee,
                [
                    (0.05,  0.100, 0.100, 0.0,   0.0),
                    (-0.14, 0.106, 0.102, -0.012, 0.0),
                    (-0.29, 0.096, 0.092, -0.008, 0.0),
                    (-0.34, 0.074, 0.072, 0.0,   0.0),
                ],
                pants, finish="cloth", sides=12, fold=0.013, subsurf=1,
            )
            combat_boot(knee, (0.01, 0, -0.43), colour=boot_col, sole="#151412")
            self.legs.append((hip, knee))

        # Sculpted sleeved arms with shoulder deltoid crease, tied blue cloth armband, elbow bend, & REAL gloved hands!
        self.arms = []
        for side in (1, -1):
            shoulder = joint(self.torso, (0.01, 0.255 * side, 0.455))
            # Sculpted upper sleeve (deltoid drape -> bicep -> elbow fold)
            sculpted_limb(
                shoulder,
                [
                    (0.04,  0.088, 0.082, 0.0,  -0.015 * side),
                    (-0.04, 0.096, 0.092, 0.0,   0.005 * side),
                    (-0.15, 0.084, 0.082, 0.0,   0.0),
                    (-0.27, 0.074, 0.072, 0.0,   0.0),
                ],
                c["cloth"], finish="cloth", sides=12, fold=0.012, subsurf=1,
            )
            if not militia:
                # Shoulder sleeve utility pocket
                box(shoulder, (0.085, 0.032, 0.105), (0.0, 0.086 * side, -0.09), c["armour"], bevel=0.012, finish="cloth")
                if "ribbon" in c:
                    # Tied cobalt-blue cloth armband wrapped around upper arm (clearly visible from every facing!)
                    arm_band = [
                        ellipse_ring(0, 0, -0.115, 0.096, 0.094, 14),
                        ellipse_ring(0, 0, -0.165, 0.094, 0.092, 14),
                        ellipse_ring(0, 0, -0.215, 0.090, 0.088, 14),
                    ]
                    cloth_fold(loft(shoulder, arm_band, c["ribbon"], finish="ribbon", glow=0.10, subsurf=1), strength=0.006, scale=0.10)
            elbow = joint(shoulder, (0, 0, -0.27))
            # Sculpted tapered forearm sleeve + rolled cuff
            sculpted_limb(
                elbow,
                [
                    (0.02,  0.076, 0.074, 0.0, 0.0),
                    (-0.10, 0.068, 0.065, 0.0, 0.0),
                    (-0.22, 0.056, 0.052, 0.0, 0.0),
                    (-0.26, 0.048, 0.045, 0.0, 0.0),
                ],
                c["cloth"] if militia else c["dark"], finish="cloth", sides=12, fold=0.010, subsurf=1,
            )
            # REAL sculpted gloved/bare gripping hand (NO ball hands!)
            gloved_hand(elbow, (0.0, 0.0, -0.265), colour=c["skin"] if militia else "#202224", finish="skin" if militia else "rubber")
            self.arms.append((shoulder, elbow))

        # High-contrast, cleanly silhouetted primary weapon (projects well clear of torso at 45 px!)
        self.rifle = joint(self.torso, (0.28, -0.06, 0.28))
        if rocket:
            # Detailed RPG-7 shoulder launcher + PG-7V warhead + optical sight + twin spare rockets on back
            cyl(self.rifle, 0.050, 1.12, (0.02, 0, 0.04), c["armour"], axis="X", sides=14, bevel=0.01, finish="metal")
            cyl(self.rifle, 0.062, 0.34, (-0.12, 0, 0.04), c["wood"], axis="X", sides=14, bevel=0.008, finish="wood")  # wooden heat shield
            cyl(self.rifle, 0.090, 0.20, (-0.58, 0, 0.04), c["gun"], axis="X", sides=14, top=0.050, finish="metal")  # flared venturi cone
            cyl(self.rifle, 0.098, 0.36, (0.72, 0, 0.04), c["rust"], axis="X", sides=14, top=0.016, finish="rust")   # warhead cone
            cyl(self.rifle, 0.036, 0.14, (0.52, 0, 0.04), c["gun"], axis="X", sides=10, finish="metal")              # booster collar
            box(self.rifle, (0.072, 0.052, 0.18), (0.08, 0, -0.09), c["wood"], rot=(0, 0.18, 0), bevel=0.01, finish="wood")
            box(self.rifle, (0.072, 0.048, 0.16), (0.30, 0, -0.08), c["wood"], bevel=0.01, finish="wood")            # rear grip
            box(self.rifle, (0.085, 0.045, 0.11), (0.24, 0.035, 0.13), c["gun"], bevel=0.01, finish="metal")         # PGO-7 optic
            self.muzzle = flash(self.rifle, (0.94, 0, 0.04), 0.95)
            for dy in (0.095, -0.095):
                cyl(self.torso, 0.042, 0.54, (-0.31, dy, 0.42), c["armour"], sides=10, finish="metal")
                cyl(self.torso, 0.070, 0.22, (-0.31, dy, 0.78), c["rust"], sides=10, top=0.016, finish="rust")
        elif militia:
            # Authentic AK-47 wood-and-steel assault rifle with ribbed receiver, curved banana mag, gas tube & sight post
            taper_box(self.rifle, (0.32, 0.054), (0.29, 0.052), 0.115, (-0.28, 0, -0.03), c["wood"], rot=(0, 0.12, 0), bevel=0.012, finish="wood")
            box(self.rifle, (0.44, 0.068, 0.096), (0.04, 0, 0.0), c["gun"], bevel=0.012, finish="metal")
            box(self.rifle, (0.28, 0.062, 0.076), (0.32, 0, -0.005), c["wood"], bevel=0.012, finish="wood")
            cyl(self.rifle, 0.022, 0.48, (0.62, 0, 0.005), c["gun"], axis="X", sides=10, finish="metal")
            cyl(self.rifle, 0.017, 0.24, (0.48, 0, 0.044), c["gun"], axis="X", sides=8, finish="metal")
            box(self.rifle, (0.042, 0.026, 0.074), (0.78, 0, 0.040), c["gun"], finish="metal")  # front sight post
            box(self.rifle, (0.052, 0.040, 0.11), (-0.08, 0, -0.085), c["wood"], rot=(0, 0.28, 0), bevel=0.008, finish="wood")  # pistol grip
            # Curved AK banana magazine
            box(self.rifle, (0.075, 0.048, 0.16), (0.10, 0, -0.10), c["gun"], rot=(0, -0.25, 0), bevel=0.01, finish="metal")
            box(self.rifle, (0.072, 0.046, 0.15), (0.16, 0, -0.21), c["gun"], rot=(0, -0.52, 0), bevel=0.01, finish="metal")
            self.muzzle = flash(self.rifle, (0.90, 0, 0.008), 0.55)
        else:
            # Modern suppressed tactical carbine (M4A1 / HK416): buttstock, receiver, tan rail handguard, PEQ laser, optic, suppressor
            taper_box(self.rifle, (0.28, 0.052), (0.24, 0.050), 0.118, (-0.28, 0, -0.02), c["gun"], bevel=0.012, finish="rubber")
            box(self.rifle, (0.36, 0.064, 0.094), (0.0, 0, 0.0), c["gun"], bevel=0.012, finish="metal")
            box(self.rifle, (0.34, 0.060, 0.070), (0.32, 0, 0.005), tan, bevel=0.01, finish="paint")  # coyote rail handguard
            box(self.rifle, (0.09, 0.052, 0.036), (0.40, 0, 0.055), tan, bevel=0.006, finish="paint")  # PEQ-15 laser box
            cyl(self.rifle, 0.030, 0.26, (0.60, 0, 0.008), "#2c3136", axis="X", sides=12, bevel=0.006, finish="metal")  # suppressor
            box(self.rifle, (0.065, 0.045, 0.21), (0.07, 0, -0.135), tan, rot=(0, -0.22, 0), bevel=0.01, finish="paint")  # mag
            box(self.rifle, (0.048, 0.040, 0.11), (-0.08, 0, -0.09), c["gun"], rot=(0, 0.28, 0), bevel=0.008, finish="rubber")
            box(self.rifle, (0.042, 0.038, 0.095), (0.30, 0, -0.07), c["gun"], bevel=0.008, finish="rubber")  # vertical foregrip
            cyl(self.rifle, 0.034, 0.17, (0.02, 0, 0.086), c["gun"], axis="X", sides=12, bevel=0.006, finish="metal")  # ACOG scope
            self.muzzle = flash(self.rifle, (0.76, 0, 0.008), 0.52)

    def pose(self, anim, t):
        show(self.root, True)
        show(self.muzzle, False)
        self.fall.rotation_euler = (0, 0, 0)
        self.fall.location = (0, 0, 0)
        self.torso.rotation_euler = (0, 0.10, -0.14)
        self.head.rotation_euler = (0, -0.05, 0.12)
        # Athletic tactical combat-ready stance: wider grounded feet, rifle held cleanly out across chest so silhouette reads at 45px!
        z, legs = 0.84, [(0.20, 0.14), (-0.18, 0.14)]
        rifle, tilt = (0.31, -0.06, 0.30), 0.16
        arms = [(1.08, 0.56, 0.40), (0.62, 1.15, 0.30)]  # (swing forward, elbow bend, in toward the body)
        if anim == "walk":
            p = 2 * math.pi * t
            sn, cs = math.sin(p), math.cos(p)
            legs = [(0.56 * sn, 0.12 + 0.95 * max(0, cs) ** 1.3), (-0.56 * sn, 0.12 + 0.95 * max(0, -cs) ** 1.3)]
            z = 0.81 + 0.03 * math.cos(2 * p)
            self.torso.rotation_euler = (0.05 * cs, 0.18, -0.16 * sn)
            self.head.rotation_euler = (0, -0.06, 0.12 * sn)
            rifle = (0.31 + 0.02 * sn, -0.06, 0.29 + 0.025 * math.cos(2 * p))
            arms = [(1.04 + 0.1 * sn, 0.56, 0.40), (0.58 - 0.1 * sn, 1.15, 0.30)]
        if anim == "stop":
            legs = [(0.38, 0.30), (-0.22, 0.12)]
            z = 0.81
            self.torso.rotation_euler = (0, 0.05, -0.08)
        if anim in ("fire", "coverFire", "cover"):
            legs = [(0.32, 0.16), (-0.30, 0.18)]
            z = 0.82
            rifle, tilt = (0.36, -0.10, 0.42), 0
            arms = [(1.40, 0.22, 0.38), (0.98, 1.00, 0.14)]
            self.torso.rotation_euler = (0, 0.12, -0.10)
        if anim in ("cover", "coverFire"):
            legs = [(1.35, 1.45), (-0.25, 1.5)]
            z = 0.49
            self.torso.rotation_euler = (0, 0.22, -0.08)
            if anim == "cover":
                rifle, tilt = (0.32, -0.09, 0.31), 0.14
                arms = [(1.12, 0.42, 0.40), (0.64, 1.15, 0.28)]
                self.head.rotation_euler = (0, 0.26, 0)
        if (anim == "fire" and t == 1) or anim == "coverFire":
            show(self.muzzle, True)
            rifle = (rifle[0] - 0.05, rifle[1], rifle[2])
        if anim == "die":
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


def ribbon(parent, size, loc, look, rot=(0, 0, 0), cloth=False):
    """A strip of Aegis cobalt-blue recognition ribbon/tape, rendered with subtle cloth sheen."""
    if "ribbon" in look:
        obj = box(parent, size, loc, look["ribbon"], rot=rot, glow=0.10, bevel=0.006, finish="ribbon")
        if cloth:
            cloth_fold(obj, strength=0.008, scale=0.14)
        return obj


def crew(parent, loc, look, height=0.55, scarf=True):
    """A sculpted crewman from the waist up: cloth-folded tunic, olive chest rig, anatomical head & keffiyeh."""
    x0, y0, z0 = loc
    sculpted_limb(
        parent,
        [
            (z0,                 0.135, 0.195, x0,        y0),
            (z0 + height * 0.55, 0.150, 0.225, x0 + 0.01, y0),
            (z0 + height,        0.135, 0.215, x0,        y0),
        ],
        look["cloth"], finish="cloth", sides=12, fold=0.013, subsurf=1,
    )
    taper_box(parent, (0.31, 0.41), (0.32, 0.44), height * 0.62, (x0 + 0.02, y0, z0 + height * 0.56), look["armour"], bevel=0.03, finish="cloth", subsurf=1, smooth=True)
    # Anatomical head & layered keffiyeh
    hz = z0 + height
    head_rings = [
        ellipse_ring(x0 + 0.02, y0, hz + 0.07, 0.095, 0.082, 10),
        ellipse_ring(x0 + 0.03, y0, hz + 0.16, 0.115, 0.102, 10),
        ellipse_ring(x0 + 0.01, y0, hz + 0.24, 0.105, 0.095, 10),
    ]
    loft(parent, head_rings, look["skin"], finish="skin", subsurf=1)
    wrap_rings = [
        ellipse_ring(x0 - 0.01, y0, hz + 0.14, 0.145, 0.138, 12),
        ellipse_ring(x0 - 0.01, y0, hz + 0.22, 0.175, 0.162, 12),
        ellipse_ring(x0 - 0.02, y0, hz + 0.29, 0.138, 0.130, 12),
    ]
    cloth_fold(loft(parent, wrap_rings, look["head"], finish="cloth", subsurf=1), strength=0.016, scale=0.14)
    cyl(parent, 0.170, 0.045, (x0 - 0.005, y0, hz + 0.245), look["dark"], sides=14, bevel=0.01, finish="cloth")
    if scarf:
        cyl(parent, 0.145, 0.085, (x0, y0, hz + 0.04), look["head"], sides=12, bevel=0.02, finish="cloth")
        tail = taper_box(parent, (0.085, 0.21), (0.105, 0.17), 0.30, (x0 - 0.18, y0 + 0.03, hz + 0.05), look["head"], rot=(0, 0.26, 0), bevel=0.025, finish="cloth", subsurf=1, smooth=True)
        cloth_fold(tail, strength=0.014, scale=0.14)


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
            plane = _object("water", [(-30, -30, 0), (30, -30, 0), (30, 30, 0), (-30, 30, 0)], [(0, 1, 2, 3)], holdout(), None, fx=True)
            plane.location = (0, 0, -0.001)
        # "move" comes last, so the columns older code knows stay where they were.
        self.sheets = {
            "": [("idle", [0]), ("sink", [0.3, 0.6, 0.85]) if self.water else ("wreck", [0]), ("move", [0, 1] if self.water else [0, 1, 2])],
            "_turret": [("idle", [0]), ("fire", [0, 1, 2])],
        }

    def wheel(self, loc, radius, width, tyre, hub, treads=10):
        """A realistic heavy military wheel: beveled carcass, radial rubber tread lugs,
        recessed steel rim dish, bolt ring, and central planetary hub."""
        axle = joint(self.body, loc)
        cyl(axle, radius * 0.96, width, (0, 0, 0), tyre, axis="Y", sides=18, bevel=radius * 0.14, finish="rubber")
        # Radial off-road tread lugs (visible in profile and rotation!)
        if treads > 0 and radius >= 0.28:
            for i in range(treads):
                a = 2 * math.pi * i / treads
                box(axle, (radius * 0.24, width * 0.88, radius * 0.10), (math.sin(a) * radius * 0.97, 0, math.cos(a) * radius * 0.97), tyre, rot=(0, a, 0), bevel=0.008, finish="rubber")
        # Recessed rim ring + concave hub + bolt circle
        cyl(axle, radius * 0.56, width + 0.02, (0, 0, 0), "#191c1f", axis="Y", sides=14, finish="metal")
        cyl(axle, radius * 0.48, width + 0.036, (0, 0, 0), hub, axis="Y", sides=12, bevel=radius * 0.05, finish="paint")
        cyl(axle, radius * 0.22, width + 0.065, (0, 0, 0), "#24282e", axis="Y", sides=8, bevel=0.008, finish="metal")
        box(axle, (radius * 0.86, width + 0.044, radius * 0.12), (0, 0, 0), "#181c20", finish="metal")
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
    """Aegis Main Battle Tank: original modern composite MBT in weathered olive drab CARC armor
    with arrowhead wedge turret, bolted ERA/composite side skirts, 7 dished road wheels, recessed
    engine deck louvers, tow cables, bustle stowage, thermal sights, and cobalt-blue recognition ribbons."""

    cell, centre = 8.8, 0.80

    def build(self, c):
        b = self.body
        # Heavy track runs + 7 detailed road wheels + sprocket + idler + hinged bolted ballistic side skirts
        tread = [(-1.95, 0.0), (1.95, 0.0), (2.28, 0.34), (2.10, 0.66), (-2.10, 0.66), (-2.28, 0.34)]
        for side in (1, -1):
            prism_y(b, tread, 0.56, c["track"], y=1.00 * side, bevel=0.03, finish="rubber")
            for i in range(7):
                self.wheel((-1.62 + 0.54 * i, 1.24 * side, 0.24), 0.22, 0.14, c["track"], c["hull2"], treads=0)
            # Front idler & toothed rear drive sprocket
            cyl(b, 0.21, 0.15, (2.10, 1.22 * side, 0.43), c["hull2"], axis="Y", sides=14, bevel=0.02, finish="metal")
            cyl(b, 0.24, 0.16, (-2.08, 1.22 * side, 0.43), c["gun"], axis="Y", sides=12, bevel=0.02, finish="metal")
            # Animated rubber-padded track cleats along top run
            for i in range(13):
                link = box(b, (0.13, 0.58, 0.048), (-1.86 + 0.31 * i, 1.00 * side, 0.67), c["gun"], bevel=0.01, finish="metal")
                self.links.append((link, -1.86 + 0.31 * i, 0.31))
            # 6 hinged composite ballistic side skirts (heavy front armor blocks + bolted rear skirts) + rubber mudguard
            for i in range(6):
                thick = 0.145 if i >= 4 else 0.095
                col = c["deck"] if i in (2, 3, 4) else c["hull"]
                box(b, (0.64, thick, 0.42), (-1.68 + 0.68 * i, (1.32 + thick * 0.2) * side, 0.62), col, rot=(0.08 * side, 0, 0), bevel=0.018, finish="paint")
                # Hinge lug at top of each skirt panel
                box(b, (0.14, 0.08, 0.06), (-1.68 + 0.68 * i, 1.33 * side, 0.81), c["low"], bevel=0.008, finish="metal")
            box(b, (4.12, 0.045, 0.15), (0.0, 1.35 * side, 0.37), "#232629", bevel=0.01, finish="rubber")
            # Top fender shelf + side sponson tool bins + front armored mudflap
            prism_y(b, [(-2.26, 0.70), (2.22, 0.70), (2.40, 0.52), (2.30, 0.82), (-2.20, 0.82)], 0.68, c["hull2"], y=1.00 * side, bevel=0.02, finish="paint")
            box(b, (2.16, 0.38, 0.20), (-0.50, 1.00 * side, 0.91), c["hull"], bevel=0.025, finish="paint")
            bolt_row(b, (-1.45, 1.19 * side, 0.99), (0.45, 1.19 * side, 0.99), 5, radius=0.022)
            # Front tow shackle, brush-guarded headlight, rear armored exhaust
            box(b, (0.24, 0.14, 0.15), (2.34, 0.58 * side, 0.54), c["gun"], bevel=0.02, finish="metal")
            box(b, (0.21, 0.24, 0.16), (2.08, 0.88 * side, 0.85), c["hull2"], bevel=0.015, finish="paint")
            box(b, (0.05, 0.15, 0.09), (2.19, 0.88 * side, 0.85), "#fff0cc", glow=2.4)
            box(b, (0.26, 0.40, 0.24), (-2.24, 0.52 * side, 0.82), c["gun"], bevel=0.02, finish="metal")

        # Low-slung sloped composite hull + bolted glacis + braided tow cable + recessed slatted engine deck
        prism_y(b, [(-2.24, 0.36), (1.72, 0.36), (2.40, 0.64), (1.42, 1.03), (-2.24, 1.03)], 1.54, c["hull"], bevel=0.035, finish="paint")
        prism_y(b, [(1.38, 1.04), (2.32, 0.67), (2.24, 0.64), (1.32, 1.01)], 1.32, c["deck"], bevel=0.015, finish="paint")
        cyl(b, 0.034, 1.30, (2.02, 0.0, 0.83), "#4c5256", axis="Y", sides=8, finish="metal")  # braided steel tow cable
        # Driver's recessed periscope hood (3 dark smoked-glass vision blocks)
        box(b, (0.40, 0.46, 0.11), (1.20, 0.16, 1.05), c["hull2"], bevel=0.02, finish="paint")
        for dy in (-0.11, 0.0, 0.11):
            box(b, (0.075, 0.085, 0.055), (1.40, 0.16 + dy, 1.07), "#0e161d", bevel=0.005, finish="glass")
        # Deep recessed rear radiator engine deck louvers
        grate(b, (1.26, 1.32, 0.08), (-1.48, 0, 1.04), slats=6, slat_col=c["hull2"], axis="X")

        # Sleek arrowhead composite wedge turret + bustle rack + optics + pintle HMG + fluttering blue ribbons
        t = self.turret
        cyl(t, 0.84, 0.13, (0.0, 0, 1.04), c["gun"], sides=20, finish="metal")
        outline = [
            (1.56, 0.24), (1.56, -0.24),
            (0.68, -1.04), (-1.12, -0.96), (-1.58, -0.74),
            (-1.58, 0.74), (-1.12, 0.96), (0.68, 1.04),
        ]
        prism_z(t, outline, 1.06, 1.59, c["hull"], bottom=1.0, top=0.84, bevel=0.045, finish="paint")
        roof = [(1.06, 0.21), (1.06, -0.21), (0.46, -0.76), (-1.04, -0.70), (-1.04, 0.70), (0.46, 0.76)]
        prism_z(t, roof, 1.58, 1.64, c["deck"], bottom=1.0, top=0.95, bevel=0.018, finish="paint")
        for dy in (-0.34, 0.34):
            box(t, (0.62, 0.52, 0.05), (-0.96, dy, 1.65), c["hull2"], bevel=0.012, finish="paint")  # blowout panels
        # Rear turret bustle rack (tubular frame + displaced rolled tarp + ammo/ration box + blue recognition panel)
        box(t, (0.50, 1.40, 0.34), (-1.66, 0, 1.35), c["hull2"], bevel=0.025, finish="paint")
        tarp = cyl(t, 0.13, 0.82, (-1.70, 0.18, 1.59), c["tan"], axis="Y", sides=14, bevel=0.02, finish="cloth")
        cloth_fold(tarp, strength=0.014, scale=0.18)
        box(t, (0.34, 0.38, 0.24), (-1.68, -0.44, 1.59), c["deck"], bevel=0.02, finish="paint")
        # Twin 4-tube smoke grenade dischargers angled on turret cheeks
        for side in (1, -1):
            for k in range(4):
                cyl(t, 0.038, 0.24, (0.48 - 0.085 * k, 0.97 * side, 1.35 + 0.028 * k), c["gun"], axis="X", sides=8, finish="metal", rot_extra=(0, -0.35, 0.32 * side))
        # Gunner's primary thermal sight + commander's panoramic CITV + cupola + pintle HMG + whip aerials
        box(t, (0.44, 0.36, 0.23), (0.48, -0.44, 1.71), c["hull2"], bevel=0.02, finish="paint")
        box(t, (0.06, 0.24, 0.14), (0.70, -0.44, 1.71), "#12242e", bevel=0.008, finish="glass")
        cyl(t, 0.15, 0.27, (-0.16, 0.48, 1.76), c["hull2"], sides=14, bevel=0.015, finish="paint")
        box(t, (0.065, 0.16, 0.11), (-0.03, 0.48, 1.79), "#12242e", bevel=0.008, finish="glass")
        cyl(t, 0.31, 0.14, (-0.34, -0.40, 1.68), c["hull2"], sides=16, bevel=0.02, finish="paint")
        cyl(t, 0.24, 0.055, (-0.34, -0.40, 1.76), c["deck"], sides=14, bevel=0.01, finish="paint")
        box(t, (0.36, 0.10, 0.11), (-0.02, -0.40, 1.88), c["gun"], bevel=0.01, finish="metal")
        cyl(t, 0.022, 0.64, (0.42, -0.40, 1.88), c["gun"], axis="X", sides=8, finish="metal")
        box(t, (0.16, 0.13, 0.13), (-0.04, -0.27, 1.84), c["armour"], bevel=0.01, finish="paint")
        cyl(t, 0.25, 0.08, (-0.38, 0.36, 1.66), c["hull2"], sides=14, bevel=0.015, finish="paint")
        for side in (1, -1):
            cyl(t, 0.014, 1.28, (-1.36, 0.58 * side, 2.20), c["gun"], sides=6, finish="metal")

        # Heavy 120mm smoothbore cannon + recessed mantlet + bore evacuator + muzzle sensor + tied blue barrel band
        box(t, (0.46, 0.60, 0.34), (1.28, 0, 1.32), c["hull2"], bevel=0.03, finish="paint")
        self.barrel = joint(t, (1.34, 0, 1.32))
        cyl(self.barrel, 0.145, 0.66, (0.34, 0, 0), c["deck"], axis="X", sides=16, bevel=0.015, finish="paint")
        cyl(self.barrel, 0.094, 2.58, (1.33, 0, 0), c["hull"], axis="X", sides=16, finish="metal")
        cyl(self.barrel, 0.155, 0.54, (1.24, 0, 0), c["deck"], axis="X", sides=16, bevel=0.025, finish="paint")  # bore evacuator
        cyl(self.barrel, 0.115, 0.19, (2.62, 0, 0), c["gun"], axis="X", sides=14, bevel=0.01, finish="metal")
        box(self.barrel, (0.055, 0.042, 0.10), (2.62, 0, 0.145), c["gun"], bevel=0.005, finish="metal")  # muzzle sensor
        if "ribbon" in c:
            cyl(self.barrel, 0.106, 0.22, (2.10, 0, 0), c["ribbon"], axis="X", sides=16, glow=0.10, finish="ribbon")  # gun barrel band
            for side in (1, -1):
                pennant(t, (-1.36, 0.58 * side, 2.74), c, length=0.46, height=0.18)  # fluttering 3D cloth pennants on aerials!
            ribbon(t, (0.09, 1.38, 0.36), (-1.93, 0, 1.35), c, cloth=True)  # strapped blue cloth recognition panel on rear bustle
        self.muzzle = flash(self.barrel, (2.80, 0, 0), 1.55)

    def recoil(self, k):
        self.barrel.location = (1.34 - 0.38 * k, 0, 1.32)


class Technical(Vehicle):
    """Ashfall Gun Truck: battered desert 4x4 pickup with sculpted lofted hood/fenders, bullbar,
    recessed louvered grille, slat-armoured windshield, riveted rust door armor, cloth-folded roof tarp
    & sandbags, and shielded heavy DShK machine gun with sculpted gunner."""

    cell, centre = 7.2, 0.92
    pivot = -1.02

    def build(self, c):
        b = self.body
        # Chunky treaded off-road wheels + raised ladder frame, differential axles & leaf springs
        for x in (1.36, -1.26):
            cyl(b, 0.085, 1.72, (x, 0, 0.42), c["low"], axis="Y", sides=8, finish="metal")
            ball(b, 0.14, (x, 0.12, 0.42), c["low"], finish="metal")  # axle differential pumpkin
            for side in (1, -1):
                self.wheel((x, 0.88 * side, 0.42), 0.43, 0.34, "#1c1a18", c["hull2"], treads=10)
        box(b, (4.35, 1.46, 0.22), (0, 0, 0.64), c["low"], bevel=0.03, finish="metal")
        # Welded steel front bullbar + winch drum + vertical guards + warm headlights
        box(b, (0.22, 1.84, 0.24), (2.26, 0, 0.72), c["low"], bevel=0.03, finish="metal")
        cyl(b, 0.11, 0.46, (2.28, 0, 0.84), c["gun"], axis="Y", sides=10, finish="metal")  # front winch
        box(b, (0.10, 1.48, 0.38), (2.35, 0, 0.98), c["rust"], bevel=0.02, finish="rust")
        for side in (1, -1):
            box(b, (0.06, 0.25, 0.16), (2.21, 0.56 * side, 1.00), "#ffe296", glow=0.8)
            for x in (1.36, -1.26):
                box(b, (1.02, 0.18, 0.15), (x, 0.88 * side, 0.93), c["low"], bevel=0.03, finish="rubber")  # fender flares

        # Contoured lofted pickup bonnet + power bulge + recessed slatted radiator grille
        hood_rings = [
            [(1.18, -0.82, 0.76), (1.18, 0.82, 0.76), (1.18, 0.76, 1.22), (1.18, -0.76, 1.22)],
            [(1.72, -0.82, 0.76), (1.72, 0.82, 0.76), (1.72, 0.74, 1.18), (1.72, -0.74, 1.18)],
            [(2.18, -0.78, 0.78), (2.18, 0.78, 0.78), (2.18, 0.70, 1.12), (2.18, -0.70, 1.12)],
        ]
        loft(b, hood_rings, c["hull"], finish="rust", bevel=0.04, smooth=False)
        box(b, (0.66, 0.90, 0.065), (1.64, 0, 1.20), c["hull2"], bevel=0.02, finish="rust")
        grate(b, (0.10, 1.02, 0.28), (2.19, 0, 0.97), slats=4, slat_col=c["low"], axis="Y")

        # Sculpted pickup cab with angled dark glass windscreen, wipers & welded slat-armour bars
        prism_y(b, [(0.12, 0.74), (1.20, 0.74), (1.20, 1.18), (0.90, 1.69), (0.20, 1.69), (0.12, 1.24)], 1.64, c["hull"], bevel=0.05, finish="rust")
        prism_y(b, [(1.22, 1.20), (0.94, 1.65), (0.87, 1.65), (1.15, 1.20)], 1.38, "#162028", finish="glass")
        for k in (-0.36, 0.0, 0.36):
            box(b, (0.04, 0.048, 0.52), (1.08, k, 1.42), c["low"], rot=(0, -0.52, 0), finish="metal")
        box(b, (0.54, 1.67, 0.30), (0.58, 0, 1.42), "#162028", finish="glass")
        # Riveted rust-red improvised armour plates bolted over cab doors
        box(b, (0.84, 1.72, 0.43), (0.66, 0, 0.98), c["rust"], bevel=0.022, finish="rust")
        for side in (1, -1):
            bolt_row(b, (0.32, 0.87 * side, 1.15), (0.98, 0.87 * side, 1.15), 4, radius=0.018)
            box(b, (0.10, 0.14, 0.16), (1.06, 0.92 * side, 1.34), c["low"], bevel=0.02, finish="metal")
        # Roof cargo rack + cloth-folded olive camo tarp + tubular rollbar
        box(b, (0.66, 1.30, 0.07), (0.54, 0, 1.72), c["low"], bevel=0.015, finish="metal")
        tarp = cyl(b, 0.15, 1.12, (0.54, 0.04, 1.85), c["armour"], axis="Y", sides=14, bevel=0.03, finish="cloth")
        cloth_fold(tarp, strength=0.018, scale=0.16)
        for side in (1, -1):
            cyl(b, 0.055, 0.72, (0.04, 0.72 * side, 1.40), c["low"], sides=8, finish="metal")
        cyl(b, 0.055, 1.50, (0.04, 0, 1.76), c["low"], axis="Y", sides=8, finish="metal")

        # Open pickup bed with beveled walls, rusty tailgate, 3D displaced burlap sandbags, spare & ammo crate
        box(b, (2.15, 1.64, 0.12), (-1.05, 0, 0.78), c["hull2"], bevel=0.02, finish="rust")
        for side in (1, -1):
            box(b, (2.15, 0.10, 0.42), (-1.05, 0.79 * side, 1.00), c["hull"], bevel=0.025, finish="rust")
            for dx in (-0.36, -0.96, -1.56):
                sb = box(b, (0.50, 0.24, 0.18), (dx, 0.64 * side, 1.15), "#b29560", bevel=0.06, finish="cloth", subsurf=1, smooth=True)
                cloth_fold(sb, strength=0.018, scale=0.14)
        box(b, (0.10, 1.64, 0.42), (-2.10, 0, 1.00), c["rust"], bevel=0.025, finish="rust")
        box(b, (0.44, 0.34, 0.36), (-0.28, 0.48, 1.02), c["armour"], bevel=0.03, finish="paint")
        box(b, (0.48, 0.36, 0.28), (-0.30, -0.46, 0.98), c["wood"], bevel=0.025, finish="wood")

        # Heavy pintle-mounted DShK HMG with angled V-shaped rust gun shield & sculpted Ashfall gunner
        t = self.turret
        cyl(t, 0.075, 0.84, (0, 0, 1.24), c["gun"], sides=10, finish="metal")
        for side in (1, -1):
            cyl(t, 0.035, 0.56, (-0.12, 0.22 * side, 1.06), c["low"], sides=8, finish="metal")
        self.gun = joint(t, (0, 0, 1.70))
        box(self.gun, (0.76, 0.18, 0.20), (0.10, 0, 0), c["gun"], bevel=0.025, finish="metal")
        cyl(self.gun, 0.068, 0.38, (0.58, 0, 0.02), c["low"], axis="X", sides=10, finish="metal")
        cyl(self.gun, 0.044, 0.98, (0.95, 0, 0.02), c["gun"], axis="X", sides=10, finish="metal")
        cyl(self.gun, 0.072, 0.17, (1.44, 0, 0.02), c["gun"], axis="X", sides=10, top=0.045, finish="metal")
        box(self.gun, (0.32, 0.26, 0.24), (0.06, 0.22, -0.05), c["armour"], bevel=0.025, finish="paint")
        for side in (1, -1):
            box(self.gun, (0.06, 0.42, 0.56), (0.34, 0.19 * side, 0.12), c["rust"], rot=(0, -0.14, -0.30 * side), bevel=0.015, finish="rust")
        crew(t, (-0.52, 0, 0.86), c, height=0.64)
        for side in (1, -1):
            sculpted_limb(t, [(0, 0.072, 0.068, 0, 0), (-0.26, 0.062, 0.058, 0, 0), (-0.50, 0.052, 0.048, 0, 0)], c["cloth"], finish="cloth", loc=(-0.44, 0.21 * side, 1.46), rot=(0, -1.25, 0))
            gloved_hand(t, (-0.02, 0.19 * side, 1.56), colour=c["skin"], finish="skin")
        self.muzzle = flash(self.gun, (1.54, 0, 0.02), 0.95)

    def recoil(self, k):
        self.gun.location = (-0.08 * k, 0, 1.70)


class PatrolBoat(Vehicle):
    """Aegis Fast Patrol Craft: lofted deep-V naval hull with flared bow & chine spray rails,
    sloped armored wheelhouse, framed dark bridge glass, cobalt-blue recognition band & fluttering
    mast pennant, radar scanner arch, deck bollards, and faceted bow remote autocannon."""

    cell, centre = 8.4, 0.7
    pivot = 1.55
    water = True

    def build(self, c):
        b = self.body
        # Smoothly lofted deep-V naval hull with flared bow, chine spray rails & clean deck sheerline!
        stations = [
            (-2.72, 0.62, 0.72, -0.34, 0.08, 0.50),
            (-1.90, 0.74, 0.86, -0.38, 0.08, 0.52),
            (-0.40, 0.78, 0.90, -0.40, 0.10, 0.54),
            (1.10,  0.66, 0.82, -0.36, 0.14, 0.58),
            (2.25,  0.34, 0.48, -0.26, 0.22, 0.62),
            (3.05,  0.02, 0.04, -0.10, 0.34, 0.66),
        ]
        hull_rings = []
        for x, wb, wt, zk, zc, zd in stations:
            hull_rings.append([
                (x, 0.0, zk), (x, wb, zc), (x, wt, zd),
                (x, -wt, zd), (x, -wb, zc),
            ])
        loft(b, hull_rings, c["hull"], finish="paint", bevel=0.015, smooth=False)
        # Dark antifouling boot stripe at waterline + heavy rubber fendering rub-rail along sheer
        boot_rings = [[(x, 0.0, -0.02), (x, wb * 1.02, 0.11), (x, -wb * 1.02, 0.11)] for x, wb, wt, zk, zc, zd in stations]
        loft(b, boot_rings, c["low"], finish="rubber", smooth=False)
        for side in (1, -1):
            rub = [[(x, wt * side * 1.01, zd - 0.06), (x, wt * side * 1.04, zd - 0.01), (x, wt * side * 1.01, zd + 0.02), (x, wt * side * 0.96, zd - 0.02)] for x, wb, wt, zk, zc, zd in stations[:-1]]
            loft(b, rub, c["low"], finish="rubber", smooth=False)
        # Clean non-slip deck flush with sheerline + mooring bollards & lifebuoy
        deck_rings = [[(x, wt * 0.86, zd + 0.01), (x, wt * 0.84, zd + 0.05), (x, -wt * 0.84, zd + 0.05), (x, -wt * 0.86, zd + 0.01)] for x, wb, wt, zk, zc, zd in stations[:-1]]
        loft(b, deck_rings, c["deck"], finish="paint", bevel=0.01, smooth=False)
        for x, y in ((2.05, 0.32), (2.05, -0.32), (-2.25, 0.55), (-2.25, -0.55)):
            cyl(b, 0.045, 0.14, (x, y, 0.64), c["low"], sides=8, finish="metal")
        # Sloped armored wheelhouse with multi-pane angled tinted bridge windows + brow overhang
        prism_y(b, [(-1.55, 0.54), (0.62, 0.54), (0.28, 1.36), (-1.45, 1.36)], 1.14, c["hull2"], bevel=0.03, finish="paint")
        prism_y(b, [(0.58, 0.88), (0.34, 1.26), (0.26, 1.26), (0.50, 0.88)], 0.96, "#101b24", finish="glass")
        for dy in (-0.28, 0.0, 0.28):
            box(b, (0.04, 0.04, 0.40), (0.43, dy, 1.07), c["hull2"], rot=(0, -0.58, 0), finish="metal")  # bridge mullions
        box(b, (1.06, 1.17, 0.24), (-0.60, 0, 1.09), "#101b24", finish="glass")
        box(b, (1.82, 1.24, 0.08), (-0.58, 0, 1.38), c["deck"], bevel=0.015, finish="paint")  # roof brow
        # Swept twin-leg radar arch mast, spinning scanner bar, nav beacon, whip aerial & fluttering blue pennant!
        for side in (1, -1):
            box(b, (0.09, 0.07, 0.85), (-0.95, 0.28 * side, 1.78), c["low"], rot=(0.16 * side, -0.22, 0), bevel=0.01, finish="metal")
        box(b, (0.14, 0.66, 0.07), (-1.04, 0, 2.16), c["deck"], bevel=0.01, finish="paint")
        box(b, (0.11, 0.86, 0.09), (-1.04, 0, 2.26), c["deck"], bevel=0.012, finish="paint")  # radar bar
        box(b, (0.09, 0.09, 0.10), (-1.04, 0, 2.38), c["trim"], glow=1.6, fx=True)
        cyl(b, 0.016, 1.05, (-1.28, 0.42, 1.92), c["gun"], sides=6, finish="metal")  # comms whip
        # Aft twin waterjet engine casing & recessed exhaust vents
        box(b, (0.76, 0.94, 0.34), (-2.12, 0, 0.70), c["low"], bevel=0.025, finish="metal")
        grate(b, (0.52, 0.72, 0.06), (-2.12, 0, 0.88), slats=4, slat_col=c["hull2"], axis="X")
        ribbon(b, (0.58, 1.18, 0.28), (-1.02, 0, 0.78), c, cloth=True)  # blue recognition band round cabin
        pennant(b, (-1.28, 0.42, 2.34), c, length=0.46, height=0.17)  # fluttering blue cloth pennant

        # Faceted naval remote weapon station (RWS) turret on foredeck
        t = self.turret
        cyl(t, 0.36, 0.22, (0, 0, 0.66), c["low"], sides=14, bevel=0.02, finish="metal")
        self.gun = joint(t, (0, 0, 0.96))
        prism_y(self.gun, [(-0.40, -0.20), (0.34, -0.20), (0.44, 0.04), (0.12, 0.25), (-0.36, 0.25)], 0.56, c["deck"], bevel=0.025, finish="paint")
        box(self.gun, (0.16, 0.16, 0.14), (0.18, 0.32, 0.08), c["low"], bevel=0.015, finish="metal")  # electro-optic pod
        cyl(self.gun, 0.09, 0.32, (0.46, 0, 0.04), c["hull2"], axis="X", sides=12, finish="metal")  # barrel sleeve
        cyl(self.gun, 0.052, 1.18, (0.90, 0, 0.04), c["gun"], axis="X", sides=10, finish="metal")  # autocannon barrel
        cyl(self.gun, 0.072, 0.14, (1.46, 0, 0.04), c["low"], axis="X", sides=10, finish="metal")  # muzzle brake
        self.muzzle = flash(self.gun, (1.56, 0, 0.04), 1.0)

    def recoil(self, k):
        self.gun.location = (-0.12 * k, 0, 0.96)


class Speedboat(Vehicle):
    """Ashfall Raider Skiff: weathered deep-V wooden/fiberglass hull with flared bow, bolted side
    armor plates, ribbed interior deck, cowled outboard motor, fuel drum, helmsman & bow HMG gunner."""

    cell, centre = 6.6, 0.6
    pivot = 0.85
    water = True

    def build(self, c):
        b = self.body
        # Lofted flared V-hull skiff in weathered sun-bleached timber/sand + rusted lower waterline
        stations = [
            (-1.95, 0.46, 0.54, -0.26, 0.06, 0.44),
            (-1.10, 0.58, 0.68, -0.30, 0.06, 0.46),
            (0.25,  0.58, 0.68, -0.30, 0.08, 0.50),
            (1.35,  0.42, 0.56, -0.24, 0.14, 0.56),
            (2.38,  0.02, 0.04, -0.06, 0.28, 0.64),
        ]
        hull_rings = [[(x, 0.0, zk), (x, wb, zc), (x, wt, zd), (x, -wt, zd), (x, -wb, zc)] for x, wb, wt, zk, zc, zd in stations]
        loft(b, hull_rings, c["hull2"], finish="wood", bevel=0.015, smooth=False)
        lower_rings = [[(x, 0.0, zk - 0.01), (x, wb * 1.02, zc + 0.08), (x, -wb * 1.02, zc + 0.08)] for x, wb, wt, zk, zc, zd in stations]
        loft(b, lower_rings, c["rust"], finish="rust", smooth=False)
        # Timber gunwale rails + open ribbed deck well
        hull_plan = [(2.28, 0), (1.30, 0.58), (-1.75, 0.68), (-1.94, 0.52), (-1.94, -0.52), (-1.75, -0.68), (1.30, -0.58)]
        prism_z(b, hull_plan, 0.40, 0.50, c["wood"], bottom=1.02, top=1.04, bevel=0.015, finish="wood")
        prism_z(b, hull_plan, 0.44, 0.48, c["low"], bottom=0.86, top=0.86, finish="wood")
        # Bolted improvised scrap armor plates along hull flanks
        for x, y, l, col in ((0.2, 0.70, 0.72, c["hull2"]), (-0.9, -0.71, 0.56, c["armour"]), (-0.9, 0.71, 0.56, c["hull2"]), (0.4, -0.69, 0.56, c["rust"])):
            box(b, (l, 0.06, 0.24), (x, y, 0.26), col, bevel=0.01, finish="rust")
        # Detailed cowled outboard engine + tiller + strapped fuel drum + wooden supply crate
        taper_box(b, (0.34, 0.36), (0.44, 0.44), 0.52, (-2.10, 0, 0.66), c["gun"], bevel=0.03, finish="metal")
        taper_box(b, (0.44, 0.46), (0.38, 0.40), 0.22, (-2.10, 0, 0.96), c["hull2"], bevel=0.03, finish="rust")
        cyl(b, 0.025, 0.55, (-1.75, 0.14, 0.80), c["low"], axis="X", sides=6, finish="metal")  # tiller handle
        cyl(b, 0.21, 0.54, (-0.42, 0.32, 0.70), c["armour"], sides=14, bevel=0.02, finish="rust")  # fuel drum
        box(b, (0.44, 0.34, 0.26), (-0.45, -0.32, 0.60), c["wood"], bevel=0.02, finish="wood")
        crew(b, (-1.35, -0.10, 0.44), c, height=0.50)

        t = self.turret
        for a in (0, 2.1, 4.2):
            cyl(t, 0.026, 0.58, (0.12 * math.cos(a), 0.12 * math.sin(a), 0.68), c["gun"], sides=6, finish="metal", rot_extra=(0.35 * math.sin(a), -0.35 * math.cos(a), 0))
        self.gun = joint(t, (0, 0, 0.98))
        box(self.gun, (0.62, 0.15, 0.17), (0.10, 0, 0), c["gun"], bevel=0.02, finish="metal")
        cyl(self.gun, 0.042, 0.84, (0.76, 0, 0.02), c["gun"], axis="X", sides=10, finish="metal")
        cyl(self.gun, 0.064, 0.14, (1.16, 0, 0.02), c["low"], axis="X", sides=8, top=0.04, finish="metal")
        box(self.gun, (0.28, 0.22, 0.22), (0.05, 0.19, -0.05), c["armour"], bevel=0.02, finish="paint")
        crew(t, (-0.50, 0, 0.44), c, height=0.44)
        for side in (1, -1):
            sculpted_limb(t, [(0, 0.068, 0.064, 0, 0), (-0.22, 0.058, 0.055, 0, 0), (-0.44, 0.048, 0.045, 0, 0)], c["cloth"], finish="cloth", loc=(-0.44, 0.19 * side, 0.86), rot=(0, -1.25, 0))
            gloved_hand(t, (-0.06, 0.17 * side, 0.95), colour=c["skin"], finish="skin")
        self.muzzle = flash(self.gun, (1.22, 0, 0.02), 0.8)

    def recoil(self, k):
        self.gun.location = (-0.07 * k, 0, 0.98)


class RocketLauncher(Vehicle):
    """Aegis 6x6 Heavy Tactical MLRS Artillery Truck: armored cab-forward chassis with brush guard,
    recessed louvered grille, step ladders, 6 treaded off-road wheels, hydraulic stabilizer jacks,
    cobalt-blue cab stripe & fluttering aerial pennant, and elevated 12-tube armored launch pod."""

    cell, centre = 8.6, 1.0
    pivot = -1.2

    def build(self, c):
        b = self.body
        # Heavy 6x6 off-road chassis, differential axles, suspension & 6 treaded tires with wheel arches
        for x in (1.75, -0.55, -1.75):
            cyl(b, 0.09, 1.82, (x, 0, 0.42), c["low"], axis="Y", sides=8, finish="metal")
            for side in (1, -1):
                self.wheel((x, 0.92 * side, 0.42), 0.44, 0.36, "#181a1c", c["hull2"], treads=10)
                box(b, (1.02, 0.24, 0.12), (x, 0.92 * side, 0.92), c["low"], bevel=0.02, finish="rubber")  # mudguard
        box(b, (5.15, 1.48, 0.26), (0, 0, 0.74), c["low"], bevel=0.025, finish="metal")  # ladder frame
        # Fuel tanks & battery boxes tucked between axles
        for side in (1, -1):
            cyl(b, 0.20, 0.88, (0.55, 0.78 * side, 0.56), c["hull2"], axis="X", sides=12, bevel=0.02, finish="metal")
            box(b, (0.32, 0.22, 0.14), (1.12, 0.88 * side, 0.52), c["low"], bevel=0.01, finish="metal")  # cab step
        # Sloped armored forward-control cab with multi-pane armored windscreen, roof hatch & brush guard
        prism_y(b, [(0.98, 0.86), (2.52, 0.86), (2.56, 1.38), (2.06, 1.98), (0.98, 1.98)], 1.72, c["hull"], bevel=0.035, finish="paint")
        prism_y(b, [(2.55, 1.40), (2.11, 1.94), (2.03, 1.94), (2.47, 1.40)], 1.44, "#111b22", finish="glass")
        box(b, (0.05, 0.07, 0.56), (2.30, 0.0, 1.67), c["hull2"], rot=(0, -0.68, 0), finish="paint")  # split windshield pillar
        box(b, (0.54, 1.74, 0.28), (1.46, 0, 1.62), "#111b22", finish="glass")
        grate(b, (0.10, 1.18, 0.34), (2.54, 0, 1.14), slats=4, slat_col=c["low"], axis="Y")  # armored grille
        box(b, (0.20, 1.84, 0.24), (2.58, 0, 0.82), c["low"], bevel=0.025, finish="metal")  # heavy bumper
        for side in (1, -1):
            box(b, (0.06, 0.22, 0.12), (2.56, 0.68 * side, 1.12), "#fff0cc", glow=1.6)  # warm headlights
            box(b, (0.12, 0.16, 0.24), (2.12, 0.96 * side, 1.56), c["low"], bevel=0.015, finish="metal")  # wing mirrors
        cyl(b, 0.28, 0.09, (1.46, 0.32, 2.02), c["hull2"], sides=14, bevel=0.015, finish="paint")  # roof hatch
        cyl(b, 0.07, 1.15, (0.92, -0.82, 1.48), c["gun"], sides=10, finish="metal")  # vertical exhaust stack
        # Armored flatbed, generator cabinet, spare tire & rear hydraulic stabilizer legs
        box(b, (3.45, 1.72, 0.14), (-0.78, 0, 0.90), c["hull2"], bevel=0.02, finish="paint")
        box(b, (0.64, 1.56, 0.56), (0.52, 0, 1.24), c["hull2"], bevel=0.025, finish="paint")
        grate(b, (0.08, 0.72, 0.32), (0.52, 0.79, 1.24), slats=4, slat_col=c["low"], axis="Z")
        for side in (1, -1):
            box(b, (0.20, 0.20, 0.58), (-2.28, 0.78 * side, 0.60), c["low"], bevel=0.018, finish="metal")  # hydraulic outriggers
            box(b, (0.28, 0.28, 0.06), (-2.28, 0.78 * side, 0.30), c["gun"], bevel=0.01, finish="metal")  # jack footpads
        cyl(b, 0.018, 1.15, (1.10, -0.72, 2.52), c["gun"], sides=6, finish="metal")
        pennant(b, (1.10, -0.72, 2.98), c, length=0.44, height=0.17)  # fluttering blue aerial pennant
        ribbon(b, (0.48, 1.76, 0.16), (1.48, 0, 1.32), c, cloth=True)  # bold cobalt-blue band round cab

        # Rotating armored 12-tube MLRS launch pod with hydraulic elevation rams & recessed steel tubes
        t = self.turret
        cyl(t, 0.56, 0.18, (0, 0, 1.04), c["low"], sides=16, bevel=0.02, finish="metal")
        box(t, (0.42, 1.08, 0.54), (-0.34, 0, 1.30), c["hull2"], bevel=0.025, finish="paint")
        for side in (1, -1):
            cyl(t, 0.055, 0.85, (0.18, 0.56 * side, 1.32), "#8c9298", sides=10, finish="metal", rot_extra=(0, 0.55, 0))  # chrome hydraulic rams
        self.pod = joint(t, (-0.20, 0, 1.56))
        self.pod.rotation_euler = (0, -0.38, 0)
        # Chamfered armored launch pod housing + structural reinforcement ribs
        box(self.pod, (2.36, 1.26, 0.80), (0.76, 0, 0.20), c["deck"], bevel=0.04, finish="paint")
        for dx in (0.10, 0.76, 1.42):
            box(self.pod, (0.14, 1.32, 0.86), (dx, 0, 0.20), c["hull"], bevel=0.02, finish="paint")  # reinforcing bands
        box(self.pod, (0.06, 1.16, 0.70), (1.92, 0, 0.20), "#101316", finish="metal")  # recessed dark face plate
        # 2x6 array of 12 detailed steel rocket launch tubes
        for yi in range(4):
            y = -0.42 + 0.28 * yi
            for zi in range(2):
                z = 0.02 + 0.34 * zi
                cyl(self.pod, 0.115, 0.14, (1.94, y, z), c["gun"], axis="X", sides=12, bevel=0.01, finish="metal")
                cyl(self.pod, 0.088, 0.16, (1.96, y, z), "#0b0d0f", axis="X", sides=10, finish="metal")
        ribbon(self.pod, (0.24, 1.34, 0.88), (-0.18, 0, 0.20), c, cloth=True)  # bold cobalt-blue pod recognition band
        self.muzzle = flash(self.pod, (2.06, 0, 0.20), 1.9)

    def recoil(self, k):
        self.pod.location = (-0.20 - 0.12 * k, 0, 1.56)


class Helicopter(Vehicle):
    """Aegis Attack Gunship: sleek lofted tandem-seat combat helicopter with spherical nose FLIR/TADS
    sensor turret, framed flat-plate stealth canopy, twin side turbine nacelles, tapered stub wings
    with 19-tube rocket pods & ATGMs, slender tail boom with blue recognition band, and 4-blade rotor."""

    cell, centre = 10.4, 1.5
    pivot = 1.5
    manifest = {"altitude": 3.0, "fps": {"idle": 16, "move": 16, "bankLeft": 16, "bankRight": 16}}
    facings = FACINGS

    def __init__(self, look):
        super().__init__(look)
        self.sheets[""] = [("idle", [0, 1, 2]), ("wreck", [0]), ("move", [0, 1, 2]), ("bankLeft", [0, 1, 2]), ("bankRight", [0, 1, 2])]

    def build(self, c):
        b = self.body
        # Lofted sleek narrow faceted gunship fuselage (NOT a blocky box prism!)
        fuse_stations = [
            (2.85,  0.22, 0.20, 0.78, 1.12),
            (2.35,  0.40, 0.36, 0.66, 1.48),
            (1.30,  0.54, 0.44, 0.60, 1.98),
            (0.00,  0.58, 0.48, 0.58, 2.08),
            (-1.25, 0.48, 0.38, 0.68, 1.95),
            (-1.85, 0.28, 0.24, 0.96, 1.66),
        ]
        fuse_rings = []
        for x, wb, wt, zb, zt in fuse_stations:
            zm = (zb + zt) * 0.52
            fuse_rings.append([
                (x, 0.0, zb), (x, wb, zb + 0.14), (x, wb * 1.04, zm),
                (x, wt, zt), (x, -wt, zt), (x, -wb * 1.04, zm), (x, -wb, zb + 0.14),
            ])
        loft(b, fuse_rings, c["hull"], finish="paint", bevel=0.025, smooth=False)
        # Avionics side cheek sponsons along lower nose
        for side in (1, -1):
            prism_y(b, [(2.15, 0.76), (0.35, 0.72), (-0.45, 0.80), (-0.45, 1.24), (1.75, 1.28)], 0.26, c["hull2"], y=0.58 * side, bevel=0.025, finish="paint")
        # Multi-facet tinted tandem cockpit canopy + armored divider frames
        prism_y(b, [(2.32, 1.46), (1.42, 2.04), (0.28, 2.08), (0.58, 1.50)], 0.78, "#0f1a22", bevel=0.015, finish="glass")
        for x, tilt in ((1.86, 0.58), (1.24, 0.16), (0.56, -0.22)):
            box(b, (0.075, 0.82, 0.54), (x, 0, 1.78), c["hull2"], rot=(0, tilt, 0), bevel=0.01, finish="paint")
        # Spherical nose TADS/FLIR electro-optical targeting turret
        box(b, (0.42, 0.44, 0.36), (2.78, 0, 1.06), c["hull2"], bevel=0.03, finish="paint")
        ball(b, 0.17, (2.98, 0.11, 1.04), "#101a22", finish="glass")
        ball(b, 0.14, (2.98, -0.11, 1.08), c["low"], finish="metal")
        # Twin side turbine engine nacelles with dark intakes & baffled IR-suppressor exhausts
        for side in (1, -1):
            cyl(b, 0.26, 1.55, (-0.28, 0.62 * side, 1.88), c["hull2"], axis="X", sides=14, bevel=0.03, finish="paint")
            cyl(b, 0.21, 0.12, (0.50, 0.62 * side, 1.88), "#101316", axis="X", sides=12, finish="metal")  # intake mouth
            box(b, (0.42, 0.34, 0.26), (-1.12, 0.64 * side, 1.88), c["low"], bevel=0.02, finish="metal")  # IR exhaust box
        # Lofted slender tapered tail boom + swept tail fin + stabilator + 4-blade canted tail rotor
        boom_rings = [
            ellipse_ring(-1.60, 0, 1.34, 0.22, 0.28, 10, axis="X"),
            ellipse_ring(-3.00, 0, 1.44, 0.16, 0.21, 10, axis="X"),
            ellipse_ring(-4.45, 0, 1.54, 0.11, 0.15, 10, axis="X"),
        ]
        loft(b, boom_rings, c["hull2"], finish="paint", smooth=True)
        prism_y(b, [(-3.85, 1.52), (-4.42, 2.66), (-4.88, 2.66), (-4.52, 1.42)], 0.12, c["hull"], bevel=0.015, finish="paint")
        prism_z(b, [(-4.05, -0.82), (-4.52, -0.78), (-4.52, 0.78), (-4.05, 0.82)], 1.66, 1.74, c["hull2"], bevel=0.012, finish="paint")
        # 4-blade tail rotor hub & blades
        cyl(b, 0.11, 0.16, (-4.68, 0.14, 2.38), c["low"], axis="Y", sides=10, finish="metal")
        for a in (0.3, 1.87):
            box(b, (0.98, 0.04, 0.09), (-4.68, 0.18, 2.38), c["gun"], rot=(0, a, 0), finish="metal")
        # Bold cobalt-blue recognition band wrapped around tail boom
        if "ribbon" in c:
            cyl(b, 0.23, 0.42, (-2.88, 0, 1.43), c["ribbon"], axis="X", sides=12, glow=0.10, finish="ribbon")
        # Tapered stub wings + 19-tube rocket pods + twin rail-mounted ATGMs + arched landing skids
        for side in (1, -1):
            prism_z(b, [(0.82, 0.45 * side), (0.58, 1.72 * side), (-0.18, 1.65 * side), (-0.30, 0.45 * side)], 1.15, 1.28, c["hull2"], bevel=0.015, finish="paint")
            cyl(b, 0.19, 1.08, (0.34, 1.18 * side, 0.96), c["deck"], axis="X", sides=14, bevel=0.02, finish="paint")  # rocket pod
            cyl(b, 0.17, 0.05, (0.89, 1.18 * side, 0.96), "#121518", axis="X", sides=12, finish="metal")
            # Twin guided anti-tank missiles on outer wing rack
            for dz in (-0.09, 0.09):
                cyl(b, 0.065, 1.22, (0.32, 1.62 * side, 0.98 + dz), c["low"], axis="X", sides=10, finish="metal")
                cyl(b, 0.065, 0.16, (0.98, 1.62 * side, 0.98 + dz), c["tan"], axis="X", sides=10, top=0.015, finish="paint")
            # Curved tubular landing skids + shock struts
            cyl(b, 0.045, 2.55, (0.60, 0.66 * side, 0.05), c["low"], axis="X", sides=10, finish="metal")
            for x in (1.35, -0.15):
                cyl(b, 0.04, 0.68, (x, 0.56 * side, 0.36), c["low"], sides=8, finish="metal", rot_extra=(0.24 * side, 0, 0))
        # Detailed main rotor mast, swashplate hub, Longbow-style mast radome & 4 tapered composite blades
        cyl(b, 0.11, 0.56, (0.28, 0, 2.54), c["low"], sides=12, finish="metal")
        self.rotor = joint(b, (0.28, 0, 2.86))
        cyl(self.rotor, 0.24, 0.14, (0, 0, 0), c["hull2"], sides=12, bevel=0.02, finish="metal")
        cyl(self.rotor, 0.36, 0.16, (0, 0, 0.22), c["deck"], sides=14, bevel=0.04, finish="paint")  # mast radar dome
        for a in (0, math.pi / 2):
            blade = box(self.rotor, (7.7, 0.22, 0.036), (0, 0, 0), c["gun"], rot=(0, 0, a), bevel=0.008, finish="metal")
            blade["blade"] = True

        t = self.turret
        self.gun = joint(t, (0, 0, 0.72))
        box(self.gun, (0.46, 0.32, 0.26), (0, 0, 0), c["low"], bevel=0.025, finish="metal")
        cyl(self.gun, 0.052, 0.96, (0.58, 0, -0.04), c["gun"], axis="X", sides=10, finish="metal")
        cyl(self.gun, 0.072, 0.14, (1.06, 0, -0.04), c["low"], axis="X", sides=8, finish="metal")
        self.muzzle = flash(self.gun, (1.14, 0, -0.04), 0.9)

    def recoil(self, k):
        self.gun.location = (-0.08 * k, 0, 0.72)

    def pose(self, anim, t, sheet):
        super().pose(anim, t, sheet)
        self.rotor.rotation_euler = (0, 0, 0.5 if anim == "wreck" else t * math.pi / 6)
        if anim == "move":
            self.body.rotation_euler = (0, 0.15, 0)
        if anim in ("bankLeft", "bankRight"):
            self.body.rotation_euler = (0.34 * (-1 if anim == "bankLeft" else 1), 0.1, 0)
        if anim == "wreck":
            self.body.rotation_euler = (0.5, -0.1, 0)
            self.body.location = (0, 0.3, -0.35)
            self.rotor.rotation_euler = (0.35, 0.25, 0.5)
            self.turret.location = (self.pivot - 0.3, 0.5, -0.4)


class Plane(Vehicle):
    """A fixed-wing strike aircraft: one sheet, no weapon that turns. It is rendered
    standing on its wheels (`idle`, parked on the pad); under way the page lifts it and
    lays its shadow on the ground. Everything hangs from `air`, a joint on the line of
    the fuselage, so a bank rolls the aircraft about itself."""

    facings = FACINGS16  # it flies straight at whatever it is sent to, from any side
    axis = 1.5  # the height of the fuselage's centre line when it stands on its wheels
    spins = 1  # frames of the propeller turning, 1 for a jet
    size = 0.8  # the model is built a little large and drawn at this: a parked one must not hide its airbase

    def __init__(self, look):
        self.look = look
        self.root = joint(None, name="root")
        self.body = joint(self.root, name="body")
        self.body.scale = (self.size,) * 3
        self.air = joint(self.body, (0, 0, self.axis), name="air")
        self.hull = joint(self.air, (0, 0, -self.axis), name="hull")
        self.gear = joint(self.hull, name="gear")
        self.wings = {}
        self.prop = None
        self.build(look)
        turning = list(range(self.spins))
        self.sheets = {"": [("idle", [0]), ("wreck", [0]), ("move", turning), ("bankLeft", turning), ("bankRight", turning)]}

    def wing(self, side, outline, z0, z1, colour):
        """One wing on its own joint at the root, so that a wreck can break it."""
        root = joint(self.hull, (0, 0.4 * side, z0), name="wing")
        prism_z(root, [(x, (y - 0.4) * side) for x, y in outline], 0, z1 - z0, colour)
        self.wings[side] = root
        return root

    def bomb(self, parent, loc, length, radius, colour, nose):
        x, y, z = loc
        cyl(parent, radius, length, loc, colour, axis="X", sides=8)
        cyl(parent, radius, radius * 2.2, (x + length / 2 + radius * 1.1, y, z), nose, axis="X", sides=8, top=0.03)
        box(parent, (0.26, radius * 3, 0.04), (x - length / 2 - 0.05, y, z), nose)
        box(parent, (0.26, 0.04, radius * 3), (x - length / 2 - 0.05, y, z), nose)

    def pose(self, anim, t, sheet):
        show(self.root, True)
        show(self.gear, anim == "idle" or self.fixed_gear)
        char(self.root, anim == "wreck")
        self.body.location = (0, 0, 0)
        self.air.rotation_euler = (0, 0, 0)
        for root in self.wings.values():
            root.rotation_euler = (0, 0, 0)
        if self.prop:
            self.prop.rotation_euler = (t * math.pi / 3 if anim != "idle" else 0.3, 0, 0)
        if anim == "move":
            self.air.rotation_euler = (0, 0.03, 0)
        if anim in ("bankLeft", "bankRight"):
            # Leaning into the turn: the left wing drops in a turn to the left.
            self.air.rotation_euler = (0.5 * (-1 if anim == "bankLeft" else 1), 0.03, 0)
        if anim == "wreck":
            # Down on its belly, over on one wing, the other broken at the root.
            show(self.gear, False)
            self.body.location = (0, 0.2, -self.belly * self.size)
            self.air.rotation_euler = (0.22, 0.06, 0)
            self.wings[1].rotation_euler = (-0.5, 0.1, -0.35)
            if self.prop:
                self.prop.rotation_euler = (0.9, 0, 0)


class StrikeJet(Plane):
    """Aegis Supersonic Tactical Strike Fighter: smoothly lofted fuselage & pointed radome nose,
    sculpted tinted bubble canopy, blended LERX chines, swept wings with wingtip rails, angled twin
    intakes, canted twin tail fins with bright cobalt-blue caps, twin exhaust nozzles & LGBs."""

    cell, centre = 10.2, 1.05
    manifest = {"altitude": 7.0}
    fixed_gear = False
    belly = 0.85

    def build(self, c):
        b, pale, glass = self.hull, "#b6bcc0", "#111c24"
        # Smoothly lofted aerodynamic fighter fuselage (radome nose -> cockpit -> twin-engine tail!)
        fuse_rings = [
            ellipse_ring(5.05,  0, 1.38, 0.05, 0.05, 14, axis="X"),
            ellipse_ring(3.95,  0, 1.42, 0.36, 0.32, 14, axis="X"),
            ellipse_ring(2.50,  0, 1.50, 0.56, 0.48, 14, axis="X"),
            ellipse_ring(0.40,  0, 1.52, 0.68, 0.54, 14, axis="X"),
            ellipse_ring(-2.40, 0, 1.52, 0.66, 0.48, 14, axis="X"),
            ellipse_ring(-4.20, 0, 1.50, 0.60, 0.36, 14, axis="X"),
        ]
        loft(b, fuse_rings, c["hull"], finish="paint", smooth=True, subsurf=1)
        # Dark radar nose tip cone
        cyl(b, 0.28, 0.95, (4.58, 0, 1.40), c["low"], axis="X", sides=14, top=0.04, finish="paint")
        # Sculpted teardrop bubble canopy + cockpit frame bow + dorsal avionics spine
        canopy_rings = [
            ellipse_ring(3.25, 0, 1.72, 0.08, 0.06, 12, axis="X"),
            ellipse_ring(2.50, 0, 2.02, 0.38, 0.34, 12, axis="X"),
            ellipse_ring(1.40, 0, 2.04, 0.40, 0.34, 12, axis="X"),
            ellipse_ring(0.25, 0, 1.88, 0.24, 0.16, 12, axis="X"),
        ]
        loft(b, canopy_rings, glass, finish="glass", smooth=True, subsurf=1)
        box(b, (0.09, 0.78, 0.44), (1.82, 0, 2.06), c["hull2"], bevel=0.015, finish="paint")
        box(b, (3.45, 0.52, 0.24), (-1.50, 0, 1.98), c["hull2"], bevel=0.04, finish="paint")
        for side in (1, -1):
            # Angled side air intake trunks with splitter plates & recessed dark intake ducts
            prism_y(b, [(1.70, 1.12), (1.42, 1.78), (-1.80, 1.82), (-1.95, 1.12)], 0.58, c["hull2"], y=0.78 * side, bevel=0.025, finish="paint")
            prism_y(b, [(1.72, 1.18), (1.48, 1.72), (1.42, 1.72), (1.66, 1.18)], 0.46, "#0d1012", y=0.78 * side, finish="metal")
            box(b, (1.50, 0.54, 0.18), (-0.20, 0.78 * side, 1.78), pale, bevel=0.02, finish="paint")
            # Swept tapered wings + LERX + wingtip missile launch rails
            self.wing(side, [(1.55, 0.40), (-1.45, 4.75), (-2.48, 4.75), (-2.30, 0.40)], 1.34, 1.48, c["hull"])
            prism_z(self.wings[side], [(-0.95, 3.15 * side), (-1.58, 4.30 * side), (-2.45, 4.30 * side), (-2.38, 3.15 * side)], 0.14, 0.165, pale, finish="paint")
            box(self.wings[side], (1.35, 0.08, 0.08), (-1.90, 4.38 * side, 0.07), c["low"], bevel=0.01, finish="metal")  # wingtip rail
            # Swept all-moving tailplanes
            prism_z(b, [(-2.95, 0.50 * side), (-4.28, 2.35 * side), (-4.92, 2.35 * side), (-4.50, 0.50 * side)], 1.48, 1.58, c["hull2"], bevel=0.015, finish="paint")
            # Twin canted vertical tail fins with bold cobalt-blue fin-cap bands!
            fin = joint(b, (0, 0.52 * side, 1.86))
            fin.rotation_euler = (-0.32 * side, 0, 0)
            prism_y(fin, [(-2.65, 0), (-3.80, 1.54), (-4.52, 1.54), (-4.26, 0)], 0.11, c["hull"], bevel=0.015, finish="paint")
            prism_y(fin, [(-3.55, 1.15), (-3.80, 1.54), (-4.52, 1.54), (-4.44, 1.15)], 0.13, c.get("ribbon", pale), bevel=0.01, finish="ribbon").active_material = mat(c.get("ribbon", pale), 0.10, "ribbon")
            # Segmented dark metallic afterburner exhaust nozzles
            cyl(b, 0.34, 0.62, (-4.38, 0.34 * side, 1.50), "#25292e", axis="X", sides=14, top=0.26, bevel=0.015, finish="metal")
            cyl(b, 0.24, 0.10, (-4.68, 0.34 * side, 1.50), "#0c0e10", axis="X", sides=12, finish="metal")
            # Underwing weapon pylon + precision-guided bomb
            box(self.wings[side], (0.76, 0.09, 0.22), (-0.60, 1.90 * side, -0.10), c["low"], bevel=0.012, finish="metal")
            self.bomb(self.wings[side], (-0.50, 1.90 * side, -0.36), 1.55, 0.17, c["low"], c["deck"])
            # Retractable landing gear (shown when parked idle)
            cyl(self.gear, 0.045, 0.72, (-0.90, 0.95 * side, 0.60), "#8e949a", sides=8, finish="metal")
            cyl(self.gear, 0.26, 0.17, (-0.90, 0.95 * side, 0.26), "#17191b", axis="Y", sides=14, bevel=0.03, finish="rubber")
        cyl(self.gear, 0.042, 0.76, (2.70, 0, 0.58), "#8e949a", sides=8, finish="metal")
        cyl(self.gear, 0.21, 0.15, (2.70, 0, 0.21), "#17191b", axis="Y", sides=14, bevel=0.025, finish="rubber")


class PropBomber(Plane):
    """Ashfall Desert CAS Warbird: smoothly lofted oval fuselage, sculpted radial engine cowl with
    cylinder bank & exhaust stacks, multi-frame greenhouse canopy, mismatched weathered repair panels,
    curved 3-blade propeller, faired fixed gear, and underwing iron bombs."""

    cell, centre = 10.7, 1.2
    manifest = {"altitude": 6.0, "fps": {"move": 14, "bankLeft": 14, "bankRight": 14}}
    fixed_gear = True
    belly = 0.75
    axis = 1.6
    spins = 2

    def build(self, c):
        b, glass = self.hull, "#152028"
        # Smoothly lofted classic radial-engine warbird fuselage (nose cowl -> cockpit -> tapered tail!)
        fuse_rings = [
            ellipse_ring(3.62,  0, 1.60, 0.52, 0.52, 16, axis="X"),
            ellipse_ring(2.75,  0, 1.60, 0.66, 0.66, 16, axis="X"),
            ellipse_ring(1.10,  0, 1.64, 0.58, 0.64, 16, axis="X"),
            ellipse_ring(-0.80, 0, 1.60, 0.48, 0.54, 16, axis="X"),
            ellipse_ring(-3.00, 0, 1.62, 0.30, 0.36, 16, axis="X"),
            ellipse_ring(-4.65, 0, 1.66, 0.14, 0.20, 16, axis="X"),
        ]
        loft(b, fuse_rings, c["hull"], finish="rust", smooth=True, subsurf=1)
        # Weathered rusted radial engine cowling + recessed dark cooling front & radial cylinder ring
        cyl(b, 0.67, 0.92, (3.22, 0, 1.60), c["rust"], axis="X", sides=16, bevel=0.04, finish="rust")
        cyl(b, 0.52, 0.08, (3.68, 0, 1.60), "#101214", axis="X", sides=14, finish="metal")
        for k in range(7):
            a = 2 * math.pi * k / 7
            cyl(b, 0.09, 0.22, (3.58, 0.32 * math.cos(a), 1.60 + 0.32 * math.sin(a)), "#2f3338", sides=8, finish="metal", rot_extra=(a, 0, 0))
        for side in (1, -1):
            cyl(b, 0.055, 0.74, (2.48, 0.58 * side, 1.24), "#202224", axis="X", sides=8, finish="metal")
        # Multi-frame greenhouse canopy
        prism_y(b, [(1.28, 2.22), (0.76, 2.76), (-0.64, 2.76), (-1.32, 2.10)], 0.72, glass, bevel=0.02, finish="glass")
        for x in (0.68, 0.08, -0.52):
            box(b, (0.075, 0.76, 0.52), (x, 0, 2.48), c["hull2"], bevel=0.01, finish="paint")
        # Patched ochre tail band + salvaged olive fuselage panel + swept rust vertical fin
        cyl(b, 0.39, 0.50, (-2.30, 0, 1.62), c["head"], axis="X", sides=16, finish="paint")
        box(b, (1.10, 1.18, 0.42), (1.85, 0, 1.88), c["armour"], bevel=0.02, finish="rust")
        prism_y(b, [(-3.35, 1.82), (-4.18, 3.08), (-4.78, 3.08), (-4.70, 1.58)], 0.11, c["rust"], bevel=0.015, finish="rust")
        # Conical spinner + 3 tapered aerofoil propeller blades
        self.prop = joint(b, (3.78, 0, 1.60))
        cyl(self.prop, 0.22, 0.52, (0.20, 0, 0), c["low"], axis="X", sides=14, top=0.03, finish="metal")
        for k in range(3):
            blade = joint(self.prop)
            blade.rotation_euler = (k * 2 * math.pi / 3, 0, 0)
            taper_box(blade, (0.05, 0.14), (0.035, 0.22), 1.38, (0, 0, 0.72), c["wood"], rot=(0, 0, 0.22), bevel=0.01, finish="wood")
        # Cambered low wings with salvaged color panels, tailplanes, iron bombs & faired fixed gear
        for side in (1, -1):
            self.wing(side, [(1.38, 0.40), (0.90, 5.35), (-0.48, 5.35), (-0.98, 0.40)], 1.08, 1.26, c["hull2"])
            patch = c["rust"] if side == 1 else c["armour"]
            prism_z(self.wings[side], [(1.02, 2.25 * side), (0.85, 3.55 * side), (-0.60, 3.55 * side), (-0.72, 2.25 * side)], 0.17, 0.195, patch, finish="rust")
            prism_z(self.wings[side], [(0.90, 4.70 * side), (0.90, 5.35 * side), (-0.48, 5.35 * side), (-0.52, 4.70 * side)], 0.17, 0.195, c["head"], finish="paint")
            prism_z(b, [(-3.45, 0.30 * side), (-3.78, 2.04 * side), (-4.64, 2.04 * side), (-4.60, 0.30 * side)], 1.70, 1.79, c["hull2"], bevel=0.015, finish="rust")
            box(self.wings[side], (0.52, 0.09, 0.18), (0.20, 2.20 * side, -0.09), c["low"], bevel=0.01, finish="metal")
            self.bomb(self.wings[side], (0.20, 2.20 * side, -0.35), 1.25, 0.20, c["armour"], c["rust"])
            box(self.gear, (0.34, 0.14, 0.82), (1.30, 1.32 * side, 0.70), c["hull"], bevel=0.03, finish="rust")
            cyl(self.gear, 0.33, 0.19, (1.30, 1.32 * side, 0.33), "#181a1c", axis="Y", sides=14, bevel=0.035, finish="rubber")
        cyl(self.gear, 0.15, 0.11, (-4.20, 0, 1.20), "#181a1c", axis="Y", sides=10, finish="rubber")
        cyl(self.gear, 0.035, 0.34, (-4.20, 0, 1.38), c["low"], sides=6, finish="metal")


class Drone:
    """Ashfall Tactical FPV Quadcopter: chamfered carbon-fiber X-frame, strapped top LiPo battery,
    angled FPV camera cage, cloverleaf VTX antenna, underslung finned munition warhead, 4 brushless
    bell motors & 3-blade propellers."""

    cell, centre = 3.6, 0.8
    facings = FACINGS
    sheets = {"": [("idle", [0, 1]), ("walk", [0, 1, 2, 3]), ("fire", [0, 1]), ("die", [0.2, 0.45, 0.7, 0.9, 1])]}
    manifest = {"per": "member", "altitude": 1.5, "fps": {"walk": 14, "idle": 10, "die": 9}}
    height = 1.5

    def __init__(self, look):
        c = look
        self.root = joint(None, name="root")
        self.body = joint(self.root, (0, 0, 0.2))
        # Dual carbon-fiber plates + aluminum standoffs
        box(self.body, (0.48, 0.22, 0.035), (0, 0, -0.025), c["gun"], bevel=0.008, finish="metal")
        box(self.body, (0.44, 0.20, 0.030), (0, 0, 0.045), c["gun"], bevel=0.008, finish="metal")
        # Top-strapped LiPo battery pack + yellow/tan velcro strap + angled FPV camera + VTX mushroom antenna
        box(self.body, (0.26, 0.17, 0.11), (-0.04, 0, 0.105), c["rust"], bevel=0.015, finish="rubber")
        box(self.body, (0.28, 0.055, 0.125), (-0.04, 0, 0.105), c["trim"], bevel=0.006, finish="cloth")
        box(self.body, (0.09, 0.11, 0.09), (0.25, 0, 0.035), "#15191d", bevel=0.01, finish="metal")
        cyl(self.body, 0.038, 0.04, (0.295, 0, 0.04), "#0b141a", axis="X", sides=10, finish="glass")
        cyl(self.body, 0.015, 0.28, (-0.22, 0.05, 0.19), c["gun"], sides=6, finish="metal")
        ball(self.body, 0.042, (-0.22, 0.05, 0.33), c["trim"], finish="paint")  # VTX mushroom cap
        # Underslung finned PG-7 style munition charge with fuse wire
        cyl(self.body, 0.078, 0.44, (0.06, 0, -0.13), c["armour"], axis="X", sides=12, bevel=0.01, finish="metal")
        cyl(self.body, 0.094, 0.20, (0.37, 0, -0.13), c["rust"], axis="X", sides=12, top=0.018, finish="rust")
        box(self.body, (0.14, 0.18, 0.02), (-0.18, 0, -0.13), c["gun"], finish="metal")
        self.props = []
        for sx in (1, -1):
            for sy in (1, -1):
                box(self.body, (0.54, 0.055, 0.032), (0.20 * sx, 0.20 * sy, 0.015), c["low"], rot=(0, 0, sx * sy * 0.78), bevel=0.006, finish="metal")
                cyl(self.body, 0.046, 0.075, (0.37 * sx, 0.37 * sy, 0.055), "#3b3f44", sides=10, bevel=0.008, finish="metal")
                prop = joint(self.body, (0.37 * sx, 0.37 * sy, 0.105))
                for k in range(3):
                    box(prop, (0.24, 0.042, 0.012), (0.11 * math.cos(k * 2.094), 0.11 * math.sin(k * 2.094), 0), c["trim"], rot=(0, 0, k * 2.094), finish="paint")
                self.props.append(prop)
        self.muzzle = flash(self.body, (0.49, 0, -0.13), 0.8)

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
    """Heavy gold collector truck: Aegis 6x6 armored mining hauler (forward-control cab, cab-guard
    canopy, ribbed steel hopper with cobalt-blue upper rail & hydraulic scoop) vs Ashfall battered
    tipper lorry (sculpted bonnet, slatted grille, timber-plank ribbed hopper with iron straps)."""

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
        # Heavy treaded mining/off-road wheels with recessed steel hubs, axles & fender mudguards
        for x in ((1.70, -0.40, -1.60) if not improvised else (1.60, -1.35)):
            cyl(b, 0.095, 1.86, (x, 0, 0.46), c["low"], axis="Y", sides=8, finish="metal")
            for side in (1, -1):
                w = joint(b, (x, 0.96 * side, 0.46))
                cyl(w, 0.46, 0.38, (0, 0, 0), tyre, axis="Y", sides=16, bevel=0.06, finish="rubber")
                for ti in range(10):
                    a = 2 * math.pi * ti / 10
                    box(w, (0.11, 0.34, 0.045), (math.sin(a) * 0.45, 0, math.cos(a) * 0.45), tyre, rot=(0, a, 0), bevel=0.008, finish="rubber")
                cyl(w, 0.25, 0.41, (0, 0, 0), c["hull2"], axis="Y", sides=10, bevel=0.02, finish="paint")
                cyl(w, 0.12, 0.44, (0, 0, 0), "#22262a", axis="Y", sides=8, finish="metal")
                box(b, (1.06, 0.26, 0.12), (x, 0.96 * side, 0.98), c["low"], bevel=0.02, finish="rubber")
        box(b, (4.95, 1.50, 0.28), (0, 0, 0.78), c["low"], bevel=0.025, finish="metal")
        if improvised:
            # Battered desert commercial tipper lorry: 3-station contoured bonnet, recessed grille, patched cab, bedroll
            hood_rings = [
                [(1.50, -0.78, 0.90), (1.50, 0.78, 0.90), (1.50, 0.72, 1.44), (1.50, -0.72, 1.44)],
                [(2.02, -0.76, 0.91), (2.02, 0.76, 0.91), (2.02, 0.68, 1.42), (2.02, -0.68, 1.42)],
                [(2.50, -0.72, 0.92), (2.50, 0.72, 0.92), (2.50, 0.62, 1.34), (2.50, -0.62, 1.34)],
            ]
            loft(b, hood_rings, c["hull"], finish="rust", bevel=0.04, smooth=False)
            box(b, (0.86, 0.88, 0.06), (2.00, 0, 1.43), c["hull2"], bevel=0.02, finish="rust")  # bonnet center ridge
            grate(b, (0.10, 1.14, 0.34), (2.53, 0, 1.13), slats=4, slat_col=c["low"], axis="Y")
            box(b, (0.18, 1.82, 0.22), (2.58, 0, 0.80), c["rust"], bevel=0.025, finish="rust")
            for side in (1, -1):
                cyl(b, 0.09, 0.08, (2.54, 0.66 * side, 1.04), "#ffe4a0", axis="X", sides=10, glow=0.8)
            prism_y(b, [(0.52, 0.90), (1.52, 0.90), (1.52, 1.45), (1.30, 2.06), (0.52, 2.06)], 1.68, c["hull"], bevel=0.045, finish="rust")
            prism_y(b, [(1.54, 1.50), (1.34, 2.01), (1.27, 2.01), (1.47, 1.50)], 1.42, "#152028", finish="glass")
            box(b, (0.52, 1.72, 0.30), (0.95, 0, 1.76), "#152028", finish="glass")
            box(b, (0.64, 1.74, 0.38), (1.00, 0, 1.22), c["rust"], bevel=0.022, finish="rust")
            roll = cyl(b, 0.14, 1.05, (0.95, 0.05, 2.18), c["armour"], axis="Y", sides=12, bevel=0.025, finish="cloth")
            cloth_fold(roll, strength=0.015, scale=0.14)
        else:
            # Aegis heavy 6x6 armored ore hauler: sloped forward-control cab, recessed grille, amber lightbar & exhaust stack
            prism_y(b, [(1.18, 0.90), (2.56, 0.90), (2.60, 1.50), (2.22, 2.12), (1.18, 2.12)], 1.74, c["hull"], bevel=0.04, finish="paint")
            prism_y(b, [(2.59, 1.52), (2.25, 2.07), (2.17, 2.07), (2.51, 1.52)], 1.46, "#111b22", finish="glass")
            box(b, (0.05, 0.07, 0.56), (2.38, 0.0, 1.79), c["hull2"], rot=(0, -0.58, 0), finish="paint")
            box(b, (0.62, 1.78, 0.30), (1.65, 0, 1.78), "#111b22", finish="glass")
            grate(b, (0.10, 1.24, 0.34), (2.58, 0, 1.18), slats=4, slat_col=c["low"], axis="Y")
            box(b, (0.18, 1.84, 0.24), (2.62, 0, 0.84), c["low"], bevel=0.025, finish="metal")
            for side in (1, -1):
                box(b, (0.06, 0.24, 0.12), (2.60, 0.66 * side, 1.16), "#fff0cc", glow=1.6)
                box(b, (0.12, 0.16, 0.24), (2.22, 0.98 * side, 1.66), c["low"], bevel=0.015, finish="metal")
            box(b, (0.48, 1.18, 0.10), (1.72, 0, 2.18), "#e0a82e", glow=0.8, bevel=0.02)  # amber hazard light bar
            cyl(b, 0.075, 1.25, (1.08, -0.86, 1.60), c["gun"], sides=10, finish="metal")  # vertical exhaust stack
            cyl(b, 0.018, 1.05, (1.22, 0.78, 2.60), c["gun"], sides=6, finish="metal")
            pennant(b, (1.22, 0.78, 3.00), c, length=0.40, height=0.16)
        # Ribbed reinforced tipping hopper (external vertical structural ribs so it reads as a real dump bed!)
        back = -2.25 if not improvised else -2.20
        self.hopper = joint(b, (back, 0, 0.95))
        h = self.hopper
        length = 3.20 if not improvised else 2.65
        wall = c["hull2"] if not improvised else c["wood"]
        wall_fin = "paint" if not improvised else "wood"
        box(h, (length, 1.72, 0.12), (length / 2, 0, 0.05), c["low"], bevel=0.015, finish="metal")
        for side in (1, -1):
            box(h, (length, 0.11, 0.84), (length / 2, 0.83 * side, 0.46), wall, bevel=0.018, finish=wall_fin)
            # External vertical structural reinforcement ribs along hopper flanks!
            for ri in range(4):
                rx = 0.35 + (length - 0.70) * ri / 3.0
                box(h, (0.11, 0.16, 0.82), (rx, 0.87 * side, 0.46), c["rust"] if improvised else c["hull"], bevel=0.012, finish="rust" if improvised else "paint")
            if improvised:
                box(h, (length, 0.14, 0.10), (length / 2, 0.85 * side, 0.64), c["rust"], bevel=0.012, finish="rust")
            else:
                ribbon(h, (length, 0.15, 0.14), (length / 2, 0.86 * side, 0.84), c, cloth=True)  # bold cobalt-blue upper hopper stripe
        box(h, (0.12, 1.72, 0.98), (length, 0, 0.53), wall, bevel=0.018, finish=wall_fin)
        if not improvised:
            # Protective mining cab-guard canopy overhang extending forward from hopper headboard
            box(h, (0.72, 1.70, 0.08), (length + 0.32, 0, 1.24), c["hull2"], rot=(0, -0.18, 0), bevel=0.015, finish="paint")
        box(h, (0.11, 1.72, 0.64), (0.02, 0, 0.36), wall if improvised else c["hull"], bevel=0.018, finish=wall_fin)
        self.load = gold_heap(h, (length / 2, 0, 0.12), 1.7, lumps=26)
        self.load.scale = (length / 2.1, 1.0, 1.0)
        # Articulated heavy hydraulic front loader boom & toothed ore scoop bucket
        self.arm = joint(b, (2.20 if not improvised else 2.30, -0.98, 1.30))
        box(self.arm, (1.52, 0.16, 0.16), (0.72, 0, 0), c["hull2"] if not improvised else c["rust"], bevel=0.02, finish="metal")
        cyl(self.arm, 0.045, 0.95, (0.52, -0.02, 0.16), "#8c9298", axis="X", sides=8, finish="metal")  # hydraulic actuator
        self.scoop = joint(self.arm, (1.45, 0, 0))
        box(self.scoop, (0.54, 0.74, 0.09), (0.16, 0.30, -0.25), c["low"], bevel=0.015, finish="metal")
        box(self.scoop, (0.09, 0.74, 0.42), (-0.08, 0.30, -0.08), c["low"], bevel=0.015, finish="metal")
        for ty in (-0.24, 0.0, 0.24, 0.48):
            box(self.scoop, (0.16, 0.055, 0.055), (0.46, ty + 0.18, -0.26), "#8c9298", bevel=0.008, finish="metal")  # bucket teeth
        box(self.scoop, (0.11, 0.11, 0.42), (0, 0, -0.12), c["hull2"] if not improvised else c["rust"], bevel=0.012, finish="metal")
        self.scoopload = gold_heap(self.scoop, (0.15, 0.3, -0.2), 0.45, lumps=5, seed=5)

    def pose(self, anim, t):
        show(self.root, True)
        char(self.root, anim == "wreck")
        self.body.location = (0, 0, 0)
        self.body.rotation_euler = (0, 0, 0)
        self.hopper.rotation_euler = (0, 0, 0)
        self.arm.rotation_euler = (0, -0.75, 0)
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
            down = math.sin(math.pi * min(1, t * 1.25))
            self.arm.rotation_euler = (0, -0.75 + 1.4 * down, 0)
            self.scoop.rotation_euler = (0, 0.75 - 1.4 * down, 0)
            show(self.scoopload, t > 0.4)
        if anim == "unload":
            self.hopper.rotation_euler = (0, -0.8 * math.sin(math.pi * min(1, t) / 2) * (1 if t < 1 else 0.5), 0)
        if anim == "wreck":
            self.body.rotation_euler = (0.07, -0.04, 0)
            self.hopper.rotation_euler = (0.1, -0.2, 0.06)
            self.arm.rotation_euler = (0.3, 0.5, 0.4)


class Engineer(Soldier):
    """Combat engineer / desert sapper: high-vis matte yellow hard hat (with cobalt-blue ribbon) or
    terracotta headwrap, rugged strapped field-engineering tool pack with prybar & cable spool,
    and heavy wrench/hammer work animation."""

    sheets = {"": Soldier.sheets[""] + [("work", [0, 1])]}
    manifest = {"per": "member", "fps": {"walk": 16, "die": 9, "work": 5}}

    def __init__(self, look, militia):
        super().__init__({**look, "head": "#cfa028" if not militia else "#c45c24"}, militia)
        c = look
        # Rugged strapped engineer pack with top flap, prybar & coiled det-cord spool
        tp = box(self.torso, (0.24, 0.40, 0.36), (-0.28, 0, 0.30), "#c99628" if not militia else c["rust"], bevel=0.04, finish="cloth", subsurf=1, smooth=True)
        cloth_fold(tp, strength=0.012, scale=0.14)
        box(self.torso, (0.055, 0.055, 0.52), (-0.34, -0.16, 0.50), c["gun"], bevel=0.01, finish="metal")
        cyl(self.torso, 0.135, 0.095, (-0.39, 0.10, 0.52), "#cfc8b4", axis="X", sides=14, bevel=0.015, finish="cloth")
        self.tool = joint(self.torso, (0.50, -0.10, 0.30))
        cyl(self.tool, 0.026, 0.46, (0, 0, 0.10), c.get("wood", "#633f22"), sides=10, finish="wood")
        box(self.tool, (0.22, 0.095, 0.10), (0, 0, 0.34), "#50565c", bevel=0.015, finish="metal")
        self.spark = joint(self.torso, (0.75, -0.10, -0.05))
        ball(self.spark, 0.09, (0, 0, 0), "#fff3c4", fx=True).active_material = mat("#fff3c4", 14)
        ball(self.spark, 0.05, (0.12, 0.08, 0.08), "#ffd27a", fx=True).active_material = mat("#ffd27a", 10)
        ball(self.spark, 0.04, (-0.05, -0.10, 0.12), "#ffd27a", fx=True).active_material = mat("#ffd27a", 10)

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
    """The Aegis hero: an elite recon marksman in a sculpted peaked hood and draped cloth-folded
    recon mantle cloak, bright cobalt-blue cloth scarf at the throat, precision anti-materiel sniper
    rifle with fluted barrel & muzzle brake, and demolition satchel."""

    cell, centre, scale = 5.6, 0.9, 1.16
    sheets = {"": Soldier.sheets[""] + [("prone", [0]), ("proneFire", [0, 1]), ("plant", [0, 1, 2])]}
    manifest = {"per": "member", "hero": True, "fps": {"walk": 16, "die": 9, "plant": 4}}

    def __init__(self):
        c = {**AEGIS, "cloth": "#3c4230", "armour": "#585e44", "head": "#2d3225", "dark": "#21251c", "pants": "#343929"}
        super().__init__(c, militia=False)
        pale = "#8b866d"
        # Replace helmet silhouette with a sculpted draped recon hood (NOT a bowling ball!)
        strip(self.head)
        cyl(self.head, 0.074, 0.12, (0, 0, 0.04), c["dark"], sides=12, finish="cloth")
        # Shadowed face & sleek tactical ballistic eyewear inside hood opening
        box(self.head, (0.14, 0.14, 0.18), (0.04, 0, 0.17), "#1e1a16", bevel=0.04, finish="cloth", subsurf=1, smooth=True)
        box(self.head, (0.05, 0.14, 0.048), (0.125, 0, 0.20), "#101b24", bevel=0.012, finish="glass")
        # Hollow sculpted peaked recon hood (open front cowl with cloth thickness framing shadowed face!)
        hood_rings = [
            ellipse_ring(0.11,  0, 0.20, 0.148, 0.152, 16, axis="X", tilt_y=0.18),
            ellipse_ring(0.02,  0, 0.21, 0.168, 0.165, 16, axis="X"),
            ellipse_ring(-0.09, 0, 0.20, 0.155, 0.150, 16, axis="X"),
            ellipse_ring(-0.22, 0, 0.16, 0.095, 0.090, 16, axis="X"),
            ellipse_ring(-0.31, 0, 0.12, 0.032, 0.030, 16, axis="X"),
        ]
        s_hood = loft(self.head, hood_rings, c["head"], finish="cloth", cap_start=False, subsurf=1)
        sol = s_hood.modifiers.new("thick", "SOLIDIFY")
        sol.thickness = 0.024
        sol.offset = 1.0
        cloth_fold(s_hood, strength=0.015, scale=0.14)
        # Draped shoulder mantle & multi-fold flowing recon cloak behind the back
        mantle_rings = [
            ellipse_ring(0.0,  0, 0.56, 0.16, 0.24, 16),
            ellipse_ring(-0.02, 0, 0.46, 0.23, 0.34, 16),
            ellipse_ring(-0.04, 0, 0.36, 0.24, 0.36, 16),
        ]
        cloth_fold(loft(self.torso, mantle_rings, c["dark"], finish="cloth", subsurf=1), strength=0.018, scale=0.14)
        self.cloak = joint(self.torso, (-0.18, 0, 0.48))
        # Wide flowing sculpted cloak panel with natural drapery waves
        cloak_rings = []
        for k, (z, x, w) in enumerate([(0.0, -0.02, 0.30), (-0.34, -0.10, 0.34), (-0.70, -0.19, 0.38), (-1.02, -0.27, 0.41)]):
            ring = []
            for j in range(7):
                f = j / 6.0 * 2.0 - 1.0
                wave = 0.035 * math.sin(f * math.pi * 2.5) * (k / 3.0)
                ring.append((x + wave, f * w, z))
            for j in reversed(range(7)):
                f = j / 6.0 * 2.0 - 1.0
                wave = 0.035 * math.sin(f * math.pi * 2.5) * (k / 3.0)
                ring.append((x + wave - 0.035, f * w, z))
            cloak_rings.append(ring)
        cloth_fold(loft(self.cloak, cloak_rings, c["dark"], finish="cloth", subsurf=1), strength=0.020, scale=0.16)
        box(self.cloak, (0.04, 0.78, 0.06), (-0.28, 0, -1.03), pale, bevel=0.01, finish="cloth")  # dusty lower cloak hem
        # Bold draped cobalt-blue cloth recognition scarf wrapped at the throat + trailing end over chest
        scarf_rings = [
            ellipse_ring(0.02, 0, 0.56, 0.165, 0.23, 14),
            ellipse_ring(0.03, 0, 0.48, 0.185, 0.25, 14),
        ]
        cloth_fold(loft(self.torso, scarf_rings, c["ribbon"], finish="ribbon", glow=0.10, subsurf=1), strength=0.010, scale=0.12)
        ribbon(self.torso, (0.04, 0.13, 0.26), (0.19, -0.06, 0.38), c, rot=(0, -0.12, 0.15), cloth=True)
        # Demolition satchel on the hip
        box(self.pelvis, (0.26, 0.14, 0.30), (-0.02, -0.30, -0.06), "#c9962b", bevel=0.025, finish="cloth")
        box(self.pelvis, (0.27, 0.15, 0.055), (-0.02, -0.30, -0.01), "#1b1f22", bevel=0.008, finish="rubber")
        # Precision anti-materiel sniper rifle: chassis stock, cheek rest, fluted barrel, baffle muzzle brake, optic, bipod
        strip(self.rifle)
        r = self.rifle
        box(r, (0.48, 0.075, 0.145), (-0.28, 0, -0.02), c["dark"], bevel=0.014, finish="paint")
        box(r, (0.22, 0.068, 0.055), (-0.24, 0, 0.065), c["gun"], bevel=0.01, finish="rubber")  # cheek riser
        box(r, (0.56, 0.088, 0.125), (0.18, 0, 0), c["gun"], bevel=0.014, finish="metal")
        box(r, (0.36, 0.072, 0.085), (0.60, 0, 0.01), c["armour"], bevel=0.012, finish="paint")  # handguard shroud
        cyl(r, 0.032, 1.28, (1.02, 0, 0.02), c["gun"], axis="X", sides=12, finish="metal")
        box(r, (0.22, 0.11, 0.08), (1.70, 0, 0.02), "#30363c", bevel=0.012, finish="metal")  # multi-baffle muzzle brake
        cyl(r, 0.058, 0.52, (0.20, 0, 0.15), "#2d3338", axis="X", sides=12, bevel=0.008, finish="metal")  # long-range scope
        cyl(r, 0.060, 0.03, (0.47, 0, 0.15), c["trim"], axis="X", sides=12, glow=1.2)
        box(r, (0.09, 0.065, 0.20), (0.14, 0, -0.13), c["gun"], bevel=0.01, finish="metal")  # box magazine
        box(r, (0.06, 0.048, 0.13), (-0.04, 0, -0.10), c["gun"], rot=(0, 0.25, 0), bevel=0.008, finish="rubber")
        for side in (1, -1):
            cyl(r, 0.018, 0.34, (0.82, 0.055 * side, -0.065), c["gun"], axis="X", sides=8, finish="metal")  # folded bipod
        self.muzzle = flash(r, (1.92, 0, 0.02), 0.9)
        # Demolition charge for planting pose
        self.charge = joint(self.size, (0.75, 0, 0.09))
        box(self.charge, (0.34, 0.26, 0.16), (0, 0, 0), "#c9962b", bevel=0.02, finish="paint")
        box(self.charge, (0.36, 0.06, 0.17), (0, 0, 0), "#1b1f22", bevel=0.008, finish="rubber")
        self.lamp = ball(self.charge, 0.055, (0.08, 0.08, 0.1), "#ff5a3c", fx=True)
        self.lamp.active_material = mat("#ff5a3c", 12)

    def pose(self, anim, t):
        prone = anim in ("prone", "proneFire")
        super().pose("cover" if anim == "plant" else "idle" if prone else anim, t)
        show(self.charge, anim == "plant")
        show(self.lamp, anim == "plant" and t == 2)
        self.cloak.rotation_euler = (0, 0.45 if anim == "walk" else 0.12, 0)
        if prone:
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
    """The Ashfall hero: a hooded desert figure in a draped multi-fold travelling robe, deep
    overhanging cloth cowl, burnt-orange woven shawl & sash, subtle glowing talisman, and compact
    carbine; in disguise wears a weathered traveller cloak, pack, and wooden staff."""

    cell, centre, scale = 4.4, 0.95, 1.16
    sheets = {"": Soldier.sheets[""] + [("disguise", [0]), ("disguiseWalk", [i / 12 for i in range(12)]), ("seize", [0, 1, 2])]}
    manifest = {"per": "member", "hero": True, "fps": {"walk": 16, "disguiseWalk": 13, "die": 9, "seize": 5}}

    def __init__(self):
        c = {**ASHFALL, "cloth": "#bca67e", "armour": "#8c7653", "dark": "#4e3a24", "head": "#bca67e", "pants": "#5c4a35"}
        super().__init__(c, militia=True, bare_torso=True)
        ochre, drab = "#b55218", "#766e5e"
        # Draped flowing ankle-length robe with organic pleated folds
        robe_rings = []
        for z, r_base, fold_amp in [(-0.78, 0.38, 0.036), (-0.42, 0.32, 0.028), (-0.10, 0.25, 0.018), (0.08, 0.20, 0.008)]:
            ring = []
            for i in range(16):
                a = 2 * math.pi * i / 16
                r = r_base + fold_amp * math.sin(a * 5.0)
                ring.append((r * 0.88 * math.cos(a), r * math.sin(a), z))
            robe_rings.append(ring)
        cloth_fold(loft(self.pelvis, robe_rings, c["cloth"], finish="cloth", subsurf=1), strength=0.018, scale=0.16)
        # Hollow overhanging sculpted desert cowl hood (open front revealing deep shadowed face!)
        strip(self.head)
        cyl(self.head, 0.075, 0.12, (0, 0, 0.04), c["dark"], sides=12, finish="cloth")
        box(self.head, (0.14, 0.15, 0.17), (0.01, 0, 0.17), "#16100b", bevel=0.04, finish="cloth", subsurf=1, smooth=True)
        cowl_rings = [
            ellipse_ring(0.14,  0, 0.20, 0.158, 0.158, 16, axis="X", tilt_y=0.22),
            ellipse_ring(0.04,  0, 0.21, 0.180, 0.174, 16, axis="X"),
            ellipse_ring(-0.08, 0, 0.20, 0.168, 0.160, 16, axis="X"),
            ellipse_ring(-0.22, 0, 0.16, 0.105, 0.100, 16, axis="X"),
            ellipse_ring(-0.32, 0, 0.11, 0.036, 0.034, 16, axis="X"),
        ]
        o_hood = loft(self.head, cowl_rings, c["cloth"], finish="cloth", cap_start=False, subsurf=1)
        sol = o_hood.modifiers.new("thick", "SOLIDIFY")
        sol.thickness = 0.026
        sol.offset = 1.0
        cloth_fold(o_hood, strength=0.016, scale=0.14)
        # Burnt-orange woven desert shawl, draped scarf tail, waist sash, and warm amber talisman
        self.marks = joint(self.torso)
        shawl_rings = [
            ellipse_ring(0.0, 0, 0.56, 0.165, 0.24, 14),
            ellipse_ring(0.0, 0, 0.44, 0.215, 0.30, 14),
        ]
        cloth_fold(loft(self.marks, shawl_rings, ochre, finish="cloth", subsurf=1), strength=0.015, scale=0.14)
        scarf = box(self.marks, (0.065, 0.22, 0.92), (-0.25, 0.04, 0.08), ochre, rot=(0, -0.14, 0), bevel=0.02, finish="cloth", subsurf=1, smooth=True)
        cloth_fold(scarf, strength=0.016, scale=0.15)
        cyl(self.marks, 0.22, 0.10, (0, 0, 0.04), ochre, sides=16, bevel=0.02, finish="cloth")  # waist sash
        amulet = ball(self.marks, 0.055, (0.20, 0, 0.36), "#ffd27a", fx=True)
        amulet.active_material = mat("#ffd27a", 5)
        # Disguise mode: drab traveller cloak, strapped bundle, bedroll, and wooden walking staff
        self.cover = joint(self.torso)
        cloak = taper_box(self.cover, (0.36, 0.52), (0.32, 0.58), 0.58, (-0.02, 0, 0.28), drab, bevel=0.05, finish="cloth", subsurf=1, smooth=True)
        cloth_fold(cloak, strength=0.018, scale=0.15)
        box(self.cover, (0.28, 0.42, 0.36), (-0.31, 0, 0.34), "#5f5648", bevel=0.04, finish="cloth", subsurf=1, smooth=True)
        cyl(self.cover, 0.085, 0.48, (-0.29, 0, 0.59), "#968c76", axis="Y", sides=12, bevel=0.02, finish="cloth")
        self.skirt = cloth_fold(loft(self.pelvis, [[(x * 1.05, y * 1.05, z) for x, y, z in r] for r in robe_rings], drab, finish="cloth", subsurf=1), strength=0.018, scale=0.16)
        self.staff = joint(self.torso, (0.34, -0.36, 0.0))
        cyl(self.staff, 0.032, 1.72, (0, 0, 0.10), "#543a20", sides=8, finish="wood")
        # Compact folding-stock carbine
        strip(self.rifle)
        r = self.rifle
        box(r, (0.42, 0.072, 0.12), (0.0, 0, 0), c["gun"], bevel=0.012, finish="metal")
        box(r, (0.22, 0.055, 0.075), (-0.27, 0, -0.02), ASHFALL["wood"], bevel=0.01, finish="wood")
        cyl(r, 0.030, 0.30, (0.35, 0, 0.02), c["gun"], axis="X", sides=10, finish="metal")
        box(r, (0.068, 0.052, 0.23), (0.05, 0, -0.14), c["gun"], rot=(0, -0.32, 0), bevel=0.01, finish="metal")
        self.muzzle = flash(r, (0.58, 0, 0.02), 0.5)
        # Seizing ring of light over raised hand
        self.orb = joint(self.torso, (0.62, 0.3, 0.86))
        for i in range(8):
            spark = ball(self.orb, 0.045, (0, 0.2 * math.cos(i * math.pi / 4), 0.2 * math.sin(i * math.pi / 4)), "#ffd27a", fx=True)
            spark.active_material = mat("#ffd27a", 14)
        core = ball(self.orb, 0.07, (0, 0, 0), "#fff3c4", fx=True)
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
    "patrolBoat": lambda: PatrolBoat(AEGIS_GREY),
    "speedboat": lambda: Speedboat(ASHFALL),
    "helicopter": lambda: Helicopter(AEGIS),
    "rocketLauncher": lambda: RocketLauncher(AEGIS),
    "fpvSwarm": lambda: Drone(ASHFALL),
    "strikeJet": lambda: StrikeJet(AEGIS_GREY),
    "propBomber": lambda: PropBomber(ASHFALL),
    "rpgTeam": lambda: Soldier(ASHFALL, militia=True, rocket=True),
    "aegis_hauler": lambda: Hauler(AEGIS, improvised=False),
    "ashfall_hauler": lambda: Hauler(ASHFALL, improvised=True),
    "aegis_engineer": lambda: Engineer(AEGIS, militia=False),
    "ashfall_sapper": lambda: Engineer(ASHFALL, militia=True),
    "aegis_sentinel": Sentinel,
    "ashfall_oracle": Oracle,
}

# ---------------------------------------------------------------- render and pack


def _crisp_downsample(im, size):
    """2x Lanczos downsample + subtle unsharp mask on RGB only (keeps clean alpha) so small
    45px isometric sprites retain crisp bevels, cloth folds and mechanical contrast."""
    im = im.resize((size, size), Image.LANCZOS)
    r, g, b, a = im.split()
    rgb = Image.merge("RGB", (r, g, b)).filter(ImageFilter.UnsharpMask(radius=0.8, percent=45, threshold=2))
    r2, g2, b2 = rgb.split()
    return Image.merge("RGBA", (r2, g2, b2, a))


def render_unit(name):
    global _dust_enabled
    scene = setup_scene(freestyle=False)
    # Aircraft and naval boats don't collect desert ground dust on their undersides
    _dust_enabled = name not in ("helicopter", "strikeJet", "propBomber", "fpvSwarm", "patrolBoat", "speedboat")
    model = UNITS[name]()
    _dust_enabled = True
    size, origin = aim_camera(scene, model.cell, model.centre, ss=SS)
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
                    im = Image.open(path).convert("RGBA")
                    if SS > 1:
                        im = _crisp_downsample(im, size)
                    rows[f].append(im)
        frames[suffix] = rows
    return model, size, origin, frames


def outlined(image):
    """Kept for art/props.py compatibility: crisp edge pass."""
    alpha = image.getchannel("A")
    edge = alpha.filter(ImageFilter.MaxFilter(3))
    under = Image.new("RGBA", image.size, OUTLINE + (0,))
    under.putalpha(edge.point(lambda a: int(a * 0.85)))
    return Image.alpha_composite(under, image)


def save_small(image, path):
    """Saves a realistic PBR sheet cleanly (256-colour palette with subtle dithering to prevent gradient banding)."""
    image.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG).save(path, optimize=True)


def pack(name, suffix, rows, origin, add_outline=False):
    if add_outline:
        rows = [[outlined(im) for im in row] for row in rows]
    # Every frame is cropped to the one box that holds them all, so the origin stays put.
    box_ = None
    for row in rows:
        for im in row:
            b = im.getchannel("A").point(lambda a: 255 if a > 6 else 0).getbbox()
            if b:
                box_ = b if box_ is None else (min(box_[0], b[0]), min(box_[1], b[1]), max(box_[2], b[2]), max(box_[3], b[3]))
    left, top, right, bottom = max(0, box_[0] - 2), max(0, box_[1] - 2), box_[2] + 2, box_[3] + 2
    w, h = right - left, bottom - top
    sheet = Image.new("RGBA", (w * len(rows[0]), h * len(rows)), (0, 0, 0, 0))
    for r, row in enumerate(rows):
        for c, im in enumerate(row):
            sheet.paste(im.crop((left, top, right, bottom)), (c * w, r * h))
    rel = f"units/{name}{suffix}.png"
    (OUT / "units").mkdir(parents=True, exist_ok=True)
    save_small(sheet, OUT / rel)
    # The same sheet in full colour for art/paint.py, which paints it and writes the
    # picture the game loads over the one saved above (make art-paint).
    (PLAIN / "units").mkdir(parents=True, exist_ok=True)
    sheet.save(PLAIN / rel)
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
    global OUT, RAW, PLAIN, DEVICE_MODE, PPM, SS
    ap = argparse.ArgumentParser()
    ap.add_argument("units", nargs="*", help="units to render (default: all)")
    ap.add_argument("--sheet", help="also write a contact sheet to this path")
    ap.add_argument("--out-root", type=pathlib.Path, help="output sprite directory (default: assets/sprites)")
    ap.add_argument("--plain-root", type=pathlib.Path, help="full-colour plain sheets directory")
    ap.add_argument("--raw-root", type=pathlib.Path, help="per-frame raw Blender render directory")
    ap.add_argument("--base-manifest", type=pathlib.Path, help="existing manifest to preserve non-unit entries from")
    ap.add_argument("--device", choices=["auto", "gpu", "cpu"], help="Cycles compute device (default: auto)")
    ap.add_argument("--ppm", type=int, help="override pixels per metre")
    ap.add_argument("--ss", type=int, help="override supersampling multiplier")
    args = ap.parse_args()

    if args.out_root:
        OUT = args.out_root.resolve()
        if not args.plain_root and "CALLSIGN_PLAIN_ROOT" not in os.environ:
            PLAIN = OUT.parent / "plain"
        if not args.raw_root and "CALLSIGN_RAW_ROOT" not in os.environ:
            RAW = OUT.parent / "blender"
    if args.plain_root:
        PLAIN = args.plain_root.resolve()
    if args.raw_root:
        RAW = args.raw_root.resolve()
    if args.device:
        DEVICE_MODE = args.device
    if args.ppm:
        PPM = args.ppm
    if args.ss:
        SS = args.ss

    OUT.mkdir(parents=True, exist_ok=True)
    manifest_path = OUT / "manifest.json"
    base_path = args.base_manifest or (manifest_path if manifest_path.exists() else BASE_MANIFEST)
    manifest = json.loads(base_path.read_text()) if base_path.exists() else {}
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
    manifest["stamp"] = int(time.time())  # a new render is a new address for the page (client/art.js)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    if args.sheet:
        contact_sheet(page, args.sheet)


if __name__ == "__main__":
    main()
