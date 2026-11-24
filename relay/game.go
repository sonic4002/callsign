package relay

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"
)

// Game is what the relay asks the game server before every thought: does this seat token
// command that side of that room, and which brain tier has the squad bought? The answer is
// never remembered, so an upgrade paid for in gold changes the model on the squad's next
// thought and a seat that is gone stops thinking at once.
type Game interface {
	// Tier returns the brain tier of a squad on a side the token holds. Squad 0 is the
	// operator, whose tier is not used. ErrNotYourSeat means the game server said no.
	Tier(ctx context.Context, token, room string, side, squad int) (int, error)
	// Vouch is Tier for what the game itself pays for: it also fails with ErrNotYourSeat
	// in a room that has no seats (the open room of a server with no agent key), where
	// the game server lets anyone ask.
	Vouch(ctx context.Context, token, room string, side, squad int) error
}

var ErrNotYourSeat = errors.New("that seat is not yours")

// HTTPGame asks the game server over HTTP:
//
//	GET <URL>?room=<code>&side=<0|1>&squad=<id, 0 for the operator>
//	Authorization: Bearer <Secret>     the game server's agent key, when it has one
//	X-Callsign-Seat: <seat token>      the player's seat in that room
//
// and expects 200 {"tier": 1|2|3} (0 for the operator). 403 and 404 mean the token does
// not hold that seat, or the room or squad does not exist: the relay does not tell them
// apart to callers. 401 means the relay's own secret is wrong, which is a set-up fault.
type HTTPGame struct {
	URL    string // for example http://server:8080/internal/tier
	Secret string // the game server's agent key, so only its own services can ask
	Client *http.Client
}

func (g *HTTPGame) Tier(ctx context.Context, token, room string, side, squad int) (int, error) {
	tier, _, err := g.ask(ctx, token, room, side, squad)
	return tier, err
}

func (g *HTTPGame) Vouch(ctx context.Context, token, room string, side, squad int) error {
	_, seated, err := g.ask(ctx, token, room, side, squad)
	if err == nil && !seated {
		return ErrNotYourSeat
	}
	return err
}

func (g *HTTPGame) ask(ctx context.Context, token, room string, side, squad int) (int, bool, error) {
	q := url.Values{"room": {room}, "side": {strconv.Itoa(side)}, "squad": {strconv.Itoa(squad)}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, g.URL+"?"+q.Encode(), nil)
	if err != nil {
		return 0, false, err
	}
	req.Header.Set("X-Callsign-Seat", token)
	if g.Secret != "" {
		req.Header.Set("Authorization", "Bearer "+g.Secret)
	}
	client := g.Client
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	res, err := client.Do(req)
	if err != nil {
		return 0, false, errors.New("the game server could not be reached")
	}
	defer res.Body.Close()
	switch res.StatusCode {
	case http.StatusOK:
	case http.StatusForbidden, http.StatusNotFound:
		return 0, false, ErrNotYourSeat
	case http.StatusUnauthorized:
		return 0, false, errors.New("the game server refused the relay's agent key")
	default:
		return 0, false, fmt.Errorf("the game server answered %d to the tier question", res.StatusCode)
	}
	var out struct {
		Tier   int  `json:"tier"`
		Seated bool `json:"seated"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 4096)).Decode(&out); err != nil {
		return 0, false, errors.New("the game server's tier answer was not understood")
	}
	return out.Tier, out.Seated, nil
}

// FakeGame is a game server for tests: seats and tiers set by hand.
type FakeGame struct {
	mu    sync.Mutex
	seats map[string]string // room/side → token
	tiers map[string]int    // room/side/squad → tier
	Err   error             // when set, every question fails with it
	Open  bool              // the room has no seats: anyone may ask a tier, nobody is vouched for
	Asked int
}

func NewFakeGame() *FakeGame {
	return &FakeGame{seats: map[string]string{}, tiers: map[string]int{}}
}

// Seat gives a side of a room to a token.
func (f *FakeGame) Seat(room string, side int, token string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.seats[fmt.Sprintf("%s/%d", room, side)] = token
}

// Squad puts a squad on a side at a brain tier.
func (f *FakeGame) Squad(room string, side, squad, tier int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.tiers[fmt.Sprintf("%s/%d/%d", room, side, squad)] = tier
}

func (f *FakeGame) Tier(_ context.Context, token, room string, side, squad int) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Asked++
	if f.Err != nil {
		return 0, f.Err
	}
	if held, ok := f.seats[fmt.Sprintf("%s/%d", room, side)]; !f.Open && (!ok || held != token) {
		return 0, ErrNotYourSeat
	}
	if squad == 0 {
		return 0, nil
	}
	tier, ok := f.tiers[fmt.Sprintf("%s/%d/%d", room, side, squad)]
	if !ok {
		return 0, ErrNotYourSeat
	}
	return tier, nil
}

func (f *FakeGame) Vouch(ctx context.Context, token, room string, side, squad int) error {
	if _, err := f.Tier(ctx, token, room, side, squad); err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Open {
		return ErrNotYourSeat
	}
	return nil
}
