# Playing a match with a friend

Two people on the same network can play one match against each other. There are no
accounts and no matchmaking yet; those come with the online phase of the plan.

## How

1. On the machine that runs the game: `make play-lan`. It prints the address to share,
   for example `http://192.168.1.20:8080`.
2. Open the game there (or at `http://localhost:8080` on that machine), choose **A friend
   on this network**, pick your side and the match length, and press **Make the match**.
   The lobby shows a five-character join code and a link.
3. Your friend opens the link, or opens the address and types the code, and takes the
   other side.
4. Both press **Ready**. The match starts for both at that moment.
5. After the result, either of you can press **Play again**; the rematch starts when both
   are ready again.

`make play` without `-lan` listens on this machine only. A match against the scripted
enemy needs nothing more than one press on **Take command**.

## What happens when

- **You reload the page:** you sit back down in your seat. The seat is remembered by the
  browser, per match.
- **A player leaves mid-match:** their squads keep their last orders and their fireteams
  keep fighting. The other player is told. Their operator and squad leaders stop
  thinking about twenty seconds later and start again when the player returns.
- **You press Leave before the match starts:** the seat is given back and someone else
  can take it. After the start the seat stays yours.
- **Nobody is in a match for ten minutes:** the server drops it (`-idle` changes how long).

## What is protected and what is not

Protected:

- Each side's commander is whoever holds that seat's token. The token is random, is given
  to the browser that took the seat, and is never sent to anyone else. Without it nobody
  can transmit as that side, see that side's map, or restart the match.
- A side is only ever sent its own radio net, its own fog of war and its own deployments.
- Spectators see both sides, so they are let in only when the match's maker ticks
  **Let others watch**. A seat's token does not open the spectator view.
- The agent host and the model relay show the server a secret (`CALLSIGN_AGENT_KEY`,
  made fresh by `make play` on every run). Without it, or a seat's token, nobody can
  connect as an operator or a squad leader, or ask which brain a squad has.
- Only one program runs a side's agents at a time. The commander's own browser (it shows
  the seat's token) outranks the agents on the server machine (they show the secret),
  and what a program claims about itself counts for nothing.
- A player's AI key is filed on the relay under a player token that the relay itself
  makes and signs, kept by that browser; it is stored encrypted and never returned. The
  relay spends a key on a thought only when the same call also carries the token of a
  seat in a match, and the game server confirms that seat commands the squad.

Not protected:

- **No encryption.** The game is served over plain HTTP. Anyone who can read the traffic
  on the network can read both sides' radio and the seat tokens, and with a token can
  take over a seat.
- **The join code is not a password.** Anyone on the network who learns it can take the
  free seat before your friend does, and can see who sits where. It is five characters,
  so it can also be guessed by trying; the server allows at most 32 matches at once but
  does not slow guessing down.
- **Running without the key.** Starting the server by hand, without `-agent-key` or
  `CALLSIGN_AGENT_KEY`, puts it in the trusting mode used by the tests: any connection may
  join any side as an agent. Do that only when the server listens on this machine alone.
- **Voice.** Browsers allow the microphone only on `https` or on `localhost`. A friend on
  another machine can type orders but cannot speak them.
- **Whose AI.** A side whose player has stored their own AI key (the **AI** button) thinks
  in that player's browser, through the model relay, on that key. A side without one
  thinks with the AI configured on the machine that runs the game. Over plain HTTP a key
  typed into that dialog can be read on the network on its way to the relay, like
  everything else.

## For other programs

- `POST /api/rooms` `{"opponent":"bot"|"friend","side":0|1|-1,"length":<seconds>,"watch":false}`
  makes a match and seats its maker: `{"room","side","token","share","lobby"}`.
- `GET /api/rooms/<code>` returns `{"lobby","share"}`; `POST /api/rooms/<code>/seat`
  `{"side":0|1}` (or `{}` for the free one) takes a seat: `{"room","side","token","lobby"}`.
- `POST /api/rooms` also takes `"bot":"easy"|"normal"|"standard"` for a match against the
  scripted enemy; `GET /api/server` lists them as `levels`, with the usual one as `level`.
- `/ws?room=<code>&side=<0|1>&role=hammer&token=<seat token>` is the commander's connection.
  An agent host joins with `role=host&host=<id>` and `key=<agent key>` or its side's
  `token`; its agents use `role=anvil|squad&host=<id>` with the same proof.
- For the server's own services, with `Authorization: Bearer <agent key>`:
  `GET /internal/rooms` (which sides need agents) and
  `GET /internal/tier?room=&side=&squad=` with the player's seat token in
  `X-Callsign-Seat` → `{"tier":1|2|3,"operator":false}` (squad 0 is the operator).
- The model relay, reached at `/relay/v1/`: `POST player` → `{"token"}`; `GET|PUT|DELETE key`
  with `Authorization: Bearer <player token>`; `POST think` with that and
  `X-Callsign-Seat: <seat token>`.
- Frames added: `{"type":"lobby","lobby":{...}}` from the server on every change, and
  `{"type":"ready","ready":true}` and `{"type":"leave"}` from a commander.
