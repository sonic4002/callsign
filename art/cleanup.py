"""Turns the kept raw images into game sprites.

For every sprite in art/sprites.json that names a `keep` seed (the candidate that passed
review), this cuts the background away, trims, scales to game size and writes

    assets/sprites/{buildings,landmarks,terrain,portraits}/<id>.png
    assets/sprites/manifest.json     what the page loads
    assets/sprites/CREDITS.md        model, licence, seed and prompt of every sprite

The units are not generated images: art/units.py renders them and owns the "units" part
of the manifest, and art/props.py owns "segments" and "props"; those are kept as they are.

A sprite with `from` is a second state of that sprite (a headquarters in ruins): it is
trimmed to the same frame, so both have one size and one anchor.

A structure goes up in stages: `<id>_stage1`, `_stage2` … are that building at earlier
moments, listed in order under the building's `stages`, and `<id>_site` is kept as another
name for the first of them. A door (`<id>_open`) is not a whole picture but a small patch
cut from around the building's `door.box`, to be drawn over the building; `<id>_lit` is
that same patch with the light on inside, made here so the two match exactly. The
box, the way out (`exit`) and the place a new unit goes to stand (`rally`) are given in
art/sprites.json as fractions of the building's picture.

Sprites without `keep` are left out of the manifest, and the page draws its own stand-in.
A kept sprite whose raw image is not on this machine (assets/raw is not in git) keeps the
picture and the manifest entry it already has.

    python art/cleanup.py [--sheet contact.png] [id ...]

With ids, only those sprites are made again; the rest keep the pictures they have.
"""

import argparse
import json
import pathlib
import re

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
RAW = ROOT / "assets" / "raw"
OUT = ROOT / "assets" / "sprites"

FOLDER = {"building": "buildings", "landmark": "landmarks", "terrain": "terrain", "portrait": "portraits"}
ANCHOR = {"building": [0.5, 0.8], "scenery": [0.5, 0.9]}  # by style: where the thing stands in its picture
DRAWN = 2.6  # a sprite is stored this many times the height the page draws it at, for zooming in

MODEL_NOTE = """## Units

The unit sheets (`units/*.png`) are rendered on this machine by `make art-units` from
original low-poly models built in code in `art/units.py`: each is posed by turning its
joints, turned to eight headings under one light and rendered with Blender 4.2 (Cycles),
https://www.blender.org. Blender is GPL software; the models and the pictures are ours.

The rendered sheets are then painted by `make art-paint` (`art/paint.py`, words in
`art/paint.json`): the image model named below (FLUX.2 [klein] 4B, Apache-2.0) redraws every
frame over itself, starting from the render and keeping three of its four steps, so the
shape and place of each frame stay the model's own; the frame's outline is cut from the
render, not from the painting, and its colours are pulled back to the render's. The walls,
fences, bridge and sandbags below are painted the same way. See docs/art/STYLE.md.

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
- `<key>_ruin` is that building destroyed; it fills exactly the frame of `<key>`, so one can
  be swapped for the other in place.
- A structure's `stages` lists the keys of its pictures while it is being built, earliest
  first (`<key>_stage1` …); each fills the frame of `<key>`. `<key>_site` is the first stage
  under its old name. Show stage `floor(progress * stages.length)` and the finished picture
  at progress 1 (`stageOf` in client/art.js).
- A structure that makes units has `door`: `frames.open` and `frames.lit` are small patches
  (`image`, `size`, and `at`, the patch's top-left corner in the building's picture) to draw
  over the finished building; `exit` is the doorway and `rally` where a new unit goes to
  stand, both as fractions of the building's picture; `faces` is the way the door looks out;
  `lift: true` means what comes out rises from a pad on the roof and does not walk away.
  `doorAt`, `structurePoint`, `emergence` and `drawStructure` in client/art.js use these.
- `portraits.<name>` is a square roster picture of a hero.
- Units: a sheet's `facings` is 8 or 16 and `order` names its rows; `anims` names runs of
  columns. Vehicles and boats have `move`; the helicopter `move`, `bankLeft`, `bankRight`;
  soldiers `walk` (twelve frames) and `stop`; the heroes (`hero: true`) their own poses.

## Sandbags

`landmarks/sandbags.png` is rendered by `make art-units` (art/props.py) like the units: a row
for each of eight map headings the position faces, a column for each state in `states`.

## Parts that turn, power and ownership

`props/radar_dish.png` and `props/antenna_loop.png` are rendered by `make art-units`
(art/props.py): one row of `frames` pictures, a full turn clockwise, each cropped to the
same box so the mount stays put. A building's `spin` in the manifest names its part, where
on the building's picture the mount sits (`at`, as fractions), the height the part is drawn
at in the building's own units (`height`) and the seconds one turn takes (`period`).

A structure with the power down has no picture of its own: the page darkens the lit one
(client/art.js, `dimmed`), stops whatever turns and blinks a lamp at `lamp` (fractions of
the picture). The buildings of no army (`tech_*`) carry `flag`, the foot of the staff on
which the page draws the flag of whoever holds them. `icons/*.png` are the same pictures
fitted to the build panel's button.

The earned-rank marks and the panel's state icons are not pictures but shapes drawn in
code (client/marks.js).

## Heroes

The two hero sheets (`units/aegis_sentinel.png`, `units/ashfall_oracle.png`) are original
models built in code in art/units.py like every other unit. Their roster portraits
(`portraits/*.png`) are painted by the image model below from a description of the same
invented characters; no real person and no existing character was named or shown to it.

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
- A construction stage is made the same way from the finished building, so every stage
  stands in the building's own frame; a door is the same redraw with the door open, of which
  only a patch around the door is kept and laid over the building
- Terrain tiles are made to repeat by cross-fading each edge into the far side of the picture;
  ice and rock are also evened out (their large light and dark patches are flattened), so the
  eye finds no landmark that repeats
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


def even_out(image):
    """Flattens the broad light and dark patches of a ground texture, keeping its grain. A
    tile with one bright drift or one dark crack repeats visibly; one with only grain does not."""
    src = np.asarray(image.convert("RGB"), dtype=np.float32)
    # The blur wraps round the edges, as the tile itself does.
    tiled = np.tile(src, (3, 3, 1))
    radius = image.width // 5
    broad = np.asarray(Image.fromarray(np.clip(tiled, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32)
    broad = broad[image.height : 2 * image.height, image.width : 2 * image.width]
    flat = src - 0.85 * (broad - src.mean(axis=(0, 1), keepdims=True))
    return Image.fromarray(np.clip(flat, 0, 255).astype(np.uint8))


def door_patch(edit, box, grow):
    """Cuts the door out of a redrawn building: the part of the picture inside `box`
    (fractions of the frame) and `grow` beyond it, fading out toward its edges so that it
    sits on the building with no visible border. Returns the patch and where it goes."""
    w, h = edit.size
    x0, y0 = max(0, round((box[0] - grow) * w)), max(0, round((box[1] - grow) * h))
    x1, y1 = min(w, round((box[2] + grow) * w)), min(h, round((box[3] + grow) * h))
    patch = edit.crop((x0, y0, x1, y1))
    feather = max(2, round(grow * w))
    mask = Image.new("L", patch.size, 0)
    ImageDraw.Draw(mask).rectangle([feather, feather, patch.width - 1 - feather, patch.height - 1 - feather], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(feather / 2))
    alpha = np.asarray(patch.getchannel("A"), dtype=np.float32) * np.asarray(mask, dtype=np.float32) / 255
    patch.putalpha(Image.fromarray(alpha.astype(np.uint8)))
    return patch, [x0, y0]


def lit_door(patch):
    """The open door with the light on inside: the dark of the doorway is filled with warm
    light, brightest in the middle, and a little of it falls on what is around the door."""
    rgb = np.asarray(patch.convert("RGB"), dtype=np.float32)
    alpha = np.asarray(patch.getchannel("A"), dtype=np.float32) / 255
    h, w = alpha.shape
    yy, xx = np.mgrid[0:h, 0:w]
    centre = np.clip(1 - np.hypot((xx - w / 2) / (w / 2), (yy - h * 0.55) / (h / 2)), 0, 1)
    dark = np.clip((95 - rgb.mean(axis=2)) / 60, 0, 1)  # how much a pixel is doorway and not wall
    warm = np.array([255, 196, 104], dtype=np.float32)
    inside = (dark * (0.35 + 0.65 * centre))[..., None]
    out = rgb * (1 - 0.85 * inside) + warm * 0.85 * inside
    spill = (0.22 * centre * (1 - dark))[..., None]
    out = out + (warm - out) * spill
    lit = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).convert("RGBA")
    lit.putalpha(Image.fromarray((alpha * 255).astype(np.uint8)))
    return lit


def soften_frame(rgba, margin=5):
    """Fades a picture out over its last few pixels on every side. A construction stage can
    spread wider than the finished building whose frame it must fill; cut off sharp, the
    edge would show as a straight line."""
    alpha = np.asarray(rgba.getchannel("A"), dtype=np.float32)
    h, w = alpha.shape
    ramp_x = np.clip(np.minimum(np.arange(w), w - 1 - np.arange(w)) / margin, 0, 1)
    ramp_y = np.clip(np.minimum(np.arange(h), h - 1 - np.arange(h)) / margin, 0, 1)
    rgba.putalpha(Image.fromarray((alpha * ramp_x[None, :] * ramp_y[:, None]).astype(np.uint8)))
    return rgba


EXTRAS = ("spin", "flag", "lamp")
ICON = (144, 96)  # twice the 72 by 48 the build panel draws a button's picture at


def fit_icon(rgba):
    """The picture scaled to fit the build panel's button, standing on its bottom edge."""
    box = rgba.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    cut = rgba.crop(box)
    k = min(ICON[0] / cut.width, ICON[1] / cut.height)
    cut = cut.resize((max(1, round(cut.width * k)), max(1, round(cut.height * k))), Image.LANCZOS)
    icon = Image.new("RGBA", ICON, (0, 0, 0, 0))
    icon.alpha_composite(cut, ((ICON[0] - cut.width) // 2, ICON[1] - cut.height))
    return icon


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
    # What art/props.py renders into "landmarks" (the sandbags) is its own and is kept.
    manifest = {"units": old.get("units", {}), "buildings": {}, "landmarks": {k: v for k, v in old.get("landmarks", {}).items() if "ppm" in v},
                "terrain": {}, "segments": old.get("segments", {}), "props": old.get("props", {}), "variants": {}, "portraits": {},
                "icons": {}}
    by_id = {s["id"]: s for s in spec["sprites"]}
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

    def need_session():
        nonlocal session
        if session is None:
            from rembg import new_session

            session = new_session("birefnet-general")
        return session

    def box_of(source_id):
        """The box a sprite's picture was trimmed to. When that sprite is not being made
        again in this run, its raw image is cut out once more just to learn its box."""
        if source_id not in boxes:
            _, boxes[source_id] = cut_out(raw_image(by_id[source_id]), need_session())
        return boxes[source_id]

    for sprite in kept:
        kind = sprite["kind"]
        group = FOLDER[kind]
        rel = f"{group}/{sprite['id']}.png"
        (OUT / group).mkdir(parents=True, exist_ok=True)
        door = re.fullmatch(r"(.+)_(open)", sprite["id"]) if sprite["style"] == "door" else None
        skip = (args.ids and sprite["id"] not in args.ids) or not (RAW / f"{sprite['id']}__{sprite['keep']}.png").exists()
        if door:
            # A door belongs to its building's entry, which is made before it.
            owner = manifest["buildings"].get(door[1])
            spot = by_id[door[1]].get("door")
            if owner is None or spot is None:
                print(f"{rel}  left out: {door[1]} has no door box in sprites.json")
                continue
            was = old.get("buildings", {}).get(door[1], {}).get("door", {}).get("frames", {})
            owner.setdefault("door", {"frames": {}, **{k: spot[k] for k in ("exit", "rally", "faces", "lift") if k in spot}})
            lit_rel = rel.replace("_open.png", "_lit.png")
            if skip and was.get("open") and (OUT / rel).exists() and (OUT / lit_rel).exists():
                owner["door"]["frames"].update(was)
                credit(rel, sprite)
                print(f"{rel}  kept as it is")
                continue
            cut, _ = cut_out(raw_image(sprite), need_session(), box_of(sprite["from"]))
            patch, at = door_patch(scale_to_height(cut, sprite["height"]), spot["box"], 0.03)
            patch.save(OUT / rel, optimize=True)
            lit_door(patch).save(OUT / lit_rel, optimize=True)
            for name, path in (("open", rel), ("lit", lit_rel)):
                owner["door"]["frames"][name] = {"name": name, "image": path, "at": at, "size": [patch.width, patch.height]}
            credit(rel, sprite)
            print(f"{rel}  {patch.width}x{patch.height} at {at}, and {lit_rel}")
            continue
        key = sprite["id"].removeprefix("portrait_") if kind == "portrait" else sprite["id"]
        if skip and (OUT / rel).exists() and key in old.get(group, {}):
            # Not asked for, or made on another machine: the picture stands as it is.
            manifest[group][key] = old[group][key]
            credit(rel, sprite)
            sheet.append((sprite["id"], Image.open(OUT / rel)))
            print(f"{rel}  kept as it is")
            continue
        image = raw_image(sprite)
        if kind == "terrain":
            result = make_tileable(image, sprite["height"])
            if sprite.get("even"):
                result = even_out(result)
            manifest["terrain"][sprite["id"]] = rel
        elif kind == "portrait":
            # A portrait keeps its background: it is cropped square and scaled.
            side = min(image.size)
            left, top = (image.width - side) // 2, (image.height - side) // 2
            result = image.convert("RGB").crop((left, top, left + side, top + side)).resize((sprite["height"], sprite["height"]), Image.LANCZOS)
            manifest["portraits"][sprite["id"].removeprefix("portrait_")] = {"image": rel, "size": [result.width, result.height]}
        else:
            need_session()
            cut, boxes[sprite["id"]] = cut_out(image, session, box_of(sprite["from"]) if "from" in sprite else None)
            result = scale_to_height(cut, sprite["height"])
            if sprite["style"] in ("stage", "site"):
                result = soften_frame(result)
            manifest[group][sprite["id"]] = {
                "image": rel, "size": [result.width, result.height],
                "anchor": sprite.get("anchor", ANCHOR.get(sprite["style"], ANCHOR["building"])),
                "height": sprite.get("draw", round(sprite["height"] / DRAWN)),
            }
        result.save(OUT / rel, optimize=True)
        credit(rel, sprite)
        sheet.append((sprite["id"], result))
        print(f"{rel}  {result.width}x{result.height}")

    # A structure's stages, earliest first; `<id>_site` is another name for the first.
    for entry in manifest["buildings"].values():
        entry.pop("stages", None)  # an entry kept from the last run brings its old list
    for key in sorted(manifest["buildings"]):
        stage = re.fullmatch(r"(.+)_stage(\d+)", key)
        if stage and stage[1] in manifest["buildings"]:
            manifest["buildings"][stage[1]].setdefault("stages", []).append(key)
    for key, entry in list(manifest["buildings"].items()):
        if entry.get("stages"):
            manifest["buildings"][f"{key}_site"] = dict(manifest["buildings"][entry["stages"][0]])

    # Different pictures of one thing: house_1, house_2 … are variants of "house".
    for group in ("landmarks", "props"):
        for key in manifest[group]:
            name, _, n = key.rpartition("_")
            if n.isdigit() and "ppm" not in manifest[group][key]:
                manifest["variants"].setdefault(name, []).append(key)
    # What the page needs to know about a picture beyond its size is written beside it in
    # art/sprites.json and passed on as it is: `spin` (a part that turns, drawn over the
    # building), `flag` (where the owner's flag stands on a building of no army) and `lamp`
    # (where its warning lamp blinks when the power is low).
    for sprite in kept:
        entry = manifest[FOLDER[sprite["kind"]]].get(sprite["id"])
        if isinstance(entry, dict):
            for extra in EXTRAS:
                if extra in sprite:
                    entry[extra] = sprite[extra]
                else:
                    entry.pop(extra, None)
    # A small picture of a structure for its button in the build panel.
    (OUT / "icons").mkdir(parents=True, exist_ok=True)
    for sprite in kept:
        if not sprite.get("icon"):
            continue
        source = OUT / FOLDER[sprite["kind"]] / f"{sprite['id']}.png"
        if not source.exists():
            continue
        rel = f"icons/{sprite['id']}.png"
        icon = fit_icon(Image.open(source).convert("RGBA"))
        icon.save(OUT / rel, optimize=True)
        manifest["icons"][sprite["id"]] = {"image": rel, "size": [icon.width, icon.height]}
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
