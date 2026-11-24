// Command callsign is the game server: a hub of rooms, each one match, served over
// WebSocket, plus the page.
package main

import (
	"context"
	"flag"
	"log"
	"mime"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"callsign/server/room"
	"callsign/shared"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8080", "address to listen on")
	seed := flag.Uint64("seed", 1, "match seed; the same seed and orders replay the same match")
	length := flag.Int("length", 0, "match length in seconds (0 = rules default)")
	enemy := flag.String("bot", "easy", `scripted player for side 1: "easy", "normal", "standard" (relentless), "rush", or "" for none`)
	west := flag.String("west", "aegis", "faction of side 0")
	east := flag.String("east", "ashfall", "faction of side 1")
	client := flag.String("client", "client", "directory of the debug page")
	assets := flag.String("assets", "assets", "directory of generated art and audio, served read-only at /assets/")
	speed := flag.Int("speed", 1, "run the clock this many times faster than real time")
	tts := flag.String("tts", "", "address of the speech service (tts/server.py), passed on at /tts/; empty for none")
	agents := flag.String("agents", "agents", "directory of the agent runtime, whose browser modules are served read-only at /agents/")
	relay := flag.String("relay", "", "address of the model relay, passed on at /relay/; empty for none")
	hostKey := flag.String("host-key", os.Getenv("CALLSIGN_HOST_KEY"), "password needed to make a match, for a server that strangers can reach; empty for none")
	agentKey := flag.String("agent-key", os.Getenv("CALLSIGN_AGENT_KEY"), "secret this server's agent host and model relay show; with it set, commanders need seat tokens and the open room of Phase 0 is gone")
	share := flag.String("share", os.Getenv("CALLSIGN_SHARE"), "address other machines reach this server at, for the link a player sends a friend, e.g. http://192.168.1.20:8080")
	idle := flag.Duration("idle", 10*time.Minute, "drop a match nobody has been in for this long")
	flag.Parse()

	rules, err := shared.Load()
	if err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if *speed < 1 {
		log.Fatal("-speed must be at least 1")
	}
	hub, err := room.NewHub(ctx, rules, room.HubConfig{
		Seed: *seed, Factions: [2]string{*west, *east}, LengthSeconds: *length, Bot: *enemy,
		Interval: time.Second / time.Duration(rules.TickRate**speed),
		AgentKey: *agentKey, Share: *share, IdleAfter: *idle, HostKey: *hostKey,
	})
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	hub.Routes(mux)
	mux.HandleFunc("/shared/rules.json", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Write(shared.RulesJSON)
	})
	mux.Handle("/assets/", http.StripPrefix("/assets/", http.FileServer(http.Dir(*assets))))
	if *tts != "" {
		// The speech service gives the squads their voices in testing. The page reaches it
		// through here so that it talks to one origin; when the service is down the page
		// gets an error and falls back to the browser's own voice.
		target, err := url.Parse(*tts)
		if err != nil || target.Host == "" {
			log.Fatalf("-tts must be a URL such as http://tts:5002, not %q", *tts)
		}
		mux.Handle("/tts/", http.StripPrefix("/tts", httputil.NewSingleHostReverseProxy(target)))
	}
	// The player's browser runs its own agents: the same modules the Node host runs.
	mux.Handle("/agents/", agentModules(*agents))
	if *relay != "" {
		// Agents think through the model relay, and the page reaches it at one origin.
		target, err := url.Parse(*relay)
		if err != nil || target.Host == "" {
			log.Fatalf("-relay must be a URL such as http://relay:8090, not %q", *relay)
		}
		mux.Handle("/relay/", httputil.NewSingleHostReverseProxy(target))
	}
	// The install manifest has no entry in every system's table of file types.
	mime.AddExtensionType(".webmanifest", "application/manifest+json")
	mux.Handle("/", http.FileServer(http.Dir(*client)))

	// Cross-origin isolation lets the page's speech recogniser use WebAssembly threads.
	// Everything the page loads comes from this server, so nothing is shut out by it.
	isolated := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		w.Header().Set("Cross-Origin-Embedder-Policy", "require-corp")
		mux.ServeHTTP(w, r)
	})

	srv := &http.Server{Addr: *addr, Handler: isolated, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		shut, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		srv.Shutdown(shut)
	}()
	log.Printf("callsign: listening on %s, first seed %d, matches are made in the lobby", *addr, *seed)
	if *agentKey == "" {
		log.Print("callsign: no agent key, so anyone who can reach this server may join any side as an agent; keep it on this machine")
	}
	if *share != "" {
		log.Printf("callsign: other machines on the network open %s", *share)
	}
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

// browserModules are the parts of the agent runtime that run in the browser. Nothing else
// in that directory is served: not the Node-only brains, the tests or the package files.
var browserModules = map[string]bool{
	"agent.mjs": true, "link.mjs": true, "tools.mjs": true, "prompts.mjs": true, "host.mjs": true,
	"brain-relay.mjs": true, "brain-scripted.mjs": true, "worker.mjs": true, "telemetry.mjs": true,
}

func agentModules(dir string) http.Handler {
	files := http.StripPrefix("/agents/", http.FileServer(http.Dir(dir)))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if (r.Method != http.MethodGet && r.Method != http.MethodHead) || !browserModules[strings.TrimPrefix(r.URL.Path, "/agents/")] {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		files.ServeHTTP(w, r)
	})
}
