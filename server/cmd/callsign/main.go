// Command callsign is the game server: one room, one match, served over WebSocket,
// plus the debug page.
package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"callsign/server/room"
	"callsign/shared"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8080", "address to listen on")
	seed := flag.Uint64("seed", 1, "match seed; the same seed and orders replay the same match")
	length := flag.Int("length", 0, "match length in seconds (0 = rules default)")
	enemy := flag.String("bot", "standard", `scripted player for side 1: "standard", "rush", or "" for none`)
	west := flag.String("west", "aegis", "faction of side 0")
	east := flag.String("east", "ashfall", "faction of side 1")
	client := flag.String("client", "client", "directory of the debug page")
	assets := flag.String("assets", "assets", "directory of generated art and audio, served read-only at /assets/")
	speed := flag.Int("speed", 1, "run the clock this many times faster than real time")
	flag.Parse()

	rules, err := shared.Load()
	if err != nil {
		log.Fatal(err)
	}
	rm, err := room.New(rules, room.Config{
		Seed: *seed, Factions: [2]string{*west, *east}, LengthSeconds: *length,
		Bots: [2]string{"", *enemy},
	})
	if err != nil {
		log.Fatal(err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if *speed < 1 {
		log.Fatal("-speed must be at least 1")
	}
	go rm.Run(ctx, time.Second/time.Duration(rules.TickRate**speed))

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", rm.ServeWS)
	mux.HandleFunc("/shared/rules.json", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Write(shared.RulesJSON)
	})
	mux.Handle("/assets/", http.StripPrefix("/assets/", http.FileServer(http.Dir(*assets))))
	mux.Handle("/", http.FileServer(http.Dir(*client)))

	srv := &http.Server{Addr: *addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		shut, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		srv.Shutdown(shut)
	}()
	log.Printf("callsign: listening on %s, seed %d, the match starts when Hammer joins", *addr, *seed)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
