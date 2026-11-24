// The radio log's housekeeping, kept apart from the page so it can be tested alone:
// which lines are base cues, how repeats are folded into one line, which few lines a
// phone's strip shows, and whether cues are spoken.
//
// A base cue is a fixed line the server wrote in the operator's name ("Construction
// complete", "Our base is under attack"). It arrives as a radio message with `cue` set
// to its kind; the log marks it with a small beacon so it is not taken for something the
// operator's agent decided to say.

// ---- folding repeats ----

// Events of the same kind that follow one another within this many ticks become one line.
export const FOLD_TICKS = 150;

// Kinds that fold, each with what makes two of them "the same": three squads fielded in a
// row are one line, three structures of different kinds are not.
const folds = {
  squad_spawned: () => "",
  squad_lost: () => "",
  enemy_destroyed: () => "",
  hauler_attacked: () => "",
  hauler_lost: () => "",
  structure_built: (ev) => ev.unit ?? "",
  structure_attacked: () => "",
  structure_lost: (ev) => ev.unit ?? "",
  structure_lost_theirs: (ev) => ev.unit ?? "",
  hq_under_attack: () => "",
  bridge_under_attack: (ev) => ev.place ?? "",
};

const isCue = (e) => e.kind === "radio" && Boolean(e.message.cue);

// foldLog turns the page's entries into the lines to show. A line is an entry with a
// `count`: how many events in a row it stands for. A repeat joins the line before it when
// only base cues lie between them (each event has its cue; that must not break the run).
// System lines that say the same thing twice in a row fold too.
export function foldLog(entries) {
  const lines = [];
  for (const e of entries) {
    const key = foldKey(e);
    if (key !== null) {
      let i = lines.length - 1;
      while (i >= 0 && isCue(lines[i].entry)) i--;
      const prev = lines[i];
      if (prev && prev.key === key && tickOf(e) - prev.last <= FOLD_TICKS) {
        prev.count++;
        prev.last = tickOf(e);
        continue;
      }
    }
    lines.push({ entry: e, key, count: 1, last: tickOf(e) });
  }
  return lines;
}

function foldKey(e) {
  if (e.kind === "event" && folds[e.event.kind]) return `event:${e.event.kind}:${folds[e.event.kind](e.event)}`;
  if (e.kind === "system") return `system:${e.key}:${JSON.stringify(e.vars ?? {})}`;
  return null;
}

const tickOf = (e) => (e.kind === "radio" ? e.message.tick : e.kind === "event" ? e.event.tick : e.tick) ?? 0;

// ---- the phone's strip ----

// How far back the strip looks for something better than the newest lines.
export const STRIP_LOOKBACK = 10;

// stripPick chooses which of the lines a phone's few-line strip shows, by index. Radio
// addressed to the player comes first, then other radio, then system lines; among equals
// the newest wins. Only the last STRIP_LOOKBACK lines are candidates, so an old call does
// not sit there for ever, and the picks are shown in the order they happened.
export function stripPick(lines, meKey, n = 4) {
  const from = Math.max(0, lines.length - STRIP_LOOKBACK);
  const rank = (line) => {
    const e = line.entry;
    if (e.kind !== "radio") return 0;
    return e.message.to?.some((to) => to.key === meKey || to.key === "all") ? 2 : 1;
  };
  const candidates = [];
  for (let i = from; i < lines.length; i++) candidates.push({ i, rank: rank(lines[i]) });
  candidates.sort((a, b) => b.rank - a.rank || b.i - a.i);
  return candidates
    .slice(0, n)
    .map((c) => c.i)
    .sort((a, b) => a - b);
}

// ---- speaking cues ----

const KEY = "callsign.cueVoice";

// cueVoice is the page setting that has base cues spoken (the default) or only written.
export const cueVoice = {
  get on() {
    return globalThis.localStorage?.getItem(KEY) !== "off";
  },
  set on(value) {
    globalThis.localStorage?.setItem(KEY, value ? "on" : "off");
  },
};

// spoken reports whether a radio message should be handed to the voice.
export const spoken = (message, voiceOn = cueVoice.on) => !message.cue || voiceOn;

// The beacon that marks a cue line: drawn, not a letter, so it reads the same in both
// languages and mirrors with nothing to mirror.
export function cueMark(doc = globalThis.document) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", "cue-mark");
  svg.setAttribute("aria-hidden", "true");
  const add = (name, attrs) => {
    const node = doc.createElementNS(ns, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.append(node);
  };
  add("circle", { cx: 8, cy: 9, r: 2.2, fill: "currentColor" });
  add("path", { d: "M3.6 12.6a6 6 0 0 1 0-7.2M12.4 5.4a6 6 0 0 1 0 7.2", fill: "none", stroke: "currentColor", "stroke-width": 1.5, "stroke-linecap": "round" });
  add("path", { d: "M8 11.2V15", stroke: "currentColor", "stroke-width": 1.5, "stroke-linecap": "round" });
  return svg;
}
