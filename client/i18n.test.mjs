// The build fails on a missing string: Hebrew and English must carry the same keys with
// the same placeholders, and the page may only use keys that exist.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const en = JSON.parse(read("i18n/en.json"));
const he = JSON.parse(read("i18n/he.json"));
// What the panel does directly can still be said on the radio; those calls are kept for the tests.
const radio = JSON.parse(read("testdata/radio-calls.json"));
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
    "structure_captured_tech", "structure_seen_taken",
    "garrisoned", "building_fell", "bridge_under_attack", "bridge_fell", "bridge_repaired",
    "deploy_lost", "deploy_cancelled", "rally_set", "rally_home",
    "low_power", "power_restored", "structure_sold", "structure_repaired", "repair_stopped",
    "hero_fielded", "enemy_hero_fielded", "hero_fell", "enemy_hero_fell", "charge_planted", "charge_blew", "fortified", "crushed", "promoted",
    "squad_seized", "squad_taken", "squad_returned", "squad_released"],
  "radar.": ["none", "rising", "dark"],
  "over.": ["won", "lost", "draw", "hq_destroyed", "timer", "timer_hq", "timer_force"],
  "order.": ["none", "move", "hold", "attack", "repair", "fortify", "plant", "seize"],
  "call.": ["hold", "move", "attack", "cover", "upgrade", "give", "take", "grant", "revoke", "attackStructure", "capture", "haul", "captureTech", "attackStructureTech", "mend", "fortify", "plant", "plantStructure", "seize"],
  "eventMany.": ["squad_spawned", "squad_lost", "enemy_destroyed", "structure_built"],
  "placer.why.": ["far", "ground", "shore", "room", "edge"],
  "run.": ["ns", "ew", "nesw", "nwse"],
  "haul.": ["out", "loading", "returning", "unloading", "fleeing", "waiting"],
  "bearing.": ["N", "NE", "E", "SE", "S", "SW", "W", "NW"],
  "voice.": ["asking", "loading", "listening", "working", "unsupported", "insecure", "denied", "missing", "nothing", "failed"],
  "side.": ["0", "1"],
  "brains.": ["server", "relay", "demo", "fast", "standby"],
  "lobby.about.": ["easy", "normal", "standard"],
  "lobby.speedAbout.": ["relaxed", "normal", "fast"],
  "lobby.speed.": ["relaxed", "normal", "fast"],
  "agents.": ["relay", "demo", "fast", "server", "paused", "stopped", "skipped"],
  "provider.": ["anthropic", "openrouter", "gemini", "openai"],
  "tut.": ["welcome", "select", "order", "answer", "orders", "cover", "power", "refinery", "fog", "barracks", "buy", "deploy", "upgrade", "enemy", "voice", "win"],
  "tutTouch.": ["select", "order", "power", "refinery", "buy", "upgrade", "enemy"],
  "monitor.state.": ["none", "idle", "thinking", "acting", "skipped", "stopped", "offline", "ended"],
  "monitor.woke.": ["call", "heard", "event"],
  "monitor.event.": ["contact", "pinned", "losses", "arrived", "squad_lost", "point_lost", "hq_under_attack", "other"],
  "monitor.brain.": ["subscription", "claude", "relay", "rule", "jev", "other"],
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
      const text = fill(strings[`call.${kind}`], { ...names, unit: "x" });
      assert.ok(text.startsWith(`${names.to}, ${rules.radio.marker[lang]} ${names.from}`), `${lang} call.${kind} does not open with the call: ${text}`);
      assert.ok(text.toLowerCase().replace(/[.\s]+$/, "").endsWith(end), `${lang} call.${kind} does not end with Over: ${text}`);
    }
    assert.ok(strings.callPrefix.includes(rules.radio.marker[lang]));
  }
});

// The buttons are only useful if the agents understand what they write. The scripted
// brains are the strictest readers, so every call is run through them.
test("the scripted operator and squad leaders understand the calls the page writes, and the calls for what the panel does directly", async () => {
  const { ruleBrain } = await import("../agents/brain-rule.mjs");
  const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
  const hammer = { key: "player", en: rules.callsigns.player.en };
  for (const [lang, strings] of [["en", { ...en, ...radio.en }], ["he", { ...he, ...radio.he }]]) {
    const from = rules.callsigns.player[lang];
    // The body is what the server hands the agent: the call without its opening and its Over.
    const body = (text) => text.slice(text.indexOf(from) + from.length).replace(/^[\s,.]+/, "").replace(new RegExp(`[\\s,.]*${rules.radio.over[lang]}[\\s.]*$`), "");
    const think = async (role, callBody, extra = {}) => {
      const msg = { from: hammer, lang, body: callBody, end: "over", prowords: [], points: [], ...extra };
      const res = await ruleBrain().think({
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
    // A fence turned by the player: the call says which way it runs, and the operator passes that on.
    for (const [run, said] of [["ns", "north-south"], ["ew", "east-west"], ["nesw", "northeast-southwest"], ["nwse", "northwest-southeast"]]) {
      for (const [faction, id] of [["aegis", "barrierWall"], ["ashfall", "wireFence"]]) {
        const def = rules.factions[faction].structures[id];
        const text = fill(strings["call.buildRun"], { to: rules.callsigns.operator[lang], from, structure: def.name[lang], run: strings[`run.${run}`], place: words });
        const use = await think("anvil", body(text), { points: ["A"], status: { faction, squads: [], points: [], gold: 999 } });
        assert.deepEqual([use?.name, use?.input.structure, use?.input.place, use?.input.run], ["build", id, words, said], `${lang}: "${text}" should build ${id} running ${said}`);
      }
    }
    const delta = rules.map.points.find((p) => p.id === "D");
    const rally = await think("anvil", body(fill(strings["call.rally"], { to: rules.callsigns.operator[lang], from, point: delta.callsign[lang] })), { points: ["D"], status: { faction: "aegis", squads: [], points: [], gold: 0 } });
    assert.deepEqual([rally?.name, rally?.input.place], ["rally", "D"], `${lang}: the rally call`);
    const home = await think("anvil", body(fill(strings["call.rallyHome"], { to: rules.callsigns.operator[lang], from })), { status: { faction: "aegis", squads: [], points: [], gold: 0 } });
    assert.deepEqual([home?.name, home?.input.place], ["rally", "home"], `${lang}: the rally-home call`);
    // The calls of a structure's own menu: where its squads gather (a point, a tech
    // building, or back beside it), its sale and its repair. A second structure of the
    // kind is told apart by its id in the call.
    const site = rules.map.techBuildings[0];
    const own = (id, kind, role) => ({ id, kind, role, faction: "aegis", side: 0, x: 1, y: 2, hp: 0.5, building: 1, name: rules.factions.aegis.structures[kind].name.en });
    const base = { faction: "aegis", squads: [], points: [], gold: 0, structures: [own("s2", "barracks", "barracks"), own("s9", "barracks", "barracks"), own("s4", "vehicleWorks", "works"), { id: "s20", kind: site.kind, role: "tech", faction: "tech", side: -1, x: 3, y: 4, hp: 1, building: 1, site: site.name.en, siteHe: site.name.he }] };
    const to = rules.callsigns.operator[lang];
    const works = rules.factions.aegis.structures.vehicleWorks.name[lang];
    const second = `${rules.factions.aegis.structures.barracks.name[lang]} s9`;
    const from1 = await think("anvil", body(fill(strings["call.rallyFrom"], { to, from, structure: works, point: delta.callsign[lang] })), { points: ["D"], status: base });
    assert.deepEqual([from1?.name, from1?.input.place, from1?.input.structure], ["rally", "D", "s4"], `${lang}: the works' rally call`);
    const from2 = await think("anvil", body(fill(strings["call.rallyFrom"], { to, from, structure: second, point: site.name[lang] })), { status: base });
    assert.deepEqual([from2?.name, from2?.input.place, from2?.input.structure], ["rally", "s20", "s9"], `${lang}: the second barracks rallies at a tech building`);
    const from3 = await think("anvil", body(fill(strings["call.rallyFromHome"], { to, from, structure: works })), { status: base });
    assert.deepEqual([from3?.name, from3?.input.place, from3?.input.structure], ["rally", "home", "s4"], `${lang}: the works' rally-home call`);
    const sold = await think("anvil", body(fill(strings["call.sell"], { to, from, structure: second })), { status: base });
    assert.deepEqual([sold?.name, sold?.input.place], ["sell", "s9"], `${lang}: the sale of the second barracks`);
    const mended = await think("anvil", body(fill(strings["call.repairStructure"], { to, from, structure: works })), { status: base });
    assert.deepEqual([mended?.name, mended?.input.place], ["repair", "s4"], `${lang}: the repair call`);
    const point = rules.map.points.find((p) => p.id === "F");
    for (const verb of ["hold", "move", "attack"]) {
      const text = fill(strings[`call.${verb}`], { to: rules.callsigns.classes.infantry[lang] + " 2", from, point: point.callsign[lang] });
      const use = await think("squad", body(text), { points: ["F"] });
      assert.deepEqual([use?.name, use?.input.place], [verb, "F"], `${lang}: "${text}" should ${verb} F`);
    }
  }
});
