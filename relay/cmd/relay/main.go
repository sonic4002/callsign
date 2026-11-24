// Command relay is the model relay: it holds each player's AI key, encrypted, and makes
// their agents' AI calls with the model their squad's brain tier allows.
//
//	relay -addr=127.0.0.1:8090 -game=http://127.0.0.1:8080/internal/tier -data=./.relay-data
//
// Environment:
//
//	CALLSIGN_RELAY_MASTER_KEY  32 bytes in hex or base64 that seal the stored keys. Without
//	                           it the relay makes <data>/master.key on first start.
//	CALLSIGN_INTERNAL_SECRET   shared with the game server, sent with every tier question.
package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"callsign/relay"
	"callsign/relay/provider"
	"callsign/shared"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8090", "address to listen on")
	game := flag.String("game", "http://127.0.0.1:8080/internal/tier", "the game server's tier endpoint")
	data := flag.String("data", ".relay-data", "directory of the encrypted key store")
	origins := flag.String("origins", "", "comma-separated origins allowed to call the relay directly; pages served by the game server need none")
	maxKeys := flag.Int("max-keys", 10000, "most keys the store will hold")
	flag.Parse()

	rules, err := shared.Load()
	if err != nil {
		log.Fatal(err)
	}
	models, err := shared.LoadModels(rules)
	if err != nil {
		log.Fatal(err)
	}
	if u, err := url.Parse(*game); err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		log.Fatalf("-game must be a URL such as http://server:8080/internal/tier, not %q", *game)
	}
	master, err := relay.MasterKey(os.Getenv("CALLSIGN_RELAY_MASTER_KEY"), *data)
	if err != nil {
		log.Fatalf("master key: %v", err)
	}
	keys, err := relay.OpenKeyStore(*data, master, *maxKeys)
	if err != nil {
		log.Fatalf("key store: %v", err)
	}
	var allowed []string
	for _, o := range strings.Split(*origins, ",") {
		if o = strings.TrimSpace(o); o != "" {
			allowed = append(allowed, strings.TrimRight(o, "/"))
		}
	}
	r, err := relay.New(relay.Config{
		Game:      &relay.HTTPGame{URL: *game, Secret: os.Getenv("CALLSIGN_INTERNAL_SECRET")},
		Keys:      keys,
		Models:    models,
		Rules:     rules,
		Providers: provider.All(nil),
		Origins:   allowed,
	})
	if err != nil {
		log.Fatal(err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	srv := &http.Server{
		Addr:              *addr,
		Handler:           r.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       20 * time.Second,
		WriteTimeout:      2 * time.Minute, // a thought can take a while
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    16 << 10,
	}
	go func() {
		<-ctx.Done()
		shut, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shut)
	}()
	log.Printf("relay: listening on %s, tiers from %s, keys in %s", *addr, *game, *data)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
