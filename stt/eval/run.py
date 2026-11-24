"""Transcribes the test recordings with the listening service's own code and settings.

    node stt/eval/hints.mjs                                           # the hints the page sends
    python stt/eval/run.py --name hints --mode calls                  # the service as it runs
    python stt/eval/run.py --name cpu --device cpu --cpu-threads 4 --mode none --langs he
    python stt/eval/run.py --quiet                                    # what it writes for silence and noise
    python stt/eval/run.py --name live --service http://stt:5003      # ask a running service instead

--mode is how the hints are given: none; list (the words, comma separated); calls (the
words as radio traffic, what the page sends); hotwords (the list, as faster-whisper hotwords).

Writes assets/stt-eval/results/<name>.json: {file: {"text", "ms"}}; score.mjs reads it.
"""
import argparse
import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request
import wave

import numpy as np

root = pathlib.Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(root / "stt"))
from server import RATE, Listener  # noqa: E402


def given(data, mode, lang):
    """The hints for a mode, as hear() takes them."""
    if mode == "none":
        return {}
    text = json.loads((data / "hints.json").read_text())
    return {"hotwords": text["list"][lang]} if mode == "hotwords" else {"hints": text[mode][lang]}


class Remote:
    """A running listening service, asked over HTTP as the game server asks it."""

    def __init__(self, url):
        self.url = url.rstrip("/")
        health = json.load(urllib.request.urlopen(self.url + "/health"))
        self.device, self.precision = health["device"], health["precision"]

    def hear(self, audio, lang, hints="", **_):
        query = urllib.parse.urlencode({"lang": lang, "hints": hints})
        body = (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()
        with urllib.request.urlopen(urllib.request.Request(f"{self.url}/transcribe?{query}", data=body, method="POST")) as res:
            return json.load(res)["text"]


def read(path):
    with wave.open(str(path), "rb") as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768


def quiet(listener, langs, data, vad=True):
    """Recordings with nobody speaking. Every one must come back empty."""
    rng = np.random.default_rng(2)
    n = 5 * RATE
    t = np.arange(n) / RATE
    clicks = np.zeros(n, np.float32)
    clicks[rng.integers(0, n, 40)] = 0.5
    cases = {
        "silence": np.zeros(n, np.float32),
        "faint hiss": 0.002 * rng.standard_normal(n),
        "hiss": 0.02 * rng.standard_normal(n),
        "loud hiss": 0.2 * rng.standard_normal(n),
        "mains hum": 0.1 * np.sin(2 * np.pi * 50 * t) + 0.03 * np.sin(2 * np.pi * 150 * t),
        "fan": np.convolve(0.3 * rng.standard_normal(n), np.ones(200) / 200, mode="same") * 20,
        "key clicks": np.convolve(clicks, np.hanning(64), mode="same") + 0.003 * rng.standard_normal(n),
        "tone": 0.2 * np.sin(2 * np.pi * 440 * t),
        "chord": sum(0.1 * np.sin(2 * np.pi * f * t) * (1 + np.sin(2 * np.pi * 3 * t)) for f in (220, 277, 330)),
    }
    bad = 0
    for lang in langs:
        for name, audio in cases.items():
            for mode in ("none", "calls"):
                text = listener.hear(audio.astype(np.float32), lang, vad=vad, **given(data, mode, lang))
                bad += bool(text)
                print(f"{lang} {name:10} {mode:6} -> {text!r}")
    print("every quiet recording came back empty" if not bad else f"{bad} quiet recordings came back with text")
    return bad


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--name")
    p.add_argument("--mode", default="calls", choices=["none", "list", "calls", "hotwords"])
    p.add_argument("--device", default="auto")
    p.add_argument("--cpu-threads", type=int, default=0)
    p.add_argument("--precision", default="int8_float16")
    p.add_argument("--langs", default="he,en")
    p.add_argument("--kinds", default="clean,noisy")
    p.add_argument("--beam", type=int, default=5)
    p.add_argument("--no-vad", action="store_true")
    p.add_argument("--every", type=int, default=1, help="take only every Nth recording, for slow set-ups")
    p.add_argument("--he", default="assets/models/whisper-he")
    p.add_argument("--en", default="assets/models/whisper-en")
    p.add_argument("--data", type=pathlib.Path, default=root / "assets" / "stt-eval")
    p.add_argument("--quiet", action="store_true")
    p.add_argument("--service", help="address of a running listening service to ask, instead of loading the models here")
    args = p.parse_args()
    langs = args.langs.split(",")
    if args.service:
        listener = Remote(args.service)
    else:
        listener = Listener({lang: root / getattr(args, lang) for lang in langs}, args.device, args.cpu_threads, args.precision)
    print(f"using {listener.device} ({listener.precision})", flush=True)
    if args.quiet:
        sys.exit(1 if quiet(listener, langs, args.data, not args.no_vad) else 0)
    out = {}
    items = [i for i in json.loads((args.data / "index.json").read_text()) if i["lang"] in langs and i["kind"] in args.kinds.split(",")]
    for item in items[:: args.every]:
        audio = read(args.data / item["file"])
        started = time.monotonic()
        text = listener.hear(audio, item["lang"], vad=not args.no_vad, beam=args.beam, **given(args.data, args.mode, item["lang"]))
        out[item["file"]] = {"text": text, "ms": round((time.monotonic() - started) * 1000), "seconds": round(len(audio) / RATE, 2)}
    (args.data / "results").mkdir(exist_ok=True)
    (args.data / "results" / f"{args.name}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    ms = sorted(v["ms"] for v in out.values())
    print(f"{args.name}: {len(out)} recordings, median {ms[len(ms) // 2]} ms, slowest {ms[-1]} ms")


if __name__ == "__main__":
    main()
