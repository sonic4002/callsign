package room

import "errors"

// RoleHost is the control connection of an agent host: the program that runs a side's
// operator and squad leaders. It only listens (which squads exist, when the match
// restarts) and holds the side's claim.
//
// Several hosts may be connected for one side, for example the agents on the server
// machine and the player's own browser. Only one of them is active: the one with the
// highest rank, and among equals the one that came first. The others stand by and take
// over when it leaves. A host learns where it stands from the "active" field of the
// greeting, which is sent again whenever that changes.
const RoleHost = "host"

// Ranks a host can claim with. The player's own browser outranks agents run for them.
const (
	RankServer  = 1
	RankBrowser = 2
)

// ErrNotActiveHost refuses an agent that belongs to a host standing by.
var ErrNotActiveHost = errors.New("another host runs this side's agents")

// hostOf picks the host that should be running a side's agents, or nil.
func (rm *Room) hostOf(side int) *Client {
	var best *Client
	for c := range rm.clients {
		if c.ID.Role != RoleHost || c.ID.Side != side {
			continue
		}
		if best == nil || c.ID.Rank > best.ID.Rank || (c.ID.Rank == best.ID.Rank && c.joined < best.joined) {
			best = c
		}
	}
	return best
}

// rehost settles who runs a side's agents after a host joined or left. The agents of a
// host that lost the side are disconnected, and both hosts are greeted again so each
// knows where it stands. `joining` is greeted by Join itself.
func (rm *Room) rehost(side int, joining *Client) {
	old, now := rm.host[side], rm.hostOf(side)
	if old == now {
		return
	}
	rm.host[side] = now
	if old != nil {
		for c := range rm.clients {
			if c.ID.Side == side && c.ID.Host == old.ID.Host && (c.ID.Role == RoleAnvil || c.ID.Role == RoleSquad) {
				rm.drop(c)
			}
		}
		if !old.closed {
			rm.send(old, rm.hello(old))
		}
	}
	if now != nil && now != joining {
		rm.send(now, rm.hello(now))
	}
}

// admits reports whether an agent connection may take its seat: agents that name a host
// must belong to the active one. Agents that name none are not managed by any host.
func (rm *Room) admits(id Identity) bool {
	if id.Host == "" || (id.Role != RoleAnvil && id.Role != RoleSquad) {
		return true
	}
	h := rm.host[id.Side]
	return h != nil && h.ID.Host == id.Host
}
