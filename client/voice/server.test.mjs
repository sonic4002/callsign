// Push-to-talk when the game server transcribes: the recording goes there, and the
// recogniser in the browser is fetched and used only when the server lets the player down.
// The browser's microphone, recorder, audio decoder and worker are played by stand-ins.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { hintCalls, hintWords } from "./hints.js";

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
  }
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
