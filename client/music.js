// Music: one set of tracks for the menus, another for the battle, cross-faded. It reads
// /assets/audio/manifest.json; with no manifest, or no tracks, the page is simply silent.
//
// Tracks are mastered at very different loudness, so each one is levelled from the
// loudness in the manifest toward a common target before the menu/battle balance and
// the player's volume are applied. Browsers refuse audio before the first click or key
// press, so nothing plays until unlock() is called from one.

const TARGET_LUFS = -15;
const BALANCE = { menu: 1, battle: 0.42 }; // the battle sits under the radio
const FADE = 1.4; // seconds

export class Music {
  constructor(base = "/assets/audio/") {
    this.base = base;
    this.tracks = { menu: [], battle: [] };
    this.mode = "off"; // what should be playing: "menu", "battle" or "off"
    this.playing = null; // { mode, track, deck }
    this.queue = { menu: [], battle: [] };
    this.unlocked = false;
    this.volume = Number(localStorage.getItem("callsign.volume") ?? 0.7);
    this.muted = localStorage.getItem("callsign.muted") === "1";
    this.onTrack = () => {};
    this.decks = [];
  }

  async load() {
    try {
      const res = await fetch(`${this.base}manifest.json`);
      if (!res.ok) return this;
      const manifest = await res.json();
      for (const mode of ["menu", "battle"]) this.tracks[mode] = (manifest[mode] ?? []).filter((t) => t.file);
    } catch {
      // No music is not a fault.
    }
    return this;
  }

  get available() {
    return this.tracks.menu.length + this.tracks.battle.length > 0;
  }

  // credits lists every track once, for the attribution the licences ask for.
  get credits() {
    return [...this.tracks.menu, ...this.tracks.battle];
  }

  // unlock must be called from a click or key press. It is safe to call many times.
  unlock() {
    if (this.unlocked || !this.available) return;
    this.unlocked = true;
    const Ctx = window.AudioContext ?? window.webkitAudioContext;
    try {
      this.ctx = Ctx ? new Ctx() : null;
    } catch {
      this.ctx = null;
    }
    if (this.ctx) {
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    this.decks = [0, 1].map(() => {
      const el = new Audio();
      el.preload = "auto";
      const deck = { el, gain: null, level: 1 };
      if (this.ctx) {
        deck.gain = this.ctx.createGain();
        deck.gain.gain.value = 0;
        this.ctx.createMediaElementSource(el).connect(deck.gain).connect(this.master);
      }
      el.addEventListener("ended", () => this.playing?.deck === deck && this.next());
      el.addEventListener("error", () => this.playing?.deck === deck && this.next(true));
      return deck;
    });
    this.applyVolume();
    this.next();
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (this.unlocked) this.next();
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    localStorage.setItem("callsign.volume", String(this.volume));
    this.applyVolume();
  }

  setMuted(muted) {
    this.muted = muted;
    localStorage.setItem("callsign.muted", muted ? "1" : "0");
    this.applyVolume();
  }

  applyVolume() {
    const v = this.muted ? 0 : this.volume;
    if (this.master) this.master.gain.value = v;
    else for (const d of this.decks) d.el.volume = Math.min(1, v * d.level * (d.fade ?? 1));
  }

  // level turns a track's measured loudness into a gain: toward the target, but never
  // boosted so far that its loudest peak would clip.
  static level(track, mode) {
    let db = typeof track.lufs === "number" ? TARGET_LUFS - track.lufs : 0;
    if (typeof track.peakDb === "number") db = Math.min(db, -track.peakDb - 1);
    return Math.pow(10, db / 20) * (BALANCE[mode] ?? 1);
  }

  // pick takes the next track of a mode. The battle list is shuffled; the menu list is
  // walked in order, so two menu tracks alternate rather than one repeating.
  pick(mode) {
    const list = this.tracks[mode];
    if (!list?.length) return null;
    if (!this.queue[mode].length) {
      const order = [...list];
      if (mode === "battle") order.sort(() => Math.random() - 0.5);
      if (order.length > 1 && order[0] === this.playing?.track) order.push(order.shift());
      this.queue[mode] = order;
    }
    return this.queue[mode].shift();
  }

  fade(deck, to) {
    if (deck.gain) {
      const now = this.ctx.currentTime;
      deck.gain.gain.cancelScheduledValues(now);
      deck.gain.gain.setValueAtTime(deck.gain.gain.value, now);
      deck.gain.gain.linearRampToValueAtTime(to, now + FADE);
    } else {
      deck.fade = to > 0 ? 1 : 0;
      this.applyVolume();
    }
    if (to === 0) setTimeout(() => this.playing?.deck !== deck && deck.el.pause(), FADE * 1000 + 50);
  }

  // next starts the next track of the current mode on the idle deck and fades the other out.
  next(afterError = false) {
    const old = this.playing?.deck;
    const track = afterError && this.tracks[this.mode]?.length < 2 ? null : this.pick(this.mode);
    if (old) this.fade(old, 0);
    if (!track) {
      this.playing = null;
      this.onTrack(null);
      return;
    }
    const deck = this.decks.find((d) => d !== old) ?? this.decks[0];
    deck.level = Music.level(track, this.mode);
    deck.el.src = this.base + track.file;
    deck.el.currentTime = 0;
    this.playing = { mode: this.mode, track, deck };
    this.ctx?.resume?.().catch(() => {});
    if (deck.gain) deck.gain.gain.value = 0;
    this.fade(deck, deck.gain ? deck.level : 1);
    deck.el.play().catch(() => {}); // refused autoplay is not an error worth showing
    this.onTrack(track);
  }
}
