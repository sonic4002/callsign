---
title: Playing in Public
description: "make play-public puts the game on an https address of the owner's own domain, so a friend anywhere can join and the microphone works on phones."
type: how-to
status: current
tags:
  - type/how-to
  - status/current
  - agent/CLD
  - origin/mixed
  - area/operations
  - topic/ops
  - topic/public
  - topic/https
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[First Lesson]]"
  - "[[Private Machine Guard]]"
  - "[[Server Whisper]]"
  - "[[In-Browser Recognition]]"
  - "[[Licences and Credits]]"
  - "[[Staging and Releasing]]"
  - "[[Open Questions]]"
  - "[[Running, Deploying and Testing]]"
  - "[[Playing on a LAN]]"
  - "[[Docker Compose Services]]"
paths:
  - docs/FRIEND-MATCH.md
  - Makefile
  - docker-compose.yml
  - tools/Caddyfile
  - tools/public-dns.sh
  - server/room/hub.go
  - relay/cmd/relay/main.go
---

# Playing in Public

`make play-public` puts the game on an https address of the owner's own domain, so a friend anywhere can join and the microphone works on phones. There are two ways for players to reach it: a Cloudflare Tunnel, or the home's own address with a Let's Encrypt certificate. The live address itself is deliberately not written in this vault; it is whatever `CALLSIGN_PUBLIC_URL` in `.env` says.

## Before either way

Put the address in `.env` as `CALLSIGN_PUBLIC_URL=https://<name>`. `make play-public` refuses to start without it.

## Way 1: a Cloudflare Tunnel

- The tunnel dials out from this machine, so nothing is opened on the router and the home address is never used. Cloudflare holds the certificate and can read the traffic.
- In the Cloudflare dashboard create a tunnel of type Cloudflared, add a public hostname for the name with the service `http://server:8080`, and put the tunnel's token in `.env` as `CALLSIGN_TUNNEL_TOKEN`.
- `make play-public` uses the tunnel whenever that token is set (compose profile `public`, service `tunnel`).

## Way 2: this home's address, with a Let's Encrypt certificate

1. The name needs a plain DNS record (type A, not proxied) pointing at the home's public address. `CALLSIGN_CF_TOKEN=<token> make public-dns` creates or updates it (`tools/public-dns.sh`; the token needs Zone, DNS, Edit); or add it by hand. Run it again when the home address changes.
2. The router forwards port 443 to this machine.
3. `make play-public` starts the game with an https front (Caddy, compose profile `https`) on port 443. It fetches the certificate on first start and renews it on its own; the certificate is kept in `.caddy-data/`.

The home's address is visible to anyone who looks the name up; traffic is encrypted all the way to this machine. `make play-public` warns when the name does not resolve yet.

This way replaced an earlier one behind Cloudflare's proxy on port 80 with the router port opened over UPnP (commits `ca32b3d`, then `562cc4a`, 2026-11-24).

## What changes on a public address

| Rule | Detail |
|---|---|
| Only the host makes matches | Every match runs agents on this machine, so making one needs the host password (`CALLSIGN_HOST_KEY`, or one made on each run and printed). The browser remembers it. Joining by code or link does not need it. |
| The first lesson is the exception | A lesson needs no password: it runs no agents on the server machine ([[First Lesson]]). |
| Wrong join codes are slowed | 40 a minute for the whole server. |
| The join code is still not a password | Whoever has the link can take the free seat. |
| The owner's own keys | A public server leaves `CALLSIGN_PRIVATE` unset, so the owner's Anthropic key, subscription token and fast-brain key are not used even if present ([[Private Machine Guard]]). |

## What a public server costs to run

From `stt/NOTICE.md` and `stt/eval/RESULTS.md`: server-side Whisper is unusable without a GPU, so players on a CPU-only public server recognise speech in the browser ([[Server Whisper]], [[In-Browser Recognition]]). The radio voice service is a test rig and not meant for a public build as it stands ([[Licences and Credits]]).

## Not verified

- Where and how the live game is hosted, and how it is deployed or restarted, is not described in any file in the repository beyond the above. See [[Staging and Releasing]] and [[Open Questions]].

## Related

- [[Running, Deploying and Testing]]
- [[Playing on a LAN]]
- [[Docker Compose Services]]
- [[Environment Variables]]
- [[Seats, Tokens and Trust]]
- [[Private Machine Guard]]
- [[Speech on Phones]]
