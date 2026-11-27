// Writes the hints the page would send (client/voice/hints.js), for run.py:
// assets/stt-eval/hints.json = { list: { he, en }, calls: { he, en } }.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { hintCalls, hintWords } from "../../client/voice/hints.js";

const root = new URL("../../", import.meta.url);
const rules = JSON.parse(readFileSync(new URL("shared/rules.json", root)));
rules.map = rules.maps.large; // fifteen points: the recordings name none of the six that only the huge map has
const out = { list: {}, calls: {} };
for (const lang of ["he", "en"]) {
  out.list[lang] = hintWords(rules, lang).join(", ");
  out.calls[lang] = hintCalls(rules, lang);
}
mkdirSync(new URL("assets/stt-eval/", root), { recursive: true });
writeFileSync(new URL("assets/stt-eval/hints.json", root), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
