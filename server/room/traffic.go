package room

import (
	"strconv"

	"callsign/server/radio"
	"callsign/server/sim"
)

// Keeping the net quiet. Three things, all of them plain code over what the room already
// knows (who speaks to whom, which event woke a squad, which enemy a squad sees):
//
//   - Every transmission is given a kind, a net and a level. The commander's page shows a
//     line on the command net when its level is within the "radio traffic" the player
//     chose (1 quiet, 2 normal, 3 full), and only those lines are spoken. What squads say
//     to the operator and to each other is on the squad net, which is read and never heard.
//   - One report per event. When several squads of a side meet the same enemy, or reach
//     the same place, within radio.traffic.reportWindow seconds, the first squad's leader
//     is the one that reports: the others' events are marked `known`, so their agents need
//     not think at all, and a report of theirs that is sent anyway is dropped here.
//   - A bare "Roger" from the operator to a squad is not transmitted: a report needs no
//     acknowledgement, and the squad's leader would be woken to read it.
//
// A squad that Hammer ordered by name is Hammer's until the operator tasks it by name or
// Hammer hands the operator the fight afresh: it is never silenced, whatever it tells
// Hammer is shown at every level, and the operator is told which squads those are.
const (
	NetCommand = "command" // to or from Hammer, or to all stations
	NetSquad   = "squad"   // squads and the operator among themselves

	KindOrder     = "order"     // Hammer's own transmission
	KindAnswer    = "answer"    // a station's reply to Hammer's call
	KindAsk       = "ask"       // the operator asking Hammer something
	KindCue       = "cue"       // a fixed line the game wrote (cues.go), and the sign-off
	KindLoss      = "loss"      // a squad that can hardly fight on
	KindContact   = "contact"   // the enemy met
	KindObjective = "objective" // a place reached
	KindNotice    = "notice"    // what the operator bought or built on its own; its cue says when it is ready
	KindStatus    = "status"    // routine
	KindAck       = "ack"       // Roger or Wilco and nothing else
)

// tagged are the kinds an agent may give its own transmission with the radio tool.
var tagged = map[string]bool{KindContact: true, KindObjective: true, KindLoss: true, KindStatus: true, KindAck: true}

// A notice is the event that last woke a squad's leader: what its next line is about.
type notice struct {
	kind string // what a report of it is: contact, objective, loss, status
	key  string // what it is about, the same for every squad that meets it; "" for its own affair
	tick int
}

type sighting struct {
	tick  int
	squad int // the first squad whose event had this key
}

// traffic is what one side's net remembers in order to stay quiet.
type traffic struct {
	pending map[int]notice      // squad id → the event its leader was last woken by
	noticed map[string]sighting // report key → who met it first, and when
	called  map[string]int      // station key → tick of Hammer's last call to it
	hammers map[int]bool        // squads Hammer ordered by name, until the operator tasks them
}

func newTraffic() traffic {
	return traffic{pending: map[int]notice{}, noticed: map[string]sighting{}, called: map[string]int{}, hammers: map[int]bool{}}
}

func (rm *Room) seconds(s float64) int { return int(s * float64(rm.r.TickRate)) }

// noticeOf says what a squad's report of an event would be, and the key it shares with
// every other squad's report of the same thing.
func noticeOf(e sim.Event) (kind, key string, ok bool) {
	switch e.Kind {
	case sim.EvContact:
		return KindContact, "contact:" + strconv.Itoa(e.Contact), true
	case sim.EvArrived, sim.EvGarrisoned:
		at := e.Structure
		if at == "" {
			at = e.Place
		}
		if at == "" {
			at = e.Point
		}
		return KindObjective, "at:" + at, true
	case sim.EvLosses:
		if e.Count <= 1 {
			return KindLoss, "", true // down to its last fireteam
		}
		return KindStatus, "", true
	case sim.EvPinned, sim.EvFortified, sim.EvChargePlanted, sim.EvCrushed, sim.EvOverhead, sim.EvRearmed:
		return KindStatus, "", true
	case sim.EvStrike, sim.EvSalvo:
		return KindObjective, "", true // a strike aircraft's bombs have fallen (sim/sortie.go), or a salvo was fired (sim/salvo.go)
	}
	return "", "", false
}

// heardEvent notes an event that wakes a squad's leader, and reports whether another
// squad of the side met the same thing first and recently: its leader has it to report,
// so this one need not. A squad Hammer ordered by name is never told so.
func (rm *Room) heardEvent(e sim.Event) (known bool) {
	if e.Side < 0 || e.Side > 1 || e.Squad == 0 {
		return false
	}
	kind, key, ok := noticeOf(e)
	if !ok {
		return false
	}
	t := &rm.traffic[e.Side]
	t.pending[e.Squad] = notice{kind: kind, key: key, tick: e.Tick}
	if key == "" {
		return false
	}
	keys := []string{key}
	if e.Kind == sim.EvContact {
		// Squads that move together meet a group together: every enemy this squad has in
		// sight is covered by its one report.
		if sq := rm.sim.SquadAny(e.Squad); sq != nil {
			for _, id := range sq.Contacts {
				if id != e.Contact {
					keys = append(keys, "contact:"+strconv.Itoa(id))
				}
			}
		}
	}
	window := rm.seconds(rm.r.Radio.Traffic.ReportWindow)
	first, seen := t.noticed[key]
	known = seen && first.squad != e.Squad && e.Tick-first.tick <= window
	for _, k := range keys {
		if s, ok := t.noticed[k]; !ok || e.Tick-s.tick > window {
			t.noticed[k] = sighting{tick: e.Tick, squad: e.Squad}
		}
	}
	return known && !t.hammers[e.Squad]
}

// placed is where a transmission belongs and what, if anything, stops it.
type placed struct {
	kind, net string
	level     int
	dropped   string // why it is not sent at all, "" when it is
}

// classify gives a transmission its kind, net and level. `tag` is the kind the sender
// gave it with the radio tool, "" for none.
func (rm *Room) classify(side int, from radio.Station, p radio.Parsed, tag string) placed {
	t := &rm.traffic[side]
	now := rm.sim.Tick
	levels := rm.r.Radio.Traffic.Levels
	toHammer, toSquad := false, false
	for _, st := range p.To {
		toHammer = toHammer || st.Kind == radio.Player || st.Kind == radio.All
		toSquad = toSquad || st.Kind == radio.Squad
	}
	if from.Kind == radio.Player {
		return placed{kind: KindOrder, net: NetCommand, level: levels[KindOrder]}
	}
	bare := rm.net.BareAck(p.Body)
	if from.Kind == radio.Operator && bare && !toHammer {
		return placed{dropped: "not sent: a report needs no acknowledgement"}
	}

	// What the line is about: the event that woke this squad, when it is still news.
	var ev notice
	fresh, hammers := false, false
	if from.Kind == radio.Squad {
		if sq := rm.squadOf(side, from); sq != nil {
			ev, fresh = t.pending[sq.ID]
			fresh = fresh && now-ev.tick <= rm.seconds(rm.r.Radio.Traffic.EventSeconds)
			hammers = t.hammers[sq.ID]
			if first, seen := t.noticed[ev.key]; fresh && ev.key != "" && seen && first.squad != sq.ID &&
				ev.tick-first.tick <= rm.seconds(rm.r.Radio.Traffic.ReportWindow) && !(hammers && toHammer) {
				return placed{dropped: "not sent: another squad has already reported this"}
			}
		}
	}
	// Whether Hammer called this station just now, by name or with all stations.
	answers := false
	for _, key := range []string{from.Key(), radio.All} {
		if at, ok := t.called[key]; ok && now-at <= rm.seconds(rm.r.Radio.Traffic.AnswerSeconds) {
			answers = true
		}
	}

	kind := KindStatus
	switch {
	case bare && answers && toHammer:
		kind = KindAnswer
	case bare:
		kind = KindAck
	case (tagged[tag] && tag != KindAck) || tag == KindNotice:
		kind = tag
	case fresh:
		kind = ev.kind
	case answers && toHammer:
		kind = KindAnswer
	case from.Kind == radio.Operator && toHammer && p.End == radio.Over:
		kind = KindAsk
	}
	if answers && toHammer && kind == KindStatus && !fresh {
		kind = KindAnswer // a routine line right after Hammer's call is the reply to it
	}
	if !toHammer {
		return placed{kind: kind, net: NetSquad, level: 3}
	}
	level := levels[kind]
	if hammers {
		level = 1
	}
	return placed{kind: kind, net: NetCommand, level: level}
}

// noteCall records who a commander's transmission was for: Hammer's call opens the time
// in which the station's line is the answer, a squad named by Hammer is Hammer's, and a
// squad the operator names is the operator's again. A call also ends the news of whatever
// woke the squad before it: what the squad says next answers the call.
func (rm *Room) noteCall(side int, from radio.Station, to []radio.Station) {
	if from.Kind != radio.Player && from.Kind != radio.Operator {
		return
	}
	t := &rm.traffic[side]
	for _, st := range to {
		if from.Kind == radio.Player {
			t.called[st.Key()] = rm.sim.Tick
		}
		if st.Kind == radio.All {
			for id := range t.pending {
				delete(t.pending, id)
			}
		}
		if st.Kind != radio.Squad {
			continue
		}
		if sq := rm.squadOf(side, st); sq != nil {
			delete(t.pending, sq.ID)
			if from.Kind == radio.Player {
				t.hammers[sq.ID] = true
			} else {
				delete(t.hammers, sq.ID)
			}
		}
	}
}

// hammersSquads lists, by English callsign and in id order, the living squads Hammer
// ordered by name.
func (rm *Room) hammersSquads(side int) []string {
	out := []string{}
	for _, sq := range rm.sim.Squads {
		if sq.Alive && sq.Side == side && rm.traffic[side].hammers[sq.ID] {
			out = append(out, rm.squadName(sq).En)
		}
	}
	return out
}

// cueLevel is the least radio traffic level that shows a base cue.
func (rm *Room) cueLevel(key string) int {
	if l := rm.r.Radio.Cues[key].Level; l > 0 {
		return l
	}
	return rm.r.Radio.Traffic.Levels[KindCue]
}
