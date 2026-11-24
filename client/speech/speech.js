// Radio voices: every message from the player's own stations is spoken aloud.
//
// The voice comes from the speech service behind /tts (see tts/server.py), which answers
// with a clean recording that is then put through the radio effect here. When the service
// is not running, the browser's own speech synthesis is used instead, with only the radio
// clicks around it. Nothing plays before the player's first click or key press.

import { Queue } from "./queue.js";
import { click, transmit } from "./radio.js";
import { filler, speakable, voiceFor } from "./text.js";

const PROBE_EVERY = 30_000; // ms between looks for a service that was not there
const WAIT_FOR_VOICE = 5000; // ms a line may take to arrive before it is skipped
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Speech {
  // volume() gives the player's volume (0..1); duck(on) lowers the music while a voice plays.
  constructor({ base = "/tts", volume = () => 0.7, duck = () => {} } = {}) {
    Object.assign(this, { base, volume, duck });
    this.enabled = localStorage.getItem("callsign.speech") !== "0";
    this.queue = new Queue();
    this.voices = null; // names the service offers, once it has answered
    this.probed = -Infinity;
    this.busy = false;
    this.current = null;
    this.ctx = null;
    for (const kind of ["pointerdown", "keydown"]) addEventListener(kind, () => this.#unlock(), { once: true });
  }

  // bind makes a button the on/off switch.
  bind(button) {
    const show = () => button.classList.toggle("off", !this.enabled);
    button.addEventListener("click", () => {
      this.setEnabled(!this.enabled);
      show();
    });
    show();
  }

  setEnabled(on) {
    this.enabled = on;
    localStorage.setItem("callsign.speech", on ? "1" : "0");
    if (!on) this.silence();
  }

  // silence drops everything waiting and cuts the voice that is playing.
  silence() {
    this.queue.clear();
    this.current?.stop();
    globalThis.speechSynthesis?.cancel();
  }

  // say queues one radio message. The player's own calls are never spoken back.
  say(message, { rules, faction }) {
    if (!this.enabled || !this.ctx || !rules || message.from?.key === "player") return;
    const text = speakable(message, rules);
    if (!text) return;
    const lang = message.lang === "he" ? "he" : "en";
    const voice = voiceFor(message.from, faction, this.voices);
    const abort = new AbortController();
    const line = { station: message.from?.key, filler: filler(message), at: performance.now(), text, lang, voice, cancel: () => abort.abort() };
    // The recording is asked for now, so it is usually here by the time its turn comes.
    line.audio = this.#fetch(line, abort.signal);
    this.queue.push(line);
    this.#pump();
  }

  #unlock() {
    if (this.ctx) return;
    const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    try {
      this.ctx = Ctx ? new Ctx() : null;
    } catch {
      this.ctx = null;
    }
    this.#probe();
  }

  async #probe() {
    this.probed = performance.now();
    try {
      const res = await fetch(`${this.base}/health`);
      const health = res.ok ? await res.json() : null;
      this.voices = health?.ok && health.voices?.length ? health.voices : null;
    } catch {
      this.voices = null;
    }
  }

  async #fetch(line, signal) {
    if (!this.voices) {
      if (performance.now() - this.probed > PROBE_EVERY) this.#probe();
      return null;
    }
    try {
      const query = new URLSearchParams({ lang: line.lang, voice: line.voice.name, text: line.text });
      const res = await fetch(`${this.base}/say?${query}`, { signal });
      if (!res.ok) throw new Error(`speech service answered ${res.status}`);
      return await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      if (!signal.aborted) this.voices = null; // the service went away: fall back, look again later
      return null;
    }
  }

  async #pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let line; (line = this.queue.next(performance.now())); ) {
        const buffer = await Promise.race([line.audio, sleep(WAIT_FOR_VOICE).then(() => null)]);
        if (!this.enabled) break;
        await this.ctx.resume?.().catch(() => {});
        this.duck(true);
        if (buffer) await this.#radio(buffer, line);
        else await this.#browser(line);
      }
    } finally {
      this.busy = false;
      this.current = null;
      this.duck(false);
    }
  }

  // #radio plays a recording through the radio effect and resolves when it is over.
  async #radio(buffer, line) {
    const sent = transmit(this.ctx, buffer, { volume: this.volume(), rate: line.voice.rate });
    let cut;
    this.current = { stop: () => (sent.stop(), cut()) };
    await Promise.race([sleep((sent.end - this.ctx.currentTime) * 1000 + 120), new Promise((resolve) => (cut = resolve))]);
  }

  // #browser is the fallback: the browser's own voice, with the radio clicks around it.
  async #browser(line) {
    const synth = globalThis.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") return;
    const said = new SpeechSynthesisUtterance(line.text);
    said.lang = line.lang === "he" ? "he-IL" : "en-US";
    const mine = synth.getVoices().filter((v) => v.lang?.toLowerCase().startsWith(line.lang));
    if (line.lang === "he" && synth.getVoices().length && mine.length === 0) return; // no Hebrew voice on this device
    let h = 0;
    for (const ch of line.voice.name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    if (mine.length) said.voice = mine[h % mine.length];
    said.pitch = 0.8 + (h % 5) * 0.1;
    said.rate = 1.1 * line.voice.rate;
    said.volume = this.volume();
    const tail = click(this.ctx, this.volume());
    await new Promise((resolve) => {
      this.current = { stop: resolve };
      said.onend = said.onerror = resolve;
      setTimeout(resolve, 20_000);
      synth.speak(said);
    });
    tail();
    await sleep(180);
  }
}
