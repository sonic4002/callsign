---
title: Tests and Headless Matches
description: "The server is tested by running the simulation with no network and no clock: a test builds a sim.Sim, lets two scripted players act once a match second, and calls Step() until the match is over, ..."
type: how-to
status: current
tags:
  - type/how-to
  - status/current
  - agent/CLD
  - origin/code
  - area/architecture
  - topic/server
  - topic/tests
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Make Targets]]"
  - "[[Balance]]"
  - "[[Seats, Tokens and Trust]]"
  - "[[Agent Loop]]"
  - "[[Rule Brain]]"
  - "[[Client]]"
  - "[[Server Architecture]]"
  - "[[Sim Loop and Determinism]]"
  - "[[Bodies and Collision]]"
  - "[[Navigation]]"
paths:
  - server/sim/sim_test.go
  - server/sim/terrain_test.go
  - server/sim/tune_test.go
  - server/sim/heroes_tune_test.go
  - server/sim/cost_test.go
  - server/sim/crowd_bench_test.go
  - server/sim/crossing_test.go
  - server/sim/fit_test.go
  - server/sim/placement_test.go
  - server/sim/export_test.go
  - server/sim/testdata/drill-ground.json
  - server/room/room_test.go
  - agents/test/e2e.test.mjs
  - tools/parsecalls/main.go
  - Makefile
  - Dockerfile.dev
---

# Tests and Headless Matches

The server is tested by running the simulation with no network and no clock: a test builds a `sim.Sim`, lets two scripted players act once a match second, and calls `Step()` until the match is over, checking invariants on every tick. `make test` runs all of it (Go vet, Go tests, then the Node tests against the built server binary) inside the dev image with the network off.

## Running

| Command | What runs |
|---|---|
| `make test` | `go vet ./... && go test ./...`, then builds the server to `/tmp/callsign` and runs `node --test` with `CALLSIGN_BIN` pointing at it; `--network none` |
| `make relay-test` | the relay's and `shared`'s Go tests with the race detector |
| `make balance` | `TestFactionsAreRoughlyEvenOnEveryMap` with `CALLSIGN_BALANCE=$(SEEDS)` (100 by default), timeout 60 minutes |
| `make cost` | `TestWhatATickCosts` and `TestWhatAMapPays` on one core with `CALLSIGN_COST=1` |

See [[Make Targets]] for the rest.

## How a whole match is simulated (`playMatch` in `sim_test.go`)

1. `sim.New(rules, sim.Config{Seed, Factions, ...})`.
2. Two `bot.Player`s, one per side, each with a style (`standard`, `rush`, `normal`, `easy`).
3. Loop until `s.Over`: on every whole second (`Tick % TickRate == 0`) each player reads `s.Snapshot(side)` and returns commands; each is passed to `s.Apply` and the test fails if one is refused; the state hash is sampled. Then `s.Step()`.
4. After each step `checkInvariants`: no negative gold; no team off the map, on ground it cannot stand on, or with stress outside 0 to 1; no side over the population cap.
5. The test fails if the match runs past its timer.

This is the same loop `Room.Tick` runs, minus the network. Because the scripted players act on snapshots at fixed ticks, the whole match is a function of the seed.

`TestSameSeedSameMatch` plays seed 7 twice and compares the hash at every second, then plays seed 8 and requires a different final hash ("the seed is not reaching combat" otherwise). `TestScriptedMatchesOnEveryMapAreDeterministic` does the same on the real maps, `TestSortiesAreTheSameEveryTime` and `TestACrowdNeverOverlapsAndIsTheSameEveryTime` for their areas.

## The drill ground

`server/sim/testdata/drill-ground.json` is a fixed map that no player sees: "Drill Ground" / "שטח האימונים", 1600 by 1000, cell 40, 600 seconds, pace 1. It is "the small map as it was" before the maps were redrawn (commit `1744d4f`). Tests of how the game works stage their fights at fixed spots of it, "so redrawing the maps that are played never breaks them" (about sixty tests depended on fixed spots). Tests of the maps themselves name the real ones (`rules.MapIDs()`, `simOn(t, rules, id, ...)`), and the tuning probes play on the real small map.

`newSim` in the tests starts with `FullBase: true` (every base structure standing, so any unit can be bought at once) and 300 gold; the build tree itself is tested in `structures_test.go` on a match that starts as a real one does.

## Staging helpers

- `must(t, s, cmd)`: apply a command or fail.
- `fielded(s, sq)`, `buyFielded(...)`: step until a bought squad is on the field.
- `run(s, seconds)`: step and collect events; `has(events, kind, side)`.
- `place(sq, x, y)`: put every team of a squad at a spot (side by side since bodies take room).
- `export_test.go` opens a few internals to the tests only: `CoverOf`, `ShotAt`, `Overlap`, `Body`.

## Room tests

`server/room` tests build a `Room` directly (`newRoom`: `FullBase`, 300 gold, seed 1), join clients with `Room.Join` or `Room.Enter` and call `rm.Tick()` by hand, reading frames from each client's `Out` channel. No sockets are involved. `hub_test.go` (18 tests) covers making rooms, codes, seats, the host password, guess throttling and the internal routes through `httptest`.

## Opt-in tests (skipped or shortened in the ordinary suite)

| Variable | Test | What it does |
|---|---|---|
| `CALLSIGN_BALANCE=<seeds>` | `TestFactionsAreRoughlyEvenOnEveryMap` | not skipped without it: plays 4 seeds per pairing per map with a limit of 80% wins for one faction; with it, plays that many seeds and holds the limit at 55% |
| `CALLSIGN_BALANCE_MAP=<id>` | the same | one map only, while tuning |
| `CALLSIGN_COST=1` | `TestWhatATickCosts`, `TestWhatAMapPays` | one scripted match per map: time of a tick (mean, 99th percentile, worst), of the two snapshots a room sends, their size; gold an undisturbed base makes a minute with one, two and three haulers |
| `TUNE=<games>` (with `TUNE_A`, `TUNE_B`, `TUNE_FULL`) | `TestTune` | a balance probe run by hand, on the real small map |
| `HEROES_TUNE=<seeds>` (with `HEROES_VARIANT`) | `TestHeroBalanceProbe` | heroes, ranks and crushing each taken out in turn "to see what it is worth"; 100 seeds gives the 200 games of the balance target |
| `UPDATE_PLACEMENT=1` | in `placement_test.go` | rewrites `client/testdata/placement-small.json`, the table the page's placement code is checked against |
| `CALLSIGN_BIN=<path>` | Node: `agents/test/e2e.test.mjs`, `lobby.test.mjs`, `relay.test.mjs`, `telemetry.test.mjs` | skipped without the built server binary |
| `CALLSIGN_VOICE_MODELS=1` | Node: `client/voice/voice.test.mjs`, `transducer.test.mjs` | need the downloaded speech models (`make voice-test`) |

Always-on balance guards in the ordinary suite: `TestFactionsAreRoughlyEven` (8 seeds each way on the real small map, limit 75%; its comment records "Before tuning, Aegis won nine in ten"), `TestPacedEnemiesAreBeatable` (a relentless Aegis must beat `easy` in at least 9 of 10 and `normal` in at least 3 of 4, over 12 seeds), `TestEveryEnemyLevelPlaysTheWholeGameOnEveryMap`. Measured results are in [[Balance]].

## Conditional skips inside tests

Three `t.Skip` calls depend on the situation rather than a variable: `heroes_test.go` (the facing rule needs an enemy in sight), `placement_test.go` (a map with no open ground just beyond the base), `power_test.go` (three repairs costing no more than the trickle).

## Benchmark

`BenchmarkCrowdTick` in `crowd_bench_test.go`: one tick of a crowded match, 24 squads a side of every kind walking to one point and fighting there. Not run by `make test` (Go runs benchmarks only with `-bench`).

## Node end-to-end tests

`agents/test/e2e.test.mjs` starts the real server binary on a random local port with `-bot "" -speed 20 -base refinery,barracks` (no scripted enemy, the clock twenty times faster, the base as it stands after the opening), connects over real WebSockets and runs the real agent loop. "Only the model is replaced, by the rule brain or by a fake Anthropic client." These servers have no agent key, so they run in the trusting mode with the open room ([[Seats, Tokens and Trust]]). The helper waits until the socket answers, because the "listening" log line comes a moment before the bind.

Other Node tests under `agents/test/` and `client/*.test.mjs` are unit tests of the agents and the page; they belong to [[Agent Loop]], [[Rule Brain]] and [[Client]].

## Test fixtures made by the server's own code

`tools/parsecalls` reads a JSON list of radio texts on standard input and prints, for each, what the net's parser makes of it (body, language, ending, procedure words, points, landmarks). `agents/test/fixtures/orders.json` was made with it, "so that the brains' tests read exactly what the game server would hand an agent".

## Size of the suite

Counted with `grep -c "^func Test"` on 2026-11-26: `server/sim` 159 tests in 19 test files, `server/room` 75 in 16 files, `server/radio` 11 in 3 files. The suite was not run for this note; whether it passes today is not verified here.

## Related

- [[Server Architecture]]
- [[Sim Loop and Determinism]]
- [[Bodies and Collision]]
- [[Navigation]]
- [[Sorties]]
- [[Balance]]
- [[Enemy Bot]]
- [[Make Targets]]
- [[Server Flags]]
- [[Known Flaws]]
