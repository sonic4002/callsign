# Everything runs in the callsign-dev image. Nothing is installed on the host or at run time.
IMAGE  := callsign-dev
DOCKER := docker run --rm --init -u $(shell id -u):$(shell id -g) -e HOME=/tmp \
          -v $(CURDIR):/src -v callsign-gocache:/gocache -w /src

.PHONY: image test play play-lan play-public public-dns stop shell voice-models voice-test art-image art-models art art-units-image art-units art-sheet tts-image tts-models tts-test

# Build the dev image. Needed once, and again only when go.mod, go.sum or
# agents/package-lock.json changes.
image:
	docker build -t $(IMAGE) -f Dockerfile.dev .

# Vet and run every test with the network off.
test:
	$(DOCKER) --network none $(IMAGE) sh -c 'go vet ./... && go test ./... && \
		go build -o /tmp/callsign ./server/cmd/callsign && CALLSIGN_BIN=/tmp/callsign node --test'

# A fresh secret for each run, shared by the game server and its agent host.
AGENT_KEY = $(shell head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')
# This machine's address on the local network, for play-lan.
LAN_IP ?= $(shell ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p')

# Start the game server and the agents, then open http://localhost:8080
# The image and the build-cache volume are made here if they are missing; nothing else is fetched.
play:
	@docker image inspect $(IMAGE) >/dev/null 2>&1 || $(MAKE) image
	@docker volume create callsign-gocache >/dev/null
	@mkdir -p assets/voice-cache .relay-data
	CALLSIGN_AGENT_KEY=$(AGENT_KEY) CALLSIGN_UID=$(shell id -u) CALLSIGN_GID=$(shell id -g) docker compose $(VOICES) $(MORE_PROFILES) up $(UP_FLAGS)

# The same, opened to the local network so a friend can join from another machine.
# Read docs/FRIEND-MATCH.md first: there is no encryption and no accounts.
play-lan:
	@test -n "$(LAN_IP)" || { echo "could not find this machine's network address; set LAN_IP=..."; exit 1; }
	@echo "Your friend opens  http://$(LAN_IP):8080  and types the join code from your lobby."
	@echo "Anyone on this network who has that code can join the free seat. Nothing is encrypted."
	CALLSIGN_BIND=0.0.0.0 CALLSIGN_SHARE=http://$(LAN_IP):8080 $(MAKE) play

# The same over https for a friend anywhere, on your own domain.
# Needs CALLSIGN_PUBLIC_URL=https://<name> in .env; docs/FRIEND-MATCH.md has both ways:
#   - with CALLSIGN_TUNNEL_TOKEN in .env, a Cloudflare Tunnel carries it (nothing opened);
#   - without, the name points at this home (make public-dns), the router forwards port
#     443 to this machine, and a Let's Encrypt certificate is fetched and renewed here.
# Only the host can make matches: the password is CALLSIGN_HOST_KEY in .env, or made here.
PUBLIC_URL   = $(shell sed -n 's/^CALLSIGN_PUBLIC_URL=//p' .env 2>/dev/null)
TUNNEL_TOKEN = $(shell sed -n 's/^CALLSIGN_TUNNEL_TOKEN=//p' .env 2>/dev/null)
HOST_KEY     = $(or $(shell sed -n 's/^CALLSIGN_HOST_KEY=//p' .env 2>/dev/null),$(shell head -c 9 /dev/urandom | base64 | tr '+/' 'ab'))
PUBLIC_NAME  = $(firstword $(subst /, ,$(patsubst https://%,%,$(PUBLIC_URL))))
play-public:
	@test -n "$(PUBLIC_URL)" || { echo "set CALLSIGN_PUBLIC_URL=https://<name> in .env"; exit 1; }
	$(eval KEY := $(HOST_KEY))
	@echo "Your game is at  $(PUBLIC_URL)"
	@echo "Host password (asked once, when you make a match):  $(KEY)"
	@echo "Your friend needs only the join link or code. Anyone else can reach the lobby but cannot start a match."
ifneq ($(TUNNEL_TOKEN),)
	@CALLSIGN_SHARE=$(PUBLIC_URL) CALLSIGN_HOST_KEY=$(KEY) $(MAKE) play MORE_PROFILES="--profile public"
else
	@getent hosts $(PUBLIC_NAME) >/dev/null || echo "WARNING: $(PUBLIC_NAME) does not resolve yet: create its DNS record first (make public-dns), or no certificate can be issued."
	@mkdir -p .caddy-data
	@CALLSIGN_DOMAIN=$(PUBLIC_NAME) CALLSIGN_SHARE=$(PUBLIC_URL) CALLSIGN_HOST_KEY=$(KEY) $(MAKE) play MORE_PROFILES="--profile https"
endif

# Point the public name at this home's address (a plain DNS record). Run it again
# when the home address changes. Needs CALLSIGN_CF_TOKEN (a token that may edit DNS).
public-dns:
	@CALLSIGN_PUBLIC_URL=$(PUBLIC_URL) sh tools/public-dns.sh

stop:
	docker compose --profile voice --profile public --profile https down

shell:
	$(DOCKER) -it $(IMAGE) bash

# Download the in-browser speech recognisers (Hebrew and English) and their runtime, about
# 245 MB, into assets/models/ and client/vendor/ort/. Pinned versions, checked by SHA-256.
voice-models:
	$(DOCKER) $(IMAGE) node client/voice/fetch-models.mjs

# Transcribe the test recording with the real models (needs voice-models first).
voice-test:
	$(DOCKER) --network none -e CALLSIGN_VOICE_MODELS=1 $(IMAGE) node --test client/voice/voice.test.mjs

# ---- art: sprites generated on this machine's GPU (see art/ and assets/sprites/CREDITS.md) ----
ART := docker run --rm --init -u $(shell id -u):$(shell id -g) -v $(CURDIR):/src

# Build the art image: ComfyUI, PyTorch and the clean-up tools. About 13 GB.
art-image:
	docker build -t callsign-art -f art/Dockerfile art

# Download the model weights once into the callsign-art-models volume. About 13 GB.
art-models:
	@docker volume create callsign-art-models >/dev/null
	@docker run --rm -v callsign-art-models:/models callsign-art chmod 777 /models
	$(ART) -v callsign-art-models:/models callsign-art sh art/models.sh

# Generate any missing candidates, then rebuild assets/sprites from the kept ones.
# Runs with the network off. Pick candidates by setting "keep" in art/sprites.json.
art:
	$(ART) --network none --device nvidia.com/gpu=all -v callsign-art-models:/models:ro callsign-art \
		sh -c 'python art/generate.py && python art/cleanup.py'

# ---- unit sheets: animated units rendered from models built in code (art/units.py) ----

# Build the Blender image. About 2.7 GB.
art-units-image:
	docker build -t callsign-blender -f art/Dockerfile.blender art

# Render every unit's sprite sheets (the two heroes among them) into assets/sprites/units,
# the pieces that are laid end to end (walls, fences, the bridge) and the gold lying in a
# field into assets/sprites/segments and props, and the sandbag position into landmarks. Runs on the CPU with the network off, in a few minutes.
art-units:
	$(ART) -e HOME=/tmp --network none -w /src callsign-blender sh -c 'python art/units.py && python art/props.py'

# One picture of every finished sprite standing on the game's ground at game size, to
# look at before it goes in: art-sheet.png in this directory.
art-sheet:
	$(ART) --network none -w /src callsign-art sh -c 'python art/sheet.py scene art-sheet.png && \
		python art/sheet.py stages art-stages.png && python art/sheet.py leaving art-leaving.png && \
		python art/sheet.py powered art-powered.png'

# ---- radio voices: the squads' replies spoken aloud (tts/, client/speech/) ----
TTS := docker run --rm --init -u $(shell id -u):$(shell id -g) -e HOME=/tmp -e PYTHONDONTWRITEBYTECODE=1 -v $(CURDIR):/src

# `make play` starts the speech service only when its image and models are both here.
# Without it the page falls back to the browser's own voice.
VOICES = $(shell docker image inspect callsign-tts >/dev/null 2>&1 && test -f assets/models/bluev3/onnx/vocoder.onnx && echo --profile voice)

# Build the speech image: one layer (about 0.6 GB) on top of callsign-art (make art-image first).
tts-image:
	docker build -t callsign-tts -f tts/Dockerfile tts

# Download the speech models once into assets/models/bluev3. About 680 MB.
tts-models:
	$(TTS) callsign-tts python tts/fetch.py

# The pronunciation table's tests. No models and no network needed.
tts-test:
	$(TTS) --network none -w /src/tts callsign-tts python -m unittest test_pronounce

# ---- model relay: the players' AI keys and their agents' AI calls (relay/) ----
.PHONY: relay relay-test

# Run the relay alone on this machine, beside a game server on port 8080. `make play`
# already starts one; this is for working on the relay itself. Keys go to .relay-data/.
relay:
	@mkdir -p .relay-data
	$(DOCKER) --network host $(IMAGE) go run ./relay/cmd/relay -addr=127.0.0.1:8090 -data=.relay-data

# The relay's tests alone, with the race detector. Every provider is played by a fake:
# no key is needed and nothing leaves this machine.
relay-test:
	$(DOCKER) --network none $(IMAGE) go test -race -count=1 ./relay/... ./shared/...
