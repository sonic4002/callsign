package relay

import (
	"sync"
	"time"
)

// Limits bounds what one seat can ask of the relay. A seat is one player, and all of that
// player's agents share it: up to twelve squad leaders and the operator, each thinking
// when something happens to it.
type Limits struct {
	Concurrent int           // thoughts in flight at once
	PerMinute  int           // thoughts started per minute, refilled evenly
	Burst      int           // thoughts that may start back to back
	KeyChanges int           // key reads and writes per minute
	Idle       time.Duration // a seat unseen this long is forgotten
}

// DefaultLimits fits a full army in a hard fight with room to spare.
var DefaultLimits = Limits{Concurrent: 8, PerMinute: 120, Burst: 30, KeyChanges: 20, Idle: 10 * time.Minute}

type seatUse struct {
	inFlight int
	tokens   float64 // thoughts that may start now
	keyOps   float64
	seen     time.Time
}

// limiter counts per seat, in memory. It is not match state: a relay that restarts, or a
// second relay beside this one, simply starts counting again.
type limiter struct {
	Limits
	mu    sync.Mutex
	seats map[string]*seatUse
	now   func() time.Time
}

func newLimiter(l Limits) *limiter {
	return &limiter{Limits: l, seats: map[string]*seatUse{}, now: time.Now}
}

// use returns the seat's counters, refilled for the time that has passed.
func (l *limiter) use(seat string) *seatUse {
	now := l.now()
	u := l.seats[seat]
	if u == nil {
		if len(l.seats) > 4096 {
			for id, other := range l.seats {
				if other.inFlight == 0 && now.Sub(other.seen) > l.Idle {
					delete(l.seats, id)
				}
			}
		}
		u = &seatUse{tokens: float64(l.Burst), keyOps: float64(l.KeyChanges), seen: now}
		l.seats[seat] = u
		return u
	}
	minutes := now.Sub(u.seen).Minutes()
	u.tokens = min(float64(l.Burst), u.tokens+minutes*float64(l.PerMinute))
	u.keyOps = min(float64(l.KeyChanges), u.keyOps+minutes*float64(l.KeyChanges))
	u.seen = now
	return u
}

// begin admits one thought, or says how long to wait. The caller calls done when the
// thought is over.
func (l *limiter) begin(seat string) (ok bool, wait time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	u := l.use(seat)
	if u.inFlight >= l.Concurrent {
		return false, time.Second
	}
	if u.tokens < 1 {
		return false, time.Duration((1 - u.tokens) / float64(l.PerMinute) * float64(time.Minute))
	}
	u.tokens--
	u.inFlight++
	return true, 0
}

func (l *limiter) done(seat string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if u := l.seats[seat]; u != nil && u.inFlight > 0 {
		u.inFlight--
	}
}

// keyOp admits one read or write of a seat's key.
func (l *limiter) keyOp(seat string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	u := l.use(seat)
	if u.keyOps < 1 {
		return false
	}
	u.keyOps--
	return true
}
