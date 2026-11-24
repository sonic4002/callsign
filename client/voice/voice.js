// Push-to-talk on the page side: the microphone, the recording, and what turns it into
// text. That is the game server when it has a listening service (useServer): the
// recording is sent there, transcribed and not kept. Without one, or when it does not
// answer in time, it is the worker in this browser, and then nothing leaves the browser.
//
// States, reported through onState(state, detail):
//   idle | asking (for the microphone) | loading { percent } | listening | working
//   and the ways it can stop: unsupported | insecure | denied | missing | nothing | failed

const RATE = 16000;
const MIN_SECONDS = 0.4;
const MAX_SECONDS = 15; // a call runs 4 to 6 seconds; the server takes no more than this
const SERVER_WAIT = 6000; // ms to wait for the server before recognising here instead
const SERVER_REST = 60000; // ms the server is left alone after it failed

export class Voice {
  // onLimit is called when a recording reaches MAX_SECONDS and has been ended; the page
  // then calls stop() as if the button had been released.
  constructor({ onState = () => {}, onLimit = () => {} } = {}) {
    this.onState = onState;
    this.onLimit = onLimit;
    this.seat = null; // set by useServer
    this.heardBy = ""; // who transcribed the last recording: "server" or "browser"
    this.restUntil = 0;
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
        else if (!this.recorder && !this.held) this.onState("idle"); // fetched ahead of need
        this.preparing = false;
      }
      else if (data.type === "result") this.pending.get(data.id)?.resolve(data.text);
      else if (data.type === "missing" || data.type === "error") {
        const err = Object.assign(new Error(data.message ?? "missing"), { state: data.type === "missing" ? "missing" : "failed" });
        if (data.id) this.pending.get(data.id)?.reject(err);
        else if (this.preparing) this.onState("idle"); // fetching ahead failed quietly; the mic will say why
        else if (!this.recorder) this.onState(err.state, { message: err.message });
        this.preparing = false;
      }
    });
    this.worker.addEventListener("error", (ev) => {
      for (const p of this.pending.values()) p.reject(Object.assign(new Error(ev.message), { state: "failed" }));
    });
    return this.worker;
  }

  // useServer says that the game server transcribes (its /api/server offered "stt").
  // seat() returns the seat this page holds, { room, side, token }, or null when it holds
  // none. The models for this browser are then fetched only if the server lets us down.
  useServer(seat) {
    this.seat = seat;
  }

  get remote() {
    return Boolean(this.seat);
  }

  // prepare fetches the model for `lang` ahead of need (in the lobby, before the match),
  // so the first press of the talk button does not wait for a download. It asks for no
  // microphone and says nothing when it cannot be done here. With a server that
  // transcribes there is nothing to fetch: the models are large for a phone.
  prepare(lang) {
    if (this.remote) return;
    if (globalThis.isSecureContext === false || !this.supported || this.ready.has(lang) || this.held) return;
    if (navigator.connection?.saveData) return; // the player asked their browser to save data
    this.preparing = true;
    this.#worker().postMessage({ type: "load", lang });
  }

  // start begins recording; without a server the model for `lang` starts loading at the
  // same moment.
  async start(lang) {
    // Browsers hand out the microphone only on https or localhost: a phone that opened the
    // game by its LAN address over plain http can do everything except talk.
    if (globalThis.isSecureContext === false) return this.onState("insecure");
    if (!this.supported) return this.onState("unsupported");
    if (this.held) return;
    this.held = true;
    if (!this.remote) this.#worker().postMessage({ type: "load", lang });
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
    clearTimeout(this.limit);
    this.limit = setTimeout(() => {
      if (this.recorder !== recorder) return;
      if (recorder.state !== "inactive") recorder.stop(); // the recording ends here whatever the page does
      this.onLimit();
    }, MAX_SECONDS * 1000);
  }

  // stop ends the recording and resolves with what was said ("" when nothing was).
  // `openers` are the callsigns a call can start with; the recogniser in this browser
  // listens for them. `hints` is the radio net's vocabulary as text (hints.js), for the server.
  async stop(lang, openers = [], hints = "") {
    this.held = false;
    clearTimeout(this.limit);
    const recorder = this.recorder;
    if (!recorder) return "";
    this.recorder = null;
    if (recorder.state !== "inactive") recorder.stop();
    try {
      const audio = (await this.#samples(await recorder.done)).subarray(0, MAX_SECONDS * RATE);
      if (audio.length < MIN_SECONDS * RATE || !audio.some((v) => Math.abs(v) > 0.01)) {
        this.onState("nothing");
        return "";
      }
      const seat = this.remote && Date.now() >= this.restUntil ? this.seat() : null;
      if (seat) {
        this.onState("working");
        try {
          const text = await this.#ask(seat, audio, lang, hints);
          this.heardBy = "server";
          this.onState(text ? "idle" : "nothing");
          return text;
        } catch (err) {
          // Down, slow or refusing: recognise here, and do not make the next calls wait for it.
          console.warn("the server did not transcribe; recognising in this browser", err);
          if (err.status !== 429) this.restUntil = Date.now() + SERVER_REST;
        }
      }
      this.heardBy = "browser";
      this.onState(this.ready.has(lang) ? "working" : "loading", { percent: 0 });
      const id = this.nextId++;
      const text = await new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.#worker().postMessage({ type: "transcribe", id, lang, audio, openers }, [audio.buffer]);
      }).finally(() => this.pending.delete(id));
      this.onState(text ? "idle" : "nothing");
      return text;
    } catch (err) {
      this.onState(err.state ?? "failed", { message: err.message });
      return "";
    }
  }

  // ask sends the recording to the game server as 16-bit samples and resolves with its
  // text. It rejects when the server refuses, fails or takes longer than SERVER_WAIT.
  async #ask(seat, audio, lang, hints) {
    const pcm = new Int16Array(audio.length);
    for (let i = 0; i < audio.length; i++) pcm[i] = Math.max(-1, Math.min(1, audio[i])) * 32767;
    const query = new URLSearchParams({ room: seat.room ?? "", side: seat.side, lang, hints });
    const gone = new AbortController();
    const timer = setTimeout(() => gone.abort(), SERVER_WAIT);
    try {
      const res = await fetch(`/stt/transcribe?${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-Callsign-Seat": seat.token ?? "" },
        body: pcm,
        signal: gone.signal,
      });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      const { text } = await res.json();
      return typeof text === "string" ? text.trim() : "";
    } finally {
      clearTimeout(timer);
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
