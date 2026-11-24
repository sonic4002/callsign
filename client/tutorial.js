// The first lesson's coach: one short line at a time over a real match, a ring or a glow
// on the thing to use, and on to the next line when the player has done it. What the
// steps are and when each is over is in lesson.js; this file only shows them.
//
// The lesson is remembered by this browser: which room it runs in and how far it got, so
// a reload picks it up where it was; and that it was finished or left, so the start
// screen stops pressing it on a player who has seen it.

import { STEPS, advance, canGoOn, nearest, released } from "./lesson.js";

const $ = (id) => document.getElementById(id);
const KEPT = "callsign.lesson"; // { room, step } of the lesson under way
const SEEN = "callsign.lesson.seen"; // set once a lesson was finished or left

const kept = () => {
  try {
    return JSON.parse(localStorage.getItem(KEPT)) ?? null;
  } catch {
    return null;
  }
};

// seen says whether this browser has been through the lesson, or chose to leave it.
export const seen = () => localStorage.getItem(SEEN) === "1";

export class Coach {
  // t(key, vars) translates. touch() says whether fingers are in use. scene is the map.
  // send(frame) reaches the game server. context() gives what lesson.js looks at, plus
  // `me` (the player's station) and `lang`. leave() goes back to the start screen.
  constructor({ t, touch, scene, send, context, leave }) {
    Object.assign(this, { t, touch, scene, send, context, leave });
    this.room = "";
    this.index = 0;
    this.active = false;
    this.told = false; // the server has been told to release the enemy, on this connection
    $("coach-next").addEventListener("click", () => this.#go({ next: true }));
    $("coach-skip").addEventListener("click", () => this.#go({ skip: true }));
    $("coach-leave").addEventListener("click", () => this.stop());
    $("coach-stay").addEventListener("click", () => this.stop());
    $("coach-real").addEventListener("click", () => {
      this.stop();
      this.leave();
    });
  }

  // enter is called with every greeting from the server: `lesson` says whether the room
  // is a lesson. A lesson this browser was already in goes on from where it was.
  enter(room, lesson) {
    const was = kept();
    this.told = false;
    this.active = Boolean(lesson) && (was?.room !== room || was.step < STEPS.length);
    this.room = room;
    this.index = this.active && was?.room === room ? was.step : 0;
    if (this.active) localStorage.setItem(KEPT, JSON.stringify({ room, step: this.index }));
    this.update();
  }

  // stop ends the lesson for good: the match goes on, the coach is gone.
  stop() {
    if (this.active) localStorage.setItem(KEPT, JSON.stringify({ room: this.room, step: STEPS.length }));
    localStorage.setItem(SEEN, "1");
    this.active = false;
    this.render();
  }

  // update looks at the match again and moves on if the step is done.
  update() {
    if (!this.active) return this.render();
    this.#go();
  }

  #go(how) {
    const c = this.context();
    if (!c.state || !c.rules) return this.render();
    const next = advance(this.index, this.#with(c), how);
    if (next !== this.index) {
      this.index = next;
      localStorage.setItem(KEPT, JSON.stringify({ room: this.room, step: next }));
    }
    if (next >= STEPS.length) return this.stop();
    // From the step that buys a squad on, the lesson's enemy is let go.
    if (released(next) && !this.told) this.told = this.send({ type: "lesson" });
    this.render(c);
  }

  // #with adds what the steps need to know about this map: the point of the home gold field.
  #with(c) {
    return { ...c, rig: nearest(c.rules, c.side, "landRig") };
  }

  render(c = this.context()) {
    const card = $("coach");
    const step = this.active ? STEPS[this.index] : null;
    for (const lit of document.querySelectorAll(".coach-target")) lit.classList.remove("coach-target");
    document.body.classList.toggle("in-lesson", Boolean(step));
    if (!step || !c.state || !c.rules || !c.me) {
      card.hidden = true;
      this.scene.coach = null;
      this.#room(0);
      return;
    }
    card.hidden = false;
    // A new step that happens on the map puts away a sheet left open by the one before.
    if (this.shown !== step.id && !step.tab) document.querySelector('#dock [aria-pressed="true"]')?.click();
    // A step in the build panel turns it to the half it is about.
    if (this.shown !== step.id && step.pane) document.querySelector(`[data-build-tab="${step.pane}"][aria-selected="false"]`)?.click();
    this.shown = step.id;
    const vars = this.#names(this.#with(c));
    const fingers = this.touch() && step.touch;
    $("coach-text").textContent = fingers ? this.t(`tutTouch.${step.id}`, vars) : this.t(`tut.${step.id}`, vars);
    $("coach-count").textContent = `${this.index + 1} / ${STEPS.length}`;
    const last = this.index === STEPS.length - 1;
    $("coach-next").hidden = !step.manual || last;
    $("coach-next").disabled = !canGoOn(this.index, this.#with(c));
    $("coach-skip").hidden = last;
    $("coach-stay").hidden = $("coach-real").hidden = !last;

    // What the map points at, and what the page lights up.
    const squads = c.state.squads.filter((sq) => sq.side === c.side);
    const marks = {
      squad: () => (squads[0] ? { squad: squads[0].id } : null),
      first: () => ({ point: vars.firstId }),
      contact: () => ({ contact: true }),
    };
    this.scene.coach = marks[step.mark]?.() ?? null;
    if (step.focus) document.querySelector(step.focus)?.classList.add("coach-target");
    if (step.tab) document.querySelector(`#dock [data-open="${step.tab}"]`)?.classList.add("coach-target");
    this.#room(card.offsetHeight);
  }

  // #room tells the page how tall the card is. On a phone held upright the map starts
  // below the card (tutorial.css), so the map is measured again when that changes.
  #room(height) {
    if (height === this.height) return;
    this.height = height;
    document.documentElement.style.setProperty("--coach", `${height}px`);
    dispatchEvent(new Event("resize"));
  }

  // #names fills the lines with this match's own names, in the page language.
  #names(c) {
    const { rules, lang, side, state, me } = c;
    const point = (id) => {
      const p = rules.map.points.find((q) => q.id === id);
      return p ? `${p.id} · ${p.callsign[lang]}` : id;
    };
    const squads = state.squads.filter((sq) => sq.side === side);
    const call = (n) => squads[n]?.callsign[lang] ?? `${rules.callsigns.classes.infantry[lang]} ${n + 1}`;
    const firstId = nearest(rules, side, "point");
    const units = Object.values(rules.factions[state.faction ?? ""]?.units ?? {});
    const line = units.filter((u) => u.class === "infantry").sort((a, b) => a.cost - b.cost)[0];
    const contact = state.contacts?.[0];
    const tier = (n) => rules.tiers.find((x) => x.tier === n);
    const structure = (role) => Object.values(rules.factions[state.faction ?? ""]?.structures ?? {}).find((s) => s.role === role)?.name[lang] ?? role;
    return {
      me: me[lang],
      squad: call(0),
      other: call(1),
      newest: squads.at(-1)?.callsign[lang] ?? call(2),
      firstId,
      first: point(firstId),
      firstName: rules.map.points.find((p) => p.id === firstId)?.callsign[lang] ?? firstId,
      rig: point(c.rig), // the gold field by the base, which the lesson's enemy comes for
      anvil: rules.callsigns.operator[lang],
      unit: line?.name[lang] ?? "",
      target: `${rules.callsigns.contact[lang]} ${contact?.id ?? 3}`,
      seconds: rules.match.captureSeconds,
      cost2: tier(2)?.upgradeCost ?? "",
      cost3: tier(3)?.upgradeCost ?? "",
      // The page's own words for its buttons and panels, so a line names what is on screen.
      hold: this.t("act.hold"),
      send: this.t("send"),
      squads: this.t("roster"),
      build: this.t("build"),
      structures: this.t("structures"),
      refinery: structure("refinery"),
      barracks: structure("barracks"),
      hauler: units.find((u) => u.class === "hauler")?.name[lang] ?? "",
      buildTab: this.t("tab.build"),
      procedure: this.t("strict"),
    };
  }
}
