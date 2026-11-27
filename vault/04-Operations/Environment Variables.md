---
title: Environment Variables
description: "Every CALLSIGN variable the project reads, with its meaning and who reads it."
type: reference
status: current
tags:
  - type/reference
  - status/current
  - agent/CLD
  - origin/code
  - area/operations
  - topic/ops
  - topic/env
  - topic/configuration
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: code
confidence: medium
related:
  - "[[Private Machine Guard]]"
  - "[[Subscription Brain]]"
  - "[[Key Handling]]"
  - "[[Fast Brain - Jev]]"
  - "[[Where Agents Run]]"
  - "[[Balance]]"
  - "[[Docker Compose Services]]"
  - "[[Running, Deploying and Testing]]"
  - "[[Server Flags]]"
  - "[[Seats, Tokens and Trust]]"
paths:
  - .env.example
  - docker-compose.yml
  - Makefile
  - agents/main.mjs
  - agents/fake-relay.mjs
  - relay/cmd/relay/main.go
  - server/cmd/callsign/main.go
  - tools/public-dns.sh
  - server/sim/terrain_test.go
  - server/sim/cost_test.go
---

# Environment Variables

Every `CALLSIGN_*` variable the project reads, with its meaning and who reads it. Names and meanings only: values belong in `.env`, which is git-ignored and must never be copied into the vault or the repository; `.env.example` is the list to start from.

## In `.env.example` (the owner's settings)

| Variable | Meaning | Read by |
|---|---|---|
| `CALLSIGN_PRIVATE` | `1` only on the owner's own machine. The keys marked "yours" below are used only then; a public server leaves it unset and holds only its players' own keys. See [[Private Machine Guard]]. | agent host, relay |
| `CALLSIGN_ANTHROPIC_KEY` | An Anthropic API key: squads on the server machine think with the Claude API. | agent host |
| `CALLSIGN_CLAUDE_TOKEN` | For testing: a Claude subscription token; squads then think through Claude Code, slower and against the subscription's limits. See [[Subscription Brain]]. | agent host |
| `CALLSIGN_RELAY_MASTER_KEY` | 32 random bytes (hex or base64) that seal the stored AI keys. Empty: the relay makes `.relay-data/master.key` itself. See [[Key Handling]]. | relay |
| `CALLSIGN_AGENT_KEY` | The secret the game server's own services show it (agent host, relay). `make play` makes a fresh one each run; set it here only when starting the parts by hand. With it set, commanders need seat tokens and the open room is gone. | server, agent host, relay |
| `CALLSIGN_JEV_KEY` | The game's own key for the squads' fast brain. Only the relay reads it; never sent to a browser. Empty: the fast brain is off. See [[Fast Brain - Jev]]. | relay |
| `CALLSIGN_JEV_DAILY_USD` | The most the fast brain may spend on that key in one day (UTC), in dollars; default 2. Past it squads use the rule brain until the next day. | relay (`-jev-daily-usd`) |
| `CALLSIGN_FAST_BRAIN` | `true`: matches use the fast brain unless their maker turns it off in the lobby. Default false. | server (`-fast-brain`) |
| `CALLSIGN_ANVIL_LEVEL` | The rule-brain Anvil's initiative when a match sets none, 1 to 3; default 3. | server (`-anvil-level`) |
| `CALLSIGN_PUBLIC_URL` | `make play-public`: the https address of the game on the owner's domain. | Makefile, `tools/public-dns.sh` |
| `CALLSIGN_TUNNEL_TOKEN` | The Cloudflare Tunnel's token; when set, `make play-public` uses the tunnel. | Makefile, `tunnel` service |
| `CALLSIGN_HOST_KEY` | Password for making matches on the public address. Empty: one is made on each run. | Makefile, server (`-host-key`) |

## Set by the Makefile or compose (not in `.env.example`)

| Variable | Meaning |
|---|---|
| `CALLSIGN_UID`, `CALLSIGN_GID` | The user the containers run as. |
| `CALLSIGN_BIND` | The host address port 8080 is bound to; default `127.0.0.1`, `0.0.0.0` for `make play-lan`. |
| `CALLSIGN_SHARE` | The address other machines reach the server at, for the join link (server `-share`). |
| `CALLSIGN_STT` | The listening service's address, set only when it can run (server `-stt`). |
| `CALLSIGN_DOMAIN` | The public name Caddy serves and fetches a certificate for. |
| `CALLSIGN_SEED` | The first match seed; default 1 (server `-seed`). |
| `CALLSIGN_BOT` | The scripted enemy's usual level: easy (default), normal, standard or rush; set but empty for none (server `-bot`). |
| `CALLSIGN_SERVER` | The game server's WebSocket address for the agent host. |

## Read by the agent host only (`agents/main.mjs`)

| Variable | Meaning |
|---|---|
| `CALLSIGN_BRAIN` | `rule`, `claude` or `subscription`. Default: `rule` unless a key or token is set. Asked for by name it fails loudly and is never swapped. |
| `CALLSIGN_CLAUDE_BIN` | The Claude Code executable for the subscription brain. |
| `CALLSIGN_SIDE`, `CALLSIGN_ROOM` | Serve only one side of one room, instead of every match made in the lobby. |
| `CALLSIGN_OPERATOR` | `0` to play without Anvil. |
| `CALLSIGN_OPERATOR_MODEL` | A model id for Anvil in place of the default. |

See [[Where Agents Run]] for how the host picks a brain.

## For tools and tests

| Variable | Meaning |
|---|---|
| `CALLSIGN_CF_TOKEN` | A DNS-editing token for `make public-dns`. Given on the command line, not kept in `.env.example`. |
| `CALLSIGN_BIN` | Path of a built server binary for the Node end-to-end tests (`make test` sets it). |
| `CALLSIGN_BALANCE`, `CALLSIGN_BALANCE_MAP` | Seeds per pairing, and one map only, for the balance test (`make balance`). |
| `CALLSIGN_COST` | Turns the cost measurements on (`make cost`). |
| `CALLSIGN_VOICE_MODELS` | Lets the in-browser recogniser tests load the real models (`make voice-test`). |
| `CALLSIGN_RELAY_PORT`, `CALLSIGN_RELAY_HOST` | Where the fake relay of the agent tests listens (`agents/fake-relay.mjs`). |
| `TUNE`, `TUNE_FULL`, `HEROES_TUNE` | Hand-run balance probes ([[Balance]]). |

## Rules

- Never read, print or commit `.env`. `.gitignore` also excludes `.relay-data/` (the key store and master key) and `.caddy-data/` (the certificate and its account key).
- The compose file removes `CALLSIGN_JEV_KEY` from the agent host's environment on purpose ([[Docker Compose Services]]).

## Related

- [[Running, Deploying and Testing]]
- [[Server Flags]]
- [[Docker Compose Services]]
- [[Private Machine Guard]]
- [[Key Handling]]
- [[Seats, Tokens and Trust]]
