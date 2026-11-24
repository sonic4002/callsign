package room

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"time"
)

// Who a room's human plays against.
const (
	OpponentBot    = "bot"    // the scripted enemy, or nobody when the server runs without one
	OpponentFriend = "friend" // a second person in the other seat
)

var (
	ErrNoRoom     = errors.New("no such match")
	ErrSeatTaken  = errors.New("that seat is taken")
	ErrNoSeat     = errors.New("you do not hold that seat")
	ErrNoWatching = errors.New("this match is not open to spectators")
	ErrNotAgent   = errors.New("agents need the server's agent key or their side's seat token")
	ErrNoHost     = errors.New("an agent joins through its host: name the host it belongs to")
)

// A seat is one side's commander. There are no accounts: whoever holds the token the
// server handed out when the seat was taken is that commander, also after a reload.
type seat struct {
	token string
	ready bool
	conns int       // Hammer connections open right now
	left  time.Time // when the last one closed
}

// Auth is what a connection shows to be let into a room.
type Auth struct {
	Token string // a seat token
	Key   string // the server's agent key
}

// SeatView is a seat as everyone in the room may see it. It never carries the token.
type SeatView struct {
	Side    int    `json:"side"`
	Faction string `json:"faction"`
	Bot     bool   `json:"bot"`    // played by the scripted enemy
	Taken   bool   `json:"taken"`  // a person holds it
	Ready   bool   `json:"ready"`  // and has pressed ready
	Online  bool   `json:"online"` // and is connected now
}

// LobbyView is the state of a room around the match: who sits where and whether it runs.
type LobbyView struct {
	Room      string      `json:"room"`
	Opponent  string      `json:"opponent"`
	Length    int         `json:"length"` // seconds
	Watch     bool        `json:"watch"`
	Level     string      `json:"level,omitempty"` // the scripted enemy's level, when one plays
	Speed     string      `json:"speed"`           // the pace: "relaxed", "normal" or "fast"
	Pace      float64     `json:"pace"`            // match seconds per real second at that pace
	Purse     bool        `json:"purse"`           // the operators may buy on their own from the start
	StartGold int         `json:"startGold"`       // gold each side starts with
	Phase     string      `json:"phase"`           // "lobby", "playing" or "over"
	Match     int         `json:"match"`
	Seats     [2]SeatView `json:"seats"`
	Tutorial  bool        `json:"tutorial,omitempty"` // the first lesson (see Config.Tutorial)
}

// ErrNoLesson refuses a lesson frame outside a lesson.
var ErrNoLesson = errors.New("this match is not a lesson")

// Release lets the lesson's enemy move. Only the learner may say so, and only in a lesson.
func (rm *Room) Release(c *Client) error {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if !rm.cfg.Tutorial || c.ID.Role != RoleHammer {
		return ErrNoLesson
	}
	for _, b := range rm.bots {
		if b != nil {
			b.Released = true
		}
	}
	return nil
}

func (rm *Room) lobby() LobbyView {
	v := LobbyView{
		Room: rm.cfg.Code, Opponent: rm.cfg.Opponent, Watch: rm.cfg.Watch, Match: rm.match,
		Length: rm.sim.LengthTicks() / rm.r.TickRate, Phase: "lobby", Tutorial: rm.cfg.Tutorial, Speed: SpeedNormal, Pace: 1, Purse: rm.cfg.Purse, StartGold: rm.cfg.StartGold,
	}
	if v.StartGold == 0 {
		v.StartGold = rm.r.Match.StartGold
	}
	if f, ok := speedFactor(rm.cfg.Speed); ok {
		v.Speed, v.Pace = rm.cfg.Speed, f
	}
	switch {
	case rm.sim.Over:
		v.Phase = "over"
	case rm.started:
		v.Phase = "playing"
	}
	for side := range v.Seats {
		if style := rm.cfg.Bots[side]; style != "" {
			v.Level = style
		}
		s := &rm.seats[side]
		v.Seats[side] = SeatView{
			Side: side, Faction: rm.sim.Sides[side].Faction, Bot: rm.cfg.Bots[side] != "",
			Taken: s.token != "" || (!rm.cfg.Seats && s.conns > 0), Ready: s.ready, Online: s.conns > 0,
		}
	}
	return v
}

// Lobby is the room's lobby state, for the page before it has a connection.
func (rm *Room) Lobby() LobbyView {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	return rm.lobby()
}

// tellLobby sends the lobby state to everyone in the room. It holds nothing one side
// may not know.
func (rm *Room) tellLobby() {
	frame := encode(map[string]any{"type": "lobby", "lobby": rm.lobby()})
	for c := range rm.clients {
		rm.send(c, frame)
	}
}

// Sit takes a seat for a person and returns its side and token. Side -1 means whichever
// human seat is free.
func (rm *Room) Sit(side int) (int, string, error) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if rm.closed {
		return 0, "", ErrNoRoom
	}
	free := func(s int) bool { return rm.cfg.Bots[s] == "" && rm.seats[s].token == "" && rm.humanSeat(s) }
	switch {
	case side == -1 && free(0):
		side = 0
	case side == -1 && free(1):
		side = 1
	case side != 0 && side != 1, !free(side):
		return 0, "", ErrSeatTaken
	}
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return 0, "", err
	}
	rm.seats[side].token = hex.EncodeToString(raw)
	rm.seats[side].left = time.Now()
	rm.tellLobby()
	return side, rm.seats[side].token, nil
}

// humanSeat reports whether a person may sit on a side: always against a friend; against
// the scripted enemy only one seat exists, and it is gone once someone holds it.
func (rm *Room) humanSeat(side int) bool {
	return rm.cfg.Opponent == OpponentFriend || rm.seats[1-side].token == ""
}

// holds reports whether token is the token of that side's seat.
func (rm *Room) holds(side int, token string) bool {
	t := rm.seats[side].token
	return t != "" && subtle.ConstantTimeCompare([]byte(t), []byte(token)) == 1
}

// Seated reports whether the room's sides are held by seat tokens.
func (rm *Room) Seated() bool { return rm.cfg.Seats }

// Holds is holds for callers outside the room, such as the model relay's lookup.
func (rm *Room) Holds(side int, token string) bool {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	return (side == 0 || side == 1) && rm.holds(side, token)
}

// Enter is Join for a connection from outside: it first checks that the connection may
// be who it says it is. In a room without seats and without an agent key everyone is
// trusted, as in Phase 0.
func (rm *Room) Enter(id Identity, auth Auth, wantState bool) (*Client, error) {
	id, err := rm.admit(id, auth)
	if err != nil {
		return nil, err
	}
	return rm.Join(id, wantState)
}

// admit checks a connection and returns its identity as the room will know it: what a
// host may claim is decided here, by what it showed, and not by what it asked for.
func (rm *Room) admit(id Identity, auth Auth) (Identity, error) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	return id, rm.check(&id, auth)
}

func (rm *Room) check(id *Identity, auth Auth) error {
	if id.Side != 0 && id.Side != 1 {
		return errors.New("side must be 0 or 1")
	}
	switch id.Role {
	case RoleHammer:
		if rm.cfg.Seats && !rm.holds(id.Side, auth.Token) {
			return ErrNoSeat
		}
	case RoleSpectator:
		// A spectator sees both sides, so a seat's token does not buy the view either.
		if rm.cfg.Seats && !rm.cfg.Watch {
			return ErrNoWatching
		}
	case RoleAnvil, RoleSquad, RoleHost:
		// An agent sees its side's fog and speaks on its net, and a host decides who runs
		// a side's agents. With an agent key set they must come from the server's own
		// agent host (the key) or from the browser of the commander they serve (that
		// seat's token). Without a key the server is in its trusting, this-machine-only
		// mode, and a host's rank is whatever it says.
		key := rm.cfg.AgentKey
		if key == "" {
			return nil
		}
		rank := RankServer
		switch {
		case subtle.ConstantTimeCompare([]byte(key), []byte(auth.Key)) == 1:
		case rm.holds(id.Side, auth.Token):
			rank = RankBrowser // the commander's own browser outranks agents run for them
		default:
			return ErrNotAgent
		}
		if id.Role == RoleHost {
			id.Rank = rank
		} else if id.Host == "" {
			// An agent on its own would think beside the side's host. Every agent
			// belongs to one, so that a side is never run twice.
			return ErrNoHost
		}
	}
	return nil
}

// Ready marks a commander ready or not. The match starts once every person the room is
// waiting for is ready: one against the scripted enemy, both against a friend.
func (rm *Room) Ready(c *Client, ready bool) error {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if c.ID.Role != RoleHammer {
		return errors.New("only Hammer readies up")
	}
	rm.seats[c.ID.Side].ready = ready
	if rm.cfg.Seats && !rm.started && !rm.sim.Over && rm.everyoneReady() {
		rm.started = true
	}
	rm.tellLobby()
	return nil
}

// Stand gives a seat back, so someone else can take it. Only before the match starts:
// once it runs the seat stays its commander's, who may come back to it.
func (rm *Room) Stand(c *Client) error {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if c.ID.Role != RoleHammer || !rm.cfg.Seats {
		return errors.New("there is no seat to give back")
	}
	if rm.started {
		return errors.New("the match has started; the seat stays yours")
	}
	rm.seats[c.ID.Side].token, rm.seats[c.ID.Side].ready = "", false
	for o := range rm.clients {
		if o.ID.Side == c.ID.Side && o.ID.Role != RoleSpectator {
			rm.drop(o) // the commander's other tabs, and the agents that served them
		}
	}
	rm.tellLobby()
	return nil
}

func (rm *Room) everyoneReady() bool {
	people := 0
	for side := range rm.seats {
		if rm.cfg.Bots[side] != "" {
			continue
		}
		s := &rm.seats[side]
		if s.token == "" {
			if rm.cfg.Opponent == OpponentFriend {
				return false // the friend has not sat down yet
			}
			continue
		}
		if !s.ready {
			return false
		}
		people++
	}
	return people > 0
}

// anyone reports whether a person, not an agent, is connected.
func (rm *Room) anyone() bool {
	for c := range rm.clients {
		if c.ID.Role == RoleHammer || c.ID.Role == RoleSpectator {
			return true
		}
	}
	return false
}

// agentSides lists the sides whose agents should be running: a seat a person holds and
// is at, or left less than `grace` ago (a reload must not cost the squads their leaders).
func (rm *Room) agentSides(grace time.Duration) []int {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	sides := []int{}
	for side := range rm.seats {
		s := &rm.seats[side]
		claimed := s.token != "" || !rm.cfg.Seats // without seats, whoever commands holds it
		present := s.conns > 0 || (!s.left.IsZero() && time.Since(s.left) < grace)
		if !rm.closed && claimed && present {
			sides = append(sides, side)
		}
	}
	return sides
}

// quietFor is how long the room has had nobody in it.
func (rm *Room) quietFor() time.Duration {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if rm.quiet.IsZero() {
		return 0
	}
	return time.Since(rm.quiet)
}

// Close ends the room: every connection is dropped and nothing can join.
func (rm *Room) Close() {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.closed = true
	for c := range rm.clients {
		rm.drop(c)
	}
}

// Tier is the brain tier of a squad on a side; 0 with ok for the operator (squad 0),
// which has no tier. The model relay asks this before every thought.
func (rm *Room) Tier(side, squad int) (tier int, ok bool) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if side != 0 && side != 1 {
		return 0, false
	}
	if squad == 0 {
		return 0, true
	}
	sq := rm.sim.Squad(squad)
	if sq == nil || sq.Side != side || !sq.Alive {
		return 0, false
	}
	return sq.Tier, true
}
