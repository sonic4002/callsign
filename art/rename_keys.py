"""Gives the sprites the game's own names.

The art pipeline names a faction's pictures with the faction in front ("aegis_works",
"ashfall_hauler"), because one prompt file holds both armies. The game asks for a picture
by the rules id of the thing ("vehicleWorks", "dumpTruck"): the manifest key IS the rules
id. This step runs last in `make art` and `make art-units` and renames the manifest keys
and the image files to match. It can be run any number of times.

    python art/rename_keys.py [assets/sprites]
"""
import json
import os
import sys

# pipeline id → rules id. A key that starts with the pipeline id keeps what follows it
# ("aegis_works_ruin" → "vehicleWorks_ruin", "aegis_works_stage2" → "vehicleWorks_stage2").
KEYS = {
    "buildings": {
        "aegis_barracks": "barracks", "aegis_works": "vehicleWorks", "aegis_airbase": "airbase",
        "aegis_dockyard": "dockyard", "aegis_refinery": "refinery",
        "aegis_sentryGun": "sentryGun", "aegis_flakBattery": "flakBattery",
        "ashfall_safehouse": "safehouse", "ashfall_chopShop": "chopShop", "ashfall_launchYard": "launchYard",
        "ashfall_boatShed": "boatShed", "ashfall_smelter": "smelter",
        "ashfall_gunNest": "gunNest", "ashfall_rocketNest": "rocketNest",
        # the third wave: power and radar structures
        "aegis_powerPlant": "powerPlant", "ashfall_generatorYard": "generatorYard",
        "aegis_radar": "radar", "ashfall_listeningPost": "listeningPost",
    },
    "segments": {"aegis_wall": "barrierWall", "ashfall_fence": "wireFence"},
    "units": {
        "aegis_hauler": "crawler", "ashfall_hauler": "dumpTruck",
        "aegis_engineer": "engineers", "ashfall_sapper": "sappers",
        "aegis_sentinel": "sentinel", "ashfall_oracle": "oracle",  # the heroes of the second wave
    },
}


def renamed(key, table):
    for old in sorted(table, key=len, reverse=True):
        if key == old or key.startswith(old + "_"):
            return table[old] + key[len(old):]
    return key


def move(root, entry, table):
    """Renames the image files an entry (or anything nested in it) points at."""
    if isinstance(entry, dict):
        image = entry.get("image")
        if isinstance(image, str):
            folder, name = os.path.split(image)
            stem, ext = os.path.splitext(name)
            new = os.path.join(folder, renamed(stem, table) + ext)
            if new != image:
                src, dst = os.path.join(root, image), os.path.join(root, new)
                if os.path.exists(src):
                    os.replace(src, dst)
                entry["image"] = new
        # A list of other keys of the group (a structure's construction stages).
        stages = entry.get("stages")
        if isinstance(stages, list):
            entry["stages"] = [renamed(k, table) if isinstance(k, str) else k for k in stages]
        # The picture a turning part stands on (a radar with its dish taken off).
        body = entry.get("body")
        if isinstance(body, str):
            entry["body"] = renamed(body, table)
        for value in entry.values():
            move(root, value, table)


def main(root):
    path = os.path.join(root, "manifest.json")
    with open(path, encoding="utf-8") as f:
        manifest = json.load(f)
    changed = 0
    KEYS["icons"] = KEYS["buildings"]  # build-panel pictures carry their structure's name
    for group, table in KEYS.items():
        out = {}
        for key, entry in manifest.get(group, {}).items():
            new = renamed(key, table)
            move(root, entry, table)
            changed += new != key
            out[new] = entry
        manifest[group] = out
    with open(path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"sprite keys: {changed} renamed to the rules ids")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "assets/sprites")
