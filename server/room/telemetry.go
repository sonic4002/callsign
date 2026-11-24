package room

import (
	"bytes"
	"encoding/json"
	"errors"
	"time"

	"callsign/server/radio"
)

var operatorStation = radio.Station{Kind: radio.Operator}

// Telemetry is what a side's agents say about themselves for their own commander's "AI"
// view: which model thinks for a station, how big its context is, what it is doing now.
// An agent sends {"type":"telemetry","telemetry":{…}} on the connection it already has.
//
// The room only relays. It keeps the latest report per station, passes it to that side's
// commander connections and to nobody else (not the other side, not spectators, not other
// agents), and forgets it when the squad is lost or the match ends. It never reads the
// report: nothing an agent says about itself can change the game.

const (
	telemetryMax   = 4096                  // bytes in one report
	telemetryBurst = 8                     // reports one connection may send at once
	telemetryGap   = 50 * time.Millisecond // and the time that earns it one more
)

var (
	ErrNotAnAgent   = errors.New("only an operator or squad leader agent reports telemetry")
	ErrBadTelemetry = errors.New("telemetry is one JSON object of at most 4 KB")
)

// agentReport is the latest report of one station.
type agentReport struct {
	from   *Client // the connection it came from; nil once that connection is gone
	raw    json.RawMessage
	online bool
}

// AgentView is one station's report as its commander's page receives it.
type AgentView struct {
	Squad     int             `json:"squad"`               // 0 is the operator
	Station   *Name           `json:"station,omitempty"`   // the station's callsign
	Online    bool            `json:"online"`              // its agent is connected now
	Gone      bool            `json:"gone,omitempty"`      // the squad is lost: drop the row
	Telemetry json.RawMessage `json:"telemetry,omitempty"` // the agent's own words, unread
}

// Report takes one agent's report and passes it to its side's commander.
func (rm *Room) Report(c *Client, raw json.RawMessage) error {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if c.closed || (c.ID.Role != RoleAnvil && c.ID.Role != RoleSquad) {
		return ErrNotAnAgent
	}
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || len(raw) > telemetryMax || raw[0] != '{' || !json.Valid(raw) {
		return ErrBadTelemetry
	}
	// An agent may say several things in one breath (it thought, it acted, it is idle),
	// and the last of them matters most; one that floods is not answered and not relayed.
	now := time.Now()
	c.allowance = min(telemetryBurst, c.allowance+float64(now.Sub(c.told))/float64(telemetryGap))
	c.told = now
	if c.allowance < 1 {
		return nil
	}
	c.allowance--
	if rm.sim.Over {
		return nil // the match is over: nothing is kept any more
	}
	squad := 0
	if c.ID.Role == RoleSquad {
		squad = c.ID.Squad
	}
	if rm.tele[c.ID.Side] == nil {
		rm.tele[c.ID.Side] = map[int]*agentReport{}
	}
	rep := &agentReport{from: c, raw: append(json.RawMessage{}, raw...), online: true}
	rm.tele[c.ID.Side][squad] = rep
	rm.tellAgents(c.ID.Side, rm.agentView(c.ID.Side, squad, rep))
	return nil
}

func (rm *Room) agentView(side, squad int, rep *agentReport) AgentView {
	v := AgentView{Squad: squad, Online: rep.online, Telemetry: rep.raw}
	if squad == 0 {
		n := rm.name(operatorStation, side)
		v.Station = &n
	} else if sq := rm.sim.Squad(squad); sq != nil {
		n := rm.squadName(sq)
		v.Station = &n
	}
	return v
}

// agentViews lists a side's reports for a commander who has just joined.
func (rm *Room) agentViews(side int) []AgentView {
	out := []AgentView{}
	for _, squad := range sortedSquads(rm.tele[side]) {
		out = append(out, rm.agentView(side, squad, rm.tele[side][squad]))
	}
	return out
}

func sortedSquads(m map[int]*agentReport) []int {
	ids := make([]int, 0, len(m))
	for id := range m {
		ids = append(ids, id)
	}
	for i := 1; i < len(ids); i++ {
		for j := i; j > 0 && ids[j] < ids[j-1]; j-- {
			ids[j], ids[j-1] = ids[j-1], ids[j]
		}
	}
	return ids
}

// tellAgents sends one frame about a side's agents to that side's commanders only.
func (rm *Room) tellAgents(side int, v any) {
	frame := encode(map[string]any{"type": "telemetry", "agent": v})
	for c := range rm.clients {
		if c.ID.Role == RoleHammer && c.ID.Side == side {
			rm.send(c, frame)
		}
	}
}

// agentLeft marks the report of a connection that closed: the row stays, shown as offline,
// until another agent takes the station or the squad is lost.
func (rm *Room) agentLeft(c *Client) {
	if c.ID.Role != RoleAnvil && c.ID.Role != RoleSquad {
		return
	}
	squad := 0
	if c.ID.Role == RoleSquad {
		squad = c.ID.Squad
	}
	rep := rm.tele[c.ID.Side][squad]
	if rep == nil || rep.from != c {
		return
	}
	rep.from, rep.online = nil, false
	rm.tellAgents(c.ID.Side, rm.agentView(c.ID.Side, squad, rep))
}

// forgetAgent drops a lost squad's report and tells the commander to drop its row.
func (rm *Room) forgetAgent(side, squad int) {
	if _, ok := rm.tele[side][squad]; !ok {
		return
	}
	delete(rm.tele[side], squad)
	rm.tellAgents(side, AgentView{Squad: squad, Gone: true})
}

// forgetAgents drops every report: the match ended or a new one began. Each commander's
// page keeps what it last showed for as long as it likes; the room keeps nothing.
func (rm *Room) forgetAgents() {
	for side := range rm.tele {
		if len(rm.tele[side]) == 0 {
			continue
		}
		rm.tele[side] = nil
		frame := encode(map[string]any{"type": "telemetry", "ended": true})
		for c := range rm.clients {
			if c.ID.Role == RoleHammer && c.ID.Side == side {
				rm.send(c, frame)
			}
		}
	}
}
