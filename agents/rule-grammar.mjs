// How the rule brain understands a radio call: a command grammar for Hebrew and English,
// with no model behind it. A call is read in three steps:
//
//   1. the words for what to do are found (`scan`): every order has a list of ways to say
//      it in each language, the usual slips of a speech recogniser among them ("a tack",
//      "hole", "תכוף"), and a word that only sounds like one of them is matched by sound;
//   2. what the order is about is read: map points and landmarks (the net has already
//      found those), an enemy squad by its name ("Target 7"), a structure, a bearing;
//   3. the two are put together into one intent (`understandLeader`).
//
// Polite filler and word order do not matter, a negated word is not an order ("don't stop
// to fight"), and a call that fits no order clearly is not guessed at: the answer is "Say
// again", with the nearest thing that would have been understood when there is one.
//
// It runs in Node and in a Web Worker alike, like the rest of the agent core.

import { compactStructures, namedStructure } from "./bases.mjs";

// ---- the words ----
//
// English entries match as whole words. Hebrew entries are stems: they match at the start
// of a word, behind "ו" or "ש", with any ending; one that starts with "=" must be the
// whole word. Longer entries are matched first and taken out, so "take out" is an attack
// and never "take".

export const leaderWords = {
  attack: {
    en: ["attack", "assault", "destroy", "hit", "engage", "strike", "kill", "eliminate", "storm", "raid", "shoot", "take out", "wipe out", "clear out", "clear", "fire on", "open fire", "go after", "hunt", "take down", "knock out", "finish off", "smash", "bring down",
      "a tack", "attach", "attic", "a track", "attacked", "attacks", "attacking", "at tack", "a tech"],
    he: ["תקוף", "תקפו", "תקפי", "תקיפ", "תתקפ", "תתקוף", "התקפ", "התקיפ", "לתקוף", "השמד", "השמיד", "תשמיד", "להשמיד", "חסל", "לחסל", "תחסל", "נטרל", "הסתער", "תסתער", "להסתער", "=פגע", "תפגע", "=ירו", "תירו", "אש על", "תוריד", "הורד את", "הורידו את", "פתח באש", "פתחו באש", "הפיל", "הפל את", "הרוס", "הרסו", "תהרס",
      "תכוף", "תקופ", "טקוף", "תאקוף"],
  },
  move: {
    en: ["move", "go", "advance", "head", "proceed", "push", "get to", "get over to", "drive", "fly", "sail", "march", "run", "relocate", "reposition", "make your way", "roll", "cross",
      "moo", "moved", "movie", "moves", "moving", "mauve", "moove"],
    he: ["=נוע", "נועו", "תנוע", "לנוע", "=זוז", "זוזו", "תזוז", "לזוז", "התקדמ", "תתקדמ", "התקדם", "להתקדם", "=לך", "=לכו", "תלכו", "=סע", "=סעו", "תיסע", "תסעו", "=טוס", "טוסו", "=שוט", "שוטו", "=רוץ", "רוצו", "תגיע", "הגיעו", "להגיע", "=עלו", "=עלה", "=רדו ל", "=חצו", "=חצה", "תחצו",
      "=נו", "נוא", "=נועה", "=נעו"],
  },
  hold: {
    en: ["hold", "defend", "secure", "guard", "keep", "protect", "occupy", "take", "capture", "stay at", "stay on", "sit on", "set up at", "watch",
      "hole", "holed", "holds", "holding", "holt", "hauled"],
    he: ["החזק", "החזיק", "תחזיק", "להחזיק", "=הגן", "הגנו", "תגן", "תגנו", "להגן", "אבטח", "תאבטח", "לאבטח", "=שמור", "שמרו", "תשמר", "לשמור", "תפוס", "תפסו", "תתפס", "לתפוס", "כבוש", "כבשו", "תכבש", "לכבוש", "=קח", "=קחו", "תיקח", "הישאר", "תישאר", "השתלט"],
  },
  fallBack: {
    en: ["fall back", "pull back", "retreat", "withdraw", "return to base", "come home", "come back", "back to base", "get out of there", "get out", "disengage", "rtb", "break contact", "bug out", "go home", "head home", "pull out", "back off",
      "fallback", "full back", "fall bag", "for back", "fell back"],
    he: ["נסוג", "=סגו", "תיסוג", "לסגת", "נסיגה", "=חזור", "חזרו", "תחזר", "לחזור", "חזרה ל", "חזרה הביתה", "התקפל", "תתקפל", "הביתה", "צאו משם", "צא משם", "התנתק"],
  },
  cover: {
    en: ["take cover", "find cover", "find some cover", "get cover", "get to cover", "into cover", "seek cover", "cover", "covers", "get down", "hide", "heads down", "shelter", "take shelter"],
    he: ["תפסו מחסה", "תפוס מחסה", "מחסה", "התחבא", "תתחבא", "הסתתר", "תסתתר", "הורידו ראש", "תורידו ראש", "מכסה"],
  },
  enter: {
    en: ["get in", "get into", "get inside", "go in", "go into", "go inside", "move into", "move inside", "enter", "garrison", "inside"],
    he: ["היכנס", "תיכנס", "להיכנס", "=כנסו", "אייש", "לתוך", "בתוך"],
  },
  leave: {
    en: ["leave the", "leave", "get out of the", "exit", "come out", "vacate", "out of the building"],
    he: ["צאו מה", "צא מה", "לצאת מ", "עזבו", "עזוב", "תעזב", "פנו את"],
  },
  stop: {
    en: ["stop", "halt", "hold position", "hold your position", "hold here", "hold your ground", "stay there", "stay put", "stay where you are", "stand fast", "wait there", "freeze"],
    he: ["עצור", "עצרו", "תעצר", "=עמוד", "=עמדו", "=חכו", "המתינו", "הישארו במקום", "הישאר במקום"],
  },
  dig: {
    en: ["dig in", "digs in", "dug in", "fortify", "entrench", "sandbags"],
    he: ["התבצר", "להתבצר", "תתבצר", "התחפר", "תתחפר", "שקי חול"],
  },
  repair: {
    en: ["repair", "fix", "mend", "rebuild", "patch up"],
    he: ["תקן", "תקנו", "לתקן", "תתקנ", "שקם", "שקמו", "שפץ"],
  },
  capture: {
    en: ["capture", "take over", "seize", "occupy"],
    he: ["השתלט", "להשתלט", "תשתלט", "כבוש את", "כבשו את", "תפוס את", "תפסו את"],
  },
  plant: {
    en: ["plant", "demolish", "demolition", "blow up", "blow", "charge"],
    he: ["הנח", "הניחו", "מטען", "פוצץ", "פוצצו", "לפוצץ", "תפוצצ"],
  },
  seize: {
    en: ["seize", "hijack", "take over", "steal"],
    he: ["השתלט", "להשתלט", "תשתלט", "חטוף", "חטפו", "תחטפ"],
  },
  report: {
    en: ["report", "status", "sitrep", "situation", "what do you see", "what can you see", "what's happening", "what is happening", "whats happening", "where are you", "how are you", "what's going on", "what is going on"],
    he: ["דווח", "דיווח", "מה המצב", "מצב", "מה אתה רואה", "מה אתם רואים", "מה רואים", "מה קורה", "איפה אתם", "איפה אתה", "תמונת מצב"],
  },
};

// Words that turn the order right after them off: "don't stop to fight", "אל תתקפו".
const negation = { en: /(?:\b(?:don't|do not|dont|never|without|no need to)\s+(?:[a-z']+\s+){0,1})$/, he: /(?:(?:^|\s)(?:אל|לא|בלי|אסור)\s+)$/ };
const haulerWords = /\b(haulers?|trucks?|crawlers?|miners?|harvesters?)\b|משאית|משאיות|מוביל|מובילים|זחל|זחלים/;
const escortWords = /\b(escort|protect|cover|guard)\b|לווה|ליווי|אבטח|שמור/;
const compass = /\b(north|south|east|west)|צפון|דרום|מזרח|מערב/i;
const hereWords = /\b(here|where you are|your position|on the spot)\b|(?:^|\s)(?:פה|במקום|בעמדה)(?:\s|$)/;
const homeWords = /\b(base|home|hq|headquarters)\b|בסיס|הביתה|מפקדה|מפקדת/;
const enemyHome = /\benemy (?:base|hq|headquarters)\b|\btheir (?:base|hq|headquarters)\b|בסיס האויב|מפקדת האויב/;
const orWords = /\bor\b|(?:^|\s)או(?:\s|$)/;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const HE = "א-ת";

// tidy makes a call's body ready to be read: lower case, no punctuation, no vowel points.
export function tidy(body) {
  return ` ${String(body ?? "")
    .toLowerCase()
    .replace(/[֑-ׇ]/g, "")
    .replace(/[’`]/g, "'")
    .replace(/[.,;:!?"“”()\-–—/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

const compiled = new WeakMap();
function patterns(words) {
  let list = compiled.get(words);
  if (list) return list;
  // One entry per way of saying it; a way that belongs to two orders ("take over") names both.
  const byText = new Map();
  const add = (key, cls, entry) => (byText.get(key) ?? byText.set(key, { ...entry, classes: [] }).get(key)).classes.push(cls);
  for (const [cls, both] of Object.entries(words)) {
    for (const p of both.en) add(`en:${p}`, cls, { lang: "en", text: p, re: new RegExp(`(?<![a-z0-9'])${escape(p)}(?![a-z0-9'])`, "g") });
    for (const raw of both.he) {
      const whole = raw.startsWith("=");
      const p = whole ? raw.slice(1) : raw;
      add(`he:${raw}`, cls, { lang: "he", text: p, re: new RegExp(`(?<![${HE}])[וש]?${escape(p)}${whole ? `(?![${HE}])` : ""}`, "g") });
    }
  }
  list = [...byText.values()].sort((a, b) => b.text.length - a.text.length);
  compiled.set(words, list);
  return list;
}

// sound reduces an English word to rough consonant classes, so "hauled" and "hold" come
// out alike. The same idea as the voice normaliser's (client/voice/normalize.js).
function sound(word) {
  return word
    .replace(/[^a-z]/g, "")
    .replace(/sh|ch|j/g, "S")
    .replace(/ph/g, "P")
    .replace(/[ckqgx]/g, "K")
    .replace(/[bpvf]/g, "P")
    .replace(/[dt]/g, "T")
    .replace(/[mn]/g, "N")
    .replace(/[lr]/g, "R")
    .replace(/[sz]/g, "S")
    .replace(/^[aeiou]+/, "A")
    .replace(/[aeiouywh]/g, (ch, i) => (i === 0 && ch === "h" ? "H" : ""))
    .replace(/(.)\1+/g, "$1");
}

function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
const alike = (a, b) => (a.length || b.length ? 1 - distance(a, b) / Math.max(a.length, b.length) : 0);
// How alike two words are: in English by how they sound, and never on sound alone ("side"
// is not "shoot"); in Hebrew by how they are spelled.
const likeness = (a, b, lang) => (lang === "he" ? alike(a, b) : alike(a, b) < 0.6 ? 0 : 0.75 * alike(sound(a), sound(b)) + 0.25 * alike(a, b));

// Ordinary words that are never an order, however much they sound like one.
const plainWords = new Set(["there", "here", "that", "this", "with", "them", "then", "your", "they", "want", "need", "please", "enemy", "north", "south", "east", "west", "over", "target", "bridge", "house", "grove", "rocks", "bunker", "ruin", "ruins", "field", "gold", "squad", "team", "from", "into", "near", "what", "when", "where", "have", "will", "would", "could", "should", "right", "left", "quickly", "position", "metres", "meters", "everything", "everyone", "building", "point", "town", "farm", "ridge", "ford", "thing", "stuff", "place", "talked", "about", "hammer", "anvil", "tank", "tanks", "boat", "more", "some", "radio", "check", "which", "whichever", "static", "base", "back", "home", "fight",
  "בבקשה", "עכשיו", "מיד", "אויב", "האויב", "צפון", "דרום", "מזרח", "מערב", "מטרה", "גשר", "הגשר", "בית", "חורשה", "סלעים", "בונקר", "חורבה", "שדה", "זהב", "כיתה", "אותו", "אותה", "אותם", "שלנו", "שלכם", "משם", "לשם", "רוצה", "צריך", "אתם", "אתה", "הזה", "הזאת", "דיברנו", "עליו", "קרבות", "להתעכב", "בדרך", "רעש", "אצלך"]);

// namesOf collects the words of every name in the rules, which are never orders either.
const nameWords = new WeakMap();
function namesOf(rules) {
  let set = nameWords.get(rules);
  if (set) return set;
  set = new Set();
  const add = (s) => String(s ?? "").toLowerCase().split(/[\s\-־]+/).forEach((w) => w && set.add(w));
  const both = (t) => (add(t?.en), add(t?.he));
  for (const p of rules.map?.points ?? []) (both(p.callsign), both(p.name), (p.aliases ?? []).forEach(add));
  for (const l of [...(rules.map?.landmarks ?? []), ...(rules.map?.bridges ?? []), ...(rules.map?.techBuildings ?? [])]) both(l.name);
  for (const f of Object.values(rules.factions ?? {})) {
    for (const u of Object.values(f.units ?? {})) both(u.name);
    for (const s of Object.values(f.structures ?? {})) both(s.name);
  }
  const cs = rules.callsigns ?? {};
  for (const t of [cs.player, cs.operator, cs.allStations, cs.contact, cs.hauler, ...Object.values(cs.classes ?? {})]) both(t);
  nameWords.set(rules, set);
  return set;
}

// scan finds the order words in a tidied text. It returns the matches in the order they
// were said: { cls, at, text, fuzzy, negated }, and the text with them blanked out.
export function scan(text, lang, words, rules) {
  const work = [...text];
  const found = [];
  const blank = (at, len) => {
    for (let i = at; i < at + len; i++) work[i] = " ";
  };
  for (const p of patterns(words)) {
    const now = work.join("");
    for (const m of now.matchAll(p.re)) {
      for (const cls of p.classes) found.push({ cls, at: m.index, text: p.text, fuzzy: false, negated: negation[p.lang].test(text.slice(0, m.index)) });
      blank(m.index, m[0].length);
    }
  }
  // What is left, word by word: one that sounds like exactly one order is that order.
  const names = rules ? namesOf(rules) : new Set();
  const single = Object.entries(words).flatMap(([cls, both]) => both[lang === "he" ? "he" : "en"].map((w) => [cls, w.replace(/^=/, "")]).filter(([, w]) => !w.includes(" ") && w.length >= 4));
  const tokens = lang === "he" ? new RegExp(`[${HE}]{4,}`, "g") : /[a-z]{4,}/g;
  for (const m of work.join("").matchAll(tokens)) {
    let word = m[0];
    if (plainWords.has(word) || names.has(word)) continue;
    if (lang === "he" && /^[ולשה]/.test(word) && word.length > 4 && !names.has(word.slice(1))) word = word.slice(1);
    else if (lang === "he" && names.has(word.slice(1))) continue;
    const scored = single.map(([cls, w]) => [lang === "he" ? Math.max(likeness(word, w, lang), likeness(word.slice(0, w.length), w, lang)) : likeness(word, w, lang), cls]).sort((a, b) => b[0] - a[0]);
    const best = scored[0];
    const need = lang === "he" ? 0.75 : 0.8;
    if (!best || best[0] < need) continue;
    const rival = scored.find(([score, cls]) => cls !== best[1] && score > best[0] - 0.05);
    if (rival) continue; // it sounds like two different orders: not clear enough
    found.push({ cls: best[1], at: m.index, text: m[0], fuzzy: true, negated: negation[lang === "he" ? "he" : "en"].test(text.slice(0, m.index)) });
    blank(m.index, m[0].length);
  }
  found.sort((a, b) => a.at - b.at);
  return { found, rest: work.join("") };
}

// nearMiss is the order a word in the text comes closest to without being it, for the
// "Say again" that names what would have been understood. null when nothing is close.
export function nearMiss(rest, lang, words, rules) {
  const names = rules ? namesOf(rules) : new Set();
  const single = Object.entries(words).flatMap(([cls, both]) => both[lang === "he" ? "he" : "en"].map((w) => [cls, w.replace(/^=/, "")]).filter(([, w]) => !w.includes(" ") && w.length >= 3));
  let best = null;
  for (const m of rest.matchAll(lang === "he" ? new RegExp(`[${HE}]{3,}`, "g") : /[a-z]{3,}/g)) {
    if (plainWords.has(m[0]) || names.has(m[0])) continue;
    for (const [cls, w] of single) {
      const score = likeness(m[0], w, lang);
      if (score >= 0.6 && (!best || score > best.score)) best = { cls, score };
    }
  }
  return best?.cls ?? null;
}

const numberWords = [
  ["one", "won", "אחת", "אחד"], ["two", "too", "שתיים", "שתים", "שניים", "שני", "שתי"], ["three", "tree", "שלוש", "שלושה"], ["four", "for", "ארבע", "ארבעה"], ["five", "חמש", "חמישה"],
  ["six", "שש", "שישה"], ["seven", "שבע", "שבעה"], ["eight", "ate", "שמונה"], ["nine", "niner", "תשע", "תשעה"], ["ten", "עשר", "עשרה"],
];
// numberOf reads a count written in digits or in words, 0 when it is neither.
export function numberOf(word) {
  if (/^\d+$/.test(word ?? "")) return Number(word);
  const i = numberWords.findIndex((forms) => forms.includes(String(word ?? "").toLowerCase()));
  return i < 0 ? 0 : i + 1;
}

// contactIn reads an enemy squad named in a call ("Target 7", "מטרה שלוש"), 0 for none.
export function contactIn(body, rules) {
  const name = rules.callsigns.contact;
  const m = new RegExp(`(?:${escape(name.en)}|${escape(name.he)})[\\s\\-#]*([^\\s,.:;!?]+)`, "i").exec(body ?? "");
  return m ? numberOf(m[1]) : 0;
}

const namesOfPoint = (p) => [p?.callsign.en, p?.callsign.he, p?.name.en, p?.name.he, ...(p?.aliases ?? [])].filter(Boolean).map((n) => n.toLowerCase());

// morePoints finds what the net's own reading misses: a Hebrew name that starts with "ה"
// loses it behind "ל", "ב" or "מ" ("למעבר הקפוא" is "המעבר הקפוא").
function morePoints(text, rules) {
  const found = [];
  for (const p of rules.map.points) {
    for (const n of namesOfPoint(p).filter((name) => /^ה[א-ת]/.test(name))) {
      if (new RegExp(`(?<![${HE}])ו?[לבמכ]${escape(n.slice(1))}(?![${HE}])`).test(text)) found.push(p.id);
    }
  }
  return [...new Set(found)];
}

// whereSaid gives, for each point named in a call, where in the text its name stands, so
// that "from Delta to Foxtrot" can be told from "to Delta from Foxtrot".
function whereSaid(text, ids, rules) {
  return ids
    .map((id) => {
      const names = namesOfPoint(rules.map.points.find((q) => q.id === id)).flatMap((n) => (/^ה[א-ת]/.test(n) ? [n, n.slice(1)] : [n]));
      const at = Math.min(...names.map((n) => text.indexOf(n)).filter((i) => i >= 0), Infinity);
      return { id, at };
    })
    .sort((a, b) => a.at - b.at);
}

// withoutNames blanks the names of the points a call mentions, so that the "east" of "the
// east field" is not read as a bearing off it.
function withoutNames(text, ids, rules) {
  let out = text;
  for (const id of ids) {
    for (const n of namesOfPoint(rules.map.points.find((q) => q.id === id)).sort((a, b) => b.length - a.length)) {
      out = out.split(n).join(" ".repeat(n.length));
      if (/^ה[א-ת]/.test(n)) out = out.split(n.slice(1)).join(" ".repeat(n.length - 1));
    }
  }
  return out;
}

// Little words that say nothing about where: what is left of "hold" besides them means
// the call named a place this brain did not catch.
const filler = new Set(["the", "a", "an", "it", "and", "to", "at", "on", "in", "of", "now", "please", "there", "here", "your", "you", "position", "ground", "fast", "quickly", "right", "away", "immediately", "this", "that", "is", "hammer", "over", "out", "for", "me", "us", "we", "just", "then", "up", "down", "still", "tight", "firm", "all", "squad", "team", "men", "boys", "guys", "ok", "okay",
  "את", "אותו", "אותה", "אותם", "עכשיו", "מיד", "בבקשה", "פה", "כאן", "שם", "במקום", "בעמדה", "מהר", "על", "של", "זה", "אתם", "אתה", "כולם", "טוב", "רק", "גם", "עד", "הודעה", "חדשה", "להודעה"]);
function leftover(rest, lang) {
  return [...rest.matchAll(lang === "he" ? new RegExp(`[${HE}]{2,}`, "g") : /[a-z]{2,}/g)].map((m) => m[0]).filter((w) => !filler.has(w));
}

// The intents. Each is plain data: a label that names it (the same label an option of the
// decision brain carries), the one tool call that carries it out, or the line to say.
const tool = (label, kind, name, input, more = {}) => ({ label, kind, tool: { name, input }, ...more });
export const intents = {
  move: (place, label = `move:${place}`, more) => tool(label, "move", "move", { place }, more),
  hold: (place, label = `hold:${place}`, more) => tool(label, "hold", "hold", { place }, more),
  attack: (place, label = `attack:${place}`, more) => tool(label, "attack", "attack", { place, contact: 0 }, more),
  attackContact: (contact, more) => tool(`attack:target:${contact}`, "attack", "attack", { place: "", contact }, { contact, ...more }),
  repair: (place) => tool(`repair:${place}`, "repair", "repair", { place }),
  capture: (place) => tool(`capture:${place}`, "capture", "capture", { place }),
  fortify: () => tool("dig", "dig", "fortify", {}),
  plant: (place) => tool(`plant:${place}`, "plant", "plant", { place }),
  seize: (contact) => tool(`seize:${contact}`, "seize", "seize", { contact }),
  say: (label, key, vars = {}, end = "over") => ({ label, kind: "say", say: { key, vars, end } }),
  negative: (why, vars = {}) => ({ label: `negative:${why}`, kind: "say", say: { key: "negative", vars, why: `why.${why}`, end: "over" } }),
  report: () => ({ label: "report", kind: "report" }),
  unclear: (key = "sayAgain", vars = {}) => ({ label: "sayAgain", kind: "unclear", say: { key, vars, end: "over" } }),
  none: () => ({ label: "none", kind: "none" }),
};

const canDig = (u) => u?.class === "infantry" && u.domain === "land" && !u.hero;
const hqOf = (rules, side, own) => rules.map.points.find((p) => p.kind === "hq" && (p.owner === side) === own)?.id;

// nearestCover is the landmark a squad would shelter at: the closest one in its report
// that still gives cover, a building with room before open cover at the same distance.
export function nearestCover(status, rules, { within = Infinity, of = status?.you } = {}) {
  if (!of) return null;
  const known = new Map((status?.landmarks ?? []).map((l) => [l.id, l]));
  const marks = (rules.map.landmarks ?? [])
    .map((l) => ({ ...l, seen: known.get(l.id), far: Math.hypot(l.x - of.x, l.y - of.y) }))
    .filter((l) => l.far <= within && l.seen?.kind !== "rubble" && !(l.seen?.garrison && l.seen.room === 0))
    .sort((a, b) => a.far - b.far || a.id.localeCompare(b.id));
  return marks[0] ?? null;
}

// workedField is the map point of the gold field a side's haulers work now, or of the
// field nearest its headquarters.
export function workedField(status, rules, side) {
  const gushers = rules.map.gushers ?? [];
  const working = (status?.haulers ?? []).find((h) => h.field)?.field;
  const hq = rules.map.points.find((p) => p.kind === "hq" && p.owner === side);
  const near = [...gushers].sort((a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y))[0];
  return (gushers.find((g) => g.id === working) ?? near)?.point;
}

// understandLeader reads a call to a squad leader and returns the one intent it carries.
// `level` is the squad's initiative (1 to 3): from 2 up an attack with no target named goes
// for an enemy the squad's weapon can hurt.
export function understandLeader({ call, status, rules, agent, level = 1 }) {
  if (!call || (call.from.key !== "player" && call.from.key !== "operator")) return intents.none(); // squads do not order squads
  if (call.prowords?.includes("radioCheck")) return intents.say("radioCheck", "fiveByFive", {}, "out");
  const lang = call.lang === "he" ? "he" : "en";
  const unit = agent.unit ?? {};
  const text = tidy(call.body);
  const { found, rest } = scan(text, lang, leaderWords, rules);
  const live = found.filter((f) => !f.negated);
  const has = (cls) => live.some((f) => f.cls === cls);

  const structures = compactStructures(status ?? {}, agent.side);
  const theirs = namedStructure(call.body, structures, { enemy: true });
  const ours = namedStructure(call.body, structures, { enemy: false });
  const escort = escortWords.test(text) && haulerWords.test(text);
  const marks = escort ? [] : (call.landmarks ?? []);
  const bridges = marks.filter((id) => (rules.map.bridges ?? []).some((b) => b.id === id));
  const named = contactIn(call.body, rules);
  const said = [...new Set([...(call.points ?? []), ...(lang === "he" ? morePoints(text, rules) : [])])];
  const points = whereSaid(text, said, rules);
  const engineer = unit.captureSeconds > 0;
  const which = (ids) => intents.unclear("sayAgainWhich", { options: ids });
  const ownHQ = hqOf(rules, agent.side, true);
  const enemyHQ = hqOf(rules, agent.side, false);

  // A hero's two orders come first: their words are also plain ones ("take over", "charge").
  if (unit.chargeDamage && has("plant")) {
    const place = theirs?.id ?? bridges[0] ?? (homeWords.test(text) || call.points?.includes(enemyHQ) ? enemyHQ : undefined);
    return place ? intents.plant(place) : intents.unclear("sayAgainWhat", { verb: "verb.plant" });
  }
  if (unit.seizeRadius && (has("seize") || has("capture"))) {
    const contact = named || (status?.contacts ?? []).find((c) => c.class === "vehicle")?.id || 0;
    return contact ? intents.seize(contact) : intents.negative("noVehicle");
  }
  // "Dig in" builds a position where the squad stands. Told to go somewhere and dig in, it
  // goes and holds the place, which takes the cover there.
  const elsewhere = (said.length || marks.length) && (has("move") || has("hold"));
  if (has("dig") && !elsewhere) return canDig(unit) ? intents.fortify() : intents.negative("noDig");
  // An enemy structure named with a word for taking it: engineers take it over.
  if (theirs && has("capture")) return engineer ? intents.capture(theirs.id) : intents.negative("onlyEngineersCapture");
  if (has("repair")) {
    if (marks.length > 1) return which(marks);
    if (marks.length === 1) return intents.repair(marks[0]); // the game says so when this squad cannot mend
    if (ours) return engineer ? intents.repair(ours.id) : intents.negative("onlyEngineersMend");
    return intents.unclear("sayAgainWhat", { verb: "verb.repair" });
  }

  const acting = ["attack", "move", "hold", "fallBack", "cover", "enter", "leave", "stop"].some(has);
  if (has("report") && !acting) return intents.report();

  // Where the order points. Two points joined by "or" are a question back, not a choice of ours.
  if (points.length > 1 && orWords.test(text)) return which(points.map((p) => p.id));
  const from = (p) => /(?:\bfrom\s+(?:the\s+)?|(?:^|\s)מ)$/.test(text.slice(0, p.at));
  const point = (points.find((p) => !from(p)) ?? points[0])?.id;
  const offPoint = point && compass.test(withoutNames(text, said, rules)) && marks.length === 0; // "north of Foxtrot": the game reads the words

  if (has("fallBack") && !has("attack")) {
    const to = point ?? ownHQ;
    return intents.move(to, point ? `fallBack:${to}` : "fallBack", { back: true });
  }
  if (has("leave") && !has("attack") && marks.length <= 1 && !point) {
    const out = status?.you?.near ?? ownHQ;
    return intents.move(out, "leave", { leave: true });
  }
  if (escort) {
    const field = point ?? workedField(status, rules, agent.side);
    return intents.hold(field, `hold:${field}`);
  }
  if (has("attack")) {
    if (theirs) return intents.attack(theirs.id);
    if (named) return intents.attackContact(named);
    if (marks.length > 1) return which(marks);
    if (marks.length === 1) return intents.attack(marks[0], `attack:lm:${marks[0]}`);
    if (offPoint) return intents.attack(call.body, "attack:spot");
    if (point) return intents.attack(point);
    if (enemyHome.test(text)) return intents.attack(enemyHQ);
    // "Attack" with no target: an enemy in sight, or else the enemy headquarters.
    const seen = status?.contacts ?? [];
    const hurts = (c) => (unit.vs?.[c.class] ?? 1) > 0;
    const me = status?.you ?? { x: 0, y: 0 };
    const prey = [...(level >= 2 ? seen.filter(hurts) : seen)].sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y) || a.id - b.id)[0];
    return prey ? intents.attackContact(prey.id, { any: true, label: "attack:any" }) : { ...intents.attack(enemyHQ), label: "attack:any", any: true };
  }
  if (has("cover") || has("enter")) {
    const tag = has("enter") ? "enter" : "cover";
    if (marks.length > 1) return which(marks);
    if (marks.length === 1) return intents.hold(marks[0], `${tag}:lm:${marks[0]}`);
    if (offPoint) return intents.hold(call.body, "hold:spot");
    if (point) return intents.hold(point);
    const near = nearestCover(status, rules, { within: 400 });
    return near ? intents.hold(near.id, "cover", { shelter: near.id }) : intents.hold("here", "cover");
  }
  // "Go to the town and dig in there" is to hold the town.
  const verb = has("hold") || (has("dig") && elsewhere) ? "hold" : has("move") ? "move" : has("stop") ? "hold" : null;
  if (!verb) {
    // Told not to move, and nothing else: stay.
    if (found.some((f) => f.cls === "move" && f.negated)) return intents.hold("here", "hold:here");
    if (has("report")) return intents.report();
    const place = marks.length === 1 ? marks[0] : marks.length === 0 ? point : undefined;
    if (marks.length > 1) return which(marks);
    if (place) return intents.unclear("sayAgainVerb", { place });
    const close = nearMiss(rest, lang, leaderWords, rules);
    if (close && ["attack", "move", "hold"].includes(close)) return intents.unclear("sayAgainWhere", { verb: `verb.${close}` });
    if (close && ["fallBack", "cover", "report"].includes(close)) return intents.unclear("sayAgainWhich", { orders: [`order.${close}`] });
    return intents.unclear();
  }
  if (marks.length > 1) return which(marks);
  if (marks.length === 1) return intents[verb](marks[0], `${verb}:lm:${marks[0]}`);
  if (offPoint) return intents[verb](call.body, `${verb}:spot`);
  if (point) return intents[verb](point);
  if (homeWords.test(text)) return intents[verb](ownHQ);
  if (verb === "move") return intents.unclear("sayAgainWhere", { verb: "verb.move" });
  // "Hold" and nothing else is to hold here. With words left over that this brain could
  // not place, the call named somewhere: ask, rather than stay put on a guess.
  if (!has("stop") && !hereWords.test(text) && leftover(rest, lang).length > 0) return intents.unclear("sayAgainWhere", { verb: "verb.hold" });
  return intents.hold("here", "hold:here");
}

export { haulerWords, escortWords, compass, hereWords, homeWords, canDig };
