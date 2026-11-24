package room

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/coder/websocket"
)

// inbound is a frame from a client.
//
//	{"type":"radio","text":"Viper 2, this is Hammer. Hold Foxtrot. Over.","strict":1}
//	{"type":"tool","id":7,"name":"hold","args":{"point":"F"}}
//	{"type":"restart"}
type inbound struct {
	Type   string          `json:"type"`
	Text   string          `json:"text"`
	Strict int             `json:"strict"` // radio frames: 1 relaxed (default), 2 standard, 3 strict
	ID     int             `json:"id"`
	Name   string          `json:"name"`
	Args   json.RawMessage `json:"args"`
}

// ServeWS is the WebSocket endpoint: /ws?side=0&role=hammer|anvil|squad|spectator|host&squad=<id>&state=0|1
// Agent hosts add host=<id> (and rank=<n> on their own connection); see host.go.
//
// Phase 0 has no accounts: a client is whoever it says it is. The role still limits what
// that connection can do, and every action is checked by the simulation.
func (rm *Room) ServeWS(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	side, _ := strconv.Atoi(q.Get("side"))
	squad, _ := strconv.Atoi(q.Get("squad"))
	rank, _ := strconv.Atoi(q.Get("rank"))
	id := Identity{Side: side, Role: q.Get("role"), Squad: squad, Host: q.Get("host"), Rank: rank}
	if id.Role == "" {
		id.Role = RoleHammer
	}
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	c, err := rm.Join(id, q.Get("state") != "0")
	if err != nil {
		conn.Close(websocket.StatusPolicyViolation, err.Error())
		return
	}
	defer rm.Leave(c)
	ctx := r.Context()

	go func() {
		for frame := range c.Out {
			if conn.Write(ctx, websocket.MessageText, frame) != nil {
				break
			}
		}
		conn.Close(websocket.StatusNormalClosure, "")
	}()

	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		var in inbound
		if json.Unmarshal(data, &in) != nil {
			rm.reply(c, map[string]any{"type": "refused", "reason": "not a JSON frame"})
			continue
		}
		rm.handle(c, in)
	}
}

func (rm *Room) handle(c *Client, in inbound) {
	switch in.Type {
	case "radio":
		if _, err := rm.SayAt(c, in.Text, in.Strict); err != nil {
			rm.reply(c, map[string]any{"type": "refused", "text": in.Text, "reason": err.Error()})
		}
	case "tool":
		res := map[string]any{"type": "result", "id": in.ID, "ok": true}
		if data, err := rm.Tool(c, in.Name, in.Args); err != nil {
			res["ok"], res["error"] = false, err.Error()
		} else {
			res["data"] = data
		}
		rm.reply(c, res)
	case "restart":
		if err := rm.Restart(c); err != nil {
			rm.reply(c, map[string]any{"type": "refused", "reason": err.Error()})
		}
	default:
		rm.reply(c, map[string]any{"type": "refused", "reason": "unknown frame type " + strconv.Quote(in.Type)})
	}
}

func (rm *Room) reply(c *Client, v any) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.send(c, encode(v))
}
