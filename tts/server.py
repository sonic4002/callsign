"""The speech service: turns a radio message into a voice, for testing on this machine.

    GET /say?lang=he|en&voice=<name>&text=<message>   -> audio/wav, mono 16-bit
    GET /health                                      -> {"ok": true, "voices": [...]}

The game server passes /tts/* on to this service, so the page talks to one origin. Every
line is kept in the cache directory under a name made from its language, voice and text:
"Wilco" is synthesized once per voice and served from disk after that.

The model is BlueTTS (BlueV3) on ONNX Runtime, on the CPU. It needs no network at run time.
"""
import argparse
import asyncio
import hashlib
import io
import json
import os
import pathlib
import threading
import time
import wave

import numpy as np
from aiohttp import web
from scipy.signal import resample_poly

from pronounce import fix

# Bump when the model, the pronunciation table or the settings below change, so old audio is not reused.
VERSION = "1"
RATE = 22050  # the radio effect in the page cuts everything above 3.4 kHz anyway
SPEED = 1.08  # radio talk is clipped
MAX_CHARS = 400
CACHE_BYTES = 300 << 20


class Speaker:
    def __init__(self, models):
        from blue_onnx import BlueTTS, load_voice_style, prepare_text_for_synthesis, tag_latin_runs

        self.prepare, self.tag = prepare_text_for_synthesis, tag_latin_runs
        voices = sorted((models / "voices").glob("*.json"))
        if not voices:
            raise SystemExit(f"no voices in {models}/voices: run `make tts-models`")
        self.tts = BlueTTS(onnx_dir=str(models / "onnx"), style_json=str(voices[0]))
        self.styles = {v.stem: load_voice_style([str(v)]) for v in voices}
        self.lock = threading.Lock()  # one line at a time; each already uses several cores

    def say(self, text, lang, voice):
        """Returns the line as WAV bytes."""
        with self.lock:
            prepared = self.prepare(text, lang=lang, mark_slow=False)
            phonemes = self.tts.tts.g2p.phonemize(self.tag(prepared, lang), lang=lang)
            phonemes = fix(text, prepared, phonemes, lang)
            samples, rate = self.tts.synthesize(phonemes, lang=lang, text_is_phonemes=True, style=self.styles[voice], speed=SPEED)
        samples = resample_poly(np.asarray(samples, dtype=np.float32).reshape(-1), RATE, rate)
        pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
        out = io.BytesIO()
        with wave.open(out, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(pcm.tobytes())
        return out.getvalue()


def trim(cache):
    """Drops the least recently used lines once the cache is over its size."""
    files = sorted(cache.glob("*.wav"), key=lambda f: f.stat().st_atime)
    total = sum(f.stat().st_size for f in files)
    for f in files:
        if total <= CACHE_BYTES:
            break
        total -= f.stat().st_size
        f.unlink(missing_ok=True)


def app(speaker, cache):
    routes = web.RouteTableDef()

    @routes.get("/health")
    async def health(_):
        return web.json_response({"ok": True, "voices": sorted(speaker.styles), "languages": ["he", "en"]})

    @routes.get("/say")
    async def say(request):
        q = request.query
        lang, voice, text = q.get("lang", ""), q.get("voice", ""), " ".join(q.get("text", "").split())
        if lang not in ("he", "en"):
            raise web.HTTPBadRequest(text="lang must be he or en")
        if voice not in speaker.styles:
            raise web.HTTPBadRequest(text="unknown voice")
        if not text or len(text) > MAX_CHARS:
            raise web.HTTPBadRequest(text=f"text must be 1 to {MAX_CHARS} characters")
        name = hashlib.sha256(json.dumps([VERSION, lang, voice, text], ensure_ascii=False).encode()).hexdigest()[:32]
        path = cache / f"{name}.wav"
        started = time.monotonic()
        if path.exists():
            data, hit = path.read_bytes(), True
            os.utime(path)
        else:
            data, hit = await asyncio.get_running_loop().run_in_executor(None, speaker.say, text, lang, voice), False
            part = path.with_suffix(f".{os.getpid()}.part")
            part.write_bytes(data)
            part.replace(path)
        print(f"{'cached' if hit else 'spoken'} {round((time.monotonic() - started) * 1000)} ms {lang} {voice}: {text}", flush=True)
        return web.Response(body=data, content_type="audio/wav", headers={"Cache-Control": "public, max-age=86400"})

    a = web.Application()
    a.add_routes(routes)
    return a


def main():
    root = pathlib.Path(__file__).resolve().parent.parent
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=5002)
    p.add_argument("--models", type=pathlib.Path, default=root / "assets" / "models" / "bluev3")
    p.add_argument("--cache", type=pathlib.Path, default=root / "assets" / "voice-cache")
    args = p.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    trim(args.cache)
    speaker = Speaker(args.models)
    for lang, text in (("he", "פטיש, כאן צפע אחת, המתן, סוף."), ("en", "Hammer, this is Viper 1. Stand by. Out.")):
        speaker.say(text, lang, sorted(speaker.styles)[0])  # the first line in a language loads its reader
    print(f"speech service ready on :{args.port}, {len(speaker.styles)} voices", flush=True)
    web.run_app(app(speaker, args.cache), port=args.port, print=None)


if __name__ == "__main__":
    main()
