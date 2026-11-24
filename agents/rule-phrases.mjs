// What the rule brain says on the net. Every line is in shared/rules.json (radio.brain),
// in both languages, some in several wordings so that squads do not all sound alike. This
// file only picks a wording and fills in the names. It runs in Node and in a Web Worker.

const glue = { b: "ב", l: "ל", m: "מ" };

// heGlue puts a one-letter Hebrew word in front of a name: ב + "הגשר המערבי" is "בגשר המערבי".
export function heGlue(letter, name) {
  const s = String(name ?? "");
  return letter + (/^ה[א-ת]/.test(s) ? s.slice(1) : s);
}

// fill puts the values into a line. {name} is the value; {b_name}, {l_name} and {m_name}
// are the value behind the Hebrew letter (in, to, from).
export function fill(line, vars = {}) {
  return line.replace(/\{(?:([blm])_)?(\w+)\}/g, (all, letter, name) => {
    if (!(name in vars)) return all;
    return letter ? heGlue(glue[letter], vars[name]) : String(vars[name]);
  });
}

// phrase gives the line `key` in a language. `pick` chooses among its wordings; the same
// number always gives the same wording.
export function phrase(rules, lang, key, vars = {}, pick = 0) {
  const entry = rules.radio?.brain?.[key];
  if (!entry) throw new Error(`rules.json has no brain line "${key}"`);
  const list = entry[lang === "he" ? "he" : "en"];
  return fill(list[Math.abs(Math.trunc(pick)) % list.length], vars);
}

// wordings is how many ways a line can be said.
export const wordings = (rules, key) => rules.radio?.brain?.[key]?.en.length ?? 0;

// pointName is a map point's callsign in a language; placeName a landmark's or a bridge's
// name, or a point's callsign, or the id itself when the map has no such thing.
export const pointName = (rules, id, lang) => rules.map.points.find((p) => p.id === id)?.callsign[lang] ?? id;
export function placeName(rules, id, lang) {
  const mark = [...(rules.map.landmarks ?? []), ...(rules.map.bridges ?? []), ...(rules.map.techBuildings ?? [])].find((p) => p.id === id);
  return mark?.name?.[lang] ?? pointName(rules, id, lang);
}
export const targetName = (rules, id, lang) => `${rules.callsigns.contact[lang]} ${id}`;
