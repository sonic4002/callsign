# Spec: bases, harvested gold, bigger maps with cover, and places you can describe

Status: ready for agents. Written 2026-11-24 from the owner's request. Label: `ready-for-agent`.

Every structure, unit, name and picture in this spec is original to Callsign. The genre
conventions (a base that unlocks units, a harvester economy, defences, garrisons) are
used; no existing game's names, art, sounds or layouts are copied.

## Problem Statement

A match today is squads on an almost empty map. There is nothing to build, so there is
no base to defend or to break, and every unit is available from the first second. Gold
arrives on its own from rigs, so there is no economy to protect or to raid. The map has
one size and almost nothing on it, so squads have nowhere to hide and no cover to fight
from, and an order can only name one of nine points. The waiting room offers no choice
of map or of starting gold, and it is hard to see at a glance whether the other player
has joined and is ready.

## Solution

Each side grows a base. Structures cost gold, take time to go up, and each one unlocks
something: a barracks for infantry, a works for heavy vehicles, an airbase for aircraft,
a dockyard for boats, a refinery for gold. Each army has its own defences and its own
fence or wall. Structures can be attacked and destroyed, and losing one takes away what
it unlocked.

Gold is collected. A gusher throws gold up out of the ground and it settles in a field
around it; haulers drive out, load, and bring it back to a refinery. Haulers can be
escorted, ambushed and replaced.

There are three maps to choose from, of three sizes, each shown as a small drawing in
the waiting room. Every map has all the kinds of ground: land, water, ice, mountains and
bridges. Bridges can be destroyed, and whatever stands on one when it falls is lost.
Engineers repair broken bridges and take over enemy structures. Each map is full of things: houses, bunkers, ruins, groves,
rocks and walls. Infantry can go inside buildings and fight from them, and anything
standing behind cover is harder to hit. Every such thing is a landmark with a name, so
the player can say "Viper 1, take cover in the grove north of Foxtrot" and the squad
goes there.

The waiting room lets the match's maker choose the map size and the starting gold, and
shows the other player's state in colour.

## User Stories

Lobby
1. As a match maker, I want to pick one of three maps (small, medium, large) in the waiting room from a small drawing of each, so that I can see what I am choosing and a match fits the time I have.
2. As a match maker, I want to set the starting gold to a preset or to a number I type, so that I can play a slow build-up or a rich brawl.
3. As a player who joined by code, I want to see the chosen map size, starting gold, speed and length before I press Ready, so that I know what I agreed to.
4. As a player in the waiting room, I want the other player's seat coloured by state (empty, joined, ready, left), so that I see at a glance whether we can start.
5. As a player against the scripted enemy, I want the same choices, so that practice matches match the real ones.

Base and tech tree
6. As a commander, I want to tell Anvil to build a structure by radio or by a button that writes the call, so that building stays a radio order like everything else.
7. As a commander, I want each structure to unlock specific units, so that what I build decides what army I can field.
8. As a commander, I want a unit's button to say which structure it needs when I do not have it, so that I know what to build next.
9. As a commander, I want to see a structure going up with a progress bar on the map and in the sidebar, so that I know when it will be ready.
10. As a commander, I want structures placed for me in a sensible base layout around my headquarters, so that I do not have to place them by hand over the radio.
11. As a commander, I want to place defences and fences at a named point or landmark ("a gun at Delta", "fence the north side of the base"), so that I can fortify where it matters.
12. As a commander, I want defences to fire on their own at enemies they can see and reach, so that my base is not helpless while my squads are away.
13. As a commander, I want fences and walls to stop ground units until they are broken, so that I can shape where the enemy comes from.
14. As a commander, I want to order an attack on an enemy structure by its name ("attack the enemy works"), so that I can cripple what the enemy can build.
15. As a commander, I want a destroyed structure to take its unlocks with it and to leave a ruin, so that raids matter.
16. As a commander, I want each army's structures and defences to look and behave differently, so that the two factions feel distinct.
17. As a commander, I want my headquarters to remain the thing whose loss ends the match, so that the win condition is unchanged.
18. As a commander, I want to start with a headquarters, a barracks, a refinery and one hauler, so that a ten-minute match does not open with minutes of waiting.

Gold
19. As a commander, I want gold to come from haulers working gold fields, so that my income is something I protect and the enemy can raid.
20. As a commander, I want gushers that keep throwing up gold so that fields refill slowly, so that holding a rich field matters for the whole match.
21. As a commander, I want haulers to work on their own (find a field, load, return, unload), so that I do not micro-manage them by radio.
22. As a commander, I want to tell Anvil where haulers should work ("haulers to the Kilo field"), so that I can move my economy out of danger.
23. As a commander, I want to buy more haulers when I have a refinery, so that I can grow my income.
24. As a commander, I want to see each hauler's state (going out, loading, returning, unloading, under attack) and my income per minute, so that I notice when my economy stops.
25. As a commander, I want Anvil to tell me when a hauler is attacked or lost, so that I can react.
26. As a commander, I want a small trickle from the headquarters to remain, so that a side that lost its haulers can still recover.
27. As a commander, I want the sea rig to stay a capturable source of gold for boats and aircraft, so that the sea is still worth fighting for.

Maps, cover and garrisons
28. As a commander, I want maps with many buildings, groves, rocks and walls, so that fights have terrain.
29. As a commander, I want infantry to enter a building and fight from inside it, so that I can hold a town against a larger force.
30. As a commander, I want units behind cover to be harder to hit, shown clearly on the squad, so that I can tell when a position is strong.
31. As a commander, I want a garrisoned building to be damaged by heavy weapons and to throw its occupants out when it falls, so that garrisons can be answered.
32. As a commander, I want the enemy inside a building to be visible only from close by or once they fire, so that ambushes are possible.
33. As a commander, I want larger maps to have more named points, using only letters that exist in both the NATO and the IDF alphabets, so that Hebrew and English orders stay equal.
34a. As a commander, I want every map to have land, water, ice, mountains and bridges, so that ground, sea and air units each have somewhere they matter.
34b. As a commander, I want mountains to stop ground units and water to stop them except at bridges, so that crossings are worth holding.
34c. As a commander, I want ice to be crossable but slow and without cover, so that a frozen lake is a risky shortcut.
34d. As a commander, I want to destroy a bridge, and every unit standing on it to be lost when it collapses, so that I can cut the enemy off or punish a crossing.
34e. As a commander, I want an engineer squad that repairs a broken bridge, so that a cut crossing can be reopened.
34f. As a commander, I want an engineer squad to walk into an enemy structure and take it over, so that I can steal what the enemy built.
34g. As a commander, I want to be warned when a bridge my squads are on or heading for is under attack, so that I can pull them off.
34. As a commander, I want the fog of war to cover landmarks I have never seen and to dim the ones I have, so that scouting matters.

Places you can describe
35. As a commander, I want to order a squad to a landmark by describing it ("the grove north of Foxtrot", "הבית שליד פסל"), so that I can use the terrain without learning ids.
36. As a commander, I want to order a squad to a place relative to a point ("two hundred metres east of Golf"), so that I can post squads off the points.
37. As a commander, I want a squad that cannot tell which landmark I mean to ask "Say again" naming the choices, so that it does not guess.
38. As a commander, I want to tap a landmark with a squad selected and get Hold / Move / Take cover, so that the call is written for me.
39. As a commander, I want squads to say where they are by landmark ("in the grove north of Foxtrot"), so that their reports match my orders.
40. As a squad leader agent, I want the landmarks near me and near the points in my status, each with a kind, a name and the cover it gives, so that I can choose cover without being told.

Agents, bot and fairness
41. As Anvil, I want tools to build structures and assign haulers, refused with a clear reason when a prerequisite or gold is missing, so that I can tell Hammer why.
42. As a player against the scripted enemy, I want it to build a base, harvest, use cover and defend, at each difficulty level, so that practice resembles a real opponent.
43. As a player, I want both factions to win about equally on every map size under scripted play, so that neither is the wrong choice.
44. As a new player, I want the tutorial and Help to explain bases, harvesting, cover and describing places, so that I am not lost.
45. As a phone player, I want the build panel, structure list and hauler states usable by thumb, so that the phone layout keeps up.

## Implementation Decisions

Vocabulary (use these words in code, rules and text)
- **Structure**: anything built by a side: base structures and defences. **Landmark**: anything on the map that belongs to no side: houses, bunkers, ruins, groves, rocks, walls, bridges. **Gusher**: a gold source. **Field**: the gold lying around a gusher. **Hauler**: the collecting vehicle. **Garrison**: infantry inside a landmark building. **Place**: where an order sends a squad: a point, a landmark, a structure, or an offset from a point.

Locked-decision changes (CLAUDE.md is updated with this spec)
- Economy: gold is harvested by haulers from fields fed by gushers and unloaded at a refinery. The headquarters keeps a small trickle. The sea rig stays a capturable passive source. Land rigs become gushers.
- The build tree is real: structures unlock units. Superpowers remain out of scope here.
- Radio remains the only way to act. Sidebar and map buttons for building, garrisoning and hauler tasks only write radio calls.

Rules data (`shared/rules.json`, one file, read by server and client)
- `maps`: three maps keyed `small`, `medium`, `large`, each with a name in both languages, width, height, terrain, points, gushers, sea rigs, bridges and landmarks. `small` is about today's size (1600×1000, nine points); `medium` about 2400×1500 with twelve points; `large` about 3200×2000 with fifteen. Each has its own character (for example a river crossing, a frozen lake, a mountain pass) and each contains every terrain kind.
- `terrain` per map: a coarse grid (one letter per cell, cell size in the map) of `land`, `water`, `ice`, `mountain`. Water is for boats only; mountains stop ground units and boats; ice carries ground units at a reduced speed (a `terrainKinds` table holds speed factors and cover) and gives no cover; aircraft cross everything. The old single water line goes; the fog, the radar, the navigation grids and the lobby drawing all read this grid.
- `bridges` per map: `{ id, name{en,he}, from, to, width, hp }` spanning water. A standing bridge is ground for the navigation grid. Bridges are attackable Places. New points take their letters only from the set shared by both alphabets: L (Lima / לאה), M (Mike / משה), N (November / נשר), T (Tango / תמר), Y (Yankee / יואב), V (Victor / ואו). Never ר. Maps are mirrored west–east so that neither side starts better.
- `landmarks` per map: `{ id, kind, x, y, near, bearing, name{en,he} }`. Kinds and their effect live in a `landmarkKinds` table: `house`, `bunker`, `ruin` (garrisonable, with capacity in fireteams, hit points and a cover factor), `grove`, `rocks`, `wall` (cover only), `bridge` (no cover; a crossing). The name is generated from kind, bearing and nearest point ("the grove north of Foxtrot" / "החורשה מצפון לפסל"); when two landmarks would share a name the second gets an ordinal. Ids are `<point>-<kind>-<n>`.
- `structures` per faction, each `{ id, name{en,he}, role, cost, buildSeconds, hp, armor, requires[], unlocks[], footprint }`, with roles `hq`, `barracks`, `works`, `airbase`, `dockyard`, `refinery`, `defence`, `fence`, and `capturable: true` on everything but the headquarters, defences and fences. Defences add weapon stats in the same shape units use (`range`, `damage`, `cooldownTicks`, `accuracy`, `vs`, `sight`). Fences add `blocks: "ground"` and are bought in runs.
  - Aegis Directorate: Command Post (hq), Barracks, Vehicle Works, Airbase, Dockyard, Refinery; Sentry Gun, Flak Battery; Barrier Wall.
  - Ashfall Network: The Den (hq), Safehouse (barracks), Chop Shop (works), Launch Yard (airbase), Boat Shed (dockyard), Smelter (refinery); Gun Nest, Rocket Nest (anti-air); Wire Fence.
- Units gain `requires: <structure role>`. Infantry need a barracks; tanks, launchers and technicals a works; helicopters and drone swarms an airbase; boats a dockyard; haulers a refinery.
- `engineer` per faction (Aegis: Combat engineers; Ashfall: Sappers): a small, lightly armed infantry squad that needs a barracks, with `repairPerSecond` and `captureSeconds`.
- `hauler` per faction: unarmed, moderately armoured, `capacity`, `loadSeconds`, `unloadSeconds`, `speed`, `cost`, its own cap (`match.haulerCap`), not counted in the squad population cap, and with no leader agent.
- `gushers`: `{ id, point, x, y, ratePerSecond, fieldRadius, fieldCap }`. Land-rig points become gusher points; holding the point is not needed to harvest there, but points still count for the timer win.
- `match`: `startGold` becomes the default of a lobby option; add `hqTrickle`, `haulerCap`, `startStructures` (hq, barracks, refinery) and `startHaulers: 1`.

Simulation (deterministic, in the state hash, fogged per side)
- Structures: a side's base has build slots in a fixed layout around its headquarters, mirrored for the east side; base structures take the next free slot. Defences and fence runs take a Place (a point, a landmark, or a side of the base) and are refused beyond a build radius of any structure or held point of that side. One structure is under construction at a time per side, plus one defence; gold is taken when it starts. A structure under construction has no effect. A destroyed structure removes its unlocks until rebuilt; units already fielded stay.
- Movement: ground units path around water, mountains, fences, structures and garrisonable landmarks on a coarse navigation grid (A* with deterministic tie-breaks, recomputed when the grid changes). A unit with no path attacks the nearest blocking fence. Aircraft ignore the grid; boats use a water grid.
- Targets: a squad can attack a Place that is an enemy structure or an occupied landmark. Defences choose targets like a holding fireteam and never move. Weapons use the existing `vs` table extended with `structure` and `fence`.
- Cover: a fireteam within a landmark's cover radius, and not moving, takes hits multiplied by that kind's cover factor from shooters on the far side; a garrisoned fireteam takes the building's factor from all sides and the building takes a share of the damage. When the building's hit points reach zero it becomes a ruin (a weaker, garrison-free cover kind) and its occupants are put outside, shaken. A garrisoned fireteam is spotted only inside a short `garrisonSight` or for `match.revealSeconds` after it fires. Fireteam utility AI gains two options: take the nearest cover on a hold order, and leave a building that is about to fall.
- Bridges: a bridge takes damage like a structure. At zero hit points it collapses: every ground unit on it is destroyed (squads lose the fireteams that were on it; a `bridge_fell` event names the bridge and the losses), it becomes water for the navigation grid, and paths are recomputed. An engineer squad ordered to the bridge (`hold` or the new `repair` order on that Place) restores hit points while it stands at either end unengaged; at a set share the bridge stands again. Fireteam and hauler AI will not start across a bridge below a danger share of hit points unless ordered to `move`.
- Capture: an engineer squad ordered to `capture` an enemy structure walks to it; after `captureSeconds` adjacent and unengaged, the structure changes side with its remaining hit points, the engineers are used up, and the new owner gets its unlocks (it may then build that faction's units of that role). A captured refinery takes haulers' loads for its new owner.
- Gold: each gusher adds gold to its field at its rate up to the cap. A hauler's own utility AI cycles: go to its assigned field, or else the nearest field with gold that is not known to be under fire; load; return to the nearest own refinery (or the headquarters when none stands); unload; repeat. A hauler under fire runs for home. A hauler with no reachable field waits at the refinery. The headquarters adds `hqTrickle`. Sea rigs keep passive income by capture.
- Snapshot additions for a side: `map` (the chosen map id, in the greeting), `landmarks[]` as last seen (`id`, `hp` share, `garrison` side and team count when known), `structures[]` own and seen enemy ones (`id`, `kind`, `side`, `x`, `y`, `hp` share, `building` progress), `bridges[]` as last seen (`id`, `hp` share, `standing`), `fields[]` as last seen (`gusher`, `gold` share), `haulers[]` own (`id`, `state`, `load` share, `field`, `x`, `y`) and seen enemy ones, `income` as gold per minute over the last minute, and per fireteam `cover` (the factor in effect) and `in` (landmark id when garrisoned). Events: `structure_started`, `structure_built`, `structure_lost`, `hauler_attacked`, `hauler_lost`, `garrisoned`, `building_fell`, `bridge_under_attack`, `bridge_fell`, `bridge_repaired`, `structure_captured`.
- Commands: `build {structure, place?}`, `haul {field | "auto", hauler?}`, `repair {place}`, `capture {place}`, and `move`/`hold`/`attack` take a `place` (see below) where they took a point. `buy` is refused with the missing structure's name when a requirement is not met.

Places
- One resolver on the server turns a `place` string into coordinates and a target: a point id or alias; a landmark id; a structure id; or an offset written as `<bearing> of <point> [<metres>]` with bearings in eight directions in both languages. The existing point resolver is its first step.
- Agents choose the place. Each leader's status lists the landmarks within its sight and those within a fixed radius of every point it knows, as `{ id, name, kind, cover, garrison }`. The model maps the commander's words ("the grove north of Foxtrot") to an id; when two fit it asks. The scripted brain matches kind word + relation word + point in both languages and otherwise falls back to the point.
- The radio net tags a transmission with the landmark ids its body clearly names (kind word next to a point name), the way it tags points today, so that scripted brains and the page can use them. Routing stays by callsign only.
- The page: landmarks are drawn from the map data (the hard-coded props go), named on hover or tap, and a tap with a squad selected offers Hold, Move and Take cover, which write the call with the landmark's name.

Agents
- Anvil's tools gain `build` and `haul`; leaders' `move`, `hold` and `attack` take `place`; engineer leaders also get `repair` and `capture`. Tool descriptions and prompts explain structures, requirements, haulers, cover and garrisons briefly. Anvil's two modes (on orders / running the fight), built separately, govern unordered building exactly as they govern unordered buying.
- Haulers and defences have no agents and make no model calls.

Lobby
- The room options gain `map` (`small` default; the lobby shows the three as cards with a small drawing made from the map's own terrain, points, bridges and gushers, its name and its size), `startGold` (presets 300, 1000, 2500, 5000 and a typed number within server limits) beside the existing length, speed and enemy level. Both players see all of them before Ready. The seat rows are coloured by state: empty, taken, ready, offline.

Scripted enemy
- It builds in a fixed order suited to its faction, keeps haulers working and replaces them, garrisons infantry in buildings near the points it holds, places a defence at its base, and respects the easy / normal / relentless pacing.

Art and sound
- Structures and landmarks are painted in the existing building style (the FLUX pipeline), with a ruin for each destructible one; haulers come from the Blender unit pipeline with loading and unloading frames; gushers and fields are animated in code over a painted base. Sprite manifest keys equal the rules ids. Code-drawn fallbacks exist for every new key so a missing picture never breaks the page.
- Construction, garrison entry, a building falling and a gusher get effects and sounds from the existing effect and sound modules.

Balance
- Targets: both factions between 45% and 55% over 200 scripted games on each map size; a typical ten-minute match on the small map fields three to five structures; a side that loses all haulers recovers to one hauler within about ninety seconds on the trickle.

## Testing Decisions

- A good test drives the game through its public seams and checks what a player or agent could observe. It does not reach into private fields or assert on the order of internal steps.
- Highest seam, preferred: the headless simulation driven by commands and read through per-side snapshots and events, as the existing whole-match, fog, deployment and balance tests do. New behaviour is tested here: requirements and unlocks, construction time and gold, structure loss, defences firing, fences blocking and being breached, pathing around obstacles and terrain, bridges collapsing with units on them and being repaired, structure capture, cover and garrison damage, garrison spotting, hauler cycles and income, gusher refill, place resolution, determinism (same seed, same hash) on all three maps, and balance per map.
- Room seam, for what the simulation does not own: lobby options and their limits, tool refusals and their reasons (`build`, `haul`, `buy` without a requirement), Anvil's modes applied to building, fog of the new snapshot fields between sides. Prior art: the room and hub tests.
- Radio seam: landmark tagging and offset phrases in both languages. Prior art: the radio parser tests.
- Agent seam: the scripted brain's handling of build, haul and described places in both languages, through the existing end-to-end test that runs the real server with the Node host.
- Page: pure modules only (place names, cover badges, build panel state from a snapshot, lobby option rendering), with `node --test`, plus the i18n test that fails on a missing or unused string. Real-page checks in headless Chrome are verification, not tests in the suite.
- Every new sprite key has a fallback, checked by a test that walks the rules ids against the manifest and the fallback table.

## Out of Scope

- Superpowers, the online phase (accounts, matchmaking, ladders, the open league, replays), commander levels, and more than two factions.
- Free placement of base structures by the player; power or supply as a resource; repairing and selling structures (engineers repair bridges only).
- Line-of-sight blocking by buildings or mountains, height, and destructible groves or rocks.
- A map editor and random map generation.
- Porting the page to Phaser or TypeScript.

## Further Notes

- The work is cut for parallel agents along these seams, each owning its files: (1) maps, terrain, bridges, pathing, landmarks, cover, garrisons, places and the lobby options; (2) structures, requirements, defences, fences, capture and engineers; (3) gushers, fields, haulers and income; (4) pictures for all of it. A final pass fits them together, teaches the scripted enemy the whole loop, balances all three maps, and refreshes the tutorial, Help and phone layout.
- The refinery is a structure (owned by 2) that haulers unload at (owned by 3). Until the two are fitted together, hauler code treats "any own structure with role refinery, else the headquarters" as the drop-off through one function.
- Matches get longer with a base to build; the lobby's length choices gain 15 and 20 minutes.

---

## Addendum 1 (2026-11-24, second wave): placing structures, units leaving their building, heroes, sandbags

Requested by the owner while the first wave was being built. It is built after the first
wave is fitted together, because every item stands on it. As above, every name, character
and picture is original to Callsign.

### What changes from the spec above

- **Structures are placed by the player.** This replaces "structures placed for me in a
  base layout" (story 10) and the fixed build slots. Choosing a structure shows its
  footprint under the pointer or finger; the ground where it may go is tinted green: land
  that is free, within the **build radius** of the headquarters or of any finished base
  structure of that side (start with 260 map units from the headquarters and 180 from other
  structures; tune by play). Anywhere else the footprint is red and cannot be confirmed.
  Confirming writes and sends the radio call, with the spot said as an offset from the
  nearest named Place ("Anvil, build a Vehicle Works 140 metres north-east of Alpha"), so
  radio stays the only way to act and a spoken order with a described place works too.
  The server checks the same rule and refuses a spot that is not allowed, with the reason.
  The scripted enemy and Anvil (when it has the fight) choose spots with a simple
  deterministic rule. Defences and fences are placed the same way, within their own radius.
- **Structures go up visibly.** A structure under construction is animated from a bare
  footing to the finished building over its build time (rising in stages with scaffolding,
  cranes or tarps by faction, dust and sparks, a sound), not a progress bar alone.
- **Units come out of the structure that makes them.** Infantry walk out of the barracks
  door, vehicles roll out of the works, boats slide out of the dockyard, aircraft lift off
  or taxi from the airbase, haulers leave the refinery. A deployment is tied to a standing
  structure of the right role (the nearest to the headquarters when there are several);
  the unit appears at its exit and moves to a rally spot beside it. When that structure
  falls during a deployment the deployment is lost with it. The door or bay animates
  (opening, a light, exhaust). Only a side with none of the starting structures left falls
  back to the headquarters.
- **Moving looks better.** Infantry walk cycles get proper stride, turn and stop frames and
  fireteams keep a loose formation instead of a clump; vehicles get rolling tracks or
  wheels, body sway, dust or wake, and turn through intermediate facings; aircraft bank;
  everything eases in and out of motion.

### New

- **A hero for each army.** One exceptional soldier per side, alive one at a time, costly,
  needing a barracks and one further structure, with a long deployment and its own
  callsign class. Heroes are original characters with abilities the regular infantry lack,
  different for each army:
  - Aegis: **Sentinel** (callsign Ghost / רפאים): a lone marksman who outranges every
    infantry weapon, stays unseen until close or until firing, and carries demolition
    charges: ordered onto an enemy structure or bridge, the hero plants a charge that
    destroys it after a short fuse.
  - Ashfall: **Oracle** (callsign Raven / עורב): a lone infiltrator who walks as a neutral
    figure the enemy does not shoot until close, takes over one enemy vehicle squad at a
    time for as long as the hero lives and stays near it, and whose presence shakes the
    nerve of enemy fireteams around it.
  Each hero is a squad of one with a leader agent like any squad (it starts one brain tier
  higher), shows its own portrait and health in the roster, and is announced on both nets
  when it enters and when it falls. Balance target: a hero is worth about three infantry
  squads when used well and is lost to a tank or a defence when used carelessly.
- **Sandbags.** Any infantry squad can be told to fortify where it stands ("Viper 2, dig
  in", "צפע 2, התבצרו"). After a few seconds unengaged and unmoving, a sandbag position
  appears around the squad: a small landmark of kind `sandbags` that gives cover from the
  front arc it was built facing (toward the nearest enemy or the nearest unowned point),
  to whoever stands in it, and stays until destroyed by heavy weapons or driven over by a
  vehicle. A squad can build a limited number per match. Sandbags are a Place that later
  orders can name ("the sandbags east of Delta").

### User stories added

46. As a commander, I want to choose where a structure goes inside a green area around my base, so that I shape my own base.
47. As a commander, I want the ground where I cannot build shown clearly, and a refusal that says why, so that I do not waste a call.
48. As a commander, I want to watch a structure go up, so that the base feels alive and I can see what the enemy is building.
49. As a commander, I want new units to come out of the building that made them, so that I see where my army comes from and the enemy can cut it off.
50. As a commander, I want units to move with believable animation and formation, so that the battle reads at a glance.
51. As a commander, I want one hero that is clearly different from my regular soldiers, so that I have a special piece to plan around.
52. As a commander, I want the two armies' heroes to play differently, so that the factions differ at the top as well.
53. As a commander, I want to be told on the radio when a hero takes the field or falls, mine or the enemy's, so that I can react.
54. As a commander, I want to tell infantry to dig in with sandbags where they stand, so that I can hold open ground.
55. As a commander, I want sandbags to protect only from the side they face, so that flanking still works.

### Implementation and testing notes

- Commands: `build` takes a Place offset as its spot; new `fortify` order for infantry; new `plant {place}` and `seize {contact}` orders for the heroes. Rules: `match.buildRadius`, a `hero` entry per faction, `sandbags` in `landmarkKinds`, a `rally` offset per structure role, and construction stages per structure.
- Snapshot: structures carry their construction stage; deployments carry the structure they come from; squads carry `fortified` and heroes their ability state.
- Tests stay at the same seams: placement rule and refusals, deployment from the right structure and its loss, hero abilities and their counters, sandbag arc and destruction, all through commands and snapshots; placement tinting and call writing as pure page functions.
- Pictures: construction stages for every structure, doors and bays, the two heroes (sheets in the infantry form plus ability poses), sandbags, and the improved movement frames, through the same two pipelines.

---

## Addendum 2 (2026-11-24): the opening

Requested by the owner; it replaces story 18 and the `startStructures` decision above.

- **A match starts with the headquarters and the starting squads only.** No barracks, no
  refinery and no hauler are given. The first thing a commander does is build the
  refinery.
- **A finished refinery comes with one hauler**, free, which leaves its bay and goes to
  work. A rebuilt or second refinery brings one too.
- **More haulers are built at the works**, not at the refinery: the hauler requires the
  works role. The hauler cap stays.
- **Starting gold has to carry the opening.** The lobby default becomes enough for a
  refinery, a barracks and a first squad with a little to spare (set it by play; about
  1,000), and the lowest preset is not below the refinery's cost. The headquarters trickle
  stays as the safety net for a side with no refinery.
- **The usual opening** is refinery, then barracks, then works; nothing forces the order
  except the requirements (the works still needs a barracks).
- The scripted enemy, Anvil with the purse, the tutorial and Help all follow this opening.
  The tutorial's economy step becomes "build your refinery" and watching the first hauler
  leave it.

Story 18 now reads: As a commander, I want to open by building my refinery and receive my
first hauler from it, so that every match begins with a real choice of build order.
