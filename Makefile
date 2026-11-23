# Everything runs in the callsign-dev image. Nothing is installed on the host or at run time.
IMAGE  := callsign-dev
DOCKER := docker run --rm --init -u $(shell id -u):$(shell id -g) -e HOME=/tmp \
          -v $(CURDIR):/src -v callsign-gocache:/gocache -w /src

.PHONY: image test play stop shell

# Build the dev image. Needed once, and again only when go.mod, go.sum or
# agents/package-lock.json changes.
image:
	docker build -t $(IMAGE) -f Dockerfile.dev .

# Vet and run every test with the network off.
test:
	$(DOCKER) --network none $(IMAGE) sh -c 'go vet ./... && go test ./... && \
		go build -o /tmp/callsign ./server/cmd/callsign && CALLSIGN_BIN=/tmp/callsign node --test'

# Start the game server and the agents, then open http://localhost:8080
play:
	docker compose up

stop:
	docker compose down

shell:
	$(DOCKER) -it $(IMAGE) bash
