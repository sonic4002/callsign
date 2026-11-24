// The build fails on a missing string: Hebrew and English must carry the same keys with
// the same placeholders, and the page may only use keys that exist.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const en = JSON.parse(read("i18n/en.json"));
const he = JSON.parse(read("i18n/he.json"));
const page = read("index.html");
// Every script of the page, one after the other.
const script = [...readdirSync(new URL(".", import.meta.url)), ...readdirSync(new URL("brains/", import.meta.url)).map((name) => `brains/${name}`)]
  .filter((name) => name.endsWith(".js"))
  .map(read)
  .join("\n");
const rules = JSON.parse(read("../shared/rules.json"));
rules.map ??= rules.maps.small; // the default map, as the server sends it to a page
rules.map ??= rules.maps.small; // the default map, as the server sends it to a page
const classes = [...new Set(Object.values(rules.factions).flatMap((f) => Object.values(f.units).map((u) => u.class)))];

// Keys built at run time, as `prefix.${value}`, and the values they can take.
const dynamic = {
  "event.": ["captured", "point_lost", "deploying", "squad_spawned", "squad_lost", "enemy_destroyed", "hq_under_attack", "upgraded", "hauler_attacked", "hauler_lost",
    "structure_started", "structure_built", "structure_attacked", "structure_lost", "structure_lost_theirs", "structure_captured", "structure_taken",
    "garrisoned", "building_fell", "bridge_under_attack", "bridge_fell", "bridge_repaired",
    "deploy_lost", "deploy_cancelled", "rally_set", "rally_home"],
  "over.": ["won", "lost", "draw", "hq_destroyed", "timer", "timer_hq", "timer_force"],
  "order.": ["none", "move", "hold", "attack", "repair"],
  "call.": ["hold", "move", "attack", "cover", "buy", "upgrade", "give", "take", "grant", "revoke", "attackStructure", "capture", "haul", "buildSpot", "cancel", "rally", "rallyHome"],
  "placer.why.": ["far", "ground", "shore", "room", "edge"],
  "haul.": ["out", "loading", "returning", "unloading", "fleeing", "waiting"],
  "bearing.": ["N", "NE", "E", "SE", "S", "SW", "W", "NW"],
  "voice.": ["asking", "loading", "listening", "working", "unsupported", "insecure", "denied", "missing", "nothing", "failed"],
  "class.": classes,
  "side.": ["0", "1"],
  "brains.": ["server", "relay", "demo", "standby"],
  "lobby.about.": ["easy", "normal", "standard"],
  "lobby.speedAbout.": ["relaxed", "normal", "fast"],
  "lobby.speed.": ["relaxed", "normal", "fast"],
  "agents.": ["relay", "demo", "server", "paused", "stopped", "skipped"],
  "provider.": ["anthropic", "openrouter", "gemini", "openai"],
  "tut.": ["welcome", "select", "order", "answer", "orders", "refinery", "fog", "barracks", "buy", "deploy", "upgrade", "enemy", "voice", "win"],
  "tutTouch.": ["select", "order", "refinery", "barracks", "buy", "upgrade", "enemy"],
  "monitor.state.": ["none", "idle", "thinking", "acting", "skipped", "stopped", "offline", "ended"],
  "monitor.woke.": ["call", "heard", "event"],
  "monitor.event.": ["contact", "pinned", "losses", "arrived", "squad_lost", "point_lost", "hq_under_attack", "other"],
  "monitor.brain.": ["subscription", "claude", "relay", "scripted", "demo", "other"],
  "monitor.where.": ["server", "browser"],
  "monitor.reset.": ["match", "wakes", "tier", "unfinished"],
  "monitor.why.": ["no_key", "bad_key", "rate_limited", "provider_error", "not_your_seat", "bad_request", "unreachable", "timeout", "stopped", "failed"],
  "trouble.": ["no_key", "bad_key", "rate_limited", "provider_error", "not_your_seat", "bad_request", "unreachable", "failed", "join"],
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
  for (const m of page.matchAll(/data-i18n(?:-placeholder|-aria)?="([^"]+)"/g)) used.add(m[1]);
  // Every quoted key in the first argument of t(…) or system(…), including keys picked by a condition.
  for (const call of script.matchAll(/\b(?:t|system)\(([^,)]*)/g)) {
    for (const m of call[1].matchAll(/"([^"]+)"/g)) used.add(m[1]);
  }
  // Lines the page speaks by itself, read from both tables at once and not through t().
  for (const m of script.matchAll(/strings\.en\.(\w+)/g)) used.add(m[1]);
  for (const [prefix, values] of Object.entries(dynamic)) {
    assert.ok(script.includes(`\`${prefix}\${`), `debug.js no longer builds ${prefix} keys`);
    for (const v of values) used.add(prefix + v);
  }
  for (const key of used) assert.ok(key in en, `"${key}" is used but missing from en.json`);
  for (const key of Object.keys(en)) assert.ok(used.has(key), `"${key}" is in en.json but never used`);
});

test("no user-facing text is written into the page itself", () => {
  const text = page.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)[\s\S]*?<\/\1>/g, "").replace(/<[^>]+>/g, " ");
  assert.deepEqual(text.match(/[A-Za-z\u0590-\u05ff]{2,}/g) ?? [], ["Callsign"], "only the fallback <title> may be literal");
});

// The sidebar's buttons write radio calls. They must come out in proper procedure, and
// in words the scripted operator and squad leaders understand, in both languages.
test("the calls the page writes are proper procedure in both languages", async () => {
  const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
  for (const [lang, strings] of [["en", en], ["he", he]]) {
    const names = { to: rules.callsigns.classes.infantry[lang] + " 2", from: rules.callsigns.player[lang], point: rules.map.points[5].callsign[lang], squad: rules.callsigns.classes.infantry[lang] + " 1" };
    const end = rules.radio.over[lang].toLowerCase();
    for (const kind of dynamic["call."]) {
      const text = fill(strings[`call.${kind}`], { ...names, class: strings["class.vehicle"], unit: "x" });
      assert.ok(text.startsWith(`${names.to}, ${rules.radio.marker[lang]} ${names.from}`), `${lang} call.${kind} does not open with the call: ${text}`);
      assert.ok(text.toLowerCase().replace(/[.\s]+$/, "").endsWith(end), `${lang} call.${kind} does not end with Over: ${text}`);
    }
    assert.ok(strings.callPrefix.includes(rules.radio.marker[lang]));
  }
});

// The buttons are only useful if the agents understand what they write. The scripted
// brains are the strictest readers, so every call is run through them.
test("the scripted operator and squad leaders understand the calls the page writes", async () => {
  const { scriptedBrain } = await import("../agents/brain-scripted.mjs");
  const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
  const hammer = { key: "player", en: rules.callsigns.player.en };
  for (const [lang, strings] of [["en", en], ["he", he]]) {
    const from = rules.callsigns.player[lang];
    // The body is what the server hands the agent: the call without its opening and its Over.
    const body = (text) => text.slice(text.indexOf(from) + from.length).replace(/^[\s,.]+/, "").replace(new RegExp(`[\\s,.]*${rules.radio.over[lang]}[\\s.]*$`), "");
    const think = async (role, callBody, extra = {}) => {
      const msg = { from: hammer, lang, body: callBody, end: "over", prowords: [], points: [], ...extra };
      const res = await scriptedBrain().think({
        rules,
        agent: { role, side: 0, station: { key: role === "anvil" ? "operator" : "infantry-2" }, lang },
        messages: [{ role: "user", content: "wake" }],
        wake: { call: msg, items: [{ kind: "radio", msg }], status: extra.status ?? null },
      });
      return res.content.find((b) => b.type === "tool_use");
    };
    for (const [faction, f] of Object.entries(rules.factions)) {
      for (const [id, unit] of Object.entries(f.units)) {
        const text = fill(strings["call.buy"], { to: rules.callsigns.operator[lang], from, class: strings[`class.${unit.class}`], unit: unit.name[lang] });
        const use = await think("anvil", body(text), { status: { faction, squads: [], points: [], gold: 999 } });
        assert.deepEqual([use?.name, use?.input.unit], ["buy", id], `${lang}: "${text}" should buy ${id}`);
      }
    }
    // The call a tap on a gold field writes sends the haulers there.
    for (const g of rules.map.gushers) {
      const named = rules.map.points.find((p) => p.id === g.point);
      const text = fill(strings["call.haul"], { to: rules.callsigns.operator[lang], from, point: named.callsign[lang] });
      const use = await think("anvil", body(text), { points: [g.point], status: { faction: "aegis", squads: [], points: [], gold: 0 } });
      assert.deepEqual([use?.name, use?.input.field], ["haul", g.point], `${lang}: "${text}" should send the haulers to ${g.point}`);
    }
    // Placing a structure writes the spot into the call; the operator passes the words on,
    // and they are the words the radio net reads back into a place (server/radio).
    const { spotAt, spotWords } = await import("./placement.js");
    const tr = (key, vars = {}) => fill(strings[key], vars);
    const alpha = rules.map.points.find((p) => p.id === "A");
    const spot = spotAt(rules, alpha.x + 60, alpha.y - 140);
    const words = spotWords(tr, spot, alpha.callsign[lang]);
    for (const [faction, f] of Object.entries(rules.factions)) {
      for (const [id, def] of Object.entries(f.structures)) {
        if (def.role === "hq") continue;
        const text = fill(strings["call.buildSpot"], { to: rules.callsigns.operator[lang], from, structure: def.name[lang], place: words });
        const use = await think("anvil", body(text), { points: ["A"], status: { faction, squads: [], points: [], gold: 999 } });
        assert.deepEqual([use?.name, use?.input.structure, use?.input.place], ["build", id, words], `${lang}: "${text}" should build ${id} on the spot`);
      }
      for (const [id, unit] of Object.entries(f.units)) {
        const text = fill(strings["call.cancel"], { to: rules.callsigns.operator[lang], from, unit: unit.name[lang] });
        const use = await think("anvil", body(text), { status: { faction, squads: [], points: [], gold: 0 } });
        assert.deepEqual([use?.name, use?.input.unit], ["cancel", id], `${lang}: "${text}" should cancel ${id}`);
      }
    }
    const delta = rules.map.points.find((p) => p.id === "D");
    const rally = await think("anvil", body(fill(strings["call.rally"], { to: rules.callsigns.operator[lang], from, point: delta.callsign[lang] })), { points: ["D"], status: { faction: "aegis", squads: [], points: [], gold: 0 } });
    assert.deepEqual([rally?.name, rally?.input.place], ["rally", "D"], `${lang}: the rally call`);
    const home = await think("anvil", body(fill(strings["call.rallyHome"], { to: rules.callsigns.operator[lang], from })), { status: { faction: "aegis", squads: [], points: [], gold: 0 } });
    assert.deepEqual([home?.name, home?.input.place], ["rally", "home"], `${lang}: the rally-home call`);
    const point = rules.map.points.find((p) => p.id === "F");
    for (const verb of ["hold", "move", "attack"]) {
      const text = fill(strings[`call.${verb}`], { to: rules.callsigns.classes.infantry[lang] + " 2", from, point: point.callsign[lang] });
      const use = await think("squad", body(text), { points: ["F"] });
      assert.deepEqual([use?.name, use?.input.place], [verb, "F"], `${lang}: "${text}" should ${verb} F`);
    }
  }
});
