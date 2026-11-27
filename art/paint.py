"""Paints the rendered unit sheets in the style of the buildings (docs/art/STYLE.md).

art/units.py renders every unit from a model built in code: the frames line up exactly,
but they are flat shapes with no drawing in them. Here FLUX.2 [klein] 4B redraws each
frame over itself: the render goes in as the picture to start from, the model keeps three
of its four steps, and what comes out has the same shape in the same place with outlines,
panel lines and painted light. The shape of every frame (its alpha) is still the render's
own, so nothing is cut out by guesswork and no frame moves.

    python art/paint.py                  every unit sheet and rendered piece in assets/raw/plain
    python art/paint.py tank wireFence   only these units and pieces
    python art/paint.py --plain tank     no painting: the render with the outline only

Reads   assets/raw/plain/**/*.png        the pictures as art/units.py and art/props.py rendered them
        art/paint.json                   what each one is, in words, for the model
Keeps   assets/raw/paint/<sheet>/*.png   every painted canvas; delete one to paint it again
Writes  assets/sprites/**/*.png          the pictures the game loads (the manifest is unchanged)

The walls, fences, bridge and sandbags of art/props.py are painted the same way ("pieces"
in art/paint.json: every picture whose name starts with the piece's name).

Frames that are one heading of one animation step always sit in the same place of the
canvas and are painted from the same noise, so a walk does not flicker from frame to frame.

Runs in the callsign-art image with the network off: make art-paint.
"""

import argparse
import hashlib
import json
import os
import pathlib
import shutil
import time

import numpy as np
from PIL import Image, ImageFilter

import generate as G

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
PLAIN = pathlib.Path(os.environ.get("CALLSIGN_PLAIN_ROOT", ROOT / "assets" / "raw" / "plain"))
KEPT = pathlib.Path(os.environ.get("CALLSIGN_KEPT_ROOT", ROOT / "assets" / "raw" / "paint"))
OUT = pathlib.Path(os.environ.get("CALLSIGN_OUT_ROOT", ROOT / "assets" / "sprites"))

CANVAS = 1024
GREY = (182, 184, 186)
OUTLINE = (22, 26, 30)
START = 1  # full photorealistic military miniature detail pass over our realistic AgX PBR renders
SPREAD = 5  # pixels over which a frame's luminance is anchored to the render
KEEP = 0.62  # keeps FLUX's natural rust/dust weathering while preventing rainbow chroma drift
MAX_ZOOM = 4.5  # enlarge compact infantry cleanly on the 1024 canvas


def flow(prompt, seed, image):
    """klein's edit graph, started from the picture itself instead of from noise."""
    f = G.workflow(prompt, seed, CANVAS, CANVAS)
    f["image"] = {"class_type": "LoadImage", "inputs": {"image": image}}
    f["reference"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["image", 0], "vae": ["vae", 0]}}
    f["positive_ref"] = {"class_type": "ReferenceLatent", "inputs": {"conditioning": ["positive", 0], "latent": ["reference", 0]}}
    f["negative_ref"] = {"class_type": "ReferenceLatent", "inputs": {"conditioning": ["negative", 0], "latent": ["reference", 0]}}
    f["guider"]["inputs"].update(positive=["positive_ref", 0], negative=["negative_ref", 0])
    f["split"] = {"class_type": "SplitSigmas", "inputs": {"sigmas": ["sigmas", 0], "step": START}}
    f["sample"]["inputs"]["sigmas"] = ["split", 1]
    f["sample"]["inputs"]["latent_image"] = ["reference", 0]
    return f


def cells_of(sheet, frame):
    fw, fh = frame
    return [[sheet.crop((c * fw, r * fh, (c + 1) * fw, (r + 1) * fh)) for c in range(sheet.width // fw)] for r in range(sheet.height // fh)]


def anim_of(anims, col):
    for name, (start, count) in anims.items():
        if start <= col < start + count:
            return name
    return "idle"


def layout(frames, grid):
    """Where each frame goes on the canvas: its own drawn part, enlarged, in the middle of
    its cell. One enlargement for the whole canvas. Returns (zoom, [(box, place) or None])."""
    cols, rows = grid
    cw, ch = CANVAS // cols, CANVAS // rows
    boxes = [f.getchannel("A").point(lambda a: 255 if a > 6 else 0).getbbox() for f in frames]
    live = [b for b in boxes if b]
    if not live:
        return 0, [None] * len(frames)
    wide = max(b[2] - b[0] for b in live)
    tall = max(b[3] - b[1] for b in live)
    zoom = min(MAX_ZOOM, (cw - 48) / wide, (ch - 48) / tall)
    out = []
    for i, b in enumerate(boxes):
        if not b:
            out.append(None)
            continue
        w, h = round((b[2] - b[0]) * zoom), round((b[3] - b[1]) * zoom)
        out.append((b, ((i % cols) * cw + (cw - w) // 2, (i // cols) * ch + (ch - h) // 2, w, h)))
    return zoom, out


def finish(plain, painted, keep=0.0, edge=True):
    """Blends photorealistic FLUX micro-detail & weathering onto the AgX PBR render
    (zero cartoon black outlines, zero rainbow chroma speckles, crisp untouched muzzle flashes)."""
    alpha = np.asarray(plain.getchannel("A"), dtype=np.float32) / 255.0
    flat = np.asarray(plain.convert("RGB"), dtype=np.float32)
    rgb = np.asarray(painted.convert("RGB"), dtype=np.float32)

    if keep:
        # Work in YCbCr: take FLUX's crisp photorealistic luminance micro-detail (rivets, folds, scuffs)
        # while pulling chrominance back toward the realistic AgX PBR faction palette.
        to_y = lambda c: 0.299 * c[..., 0] + 0.587 * c[..., 1] + 0.114 * c[..., 2]
        y_flat, y_paint = to_y(flat), to_y(rgb)
        cb_flat, cr_flat = flat[..., 2] - y_flat, flat[..., 0] - y_flat
        cb_paint, cr_paint = rgb[..., 2] - y_paint, rgb[..., 0] - y_paint

        weight = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(SPREAD))
        w = np.asarray(weight, dtype=np.float32) / 255.0 + 1e-3

        def soft_y(vals):
            pre = Image.fromarray(np.clip(vals * alpha, 0, 255).round().astype(np.uint8)).filter(ImageFilter.GaussianBlur(SPREAD))
            return np.asarray(pre, dtype=np.float32) / w

        y_gain = np.clip((soft_y(y_flat) + 10.0) / (soft_y(y_paint) + 10.0), 0.78, 1.32)
        y_adj = np.clip(y_paint * (1.0 + (y_gain - 1.0) * 0.55), 0.0, 255.0)
        y_out = 0.85 * y_adj + 0.15 * y_flat

        cb_out = cb_flat * keep + cb_paint * (1.0 - keep)
        cr_out = cr_flat * keep + cr_paint * (1.0 - keep)

        r_out = y_out + cr_out
        b_out = y_out + cb_out
        g_out = (y_out - 0.299 * r_out - 0.114 * b_out) / 0.587
        rgb = np.clip(np.dstack([r_out, g_out, b_out]), 0.0, 255.0)

    # Preserve glowing emissive pixels (muzzle flashes, warm headlights, sparks, hero orbs) untouched
    glow = (flat.max(axis=2) > 230) & (np.sort(flat, axis=2)[..., 1] > 165) & (alpha > 0.12)
    near_glow = np.asarray(Image.fromarray((glow * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))) > 0
    rgb = np.where(near_glow[..., None], flat, rgb)

    # On semi-transparent silhouette boundary pixels, use the clean darkened PBR edge so grey studio
    # background never leaks as a halo—with ZERO heavy cartoon black outline!
    fringe = (alpha > 0.02) & (alpha < 0.72) & (~near_glow)
    rgb = np.where(fringe[..., None], flat * 0.78, rgb)
    return Image.fromarray(np.dstack([rgb, alpha * 255.0]).round().astype(np.uint8), "RGBA")


def save_small(image, path):
    """256 colours with Floyd-Steinberg dithering to preserve smooth realistic PBR shading cleanly."""
    image.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG).save(path, optimize=True)


def paint_sheet(name, part, words, style, seed, plain_only, comfy):
    # `comfy` starts the image model the first time a canvas has to be painted.
    """One sheet. `part` is its manifest entry (frame and anims); `words` its subject."""
    file = pathlib.Path(part["image"]).name
    sheet = Image.open(PLAIN / part["image"]).convert("RGBA")
    grid_cells = cells_of(sheet, part["frame"])
    fw, fh = part["frame"]
    out = Image.new("RGBA", sheet.size, (0, 0, 0, 0))
    cols, rows = words.get("grid", [2, 2])
    per = cols * rows
    kept = KEPT / pathlib.Path(file).stem
    kept.mkdir(parents=True, exist_ok=True)
    for col in range(len(grid_cells[0])):
        anim = anim_of(part["anims"], col)
        subject = words.get(anim, words["subject"])
        prompt = style.replace("{subject}", subject)
        tag = hashlib.sha1(f"{prompt}|{seed}|{START}|{cols}x{rows}".encode()).hexdigest()[:8]
        for first in range(0, len(grid_cells), per):
            group = [grid_cells[r][col] for r in range(first, min(first + per, len(grid_cells)))]
            zoom, places = layout(group, (cols, rows))
            if not zoom:
                continue
            painted = None
            if not plain_only:
                path = kept / f"c{col:02d}_r{first}_{tag}.png"
                if not path.exists():
                    canvas = Image.new("RGBA", (CANVAS, CANVAS), GREY + (255,))
                    for frame, place in zip(group, places):
                        if place:
                            b, (x, y, w, h) = place
                            canvas.alpha_composite(frame.crop(b).resize((w, h), Image.LANCZOS), (x, y))
                    comfy()
                    work = f"{pathlib.Path(file).stem}_{col}_{first}.png"
                    canvas.convert("RGB").save(G.WORK / "input" / work)
                    shutil.move(G.render(flow(prompt, seed, work)), path)
                    print(f"{file} column {col} ({anim}) rows {first}+  x{zoom:.2f}", flush=True)
                painted = Image.open(path).convert("RGB")
            for i, (frame, place) in enumerate(zip(group, places)):
                if not place:
                    continue
                b, (x, y, w, h) = place
                cut = frame.crop(b)
                colour = painted.crop((x, y, x + w, y + h)).resize(cut.size, Image.LANCZOS) if painted else cut
                # One pixel of room all round for the edge, which the packed frame has.
                pad = (max(0, b[0] - 1), max(0, b[1] - 1), min(fw, b[2] + 1), min(fh, b[3] + 1))
                base = Image.new("RGB", (pad[2] - pad[0], pad[3] - pad[1]), OUTLINE)
                base.paste(colour, (b[0] - pad[0], b[1] - pad[1]))
                out.alpha_composite(finish(frame.crop(pad), base, words.get("keep", KEEP) if painted else 0, words.get("edge", True)), (col * fw + pad[0], (first + i) * fh + pad[1]))
    save_small(out, OUT / part["image"])
    print(f"{part['image']}  painted" if not plain_only else f"{part['image']}  outlined", flush=True)


def main():
    global PLAIN, KEPT, OUT
    ap = argparse.ArgumentParser()
    ap.add_argument("units", nargs="*")
    ap.add_argument("--plain", action="store_true", help="outline only, no model")
    ap.add_argument("--out-root", type=pathlib.Path, help="output sprite directory (default: assets/sprites)")
    ap.add_argument("--plain-root", type=pathlib.Path, help="input plain render directory (default: assets/raw/plain)")
    ap.add_argument("--kept-root", type=pathlib.Path, help="paint cache directory (default: assets/raw/paint)")
    args = ap.parse_args()
    if args.out_root:
        OUT = args.out_root.resolve()
        if not args.plain_root and "CALLSIGN_PLAIN_ROOT" not in os.environ:
            PLAIN = OUT.parent / "plain"
        if not args.kept_root and "CALLSIGN_KEPT_ROOT" not in os.environ:
            KEPT = OUT.parent / "paint"
    if args.plain_root:
        PLAIN = args.plain_root.resolve()
    if args.kept_root:
        KEPT = args.kept_root.resolve()
    spec = json.loads((HERE / "paint.json").read_text())
    manifest = json.loads((OUT / "manifest.json").read_text())
    jobs = []
    for name, entry in manifest["units"].items():
        if args.units and name not in args.units:
            continue
        words = spec["units"].get(name)
        if not words:
            print(f"{name}: no words in art/paint.json, left as it is")
            continue
        if not (PLAIN / entry["image"]).exists():
            print(f"{name}: no render in {PLAIN.relative_to(ROOT)} (run make art-units), left as it is")
            continue
        jobs.append((name, entry, words))
        if entry.get("turret"):
            jobs.append((name, entry["turret"], {**words, **words["turret"], "turret": None}))
    # The rendered pieces: every picture of a piece is one frame, or a sheet of `frame`s.
    for name, words in spec.get("pieces", {}).items():
        if args.units and name not in args.units:
            continue
        for path in sorted((PLAIN / words["folder"]).glob(f"{name}*.png")):
            image = f"{words['folder']}/{path.name}"
            size = words.get("frame") or list(Image.open(path).size)
            state = next((words[k] for k in ("ruin", "broken") if f"_{k}" in path.name and k in words), words["subject"])
            jobs.append((name, {"image": image, "frame": size, "anims": {}}, {**words, "subject": state}))
    if not jobs:
        return
    running = []

    def comfy():
        if not running:
            running.append(G.start_comfyui())

    try:
        for name, part, words in jobs:
            paint_sheet(name, part, words, spec["style"], words.get("seed", spec["seed"]), args.plain, comfy)
        # Painted sheets are new pictures at the same addresses: a new stamp makes the page ask again.
        manifest = json.loads((OUT / "manifest.json").read_text())
        manifest["stamp"] = int(time.time())
        (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    finally:
        for proc in running:
            proc.terminate()


if __name__ == "__main__":
    main()
