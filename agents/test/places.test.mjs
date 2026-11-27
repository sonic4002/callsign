// Places, cover and bridges as the agents see and use them.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { compactStatus, renderWake } from "../agent.mjs";
import { ruleBrain } from "../brain-rule.mjs";
import { leaderPrompt, operatorPrompt } from "../prompts.mjs";
import { leaderTools, leaderToolsFor, normalize } from "../tools.mjs";

const rules = JSON.parse(readFileSync(new URL("../../shared/rules.json", import.meta.url)));
rules.map ??= rules.maps.small; // the default map, as the server sends it to a page
const viper2 = { key: "infantry-2", en: "Viper 2", he: "צפע 2", squad: 2 };
const hammer = { key: "player", en: "Hammer", he: "פטיש" };
const leader = { role: "squad", side: 0, squad: 2, tier: 1, station: viper2, lang: "en" };

async function think(brain, ctx) {
  const messages = [{ role: "user", content: "wake" }];
  const calls = [];
  for (let i = 0; i < 6; i++) {
    const res = await brain.think({ rules, messages, ...ctx });
    messages.push({ role: "assistant", content: res.content });
    const uses = res.content.filter((b) => b.type === "tool_use");
    if (!uses.length) return calls;
    calls.push(...uses.map((u) => [u.name, u.input]));
    messages.push({ role: "user", content: uses.map((u) => ({ type: "tool_result", tool_use_id: u.id, content: "{}" })) });
  }
  assert.fail("the brain never ended its turn");
}

const call = (body, extra = {}) => ({ from: hammer, to: [viper2], lang: "en", body, end: "over", points: [], prowords: [], ...extra });
const wake = (c) => ({ items: [{ kind: "radio", msg: c }], call: c, status: null });

test("leaders' orders take a place, and only engineers get repair", () => {
  for (const name of ["move", "hold", "attack"]) {
    const t = leaderTools.find((x) => x.name === name);
    assert.ok(t.input_schema.properties.place, `${name} takes a place`);
    assert.equal(t.input_schema.properties.point, undefined);
    assert.match(t.input_schema.properties.place.description, /landmark|Place to attack/);
  }
  assert.deepEqual(leaderToolsFor({ repairPerSecond: 0 }).map((t) => t.name), leaderTools.map((t) => t.name));
  assert.deepEqual(leaderToolsFor({ repairPerSecond: 40 }).map((t) => t.name).at(-1), "repair");
  assert.deepEqual(normalize("hold", { place: "here" }), {});
  assert.deepEqual(normalize("attack", { place: "", contact: 4 }), { contact: 4 });
  assert.deepEqual(normalize("hold", { place: "F-house-1" }), { place: "F-house-1" });
});

test("prompts list the map's landmarks and bridges in both languages, and say how places work", () => {
  const unit = rules.factions.aegis.units.commandos;
  const text = leaderPrompt({ rules, side: 0, faction: "aegis", station: viper2, unit });
  for (const l of rules.map.landmarks) assert.ok(text.includes(l.id) && text.includes(l.name.en) && text.includes(l.name.he), l.id);
  for (const b of rules.map.bridges) assert.ok(text.includes(b.id) && text.includes(b.name.en) && text.includes(b.name.he), b.id);
  assert.match(text, new RegExp(`room for ${rules.landmarkKinds.bunker.garrison} fireteams`));
  assert.match(text, /ice can be crossed but slowly/);
  assert.match(text, /fit more than one landmark/);
  assert.doesNotMatch(text, /waterY|undefined/);
  assert.doesNotMatch(text, /\(or repair/);
  assert.match(leaderPrompt({ rules, side: 0, faction: "aegis", station: viper2, unit: { ...unit, repairPerSecond: 40 } }), /\(or repair, for a bridge\)/);
  assert.match(operatorPrompt({ rules, side: 0, faction: "aegis" }), /bridge-south/);
  // The same on the bigger maps, which have more points: every one is in the prompt.
  for (const id of ["large", "huge"]) {
    const on = { ...rules, map: rules.maps[id] };
    const big = leaderPrompt({ rules: on, side: 0, faction: "aegis", station: viper2, unit });
    for (const p of on.map.points) assert.ok(big.includes(p.callsign.en) && big.includes(p.callsign.he), `${id}: ${p.id}`);
    for (const b of on.map.bridges) assert.ok(big.includes(b.id), `${id}: ${b.id}`);
  }
  assert.equal(rules.maps.huge.points.length, 21);
});

test("rule-brain leader on the huge map: an order to each of its points, in both languages, is that order", async () => {
  const brain = ruleBrain();
  const huge = { ...rules, map: rules.maps.huge };
  const orders = { en: [["move", "Move to {p}"], ["hold", "Hold {p}"], ["attack", "Attack {p}"]], he: [["move", "נועו ל{p}"], ["hold", "תחזיקו את {p}"], ["attack", "תקפו את {p}"]] };
  for (const p of huge.map.points) {
    for (const lang of ["en", "he"]) {
      for (const [tool, words] of orders[lang]) {
        // A boat's point is not for a squad on foot; the brain's answer to that is its own test.
        if (p.kind === "seaRig" || (p.kind === "hq" && tool !== "move")) continue;
        const body = words.replace("{p}", p.callsign[lang]);
        const did = await think(brain, { rules: huge, agent: { ...leader, lang }, wake: wake(call(body, { lang, points: [p.id] })) });
        assert.equal(did[0]?.[0], tool, `${body}: ${JSON.stringify(did)}`);
        assert.equal(did[0][1].place, p.id, body);
      }
    }
  }
  // Words that only sound like a point of this map are still the order they are.
  for (const [body, lang, want] of [["שמרו על שמיר", "he", ["hold", "W"]], ["Guard Whiskey", "en", ["hold", "W"]], ["נועו לחוה ושמרו עליה", "he", ["hold", "E"]]]) {
    const did = await think(brain, { rules: huge, agent: { ...leader, lang }, wake: wake(call(body, { lang, points: [want[1]] })) });
    assert.deepEqual([did[0]?.[0], did[0]?.[1].place], want, `${body}: ${JSON.stringify(did)}`);
  }
});

test("rule-brain leader: goes to a described landmark, asks when the words fit several", async () => {
  const brain = ruleBrain();
  assert.deepEqual(await think(brain, { agent: leader, wake: wake(call("Take cover in the bunker at Delta", { points: ["D"], landmarks: ["D-bunker-1"] })) }), [
    ["hold", { place: "D-bunker-1" }],
    ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }],
  ]);
  assert.deepEqual(await think(brain, { agent: leader, wake: wake(call("תפסו מחסה בבית שמצפון לפסל", { lang: "he", points: ["F"], landmarks: ["F-house-1"] })) }), [
    ["hold", { place: "F-house-1" }],
    ["radio", { to: ["Hammer"], body: "רות, יבוצע", end: "out" }],
  ]);
  assert.deepEqual(await think(brain, { agent: leader, wake: wake(call("Move to the grove north of Alpha", { points: ["A"], landmarks: ["A-grove-1"] })) }), [
    ["move", { place: "A-grove-1" }],
    ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }],
  ]);
  assert.deepEqual(await think(brain, { agent: leader, wake: wake(call("Attack the south bridge", { landmarks: ["bridge-south"] })) }), [
    ["attack", { place: "bridge-south", contact: 0 }],
    ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }],
  ]);
  // Two houses fit: it asks, naming them, and does nothing.
  assert.deepEqual(await think(brain, { agent: leader, wake: wake(call("Get into the house at Foxtrot", { points: ["F"], landmarks: ["F-house-1", "F-house-4"] })) }), [
    ["radio", { to: ["Hammer"], body: "Say again: the house north of Foxtrot or the house south of Foxtrot?", end: "over" }],
  ]);
  assert.deepEqual(await think(brain, { agent: leader, wake: wake(call("היכנסו לבית בפסל", { lang: "he", points: ["F"], landmarks: ["F-house-1", "F-house-4"] })) }), [
    ["radio", { to: ["Hammer"], body: "אמור שנית: הבית מצפון לפסל או הבית מדרום לפסל?", end: "over" }],
  ]);
});

test("rule-brain leader: a spot off a point, repair, and plain cover", async () => {
  const brain = ruleBrain();
  // The server reads the direction and the distance from the words.
  assert.deepEqual(await think(brain, { agent: leader, wake: wake(call("Hold 200 metres north of Foxtrot", { points: ["F"] })) }), [
    ["hold", { place: "Hold 200 metres north of Foxtrot" }],
    ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }],
  ]);
  assert.deepEqual(await think(brain, { agent: leader, wake: wake(call("Repair the south bridge", { landmarks: ["bridge-south"] })) }), [
    ["repair", { place: "bridge-south" }],
    ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }],
  ]);
  assert.deepEqual(await think(brain, { agent: leader, wake: wake(call("Repair it")) }), [["radio", { to: ["Hammer"], body: "Say again: repair what?", end: "over" }]]);
  // "Take cover" with no place holds here: the fireteams find the cover themselves.
  assert.deepEqual(await think(brain, { agent: leader, wake: wake(call("Take cover")) }), [
    ["hold", { place: "here" }],
    ["radio", { to: ["Hammer"], body: "Wilco", end: "out" }],
  ]);
  // Going inside is reported by the landmark's name, in the net language.
  const inside = { items: [{ kind: "event", event: { kind: "garrisoned", point: "D", place: "D-bunker-1" } }], call: null, status: null };
  assert.deepEqual(await think(brain, { agent: { ...leader, commander: "Hammer" }, wake: inside }), [
    ["radio", { to: ["Hammer"], body: "Inside the bunker north of Delta", end: "over" }],
  ]);
  assert.deepEqual(await think(ruleBrain(), { agent: { ...leader, lang: "he", commander: "Hammer" }, wake: inside }), [
    ["radio", { to: ["Hammer"], body: "בתוך הבונקר מצפון לדוד", end: "over" }],
  ]);
});

test("a leader's status carries only what has changed on the ground", () => {
  const status = {
    timeLeft: 500,
    points: [{ id: "A", owner: 0 }],
    contacts: [],
    friends: [],
    you: { near: "D", x: 450, y: 620, order: { kind: "hold", place: "D-bunker-1" }, alive: 6, full: 6, tier: 1, contacts: [],
      teams: [{ nerve: "steady", action: "idle", in: "D-bunker-1", cover: 0.3 }, { nerve: "steady", action: "idle", cover: 0.65 }, { nerve: "steady", action: "advance" }] },
    landmarks: [
      { id: "D-bunker-1", name: "the bunker north of Delta", kind: "bunker", cover: 0.3, garrison: { side: 0, teams: 2 }, room: 0 },
      { id: "H-bunker-1", name: "the bunker north of Hotel", kind: "bunker", cover: 0.3, garrison: { side: 1, teams: 1 }, room: 0 },
      { id: "D-rocks-1", name: "the rocks east of Delta", kind: "rocks", cover: 0.6 },
      { id: "K-ruin-1", name: "the ruin east of Kilo", kind: "rubble", cover: 0.75 },
      { id: "bridge-west", name: "the west bridge", kind: "bridge", cover: 1 },
      { id: "bridge-east", name: "the east bridge", kind: "bridge", cover: 0.25 },
      { id: "bridge-south", name: "the south bridge", kind: "fallen bridge", cover: 0 },
    ],
  };
  const s = compactStatus(status, 0);
  assert.deepEqual(s.ground, [
    { id: "D-bunker-1", state: "held by your side, room for 0 more fireteams" },
    { id: "H-bunker-1", state: "held by the enemy, room for 0 more fireteams" },
    { id: "K-ruin-1", state: "fallen, now rubble" },
    { id: "bridge-east", state: "standing, 25% strength" },
    { id: "bridge-south", state: "fallen" },
  ]);
  assert.deepEqual(s.you.teams, ["steady, idle, inside D-bunker-1", "steady, idle, in cover", "steady, advance"]);
  assert.equal(compactStatus({ ...status, landmarks: [] }, 0).ground, undefined);

  const msg = { from: hammer, to: [viper2], lang: "en", text: "Viper 2, take cover in the bunker at Delta", points: ["D"], landmarks: ["D-bunker-1"] };
  const text = renderWake(
    [{ kind: "radio", msg }, { kind: "event", event: { kind: "bridge_fell", place: "bridge-south", count: 2 }, place: "the south bridge (bridge-south)" }],
    s,
    [],
  );
  assert.match(text, /Points named: D\. Landmarks its words fit: D-bunker-1\./);
  assert.match(text, /the south bridge \(bridge-south\) has fallen; 2 of your fireteams went down with it\./);
});
