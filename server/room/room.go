// Package room runs one match: it owns the simulation, the radio net of each side and the
// connected clients, and it checks every action against who is asking.
package room

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"callsign/server/bot"
	"callsign/server/radio"
	"callsign/server/sim"
	"callsign/shared"
)

const (
	RoleHammer    = "hammer"    // the human commander: radio only
	RoleAnvil     = "anvil"     // the operator agent: radio, report, buy
	RoleSquad     = "squad"     // a squad leader agent: radio, report, move, hold, attack
	RoleSpectator = "spectator" // sees everything, does nothing
)

type Identity struct {
	Side  int
	Role  string
	Squad int    // squad id, for squad leaders
	Host  string // the agent host this connection belongs to, "" for none (see host.go)
	Rank  int    // for a host: its claim on the side
}

type Config struct {
	Seed          uint64
	Factions      [2]string
	LengthSeconds int       // 0 uses the rules default
	Bots          [2]string // scripted player style per side, "" for none
	AutoStart     bool      // start the clock at once instead of when the first Hammer joins
	FullBase      bool      // both sides start with every base structure standing

	// A room made in the lobby (see lobby.go). Code is what players type to find it.
	// With Seats on, a Hammer needs the token of a seat and the match starts when every
	// human seat is ready; off, anyone may command a side and the first Hammer starts it.
	Code     string
	Seats    bool
	Opponent string // "bot" or "friend", for the lobby to show
	Watch    bool   // spectators, who see both sides, are let in
	Speed    string // the pace the room is played at, for the lobby to show; "" is normal
	Purse    bool   // the operators may buy on their own from the first second (a lobby option)
	// StartGold is what each side starts with; 0 uses the rules default. The lobby's
	// control for it comes with the map options.
	StartGold int
	AgentKey  string // what an agent must show to join when it holds no seat token; "" lets any agent in

	// Tutorial marks the first lesson's room. Its learner's squads are run by the
	// learner's own browser with the scripted brain, never by this machine's agents, so a
	// lesson costs the host nothing and anyone may start one.
	Tutorial bool
}

// Name is a station as clients see it: the stable key and the callsign in both languages.
type Name struct {
	Key   string `json:"key"`
	En    string `json:"en"`
	He    string `json:"he"`
	Squad int    `json:"squad,omitempty"`
}

// Message is one transmission on a side's command net.
type Message struct {
	Seq      int      `json:"seq"`
	Tick     int      `json:"tick"`
	From     Name     `json:"from"`
	To       []Name   `json:"to"`
	Lang     string   `json:"lang"`
	Text     string   `json:"text"`
	Body     string   `json:"body"`
	End      string   `json:"end,omitempty"`
	Prowords []string `json:"prowords,omitempty"`
	Points   []string `json:"points,omitempty"`
	Final    bool     `json:"final,omitempty"` // the operator's sign-off when the match ends
}

// Client is one connection. Out carries the JSON frames to write to it; it is closed
// when the room drops the client.
type Client struct {
	ID        Identity
	Out       chan []byte
	wantState bool
	closed    bool
	joined    int // order of arrival
}

type Room struct {
	mu      sync.Mutex
	r       *shared.Rules
	net     *radio.Net
	cfg     Config
	sim     *sim.Sim
	match   int
	started bool
	seq     int
	logs    [2][]Message
	lang    [2]map[string]string // language last used toward each station
	cmd     [2]command           // who has the initiative on each side: Hammer or the operator
	bots    [2]*bot.Player
	clients map[*Client]struct{}
	host    [2]*Client // the agent host running each side's agents, if any
	joins   int
	seats   [2]seat
	quiet   time.Time // since when no person has been connected; zero while one is
	closed  bool
}

func New(r *shared.Rules, cfg Config) (*Room, error) {
	rm := &Room{r: r, net: radio.NewNet(r), cfg: cfg, clients: map[*Client]struct{}{}, quiet: time.Now()}
	if err := rm.reset(); err != nil {
		return nil, err
	}
	return rm, nil
}

func (rm *Room) reset() error {
	s, err := sim.New(rm.r, sim.Config{
		Seed: rm.cfg.Seed + uint64(rm.match), Factions: rm.cfg.Factions, LengthSeconds: rm.cfg.LengthSeconds,
		FullBase: rm.cfg.FullBase, StartGold: rm.cfg.StartGold,
	})
	if err != nil {
		return err
	}
	rm.sim, rm.started, rm.seq = s, rm.cfg.AutoStart, 0
	for side := 0; side < 2; side++ {
		rm.logs[side] = nil
		rm.lang[side] = map[string]string{}
		rm.cmd[side] = command{asked: -1, buy: rm.cfg.Purse}
		rm.bots[side] = nil
		if style := rm.cfg.Bots[side]; style != "" {
			rm.bots[side] = &bot.Player{Side: side, Style: style, R: rm.r}
		}
	}
	return nil
}

// Run ticks the match in real time until ctx ends.
func (rm *Room) Run(ctx context.Context, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			rm.Tick()
		}
	}
}

// Tick advances the match one step and tells the clients what changed.
func (rm *Room) Tick() {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if !rm.started || rm.sim.Over {
		return
	}
	if rm.sim.Tick%rm.r.TickRate == 0 {
		for _, b := range rm.bots {
			if b == nil {
				continue
			}
			for _, c := range b.Act(rm.sim.Snapshot(b.Side)) {
				if _, err := rm.sim.Apply(c); err != nil {
					log.Printf("bot side %d: %+v: %v", b.Side, c, err)
				}
			}
		}
	}
	for _, e := range rm.sim.Step() {
		frame := map[string]any{"type": "event", "event": e}
		if sq := rm.squadAny(e.Squad); sq != nil {
			frame["callsign"] = rm.squadName(sq)
		}
		rm.broadcast(e.Side, frame)
		if e.Kind == sim.EvSquadLost {
			for c := range rm.clients {
				if c.ID.Role == RoleSquad && c.ID.Side == e.Side && c.ID.Squad == e.Squad {
					rm.drop(c) // a lost squad has no leader left to talk
				}
			}
		}
	}
	if rm.sim.Over {
		rm.signOff()
		rm.tellLobby()
	}
	if rm.sim.Tick%2 == 0 || rm.sim.Over {
		rm.broadcastState()
	}
}

// signOff is the last transmission of a match: the operator tells its commander how the
// fight ended. Clients drop whatever radio was still waiting and play only this.
func (rm *Room) signOff() {
	from, to := radio.Station{Kind: radio.Operator}, radio.Station{Kind: radio.Player}
	for side := 0; side < 2; side++ {
		lang := rm.lang[side][to.Key()]
		if lang != "he" {
			lang = "en"
		}
		result := "lost"
		switch rm.sim.Winner {
		case side:
			result = "won"
		case sim.NoSide:
			result = "draw"
		}
		body := rm.r.Radio.SignOff[result].In(lang)
		text, err := rm.net.Compose(lang, from, []radio.Station{to}, body, radio.Out)
		if err != nil {
			log.Printf("sign-off for side %d: %v", side, err)
			continue
		}
		rm.seq++
		m := Message{
			Seq: rm.seq, Tick: rm.sim.Tick, From: rm.name(from, side), To: []Name{rm.name(to, side)},
			Lang: lang, Text: text, Body: body, End: radio.Out, Final: true,
		}
		rm.logs[side] = append(rm.logs[side], m)
		rm.broadcast(side, map[string]any{"type": "radio", "message": m})
	}
}

func (rm *Room) broadcastState() {
	var frames [3][]byte // side 0, side 1, spectator
	for c := range rm.clients {
		if !c.wantState {
			continue
		}
		i, side := 2, sim.Spectator
		if c.ID.Role != RoleSpectator {
			i, side = c.ID.Side, c.ID.Side
		}
		if frames[i] == nil {
			frames[i] = encode(map[string]any{"type": "state", "state": rm.sim.Snapshot(side)})
		}
		rm.send(c, frames[i])
	}
}

// Join adds a client and greets it with the match as its side sees it.
func (rm *Room) Join(id Identity, wantState bool) (*Client, error) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	switch id.Role {
	case RoleHammer, RoleAnvil, RoleSpectator:
	case RoleHost:
		if id.Host == "" {
			return nil, errors.New("a host needs an id")
		}
	case RoleSquad:
		if sq := rm.sim.Squad(id.Squad); sq == nil || sq.Side != id.Side {
			return nil, sim.ErrNoSquad
		}
	default:
		return nil, fmt.Errorf("unknown role %q", id.Role)
	}
	if id.Side != 0 && id.Side != 1 {
		return nil, errors.New("side must be 0 or 1")
	}
	if rm.closed {
		return nil, ErrNoRoom
	}
	if !rm.admits(id) {
		return nil, ErrNotActiveHost
	}
	rm.joins++
	c := &Client{ID: id, Out: make(chan []byte, 512), wantState: wantState, joined: rm.joins}
	rm.clients[c] = struct{}{}
	if id.Role == RoleHost {
		rm.rehost(id.Side, c)
	}
	rm.send(c, rm.hello(c))
	if id.Role == RoleHammer || id.Role == RoleSpectator {
		rm.quiet = time.Time{}
	}
	if id.Role == RoleHammer {
		rm.seats[id.Side].conns++
		if !rm.cfg.Seats && !rm.started {
			rm.started = true
		}
		rm.tellLobby()
	}
	return c, nil
}

func (rm *Room) hello(c *Client) []byte {
	side := c.ID.Side
	view := side
	if c.ID.Role == RoleSpectator {
		view = sim.Spectator
	}
	h := map[string]any{
		"type": "hello", "match": rm.match, "side": side, "role": c.ID.Role,
		"faction": rm.sim.Sides[side].Faction,
		"rules":   json.RawMessage(shared.RulesJSON),
		"state":   rm.sim.Snapshot(view),
		"log":     append([]Message{}, rm.logs[side]...),
		"lobby":   rm.lobby(),
		"command": rm.cmd[side].view(),
	}
	if st, ok := rm.station(c.ID); ok {
		h["station"] = rm.name(st, side)
	}
	if c.ID.Role == RoleHost {
		h["active"] = rm.host[side] == c
	}
	return encode(h)
}

func (rm *Room) Leave(c *Client) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.drop(c)
}

func (rm *Room) drop(c *Client) {
	if c.closed {
		return
	}
	c.closed = true
	close(c.Out)
	delete(rm.clients, c)
	if c.ID.Role == RoleHost {
		rm.rehost(c.ID.Side, nil)
	}
	if c.ID.Role == RoleHammer {
		// The commander is gone, for now or for good. Their squads keep their last orders.
		s := &rm.seats[c.ID.Side]
		if s.conns--; s.conns == 0 {
			s.left = time.Now()
		}
		rm.tellLobby()
	}
	if !rm.anyone() && rm.quiet.IsZero() {
		rm.quiet = time.Now()
	}
}

// send queues a frame. A client that cannot keep up is dropped rather than stalling the match.
func (rm *Room) send(c *Client, frame []byte) {
	if c.closed {
		return
	}
	select {
	case c.Out <- frame:
	default:
		rm.drop(c)
	}
}

// broadcast sends a frame to everyone on a side, and to spectators.
func (rm *Room) broadcast(side int, v any) {
	frame := encode(v)
	for c := range rm.clients {
		if c.ID.Side == side || c.ID.Role == RoleSpectator {
			rm.send(c, frame)
		}
	}
}

// Restart throws the match away and starts a new one. Squad leaders are disconnected,
// because their squads are gone; everyone else is greeted again.
func (rm *Room) Restart(c *Client) error {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if c.ID.Role != RoleHammer {
		return errors.New("only Hammer restarts the match")
	}
	// Two commanders: neither can throw away a fight the other is still in, and the
	// rematch waits in the lobby until both are ready again.
	shared := rm.cfg.Seats && rm.cfg.Opponent == OpponentFriend
	if shared && rm.started && !rm.sim.Over {
		return errors.New("the match is still being fought")
	}
	rm.match++
	if err := rm.reset(); err != nil {
		return err
	}
	rm.started = !shared
	if shared {
		rm.seats[0].ready, rm.seats[1].ready = false, false
	}
	for o := range rm.clients {
		if o.ID.Role == RoleSquad {
			rm.drop(o)
			continue
		}
		rm.send(o, rm.hello(o))
	}
	return nil
}

// station is the voice a client speaks with on the net.
func (rm *Room) station(id Identity) (radio.Station, bool) {
	switch id.Role {
	case RoleHammer:
		return radio.Station{Kind: radio.Player}, true
	case RoleAnvil:
		return radio.Station{Kind: radio.Operator}, true
	case RoleSquad:
		if sq := rm.sim.Squad(id.Squad); sq != nil {
			return radio.Station{Kind: radio.Squad, Class: sq.Class(), Num: sq.Num}, true
		}
	}
	return radio.Station{}, false
}

// squadOf finds the living squad behind a callsign on one side.
func (rm *Room) squadOf(side int, st radio.Station) *sim.Squad {
	for _, sq := range rm.sim.Squads {
		if sq.Alive && sq.Side == side && sq.Class() == st.Class && sq.Num == st.Num {
			return sq
		}
	}
	return nil
}

// squadAny returns a squad by id whether it is alive or not, for naming it in events.
func (rm *Room) squadAny(id int) *sim.Squad {
	return rm.sim.SquadAny(id)
}

func (rm *Room) squadName(sq *sim.Squad) Name {
	cs := rm.sim.Callsign(sq)
	st := radio.Station{Kind: radio.Squad, Class: sq.Class(), Num: sq.Num}
	return Name{Key: st.Key(), En: cs.En, He: cs.He, Squad: sq.ID}
}

func (rm *Room) name(st radio.Station, side int) Name {
	n := Name{Key: st.Key(), En: rm.net.Name(st, "en"), He: rm.net.Name(st, "he")}
	if st.Kind == radio.Squad {
		if sq := rm.squadOf(side, st); sq != nil {
			n.Squad = sq.ID
		}
	}
	return n
}

// How closely Hammer has to follow radio procedure. The player picks the level; agents
// always transmit through the radio tool, which writes proper procedure itself.
const (
	Relaxed  = 1 // a callsign and the order are enough: "Viper 1 attack Delta"
	Standard = 2 // the call is required: "Viper 1, this is Hammer. Attack Delta"
	Strict   = 3 // the call and a closing Over or Out are required
)

var (
	ErrNoCall   = errors.New(`start with the call: "<to>, this is <you>"`)
	ErrNoEnding = errors.New("end the transmission with Over or Out")
)

// Say puts Hammer's transmission on the net at the relaxed level.
func (rm *Room) Say(c *Client, text string) (Message, error) { return rm.SayAt(c, text, Relaxed) }

// SayAt puts Hammer's transmission on the net, held to a strictness level. Routing is by
// callsign match only. At the relaxed level a message with no callsign goes to the operator.
func (rm *Room) SayAt(c *Client, text string, level int) (Message, error) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if c.ID.Role != RoleHammer {
		return Message{}, errors.New("agents transmit with the radio tool")
	}
	parse := rm.net.Parse
	if level <= Relaxed {
		parse = rm.net.ParseRelaxed
	}
	p, err := parse(text)
	if err != nil {
		return Message{}, err
	}
	me := radio.Station{Kind: radio.Player}
	if p.From != nil && *p.From != me {
		return Message{}, fmt.Errorf("you are %s, not %s", rm.net.Name(me, p.Lang), rm.net.Name(*p.From, p.Lang))
	}
	if level >= Standard && (len(p.To) == 0 || p.From == nil) {
		return Message{}, ErrNoCall
	}
	if level >= Strict && p.End == "" {
		return Message{}, ErrNoEnding
	}
	if len(p.To) == 0 {
		p.To = []radio.Station{{Kind: radio.Operator}}
	}
	rm.lang[c.ID.Side][me.Key()] = p.Lang // the net follows the commander's language
	m, err := rm.transmit(c.ID.Side, me, p, text)
	if err == nil {
		rm.heardHammer(c.ID.Side, p)
	}
	return m, err
}

// transmit checks the addressees, logs the message and sends it to the whole side.
func (rm *Room) transmit(side int, from radio.Station, p radio.Parsed, text string) (Message, error) {
	if rm.sim.Over {
		return Message{}, sim.ErrOver
	}
	m := Message{
		Tick: rm.sim.Tick, From: rm.name(from, side), Lang: p.Lang, Text: text,
		Body: p.Body, End: p.End, Prowords: p.Prowords, Points: p.Points,
	}
	for _, st := range p.To {
		if st.Kind == radio.Squad && rm.squadOf(side, st) == nil {
			return Message{}, fmt.Errorf("no station %s on this net", rm.net.Name(st, p.Lang))
		}
		if st == from {
			return Message{}, errors.New("you cannot call yourself")
		}
		m.To = append(m.To, rm.name(st, side))
		rm.lang[side][st.Key()] = p.Lang
	}
	rm.seq++
	m.Seq = rm.seq
	rm.logs[side] = append(rm.logs[side], m)
	rm.broadcast(side, map[string]any{"type": "radio", "message": m})
	return m, nil
}

// Log is a copy of one side's radio log.
func (rm *Room) Log(side int) []Message {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	return append([]Message{}, rm.logs[side]...)
}

// View runs f with the simulation while the room is held still. Tests use it.
func (rm *Room) View(f func(*sim.Sim)) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	f(rm.sim)
}

func encode(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err) // every frame is built from our own types
	}
	return b
}
