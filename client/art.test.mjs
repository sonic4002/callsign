// The parts of the drawing code that are plain arithmetic, and the sprite manifest itself:
// every picture it names must be in the repository, and the pieces that go together
// (a structure's stages, its door, a hero's poses) must all be there.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { doorAt, emergence, formation, stageOf, structurePoint } from "./art.js";
import { advance, movers, nearer, spreadOut } from "./motion.js";

const root = new URL("../assets/sprites/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));

test("stageOf: a structure passes through every stage in order and ends finished", () => {
  assert.equal(stageOf(4, 0), 0);
  assert.equal(stageOf(4, 0.24), 0);
  assert.equal(stageOf(4, 0.25), 1);
  assert.equal(stageOf(4, 0.99), 3);
  assert.equal(stageOf(4, 1), 4, "finished: past the last stage");
  assert.equal(stageOf(0, 0.5), 0, "no stage pictures: the finished building all along");
  const seen = Array.from({ length: 101 }, (_, i) => stageOf(3, i / 100));
  assert.deepEqual([...new Set(seen)], [0, 1, 2, 3]);
  assert.ok(seen.every((s, i) => i === 0 || s >= seen[i - 1]), "never back a stage");
});

test("doorAt: the light comes on, the door opens for the unit, and closes behind it", () => {
  assert.equal(doorAt(-0.1), "closed");
  assert.equal(doorAt(0.05), "lit");
  assert.equal(doorAt(0.5), "open");
  assert.equal(doorAt(0.9), "lit");
  assert.equal(doorAt(1), "closed");
});

test("structurePoint and emergence: a unit starts hidden in the doorway and walks to the rally point", () => {
  const entry = { size: [200, 100], anchor: [0.5, 0.8], height: 50, door: { exit: [0.3, 0.7], rally: [0.1, 0.9] } };
  // Drawn 50 px tall, the picture is half size: 100 px wide.
  const near = (got, want, why) => assert.ok(got.every((g, i) => Math.abs(g - want[i]) < 1e-9), `${why ?? ""} ${got} is not ${want}`);
  near(structurePoint(entry, "exit"), [-20, -5]);
  near(structurePoint(entry, "rally"), [-40, 5]);
  near(structurePoint(entry, "exit", 100), [-40, -10], "twice as tall, twice as far:");
  assert.equal(structurePoint({ size: [1, 1] }, "exit"), null, "a structure with no door has no way out");
  const start = emergence(entry, 0);
  near([start.x, start.y, start.alpha], [-20, -5, 0]);
  const end = emergence(entry, 1);
  near([end.x, end.y, end.alpha], [-40, 5, 1]);
  assert.ok(start.scale < 0.6 && end.scale === 1, "small in the doorway, full size at the rally point");
  const mid = emergence(entry, 0.5);
  assert.ok(mid.x < -20 && mid.x > -40 && mid.alpha === 1);
  assert.equal(emergence({ size: [1, 1] }, 0.5), null);
});

test("formation: a wedge on the march, a line abreast at the halt, never a clump", () => {
  const apart = (places) => {
    let least = Infinity;
    for (const a of places) for (const b of places) if (a !== b) least = Math.min(least, Math.hypot(a.x - b.x, (a.y - b.y) * 2));
    return least;
  };
  for (const members of [2, 3, 4, 6]) {
    for (const go of [0, 0.5, 1]) {
      for (let h = 0; h < 8; h++) {
        const places = formation(members, (h * Math.PI) / 4, go, 3.7);
        assert.equal(places.length, members);
        assert.ok(apart(places) > 6, `${members} men, go ${go}, heading ${h}: two stand on each other`);
        assert.deepEqual(places.map((p) => p.y), places.map((p) => p.y).sort((a, b) => a - b), "sorted far to near");
        assert.deepEqual(places.map((p) => p.i).sort(), [...Array(members).keys()], "every man has a place");
      }
    }
  }
  // Marching east on the map (down and to the right on screen), the first man leads.
  const march = formation(3, 0, 1, 0);
  const leader = march.find((p) => p.i === 0);
  const along = (p) => p.x + 2 * p.y; // how far forward along a march to the east
  assert.ok(march.every((p) => p === leader || along(p) < along(leader) - 6), "the others follow behind the first man");
  assert.deepEqual(formation(3, 1, 0.4, 2), formation(3, 1, 0.4, 2), "the same team stands the same way every frame");
  assert.equal(formation(1, 0, 1, 0).length, 1);
  assert.equal(formation(40, 0, 1, 0).length, 6, "no more places than the largest team");
});

test("nearer: a heading turns the short way round, by no more than its step", () => {
  assert.equal(nearer(0, 1, 0.25), 0.25);
  assert.equal(nearer(0, 0.1, 0.25), 0.1);
  assert.ok(Math.abs(nearer(3, -3, 0.2) - 3.2) < 1e-9, "across the join, not all the way back round");
  assert.ok(Math.abs(nearer(-3, 3, 0.2) + 3.2) < 1e-9);
});

test("advance: a thing gathers speed, turns through the headings between, and eases to a halt", () => {
  const v = { x: 0, y: 0, tx: 0, ty: 0, turn: 0 };
  const dt = 1 / 60;
  // At rest nothing about it moves.
  for (let i = 0; i < 30; i++) advance(v, dt, "wheels", 0);
  assert.equal(v.moving, false);
  assert.equal(v.go, 0);
  assert.equal(v.stride, 0);

  // The server moves it steadily away, to the south: it must turn there, not snap.
  const turns = [];
  let peak = 0;
  for (let i = 0; i < 180; i++) {
    v.tx += 30 * dt; // thirty map units a second
    const before = v.turn;
    advance(v, dt, "wheels", Math.PI / 2);
    turns.push(v.turn - before);
    peak = Math.max(peak, v.go);
  }
  assert.equal(v.moving, true);
  assert.ok(peak > 0.8 && peak <= 1, `it reaches its cruising speed (go ${peak})`);
  assert.ok(Math.abs(v.speed - 30) < 3, `its speed is the server's (${v.speed})`);
  assert.ok(Math.max(...turns) <= movers.wheels.turn * dt + 1e-9, "no faster than a vehicle turns");
  assert.ok(Math.abs(v.turn - Math.PI / 2) < 1e-6, "it ends facing where it is going");
  assert.ok(turns.filter((t) => t > 0).length > 20, "the turn takes many frames");
  assert.ok(v.stride > 80 && v.stride < 95, `it has covered about what the server moved it (${v.stride})`);

  // The server stops: it runs on a little, slows, and stands still without flickering.
  const states = [];
  for (let i = 0; i < 120; i++) {
    advance(v, dt, "wheels", Math.PI / 2);
    states.push(v.moving);
  }
  assert.equal(v.moving, false);
  assert.ok(v.go < 0.02);
  assert.equal(states.filter((m, i) => i > 0 && m !== states[i - 1]).length, 1, "it stops once");
  assert.ok(Math.abs(v.x - v.tx) < 0.5, "and where the server has it");

  // A man on foot turns far faster than a vehicle; an unknown kind moves as one on foot.
  assert.ok(movers.foot.turn > 2 * movers.wheels.turn);
  assert.doesNotThrow(() => advance({ x: 0, y: 0, tx: 5, ty: 0, turn: 0 }, dt, "submarine", 0));
});

test("spreadOut: a squad's teams are drawn further apart, about the same middle", () => {
  const teams = [{ x: 100, y: 100 }, { x: 110, y: 100 }, { x: 105, y: 110 }];
  spreadOut(teams, 2);
  assert.deepEqual([teams[0].px, teams[1].px, teams[2].px], [95, 115, 105]);
  const mid = (key) => teams.reduce((a, t) => a + t[key], 0) / teams.length;
  assert.ok(Math.abs(mid("px") - mid("x")) < 1e-9 && Math.abs(mid("py") - mid("y")) < 1e-9, "the middle of the squad does not move");
  assert.ok(Math.abs(Math.hypot(teams[0].px - teams[1].px, teams[0].py - teams[1].py) - 20) < 1e-9, "twice as far apart");
  spreadOut(teams, 1);
  assert.ok(teams.every((t) => t.px === t.x && t.py === t.y), "at 1 a team is drawn where it is");
  assert.doesNotThrow(() => spreadOut([], 2));
});

// ---- the manifest ----

const has = (rel) => existsSync(new URL(rel, root));

test("manifest: every picture it names is in the repository", () => {
  const missing = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.image === "string" && !has(node.image)) missing.push(node.image);
    Object.values(node).forEach(walk);
  };
  walk(manifest);
  for (const rel of Object.values(manifest.terrain)) if (!has(rel)) missing.push(rel);
  assert.deepEqual(missing, []);
});

test("manifest: every structure has its stages in its own frame, and producers have a door and a way out", () => {
  const b = manifest.buildings;
  const structures = Object.keys(b).filter((k) => /^(aegis|ashfall)_[a-zA-Z]+$/.test(k));
  assert.equal(structures.length, 18, "seven a side, and a power and a radar structure each");
  for (const key of structures) {
    const entry = b[key];
    assert.ok(entry.stages?.length >= 3, `${key} goes up in at least three stages before it is finished`);
    assert.deepEqual(entry.stages, [...new Set(entry.stages)].sort(), `${key}'s stages are each listed once, in order`);
    for (const stage of [...entry.stages, `${key}_site`, `${key}_ruin`]) {
      assert.ok(b[stage], `${stage} is missing`);
      assert.deepEqual(b[stage].size, entry.size, `${stage} does not fill the frame of ${key}`);
      assert.deepEqual(b[stage].anchor, entry.anchor);
    }
    assert.equal(b[`${key}_site`].image, b[entry.stages[0]].image, "the old name for a site is the first stage");
  }
  const producers = structures.filter((k) => /barracks|safehouse|works|chopShop|airbase|launchYard|dockyard|boatShed|refinery|smelter/.test(k));
  assert.equal(producers.length, 10);
  for (const key of producers) {
    const door = b[key].door;
    assert.ok(door, `${key} has no door`);
    for (const name of ["open", "lit"]) {
      const patch = door.frames[name];
      assert.ok(patch && has(patch.image), `${key} has no ${name} door`);
      assert.ok(patch.at[0] >= 0 && patch.at[1] >= 0 && patch.at[0] + patch.size[0] <= b[key].size[0] && patch.at[1] + patch.size[1] <= b[key].size[1], `${key}'s ${name} door lies inside its picture`);
    }
    for (const name of ["exit", "rally"]) assert.ok(door[name]?.length === 2 && door[name].every((f) => f >= 0 && f <= 1), `${key}.${name}`);
    assert.ok(structurePoint(b[key], "exit"), key);
  }
});

test("manifest: heroes, sandbags and the moving frames are all there", () => {
  const u = manifest.units;
  for (const [key, poses] of [["aegis_sentinel", ["prone", "proneFire", "plant"]], ["ashfall_oracle", ["disguise", "disguiseWalk", "seize"]]]) {
    assert.ok(u[key]?.hero, `${key} is not marked a hero`);
    for (const anim of ["idle", "walk", "fire", "cover", "coverFire", "die", "stop", ...poses]) assert.ok(u[key].anims[anim], `${key} has no ${anim}`);
    assert.ok(u[key].frame[1] > u.commandos.frame[1], `${key} stands taller than the rank and file`);
    assert.ok(manifest.portraits[key.split("_")[1]], `${key} has no portrait`);
  }
  for (const key of ["commandos", "militia", "rpgTeam", "aegis_engineer", "ashfall_sapper"]) {
    assert.equal(u[key].anims.walk[1], 12, `${key} walks in twelve frames`);
    assert.ok(u[key].anims.stop);
    assert.deepEqual(u[key].anims.idle, [0, 1], "the frames older code knows are where they were");
  }
  for (const key of ["tank", "technical", "rocketLauncher", "patrolBoat", "speedboat"]) {
    assert.equal(u[key].facings, 16, `${key} turns through sixteen headings`);
    assert.equal(u[key].order.length, 16);
    assert.ok(u[key].anims.move[1] >= 2, `${key} has frames for being under way`);
    assert.equal(u[key].turret.anims.fire[1], 3);
  }
  for (const anim of ["move", "bankLeft", "bankRight"]) assert.equal(u.helicopter.anims[anim][1], 3);
  const bags = manifest.landmarks.sandbags;
  assert.deepEqual(bags.states, ["whole", "damaged", "flat"]);
  assert.equal(bags.facings, 8);
  assert.ok(has(bags.image));
});

// ---- third wave: power, radar, buildings of no army, ranks and panel icons ----

test("spinFrame and lampOn: a dish turns once a period, and a dark building blinks twice then rests", async () => {
  const { lampOn, spinFrame, structureSpot } = await import("./art.js");
  assert.equal(spinFrame(12, 6, 0), 0);
  assert.equal(spinFrame(12, 6, 3), 6, "half a turn in half a period");
  assert.equal(spinFrame(12, 6, 6), 0, "and round again");
  assert.equal(spinFrame(12, 6, -0.1), 11, "time before zero still names a frame");
  const seen = new Set(Array.from({ length: 600 }, (_, i) => spinFrame(12, 6, i / 100)));
  assert.equal(seen.size, 12, "every frame is shown");
  const lit = Array.from({ length: 160 }, (_, i) => lampOn(i / 100));
  const blinks = lit.filter((on, i) => on && !lit[i - 1]).length;
  assert.equal(blinks, 2);
  assert.ok(lit.filter(Boolean).length < 40, "dark most of the time");
  assert.equal(lampOn(0.05), lampOn(1.65), "the pattern repeats");
  // A place given as fractions of the picture, in pixels from where the building stands.
  const base = { size: [200, 100], anchor: [0.5, 0.8], height: 50 };
  assert.deepEqual(structureSpot(base, [0.5, 0.8]), [0, 0]);
  assert.deepEqual(structureSpot(base, [1, 0]), [50, -40]);
});

test("marks: two ranks and six panel icons, each a well-formed picture unlike the others", async () => {
  const { iconSvg, icons, rankSvg, ranks } = await import("./marks.js");
  assert.deepEqual(Object.keys(ranks), ["seasoned", "elite"]);
  assert.deepEqual(Object.keys(icons).sort(), ["cancel", "lowPower", "power", "rally", "repair", "sell"]);
  const all = [...Object.keys(ranks).map((r) => rankSvg(r, 14)), ...Object.keys(icons).map((i) => iconSvg(i, 14))];
  assert.equal(new Set(all).size, all.length, "no two marks are the same picture");
  for (const svg of all) {
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 16 16" width="14" height="14"/);
    assert.match(svg, /<\/svg>$/);
    for (const d of svg.matchAll(/ d="([^"]+)"/g)) assert.match(d[1], /^M[\d\s.MLHVAZ-]+$/, "a path of plain commands and numbers");
  }
  assert.equal(rankSvg("recruit"), "", "no rank, no mark");
  assert.equal(iconSvg("nothing"), "");
  // A rank is silver so that it is never taken for the brass chevrons of a bought brain tier.
  assert.ok(!rankSvg("seasoned").includes("#e2b33c") && !rankSvg("elite").includes("#e2b33c"));
  assert.match(iconSvg("sell", 12, "Sell <this>"), /<title>Sell this<\/title>/, "a label is text, never markup");
});

test("manifest: the power and radar structures, the buildings of no army and their icons", () => {
  const b = manifest.buildings;
  for (const key of ["aegis_powerPlant", "ashfall_generatorYard", "aegis_radar", "ashfall_listeningPost"]) {
    assert.ok(b[key] && has(b[key].image), key);
    assert.equal(b[key].stages?.length, 4, `${key} goes up in four stages`);
    for (const state of [...b[key].stages, `${key}_ruin`, `${key}_site`]) {
      assert.ok(b[state] && has(b[state].image), state);
      assert.deepEqual(b[state].size, b[key].size, `${state} is in its building's frame`);
    }
    assert.ok(b[key].lamp?.every((f) => f >= 0 && f <= 1), `${key} says where its warning lamp is`);
  }
  for (const [key, prop] of [["aegis_radar", "radar_dish"], ["ashfall_listeningPost", "antenna_loop"]]) {
    const spin = b[key].spin;
    assert.equal(spin?.prop, prop);
    assert.ok(spin.at.every((f) => f >= 0 && f <= 1) && spin.height > 0 && spin.period > 0);
    const part = manifest.props[prop];
    assert.ok(part && has(part.image) && part.frames >= 8 && part.frame.length === 2 && part.anchor.length === 2);
  }
  for (const key of ["tech_goldworks", "tech_clinic", "tech_garage"]) {
    assert.ok(b[key] && has(b[key].image) && b[`${key}_ruin`] && has(b[`${key}_ruin`].image), key);
    assert.deepEqual(b[`${key}_ruin`].size, b[key].size);
    assert.ok(b[key].flag?.every((f) => f >= 0 && f <= 1), `${key} says where its owner's flag stands`);
    assert.equal(b[key].stages, undefined, "nobody builds these");
  }
  for (const key of ["aegis_powerPlant", "ashfall_generatorYard", "aegis_radar", "ashfall_listeningPost", "tech_goldworks", "tech_clinic", "tech_garage"]) {
    assert.ok(manifest.icons?.[key] && has(manifest.icons[key].image), `${key} has no build-panel picture`);
    assert.deepEqual(manifest.icons[key].size, [144, 96]);
  }
});
