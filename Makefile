# Everything runs in the callsign-dev image. Nothing is installed on the host or at run time.
IMAGE  := callsign-dev
DOCKER := docker run --rm --init -u $(shell id -u):$(shell id -g) -e HOME=/tmp \
          -v $(CURDIR):/src -v callsign-gocache:/gocache -w /src

.PHONY: image test play stop shell voice-models voice-test art-image art-models art art-units-image art-units

# Build the dev image. Needed once, and again only when go.mod, go.sum or
# agents/package-lock.json changes.
image:
	docker build -t $(IMAGE) -f Dockerfile.dev .

# Vet and run every test with the network off.
test:
	$(DOCKER) --network none $(IMAGE) sh -c 'go vet ./... && go test ./... && \
		go build -o /tmp/callsign ./server/cmd/callsign && CALLSIGN_BIN=/tmp/callsign node --test'

# Start the game server and the agents, then open http://localhost:8080
# The image and the build-cache volume are made here if they are missing; nothing else is fetched.
play:
	@docker image inspect $(IMAGE) >/dev/null 2>&1 || $(MAKE) image
	@docker volume create callsign-gocache >/dev/null
	CALLSIGN_UID=$(shell id -u) CALLSIGN_GID=$(shell id -g) docker compose up

stop:
	docker compose down

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

# Render every unit's sprite sheets into assets/sprites/units. Runs on the CPU with the
# network off, in well under a minute.
art-units:
	$(ART) -e HOME=/tmp --network none -w /src callsign-blender python art/units.py
