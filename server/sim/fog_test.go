package sim_test

import (
	"bytes"
	"testing"

	"callsign/server/sim"
)

func point(snap sim.Snapshot, id string) sim.PointView {
	for _, p := range snap.Points {
		if p.ID == id {
			return p
		}
	}
	return sim.PointView{}
}

func count(seen []byte) int {
	n := 0
	for _, b := range seen {
		for ; b != 0; b &= b - 1 {
			n++
		}
	}
	return n
}

func TestFogStartsDarkAndRevealsAsSquadsMove(t *testing.T) {
	s := newSim(t, 1)
	fog := s.Snapshot(0).Fog
	if fog == nil || fog.Cols*fog.Rows != 40*25 || len(fog.Seen) != 125 {
		t.Fatalf("fog = %+v", fog)
	}
	start := count(fog.Seen)
	if start == 0 || start > fog.Cols*fog.Rows/3 {
		t.Fatalf("%d of %d cells seen at the start, want only the ground around the HQ", start, fog.Cols*fog.Rows)
	}
	if !s.Explored(0, 150, 480) || s.Explored(0, 800, 500) || s.Explored(0, 1450, 480) {
		t.Fatal("side 0 should have seen its own HQ and neither the town nor the enemy HQ")
	}
	if s.Snapshot(sim.Spectator).Fog != nil {
		t.Fatal("spectators get no fog")
	}

	must(t, s, sim.Command{Side: 0, Kind: sim.CmdMove, Squad: 1, Point: "F"})
	prev := append([]byte{}, fog.Seen...)
	for i := 0; i < 300; i++ {
		s.Step()
		now := s.Snapshot(0).Fog.Seen
		for j := range prev {
			if prev[j]&^now[j] != 0 {
				t.Fatalf("tick %d: an explored cell went dark again", s.Tick)
			}
		}
		prev = append(prev[:0], now...)
	}
	if count(prev) <= start {
		t.Fatalf("moving revealed nothing: %d cells before, %d after", start, count(prev))
	}
	if !s.Explored(0, 800, 500) || !s.Explored(0, 500, 490) {
		t.Fatal("the town and the road to it should be explored after the move")
	}
	if !s.InSight(0, 800, 500) || s.InSight(0, 1450, 480) {
		t.Fatal("the squad at the town sees the town, not the enemy HQ")
	}
	// The other side saw none of it.
	if s.Explored(1, 500, 490) || bytes.Equal(s.Snapshot(1).Fog.Seen, prev) {
		t.Fatal("each side has its own fog")
	}
}

func TestPointsAreShownAsLastSeen(t *testing.T) {
	s := newSim(t, 1)
	must(t, s, sim.Command{Side: 1, Kind: sim.CmdHold, Squad: 3, Point: "K"})
	run(s, 40)
	if owner(s, "K") != 1 || point(s.Snapshot(sim.Spectator), "K").Owner != 1 {
		t.Fatalf("Kilo owner = %d, want side 1", owner(s, "K"))
	}
	if p := point(s.Snapshot(0), "K"); p.Owner != sim.NoSide || p.Visible {
		t.Fatalf("side 0 has never seen Kilo but is shown %+v", p)
	}
	if p := point(s.Snapshot(1), "K"); p.Owner != 1 || !p.Visible {
		t.Fatalf("side 1 stands on Kilo but is shown %+v", p)
	}

	// Side 0 takes Bravo and walks away.
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdHold, Squad: 1, Point: "B"})
	run(s, 30)
	if p := point(s.Snapshot(1), "B"); p.Owner != sim.NoSide {
		t.Fatalf("side 1 has never seen Bravo but is shown %+v", p)
	}
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdMove, Squad: 1, Point: "A"})
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdMove, Squad: 2, Point: "A"})
	run(s, 15)
	// A held point keeps watch: it and the ground around it stay in sight with nobody there.
	if p := point(s.Snapshot(0), "B"); p.Owner != 0 || !p.Visible {
		t.Fatalf("side 0 holds Bravo with no squad there but is shown %+v", p)
	}
	bravo := rules.PointByID("B")
	if !s.InSight(0, bravo.X+rules.Match.PointSight-1, bravo.Y) || s.InSight(0, bravo.X+rules.Match.PointSight+1, bravo.Y) {
		t.Fatalf("side 0 should see exactly %v around Bravo", rules.Match.PointSight)
	}
	if s.InSight(1, bravo.X, bravo.Y) {
		t.Fatal("side 1 sees Bravo, which it does not hold")
	}

	// Scouting reveals the truth.
	must(t, s, sim.Command{Side: 0, Kind: sim.CmdMove, Squad: 2, Point: "K"})
	for i := 0; i < 900 && !point(s.Snapshot(0), "K").Visible; i++ {
		s.Step()
	}
	if p := point(s.Snapshot(0), "K"); !p.Visible || p.Owner != 1 {
		t.Fatalf("side 0 has Kilo in sight but is shown %+v", p)
	}
}

func TestEnemyHQHealthIsAsLastSeen(t *testing.T) {
	s := newSim(t, 1)
	s.Sides[1].HQHP = rules.HQ.HP / 2
	s.Step()
	if hq := s.Snapshot(0).HQ; hq[1] != 1 || hq[0] != 1 {
		t.Fatalf("side 0 cannot see the enemy HQ but is shown %v", hq)
	}
	if hq := s.Snapshot(1).HQ; hq[1] != 0.5 {
		t.Fatalf("side 1 is shown its own HQ at %v", hq)
	}
	if hq := s.Snapshot(sim.Spectator).HQ; hq[1] != 0.5 {
		t.Fatalf("spectator is shown %v", hq)
	}
}
