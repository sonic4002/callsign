# How the classic base-building RTS plays, and what Callsign should take from it

Research note, 2026-11-24. Subject: Command & Conquer: Red Alert 2 and its expansion
(2000–2001), referred to below as "the classic". Compared against
`docs/specs/2026-11-24-bases-harvest-maps.md` with both addenda.

## The line we keep

We adopt how the genre **plays**: mechanics, pacing, the shape of the build tree, the
economy loop, unit roles and counters, interface conventions and feedback. We do **not**
copy that game's protected expression: none of its faction, unit, structure, character
or superweapon names become ours, and none of its art, sounds, voice lines, music, maps
or interface look is recreated. Callsign's names, designs and pictures stay original.
Every recommendation below is written as a mechanic. Where the classic's own names
appear in this note it is only to say what was researched.

## How sure each fact is

- **Sourced**: found in a source listed at the end during this research.
- **Memory**: widely known to players and consistent with the sources, but not confirmed
  against a page in this pass. Treat numbers marked this way as approximate.
- Sources are fan wikis, long-standing strategy guides and the manual. They sometimes
  mix the base game, the expansion and mods; where that mattered it is said.

## 1. The opening and build order

- A skirmish side starts with one mobile construction vehicle and a handful of escort
  units (sourced: free construction vehicle; the escort count is a lobby option, memory).
  The vehicle unpacks into the construction building. Nothing else stands.
- Starting money is a lobby option, with 10,000 the usual default (memory; the search
  did not confirm the figure). A refinery costs 2,000 (sourced), so the default covers
  the whole opening and the first army.
- The standard order is: power, barracks, refinery, factory, then the radar-type
  structure, then the lab (sourced, two guides). A common economy variant is power,
  barracks, refinery, factory, second refinery (sourced). Guides disagree on barracks
  before or after the refinery; it depends on how close the enemy is.
- Power comes first because everything else needs it. The barracks is cheap and is a
  prerequisite of the refinery and factory chain, and it lets early infantry scout and
  garrison.
- First contact is scouting within the first minute or two (dogs or cheap infantry);
  the first real fight comes once the factory has produced a few tanks, around minutes
  three to five (memory).

## 2. The economy loop

- **Refinery brings a harvester.** Every refinery is delivered with one harvester, free
  (sourced). More harvesters are built at the factory (sourced for the expansion
  faction, memory for the others). Players often build a second refinery because the
  free harvester makes it nearly the same price as buying one.
- **Two kinds of deposit.** Ordinary ore, and gems worth double (sourced). One faction's
  harvester carries about 500 per full ore load and teleports home; the other carries
  about 1,000, is armed, and drives (sourced, forum). So one is fast and fragile and the
  other slow and tough: the same income arrives in different shapes.
- **Regrowth.** Ore spreads slowly outward from drill-like map features, so a field near
  a drill lasts; gems do not regrow (memory; the search found nothing on regrowth).
- **A purifier-type structure** adds 25% to every load for one faction (sourced).
- **Trip economics.** Income is lumpy: nothing, then a load. Distance from field to
  refinery sets the rate, so players put refineries close to fields and build a second
  one at an expansion. Two to three harvesters per refinery is the usual ratio before
  queuing at the dock wastes time (memory).
- **Losing harvesters** is the standard way to lose a match slowly. Harvester raids are
  a core tactic; a side with no harvester and no money sells structures to afford one.
- **Selling and repairing.** Any own structure can be sold for about half its cost and
  releases a few infantry (memory: half; the search did not confirm it). Structures are
  repaired for money over time with a repair mode; an engineer walking into an own
  structure repairs it fully at once (sourced: engineers repair own structures).
- **Power and money.** Low power does not cost money directly. It slows production,
  switches off the radar and the powered defences, and stops superweapons charging
  (sourced: radar, powered defences, superweapon charging; memory: slower production).
  Killing power plants is therefore the cheap way to open a base.

## 3. Base building

- **Placement.** A structure may be placed only near an existing own structure. The
  rules data calls this adjacency and gives most structures a small value in cells, with
  naval structures and walls allowed further out (sourced, modding forum and a rules
  file comment; the retail value is small, about two cells, memory). The allowed area
  therefore grows as the base grows: players "creep" a chain of cheap structures toward
  a field or a choke point.
- **The ghost.** The structure follows the pointer as an outline tinted to show where it
  may go; a click places it instantly, because the build time was already spent in the
  sidebar.
- **Build then place.** A structure is *built in the sidebar* (the button fills as money
  is spent over time), then it is "ready" and waits to be placed. Money drains as the
  build proceeds; if money runs out the build pauses.
- **Queues.** Structures and defences have separate queues: one structure and one
  defence can be under way at once (sourced). Infantry and vehicles queue up to 30 and
  come out in order (sourced). More barracks or factories speed up production rather
  than adding parallel queues (memory).
- **Walls** are cheap, bought by the segment and placed in runs; they stop ground units
  and are crushed by nothing, only shot or run down by the heaviest vehicles (memory).
  One faction's gates are absent in this game; own units simply path around walls.
- **Capture.** An engineer walking into an enemy structure takes it, and is used up
  (sourced). A captured production structure lets the captor build that faction's units.
- **Losing the construction building** stops all new structures until another is
  obtained (a second construction vehicle from the factory, once the tech allows).
  Existing production carries on (memory).

## 4. The tech tree

- Three tiers, each gated by one structure (sourced for the lab's prerequisites):
  1. Power, barracks, refinery, factory: basic infantry, engineers, basic tanks,
     harvesters, basic defences.
  2. The radar-type structure (for one faction it doubles as the airfield): the mini
     map, aircraft or mid-tier vehicles, naval yard units, better defences.
  3. The lab: top-tier units, the hero, special infantry, and the superweapons.
- The radar-type structure matters twice: it turns on the mini map and it is the gate to
  tier 3. Lose it, or lose power, and the mini map goes dark (sourced).
- Asymmetry is in the shape, not only the stats: one side's airfield *is* its radar, the
  other's radar is separate and its air power is thin; one side's defences are cheap and
  many, the other's are few and strong; one harvester teleports, the other fights.
- Country choice adds one unique unit or power per sub-faction (memory).

## 5. Units and counters

- **Roles.** Basic infantry (cheap, can deploy into a stronger static stance for one
  faction), anti-armour infantry, engineer, attack dog (kills infantry instantly, sees
  spies), basic tank, heavy tank, anti-air vehicle that also carries infantry, artillery
  that outranges defences, aircraft that must return to reload, transports, naval units
  with a rock-paper-scissors of their own, spies that infiltrate structures for an
  effect, and special infantry.
- **Counters are sharp.** Infantry die to anti-infantry weapons and to being driven over
  (tanks crush infantry, memory); tanks die to anti-armour infantry in numbers and to
  aircraft; aircraft die to anti-air; defences die to artillery that outranges them.
  Nothing is good at everything.
- **Veterancy.** A unit that destroys enemies worth three times its own cost becomes
  veteran, and six times in total becomes elite (sourced, two guides). Veterans are
  tougher and hit harder; elites also heal themselves and often gain a better weapon
  (sourced: self-heal). Promotion is shown by chevrons on the unit. Engineers and
  similar units do not promote (sourced).
- **Garrisons.** Basic infantry can occupy civilian buildings and fire from them with a
  large bonus; the building's health is what protects them (sourced). The answers are:
  destroy the building, outrange it, bomb it, or use the few weapons that clear
  occupants without destroying the building (sourced: destroy/outrange/aircraft; the
  expansion added units that empty a building directly, memory). Evicted infantry
  survive and can run to the next building (sourced).
- **Deploy to change mode.** Several units have a second mode entered by a deploy order:
  infantry digging in for range and toughness, artillery that must set up to fire, a
  vehicle that unpacks into a structure (memory).
- **Heroes.** One per side at a time (sourced). A hero is a single infantry figure that
  kills infantry instantly at range, destroys structures and ships with planted charges,
  can swim, and self-heals; in the expansion the charge also works on vehicles
  (sourced). It needs the top-tier structure. Its counters are dogs, anti-infantry
  defences, garrisons, snipers and anything that kills infantry in one hit (sourced:
  garrisons and snipers flagged as threats). It cannot fight tanks head on. The other
  factions' heroes differ in kind: one takes control of enemy units and flattens
  infantry around itself, one calls in air strikes on a marked target (memory).

## 6. Defences

- Kinds: an anti-infantry emplacement, an anti-armour tower that needs power, an
  anti-air site, and walls. The strongest tower can be boosted by neighbours or by
  special infantry (memory).
- Powered defences switch off under low power (sourced). This is the main reason raids
  on power plants precede an assault.
- Siege units outrange every defence; defences outrange ordinary tanks. So a base
  defence buys time against a rush and loses to a prepared assault, which keeps the game
  moving (memory).

## 7. Superweapons and support powers

- Unlocked by building a dedicated structure that needs the lab (sourced).
- When one is built, **every player is told**, the shroud over it is lifted for
  everyone, and its countdown is visible to all (sourced). That turns it into an
  objective: destroy it, or build your own.
- One of each kind per player (sourced for one of them). The strike weapons take about
  ten minutes to charge and the support ones about five (memory; the search did not
  confirm the timers).
- Low power pauses the countdown; a spy entering it resets the countdown (sourced).
- Callsign already says superpowers come through the build tree and never by the clock,
  with the enemy warned when the structure goes up. That is this mechanic; nothing to
  change in principle.

## 8. Map features

- **Bridges.** Long bridges can be destroyed; anything on the span is lost. A small hut
  at the bridgehead lets an engineer rebuild the whole bridge by walking in (sourced).
- **Tech buildings**, neutral and capturable by an engineer (sourced):
  - a derrick: an immediate lump (about 1,000) and a steady income (about 20 a second);
  - an airport: a recurring paratroop drop (does not stack);
  - a hospital: infantry who enter are healed;
  - an outpost: repairs vehicles that drive in and is armed.
  They cannot be sold and need no power (sourced). They sit in contested ground and are
  the reason to send engineers out early.
- **Ore and gems**, with drills that keep ore fields alive (see 2).
- **Cliffs and water** split maps into routes; naval yards and amphibious transports
  matter on water maps.
- **Shroud, not fog.** Unexplored ground is black; once seen it stays revealed, and
  enemy movement there remains visible only within sight of own units in practice
  because units are drawn only when seen. One faction has a structure that re-shrouds
  an area (memory; the search did not confirm the details). Callsign's three-state fog
  is stricter and stays.

## 9. Interface and feedback that carry the feel

- **A sidebar** with the mini map on top, money beside it, a power bar, and four
  production tabs: structures, defences and support powers, infantry, vehicles including
  aircraft and ships (sourced, wiki and manual).
- **Build buttons fill** as the item is built and show a count when several are queued;
  a finished structure's button reads ready until placed.
- **Rally points.** Each production structure has a point where new units gather; the
  player sets it once.
- **The mini map depends on the radar structure and on power** (sourced).
- **Voices.** Every unit answers when selected and when ordered, in character. A calm
  announcer reports events: construction complete, unit ready, building, on hold,
  cancelled, insufficient funds, low power, base under attack, harvester under attack,
  unit lost, new construction options, superweapon detected and ready (memory for the
  exact set; the search did not return a list). These cues are how a player follows a
  base without looking at it.
- **Pace.** Infantry take a few seconds each, tanks around ten to fifteen, structures
  fifteen to forty; a tank crosses a mid-sized map in well under a minute (memory).
- **Match length.** Skirmish and ladder games commonly end in ten to twenty-five minutes
  (memory), which is already Callsign's range.

## 10. Why it feels fast and readable

- Money is always the limit, never a unit cap, so there is always something to spend on
  and a reason to protect harvesters.
- Production is continuous and cheap to queue, so armies replace themselves; losing a
  fight is a setback, not the end.
- Time-to-kill is short for infantry and moderate for tanks; structures are tough except
  to the weapons meant for them.
- Units are large on screen with strong silhouettes and one colour accent per side.
- Sound tells the player what happened without the camera being there.
- Armies are tens of units, not hundreds (memory): typically ten to thirty tanks with
  infantry and a few specials.

## Comparison

| # | The classic | Callsign today / planned | Verdict | Why |
|---|---|---|---|---|
| Opening | Construction building only; build everything | Addendum 2: headquarters only, refinery first | **Adopted** | Already matches. |
| Starting money | Lobby option, large default | Lobby option; default about 1,000 | **Adapt** | Keep it enough for refinery + barracks + first squad; our costs are a tenth of the classic's. |
| Refinery | Brings a free harvester; more from the factory | Addendum 2: same | **Adopted** | |
| Deposits | Ore, and gems worth double; drills regrow ore | One kind of field fed by a gusher | **Adapt** | Add a rarer rich field worth double that does not refill. |
| Harvester asymmetry | Fast-fragile versus slow-armed | Crawler slow and tough, truck fast and light | **Adopted** | Consider arming the slow one lightly. |
| Sell / repair | Sell for half; repair for money; engineer repairs at once | Out of scope (engineers repair bridges only) | **Adopt** | Cheap, and it is the recovery path for a side with no hauler. |
| Power | Second constraint; low power cuts radar, defences, speed | None | **Adopt, simply** | One number per side; gives raids a target and the base a shape. |
| Placement | Near own structures; area grows with the base; tinted ghost | Addendum 1: green area by radius from HQ and structures | **Adopted** | Make sure the area extends from every finished structure, so bases creep. |
| Build then place | Built in the sidebar, then placed instantly | Placed, then rises over the build time | **Keep ours** | Addendum 1's visible construction is the better picture and suits radio ("build a works north of Alpha"). |
| Queues | One structure + one defence at once; units queue with a count | One structure + one defence; units deploy in parallel; a count badge exists | **Adopt** | Units of one kind should come out one after another from their structure, with the count. |
| Rally points | Per production structure | Addendum 1: a rally spot beside the structure | **Adapt** | Let the player move it by radio ("new squads rally at Delta"). |
| Walls | Stop ground units; own units path around | Fences stop the enemy only | **Adopt** | With real pathing, own units should route around, and gaps matter. |
| Capture | Engineer takes a structure | Same | **Adopted** | |
| Losing the construction building | No new structures | Losing the HQ ends the match | **Keep ours** | Our HQ is the win condition; a ten-minute match needs a clear end. |
| Tech tiers | Radar structure gates tier 2 and the mini map; lab gates tier 3 | Barracks → works → airbase; no radar, no lab | **Adopt** | A radar structure that turns on the mini map and gates aircraft and the hero is cheap and very recognisable as genre. |
| Veterancy | Kills worth 3× / 6× own cost; chevrons; elites self-heal | Brain tiers bought with gold; chevrons mean brain tier | **Adapt** | Add earned ranks for fireteam stats, shown differently from brain chevrons. Brain tiers stay bought: that is Callsign's own idea. |
| Garrisons | Infantry in civilian buildings; evicted when it falls | Same, in the spec | **Adopted** | Add one counter that clears a building without destroying it. |
| Crushing | Tanks run over infantry | None | **Adopt** | Gives armour a way through infantry and makes sandbags and buildings matter. |
| Deploy modes | Dig in, set up to fire | Addendum 1 sandbags; launcher minimum range | **Adapted** | Enough. |
| Hero | One at a time; kills infantry, demolishes structures; weak to dogs, defences, armour | Addendum 1: Sentinel and Oracle, one at a time | **Adopted** | Our two are our own; keep the counters sharp (defences and armour kill them). |
| Scout unit | Dog: cheap, fast, kills infantry, spots infiltrators | None | **Adapt** | A cheap fast scout squad with no model cost would make fog play better. See conflicts. |
| Defences | Powered; outranged by siege | Unpowered; currently outranged by rifles | **Adopt** | Tie the strong defence to power; make only siege units outrange defences. |
| Superweapons | Structure after the lab; announced to all; visible countdown | Planned through the build tree, enemy warned | **Adopted in principle** | Out of scope for this round. |
| Bridges | Destroyable; engineer rebuilds at a hut | Destroyable; engineer repairs | **Adopted** | |
| Tech buildings | Neutral, capturable: income, paradrop, heal, repair | Sea rig only | **Adopt** | Two or three per map give engineers a job from minute one. |
| Shroud | Stays revealed | Three-state fog | **Keep ours** | Fog suits agents who report what they see. |
| Sidebar | Mini map, money, power, four tabs, counts | Sidebar with radar, gold, roster, build | **Adapt** | Tabs: structures, defences, infantry, vehicles (air and sea inside). |
| Event cues | Announcer voice for every base event | Log lines; squads speak; Anvil announces own purchases | **Adopt** | Short spoken cues from Anvil's voice for base events; the speech service and queue already exist. |
| Unit acknowledgements | Every unit answers | Every squad answers on the radio | **Ours is the stronger version** | |
| Direct selection and micro | Drag-select, control groups, per-unit orders | Radio only | **Keep ours** | See conflicts. |
| Army size | Tens of units, no cap | 12 squads, token cost bound | **Keep ours** | See conflicts. |

## Where "more like the classic" conflicts with Callsign

1. **Direct control.** The classic is played with drag-selection, control groups and
   clicks on the map. Callsign's rule is that radio is the only way to act and buttons
   only write calls. Adaptation: keep selection as "who am I talking to" (tap a squad,
   "All stations", named groups such as "Rhino section" addressed in one call) and let
   every map gesture compose a call. Do not add orders that bypass the net.
2. **Unit counts.** The classic's armies have no cap. Each Callsign squad is an agent
   that costs tokens. Adaptation: more bodies without more agents. Haulers, defences,
   scouts and garrisons already have no agent; a squad can be larger (more fireteams)
   at a higher brain cost; an agent-less "escort" attached to a squad follows it.
   Raise the visible size of an army, not the number of leaders.
3. **Money as the only limit.** The classic lets money buy anything at any time. Ours has
   a population cap for cost. Adaptation: keep the cap for squads with leaders only, and
   make sure there is always something useful to buy that is not a squad: structures,
   defences, walls, haulers, upgrades, repairs, veterancy-independent brain tiers.
4. **Per-unit micro.** Dodging, focus fire, kiting and manual retreat are a large part of
   the classic's skill. In Callsign these belong to the squad leader agent and the
   fireteam AI. Adaptation: make the result visible and creditable (squads say what
   they are doing; veterancy rewards it), and give the commander intent-level orders
   that stand in for micro ("fall back if you lose a team", "focus the launcher").
5. **Long matches.** A full tech climb in the classic takes fifteen minutes or more.
   Ours is ten to twenty. Adaptation: build times and costs at about a third of the
   classic's proportions, three short tiers, and the tier-3 structure affordable by
   minute eight on a normal economy.
6. **Announcer versus radio.** The classic has a detached announcer. On our net,
   everything spoken has a callsign. Adaptation: base events are short calls from Anvil
   ("Hammer, this is Anvil. Works complete. Out."), queued behind anything addressed to
   the player by a squad, and droppable when stale.
7. **Phone play.** Placement by ghost and a four-tab sidebar assume a mouse and a wide
   screen. Adaptation: placement by tap-and-confirm with the allowed area tinted, and
   the tabs as the bottom sheet's segments.

## Recommended changes

### Do now

1. **Power.** Each side has power produced and power used. A new cheap structure adds
   power; every other structure uses some. When use exceeds supply the side is on low
   power: structures build and units deploy at half speed, powered defences stop firing,
   and the radar structure stops working. Losing a power structure can cause it at once.
   - Rules: `power` (positive or negative) on every structure; a `powerPlant`-role
     structure per faction with original names; `match.lowPowerFactor`.
   - Tests (simulation seam): supply and use from the snapshot; low power halves build
     and deploy progress; a powered defence does not fire on low power and resumes; the
     event `low_power` fires once on entering it.
2. **Radar structure and tier gate.** A mid-tier structure that requires the works. While
   it stands and the side has power, the side's snapshot includes the mini map data;
   without it the page shows no mini map. It is also the requirement for the airbase and
   for the hero.
   - Rules: a `radar`-role structure per faction; `requires` updated; a snapshot flag
     `radar: true|false`.
   - Tests: the flag follows the structure and power; airbase and hero refused without
     it; page module test that the radar panel renders only when the flag is true.
3. **Production queues at the structure.** Units of a role are produced one after
   another by their structure; a second structure of the role adds a second line. The
   button shows the number in line and the progress of the first; a line can be
   cancelled for a refund of what is not yet spent.
   - Rules: none beyond `deploySeconds`; `match.queueLimit`.
   - Tests: three buys of one unit come out at one, two and three times the deploy time;
     with two structures, two lines; cancel refunds; the snapshot lists each line.
4. **Rally points by radio.** Each production structure has a rally Place; new units
   move there on arrival. "New squads rally at Delta" sets it for all, or for the
   structure named.
   - Rules: default `rally` offset per role. Command: `rally {place, structure?}`.
   - Tests: a unit deployed after the order ends up holding at the Place; the default
     is beside the structure; the scripted brain understands the call in both languages.
5. **Sell and repair.** "Sell the dockyard" removes an own structure and returns half its
   cost at once. "Repair the works" restores it over time for gold in proportion to
   damage; an engineer squad ordered into an own structure repairs it fully and is
   used up.
   - Rules: `match.sellShare` 0.5, `match.repairCostShare`, `match.repairPerSecond`.
     Commands: `sell {structure}`, `repair` extended to structures.
   - Tests: gold after a sale; unlocks removed; repair drains gold and stops at full or
     at zero gold; the headquarters cannot be sold.
6. **Earned ranks (veterancy).** A squad whose kills are worth three times its own cost
   becomes seasoned, and six times becomes elite. Seasoned fireteams are steadier and
   more accurate; elite ones also recover health slowly out of combat. This is separate
   from the brain tier, which stays bought.
   - Rules: `ranks` table with thresholds and stat factors. Snapshot: `rank` per squad.
   - Tests: thresholds from staged kills; stat factors applied; rank survives an
     upgrade of the brain; the page shows rank and brain tier as two different marks.
7. **Tech buildings on the maps.** Two or three neutral, capturable-by-engineer
   structures per map, original in name and look: one that gives a lump of gold and a
   steady income, one that heals infantry standing by it, one that repairs vehicles
   beside it. They need no power, cannot be sold and can be retaken.
   - Rules: `techBuildings` kinds with effects; placements in each map.
   - Tests: capture changes owner; each effect through the snapshot; recapture; fog of
     ownership as last seen.
8. **Spoken base cues.** Short calls from Anvil for: structure complete, unit ready, not
   enough gold, low power, base under attack, hauler under attack, structure lost, new
   options available. Each is one fixed line per language, rate-limited per kind.
   - Rules: `radio.cues` with the lines in both languages and a minimum gap per kind.
   - Tests (room seam): each event produces one message with the right addressee and
     language; repeats inside the gap are dropped; none is sent to the other side.
9. **Crushing.** A heavy vehicle that moves through an infantry fireteam in the open
   destroys a member per pass; fireteams in a building, behind sandbags or in a grove
   cannot be crushed. Fireteam AI steps aside when it can.
   - Rules: `crushes: true` on heavy vehicles, `crushable` by class.
   - Tests: a tank ordered through infantry in the open kills members; none behind
     sandbags; the scripted enemy does not rely on it.
10. **Defences worth having.** Powered defences outrange every infantry weapon and
    ordinary tank gun; only the siege unit of each faction outranges them. This closes
    the flaw found in testing where riflemen shot a gun down from behind its own wall.
    - Rules: ranges; a test that walks every unit's range against every defence's.

### Do next

- A rich field kind worth double that does not refill, placed in contested ground.
- Walls that own units path around, with deliberate gaps, once the navigation grid is in.
- A cheap, fast scout with no leader agent, attached to the commander ("scout to Golf")
  and reporting contacts through Anvil.
- A counter that empties a garrison without destroying the building.
- A second mode for one unit per faction entered by a "deploy" order.
- Sidebar tabs in the classic's four groups; placement ghost polish; a production
  progress line under each structure on the map.
- A lab-role structure as tier 3 when superpowers are built.
- Sub-faction choice (one unique unit or perk) in the lobby.

### Do not do

- **Drag-selection, control groups or click-to-move.** They bypass the radio, which is
  the game.
- **Uncapped unit counts with one agent each.** It breaks the cost bound; grow squads and
  agent-less units instead.
- **Build-then-place.** Ours shows the structure rising where it stands, which reads
  better and fits a spoken order.
- **Permanent shroud instead of fog.** Fog is what makes squad reports matter.
- **Losing the construction building as a mere setback.** Our headquarters is the win
  condition.
- **Any of the classic's names, characters, unit or structure designs, voice lines,
  sounds, music, maps or interface art.** The mechanics are free to use; the expression
  is not ours.

## What could not be verified in this pass

- The default starting money (10,000) and the superweapon timers (ten and five minutes).
- The sell refund (half) and the exact repair cost.
- Ore regrowth rules and whether gems regrow.
- The exact adjacency value in the retail game and its units.
- The complete list of announcer cues.
- Production times and unit speeds as numbers; the figures above are from memory.
- Whether extra production structures add speed or parallel lines.

## Sources

- [Red Alert 2 manual (PDF mirror)](http://nyerguds.arsaneus-design.com/manuals/Red%20Alert%202/Red%20Alert%202%20-%20English.pdf)
- [Red Alert 2 manual, wiki page](https://cnc.fandom.com/wiki/Command_%26_Conquer:_Red_Alert_2_manual)
- [Manual excerpt with shortcuts (Scribd)](https://www.scribd.com/document/740449111/Command-Conquer-Red-Alert-2)
- [Sidebar, C&C wiki](https://cnc.fandom.com/wiki/Sidebar)
- [Radar, C&C wiki](https://cnc.fandom.com/wiki/Radar)
- [Garrisoning, C&C wiki](https://cnc.fandom.com/wiki/Garrisoning)
- [Engineer, C&C wiki](https://cnc.fandom.com/wiki/Engineer_(Red_Alert_2))
- [Tech building, C&C wiki](https://cnc.fandom.com/wiki/Tech_building)
- [Tech buildings, CNCNZ](https://cncnz.com/games/red-alert-2/tech-buildings/)
- [Superweapon, C&C wiki](https://cnc.fandom.com/wiki/Superweapon_(Red_Alert))
- [Mobile construction vehicle, C&C wiki](https://cnc.fandom.com/wiki/Mobile_construction_vehicle_(Red_Alert_2))
- [War miner, C&C wiki](https://cnc.fandom.com/wiki/War_miner)
- [Hero unit, C&C wiki](https://cnc.fandom.com/wiki/Tanya_(Red_Alert_2))
- [Allied structures, CNCNZ](https://cncnz.com/games/red-alert-2/allied-structures/)
- [Soviet structures, CNCNZ](https://cncnz.com/games/red-alert-2/soviet-structures/)
- [Expansion structures, CNCNZ](https://cncnz.com/games/yuris-revenge/yuris-structures/)
- [The Ultimate RA2 Strategy Guide](http://www.vbg6.dk/ra2/strategies/The%20Ultimate%20RA2%20Strategy%20Guide.htm)
- [Build order thread, CnCNet forums](https://forums.cncnet.org/topic/12733-what-is-the-build-order-for-soviets-in-red-alert-2-yuris-revenge/)
- [Build range thread, CnCNet forums](https://forums.cncnet.org/topic/5325-build-range/)
- [Money questions thread, XWIS forums](https://xwis.net/forums/index.php/topic/163158-i-got-alot-of-money-questions/)
- [Compendium, Neoseeker](https://www.neoseeker.com/command-conquer-red-alert-2/faqs/25713-red-alert-2-d.html)
- [Strategy guide by SRN, GameFAQs](https://gamefaqs.gamespot.com/pc/914165-command-and-conquer-red-alert-2/faqs/9899)
- [Expansion strategy guide by SRN, GameFAQs](https://gamefaqs.gamespot.com/pc/476890-command-and-conquer-red-alert-2-yuris-revenge/faqs/14539)
- [Soviet building and unit guide, GameFAQs](https://gamefaqs.gamespot.com/pc/914165-command-and-conquer-red-alert-2/faqs/24302)
- [Walkthrough with veterancy notes, StrategyGamers](https://strategygamers.com/walkthrough/command-and-conquer-red-alert-2-4)
- [Review, GameSpot](https://www.gamespot.com/reviews/command-and-conquer-red-alert-2-review/1900-2646216/)
- [Red Alert 2, Wikipedia](https://en.wikipedia.org/wiki/Command_%26_Conquer:_Red_Alert_2)
- [Yuri's Revenge, Wikipedia](https://en.wikipedia.org/wiki/Command_%26_Conquer:_Yuri%27s_Revenge)
