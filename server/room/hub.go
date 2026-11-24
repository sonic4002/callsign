package room

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"callsign/server/bot"
	"callsign/shared"
)

// HubConfig is what every room on a server shares.
type HubConfig struct {
	Seed          uint64        // the first room's seed; each later room gets the next one
	Factions      [2]string     // side 0 and side 1
	LengthSeconds int           // default match length, 0 for the rules default
	Bot           string        // style of the scripted enemy, "" to play without one
	Interval      time.Duration // real time per simulation tick
	AgentKey      string        // see Config.AgentKey; "" also keeps the open room of Phase 0
	IdleAfter     time.Duration // a room nobody is in is dropped after this long
	MaxRooms      int
	Share         string // address other machines reach this server at, "" when unknown
	HostKey       string // password needed to make a match, "" for none; joining one by its code never needs it
}

// agentGrace is how long a side's agents stay after its commander's last connection
// closed, so that a reload does not cost the squads their leaders.
const agentGrace = 20 * time.Second

var (
	ErrFull     = errors.New("this server is running as many matches as it can")
	ErrHostOnly = errors.New("only this server's host can make a match here")
	ErrGuessing = errors.New("too many wrong join codes; wait a minute")
)

// guessesPerMinute is how many wrong join codes the whole server answers in a minute.
// A code has about 33 million values, so guessing one at this pace is hopeless.
const guessesPerMinute = 40

// Hub holds every room on the server. Each room is its own match with its own seed,
// clock and radio nets; nothing is shared between them but the rules.
type Hub struct {
	mu sync.Mutex

	guessFrom time.Time // start of the minute wrong join codes are being counted in
	guesses   int

	r     *shared.Rules
	cfg   HubConfig
	ctx   context.Context
	rooms map[string]*held
	made  uint64
	open  *Room // the room of Phase 0: no code, no seats; only without an agent key
}

type held struct {
	rm   *Room
	stop context.CancelFunc
}

// NewHub starts a hub whose rooms tick until ctx ends.
func NewHub(ctx context.Context, r *shared.Rules, cfg HubConfig) (*Hub, error) {
	if cfg.Interval <= 0 {
		cfg.Interval = time.Second / time.Duration(r.TickRate)
	}
	if cfg.IdleAfter <= 0 {
		cfg.IdleAfter = 10 * time.Minute
	}
	if cfg.MaxRooms <= 0 {
		cfg.MaxRooms = 32
	}
	h := &Hub{r: r, cfg: cfg, ctx: ctx, rooms: map[string]*held{}}
	if cfg.AgentKey == "" {
		// The trusting mode of a server only this machine can reach: /ws with no room
		// lands here and anyone may command a side, which tests and scripts rely on.
		rm, err := New(r, Config{
			Seed: cfg.Seed, Factions: cfg.Factions, LengthSeconds: cfg.LengthSeconds,
			Bots: [2]string{"", cfg.Bot}, Opponent: OpponentBot, Watch: true,
		})
		if err != nil {
			return nil, err
		}
		h.open, h.made = rm, 1
		go rm.Run(ctx, cfg.Interval)
	}
	go h.sweepLoop()
	return h, nil
}

// Options are a player's choices when making a match.
type Options struct {
	Opponent      string // OpponentBot or OpponentFriend
	Side          int    // the maker's side, -1 for either
	LengthSeconds int    // 0 for the server's default
	Watch         bool   // let spectators in
	Bot           string // how hard the scripted enemy presses, "" for the server's usual
}

// A lesson lasts as long as its learner needs, within what a match may; and only so many
// run at once, since anyone can start one.
const (
	lessonSeconds = 1800
	maxLessons    = 8
)

// BotLevels are the scripted enemies a player may choose in the lobby, easiest first.
// The rush style stays a server flag: it is a test opponent, not a difficulty.
var BotLevels = []string{bot.Easy, bot.Normal, bot.Standard}

func botLevel(style string) bool {
	for _, l := range BotLevels {
		if l == style {
			return true
		}
	}
	return false
}

// usualBot is the level the lobby starts on: the server's own when it is one of the
// levels, otherwise the easiest.
func (h *Hub) usualBot() string {
	if botLevel(h.cfg.Bot) {
		return h.cfg.Bot
	}
	return bot.Easy
}

// Create makes a room and seats its maker. It returns the room, the maker's side and
// the token of that seat.
func (h *Hub) Create(o Options) (*Room, int, string, error) {
	if o.Opponent != OpponentBot && o.Opponent != OpponentFriend {
		return nil, 0, "", errors.New(`opponent must be "bot" or "friend"`)
	}
	if o.LengthSeconds != 0 && (o.LengthSeconds < 120 || o.LengthSeconds > 1800) {
		return nil, 0, "", errors.New("a match lasts 2 to 30 minutes")
	}
	if o.Side < -1 || o.Side > 1 {
		return nil, 0, "", errors.New("side must be 0, 1 or -1 for either")
	}
	lesson := o.Bot == bot.Tutorial && o.Opponent == OpponentBot
	if o.Bot != "" && !botLevel(o.Bot) && !lesson {
		return nil, 0, "", errors.New("the scripted enemy is easy, normal or standard")
	}
	if o.Side == -1 {
		var b [1]byte
		if _, err := rand.Read(b[:]); err != nil {
			return nil, 0, "", err
		}
		o.Side = int(b[0] & 1)
	}
	length := o.LengthSeconds
	if length == 0 {
		length = h.cfg.LengthSeconds
	}
	if lesson {
		length, o.Watch = lessonSeconds, false // nobody is hurried, and nobody watches
	}
	cfg := Config{
		Factions: h.cfg.Factions, LengthSeconds: length, Seats: true,
		Opponent: o.Opponent, Watch: o.Watch, AgentKey: h.cfg.AgentKey, Tutorial: lesson,
	}
	if lesson {
		cfg.Bots[1-o.Side] = bot.Tutorial // also on a server started without a scripted enemy
	}
	if o.Opponent == OpponentBot && h.cfg.Bot != "" && !lesson {
		// A server started without a scripted enemy has none to choose a level of.
		cfg.Bots[1-o.Side] = h.cfg.Bot
		if o.Bot != "" {
			cfg.Bots[1-o.Side] = o.Bot
		}
	}

	h.mu.Lock()
	lessons := 0
	for _, e := range h.rooms {
		if e.rm.cfg.Tutorial {
			lessons++
		}
	}
	// Lessons are open to anyone, so they get a share of the rooms and no more.
	if len(h.rooms) >= h.cfg.MaxRooms || (lesson && lessons >= maxLessons) {
		h.mu.Unlock()
		return nil, 0, "", ErrFull
	}
	code, err := h.freeCode()
	if err != nil {
		h.mu.Unlock()
		return nil, 0, "", err
	}
	cfg.Code, cfg.Seed = code, h.cfg.Seed+h.made
	rm, err := New(h.r, cfg)
	if err != nil {
		h.mu.Unlock()
		return nil, 0, "", err
	}
	h.made++
	ctx, stop := context.WithCancel(h.ctx)
	h.rooms[code] = &held{rm: rm, stop: stop}
	h.mu.Unlock()

	go rm.Run(ctx, h.cfg.Interval)
	side, token, err := rm.Sit(o.Side)
	if err != nil {
		h.drop(code)
		return nil, 0, "", err
	}
	log.Printf("room %s: made, against a %s, seed %d", code, o.Opponent, cfg.Seed)
	return rm, side, token, nil
}

// Letters and digits that are not mistaken for one another when read aloud or typed.
const codeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

func (h *Hub) freeCode() (string, error) {
	for try := 0; try < 20; try++ {
		raw := make([]byte, 5)
		if _, err := rand.Read(raw); err != nil {
			return "", err
		}
		for i, b := range raw {
			raw[i] = codeAlphabet[int(b)%len(codeAlphabet)]
		}
		if _, taken := h.rooms[string(raw)]; !taken {
			return string(raw), nil
		}
	}
	return "", errors.New("could not make a join code")
}

// Room finds a room by its code, in any letter case. The empty code is the open room,
// when the server has one.
func (h *Hub) Room(code string) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()
	if code == "" {
		return h.open
	}
	if e := h.rooms[strings.ToUpper(strings.TrimSpace(code))]; e != nil {
		return e.rm
	}
	return nil
}

func (h *Hub) drop(code string) {
	h.mu.Lock()
	e := h.rooms[code]
	delete(h.rooms, code)
	h.mu.Unlock()
	if e != nil {
		e.stop()
		e.rm.Close()
	}
}

// Sweep drops the rooms nobody has been in for longer than the hub allows.
func (h *Hub) Sweep() {
	h.mu.Lock()
	var gone []string
	for code, e := range h.rooms {
		if e.rm.quietFor() > h.cfg.IdleAfter {
			gone = append(gone, code)
		}
	}
	h.mu.Unlock()
	for _, code := range gone {
		h.drop(code)
		log.Printf("room %s: dropped, nobody was in it", code)
	}
}

func (h *Hub) sweepLoop() {
	every := h.cfg.IdleAfter / 4
	if every > 30*time.Second {
		every = 30 * time.Second
	}
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-h.ctx.Done():
			return
		case <-t.C:
			h.Sweep()
		}
	}
}

// AgentWork is one room and the sides in it whose agents should be running.
type AgentWork struct {
	Room  string `json:"room"`
	Sides []int  `json:"sides"`
}

// AgentWork lists what the agent host should be serving right now.
func (h *Hub) AgentWork() []AgentWork {
	h.mu.Lock()
	rooms := make(map[string]*Room, len(h.rooms)+1)
	for code, e := range h.rooms {
		rooms[code] = e.rm
	}
	if h.open != nil {
		rooms[""] = h.open // listed under the empty code while someone commands in it
	}
	h.mu.Unlock()
	work := []AgentWork{}
	for code, rm := range rooms {
		if rm.cfg.Tutorial {
			continue // a lesson's squads think in the learner's browser, never here
		}
		if sides := rm.agentSides(agentGrace); len(sides) > 0 {
			work = append(work, AgentWork{Room: code, Sides: sides})
		}
	}
	sort.Slice(work, func(i, j int) bool { return work[i].Room < work[j].Room })
	return work
}

// ---- HTTP ----

// Routes adds the hub's endpoints to a mux:
//
//	GET  /ws                       a connection to a room (see Room.ServeWS)
//	GET  /api/server               what the lobby offers: factions, scripted enemy, share address
//	POST /api/rooms                make a match and take a seat: {opponent, side, length, watch, bot}
//	GET  /api/rooms/{code}         a match's lobby
//	POST /api/rooms/{code}/seat    take a seat in a match
//	GET  /internal/rooms           for the agent host: which sides need agents
//	GET  /internal/tier            for the model relay: a squad's brain tier
func (h *Hub) Routes(mux *http.ServeMux) {
	mux.HandleFunc("/ws", h.serveWS)
	mux.HandleFunc("GET /api/server", h.getServer)
	mux.HandleFunc("POST /api/rooms", h.postRoom)
	mux.HandleFunc("GET /api/rooms/{code}", h.getRoom)
	mux.HandleFunc("POST /api/rooms/{code}/seat", h.postSeat)
	mux.HandleFunc("GET /internal/rooms", h.internal(h.getWork))
	mux.HandleFunc("GET /internal/tier", h.internal(h.getTier))
}

func (h *Hub) serveWS(w http.ResponseWriter, r *http.Request) {
	rm := h.Room(r.URL.Query().Get("room"))
	if rm == nil {
		// Answer over the socket, so that a page can read why.
		if conn, err := websocket.Accept(w, r, nil); err == nil {
			conn.Close(websocket.StatusPolicyViolation, ErrNoRoom.Error())
		}
		return
	}
	rm.ServeWS(w, r)
}

func (h *Hub) share(code string) string {
	if h.cfg.Share == "" {
		return ""
	}
	return strings.TrimRight(h.cfg.Share, "/") + "/?room=" + code
}

// getServer tells the lobby what it can offer before any room exists.
func (h *Hub) getServer(w http.ResponseWriter, _ *http.Request) {
	length := h.cfg.LengthSeconds
	if length == 0 {
		length = h.r.Match.LengthSeconds
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"factions": h.cfg.Factions, // side 0, side 1
		"bot":      h.cfg.Bot != "",
		"levels":   BotLevels,    // the scripted enemies on offer, easiest first
		"level":    h.usualBot(), // the one the lobby starts on
		"length":   length,
		"share":    strings.TrimRight(h.cfg.Share, "/"),
		"open":     h.open != nil,       // the open room of a server without an agent key
		"locked":   h.cfg.HostKey != "", // making a match needs the host's password
	})
}

func (h *Hub) postRoom(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Opponent string `json:"opponent"`
		Side     *int   `json:"side"`
		Length   int    `json:"length"`
		Watch    bool   `json:"watch"`
		Bot      string `json:"bot"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	// On a server that strangers can reach, only the host may start matches: each one
	// runs agents on the host's machine.
	// A lesson is the exception: it runs no agents on this machine (see Config.Tutorial).
	lesson := in.Bot == bot.Tutorial && in.Opponent == OpponentBot
	if key := h.cfg.HostKey; key != "" && !lesson && subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Callsign-Host")), []byte(key)) != 1 {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": ErrHostOnly.Error()})
		return
	}
	o := Options{Opponent: in.Opponent, Side: -1, LengthSeconds: in.Length, Watch: in.Watch, Bot: in.Bot}
	if in.Side != nil {
		o.Side = *in.Side
	}
	rm, side, token, err := h.Create(o)
	switch {
	case errors.Is(err, ErrFull):
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": err.Error()})
	case err != nil:
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
	default:
		l := rm.Lobby()
		writeJSON(w, http.StatusCreated, map[string]any{"room": l.Room, "side": side, "token": token, "share": h.share(l.Room), "lobby": l})
	}
}

// wrongCode answers a join code that names no match, and slows down whoever is guessing.
func (h *Hub) wrongCode(w http.ResponseWriter) {
	h.mu.Lock()
	now := time.Now()
	if now.Sub(h.guessFrom) > time.Minute {
		h.guessFrom, h.guesses = now, 0
	}
	h.guesses++
	over := h.guesses > guessesPerMinute
	h.mu.Unlock()
	if over {
		writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": ErrGuessing.Error()})
		return
	}
	writeJSON(w, http.StatusNotFound, map[string]any{"error": ErrNoRoom.Error()})
}

func (h *Hub) getRoom(w http.ResponseWriter, r *http.Request) {
	rm := h.Room(r.PathValue("code"))
	if rm == nil || r.PathValue("code") == "" {
		h.wrongCode(w)
		return
	}
	l := rm.Lobby()
	writeJSON(w, http.StatusOK, map[string]any{"share": h.share(l.Room), "lobby": l})
}

func (h *Hub) postSeat(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Side *int `json:"side"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	rm := h.Room(r.PathValue("code"))
	if rm == nil {
		h.wrongCode(w)
		return
	}
	want := -1
	if in.Side != nil {
		want = *in.Side
	}
	side, token, err := rm.Sit(want)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error()})
		return
	}
	l := rm.Lobby()
	writeJSON(w, http.StatusOK, map[string]any{"room": l.Room, "side": side, "token": token, "share": h.share(l.Room), "lobby": l})
}

// internal guards the endpoints meant for this server's own agent host and model relay:
// with an agent key set they must show it as "Authorization: Bearer <key>".
func (h *Hub) internal(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if key := h.cfg.AgentKey; key != "" {
			got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if subtle.ConstantTimeCompare([]byte(key), []byte(got)) != 1 {
				writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "the agent key is needed here"})
				return
			}
		}
		next(w, r)
	}
}

func (h *Hub) getWork(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"rooms": h.AgentWork()})
}

// getTier answers the model relay: /internal/tier?room=<code>&side=<0|1>&squad=<id> with
// the player's seat token in the X-Callsign-Seat header. Squad 0 is the operator. In a
// room with seats the token must hold that side's seat: a thought is only ever paid for
// by the commander it serves. The open room of a server without an agent key has no seats.
func (h *Hub) getTier(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	rm := h.Room(q.Get("room"))
	if rm == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": ErrNoRoom.Error()})
		return
	}
	side, errSide := strconv.Atoi(q.Get("side"))
	squad, _ := strconv.Atoi(q.Get("squad"))
	if errSide != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "side must be 0 or 1"})
		return
	}
	if rm.Seated() && !rm.Holds(side, r.Header.Get("X-Callsign-Seat")) {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": ErrNoSeat.Error()})
		return
	}
	tier, ok := rm.Tier(side, squad)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "no such squad on that side"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tier": tier, "operator": squad == 0})
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	body := http.MaxBytesReader(w, r.Body, 1<<10)
	if err := json.NewDecoder(body).Decode(v); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "the request is not the JSON this endpoint takes"})
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	w.Write(encode(v))
}
