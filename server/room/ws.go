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
//	{"type":"ready","ready":true}
//	{"type":"leave"}
type inbound struct {
	Type   string          `json:"type"`
	Text   string          `json:"text"`
	Strict int             `json:"strict"` // radio frames: 1 relaxed (default), 2 standard, 3 strict
	ID     int             `json:"id"`
	Name   string          `json:"name"`
	Args   json.RawMessage `json:"args"`
	Ready  *bool           `json:"ready"` // ready frames; absent means true
}

// ServeWS is the WebSocket endpoint of one room. The Hub picks the room by ?room=<code>.
//
//	/ws?room=<code>&side=0&role=hammer|anvil|squad|spectator&squad=<id>&state=0|1&token=<seat token>&key=<agent key>
//
// There are no accounts. In a room with seats a Hammer is whoever holds that seat's
// token; agents show the server's agent key or their commander's seat token. The role
// still limits what a connection can do, and every action is checked by the simulation.
func (rm *Room) ServeWS(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	side, _ := strconv.Atoi(q.Get("side"))
	squad, _ := strconv.Atoi(q.Get("squad"))
	id := Identity{Side: side, Role: q.Get("role"), Squad: squad}
	if id.Role == "" {
		id.Role = RoleHammer
	}
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	c, err := rm.Enter(id, Auth{Token: q.Get("token"), Key: q.Get("key")}, q.Get("state") != "0")
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
	case "ready":
		if err := rm.Ready(c, in.Ready == nil || *in.Ready); err != nil {
			rm.reply(c, map[string]any{"type": "refused", "reason": err.Error()})
		}
	case "leave":
		if err := rm.Stand(c); err != nil {
			rm.reply(c, map[string]any{"type": "refused", "reason": err.Error()})
		}
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
