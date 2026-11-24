// Command relay is the model relay: it holds each player's AI key, encrypted, and makes
// their agents' AI calls with the model their squad's brain tier allows.
//
//	relay -addr=127.0.0.1:8090 -game=http://127.0.0.1:8080/internal/tier -data=./.relay-data
//
// Environment:
//
//	CALLSIGN_RELAY_MASTER_KEY  32 bytes in hex or base64 that seal the stored keys. Without
//	                           it the relay makes <data>/master.key on first start.
//	CALLSIGN_AGENT_KEY         the game server's agent key (its -agent-key), shown with
//	                           every tier question so that only its own services can ask.
//	CALLSIGN_JEV_KEY           the game's own TypeSafe key, for the squads' fast brain
//	                           (POST /relay/v1/decide). Without it that route is off and
//	                           squads use the rule brain. It is never logged or sent to a page.
package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
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
	jevDaily := flag.Float64("jev-daily-usd", 2, "most the fast brain may spend on the game's key in one day (UTC), in dollars; negative for no ceiling")
	jevPerMinute := flag.Int("jev-per-minute", 1200, "most fast-brain decisions a minute across all players")
	jevSeatPerMinute := flag.Int("jev-seat-per-minute", 60, "most fast-brain decisions a minute for one player")
	jevModel := flag.String("jev-model", "", "decision model id; empty takes the pinned one from shared/models.json")
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
		Game:      &relay.HTTPGame{URL: *game, Secret: os.Getenv("CALLSIGN_AGENT_KEY")},
		Keys:      keys,
		TokenKey:  relay.TokenKey(master),
		Models:    models,
		Rules:     rules,
		Providers: provider.All(nil),
		Origins:   allowed,
		Decide: relay.Decide{
			Provider: provider.NewTypeSafe(nil), Key: strings.TrimSpace(os.Getenv("CALLSIGN_JEV_KEY")), Model: *jevModel,
			Seat:      relay.Limits{Concurrent: 4, PerMinute: *jevSeatPerMinute, Burst: max(5, *jevSeatPerMinute/3), KeyChanges: 1, Idle: 10 * time.Minute},
			PerMinute: *jevPerMinute, Burst: max(10, *jevPerMinute/10), DailyUSD: *jevDaily,
			SpendFile: filepath.Join(*data, "jev-spend.json"),
		},
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
	if os.Getenv("CALLSIGN_JEV_KEY") != "" {
		log.Printf("relay: the fast brain is on: at most %.2f USD a day, %d decisions a minute in all and %d for one player", *jevDaily, *jevPerMinute, *jevSeatPerMinute)
	} else {
		log.Print("relay: no CALLSIGN_JEV_KEY, so the fast brain is off and squads without a key use the rule brain")
	}
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
