// Scores the transcripts in assets/stt-eval/results against what was said.
//
//   node stt/eval/score.mjs [--misses <result name>] [--tidy-harm <result name>]
//
// For each result, language and kind of recording, as heard and again after the page's
// own tidying (client/voice/normalize.js):
//   words      word accuracy: 1 - (substitutions + insertions + deletions) / words said
//   callsigns  recordings in which every callsign said, with its number, was written
//   points     recordings in which every map point said was written (of those that name one)
//   exact      recordings written word for word
// Digits and number words count as the same word; case and punctuation are ignored.

import { readFileSync, readdirSync } from "node:fs";

import { tidy } from "../../client/voice/normalize.js";

const root = new URL("../../", import.meta.url);
const data = new URL("assets/stt-eval/", root);
const rules = JSON.parse(readFileSync(new URL("shared/rules.json", root)));
rules.map = rules.maps.large;
const index = JSON.parse(readFileSync(new URL("index.json", data)));

const numbers = {
  en: ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"],
  he: [["אחת", "אחד"], ["שתיים", "שתים", "שניים"], ["שלוש", "שלושה"], ["ארבע"], ["חמש"], ["שש"], ["שבע"], ["שמונה"], ["תשע"]],
};
function words(text, lang) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const n = numbers[lang].findIndex((forms) => [forms].flat().includes(w));
      return n < 0 ? w : String(n + 1);
    });
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

// names finds the callsigns (each with the number that follows it) and the map points in a call.
function names(ws, lang) {
  const cs = rules.callsigns;
  const stations = [cs.player, cs.operator, ...Object.values(cs.classes)].map((n) => n[lang].toLowerCase());
  const points = new Set(rules.map.points.map((p) => p.callsign[lang].toLowerCase()));
  const all = cs.allStations[lang].toLowerCase();
  const out = { callsigns: [], points: [] };
  if (ws.join(" ").includes(all)) out.callsigns.push(all);
  ws.forEach((w, i) => {
    // Hebrew glues "to", "in" and "and" to the front of a name.
    const bare = lang === "he" && !stations.includes(w) && !points.has(w) ? w.slice(1) : w;
    if (stations.includes(bare)) out.callsigns.push(/^\d+$/.test(ws[i + 1] ?? "") ? `${bare} ${ws[i + 1]}` : bare);
    else if (points.has(bare)) out.points.push(bare);
  });
  return out;
}

const within = (want, got) => want.every((n) => got.includes(n));

function score(items, textOf) {
  const s = { n: 0, said: 0, wrong: 0, callsigns: 0, withPoints: 0, points: 0, exact: 0, misses: [] };
  for (const item of items) {
    const ref = words(item.text, item.lang);
    const hyp = words(textOf(item), item.lang);
    const d = distance(ref, hyp);
    const [want, got] = [names(ref, item.lang), names(hyp, item.lang)];
    s.n++;
    s.said += ref.length;
    s.wrong += d;
    s.exact += d === 0;
    s.callsigns += within(want.callsigns, got.callsigns);
    if (want.points.length) {
      s.withPoints++;
      s.points += within(want.points, got.points);
    }
    if (d > 0) s.misses.push(`${item.file}\n   said:  ${item.text}\n   wrote: ${textOf(item)}`);
  }
  return s;
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : "-").padStart(7);
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const results = readdirSync(new URL("results/", data)).filter((f) => f.endsWith(".json")).sort();

console.log("result".padEnd(22), "lang kind    n  | as heard: words callsigns points   exact | tidied: words callsigns points   exact | median s");
for (const file of results) {
  const name = file.replace(/\.json$/, "");
  const res = JSON.parse(readFileSync(new URL(`results/${file}`, data)));
  for (const lang of ["he", "en"]) {
    for (const kind of ["clean", "noisy"]) {
      const items = index.filter((i) => i.lang === lang && i.kind === kind && res[i.file]);
      if (!items.length) continue;
      const raw = score(items, (i) => res[i.file].text);
      const done = score(items, (i) => tidy(res[i.file].text, { lang, rules }));
      const ms = items.map((i) => res[i.file].ms).sort((a, b) => a - b);
      const row = (s) => `${pct(s.said - s.wrong, s.said)} ${pct(s.callsigns, s.n)}  ${pct(s.points, s.withPoints)} ${pct(s.exact, s.n)}`;
      console.log(name.padEnd(22), lang.padEnd(4), kind.padEnd(5), String(items.length).padStart(3), " |          ", row(raw), "|        ", row(done), "|", (ms[ms.length >> 1] / 1000).toFixed(2));
      if (arg("--misses") === name) console.log(done.misses.join("\n"));
      if (arg("--tidy-harm") === name) {
        // Recordings the tidying made worse: what it changed, where the words were right or closer before.
        for (const i of items) {
          const ref = words(i.text, lang);
          const [before, after] = [distance(ref, words(res[i.file].text, lang)), distance(ref, words(tidy(res[i.file].text, { lang, rules }), lang))];
          if (after > before) console.log(`  worse ${i.file}\n   said:   ${i.text}\n   heard:  ${res[i.file].text}\n   tidied: ${tidy(res[i.file].text, { lang, rules })}`);
        }
      }
    }
  }
}
