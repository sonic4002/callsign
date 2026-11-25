package room

import (
	"encoding/json"
	"testing"

	"callsign/server/sim"
)

// squadsOf lists a side's fielded squads, in id order.
func squadsOf(rm *Room, side int) (out []*sim.Squad) {
	for _, sq := range rm.sim.Squads {
		if _, called := rm.r.Callsigns.Classes[sq.CallClass()]; called && sq.Alive && sq.Side == side {
			out = append(out, sq)
		}
	}
	return out
}

// sent calls the radio tool and returns what it answered.
func sent(t *testing.T, rm *Room, c *Client, args string) map[string]any {
	t.Helper()
	res, err := rm.Tool(c, ToolRadio, json.RawMessage(args))
	if err != nil {
		t.Fatalf("radio %s: %v", args, err)
	}
	return res.(map[string]any)
}

// meets raises the event the simulation raises when a squad's leader has news.
func meets(rm *Room, sq *sim.Squad, e sim.Event) bool {
	e.Side, e.Squad, e.Tick = sq.Side, sq.ID, rm.sim.Tick
	return rm.heardEvent(e)
}

func last(t *testing.T, rm *Room, side int) Message {
	t.Helper()
	log := rm.Log(side)
	if len(log) == 0 {
		t.Fatal("nothing on the net")
	}
	return log[len(log)-1]
}

func TestOneSquadReportsWhatSeveralMeet(t *testing.T) {
	rm := newRoom(t, Config{})
	join(t, rm, 0, RoleHammer, 0)
	sqs := squadsOf(rm, 0)
	if len(sqs) < 2 {
		t.Fatalf("need two squads, have %d", len(sqs))
	}
	a, b := sqs[0], sqs[1]
	la, lb := join(t, rm, 0, RoleSquad, a.ID), join(t, rm, 0, RoleSquad, b.ID)

	// The first squad to meet Target 54 has it to report; it also sees Target 55.
	a.Contacts = []int{54, 55}
	if meets(rm, a, sim.Event{Kind: sim.EvContact, Contact: 54}) {
		t.Fatal("the first squad to meet an enemy was told another had it")
	}
	// The others meet the same enemy, or one the first squad already had in sight.
	for _, id := range []int{54, 55} {
		if !meets(rm, b, sim.Event{Kind: sim.EvContact, Contact: id}) {
			t.Fatalf("a squad meeting Target %d, which another just met, was not told so", id)
		}
	}
	if got := sent(t, rm, la, `{"to":"Anvil","body":"Contact, Target 54 near Golf","end":"over"}`); got["sent"] == "" {
		t.Fatalf("the first report was dropped: %v", got)
	}
	before := len(rm.Log(0))
	if got := sent(t, rm, lb, `{"to":"Anvil","body":"Contact, Target 55 near Golf","end":"over"}`); got["sent"] != "" || got["dropped"] == nil {
		t.Fatalf("a second report of the same enemy went out: %v", got)
	}
	if len(rm.Log(0)) != before {
		t.Fatal("a dropped report reached the log")
	}
	// A different enemy is news again.
	if meets(rm, b, sim.Event{Kind: sim.EvContact, Contact: 70}) {
		t.Fatal("a new enemy was taken for a known one")
	}
	if got := sent(t, rm, lb, `{"to":"Anvil","body":"Contact, Target 70","end":"over"}`); got["sent"] == "" {
		t.Fatalf("a report of a new enemy was dropped: %v", got)
	}
	if m := last(t, rm, 0); m.Kind != KindContact || m.Net != NetSquad || m.Level != 3 {
		t.Fatalf("a contact report to the operator is %s on the %s net at level %d", m.Kind, m.Net, m.Level)
	}

	// The same place reached by a group is one report too.
	if meets(rm, a, sim.Event{Kind: sim.EvArrived, Point: "G"}) || !meets(rm, b, sim.Event{Kind: sim.EvArrived, Point: "G"}) {
		t.Fatal("arriving together was not one piece of news")
	}
	if meets(rm, b, sim.Event{Kind: sim.EvArrived, Point: "F"}) {
		t.Fatal("another place was taken for the same one")
	}

	// Once the window has passed the same enemy is news again.
	for i := 0; i < rm.seconds(rules.Radio.Traffic.ReportWindow)+1; i++ {
		rm.Tick()
	}
	if meets(rm, b, sim.Event{Kind: sim.EvContact, Contact: 54}) {
		t.Fatal("an enemy met long ago was still taken for known")
	}
	// What happens to one squad alone is never another's news.
	if meets(rm, a, sim.Event{Kind: sim.EvPinned, Point: "G"}) || meets(rm, b, sim.Event{Kind: sim.EvPinned, Point: "G"}) {
		t.Fatal("being pinned was folded into another squad's report")
	}
}

func TestASquadHammerOrderedIsNeverSilenced(t *testing.T) {
	rm := newRoom(t, Config{})
	hammer := join(t, rm, 0, RoleHammer, 0)
	anvil := join(t, rm, 0, RoleAnvil, 0)
	sqs := squadsOf(rm, 0)
	a, b := sqs[0], sqs[1]
	la, lb := join(t, rm, 0, RoleSquad, a.ID), join(t, rm, 0, RoleSquad, b.ID)
	nameB := rm.squadName(b).En

	if _, err := rm.Say(hammer, nameB+", this is Hammer. Hold Golf. Over."); err != nil {
		t.Fatal(err)
	}
	if m := last(t, rm, 0); m.Kind != KindOrder || m.Net != NetCommand || m.Level != 1 {
		t.Fatalf("Hammer's order is %s/%s/%d", m.Kind, m.Net, m.Level)
	}
	sent(t, rm, lb, `{"to":"Hammer","body":"Wilco","end":"out"}`)
	if m := last(t, rm, 0); m.Kind != KindAnswer || m.Level != 1 {
		t.Fatalf("the answer to Hammer's order is %s at level %d", m.Kind, m.Level)
	}

	meets(rm, a, sim.Event{Kind: sim.EvContact, Contact: 54})
	if meets(rm, b, sim.Event{Kind: sim.EvContact, Contact: 54}) {
		t.Fatal("a squad Hammer ordered was told to keep quiet")
	}
	sent(t, rm, la, `{"to":"Anvil","body":"Contact, Target 54","end":"over"}`)
	if got := sent(t, rm, lb, `{"to":"Hammer","body":"Contact, Target 54","end":"over"}`); got["sent"] == "" {
		t.Fatalf("Hammer's own squad was silenced: %v", got)
	}
	if m := last(t, rm, 0); m.Kind != KindContact || m.Net != NetCommand || m.Level != 1 {
		t.Fatalf("its contact report is %s/%s/%d, want contact on the command net at level 1", m.Kind, m.Net, m.Level)
	}

	// The operator tasking it by name takes it back: it is one of the group again.
	sent(t, rm, anvil, `{"to":"`+nameB+`","body":"Hold Foxtrot","end":"over"}`)
	meets(rm, a, sim.Event{Kind: sim.EvContact, Contact: 60})
	if !meets(rm, b, sim.Event{Kind: sim.EvContact, Contact: 60}) {
		t.Fatal("a squad the operator took back was still treated as Hammer's")
	}
}

func TestEveryLineHasAKindANetAndALevel(t *testing.T) {
	rm := newRoom(t, Config{})
	hammer := join(t, rm, 0, RoleHammer, 0)
	anvil := join(t, rm, 0, RoleAnvil, 0)
	sqs := squadsOf(rm, 0)
	a, b := sqs[0], sqs[1]
	la := join(t, rm, 0, RoleSquad, a.ID)
	nameA, nameB := rm.squadName(a).En, rm.squadName(b).En
	check := func(what, kind, net string, level int) {
		t.Helper()
		if m := last(t, rm, 0); m.Kind != kind || m.Net != net || m.Level != level {
			t.Fatalf("%s: %q is %s/%s/%d, want %s/%s/%d", what, m.Text, m.Kind, m.Net, m.Level, kind, net, level)
		}
	}

	// Nobody has ordered the squad: its reports go to Hammer by its kind's level.
	meets(rm, a, sim.Event{Kind: sim.EvContact, Contact: 9})
	sent(t, rm, la, `{"to":"Hammer","body":"Contact near Golf","end":"over"}`)
	check("a contact report", KindContact, NetCommand, 2)
	meets(rm, a, sim.Event{Kind: sim.EvArrived, Point: "G"})
	sent(t, rm, la, `{"to":"Hammer","body":"In position at Golf","end":"over"}`)
	check("an arrival", KindObjective, NetCommand, 2)
	meets(rm, a, sim.Event{Kind: sim.EvPinned, Point: "G"})
	sent(t, rm, la, `{"to":"Hammer","body":"Pinned at Golf","end":"over"}`)
	check("a routine report", KindStatus, NetCommand, 3)
	meets(rm, a, sim.Event{Kind: sim.EvLosses, Point: "G", Count: 1})
	sent(t, rm, la, `{"to":"Hammer","body":"Lost a team at Golf, 1 left","end":"over"}`)
	check("a squad nearly gone", KindLoss, NetCommand, 1)
	// The kind an agent gives its line stands when no event says otherwise.
	sent(t, rm, la, `{"to":"`+nameB+`","body":"Moving past you on the left","end":"out","kind":"status"}`)
	check("squad to squad", KindStatus, NetSquad, 3)
	for i := 0; i < rm.seconds(rules.Radio.Traffic.EventSeconds)+1; i++ {
		rm.Tick()
	}
	sent(t, rm, la, `{"to":"Hammer","body":"Two vehicles north of Golf","end":"over","kind":"contact"}`)
	check("a tagged line", KindContact, NetCommand, 2)
	sent(t, rm, la, `{"to":"Hammer","body":"Roger","end":"out"}`)
	check("a bare acknowledgement nobody asked for", KindAck, NetCommand, 3)

	// The operator: what it does on its own is a notice, a question needs Hammer, the
	// rest is routine; within a moment of Hammer's call, whatever it says is the answer.
	sent(t, rm, anvil, `{"to":"Hammer","body":"Massing at Golf before the attack","end":"out"}`)
	check("the operator's routine", KindStatus, NetCommand, 3)
	sent(t, rm, anvil, `{"to":"Hammer","body":"Attacking Zulu with 3 squads","end":"out","kind":"contact"}`)
	check("the operator's news of a fight", KindContact, NetCommand, 2)
	sent(t, rm, anvil, `{"to":"Hammer","body":"Gold is piling up, shall I buy armour?","end":"over"}`)
	check("the operator's question", KindAsk, NetCommand, 1)
	rm.tellHammer(0, "en", "Bought Rifle Squad, Viper 9 is deploying")
	check("a purchase of the operator's own", KindNotice, NetCommand, 3)
	sent(t, rm, anvil, `{"to":"`+nameA+`","body":"Hold Golf","end":"over"}`)
	check("the operator's task for a squad", KindStatus, NetSquad, 3)
	sent(t, rm, la, `{"to":"Anvil","body":"Wilco","end":"out"}`)
	check("a squad's Wilco to the operator", KindAck, NetSquad, 3)

	if _, err := rm.Say(hammer, "Anvil, this is Hammer. Report. Over."); err != nil {
		t.Fatal(err)
	}
	sent(t, rm, anvil, `{"to":"Hammer","body":"Four squads, two points held","end":"over"}`)
	check("the operator's answer", KindAnswer, NetCommand, 1)
	if _, err := rm.Say(hammer, "All stations, this is Hammer. Radio check. Over."); err != nil {
		t.Fatal(err)
	}
	sent(t, rm, la, `{"to":"Hammer","body":"Five by five","end":"out"}`)
	check("an answer to all stations", KindAnswer, NetCommand, 1)

	// A base cue carries its own level from the rules.
	rm.cue(0, "baseUnderAttack", nil)
	check("a base cue", KindCue, NetCommand, 1)
	rm.cue(0, "powerRestored", nil)
	check("a lesser cue", KindCue, NetCommand, 2)
}

func TestTheOperatorsBareRogerToASquadIsNotSent(t *testing.T) {
	rm := newRoom(t, Config{})
	hammer := join(t, rm, 0, RoleHammer, 0)
	anvil := join(t, rm, 0, RoleAnvil, 0)
	a := squadsOf(rm, 0)[0]
	la := join(t, rm, 0, RoleSquad, a.ID)
	name := rm.squadName(a).En
	drain(t, la)
	before := len(rm.Log(0))
	for _, body := range []string{"Roger", "Wilco", "רות", "רות, יבוצע"} {
		got := sent(t, rm, anvil, `{"to":"`+name+`","body":"`+body+`","end":"out"}`)
		if got["sent"] != "" || got["dropped"] == nil {
			t.Fatalf("the operator's bare %q to a squad went out: %v", body, got)
		}
	}
	if len(rm.Log(0)) != before || len(radioFrames(drain(t, la))) != 0 {
		t.Fatal("a bare acknowledgement reached the net")
	}
	// With something to say it is sent, and its acknowledgement of Hammer's order always is.
	if got := sent(t, rm, anvil, `{"to":"`+name+`","body":"Roger, hold where you are","end":"out"}`); got["sent"] == "" {
		t.Fatalf("a line with content was dropped: %v", got)
	}
	if _, err := rm.Say(hammer, "Anvil, this is Hammer. Buy a tank. Over."); err != nil {
		t.Fatal(err)
	}
	if got := sent(t, rm, anvil, `{"to":"Hammer","body":"Wilco","end":"out"}`); got["sent"] == "" {
		t.Fatalf("the operator's Wilco to Hammer was dropped: %v", got)
	}
	if m := last(t, rm, 0); m.Kind != KindAnswer || m.Level != 1 {
		t.Fatalf("the operator's Wilco to Hammer is %s at level %d", m.Kind, m.Level)
	}
}

func TestKnownEventsAreMarkedOnTheFrame(t *testing.T) {
	rm := newRoom(t, Config{AutoStart: true})
	a := squadsOf(rm, 0)[0]
	la := join(t, rm, 0, RoleSquad, a.ID)
	drain(t, la)
	// Every squad of the side is sent to the same point; they arrive within the window.
	for _, sq := range squadsOf(rm, 0) {
		if _, err := rm.sim.Apply(sim.Command{Side: 0, Kind: sim.CmdMove, Squad: sq.ID, Place: "A"}); err != nil {
			t.Fatal(err)
		}
	}
	var arrived, known int
	for i := 0; i < 600 && arrived < len(squadsOf(rm, 0)); i++ {
		rm.Tick()
		for _, b := range drainRaw(la) {
			var f struct {
				Type  string    `json:"type"`
				Known bool      `json:"known"`
				Event sim.Event `json:"event"`
			}
			if json.Unmarshal(b, &f) == nil && f.Type == "event" && f.Event.Kind == sim.EvArrived {
				arrived++
				if f.Known {
					known++
				}
			}
		}
	}
	if arrived < 2 || known != arrived-1 {
		t.Fatalf("%d squads arrived and %d were marked known; all but the first should be", arrived, known)
	}
}

// drainRaw returns every frame queued for a client, undecoded.
func drainRaw(c *Client) (out [][]byte) {
	for {
		select {
		case b, ok := <-c.Out:
			if !ok {
				return out
			}
			out = append(out, b)
		default:
			return out
		}
	}
}
