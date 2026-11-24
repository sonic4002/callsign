// Turns what the recogniser heard into a radio call the net can read.
//
// Small speech models spell ordinary words well and names badly: "Vapour won, this is
// Hannah, attack gulf over". But a call has a fixed frame and a closed set of names, so
// the frame is found first ("<to>, this is <from> ... over") and each slot is then matched
// to the names it can hold: callsigns from rules.json in front, the player's own callsign
// after the marker, and map points in the body. Anything that matches nothing is left as
// heard, for the player to fix before sending. Nothing here guesses a missing "Over".

const numbers = {
  en: [["one", "won", "wan"], ["two", "too", "to", "tu"], ["three", "tree", "free"], ["four", "for", "fore"], ["five", "fife"], ["six", "sex"], ["seven"], ["eight", "ate"], ["nine", "niner"]],
  he: [["אחת", "אחד"], ["שתיים", "שתים", "שניים", "שנים", "שתי", "שני"], ["שלוש", "שלושה"], ["ארבע", "ארבעה"], ["חמש", "חמישה"], ["שש", "שישה"], ["שבע", "שבעה"], ["שמונה"], ["תשע", "תשעה"]],
};

// Ordinary words that sound like a map point but are not one.
const notPlaces = new Set(["kill", "hold", "gold", "go", "hot", "hit", "all", "out", "over", "tell", "dig", "fox", "see", "sir", "zero", "brave", "dealt", "דור", "גם", "כל", "סוף", "הגיע", "פסול", "כיתה", "כיתת", "כיתות", "זהב", "את", "אותה", "אותו", "אותם", "to", "it", "cell", "זהב", "שדה", "אחר", "אחרי", "כך",
  // The words a place is described with: "the grove north of Foxtrot" is not "the Golf north of Foxtrot".
  "grove", "trees", "tree", "wood", "woods", "house", "building", "bunker", "ruin", "ruins", "rocks", "rock", "wall", "rubble", "bridge", "field", "cover", "inside", "enemy",
  "north", "south", "east", "west", "of", "metres", "meters",
  "חורשה", "עצים", "עץ", "בית", "בניין", "בונקר", "חורבה", "סלעים", "סלע", "חומה", "הריסות", "גשר", "מחסה", "אויב", "צפון", "דרום", "מזרח", "מערב", "צפונית", "דרומית", "מזרחית", "מערבית", "מטר",
  // Selling and repairing a structure, and power: order words, never a place.
  "sell", "repair", "power", "radar", "מכור", "מכרו", "למכור", "תקן", "תקנו", "לתקן", "חשמל", "כוח", "תחנת", "שלנו"]);

// sound reduces a word to rough consonant classes, so "vapour" and "viper" come out alike.
export function sound(word, lang) {
  const w = word.toLowerCase();
  if (lang === "he") {
    const classes = { כ: "K", ק: "K", ח: "K", ג: "K", ך: "K", ט: "T", ת: "T", ד: "T", ס: "S", ש: "S", צ: "S", ז: "S", ץ: "S", ב: "P", פ: "P", ף: "P", מ: "N", נ: "N", ם: "N", ן: "N", ל: "R", ר: "R" };
    return [...w].map((ch) => classes[ch] ?? "").join("").replace(/(.)\1+/g, "$1");
  }
  const s = w
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
    .replace(/[aeiouywh]/g, (ch, i) => (i === 0 && ch === "h" ? "H" : ""));
  return s.replace(/(.)\1+/g, "$1");
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

// similarity of two words: how they sound, with how they are spelled as a tie-break.
export function similarity(a, b, lang) {
  const plain = (s) => s.toLowerCase().replace(/[^a-zא-ת]/g, "");
  return 0.75 * alike(sound(a, lang), sound(b, lang)) + 0.25 * alike(plain(a), plain(b));
}

const gap = "[\\s,.:;!?\\-–—]";
const words = (s) => s.split(/[\s,.:;!?\-–—"']+/).filter(Boolean);

function numberOf(word, lang) {
  if (/^\d+$/.test(word)) return Number(word);
  const i = numbers[lang].findIndex((forms) => forms.includes(word.toLowerCase()));
  return i < 0 ? 0 : i + 1;
}

// addressee reads the front of a call: one or more callsigns, each maybe with a number.
function addressee(text, lang, rules) {
  const cs = rules.callsigns;
  const all = cs.allStations[lang];
  const ws = words(text);
  if (ws.length === 0) return "";
  if (similarity(ws.join(""), all.replace(/\s/g, ""), lang) >= 0.7) return all;
  const names = [cs.operator[lang], ...Object.values(cs.classes).map((c) => c[lang])];
  const and = lang === "he" ? /^ו/ : /^and$/i;
  const out = [];
  for (let i = 0; i < ws.length; i++) {
    if (lang !== "he" && and.test(ws[i])) continue;
    const word = lang === "he" && out.length > 0 ? ws[i].replace(and, "") : ws[i];
    const n = numberOf(word, lang) || (lang === "he" ? numberOf(word.replace(/^ה/, ""), lang) : 0);
    if (n && out.length > 0 && !/\d$/.test(out.at(-1))) {
      out[out.length - 1] += ` ${n}`;
      continue;
    }
    const best = names.map((name) => [similarity(word, name, lang), name]).sort((a, b) => b[0] - a[0])[0];
    out.push(best[0] >= 0.45 ? best[1] : ws[i]);
  }
  const joiner = lang === "he" ? " ו" : " and ";
  return out.length > 1 ? out.slice(0, -1).join(", ") + joiner + out.at(-1) : out[0];
}

// places puts the map's own spelling on words that sound like a point's callsign. Text
// the player typed (`typed`) is left as written: matching by sound is for what a
// recogniser heard, and on typed words it only does harm ("זהב" is not "זאב").
function places(body, lang, rules, typed = false) {
  return contacts(typed ? body : placeNames(body, lang, rules), lang, rules);
}

// contacts respells a named enemy squad: "target three" → "Target 3".
function contacts(body, lang, rules) {
  const name = rules.callsigns.contact?.[lang];
  if (!name) return body;
  return body.replace(new RegExp(`(^|[\\s,.:;])${name}[\\s\\-#]*([^\\s,.:;!?]+)`, "gi"), (all, lead, word) => {
    const n = numberOf(word, lang);
    return n ? `${lead}${name} ${n}` : all;
  });
}

function placeNames(body, lang, rules) {
  const points = rules.map.points.map((p) => p.callsign[lang]);
  const exact = (word) => points.find((p) => p.toLowerCase() === word.toLowerCase());
  // A station's own name is never a place, however alike they sound: "צפע" is not "זאב".
  // The same goes for the words of a unit's name ("Militia cell" is not Kilo).
  const cs = rules.callsigns;
  const units = Object.values(rules.factions).flatMap((f) => Object.values(f.units).map((u) => u.name));
  const stations = new Set(
    [cs.player, cs.operator, cs.allStations, cs.contact, ...Object.values(cs.classes), ...units].flatMap((name) => (name?.[lang] ?? "").toLowerCase().split(/\s+/)),
  );
  const known = (word) => notPlaces.has(word.toLowerCase()) || stations.has(word.toLowerCase());
  const match = (word) => {
    if (word.length < 3 || known(word)) return null;
    const best = points.map((p) => [similarity(word, p, lang), p]).sort((a, b) => b[0] - a[0])[0];
    return best[0] >= 0.75 ? best[1] : null;
  };
  // Words and what lies between them, kept apart so the punctuation survives.
  const parts = body.split(lang === "he" ? /([\u05d0-\u05ea]+)/ : /([A-Za-z]+)/);
  for (let i = 1; i < parts.length; i += 2) {
    const word = parts[i];
    if (exact(word)) {
      parts[i] = exact(word);
      continue;
    }
    // A name heard as two words: "fox strut", "fox-trot".
    const next = parts[i + 2];
    // Not across a little word or a station's name: "to hold" is not Delta.
    const halves = next && word.length >= 3 && next.length >= 3 && !stations.has(word.toLowerCase()) && !stations.has(next.toLowerCase());
    const both = halves && /^[\s-]$/.test(parts[i + 1]) && !exact(next) ? match(word + next) : null;
    if (both && !match(word)) {
      parts.splice(i, 3, both);
      continue;
    }
    // Hebrew glues "in", "to", "the" and the like to the front of the name: בפסל, לכרמל.
    // A known word, alone or behind such a letter ("וצפע"), is not a place.
    const plain = known(word) || known(word.slice(1));
    const glued = lang === "he" && !plain && /^[בלמהוכש]/.test(word) && word.length > 3 ? exact(word.slice(1)) ?? match(word.slice(1)) : null;
    parts[i] = glued ? word[0] + glued : plain ? word : match(word) ?? word;
  }
  return parts.join("");
}

export function normalize(heard, { lang, rules }) {
  const text = heard.replace(/\s+/g, " ").trim();
  const marker = rules.radio.marker[lang];
  const at = text.toLowerCase().search(new RegExp(`(^|${gap})${marker}(${gap}|$)`));
  if (at < 0) return text;
  const start = text.toLowerCase().indexOf(marker, at);
  const to = addressee(text.slice(0, start), lang, rules);
  if (!to) return text;
  const trimStart = (t) => t.replace(new RegExp(`^${gap}+`), "");
  let rest = trimStart(text.slice(start + marker.length));

  // The player is the only one who talks here, so the name after the marker is theirs.
  const me = rules.callsigns.player[lang];
  const first = /^[^\s,.:;!?]+/.exec(rest)?.[0] ?? "";
  if (first && similarity(first, me, lang) >= 0.4) rest = trimStart(rest.slice(first.length));

  // The closing word, when one was said.
  let end = "";
  const last = /[^\s,.:;!?]+(?=[\s,.:;!?]*$)/.exec(rest);
  if (last) {
    for (const kind of ["over", "out"]) {
      const word = rules.radio[kind][lang];
      if (similarity(last[0], word, lang) >= 0.8) {
        end = word;
        rest = rest.slice(0, last.index);
      }
    }
  }
  let body = places(rest.replace(/[\s,.:;!?]+$/, ""), lang, rules);
  if (lang === "he") return [`${to}, ${marker} ${me}`, body, end].filter(Boolean).join(", ") + (end ? "." : "");
  body = body.replace(/^by\b/i, "buy"); // the one homophone that opens an order
  body = body && body[0].toUpperCase() + body.slice(1);
  return [`${to}, ${marker} ${me}`, body, end].filter(Boolean).join(". ") + (body || end ? "." : "");
}

// relaxed tidies a message that has no "this is": "צבע 1 תפוס את דוד" or "vapour two attack
// gulf". Only a first word that sounds like a callsign and is followed by its number is
// respelled; the operator's name must be close to exact. Map points in the rest are snapped.
export function relaxed(heard, { lang, rules, typed = false }) {
  const text = heard.replace(/\s+/g, " ").trim();
  const m = /^([^\s,.:;!?]+)(?:[\s\-#]+([^\s,.:;!?]+))?/.exec(text);
  if (!m) return text;
  const cs = rules.callsigns;
  const close = (word, name) => similarity(word, name, lang);
  let head = "";
  let taken = 0;
  const number = m[2] ? numberOf(m[2], lang) : 0;
  const best = Object.values(cs.classes).map((c) => [close(m[1], c[lang]), c[lang]]).sort((a, b) => b[0] - a[0])[0];
  if (number && best[0] >= 0.6) {
    head = `${best[1]} ${number}`;
    taken = m[0].length;
  } else if (close(m[1], cs.operator[lang]) >= 0.8) {
    head = cs.operator[lang];
    taken = m[1].length;
  }
  return head + places(text.slice(taken), lang, rules, typed);
}

// tidy picks the right repair for a message: the full call when "this is" was said,
// otherwise the relaxed form. A typed message (`typed`) only has a misspelled callsign at
// its front put right; the rest is sent as the player wrote it.
export function tidy(heard, opts) {
  if (opts.typed) return relaxed(heard, opts);
  const full = normalize(heard, opts);
  return full !== heard.replace(/\s+/g, " ").trim() ? full : relaxed(heard, opts);
}
