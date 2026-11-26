// What a radio message becomes before it is spoken, and which voice says it.
// Pure functions: no audio and no page, so they are tested in Node.

const MAX_CHARS = 300;

// Squad numbers are said the way they are on a Hebrew net: צפע שתיים, קרנף אחת.
const heNumbers = ["", "אחת", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע", "עשר", "אחת עשרה", "שתים עשרה", "שלוש עשרה", "ארבע עשרה", "חמש עשרה", "שש עשרה", "שבע עשרה", "שמונה עשרה", "תשע עשרה", "עשרים"];

// speakable returns the text to say for a message, or "" when there is nothing to say.
// The device's own voice, used when the speech service has no recording in time, guesses
// Hebrew vowels and gets the radio's words wrong ("suf" for סוף). Written with their
// vowel points it reads them right.
const pointedWords = { סוף: "סוֹף", עבור: "עֲבוֹר", רות: "רוּת", צפע: "צֶפַע", קרנף: "קַרְנַף", שביט: "שָׁבִיט", סדן: "סַדָּן", פטיש: "פַּטִּישׁ", סמל: "סַמָּל", המתן: "הַמְתֵּן", סוללת: "סוֹלְלַת", נון: "נוּן", מם: "מֵם" };
export function pointed(text) {
  return text.replace(/[\u05d0-\u05ea]+/g, (word) => pointedWords[word] ?? word);
}

export function speakable(message, rules) {
  const lang = message.lang === "he" ? "he" : "en";
  let text = String(message.text ?? "")
    // The anti-aircraft abbreviation is said by its letters: "nun-mem".
    .replace(/נ["״”]מ/g, "נון מם")
    // Letters, digits and plain punctuation only: no markup, emoji or control characters.
    .replace(/[^\p{L}\p{N}\p{M}\s.,;:!?'"()%$\/+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!/[\p{L}\p{N}]/u.test(text)) return "";
  if (lang === "he") {
    for (const c of Object.values(rules.callsigns.classes)) {
      text = text.replace(new RegExp(`(${c.he})[\\s-]*(\\d{1,2})(?!\\d)`, "g"), (all, name, n) => (heNumbers[Number(n)] ? `${name} ${heNumbers[Number(n)]}` : all));
    }
  }
  if (text.length > MAX_CHARS) {
    // Cut at the last sentence that fits; a run-on with no full stop is cut at a word.
    const head = text.slice(0, MAX_CHARS);
    const stop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
    text = stop > MAX_CHARS / 3 ? head.slice(0, stop + 1) : head.slice(0, head.lastIndexOf(" ")) + ".";
  }
  return /[.!?]$/.test(text) ? text : text + ".";
}

// filler is true for a message that only buys time ("Stand by"). It is dropped from the
// queue when the same station's real answer is already waiting behind it.
export const filler = (message) => (message.prowords ?? []).includes("standBy") && (message.body ?? "").length < 24;

// Each faction has its own pool of voices, so the two sides never sound alike. Squads take
// theirs by class and number, the operator has one of its own.
export const casts = {
  aegis: { operator: "tamar", squads: ["adam", "daniel", "maya", "david", "michael", "noa"], rate: 1 },
  ashfall: { operator: "sara", squads: ["jonathan", "ethan", "lily", "ariel", "shira", "yael"], rate: 1.05 },
};
const classOffset = { infantry: 0, vehicle: 2, naval: 4, air: 5 };

// voiceFor picks a station's voice. The same station gets the same voice for the whole
// match and in every match. `available` is the list the speech service offers.
export function voiceFor(station, faction, available) {
  const cast = casts[faction] ?? casts.aegis;
  let name = cast.operator;
  const squad = /^([a-z]+)-(\d+)$/.exec(station?.key ?? "");
  if (squad) name = cast.squads[((classOffset[squad[1]] ?? 0) + Number(squad[2]) - 1) % cast.squads.length];
  if (available?.length && !available.includes(name)) {
    const all = [...available].sort();
    let h = 0;
    for (const ch of `${faction}:${station?.key}`) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    name = all[h % all.length];
  }
  return { name, rate: cast.rate };
}
