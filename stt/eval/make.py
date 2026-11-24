"""Makes the test recordings for stt/eval: every call in calls.json, spoken by the game's
own speech service in three voices, clean and again under room noise.

    python stt/eval/make.py [--tts http://127.0.0.1:8080/tts] [--out assets/stt-eval]

These are synthetic voices reading clean text: an easy test. Real players mumble, have
accents and bad microphones. Read the scores as an upper bound.
"""
import argparse
import io
import json
import pathlib
import urllib.parse
import urllib.request
import wave

import numpy as np

RATE = 16000
VOICES = {"he": ["daniel", "noa", "david"], "en": ["michael", "emma", "ethan"]}
SNR_DB = 10


def save(path, audio):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())


def resampled(wav):
    """A mono 16-bit WAV file's samples at 16 kHz: low-passed, then read off by interpolation."""
    with wave.open(io.BytesIO(wav), "rb") as w:
        rate = w.getframerate()
        audio = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768
    taps = np.arange(-64, 65)
    low = np.sinc(taps * 2 * 7500 / rate) * (2 * 7500 / rate) * np.hamming(len(taps))
    audio = np.convolve(audio, low, mode="same")
    at = np.arange(int(len(audio) * RATE / rate)) * rate / RATE
    return np.interp(at, np.arange(len(audio)), audio).astype(np.float32)


def noisy(audio, rng):
    """The same recording in a room: low rumble plus hiss, 10 dB under the speech."""
    white = rng.standard_normal(len(audio) + RATE)
    rumble = np.convolve(white, np.ones(64) / 64, mode="same")
    noise = (0.7 * rumble / rumble.std() + 0.3 * white / white.std())[: len(audio)]
    speech = np.sqrt((audio**2).mean())
    return audio + noise * speech / (10 ** (SNR_DB / 20)) / noise.std()


def main():
    here = pathlib.Path(__file__).resolve().parent
    p = argparse.ArgumentParser()
    p.add_argument("--tts", default="http://127.0.0.1:8080/tts")
    p.add_argument("--out", type=pathlib.Path, default=here.parent.parent / "assets" / "stt-eval")
    args = p.parse_args()
    calls = json.loads((here / "calls.json").read_text())
    rng = np.random.default_rng(1)
    index = []
    for lang, texts in calls.items():
        for n, text in enumerate(texts):
            for voice in VOICES[lang]:
                for kind in ("clean", "noisy"):
                    name = f"{lang}-{n:02d}-{voice}-{kind}.wav"
                    index.append({"file": name, "lang": lang, "voice": voice, "kind": kind, "text": text})
                    if (args.out / name).exists():
                        continue
                    args.out.mkdir(parents=True, exist_ok=True)
                    q = urllib.parse.urlencode({"lang": lang, "voice": voice, "text": text})
                    with urllib.request.urlopen(f"{args.tts}/say?{q}") as res:
                        audio = resampled(res.read())
                    # Half a second of quiet either side, as when a button is held.
                    audio = np.concatenate([np.zeros(RATE // 2, np.float32), audio, np.zeros(RATE // 2, np.float32)])
                    save(args.out / name, audio if kind == "clean" else noisy(audio, rng))
    (args.out / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1))
    print(f"{len(index)} recordings in {args.out}")


if __name__ == "__main__":
    main()
