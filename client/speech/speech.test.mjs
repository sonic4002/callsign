import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Queue } from "./queue.js";
import { casts, filler, speakable, voiceFor } from "./text.js";

const rules = JSON.parse(readFileSync(new URL("../../shared/rules.json", import.meta.url), "utf8"));
rules.map ??= rules.maps.small; // the default map, as the server sends it to a page
const table = JSON.parse(readFileSync(new URL("../../tts/pronounce.json", import.meta.url), "utf8"));

test("speakable: Hebrew squad numbers are said as on the net, other numbers are left alone", () => {
  const m = { lang: "he", text: "פטיש, כאן צפע 2, המתן, סוף." };
  assert.equal(speakable(m, rules), "פטיש, כאן צפע שתיים, המתן, סוף.");
  assert.equal(speakable({ lang: "he", text: "קרנף 1 וכריש-12, כאן סדן. 250 זהב. עבור." }, rules), "קרנף אחת וכריש שתים עשרה, כאן סדן. 250 זהב. עבור.");
  assert.equal(speakable({ lang: "en", text: "Hammer, this is Viper 2. Wilco. Out." }, rules), "Hammer, this is Viper 2. Wilco. Out.");
});

test("speakable: markup and emoji are removed, long text is cut at a sentence, silence stays silent", () => {
  assert.equal(speakable({ lang: "en", text: "Hammer, this is **Anvil**. <b>Wilco</b> 👍  Out" }, rules), "Hammer, this is Anvil . b Wilco /b Out.");
  const long = "Hammer, this is Anvil. " + "Holding the line at Foxtrot with two teams. ".repeat(12) + "Over.";
  const cut = speakable({ lang: "en", text: long }, rules);
  assert.ok(cut.length <= 300 && cut.endsWith("teams."), cut);
  assert.equal(speakable({ lang: "en", text: " *** " }, rules), "");
  assert.equal(speakable({ lang: "en" }, rules), "");
});

test("voiceFor: stable per station, different between squads and between factions", () => {
  const v1 = voiceFor({ key: "infantry-1" }, "aegis");
  assert.deepEqual(v1, voiceFor({ key: "infantry-1" }, "aegis"));
  const names = ["infantry-1", "infantry-2", "vehicle-1", "naval-1", "operator"].map((key) => voiceFor({ key }, "aegis").name);
  assert.equal(new Set(names).size, names.length);
  const other = new Set([...casts.ashfall.squads, casts.ashfall.operator]);
  assert.ok(names.every((n) => !other.has(n)), "the factions share no voice");
  // A service with other voices still gives every station one of its own, the same each time.
  const offered = ["x", "y", "z"];
  assert.ok(offered.includes(voiceFor({ key: "infantry-1" }, "aegis", offered).name));
  assert.deepEqual(voiceFor({ key: "infantry-1" }, "aegis", offered), voiceFor({ key: "infantry-1" }, "aegis", offered));
});

test("filler: only a bare Stand by", () => {
  assert.equal(filler({ prowords: ["standBy"], body: "Stand by" }), true);
  assert.equal(filler({ prowords: ["standBy"], body: "Stand by, moving to Foxtrot now and engaging" }), false);
  assert.equal(filler({ prowords: ["wilco"], body: "Wilco" }), false);
});

test("queue: in order, one at a time, a Stand by gives way to the same station's answer", () => {
  const q = new Queue();
  const dropped = [];
  const line = (id, station, at, isFiller = false) => ({ id, text: id, station, at, filler: isFiller, cancel: () => dropped.push(id) });
  q.push(line("standby", "infantry-2", 0, true));
  q.push(line("other", "infantry-1", 100));
  q.push(line("answer", "infantry-2", 200));
  assert.deepEqual(dropped, ["standby"]);
  assert.equal(q.next(300).id, "other");
  assert.equal(q.next(300).id, "answer");
  assert.equal(q.next(300), null);
});

test("queue: a backlog drops the oldest and the stale, never the newest", () => {
  const q = new Queue({ staleMs: 9000, max: 3 });
  const dropped = [];
  for (let i = 0; i < 5; i++) q.push({ id: i, text: "line", station: `s${i}`, at: i * 1000, cancel: () => dropped.push(i) });
  assert.deepEqual(dropped, [0, 1]);
  assert.equal(q.next(12500).id, 4); // 2 and 3 waited more than 9 s
  assert.deepEqual(dropped, [0, 1, 2, 3]);
  q.push({ id: "old", station: "a", at: 0 });
  assert.equal(q.next(60000).id, "old"); // alone, so still heard
});

test("queue: a station repeating itself at once is heard once", () => {
  const q = new Queue();
  const line = (at, text = "Taking losses at Alpha") => ({ station: "infantry-1", text, at });
  assert.equal(q.push(line(0)), true);
  assert.equal(q.push(line(40)), false);
  assert.equal(q.next(50).at, 0);
  assert.equal(q.push(line(900)), false, "also right after it was played");
  assert.equal(q.push(line(900, "Pinned at Alpha")), true);
  assert.equal(q.push(line(20000)), true, "later, the same words are news again");
  assert.equal(q.push({ station: "infantry-2", text: "Taking losses at Alpha", at: 20010 }), true);
});

test("pronunciation table: every Hebrew callsign and map point has a pinned reading", () => {
  const names = [...rules.map.points.map((p) => p.callsign.he), ...Object.values(rules.callsigns.classes).map((c) => c.he), rules.callsigns.player.he, rules.callsigns.operator.he];
  assert.deepEqual(names.filter((n) => !table.he[n]?.ipa), []);
  for (const word of [rules.radio.over.he, rules.radio.out.he]) assert.ok(table.he[word]?.last, `${word} is pinned as a closing word`);
});

test("queue: what is said to the player is kept and heard before chatter between stations", () => {
  const q = new Queue();
  const line = (station, text, at, direct = false) => ({ station, text, at, direct });
  q.push(line("infantry-1", "to anvil 1", 0));
  q.push(line("infantry-2", "wilco", 100, true));
  q.push(line("infantry-3", "to anvil 2", 200));
  q.push(line("infantry-4", "to anvil 3", 300));
  q.push(line("infantry-5", "to anvil 4", 400));
  assert.equal(q.size, 3);
  assert.equal(q.next(500).text, "wilco");
  // Twelve seconds on, the chatter is stale but a waiting answer to the player is not.
  q.push(line("infantry-6", "contact", 600, true));
  q.push(line("infantry-7", "newest chatter", 12_000));
  assert.equal(q.next(12_500).text, "contact");
  assert.equal(q.next(12_600).text, "newest chatter");
  assert.equal(q.next(12_700), null);
});
