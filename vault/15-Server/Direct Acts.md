---
title: Direct Acts
description: "A direct act is something the commander does with their own hand from the page: an act frame that the room carries out in the same tick, with no radio call and no agent in between."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/mixed
  - area/server
  - topic/server
  - topic/protocol
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Initiative - Orders, Fight and Purse]]"
  - "[[Base Cues]]"
  - "[[Net Language]]"
  - "[[Server Architecture]]"
  - "[[WebSocket Frames]]"
  - "[[Radio versus Direct Acts]]"
  - "[[Decision - Direct Build and Buy]]"
  - "[[Decision - Command Sidebar]]"
  - "[[Build Bar]]"
  - "[[Selection and Map Orders]]"
paths:
  - server/room/act.go
  - server/room/act_test.go
  - server/room/ws.go
  - server/room/tools.go
  - server/room/build.go
  - server/room/queue.go
  - server/room/power.go
  - server/room/command.go
  - CLAUDE.md
---

# Direct Acts

A direct act is something the commander does with their own hand from the page: an `act` frame that the room carries out in the same tick, with no radio call and no agent in between. Building, buying, cancelling, selling, repairing, setting a rally point and (since 2026-11-26) sending a selected squad to move, hold or attack all go this way; everything else a squad can be told is still a radio call.

## The frame

```
{"type":"act","id":7,"name":"build","args":{"structure":"barracks","place":"north"}}
```

The answer goes to the caller only: `{"type":"acted","id":7,"act":"build","ok":true,"data":{...}}`, or `ok:false` with `error`. On success the whole side also gets `{"type":"direct","act":...,"tick":...,"result":...,"lang":...}`.

## The seven acts (`Room.Act`)

| `name` | Arguments used | Runs | Result (`data`) |
|---|---|---|---|
| `build` | `structure` (id, role, or name in either language), `place`, `place2` (a fence's far end), `run` (how a fence lies: `ns`, `ew`, `nesw`, `nwse`, or compass words) | `toolBuild` → `sim.Build` | `structure`, `kind`, `name`, `near`, `buildSeconds`, `gold`, `announced` |
| `buy` | `unit` | `toolBuy` → `sim.Apply(CmdBuy)` | `squad`, `unit`, `tier`, `gold`, `deploySeconds`, `from`, `inLine`, `announced` |
| `cancel` | `unit` (optional: empty cancels the last unit bought of any kind) | `toolCancel` | `cancelled`, `unit`, `refund`, `gold` |
| `sell` | `place` or `structure`: one of the side's own structures | `toolSell` | `sold`, `name`, `back`, `gold` |
| `repair` | `place` or `structure` | `toolMend` (the side pays; the structure mends over time) | `repairing`, `name`, `cost`, `gold` |
| `rally` | `place` (a point, landmark, offset from a point, or "home"), `structure` (optional: one producer) | `toolRally` | `place`, `structure` |
| `order` | `squad` (id), `order` (`move`, `hold` or `attack`), and `place` / `point` or `contact` | `directOrder` → `orderSquad` | `squad`, `id`, `order` |

These are the same functions the operator's tools call, so "the checks are the game's own" (comment in `act.go`): gold, the build tree, placement, power, the population and base caps, the production line's limit.

## Checks specific to a direct act

- Only a `hammer` connection may act, and only for its own side: otherwise `ErrNotCommander` ("only a side's commander builds and buys from the panel").
- Refused once the match is over.
- `buy` with `upgrade` set is refused: "an upgrade is asked of the operator on the radio".
- `order` takes only move, hold or attack; anything else is refused with "... is asked on the radio". The squad must be alive and the side's own.

## What is different from the operator doing it

While `Room.Act` runs, `rm.direct` is true. `mayBuy` then returns at once with "no leave needed, nothing to announce": the purse rules of [[Initiative - Orders, Fight and Purse]] do not apply to the commander's own hand, and the operator does not announce the purchase as its own. For comparison, when the operator calls the same tools:

| Caller | Needs leave? | Announced on the net? |
|---|---|---|
| Commander (`act`) | no | no line at the time; the base cue says when the thing is ready |
| Operator, Hammer spoke to it in the last 90 s (`orderSeconds`) | no (counts as ordered) | no |
| Operator holding the purse | no | yes, as its own purchase (`radio.ownPurchase` lines) |
| Operator otherwise | refused (`ErrNotOrdered` or `ErrNoBuying`) | |

Also, a refusal of the operator's `buy` or `build` raises a base cue (`cueRefusal`); a refused direct act only answers the caller.

## How the side's agents learn of it

The `direct` frame is broadcast to the side (operator, squad leaders, hosts) and to spectators. The comment calls it "a line for the operator's picture of the net, not a transmission": it wakes nobody. It carries the commander's language, because a squad sent by hand reports in it afterwards. When the structure or squad is ready, the operator's ordinary base cue announces it ([[Base Cues]]).

## Tap-to-order (`directOrder`)

1. The order is applied through the same `orderSquad` path a squad leader's own tool uses (one place resolver for points, landmarks, bridges, structures and "bearing of point" spots).
2. The squad is marked as Hammer's own: `rm.traffic[side].hammers[squad] = true`. The operator is told which squads those are (`hammerOrdered` in its report) and gives them no task until it is handed the fight afresh.
3. The squad answers on the net **by code**, with no thought of its leader's: "Wilco" (Hebrew "יבוצע") ending in Out, composed with `radio.Net.Compose` and transmitted with kind `ack`.

## The page's language (`lang` frame)

A commander who builds from the panel before saying a word would otherwise hear the first base cues in English. `Room.SetLang` records the page's language for the side (`he` or `en`) and broadcasts `netlang`, so agents write in it from their first line. Speaking on the net sets the language too. See [[Net Language]].

## History and reason

- The locked decision "Building and buying are the player's own act" was changed on 2026-11-24 by the owner: "no need to wait for anvil to approve it, its a waste of time" (`CLAUDE.md`). Server side: commit `9a9e5b5`; page and agents: `5317c8b`.
- Tap-to-order came on 2026-11-26. Commit `c2d99ae` first sent the tap as a radio call naming the exact spot; `9e56316` made it a direct order answered by code. The comment in `act.go` attributes it to the owner, 2026-11-26.
- Before both, every purchase was a radio call to Anvil. Anvil can still build and buy when ordered by radio or when it holds the purse.

Differs from `CLAUDE.md`: the "Command sidebar" decision says "Orders to squads go only by radio; the sidebar's order buttons only compose radio calls". In the code a selected squad's move, hold or attack from the map is a direct act, not a radio call.

## Tests

`server/room/act_test.go`: the commander builds and buys directly; direct actions meet every check and only the commander may act; cues follow the page's language before the commander speaks; a squad sent by hand answers Wilco.

## Related

- [[Server Architecture]]
- [[WebSocket Frames]]
- [[Radio versus Direct Acts]]
- [[Decision - Direct Build and Buy]]
- [[Decision - Command Sidebar]]
- [[Build Bar]]
- [[Selection and Map Orders]]
- [[Placement and Production Queues]]
- [[Agent Tools]]
- [[Base Cues]]
- [[Initiative - Orders, Fight and Purse]]
