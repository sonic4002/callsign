// End to end: the real game server, real WebSockets, the real agent loop. Only the model
// is replaced, by the scripted brain or by a fake Anthropic client.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { Agent } from "../agent.mjs";
import { claudeBrain } from "../brain-claude.mjs";
import { scriptedBrain } from "../brain-scripted.mjs";
import { Host } from "../main.mjs";

const bin = process.env.CALLSIGN_BIN;
const skip = bin ? false : "set CALLSIGN_BIN to the built game server (make test does)";
const clientDir = fileURLToPath(new URL("../../client", import.meta.url));

// `base` is what stands at the first tick: by default the base once the opening is done.
async function startServer(t, base = "refinery,barracks") {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(bin, ["-addr", `127.0.0.1:${port}`, "-bot", "", "-speed", "20", "-client", clientDir, "-base", base]);
  t.after(() => proc.kill());
  await new Promise((resolve, reject) => {
    proc.stderr.on("data", (d) => String(d).includes("listening") && resolve());
    proc.on("exit", (code) => reject(new Error(`game server exited with ${code}`)));
  });
  // The line is logged a moment before the socket is bound: wait until it answers.
  for (let i = 0; i < 300; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/`);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  return `ws://127.0.0.1:${port}/ws`;
}

async function eventually(what, check, ms = 10000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

// Hammer is the human's connection: it sends typed radio and reads frames in order.
class Hammer {
  frames = [];
  cursor = 0;

  static async join(t, server) {
    const h = new Hammer();
    h.ws = new WebSocket(`${server}?side=0&role=hammer`);
    t.after(() => h.ws.close());
    h.ws.addEventListener("message", (ev) => h.frames.push(JSON.parse(ev.data)));
    await eventually("Hammer's greeting", () => h.frames.some((f) => f.type === "hello"));
    return h;
  }

  say(text) {
    this.ws.send(JSON.stringify({ type: "radio", text }));
  }

  // next returns the first frame not yet consumed that matches, waiting for it if needed.
  async next(what, match) {
    let found;
    await eventually(what, () => {
      const i = this.frames.findIndex((f, at) => at >= this.cursor && match(f));
      if (i < 0) return false;
      found = this.frames[i];
      this.cursor = i + 1;
      return true;
    });
    return found;
  }

  async hears(from) {
    // What the station itself said: the base cues the server words in Anvil's name are not that.
    return (await this.next(`a transmission from ${from}`, (f) => f.type === "radio" && f.message.from.en === from && !f.message.cue)).message.text;
  }

  // cues are the base cues heard so far, by kind.
  cues() {
    return this.frames.filter((f) => f.type === "radio" && f.message.cue).map((f) => [f.message.cue, f.message.text]);
  }

  radioLog() {
    return this.frames.filter((f) => f.type === "radio").map((f) => f.message.text);
  }
}

const squadIn = (frame, id) => frame.type === "state" && frame.state.squads.find((s) => s.id === id);

test("Hammer's orders reach scripted squads over the net, in both languages", { skip }, async (t) => {
  const server = await startServer(t);
  const host = new Host({ server, side: 0, brain: scriptedBrain(), log: () => {} });
  await host.start();
  t.after(() => host.stop());
  await eventually("Anvil and two squad leaders on the net", () => host.agents.size === 3 && host.ready);
  const hammer = await Hammer.join(t, server);

  // The Phase 0 line.
  hammer.say("Viper 2, this is Hammer. Hold Foxtrot. Over.");
  assert.equal(await hammer.hears("Viper 2"), "Hammer, this is Viper 2. Wilco. Out.");
  const held = await hammer.next("Viper 2 holding Foxtrot", (f) => squadIn(f, 2)?.order.point === "F");
  assert.equal(squadIn(held, 2).order.kind, "hold");
  assert.equal(squadIn(held, 1).order.kind, "none", "Viper 1 was not addressed");
  await hammer.next("Viper 2 arriving at Foxtrot", (f) => f.type === "event" && f.event.kind === "arrived" && f.event.squad === 2 && f.event.point === "F");
  assert.equal(await hammer.hears("Viper 2"), "Hammer, this is Viper 2. In position at Foxtrot. Over.");

  // The same in Hebrew, to the other squad.
  hammer.say("צפע 1, כאן פטיש, תחזיקו את גימל, עבור.");
  assert.equal(await hammer.hears("Viper 1"), "פטיש, כאן צפע 1, רות, יבוצע, סוף.");
  await hammer.next("Viper 1 holding Golf", (f) => squadIn(f, 1)?.order.point === "G");
  assert.equal(await hammer.hears("Viper 1"), "פטיש, כאן צפע 1, בעמדה בגימל, עבור.");

  // An order the game refuses comes back as Negative with the game's reason.
  hammer.say("Viper 1, this is Hammer. Hold Sierra. Over.");
  assert.match(await hammer.hears("Viper 1"), /^Hammer, this is Viper 1\. Negative, that squad cannot reach that place.* Over\.$/);

  // Procedure is enforced on the human too.
  hammer.say("Viper 1, this is Hammer. Hold Golf. Over and out.");
  assert.match((await hammer.next("a refusal", (f) => f.type === "refused")).reason, /never both/);

  // The build tree: a tank needs a works, and the refusal says so.
  hammer.say("Anvil, this is Hammer. Buy a tank. Over.");
  assert.match(await hammer.hears("Anvil"), /^Hammer, this is Anvil\. Negative, a structure is missing: build a Vehicle Works first\. Over\.$/);
  // Anvil builds it, in Hebrew as well as in English, and the commander sees it go up.
  const asked = hammer.frames.length;
  hammer.say("סדן, כאן פטיש, בנה מפעל רכב, עבור.");
  assert.equal(await hammer.hears("Anvil"), "פטיש, כאן סדן, רות, יבוצע, סוף.");
  // The event and the acknowledgement race each other onto the net: look from the order on.
  const going = (f) => f.type === "event" && f.event.kind === "structure_started";
  await eventually("the works going up", () => hammer.frames.slice(asked).some(going));
  const started = hammer.frames.slice(asked).find(going);
  assert.equal(started.event.unit, "vehicleWorks");
  await hammer.next("the works standing", (f) => f.type === "event" && f.event.kind === "structure_built" && f.event.unit === "vehicleWorks");
  const works = hammer.frames.findLast((f) => f.type === "state").state.structures.find((s) => s.kind === "vehicleWorks");
  assert.equal(works.side, 0);
  // The operator says so by itself, in the language of the net, and nobody answers it.
  await hammer.next("the cue for the works", (f) => f.type === "radio" && f.message.cue === "newOptions");
  assert.deepEqual(hammer.cues().at(-1), ["newOptions", "פטיש, כאן סדן, הבנייה הושלמה: מפעל הרכב. נפתחו אפשרויות חדשות, סוף."]);

  // Anvil buys; the new squad gets its own leader, who answers a radio check.
  hammer.say("Anvil, this is Hammer. Buy a tank. Over.");
  assert.equal(await hammer.hears("Anvil"), "Hammer, this is Anvil. Wilco. Out.");
  await eventually("a leader for Rhino 1", () => host.agents.size === 4 && host.ready);
  hammer.say("Rhino 1, this is Hammer. Radio check. Over.");
  assert.equal(await hammer.hears("Rhino 1"), "Hammer, this is Rhino 1. Five by five. Out.");

  // No callsign: the operator takes it and tasks every squad that can get there.
  hammer.say("Hold Delta");
  assert.equal(await hammer.hears("Anvil"), "Viper 1, Viper 2 and Rhino 1, this is Anvil. Hold Delta. Over.");
  assert.equal(await hammer.hears("Anvil"), "Hammer, this is Anvil. Wilco. Out.");
  await eventually("all three squads holding Delta", () => {
    const state = hammer.frames.findLast((f) => f.type === "state").state;
    return state.squads.length === 3 && state.squads.every((s) => s.order.kind === "hold" && s.order.point === "D");
  });

  // Acknowledgements end with Out and wake nobody, so the net goes quiet by itself.
  const chatter = () => hammer.radioLog().filter((l) => !l.includes("In position"));
  await eventually("the squads' acknowledgements", () => chatter().filter((l) => l.startsWith("Anvil, this is ") && l.endsWith("Wilco. Out.")).length === 3);
  const settled = chatter().length;
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(chatter().length, settled, "the net kept talking after everyone acknowledged");
});

test("haulers work on their own, go where the operator sends them, and can be escorted", { skip }, async (t) => {
  const server = await startServer(t, "refinery,barracks,works") // more haulers come out of the works;
  const host = new Host({ server, side: 0, brain: scriptedBrain(), log: () => {} });
  await host.start();
  t.after(() => host.stop());
  await eventually("Anvil and two squad leaders on the net", () => host.agents.size === 3 && host.ready);
  const hammer = await Hammer.join(t, server);
  const haulers = (f) => (f.type === "state" ? f.state.haulers.filter((h) => h.side === 0) : []);

  // Nobody told it to: the starting hauler drives to the home field and loads.
  await hammer.next("the hauler loading at Bravo", (f) => haulers(f)[0]?.state === "loading" && haulers(f)[0].field === "B");
  const paid = await hammer.next("the first load home", (f) => f.type === "state" && f.state.income > 60 * 10 && haulers(f)[0]?.state !== "unloading");
  assert.ok(paid.state.gold > 300, "the load became gold to spend");

  hammer.say("Anvil, this is Hammer. Haulers to the Kilo field. Over.");
  assert.equal(await hammer.hears("Anvil"), "Hammer, this is Anvil. Wilco. Out.");
  await hammer.next("the hauler sent to Kilo", (f) => haulers(f)[0]?.assigned === "K");

  // A squad told to escort them holds the field they are working.
  await hammer.next("the hauler on its way to Kilo", (f) => haulers(f)[0]?.field === "K");
  hammer.say("Viper 2, this is Hammer. Escort the haulers. Over.");
  assert.equal(await hammer.hears("Viper 2"), "Hammer, this is Viper 2. Wilco. Out.");
  const guarding = await hammer.next("Viper 2 holding Kilo", (f) => squadIn(f, 2)?.order.point === "K");
  assert.equal(squadIn(guarding, 2).order.kind, "hold");

  // Buying one, in Hebrew: it is no squad, so no leader joins the net for it.
  hammer.say("סדן, כאן פטיש, קנה משאית זהב, עבור.");
  assert.equal(await hammer.hears("Anvil"), "פטיש, כאן סדן, רות, יבוצע, סוף.");
  const two = await hammer.next("a second hauler on the field", (f) => haulers(f).length === 2);
  assert.equal(two.state.squads.length, 2, "a hauler is not listed as a squad");
  assert.equal(host.agents.size, 3, "no agent was started for a hauler");
  hammer.say("Anvil, this is Hammer. Let the haulers choose on their own. Over.");
  assert.equal(await hammer.hears("Anvil"), "Hammer, this is Anvil. Wilco. Out.");
  await hammer.next("both haulers choosing for themselves", (f) => haulers(f).length === 2 && haulers(f).every((h) => !h.assigned));
});

test("the agent loop feeds a model's tool calls to the game and the results back", { skip }, async (t) => {
  const server = await startServer(t);
  const requests = [];
  const use = (id, name, input) => ({ type: "tool_use", id, name, input });
  const thinking = { type: "thinking", thinking: "", signature: "sig-1" };
  const script = [
    { delay: 300, content: [thinking, use("t1", "hold", { point: "Foxtrot" }), use("t2", "radio", { to: ["Hammer"], body: "Hammer, this is Viper 2. Wilco. Out.", end: "out" })], stop_reason: "tool_use" },
    { content: [{ type: "text", text: "Holding." }], stop_reason: "end_turn" },
    { content: [use("t3", "hold", { point: "Sierra" })], stop_reason: "tool_use" },
    { content: [use("t4", "radio", { to: ["Hammer"], body: "Negative, we cannot reach Sierra", end: "over" })], stop_reason: "tool_use" },
    { content: [{ type: "text", text: "" }], stop_reason: "end_turn" },
  ];
  const client = {
    messages: {
      create: async (params) => {
        requests.push(structuredClone(params));
        const { delay = 0, ...res } = script[requests.length - 1];
        await new Promise((resolve) => setTimeout(resolve, delay));
        return { ...res, model: params.model, usage: { input_tokens: 1, output_tokens: 1 } };
      },
    },
  };
  const agent = new Agent({ server, side: 0, role: "squad", squad: 2, brain: claudeBrain({ client }), log: () => {}, standByMs: 50 });
  await agent.start();
  t.after(() => agent.stop());
  const hammer = await Hammer.join(t, server);

  hammer.say("Viper 2, this is Hammer. Hold Foxtrot. Over.");
  // The model is slow, so the squad says so first; then the answer, with the call the
  // model wrote by habit replaced by the net's own.
  assert.equal(await hammer.hears("Viper 2"), "Hammer, this is Viper 2. Stand by. Out.");
  assert.equal(await hammer.hears("Viper 2"), "Hammer, this is Viper 2. Wilco. Out.");
  await hammer.next("Viper 2 holding Foxtrot", (f) => squadIn(f, 2)?.order.point === "F");
  await eventually("the second model call", () => requests.length === 2);

  const [first, second] = requests;
  assert.equal(first.model, "claude-haiku-5-5");
  assert.equal(first.messages.length, 1);
  assert.match(first.messages[0].content, /Radio call for you from Hammer, in English: "Viper 2, this is Hammer\. Hold Foxtrot\. Over\." Points named: F\./);
  assert.match(first.messages[0].content, /Status: \{"secondsLeft":/);
  assert.match(first.system, /You lead squad Viper 2/);
  // The assistant turn goes back whole, thinking block included, and both results return
  // together in one user message.
  assert.deepEqual(second.messages[1], { role: "assistant", content: script[0].content });
  assert.deepEqual(second.messages[2].content.map((r) => [r.type, r.tool_use_id, r.is_error ?? false]), [
    ["tool_result", "t1", false],
    ["tool_result", "t2", false],
  ]);
  assert.match(second.messages[2].content[1].content, /"sent":"Hammer, this is Viper 2\. Wilco\. Out\."/);

  // A refused order reaches the model as an error result, and it can answer for it.
  hammer.say("Viper 2, this is Hammer. Hold Sierra. Over.");
  assert.equal(await hammer.hears("Viper 2"), "Hammer, this is Viper 2. Negative, we cannot reach Sierra. Over.");
  await eventually("the last model call", () => requests.length === 5);
  const refused = requests[3].messages.at(-1).content[0];
  assert.equal(refused.is_error, true);
  assert.match(refused.content, /cannot reach that place/);
  assert.equal(requests[2].messages.length, 5, "the second wake continues the same conversation");
});

test("a squad goes to a place Hammer describes, takes cover there, and asks when the words are unclear", { skip }, async (t) => {
  const server = await startServer(t);
  const host = new Host({ server, side: 0, brain: scriptedBrain(), log: () => {} });
  await host.start();
  t.after(() => host.stop());
  await eventually("Anvil and two squad leaders on the net", () => host.agents.size === 3 && host.ready);
  const hammer = await Hammer.join(t, server);

  // A landmark by its description: the net tags it, the squad goes inside and says so.
  hammer.say("Viper 2, take cover in the bunker at Delta");
  assert.equal(await hammer.hears("Viper 2"), "Hammer, this is Viper 2. Wilco. Out.");
  await hammer.next("Viper 2 ordered into the bunker", (f) => squadIn(f, 2)?.order.place === "D-bunker-1");
  await hammer.next("Viper 2 going inside", (f) => f.type === "event" && f.event.kind === "garrisoned" && f.event.place === "D-bunker-1");
  assert.equal(await hammer.hears("Viper 2"), "Hammer, this is Viper 2. Inside the bunker north of Delta. Over.");
  const inside = await hammer.next("all three fireteams inside, in cover", (f) => {
    const teams = squadIn(f, 2)?.teams ?? [];
    return teams.length === 3 && teams.every((tm) => tm.in === "D-bunker-1" && tm.cover > 0 && tm.cover < 1);
  });
  assert.deepEqual(inside.state.landmarks.find((l) => l.id === "D-bunker-1").garrison, { side: 0, teams: 3 });

  // The same in Hebrew, to a spot off a point.
  hammer.say("צפע 1, החזיקו 150 מטר מצפון לדוד");
  assert.equal(await hammer.hears("Viper 1"), "פטיש, כאן צפע 1, רות, יבוצע, סוף.");
  await hammer.next("Viper 1 ordered north of Delta", (f) => squadIn(f, 1)?.order.place === "N of D 150");

  // Words that fit several landmarks: the squad asks which, and keeps its order.
  hammer.say("Viper 1, get into the house at Foxtrot");
  assert.equal(
    await hammer.hears("Viper 1"),
    "Hammer, this is Viper 1. Say again, the house north of Foxtrot or the house west of Foxtrot or the house east of Foxtrot or the house south of Foxtrot. Over.",
  );
  assert.equal(squadIn(hammer.frames.findLast((f) => f.type === "state"), 1).order.place, "N of D 150");
});

// The calls the page writes when a structure is placed, a unit cancelled and a rally
// point set, said to scripted agents on a real server: the spot the ghost showed is where
// the structure stands, and the lines, the refund and the rally order are the server's.
test("placing a structure, a production line, a cancel and a rally point, end to end", { skip }, async (t) => {
  const { canPlace, spotAt, spotWords, tint } = await import("../../client/placement.js");
  const strings = Object.fromEntries(["en", "he"].map((l) => [l, JSON.parse(readFileSync(new URL(`../../client/i18n/${l}.json`, import.meta.url)))]));
  const tr = (lang) => (key, vars = {}) => strings[lang][key].replace(/\{(\w+)\}/g, (_, k) => vars[k]);
  const rules = JSON.parse(readFileSync(new URL("../../shared/rules.json", import.meta.url)));
  rules.map = rules.maps.small;

  const server = await startServer(t);
  const host = new Host({ server, side: 0, brain: scriptedBrain(), log: () => {} });
  await host.start();
  t.after(() => host.stop());
  await eventually("Anvil and two squad leaders on the net", () => host.agents.size === 3 && host.ready);
  const hammer = await Hammer.join(t, server);
  const latest = () => hammer.frames.findLast((f) => f.type === "state")?.state;
  const since = async (what, mark, match, ms) => {
    await eventually(what, () => hammer.frames.slice(mark).some(match), ms);
    return hammer.frames.slice(mark).find(match);
  };
  const ask = async (text, answer) => {
    const mark = hammer.frames.length;
    hammer.say(text);
    const heard = await since(`Anvil answering "${text}"`, mark, (f) => f.type === "radio" && f.message.from.en === "Anvil");
    if (answer) assert.equal(heard.message.text, answer, text);
    return { mark, text: heard.message.text };
  };
  await eventually("the first picture", () => latest());

  // Green ground for a works, as the page would tint it, and the words for that spot.
  const works = rules.factions.aegis.structures.vehicleWorks;
  const spot = tint(rules, latest(), 0, works, 20)
    .filter((c) => c.ok)
    .map((c) => spotAt(rules, c.x, c.y))
    .find((s) => canPlace(rules, latest(), 0, works, s.x, s.y) === "");
  assert.ok(spot, "the page finds ground for a works");
  const alpha = (lang) => rules.map.points.find((p) => p.id === spot.point).callsign[lang];
  const say = (lang, key, vars) => tr(lang)(key, { to: lang === "he" ? "סדן" : "Anvil", from: lang === "he" ? "פטיש" : "Hammer", ...vars });

  const built = await ask(say("en", "call.buildSpot", { structure: works.name.en, place: spotWords(tr("en"), spot, alpha("en")) }), "Hammer, this is Anvil. Wilco. Out.");
  await since("the works going up", built.mark, (f) => f.type === "event" && f.event.kind === "structure_started" && f.event.unit === "vehicleWorks");
  const done = await since("the works standing", built.mark, (f) => f.type === "event" && f.event.kind === "structure_built" && f.event.unit === "vehicleWorks", 20000);
  const stands = latest().structures.find((st) => st.id === done.event.structure);
  assert.deepEqual([stands.x, stands.y], [spot.x, spot.y], "the works stands on the spot the ghost showed");

  // The same spot again, in Hebrew: the page would show it red, and the server refuses.
  assert.equal(canPlace(rules, latest(), 0, rules.factions.aegis.structures.barracks, spot.x, spot.y), "room");
  const before = latest().structures.length;
  const refused = await ask(say("he", "call.buildSpot", { structure: rules.factions.aegis.structures.barracks.name.he, place: spotWords(tr("he"), spot, alpha("he")) }));
  assert.match(refused.text, /^פטיש, כאן סדן, שלילי/, "a structure on top of another is refused on the net");
  assert.equal(latest().structures.length, before);

  // Three tanks bought one after another wait in one line at the one works.
  const commandos = rules.factions.aegis.units.tank;
  await eventually("gold for three squads", () => latest().gold >= 3 * commandos.cost, 20000);
  const bought = hammer.frames.length;
  const buy = say("en", "call.buy", { class: strings.en["class.vehicle"], unit: commandos.name.en });
  for (let i = 0; i < 3; i++) await ask(buy, "Hammer, this is Anvil. Wilco. Out."); // one call at a time, as a commander speaks
  const lined = await since("three squads in one line", bought, (f) => f.type === "state" && f.state.deploying.filter((d) => d.side === 0).length === 3);
  const line = lined.state.deploying.filter((d) => d.side === 0);
  assert.equal(new Set(line.map((d) => d.from)).size, 1, "one works, one line");
  assert.deepEqual(line.map((d) => d.line), [0, 1, 2]);
  assert.ok(line[1].ticksAhead > 0 && line[2].ticksAhead > line[1].ticksAhead, "each waits for the ones ahead of it");

  // The last one is cancelled before work on it begins: all its gold comes back.
  const cancelled = hammer.frames.length;
  hammer.say(say("en", "call.cancel", { unit: commandos.name.en }));
  const refund = await since("the cancellation", cancelled, (f) => f.type === "event" && f.event.kind === "deploy_cancelled");
  assert.equal(refund.event.count, commandos.cost);
  assert.equal(refund.event.squad, line[2].id, "the last one bought is the one that goes");

  // A rally point: squads made from now on go there and hold it.
  const delta = rules.map.points.find((p) => p.id === "D");
  await ask(say("he", "call.rally", { point: delta.callsign.he }), "פטיש, כאן סדן, רות, יבוצע, סוף.");
  await eventually("the works gathering at Delta", () => latest().structures.find((st) => st.side === 0 && st.role === "works")?.rally?.place === "D");
  await eventually("gold for one more squad", () => latest().gold >= commandos.cost, 20000);
  const again = hammer.frames.length;
  hammer.say(buy);
  const spawned = await since("the new squad on the field", again, (f) => f.type === "event" && f.event.kind === "squad_spawned" && f.event.side === 0);
  await eventually("the new squad sent to hold Delta", () => {
    const sq = latest().squads.find((x) => x.id === spawned.event.squad);
    return sq?.order.kind === "hold" && sq.order.point === "D";
  });
});
