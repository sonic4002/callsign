package room

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"callsign/server/bot"
	"callsign/server/sim"
)

// The first lesson is a real match in its own room. Its enemy does nothing until the
// learner's page releases it, then sends one squad at the learner's rig.
func TestLessonEnemyWaitsUntilItIsReleased(t *testing.T) {
	h := newHub(t, HubConfig{Bot: "standard", AgentKey: "agents"})
	rm, side, token, err := h.Create(Options{Opponent: OpponentBot, Side: 0, Bot: bot.Tutorial})
	if err != nil || side != 0 {
		t.Fatalf("create: side %d err %v", side, err)
	}
	if l := rm.Lobby(); !l.Tutorial || l.Level != bot.Tutorial || l.Watch {
		t.Fatalf("lobby of a lesson: %+v", l)
	}
	me := enter(t, rm, 0, RoleHammer, token)
	rm.Ready(me, true)
	enemyOrders := func() (kinds []string, squads int) {
		rm.View(func(s *sim.Sim) {
			for _, sq := range s.Squads {
				if sq.Side == 1 && sq.Alive {
					squads++
					kinds = append(kinds, sq.Order.Kind+" "+sq.Order.Point)
				}
			}
		})
		return kinds, squads
	}
	for i := 0; i < 60*rules.TickRate; i++ {
		rm.Tick()
	}
	kinds, squads := enemyOrders()
	for _, k := range kinds {
		if strings.TrimSpace(k) != sim.OrderNone {
			t.Fatalf("the lesson's enemy acted before it was released: %v", kinds)
		}
	}
	if squads != 2 {
		t.Fatalf("the lesson's enemy bought squads: it has %d", squads)
	}

	// A spectator cannot release it; the learner can.
	if err := rm.Release(&Client{ID: Identity{Role: RoleSpectator}}); err != ErrNoLesson {
		t.Fatalf("a spectator released the enemy: %v", err)
	}
	if err := rm.Release(me); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5*rules.TickRate; i++ {
		rm.Tick()
	}
	kinds, squads = enemyOrders()
	attacking := 0
	for _, k := range kinds {
		if k == sim.OrderAttack+" B" {
			attacking++
		}
	}
	if attacking != 1 || squads != 2 {
		t.Fatalf("released, one squad should attack the learner's rig: %v", kinds)
	}

	// An ordinary match has no lesson to release.
	plain, _, tok, _ := h.Create(Options{Opponent: OpponentBot, Side: 0})
	if err := plain.Release(enter(t, plain, 0, RoleHammer, tok)); err != ErrNoLesson {
		t.Fatalf("an ordinary match took a lesson frame: %v", err)
	}
}

// A lesson's squads think in the learner's own browser, so the server's agents are never
// sent to it; that is what makes it safe to start one without the host's password.
func TestLessonNeedsNoHostPasswordAndNoServerAgents(t *testing.T) {
	h := newHub(t, HubConfig{Bot: "standard", AgentKey: "agents", HostKey: "open sesame"})
	mux := http.NewServeMux()
	h.Routes(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	post := func(body string) int {
		res, err := http.Post(srv.URL+"/api/rooms", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		return res.StatusCode
	}
	if code := post(`{"opponent":"bot","bot":"easy"}`); code != http.StatusForbidden {
		t.Fatalf("an ordinary match was made without the host password: %d", code)
	}
	if code := post(`{"opponent":"friend","bot":"tutorial"}`); code != http.StatusForbidden {
		t.Fatalf("a friend match slipped past the password as a lesson: %d", code)
	}
	if code := post(`{"opponent":"bot","bot":"tutorial","side":0}`); code != http.StatusCreated {
		t.Fatalf("a lesson could not be started without the host password: %d", code)
	}
	var lesson *Room
	for _, e := range h.rooms {
		lesson = e.rm
	}
	lesson.mu.Lock()
	lesson.seats[0].conns = 1 // the learner is in the room
	lesson.mu.Unlock()
	if work := h.AgentWork(); len(work) != 0 {
		t.Fatalf("the server's agents were sent to a lesson: %+v", work)
	}
	// Anyone may start a lesson, so only a few run at once.
	last := 0
	for i := 0; i < maxLessons+1; i++ {
		last = post(`{"opponent":"bot","bot":"tutorial","side":0}`)
	}
	if last != http.StatusServiceUnavailable {
		t.Fatalf("lessons were not limited: last answer %d", last)
	}
}
