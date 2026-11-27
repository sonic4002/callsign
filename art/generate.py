"""Generates raw sprite candidates with ComfyUI and FLUX.2 [klein] 4B (distilled).

Runs inside the callsign-art container with the network off: it starts ComfyUI on the
container's own loopback, queues one job per sprite and seed, and writes
assets/raw/<id>__<seed>.png. Images that already exist are skipped.

    python art/generate.py                 every sprite in art/sprites.json, its `seeds`
    python art/generate.py tank militia    only these ids
    python art/generate.py --seeds 5 6 tank    other seeds, to look for a better candidate

A sprite with `from` is a second state of another sprite (a headquarters in ruins): the
model redraws that sprite's kept image as the prompt asks, so the two match. A sprite with
`plan` is a site whose layout the game depends on (an airfield): the model redraws its
block-out, drawn by art/plan.py, the same way.
"""

import argparse
import json
import pathlib
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

import plan

HERE = pathlib.Path(__file__).resolve().parent
RAW = HERE.parent / "assets" / "raw"
WORK = pathlib.Path("/work")
API = "http://127.0.0.1:8188"

MODEL = "flux-2-klein-4b.safetensors"
TEXT_ENCODER = "qwen_3_4b_fp4_flux2.safetensors"
VAE = "flux2-vae.safetensors"
STEPS = 4  # the distilled model is made for four steps at guidance 1
SAMPLER = "euler"


def workflow(prompt, seed, width, height):
    """The official ComfyUI text-to-image graph for FLUX.2 klein 4B distilled, in API form."""
    return {
        "unet": {"class_type": "UNETLoader", "inputs": {"unet_name": MODEL, "weight_dtype": "default"}},
        "clip": {"class_type": "CLIPLoader", "inputs": {"clip_name": TEXT_ENCODER, "type": "flux2", "device": "default"}},
        "vae": {"class_type": "VAELoader", "inputs": {"vae_name": VAE}},
        "positive": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["clip", 0], "text": prompt}},
        "negative": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["positive", 0]}},
        "guider": {"class_type": "CFGGuider", "inputs": {"model": ["unet", 0], "positive": ["positive", 0], "negative": ["negative", 0], "cfg": 1.0}},
        "sampler": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": SAMPLER}},
        "sigmas": {"class_type": "Flux2Scheduler", "inputs": {"steps": STEPS, "width": width, "height": height}},
        "noise": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "latent": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
        "sample": {
            "class_type": "SamplerCustomAdvanced",
            "inputs": {"noise": ["noise", 0], "guider": ["guider", 0], "sampler": ["sampler", 0], "sigmas": ["sigmas", 0], "latent_image": ["latent", 0]},
        },
        "decode": {"class_type": "VAEDecode", "inputs": {"samples": ["sample", 0], "vae": ["vae", 0]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["decode", 0], "filename_prefix": "callsign"}},
    }


def edit_workflow(prompt, seed, reference):
    """The official klein image-edit graph: the same model redraws a reference image as the
    prompt asks. Used for a second state of a kept sprite, such as a building in ruins."""
    flow = workflow(prompt, seed, 1024, 1024)
    flow["image"] = {"class_type": "LoadImage", "inputs": {"image": reference}}
    flow["scaled"] = {"class_type": "ImageScaleToTotalPixels", "inputs": {"image": ["image", 0], "upscale_method": "nearest-exact", "megapixels": 1.0, "resolution_steps": 1}}
    flow["reference"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["scaled", 0], "vae": ["vae", 0]}}
    flow["positive_ref"] = {"class_type": "ReferenceLatent", "inputs": {"conditioning": ["positive", 0], "latent": ["reference", 0]}}
    flow["negative_ref"] = {"class_type": "ReferenceLatent", "inputs": {"conditioning": ["negative", 0], "latent": ["reference", 0]}}
    flow["guider"]["inputs"].update(positive=["positive_ref", 0], negative=["negative_ref", 0])
    return flow


def call(path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.load(res)
    except urllib.error.HTTPError as err:
        raise SystemExit(f"ComfyUI refused {path}: {err.read().decode()[:2000]}")


def start_comfyui():
    for name in ("output", "user", "input"):
        (WORK / name).mkdir(parents=True, exist_ok=True)
    log = open(WORK / "comfyui.log", "w")
    proc = subprocess.Popen(
        [sys.executable, "/comfy/main.py", "--listen", "127.0.0.1", "--port", "8188",
         "--output-directory", str(WORK / "output"), "--user-directory", str(WORK / "user"), "--input-directory", str(WORK / "input"),
         "--temp-directory", str(WORK), "--disable-auto-launch", "--offline"],
        stdout=log, stderr=subprocess.STDOUT, cwd="/comfy",
    )
    for _ in range(300):
        if proc.poll() is not None:
            raise SystemExit("ComfyUI stopped while starting:\n" + (WORK / "comfyui.log").read_text()[-3000:])
        try:
            urllib.request.urlopen(API + "/system_stats", timeout=2)
            return proc
        except OSError:
            time.sleep(1)
    proc.kill()
    raise SystemExit("ComfyUI did not come up:\n" + (WORK / "comfyui.log").read_text()[-3000:])


def render(flow):
    job = call("/prompt", {"prompt": flow})["prompt_id"]
    while True:
        entry = call(f"/history/{job}").get(job)
        if entry and entry.get("status", {}).get("completed"):
            image = entry["outputs"]["save"]["images"][0]
            return WORK / "output" / image["subfolder"] / image["filename"]
        if entry and entry.get("status", {}).get("status_str") == "error":
            raise SystemExit(f"generation failed: {json.dumps(entry['status'])[:2000]}\n" + (WORK / "comfyui.log").read_text()[-2000:])
        time.sleep(0.5)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--seeds", nargs="+", type=int)
    args = ap.parse_args()

    spec = json.loads((HERE / "sprites.json").read_text())
    by_id = {s["id"]: s for s in spec["sprites"]}
    jobs = []
    for sprite in spec["sprites"]:
        if args.ids and sprite["id"] not in args.ids:
            continue
        prompt = spec["styles"][sprite["style"]].replace("{subject}", sprite["subject"])
        for seed in args.seeds or sprite["seeds"]:
            out = RAW / f"{sprite['id']}__{seed}.png"
            if not out.exists():
                jobs.append((sprite, prompt, seed, out))
    if not jobs:
        print("nothing to generate")
        return

    RAW.mkdir(parents=True, exist_ok=True)
    proc = start_comfyui()
    try:
        for sprite, prompt, seed, out in jobs:
            began = time.time()
            if "from" in sprite:
                # A second state starts from the kept image of the sprite it belongs to.
                source = by_id[sprite["from"]]
                reference = f"{source['id']}__{source['keep']}.png"
                shutil.copy(RAW / reference, WORK / "input" / reference)
                flow = edit_workflow(prompt, seed, reference)
            elif sprite.get("plan"):
                # A site with a fixed layout is painted over its block-out (art/plan.py).
                reference = f"{sprite['id']}_plan.png"
                plan.draw_plan(sprite["id"]).save(WORK / "input" / reference)
                flow = edit_workflow(prompt, seed, reference)
            else:
                flow = workflow(prompt, seed, *sprite.get("size", [1024, 1024]))
            shutil.move(render(flow), out)
            print(f"{out.name}  {time.time() - began:.1f}s", flush=True)
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
