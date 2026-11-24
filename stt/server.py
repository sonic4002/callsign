"""The listening service: turns the player's radio call into text, on this machine.

    POST /transcribe?lang=he|en&hints=<what to expect>   -> {"text": "..."}
         body: the recording, 16 kHz mono 16-bit, as a WAV file or as bare samples
    GET  /health                                         -> {"ok": true, ...}

`hints` is text in the language spoken that holds the names and words a call is made of.
Whisper reads it as what was said just before the recording and follows its spelling, so
the page writes it as a few radio calls (client/voice/hints.js).

The game server passes /stt/* on to this service (its -stt flag), so the page talks to one
origin. The service is optional: without it the page recognises speech in the browser.

The models are Whisper on CTranslate2 (faster-whisper), one per language, on the GPU in
half precision, or on the CPU in 8 bits when no GPU can be used. Nothing is downloaded at
run time. A recording is held in memory for the length of its request and never written
to disk or to the log; the log has only its length, its language and the time taken.
"""
import argparse
import asyncio
import io
import json
import pathlib
import threading
import time
import wave

import numpy as np
from aiohttp import web

RATE = 16000
MAX_SECONDS = 15
MAX_BYTES = MAX_SECONDS * RATE * 2
MAX_HINT_CHARS = 600
MAX_WAITING = 4  # requests allowed to queue behind the one being transcribed
QUIET = 0.003  # a recording whose loudest 20 ms is below this (RMS) holds no speech


class Refused(Exception):
    def __init__(self, status, text):
        super().__init__(text)
        self.status = status


def samples(body):
    """The request body as float samples. Refuses anything but 16 kHz mono 16-bit."""
    if body[:4] == b"RIFF":
        try:
            with wave.open(io.BytesIO(body), "rb") as w:
                if (w.getframerate(), w.getnchannels(), w.getsampwidth()) != (RATE, 1, 2):
                    raise Refused(400, "the recording must be 16 kHz mono 16-bit")
                body = w.readframes(w.getnframes())
        except (wave.Error, EOFError):
            raise Refused(400, "the recording is not a WAV file this service reads")
    if len(body) > MAX_BYTES:
        raise Refused(413, f"the recording is longer than {MAX_SECONDS} seconds")
    return np.frombuffer(body[: len(body) & ~1], dtype="<i2").astype(np.float32) / 32768


def loudest(audio, window=RATE // 50):
    """RMS of the loudest 20 ms."""
    n = len(audio) // window
    if n == 0:
        return 0.0
    frames = audio[: n * window].reshape(n, window)
    return float(np.sqrt((frames**2).mean(axis=1)).max())


class Listener:
    """The models, and the one lock they are used under."""

    def __init__(self, dirs, device="auto", cpu_threads=0, precision="float16"):
        from faster_whisper import WhisperModel

        self.lock = threading.Lock()  # one recording at a time
        self.device, self.precision = "cpu", "int8"
        self.models = {}
        if device in ("auto", "cuda"):
            try:
                self.models = {lang: WhisperModel(str(d), device="cuda", compute_type=precision) for lang, d in dirs.items()}
                self.device, self.precision = "cuda", precision
                self.warm()
            except Exception as err:  # no GPU, no driver, or not enough memory on it
                if device == "cuda":
                    raise
                print(f"listening service: the GPU cannot be used ({type(err).__name__}: {err}); using the CPU", flush=True)
                self.models, self.device, self.precision = {}, "cpu", "int8"
        if not self.models:
            self.models = {lang: WhisperModel(str(d), device="cpu", compute_type="int8", cpu_threads=cpu_threads) for lang, d in dirs.items()}
            self.warm()

    def warm(self):
        tone = (0.1 * np.sin(np.arange(RATE) / 20)).astype(np.float32)
        for lang in self.models:
            self.hear(tone, lang)

    def hear(self, audio, lang, hints="", hotwords="", vad=True, beam=5):
        """What was said in `audio` (float samples at 16 kHz), or "" when nothing was.

        `hints` is text holding the words to expect. Whisper writes whole sentences for
        silence and for noise, so three things stand in its way: a level check, a voice
        detector that cuts the recording down to its speech, and Whisper's own no-speech
        score. (`hotwords` is faster-whisper's other way to pass words; it is here to be
        measured against, and the service does not use it.)
        """
        if loudest(audio) < QUIET:
            return ""
        with self.lock:
            segments, _ = self.models[lang].transcribe(
                audio,
                language=lang,
                beam_size=beam,
                temperature=0.0,  # no second tries at a higher temperature: they are where invented text comes from
                condition_on_previous_text=False,
                without_timestamps=True,
                vad_filter=vad,
                vad_parameters={"min_silence_duration_ms": 400, "speech_pad_ms": 200},
                initial_prompt=hints or None,
                hotwords=hotwords or None,
            )
            kept = [s.text.strip() for s in segments if not (s.no_speech_prob > 0.6 and s.avg_logprob < -0.7) and s.avg_logprob > -1.2 and s.compression_ratio < 2.4]
        return " ".join(t for t in kept if t)


def app(listener):
    routes = web.RouteTableDef()
    waiting = 0

    @routes.get("/health")
    async def health(_):
        return web.json_response({"ok": True, "languages": sorted(listener.models), "device": listener.device, "precision": listener.precision, "maxSeconds": MAX_SECONDS})

    @routes.post("/transcribe")
    async def transcribe(request):
        nonlocal waiting
        lang = request.query.get("lang", "")
        if lang not in listener.models:
            raise web.HTTPBadRequest(text="lang must be one of: " + ", ".join(sorted(listener.models)))
        hints = " ".join(request.query.get("hints", "").split())[:MAX_HINT_CHARS]
        try:
            audio = samples(await request.read())
        except Refused as err:
            return web.Response(status=err.status, text=str(err))
        if waiting > MAX_WAITING:
            raise web.HTTPServiceUnavailable(text="busy")
        waiting += 1
        started = time.monotonic()
        try:
            text = await asyncio.get_running_loop().run_in_executor(None, listener.hear, audio, lang, hints)
        finally:
            waiting -= 1
        print(f"heard {len(audio) / RATE:.1f} s {lang} in {round((time.monotonic() - started) * 1000)} ms", flush=True)
        return web.json_response({"text": text}, dumps=lambda v: json.dumps(v, ensure_ascii=False))

    # A little over the limit, so that a recording that is too long gets our own answer.
    a = web.Application(client_max_size=MAX_BYTES + (1 << 16))
    a.add_routes(routes)
    return a


def main():
    root = pathlib.Path(__file__).resolve().parent.parent
    spec = json.loads((root / "stt" / "models.json").read_text())
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=5003)
    p.add_argument("--models", type=pathlib.Path, default=root, help="directory the model paths in models.json start from")
    p.add_argument("--device", choices=["auto", "cuda", "cpu"], default="auto")
    p.add_argument("--cpu-threads", type=int, default=0)
    p.add_argument("--precision", default="float16", help="on the GPU: float16, or int8_float16 for about half the memory")
    args = p.parse_args()
    dirs = {lang: args.models / m["dir"] for lang, m in spec.items()}
    for d in dirs.values():
        if not (d / "model.bin").exists():
            raise SystemExit(f"no model in {d}: run `make stt-models`")
    listener = Listener(dirs, args.device, args.cpu_threads, args.precision)
    print(f"listening service ready on :{args.port}, using {listener.device} ({listener.precision}), languages {', '.join(sorted(dirs))}", flush=True)
    web.run_app(app(listener), port=args.port, print=None, access_log=None)


if __name__ == "__main__":
    main()
