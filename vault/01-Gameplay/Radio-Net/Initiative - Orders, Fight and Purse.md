---
title: Initiative - Orders, Fight and Purse
description: "Who decides on a side is a rule of the game held by the room, not a habit of a model."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/code
  - area/gameplay
  - topic/radio
  - topic/initiative
  - topic/operator
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Rule Brain]]"
  - "[[Operator - Anvil]]"
  - "[[Radio versus Direct Acts]]"
  - "[[Radio Net and Bilingual Procedure]]"
  - "[[Command Net and Squad Net]]"
  - "[[Traffic Levels]]"
  - "[[Base Cues]]"
  - "[[Agent Tools]]"
  - "[[Decision - Direct Build and Buy]]"
  - "[[Economy]]"
paths:
  - server/room/command.go
  - server/room/command_test.go
  - server/room/traffic.go
  - server/room/act.go
  - server/room/build.go
  - server/room/power.go
  - server/room/tools.go
  - server/room/room.go
  - shared/rules.json
---

# Initiative - Orders, Fight and Purse

Who decides on a side is a rule of the game held by the room, not a habit of a model. By default the operator (Anvil) acts on Hammer's orders only; Hammer can hand it the fight (it tasks squads on its own) and, separately, the purse (it spends gold on its own), by fixed phrases, a switch on the page, a lobby option or the operator's `command` tool.

## The state

Per side, in `Room.cmd` (`command` struct in `server/room/command.go`):

| Field | Meaning | Start of match |
|---|---|---|
| `fight` | The operator has the initiative: it tasks squads on its own | false |
| `buy` | The purse: the operator may buy, build, upgrade and repair on its own | false, or true when the match was made with the lobby's purse option (`Config.Purse`) |
| `asked` | Tick of Hammer's last word to the operator, -1 for never | -1 |

Clients see it as `{"mode":"orders"|"fight","buy":true|false}` (`CommandView`), sent in a `command` frame whenever it changes.

| Mode | Constant | Meaning |
|---|---|---|
| orders | `ModeOrders` | The operator acts on Hammer's orders only |
| fight | `ModeFight` | Hammer has handed the operator the fight |

## The fixed phrases

From `shared/rules.json` → `radio.command`. `heardHammer` checks every transmission of Hammer's that is addressed to the operator or to all stations: if the lower-cased body *contains* a phrase, the mode switches by code.

| Kind | Effect | English | Hebrew |
|---|---|---|---|
| `give` | Hand over the fight | run the fight · run the battle · manage the fight · take over the fight · you have command · the fight is yours | נהל את הקרב · תנהל את הקרב · נהלי את הקרב · הפיקוד אצלך · קח פיקוד · הקרב שלך |
| `take` | Take it back | i have command · i am taking command · i'm taking command · i take command · on my orders only | הפיקוד אצלי · אני לוקח פיקוד · אני לוקחת פיקוד · רק בפקודה שלי |
| `grant` | Give the purse | you may buy · you can buy · permission to buy · buy as you see fit · buy on your own · buy what you need · keep buying | מותר לך לקנות · אתה יכול לקנות · אני מאשר לך לקנות · מאשר לך לקנות · אישור לקנות · קנה לפי שיקולך · קנה מה שצריך · תמשיך לקנות |
| `revoke` | Take the purse back | do not buy · don't buy · stop buying · no buying · no more buying | אל תקנה · תפסיק לקנות · הפסק לקנות · בלי קניות · לא לקנות |

How they combine:

- `take` → fight off and purse off.
- `give` → fight on. The purse comes with it when the fight was not already handed over ("unless Hammer keeps it back"). Every squad marked as Hammer's becomes the operator's again.
- `grant` (without `take` in the same call) → purse on, with or without the fight.
- `revoke` → purse off, also in the same breath as `give` ("run the fight, do not buy").
- When a call changes the mode, `asked` is reset to -1: those words set who decides, they were not an order to buy (commit `b27766d`).

The page's one-tap switch transmits exactly these phrases (comment in `command.go`; commit `c61ad38`).

## The `command` tool

For any other wording the operator switches the mode itself (`toolCommand`, arguments `mode`: `"orders"` or `"fight"`, and `buy`: true/false; empty to read the mode).

- Taking more room — the fight or the purse — is allowed only while Hammer has just spoken to the operator (`ordered`); otherwise `ErrNotHanded`: "only Hammer can hand you the fight or let you buy on your own, and Hammer has not just spoken to you".
- Giving either back is always allowed.
- Setting `fight` when it was not held brings the purse too, unless `buy` is passed as false.

## What "ordered" means

`ordered(side)`: Hammer spoke to the operator, or to all stations, within the last `orderSeconds` = 90 seconds of match time. It is deliberately simple; what Hammer meant is the operator's to read. The rule only stops the operator spending long after Hammer last said anything to it.

## Who may spend (`mayBuy`)

One check for buying, upgrading, building, selling and repairing (`mayActAlone` calls it):

| Case | Result |
|---|---|
| The commander's own hand (`rm.direct`) | Allowed, nothing announced |
| Hammer spoke to the operator in the last 90 s | Allowed, nothing announced: it counts as Hammer's order |
| The operator has the purse | Allowed, and **announced** to Hammer |
| The operator has the fight but not the purse | `ErrNoBuying`: "Hammer handed you the fight but told you not to buy: ask Hammer before spending" |
| Otherwise | `ErrNotOrdered`: "Hammer has not ordered a purchase and has not let you buy on your own. Tell Hammer in one short line what you suggest, and wait" |

The `haul` tool (sending haulers to a field) is not gated by this check.

## Own purchases on the net

What the operator does on its own purse is told to Hammer by the net itself (`tellHammer`), from `radio.ownPurchase`, kind `notice` — shown at Full traffic only:

| Key | English | Hebrew | Sent by |
|---|---|---|---|
| `bought` | Bought {unit}, {squad} is deploying | נקנה {unit}, {squad} בדרך | `toolBuy` |
| `upgraded` | Upgraded {squad} to {tier} | {squad} שודרג לדרגת {tier} | `toolBuy` with `upgrade` |
| `built` | Building {unit} | מתחיל לבנות {unit} | `toolBuild` |
| `repairing` | Repairing the {unit} | מתקן את {unit} | `toolMend` |

Prices are not said on the net (commit `4aed926`). A sale is not announced here: the `structureSold` base cue tells it, asked for or not.

## Hammer's own squads

`traffic.hammers` (in `server/room/traffic.go`) marks squads Hammer ordered by name:

- Set when Hammer names a squad in a call (`noteCall`), or sends it by hand (`directOrder`).
- Cleared for a squad when the operator calls it by name, and for all squads when Hammer says a `give` phrase.
- Effects: the squad is never silenced toward Hammer, its lines to Hammer are level 1, it is never told an event is already `known`, and the operator is told which squads these are (`hammersSquads`, by English callsign) so it gives them no task until handed the fight afresh (commit `cc77d6d`).

## The rule brain's levels

The rule-brain operator has an initiative level of its own, 1 to 3 (lobby choice, or `CALLSIGN_ANVIL_LEVEL`): 1 orders only, 2 also the economy when it holds the purse, 3 also the fight when handed it. That level limits what the rule brain *tries*; the room's mode above is what is *allowed*. See [[Rule Brain]] and [[Operator - Anvil]].

## History

- `9b1919d` (2026-11-24): orders-only until handed the fight; the `command` tool; own purchases announced.
- `b34261d`: the purse as a standing permission — by phrase, switch, lobby option or a standing order.
- `74c4275`: the purse covers building and haulers; one check.
- `5f6c920` / `9a9e5b5`: the commander builds and buys directly, so the purse now matters only for what Anvil does itself (see [[Radio versus Direct Acts]]).

## Related

- [[Radio Net and Bilingual Procedure]]
- [[Radio versus Direct Acts]]
- [[Command Net and Squad Net]]
- [[Traffic Levels]]
- [[Base Cues]]
- [[Operator - Anvil]]
- [[Rule Brain]]
- [[Agent Tools]]
- [[Decision - Direct Build and Buy]]
- [[Economy]]
