"""Turns the kept raw images into game sprites.

For every sprite in art/sprites.json that names a `keep` seed (the candidate that passed
review), this cuts the background away, trims, scales to game size and writes

    assets/sprites/{buildings,landmarks,terrain}/<id>.png
    assets/sprites/manifest.json     what the page loads
    assets/sprites/CREDITS.md        model, licence, seed and prompt of every sprite

The units are not generated images: art/units.py renders them and owns the "units" part
of the manifest, and art/props.py owns "segments" and "props"; those are kept as they are.

A sprite with `from` is a second state of that sprite (a headquarters in ruins): it is
trimmed to the same frame, so both have one size and one anchor.

Sprites without `keep` are left out of the manifest, and the page draws its own stand-in.
A kept sprite whose raw image is not on this machine (assets/raw is not in git) keeps the
picture and the manifest entry it already has.

    python art/cleanup.py [--sheet contact.png] [id ...]

With ids, only those sprites are made again; the rest keep the pictures they have.
"""

import argparse
import json
import pathlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
RAW = ROOT / "assets" / "raw"
OUT = ROOT / "assets" / "sprites"

FOLDER = {"building": "buildings", "landmark": "landmarks", "terrain": "terrain"}
ANCHOR = {"building": [0.5, 0.8], "scenery": [0.5, 0.9]}  # by style: where the thing stands in its picture
DRAWN = 2.6  # a sprite is stored this many times the height the page draws it at, for zooming in

MODEL_NOTE = """## Units

The unit sheets (`units/*.png`) are rendered on this machine by `make art-units` from
original low-poly models built in code in `art/units.py`: each is posed by turning its
joints, turned to eight headings under one light and rendered with Blender 4.2 (Cycles),
https://www.blender.org. Blender is GPL software; the models and the pictures are ours.

## Run pieces and gold

The pieces that are laid end to end (`segments/*.png`: walls, fences, the bridge) and the
gold lying in a field (`props/*.png`) are rendered by `make art-units` from models built in
code in `art/props.py`, with the same Blender set-up as the units. In the manifest:

- `segments.<key>` has a picture for a run along the map's east-west axis (`x`) and one for
  north-south (`y`), each with `size` and `anchor` (the middle of the piece, on the ground).
  One piece covers `length` world units of the run; draw piece i with its anchor at
  `start + (i + 0.5) * length` along the axis, scaled by `zoom * scale`, back to front.
  `ruin`, `end` and `broken` hold the same pair for those states, and `post` is one picture
  for the ends and corners of a wall or fence. `bridge.width` is the roadway in world units.
- `props.<key>` and every building and landmark carry `height`: the height in pixels the
  page draws it at before its own scale.
- `variants.<name>` lists the keys that are different pictures of one thing (`house`,
  `grove`, `rocks`, `mountain`, `gold_field`); pick one by the thing's id so it never changes.
- `<key>_ruin` is that building destroyed and `<key>_site` is it under construction; both
  fill exactly the frame of `<key>`, so one can be swapped for another in place.

## Buildings, landmarks and terrain

Every sprite below was generated on this machine by `make art` and reviewed by eye.

- Image model: FLUX.2 [klein] 4B, distilled (`flux-2-klein-4b.safetensors`), Apache-2.0,
  Black Forest Labs, https://huggingface.co/black-forest-labs/FLUX.2-klein-4B
- Text encoder: Qwen3 4B, fp4 (`qwen_3_4b_fp4_flux2.safetensors`), Apache-2.0, as packaged in
  https://huggingface.co/Comfy-Org/Flux-2-Klein-4B
- VAE: `flux2-vae.safetensors`, Apache-2.0, same package
- Runner: ComfyUI, sampler `euler`, Flux2Scheduler, 4 steps, guidance 1, 1024x1024
- A ruin or a construction site is the same model redrawing the kept image of its building
  (the klein image-edit graph, a reference latent), so it stands exactly where the building does
- Terrain tiles are made to repeat by cross-fading each edge into the far side of the picture
- Background removal: BiRefNet (general), MIT, https://github.com/ZhengPeng7/BiRefNet, run through rembg

No third-party artwork is included.
"""


def cut_out(image, session, box=None):
    """Removes the studio background and returns a trimmed RGBA image and the box it was
    trimmed to. Given a `box`, it trims to that one instead: a second state of a building
    then fills exactly the frame of the first, so the page can swap one for the other."""
    from rembg import remove

    rgba = remove(image.convert("RGB"), session=session, post_process_mask=True)
    alpha = np.asarray(rgba.getchannel("A"), dtype=np.uint8).copy()
    alpha[alpha < 40] = 0
    # Pull the edge in by a pixel so no grey studio fringe survives the downscale.
    alpha = np.asarray(Image.fromarray(alpha).filter(ImageFilter.MinFilter(3)))
    rgba.putalpha(Image.fromarray(alpha))
    if rgba.getbbox() is None:
        raise SystemExit("background removal left nothing")
    box = box or rgba.getbbox()
    return rgba.crop(box), box


def scale_to_height(rgba, height):
    width = max(1, round(rgba.width * height / rgba.height))
    # Resize with premultiplied alpha so transparent pixels do not bleed colour into edges.
    return rgba.convert("RGBa").resize((width, height), Image.LANCZOS).convert("RGBA")


def make_tileable(image, size):
    """Makes a picture repeat with no seam and no mirror pattern: a band along the left and
    top edges is cross-faded into what lies just past the right and bottom edges, so each
    edge continues into the opposite one. The fade keeps the texture's contrast (a plain
    average would leave a flat stripe)."""
    band = size // 8  # narrow: two pictures show through each other inside the band
    src = np.asarray(image.convert("RGB").resize((size + band, size + band), Image.LANCZOS), dtype=np.float32)
    mean = src.mean(axis=(0, 1), keepdims=True)
    ramp = np.clip(np.arange(size, dtype=np.float32) / band, 0, 1)
    ramp = ramp * ramp * (3 - 2 * ramp)  # eased, so the band has no visible start

    def fade(near, far, w):
        mixed = w * (near - mean) + (1 - w) * (far - mean)
        return mean + mixed / np.sqrt(w * w + (1 - w) * (1 - w))

    # Horizontally: column x takes the picture's own column, faded near the left edge into
    # the column one tile-width to its right.
    right = np.concatenate([src[:, size:], src[:, band:size]], axis=1)
    rows = fade(src[:, :size], right, ramp[None, :, None])
    below = np.concatenate([rows[size:], rows[band:size]], axis=0)
    tile = fade(rows[:size], below, ramp[:, None, None])
    return Image.fromarray(np.clip(tile, 0, 255).astype(np.uint8))


def contact_sheet(entries, path):
    """One picture of the whole set: each sprite at game size and at 48 px, on mid grey."""
    cell_w, cell_h = 400, 330
    cols = 3
    rows = -(-len(entries) // cols)
    sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), (88, 96, 90))
    draw = ImageDraw.Draw(sheet)
    for i, (name, image) in enumerate(entries):
        x, y = (i % cols) * cell_w, (i // cols) * cell_h
        draw.rectangle([x, y, x + cell_w - 1, y + cell_h - 1], outline=(60, 66, 62))
        big = image.copy()
        big.thumbnail((cell_w - 90, cell_h - 50))
        sheet.paste(big, (x + 10, y + 30), big if big.mode == "RGBA" else None)
        small = image.copy()
        small.thumbnail((48, 48))
        sheet.paste(small, (x + cell_w - 64, y + 30), small if small.mode == "RGBA" else None)
        draw.text((x + 10, y + 8), f"{name}  {image.width}x{image.height}", fill=(235, 240, 236))
    sheet.save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", help="also write a contact sheet of the kept set to this path")
    ap.add_argument("ids", nargs="*", help="only make these again")
    args = ap.parse_args()

    spec = json.loads((HERE / "sprites.json").read_text())
    kept = [s for s in spec["sprites"] if "keep" in s]
    session = None
    old = json.loads((OUT / "manifest.json").read_text()) if (OUT / "manifest.json").exists() else {}
    manifest = {"units": old.get("units", {}), "buildings": {}, "landmarks": {}, "terrain": {},
                "segments": old.get("segments", {}), "props": old.get("props", {}), "variants": {}}
    credits = ["# Sprite credits", "", MODEL_NOTE, "| Sprite | Seed | Prompt |", "|---|---|---|"]
    sheet = []
    boxes = {}  # sprite id → the box its picture was trimmed to

    def raw_image(sprite):
        raw = RAW / f"{sprite['id']}__{sprite['keep']}.png"
        if not raw.exists():
            raise SystemExit(f"{raw} is missing: run `make art` to generate it")
        return Image.open(raw)

    def credit(rel, sprite):
        prompt = spec["styles"][sprite["style"]].replace("{subject}", sprite["subject"]).replace("|", "/")
        credits.append(f"| `{rel}` | {sprite['keep']} | {prompt} |")

    for sprite in kept:
        kind = sprite["kind"]
        group = FOLDER[kind]
        rel = f"{group}/{sprite['id']}.png"
        (OUT / group).mkdir(parents=True, exist_ok=True)
        skip = (args.ids and sprite["id"] not in args.ids) or not (RAW / f"{sprite['id']}__{sprite['keep']}.png").exists()
        if skip and (OUT / rel).exists() and sprite["id"] in old.get(group, {}):
            # Not asked for, or made on another machine: the picture stands as it is.
            manifest[group][sprite["id"]] = old[group][sprite["id"]]
            credit(rel, sprite)
            sheet.append((sprite["id"], Image.open(OUT / rel)))
            print(f"{rel}  kept as it is")
            continue
        image = raw_image(sprite)
        if kind == "terrain":
            result = make_tileable(image, sprite["height"])
            manifest["terrain"][sprite["id"]] = rel
        else:
            if session is None:
                from rembg import new_session

                session = new_session("birefnet-general")
            if "from" in sprite and sprite["from"] not in boxes:
                raise SystemExit(f"{sprite['id']} must come after {sprite['from']} in sprites.json")
            cut, boxes[sprite["id"]] = cut_out(image, session, boxes.get(sprite.get("from")))
            result = scale_to_height(cut, sprite["height"])
            manifest[group][sprite["id"]] = {
                "image": rel, "size": [result.width, result.height],
                "anchor": sprite.get("anchor", ANCHOR.get(sprite["style"], ANCHOR["building"])),
                "height": sprite.get("draw", round(sprite["height"] / DRAWN)),
            }
        result.save(OUT / rel, optimize=True)
        credit(rel, sprite)
        sheet.append((sprite["id"], result))
        print(f"{rel}  {result.width}x{result.height}")

    # Different pictures of one thing: house_1, house_2 … are variants of "house".
    for group in ("landmarks", "props"):
        for key in manifest[group]:
            name, _, n = key.rpartition("_")
            if n.isdigit():
                manifest["variants"].setdefault(name, []).append(key)
    for sprite in kept:
        # A building that has not been painted again keeps its old drawn height.
        entry = manifest[FOLDER[sprite["kind"]]].get(sprite["id"])
        if isinstance(entry, dict) and "height" not in entry:
            entry["height"] = sprite.get("draw", round(sprite["height"] / DRAWN))
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (OUT / "CREDITS.md").write_text("\n".join(credits) + "\n")
    if args.sheet:
        contact_sheet(sheet, args.sheet)
    print(f"{len(kept)} sprites written")


if __name__ == "__main__":
    main()
