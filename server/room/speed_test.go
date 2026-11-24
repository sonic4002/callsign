package room

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"callsign/server/sim"
)

// A match's speed is chosen by whoever makes it, is shown to both players in the lobby,
// and changes nothing but the real time a tick takes.
func TestSpeedIsPerRoomAndShownInTheLobby(t *testing.T) {
	h := newHub(t, HubConfig{})
	if _, _, _, err := h.Create(Options{Opponent: OpponentFriend, Side: 0, Speed: "warp"}); err == nil {
		t.Fatal("an unknown speed was accepted")
	}
	usual, _, _, err := h.Create(Options{Opponent: OpponentFriend, Side: 0})
	if err != nil {
		t.Fatal(err)
	}
	if l := usual.Lobby(); l.Speed != SpeedNormal || l.Pace != 1 {
		t.Fatalf("a match made without a speed: %+v", l)
	}
	fast, _, _, err := h.Create(Options{Opponent: OpponentFriend, Side: 0, Speed: "fast"})
	if err != nil {
		t.Fatal(err)
	}
	if l := fast.Lobby(); l.Speed != "fast" || l.Pace != 1.5 {
		t.Fatalf("the friend would be shown %+v", l)
	}
	base := 100 * time.Millisecond
	for name, want := range map[string]time.Duration{"relaxed": 133333333, "normal": base, "fast": 66666666, "": base} {
		if got := tickEvery(base, name); got != want {
			t.Errorf("tickEvery(%q) = %v, want %v", name, got, want)
		}
	}

	// The lobby's choices come from the server, and a made match carries the choice.
	mux := http.NewServeMux()
	h.Routes(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	res, err := http.Post(srv.URL+"/api/rooms", "application/json", strings.NewReader(`{"opponent":"bot","side":0,"speed":"relaxed"}`))
	if err != nil || res.StatusCode != http.StatusCreated {
		t.Fatalf("making a relaxed match: %v %v", res.StatusCode, err)
	}
	var made struct {
		Lobby LobbyView `json:"lobby"`
	}
	decode(t, res, &made)
	if made.Lobby.Speed != "relaxed" || made.Lobby.Pace != 0.75 {
		t.Fatalf("the made match says %+v", made.Lobby)
	}
	var info struct {
		Speeds []Speed `json:"speeds"`
		Speed  string  `json:"speed"`
	}
	res, err = http.Get(srv.URL + "/api/server")
	if err != nil {
		t.Fatal(err)
	}
	decode(t, res, &info)
	if len(info.Speeds) != 3 || info.Speed != SpeedNormal || info.Speeds[2].Name != "fast" {
		t.Fatalf("the lobby is offered %+v", info)
	}
}

// Two rooms on the same seed, one fast and one relaxed, play the same match tick for tick:
// the faster one only gets there sooner.
func TestSpeedDoesNotChangeTheMatch(t *testing.T) {
	mk := func(speed string) *Room {
		rm, err := New(rules, Config{Seed: 5, Factions: [2]string{"aegis", "ashfall"}, Bots: [2]string{"standard", "standard"}, AutoStart: true, Speed: speed})
		if err != nil {
			t.Fatal(err)
		}
		return rm
	}
	hash := func(rm *Room) (h uint64, tick int) {
		rm.View(func(s *sim.Sim) { h, tick = s.Hash(), s.Tick })
		return
	}
	fast, slow := mk("fast"), mk("relaxed")
	for i := 0; i < 600; i++ {
		fast.Tick()
		slow.Tick()
	}
	fh, _ := hash(fast)
	sh, _ := hash(slow)
	if fh != sh {
		t.Fatal("the same seed played at two speeds gave two different matches")
	}

	// In real time the fast room runs ahead.
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	a, b := mk("fast"), mk("relaxed")
	base := 4 * time.Millisecond
	done := make2(func() { a.Run(ctx, tickEvery(base, "fast")) }, func() { b.Run(ctx, tickEvery(base, "relaxed")) })
	<-done
	<-done
	_, at := hash(a)
	_, bt := hash(b)
	if at <= bt || bt == 0 {
		t.Fatalf("in the same real time the fast room made %d ticks and the relaxed one %d", at, bt)
	}
}

func make2(fs ...func()) chan struct{} {
	done := make(chan struct{}, len(fs))
	for _, f := range fs {
		go func() { f(); done <- struct{}{} }()
	}
	return done
}

func decode(t *testing.T, res *http.Response, v any) {
	t.Helper()
	defer res.Body.Close()
	if err := json.NewDecoder(res.Body).Decode(v); err != nil {
		t.Fatal(err)
	}
}
