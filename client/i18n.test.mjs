// The build fails on a missing string: Hebrew and English must carry the same keys with
// the same placeholders, and the page may only use keys that exist.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const en = JSON.parse(read("i18n/en.json"));
const he = JSON.parse(read("i18n/he.json"));
const page = read("index.html");
const script = read("debug.js");
const rules = JSON.parse(read("../shared/rules.json"));

// Keys built at run time, as `prefix.${value}`, and the values they can take.
const dynamic = {
  "event.": ["captured", "point_lost", "squad_spawned", "squad_lost", "enemy_destroyed", "hq_under_attack", "upgraded"],
  "over.": ["won", "lost", "draw", "hq_destroyed", "timer"],
  "kind.": Object.keys(rules.rigs),
};

test("Hebrew and English have the same strings", () => {
  assert.deepEqual(Object.keys(he).sort(), Object.keys(en).sort());
  const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const key of Object.keys(en)) {
    assert.ok(en[key].trim() && he[key].trim(), `${key} is empty`);
    assert.deepEqual(holes(he[key]), holes(en[key]), `${key} has different placeholders`);
  }
  assert.ok(/[֐-׿]/.test(he.title) && !/[֐-׿]/.test(en.title));
});

test("every string the page uses exists, and every string is used", () => {
  const used = new Set();
  for (const m of page.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)) used.add(m[1]);
  // Every quoted key in the first argument of t(…) or system(…), including keys picked by a condition.
  for (const call of script.matchAll(/\b(?:t|system)\(([^,)]*)/g)) {
    for (const m of call[1].matchAll(/"([^"]+)"/g)) used.add(m[1]);
  }
  for (const [prefix, values] of Object.entries(dynamic)) {
    assert.ok(script.includes(`\`${prefix}\${`), `debug.js no longer builds ${prefix} keys`);
    for (const v of values) used.add(prefix + v);
  }
  for (const key of used) assert.ok(key in en, `"${key}" is used but missing from en.json`);
  for (const key of Object.keys(en)) assert.ok(used.has(key), `"${key}" is in en.json but never used`);
});

test("no user-facing text is written into the page itself", () => {
  const text = page.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)[\s\S]*?<\/\1>/g, "").replace(/<[^>]+>/g, " ");
  assert.deepEqual(text.match(/[A-Za-z֐-׿]{2,}/g) ?? [], ["Callsign"], "only the fallback <title> may be literal");
});
