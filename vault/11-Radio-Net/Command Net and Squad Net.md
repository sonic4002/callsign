---
title: Command Net and Squad Net
description: "Each side's radio is split into two nets: the command net carries what is said to or by Hammer, the squad net carries what the squads and the operator say among themselves."
type: system
status: current
tags:
  - type/system
  - status/current
  - agent/CLD
  - origin/code
  - area/radio-net
  - topic/radio
  - topic/nets
  - topic/traffic
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Traffic Levels]]"
  - "[[Initiative - Orders, Fight and Purse]]"
  - "[[Report Suppression]]"
  - "[[Radio Console]]"
  - "[[Radio Net]]"
  - "[[Base Cues]]"
  - "[[Radio Routing]]"
  - "[[Agent Loop]]"
  - "[[Text to Speech Service]]"
paths:
  - server/room/traffic.go
  - server/room/traffic_test.go
  - server/room/room.go
  - client/nets.js
  - client/debug.js
  - client/i18n/en.json
  - client/i18n/he.json
---

# Command Net and Squad Net

Each side's radio is split into two nets: the command net carries what is said to or by Hammer, the squad net carries what the squads and the operator say among themselves. The split is a label the server puts on every message (`net`), added on 2026-11-25 (commits `d205abc`, `df0ee2e`) so the commander hears what needs them and can still read the rest.

## The rule

`classify` in `server/room/traffic.go`:

| Net | Constant | A line is on it when |
|---|---|---|
| Command | `NetCommand` = `"command"` | It is from Hammer, or one of its addressees is Hammer or All stations |
| Squad | `NetSquad` = `"squad"` | It is from the operator or a squad and addressed only to the operator and/or squads |

Squad-net lines always get level 3. Command-net lines get the level of their kind (see [[Traffic Levels]]).

It is still one log per side on the server and one broadcast: every client of the side receives every line. The nets are a way of showing, not of delivering.

## The kinds of line

Every transmission gets one `kind`. Constants in `server/room/traffic.go`:

| Kind | Meaning | How it is decided |
|---|---|---|
| `order` | Hammer's own transmission | Sender is Hammer |
| `answer` | A station's reply to Hammer's call | Addressed to Hammer within `answerSeconds` (30 s) of Hammer calling that station or all stations |
| `ask` | The operator asking Hammer something | From the operator to Hammer, ending with Over, and nothing above applies |
| `cue` | A fixed line the game wrote: base cues and the sign-off | Set by `cues.go` / `signOff` |
| `loss` | A squad that can hardly fight on | The squad's last waking event was losses leaving one fireteam or fewer, or the agent tagged it |
| `contact` | The enemy met | Last waking event was a contact, or tagged |
| `objective` | A place reached | Last waking event was arrived / garrisoned / a strike's bombs fallen, or tagged |
| `notice` | What the operator bought or built on its own | Sent by `tellHammer` (see [[Initiative - Orders, Fight and Purse]]) |
| `status` | Routine | The default |
| `ack` | Roger or Wilco and nothing else | `Net.BareAck` on the body (a tag of `ack` on any other body is ignored) |

Order of the decision for a line that is not Hammer's:

1. A bare acknowledgement from the operator not addressed to Hammer is dropped.
2. A squad's report of something another squad reported first is dropped (see [[Report Suppression]]).
3. Bare ack, answering Hammer → `answer`. Bare ack otherwise → `ack`.
4. A tag the agent gave (`contact`, `objective`, `loss`, `status`) or the server's own `notice` → that kind.
5. The event that woke the squad is still fresh (within `eventSeconds`, 20 s) → that event's kind.
6. Answering Hammer → `answer`.
7. Operator to Hammer ending Over → `ask`.
8. Otherwise `status`; but a `status` line to Hammer right after Hammer's call, with no fresh event, becomes `answer`.

Agents may pass only contact, objective, loss, status and ack as `kind` (`tagged`); any other value is ignored and "the net tells". Of these, `ack` has no effect of its own: only the body decides whether a line is a bare acknowledgement.

## Which events make which kind

`noticeOf` maps the simulation event that woke a squad's leader to the kind of its next report:

| Event | Kind | Shared key |
|---|---|---|
| contact | `contact` | `contact:<enemy id>` |
| arrived, garrisoned | `objective` | `at:<structure, place or point>` |
| losses, one team or fewer left | `loss` | none |
| losses otherwise | `status` | none |
| pinned, fortified, charge planted, crushed, overhead, rearmed | `status` | none |
| strike (bombs fallen) | `objective` | none |

## Hammer's own squads

A squad Hammer ordered by name (on the radio, or by hand) is marked in `traffic.hammers`. Whatever it tells Hammer is level 1 on the command net, it is never silenced toward Hammer, and the operator is told which squads these are. See [[Initiative - Orders, Fight and Purse]].

## On the page

`client/nets.js` and `renderLog` in `client/debug.js`:

| | Command net | Squad net |
|---|---|---|
| Shows | Radio lines whose `level` is within the player's traffic setting, plus the page's own event and system lines | Every radio line with `net == "squad"` |
| Spoken aloud | Yes: exactly the lines shown (`heard`), and base cues only if cue voice is on | Never |
| Drawn | Always | Only while its tab is open |
| Label | – | "Squad net" / "רשת הכיתות" |

Empty squad net text: "What your squads and Anvil say to each other is written here. It is never spoken aloud." / "מה שהכיתות וסדן אומרים זה לזה נכתב כאן. זה אף פעם לא מושמע בקול."

Because squad-net lines carry level 3, the Full traffic setting also lets them through `onCommandNet`, so at Full the command net shows (and speaks) them too. A message with no level, from an older server, is shown.

The page also folds repeated event lines into one ("3 squads are ready") and leaves an event to its base cue when one tells the same news (`client/cues.js`: `foldLog`, `cued`). See [[Radio Console]].

## Related

- [[Radio Net]]
- [[Traffic Levels]]
- [[Report Suppression]]
- [[Base Cues]]
- [[Radio Routing]]
- [[Initiative - Orders, Fight and Purse]]
- [[Radio Console]]
- [[Agent Loop]]
- [[Text to Speech Service]]
