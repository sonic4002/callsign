// Push-to-talk on the page side: the microphone, the recording, and the worker that
// turns it into text. Nothing leaves the browser.
//
// States, reported through onState(state, detail):
//   idle | asking (for the microphone) | loading { percent } | listening | working
//   and the ways it can stop: unsupported | insecure | denied | missing | nothing | failed

const RATE = 16000;
const MIN_SECONDS = 0.4;

export class Voice {
  constructor({ onState = () => {} } = {}) {
    this.onState = onState;
    this.supported = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder && window.Worker && (window.AudioContext || window.webkitAudioContext));
    this.worker = null;
    this.stream = null;
    this.recorder = null;
    this.ready = new Set(); // languages whose model is loaded
    this.pending = new Map(); // utterance id → { resolve, reject }
    this.nextId = 1;
    this.held = false;
  }

  #worker() {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL("worker.js", import.meta.url), { type: "module" });
    this.worker.addEventListener("message", ({ data }) => {
      if (data.type === "progress" && !this.recorder) this.onState("loading", { percent: Math.floor((100 * data.loaded) / data.total) });
      else if (data.type === "ready") {
        this.ready.add(data.lang);
        if (this.pending.size > 0) this.onState("working");
      }
      else if (data.type === "result") this.pending.get(data.id)?.resolve(data.text);
      else if (data.type === "missing" || data.type === "error") {
        const err = Object.assign(new Error(data.message ?? "missing"), { state: data.type === "missing" ? "missing" : "failed" });
        if (data.id) this.pending.get(data.id)?.reject(err);
        else if (!this.recorder) this.onState(err.state, { message: err.message });
      }
    });
    this.worker.addEventListener("error", (ev) => {
      for (const p of this.pending.values()) p.reject(Object.assign(new Error(ev.message), { state: "failed" }));
    });
    return this.worker;
  }

  // start begins recording; the model for `lang` starts loading at the same moment.
  async start(lang) {
    // Browsers hand out the microphone only on https or localhost: a phone that opened the
    // game by its LAN address over plain http can do everything except talk.
    if (globalThis.isSecureContext === false) return this.onState("insecure");
    if (!this.supported) return this.onState("unsupported");
    if (this.held) return;
    this.held = true;
    this.#worker().postMessage({ type: "load", lang });
    try {
      if (!this.stream?.active) {
        this.onState("asking");
        // Plain audio: the music is muted while talking, and the recognisers cope with
        // room noise better than with a noise filter's artefacts.
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
      }
    } catch (err) {
      this.held = false;
      return this.onState(err.name === "NotAllowedError" || err.name === "SecurityError" ? "denied" : "failed", { message: err.message });
    }
    if (!this.held) return this.onState("idle"); // released while the browser was asking
    const chunks = [];
    const recorder = new MediaRecorder(this.stream);
    recorder.addEventListener("dataavailable", (ev) => chunks.push(ev.data));
    recorder.done = new Promise((resolve) => recorder.addEventListener("stop", () => resolve(new Blob(chunks, { type: recorder.mimeType }))));
    recorder.start();
    this.recorder = recorder;
    this.onState("listening");
  }

  // stop ends the recording and resolves with what was said ("" when nothing was).
  // `openers` are the callsigns a call can start with; the recogniser listens for them.
  async stop(lang, openers = []) {
    this.held = false;
    const recorder = this.recorder;
    if (!recorder) return "";
    this.recorder = null;
    recorder.stop();
    try {
      const audio = await this.#samples(await recorder.done);
      if (audio.length < MIN_SECONDS * RATE || !audio.some((v) => Math.abs(v) > 0.01)) {
        this.onState("nothing");
        return "";
      }
      this.onState(this.ready.has(lang) ? "working" : "loading", { percent: 0 });
      const id = this.nextId++;
      const text = await new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.worker.postMessage({ type: "transcribe", id, lang, audio, openers }, [audio.buffer]);
      }).finally(() => this.pending.delete(id));
      this.onState(text ? "idle" : "nothing");
      return text;
    } catch (err) {
      this.onState(err.state ?? "failed", { message: err.message });
      return "";
    }
  }

  // samples decodes a recording and resamples it to 16 kHz mono.
  async #samples(blob) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    try {
      const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
      const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * RATE)), RATE);
      const src = offline.createBufferSource();
      src.buffer = decoded;
      src.connect(offline.destination);
      src.start();
      return (await offline.startRendering()).getChannelData(0).slice();
    } finally {
      ctx.close();
    }
  }
}
