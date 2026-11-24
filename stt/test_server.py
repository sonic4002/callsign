"""What the listening service accepts and refuses, with a stand-in for the models.

Run by `make stt-test`: no models, no GPU and no network are needed. That silence and
noise come back empty through the real models is checked by `make stt-quiet`.
"""
import io
import unittest
import wave

import numpy as np
from aiohttp.test_utils import AioHTTPTestCase

import server


class Stand(server.Listener):
    """A listener without models: it writes down what it was asked, and hears a fixed call."""

    def __init__(self):
        self.models = {"he": None, "en": None}
        self.device, self.precision = "cpu", "int8"
        self.asked = []

    def hear(self, audio, lang, hints=(), **_):
        self.asked.append((len(audio), lang, list(hints)))
        return "" if server.loudest(audio) < server.QUIET else "צפע 1, כאן פטיש, עבור"


def tone(seconds, level=0.2):
    return (level * np.sin(np.arange(int(seconds * server.RATE)) / 9) * 32767).astype("<i2").tobytes()


def wav(pcm, rate=server.RATE, channels=1):
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return out.getvalue()


class Service(AioHTTPTestCase):
    async def get_application(self):
        self.stand = Stand()
        return server.app(self.stand)

    async def post(self, query, body):
        res = await self.client.post("/transcribe?" + query, data=body)
        return res.status, (await res.json() if res.status == 200 else await res.text())

    async def test_a_recording_as_samples_or_as_wav_is_transcribed_with_its_hints(self):
        for body in (tone(2), wav(tone(2))):
            status, answer = await self.post("lang=he&hints=צפע, פסל,,עבור", body)
            self.assertEqual((status, answer), (200, {"text": "צפע 1, כאן פטיש, עבור"}))
        self.assertEqual(self.stand.asked, [(2 * server.RATE, "he", ["צפע", "פסל", "עבור"])] * 2)

    async def test_fifteen_seconds_is_the_longest_recording(self):
        self.assertEqual((await self.post("lang=en", wav(tone(15))))[0], 200)
        for body in (tone(15.1), wav(tone(15.1)), tone(60)):
            self.assertEqual((await self.post("lang=en", body))[0], 413)
        self.assertEqual(len(self.stand.asked), 1)

    async def test_other_languages_and_other_formats_are_refused(self):
        self.assertEqual((await self.post("lang=fr", tone(1)))[0], 400)
        self.assertEqual((await self.post("", tone(1)))[0], 400)
        self.assertEqual((await self.post("lang=he", wav(tone(1), rate=44100)))[0], 400)
        self.assertEqual((await self.post("lang=he", wav(tone(1), channels=2)))[0], 400)
        self.assertEqual((await self.post("lang=he", b"RIFF but not really a file"))[0], 400)
        self.assertEqual(self.stand.asked, [])

    async def test_hints_are_cut_to_a_fixed_length(self):
        await self.post("lang=en&hints=" + ",".join(["Viper"] * 500), tone(1))
        self.assertLessEqual(len(",".join(self.stand.asked[0][2])), server.MAX_HINT_CHARS)

    async def test_health_says_what_is_running(self):
        res = await self.client.get("/health")
        self.assertEqual(await res.json(), {"ok": True, "languages": ["en", "he"], "device": "cpu", "precision": "int8", "maxSeconds": 15})


class Level(unittest.TestCase):
    def test_a_quiet_room_is_below_the_level_of_speech_and_a_voice_is_above(self):
        rng = np.random.default_rng(1)
        self.assertLess(server.loudest(np.zeros(server.RATE, np.float32)), server.QUIET)
        self.assertLess(server.loudest(0.001 * rng.standard_normal(server.RATE).astype(np.float32)), server.QUIET)
        speech = np.zeros(3 * server.RATE, np.float32)
        speech[server.RATE : 2 * server.RATE] = 0.05 * rng.standard_normal(server.RATE)
        self.assertGreater(server.loudest(speech), server.QUIET)

    def test_the_real_listener_returns_nothing_for_a_quiet_room_without_asking_a_model(self):
        listener = server.Listener.__new__(server.Listener)  # no models: touching one would fail
        self.assertEqual(listener.hear(np.zeros(server.RATE, np.float32), "he"), "")


if __name__ == "__main__":
    unittest.main()
