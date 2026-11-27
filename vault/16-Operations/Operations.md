---
title: Operations
description: "This hub covers building, testing and running the game: everything runs in Docker images through make, and nothing is installed on the host or at run time."
type: hub
status: current
tags:
  - type/hub
  - status/current
  - agent/CLD
  - origin/mixed
  - area/operations
  - topic/ops
created: 2026-11-26
updated: 2026-11-26
agent: CLD
origin: mixed
confidence: medium
related:
  - "[[Make Targets]]"
  - "[[Docker Compose Services]]"
  - "[[Environment Variables]]"
  - "[[Server Flags]]"
  - "[[Running Locally]]"
  - "[[Playing on a LAN]]"
  - "[[Playing in Public]]"
  - "[[Staging and Releasing]]"
  - "[[Reference Map]]"
  - "[[Server Architecture]]"
paths:
  - Makefile
  - docker-compose.yml
  - Dockerfile.dev
  - .env.example
  - docs/FRIEND-MATCH.md
  - server/cmd/callsign/main.go
---

# Operations

This hub covers building, testing and running the game: everything runs in Docker images through `make`, and nothing is installed on the host or at run time. It lists the make targets, the compose services, the environment variables and flags, and the three ways to run (this machine, the local network, a public https address).

## Notes

- [[Make Targets]]: every `make` target and what it does.
- [[Docker Compose Services]]: the services `make play` starts and how they are wired.
- [[Environment Variables]]: every `CALLSIGN_*` name and its meaning (never values).
- [[Server Flags]]: the game server's and the relay's command-line flags.
- [[Running Locally]]: first run, tests, optional voices and listening.
- [[Playing on a LAN]]: `make play-lan`, what is and is not protected.
- [[Playing in Public]]: `make play-public` over a tunnel or a home address with a certificate.
- [[Staging and Releasing]]: the `next` branch and what a release touches.

## The short version

```sh
make image      # once, and again when go.mod, go.sum or agents/package-lock.json change
make test       # go vet, go test ./..., then the Node tests, with the network off
make play       # game server + agent host + relay; open http://localhost:8080
make stop
```

## Principles the build files state

- Everything runs in the `callsign-dev` image (Go 1.27.4 and Node 24, with every Go module and npm package already downloaded). Tests run with `--network none`.
- The repository is mounted read-only into the running services (`.:/src:ro`).
- Secrets live in `.env`, which is git-ignored; `.env.example` lists the names. `make play` makes a fresh agent key for every run.
- Optional parts start only when their image and models are present: radio voices (`voice` profile), server-side listening (`listen` profile, needs a GPU).
- The game server binds to this machine only unless `make play-lan` or `make play-public` opens it.

## Related

- [[Reference Map]]
- [[Server Architecture]]
- [[Model Relay]]
- [[Speech]]
- [[Art Pipeline]]
- [[Tests and Headless Matches]]
- [[Seats, Tokens and Trust]]
