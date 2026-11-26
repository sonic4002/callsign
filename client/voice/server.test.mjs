// Push-to-talk when the game server transcribes: the recording goes there, and the
// recogniser in the browser is fetched and used only when the server lets the player down.
// And push-to-talk without one, where a browser with audio worklets hands the recording
// to the recogniser while it is being made.
// The browser's microphone, recorder, audio decoder and worker are played by stand-ins.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { hintCalls, hintWords } from "./hints.js";
import { Resampler } from "./resample.js";

let audio = new Float32Array(0); // what the next recording decodes to
const workers = [];
let calls = []; // requests to the server
let answer = async () => ({ ok: true, status: 200, json: async () => ({ text: "from the server" }) });

class Recorder extends EventTarget {
  state = "inactive";
  mimeType = "audio/webm";
  start() {
    this.state = "recording";
  }
  stop() {
    assert.equal(this.state, "recording", "a recorder is stopped once");
    this.state = "inactive";
    this.dispatchEvent(Object.assign(new Event("dataavailable"), { data: new Blob(["x"]) }));
    this.dispatchEvent(new Event("stop"));
  }
}
class FakeWorker {
  listeners = {};
  posted = [];
  constructor() {
    workers.push(this);
  }
  addEventListener(kind, fn) {
    this.listeners[kind] = fn;
  }
  postMessage(m) {
    this.posted.push(m);
    if (m.type === "transcribe") queueMicrotask(() => this.listeners.message({ data: { type: "result", id: m.id, text: "from the browser" } }));
    if (m.type === "end") queueMicrotask(() => this.listeners.message({ data: { type: "result", id: m.id, text: "from the browser, heard live" } }));
  }
}
// A browser with audio worklets: the context runs at 48 kHz and its tap node is fed by the test.
const taps = [];
class LiveCtx {
  state = "running";
  close() {}
  sampleRate = 48000;
  destination = {};
  audioWorklet = { addModule: async () => {} };
  createMediaStreamSource = () => ({ connect() {}, disconnect() {} });
  createGain = () => ({ gain: {}, connect() {} });
}
class TapNode {
  told = [];
  port = {
    postMessage: (m) => {
      this.told.push(m);
      if (m === "flush") queueMicrotask(() => this.port.onmessage({ data: "flushed" }));
    },
  };
  constructor() {
    taps.push(this);
  }
  connect() {}
  // hear plays `seconds` of microphone audio into the tap, a tenth of a second at a time.
  hear(seconds, level = 0.5) {
    for (let i = 0; i < seconds * 10; i++) this.port.onmessage({ data: Float32Array.from({ length: 4800 }, (_, j) => level * Math.sin(j / 15)) });
  }
}
function withWorklets(t) {
  const before = window.AudioContext;
  Object.assign(window, { AudioContext: LiveCtx, AudioWorkletNode: TapNode });
  taps.length = 0;
  t.after(() => {
    window.AudioContext = before;
    delete window.AudioWorkletNode;
  });
}
class Ctx {
  decodeAudioData = async () => ({ duration: audio.length / 16000 });
  close() {}
}
class Offline {
  destination = {};
  createBufferSource = () => ({ connect() {}, start() {} });
  startRendering = async () => ({ getChannelData: () => audio });
}
globalThis.window = { MediaRecorder: Recorder, Worker: FakeWorker, AudioContext: Ctx };
Object.assign(globalThis, { MediaRecorder: Recorder, Worker: FakeWorker, OfflineAudioContext: Offline });
Object.defineProperty(globalThis, "navigator", { value: { mediaDevices: { getUserMedia: async () => ({ active: true }) } }, configurable: true });
globalThis.fetch = async (url, options) => {
  calls.push({ url: new URL(url, "http://game"), options });
  return answer(options);
};
console.warn = () => {}; // the fallback says why; not in the test output

const { Voice } = await import("./voice.js");

const speech = (seconds) => Float32Array.from({ length: seconds * 16000 }, (_, i) => 0.5 * Math.sin(i / 5));
function fresh(remote = true) {
  workers.length = 0;
  calls = [];
  const states = [];
  const voice = new Voice({ onState: (s) => states.push(s) });
  if (remote) voice.useServer(() => ({ room: "ABCDEF", side: 1, token: "seat-token" }));
  return { voice, states };
}
async function speak(voice, seconds, lang = "he", hints = "צפע 1, כאן פטיש, נועו לפסל, עבור.") {
  audio = speech(seconds);
  await voice.start(lang);
  return voice.stop(lang, ["צפע"], hints);
}

test("without a server everything is as before: the model is fetched ahead and used", async () => {
  const { voice, states } = fresh(false);
  assert.equal(voice.remote, false);
  voice.prepare("he");
  assert.deepEqual(workers[0].posted, [{ type: "load", lang: "he" }]);
  assert.equal(await speak(voice, 2), "from the browser");
  assert.equal(calls.length, 0, "nothing is sent anywhere");
  assert.deepEqual(workers[0].posted.map((m) => m.type), ["load", "load", "transcribe"]);
  assert.deepEqual(states, ["asking", "listening", "loading", "idle"]);
});

test("with a server the recording goes there with the seat and the hints, and no model is fetched", async () => {
  const { voice, states } = fresh();
  voice.prepare("he");
  assert.equal(await speak(voice, 2), "from the server");
  assert.equal(workers.length, 0, "the browser's recogniser is not even started");
  const { url, options } = calls[0];
  assert.equal(url.pathname, "/stt/transcribe");
  assert.deepEqual(Object.fromEntries(url.searchParams), { room: "ABCDEF", side: "1", lang: "he", hints: "צפע 1, כאן פטיש, נועו לפסל, עבור." });
  assert.equal(options.method, "POST");
  assert.equal(options.headers["X-Callsign-Seat"], "seat-token");
  assert.ok(options.body instanceof Int16Array && options.body.length === 2 * 16000 && options.body.some((v) => Math.abs(v) > 10000), "16-bit samples at 16 kHz");
  assert.deepEqual(states, ["asking", "listening", "working", "idle"]);
  assert.equal(voice.held, false);
  assert.equal(voice.heardBy, "server");
});

test("what the server calls silence is nothing, and is not tried again in the browser", async () => {
  const { voice, states } = fresh();
  answer = async () => ({ ok: true, status: 200, json: async () => ({ text: "" }) });
  assert.equal(await speak(voice, 2), "");
  assert.equal(states.at(-1), "nothing");
  assert.equal(workers.length, 0);
});

test("a server that fails is replaced by the browser's recogniser, and left alone for a minute", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const { voice, states } = fresh();
  answer = async () => ({ ok: false, status: 502, json: async () => ({}) });
  assert.equal(await speak(voice, 2), "from the browser");
  assert.deepEqual(workers[0].posted.map((m) => m.type), ["transcribe"]);
  assert.deepEqual(states, ["asking", "listening", "working", "loading", "idle"]);
  assert.equal(voice.heardBy, "browser");
  assert.equal(await speak(voice, 2), "from the browser");
  assert.equal(calls.length, 1, "the next call does not wait for the server again");
  t.mock.timers.tick(61000);
  answer = async () => ({ ok: true, status: 200, json: async () => ({ text: "from the server" }) });
  assert.equal(await speak(voice, 2), "from the server");
});

test("a server that takes more than six seconds is given up on", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const { voice } = fresh();
  answer = ({ signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  audio = speech(2);
  await voice.start("en");
  const said = voice.stop("en", [], "");
  for (let i = 0; i < 20 && calls.length === 0; i++) await new Promise((r) => setImmediate(r));
  t.mock.timers.tick(5900);
  assert.equal(workers.length, 0, "still waiting");
  t.mock.timers.tick(200);
  assert.equal(await said, "from the browser");
});

test("being told to slow down falls back once, without leaving the server alone", async () => {
  const { voice } = fresh();
  answer = async () => ({ ok: false, status: 429, json: async () => ({}) });
  assert.equal(await speak(voice, 2), "from the browser");
  answer = async () => ({ ok: true, status: 200, json: async () => ({ text: "from the server" }) });
  assert.equal(await speak(voice, 2), "from the server");
});

test("a page that holds no seat recognises in the browser", async () => {
  const { voice } = fresh(false);
  voice.useServer(() => null); // a spectator, or a seat that was lost
  assert.equal(await speak(voice, 2), "from the browser");
  assert.equal(calls.length, 0);
});

test("a recording ends at fifteen seconds even with the button held, and is cut to that", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  workers.length = 0;
  calls = [];
  let limits = 0;
  const voice = new Voice({ onLimit: () => limits++ });
  voice.useServer(() => ({ room: "ABCDEF", side: 0, token: "t" }));
  audio = speech(16);
  await voice.start("he");
  const recorder = voice.recorder;
  t.mock.timers.tick(14900);
  assert.equal(recorder.state, "recording");
  t.mock.timers.tick(200);
  assert.equal(recorder.state, "inactive", "the recording has ended");
  assert.equal(limits, 1, "and the page is told to send it");
  assert.equal(await voice.stop("he"), "from the server"); // what the page does on onLimit, or on release
  assert.equal(calls[0].options.body.length, 15 * 16000);
  // Letting go before the limit ends it at once, and the limit never fires afterwards.
  audio = speech(2);
  await voice.start("he");
  await voice.stop("he");
  t.mock.timers.tick(20000);
  assert.equal(limits, 1);
});

test("with audio worklets and no server, a call is handed to the worker while it is spoken", async (t) => {
  withWorklets(t);
  const { voice, states } = fresh(false);
  const details = [];
  voice.onState = (s, d) => (states.push(s), details.push(d));
  await voice.start("he", { phrases: ["צפע", "כרמל"] });
  const [tap] = taps;
  assert.deepEqual(tap.told, ["on"]);
  tap.hear(2);
  const posted = workers[0].posted;
  assert.deepEqual(posted.slice(0, 2), [{ type: "load", lang: "he" }, { type: "begin", id: 1, lang: "he", phrases: ["צפע", "כרמל"] }]);
  const sent = posted.filter((m) => m.type === "audio");
  assert.ok(sent.length >= 19 && sent.every((m) => m.id === 1 && m.samples.length >= 1500 && m.samples.length <= 1700), "about a tenth of a second at 16 kHz each");
  // What the worker has written so far is shown while the button is held.
  workers[0].listeners.message({ data: { type: "partial", id: 1, text: "צפע אחת" } });
  assert.deepEqual([states.at(-1), details.at(-1)], ["listening", { text: "צפע אחת" }]);
  assert.equal(await voice.stop("he", ["צפע"]), "from the browser, heard live");
  assert.deepEqual(tap.told, ["on", "flush"]);
  assert.deepEqual(posted.at(-1), { type: "end", id: 1, openers: ["צפע"] });
  assert.ok(!posted.some((m) => m.type === "transcribe"), "the recording is not sent a second time");
  assert.equal(states.at(-1), "idle");
  // The next call uses the same tap, and a new recording in the worker.
  await voice.start("he");
  taps[0].hear(1);
  await voice.stop("he");
  assert.equal(taps.length, 1);
  assert.equal(posted.at(-1).id, 2);
});

test("a live recording that holds no speech is dropped in the worker too", async (t) => {
  withWorklets(t);
  const { voice, states } = fresh(false);
  await voice.start("he");
  taps[0].hear(2, 0.001);
  assert.equal(await voice.stop("he"), "");
  assert.equal(states.at(-1), "nothing");
  assert.deepEqual(workers[0].posted.at(-1), { type: "cancel", id: 1 });
});

test("with a server the live recording goes there whole, and the worker hears nothing", async (t) => {
  withWorklets(t);
  const { voice } = fresh();
  answer = async () => ({ ok: true, status: 200, json: async () => ({ text: "from the server" }) });
  await voice.start("he", { phrases: ["צפע"] });
  taps[0].hear(2);
  assert.equal(await voice.stop("he", [], "hints"), "from the server");
  assert.equal(workers.length, 0);
  const sent = calls[0].options.body;
  assert.ok(sent instanceof Int16Array && Math.abs(sent.length - 2 * 16000) < 200 && sent.some((v) => Math.abs(v) > 10000), `${sent.length} samples at 16 kHz`);
  // And when the server lets the player down, the browser recognises the kept recording.
  answer = async () => ({ ok: false, status: 502, json: async () => ({}) });
  voice.restUntil = 0;
  await voice.start("he", { phrases: ["צפע"] });
  taps[0].hear(2);
  assert.equal(await voice.stop("he", ["צפע"], "hints"), "from the browser");
  const m = workers[0].posted.at(-1);
  assert.deepEqual([m.type, m.phrases, m.openers], ["transcribe", ["צפע"], ["צפע"]]);
});

test("the model is not fetched ahead on mobile data or when the browser is saving data", () => {
  for (const connection of [{ type: "cellular" }, { saveData: true }]) {
    const { voice } = fresh(false);
    navigator.connection = connection;
    voice.prepare("he");
    assert.equal(workers.length, 0, JSON.stringify(connection));
    delete navigator.connection;
    voice.prepare("he");
    assert.equal(workers.length, 1);
  }
});

test("resampler: speech passes, what 16 kHz cannot carry is removed, pieces join up", () => {
  const tone = (hz, rate, n) => Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate));
  const loud = (x) => Math.sqrt(x.subarray(200).reduce((a, v) => a + v * v, 0) / (x.length - 200)) * Math.SQRT2;
  for (const rate of [48000, 44100]) {
    const speech = new Resampler(rate).push(tone(1000, rate, rate));
    assert.ok(Math.abs(speech.length - 16000) < 40, `${speech.length} samples from a second at ${rate}`);
    assert.ok(Math.abs(loud(speech) - 1) < 0.02, `a 1 kHz tone keeps its level at ${rate}: ${loud(speech)}`);
    assert.ok(loud(new Resampler(rate).push(tone(11000, rate, rate))) < 0.02, "an 11 kHz tone is gone");
    const whole = new Resampler(rate).push(tone(440, rate, rate));
    const r = new Resampler(rate);
    const parts = [];
    for (let i = 0; i < rate; i += 1000) parts.push(...r.push(tone(440, rate, rate).subarray(i, i + 1000)));
    assert.equal(parts.length, whole.length);
    assert.ok(parts.every((v, i) => Math.abs(v - whole[i]) < 1e-6));
  }
  assert.deepEqual([...new Resampler(16000).push(Float32Array.of(0.5, -0.5))], [0.5, -0.5]);
});

test("hints are the net's own words in the language spoken", () => {
  const rules = JSON.parse(readFileSync(new URL("../../shared/rules.json", import.meta.url)));
  rules.map = rules.maps.small;
  const he = hintWords(rules, "he");
  for (const w of ["פטיש", "סדן", "צפע", "קרנף", "בז", "כריש", "כל התחנות", "פסל", "כרמל", "כאן", "עבור", "סוף", "רות", "אמור שנית"]) assert.ok(he.includes(w), w);
  const en = hintWords(rules, "en");
  for (const w of ["Hammer", "Anvil", "Viper", "Foxtrot", "this is", "Over", "Out", "roger", "say again"]) assert.ok(en.includes(w), w);
  assert.ok(!en.some((w) => /[֐-׿]/.test(w)) && new Set(he).size === he.length);
  // As traffic: every name is in it, written as the page writes calls, and it fits in what the service reads.
  for (const map of Object.values(rules.maps)) {
    for (const lang of ["he", "en"]) {
      const text = hintCalls({ ...rules, map }, lang);
      const names = [...Object.values(rules.callsigns.classes), rules.callsigns.operator, rules.callsigns.player, rules.callsigns.allStations, ...map.points.map((p) => p.callsign)];
      for (const n of names) assert.ok(text.includes(n[lang]), `${n[lang]} in ${text}`);
      assert.ok(text.length < 600, `${text.length} characters`);
    }
  }
  assert.match(hintCalls(rules, "en"), /^Viper 1, this is Hammer\. Move to Alpha\. Over\. /);
  assert.match(hintCalls(rules, "he"), /^צפע 1, כאן פטיש, נועו לאלף, עבור\. /);
});
