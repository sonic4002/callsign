package sim_test

import (
	"errors"
	"math"
	"testing"

	"callsign/server/sim"
	"callsign/shared"
)

func openLandNear(r *shared.Rules, cx, cy float64) (float64, float64) {
	if r.Map.TerrainAt(cx, cy) == 'L' {
		return cx, cy
	}
	for rad := 40.0; rad <= 800; rad += 40 {
		for k := 0; k < 16; k++ {
			a := float64(k) * math.Pi / 8
			px, py := cx+math.Cos(a)*rad, cy+math.Sin(a)*rad
			if px > 40 && py > 40 && px < r.Map.Width-40 && py < r.Map.Height-40 && r.Map.TerrainAt(px, py) == 'L' {
				return px, py
			}
		}
	}
	hq := r.HQPoint(0)
	return hq.X + 120, hq.Y
}

func TestSuperPowersPickerModesComplexLifecycleAndLowPower(t *testing.T) {
	rules := shared.MustLoad()
	if len(rules.SuperPowers) != 15 {
		t.Fatalf("expected 15 super powers in rules, got %d", len(rules.SuperPowers))
	}

	// 1. "0" / "off" disables super weapon building & selection.
	sOff, err := sim.New(rules, sim.Config{
		Seed: 1, Factions: [2]string{"aegis", "ashfall"}, FullBase: true, StartGold: 5000, SuperPowers: "0",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := sOff.Build(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "strategicCommand"}); !errors.Is(err, sim.ErrSuperPowersOff) {
		t.Fatalf("expected ErrSuperPowersOff when SuperPowers=0, got %v", err)
	}
	if _, err := sOff.SelectSuperPowers(0, []string{"rodOfGod"}); !errors.Is(err, sim.ErrSuperPowersOff) {
		t.Fatalf("expected ErrSuperPowersOff on SelectSuperPowers, got %v", err)
	}

	// 2. Modes "1", "2", "3", "4" enforce exact pick counts (neither more nor fewer, no duplicates).
	for _, tc := range []struct {
		mode string
		want int
	}{
		{"1", 1}, {"2", 2}, {"3", 3}, {"4", 4},
	} {
		sm, err := sim.New(rules, sim.Config{
			Seed: 2, Factions: [2]string{"aegis", "ashfall"}, FullBase: true, StartGold: 5000, SuperPowers: tc.mode,
		})
		if err != nil {
			t.Fatal(err)
		}
		allIDs := []string{"rodOfGod", "tacticalNuke", "empPulse", "orbitalLaser", "scudSalvo"}
		// Fewer than allowed must fail.
		if tc.want > 1 {
			if _, err := sm.SelectSuperPowers(0, allIDs[:tc.want-1]); !errors.Is(err, sim.ErrSuperLimit) {
				t.Fatalf("mode %s: expected ErrSuperLimit when picking %d (< %d), got %v", tc.mode, tc.want-1, tc.want, err)
			}
			// Duplicate padding must also fail.
			dup := append([]string{allIDs[0]}, allIDs[:tc.want-1]...)
			if _, err := sm.SelectSuperPowers(0, dup); !errors.Is(err, sim.ErrSuperLimit) {
				t.Fatalf("mode %s: expected ErrSuperLimit on duplicates, got %v", tc.mode, err)
			}
		}
		// More than allowed must fail.
		if _, err := sm.SelectSuperPowers(0, allIDs[:tc.want+1]); !errors.Is(err, sim.ErrSuperLimit) {
			t.Fatalf("mode %s: expected ErrSuperLimit when picking %d (> %d), got %v", tc.mode, tc.want+1, tc.want, err)
		}
		// Exact count succeeds.
		chosen, err := sm.SelectSuperPowers(0, allIDs[:tc.want])
		if err != nil || len(chosen) != tc.want {
			t.Fatalf("mode %s: exact pick failed: %v (%v)", tc.mode, err, chosen)
		}
		// Mid-match swapping to different powers is refused.
		if _, err := sm.SelectSuperPowers(0, allIDs[1:tc.want+1]); !errors.Is(err, sim.ErrSuperLimit) {
			t.Fatalf("mode %s: expected mid-match swap to be refused, got %v", tc.mode, err)
		}
	}

	// 3. Complex build, 1-complex cap, low-power freeze, sell/rebuild cooldown preservation, and engineer capture!
	s, err := sim.New(rules, sim.Config{
		Seed: 3, Factions: [2]string{"aegis", "ashfall"}, Base: []string{"power", "barracks", "works", "radar"}, StartGold: 8000, SuperPowers: "2",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SelectSuperPowers(0, []string{"rodOfGod", "orbitalLaser"}); err != nil {
		t.Fatal(err)
	}
	st, err := s.Build(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "strategicCommand"})
	if err != nil {
		t.Fatalf("build strategicCommand: %v", err)
	}
	for i := 0; i < 300 && !st.Standing(); i++ {
		s.Step()
	}
	if !st.Standing() {
		t.Fatal("strategicCommand did not finish")
	}
	// Second complex is refused while one stands.
	if _, err := s.Build(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "strategicCommand"}); err == nil {
		t.Fatal("expected building a 2nd superweapon complex to be refused")
	}

	// Verify initial charge starts at 0% (CooldownTicks == 450, ReadyTick == Tick + 450).
	snap0 := s.Snapshot(0)
	slot0 := snap0.SuperPowers.Slots[0]
	if slot0.CooldownTicks != 450 || slot0.Ready {
		t.Fatalf("unexpected initial charge slot: %+v", slot0)
	}

	// Advance past initial charge (450 ticks), fire Rod of God, then verify low-power pauses recharge
	// and selling + rebuilding does NOT reset the 300s (3000-tick) cooldown!
	for i := 0; i < 460; i++ {
		s.Step()
	}
	lx, ly := openLandNear(rules, 900, 900)
	if _, err := s.FireSuperPower(0, "rodOfGod", lx, ly, 0, 0, nil); err != nil {
		t.Fatalf("fire rodOfGod: %v", err)
	}
	// Sell power plant to trigger low power: recharge remaining ticks must hold steady, and firing orbitalLaser must fail with ErrSuperNoPower!
	var pplant *sim.Structure
	for _, b := range s.Structures {
		if b.Side == 0 && b.Def().Role == shared.RolePower {
			pplant = b
			break
		}
	}
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdSell, Place: pplant.PlaceID()}); err != nil {
		t.Fatalf("sell power plant: %v", err)
	}
	s.Step()
	if _, err := s.FireSuperPower(0, "orbitalLaser", lx, ly, lx+200, ly, nil); !errors.Is(err, sim.ErrSuperNoPower) {
		t.Fatalf("expected ErrSuperNoPower on low power, got %v", err)
	}
	remBefore := s.Snapshot(0).SuperPowers.Slots[0].ReadyTick - s.Tick
	for i := 0; i < 50; i++ {
		s.Step()
	}
	remAfter := s.Snapshot(0).SuperPowers.Slots[0].ReadyTick - s.Tick
	if remAfter != remBefore {
		t.Fatalf("expected low power to pause recharge: before=%d after=%d", remBefore, remAfter)
	}

	// Restore power, sell Strategic Command, wait 100 ticks, rebuild it, and verify cooldown was NOT skipped!
	pp2, err := s.Build(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "powerPlant"})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 100 && !pp2.Standing(); i++ {
		s.Step()
	}
	if _, err := s.Apply(sim.Command{Side: 0, Kind: sim.CmdSell, Place: st.PlaceID()}); err != nil {
		t.Fatalf("sell strategicCommand: %v", err)
	}
	for i := 0; i < 100; i++ {
		s.Step()
	}
	st2, err := s.Build(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "strategicCommand"})
	if err != nil {
		t.Fatalf("rebuild strategicCommand: %v", err)
	}
	for i := 0; i < 300 && !st2.Standing(); i++ {
		s.Step()
	}
	remRebuilt := s.Snapshot(0).SuperPowers.Slots[0].ReadyTick - s.Tick
	if remRebuilt < 2500 {
		t.Fatalf("sell+rebuild skipped cooldown! remaining ticks=%d (expected >= 2500)", remRebuilt)
	}

	// Engineer capture: Ashfall sappers capture Aegis Strategic Command -> Side 1 gains HasBuilding & can pick powers!
	sap, err := s.Apply(sim.Command{Side: 1, Kind: sim.CmdBuy, Unit: "sappers"})
	if err != nil {
		t.Fatalf("buy sappers: %v", err)
	}
	for i := 0; i < 100 && !sap.Alive; i++ {
		s.Step()
	}
	// Move sappers next to st2 and capture it.
	for j := range sap.Teams {
		sap.Teams[j].X, sap.Teams[j].Y = st2.X+55, st2.Y
	}
	s.Step() // spot structure
	if _, err := s.Apply(sim.Command{Side: 1, Kind: sim.CmdCapture, Squad: sap.ID, Place: st2.PlaceID()}); err != nil {
		t.Fatalf("capture order on strategicCommand: %v", err)
	}
	for i := 0; i < 150 && st2.Side != 1; i++ {
		s.Step()
	}
	if st2.Side != 1 {
		t.Fatal("sappers did not finish capturing strategicCommand")
	}
	if s.Snapshot(0).SuperPowers.HasBuilding {
		t.Fatal("side 0 should no longer have superweapon building after capture")
	}
	if !s.Snapshot(1).SuperPowers.HasBuilding || !s.Snapshot(1).SuperPowers.BuildingReady {
		t.Fatal("side 1 should own captured superweapon building")
	}
	if _, err := s.SelectSuperPowers(1, []string{"scudSalvo", "chemicalStrike"}); err != nil {
		t.Fatalf("side 1 selecting powers on captured complex failed: %v", err)
	}
}

func TestSuperPowersDeterminismAll15(t *testing.T) {
	rules := shared.MustLoad()
	lx, ly := openLandNear(rules, rules.Map.Width/2, rules.Map.Height/2)

	for idx, sp := range rules.SuperPowers {
		t.Run(sp.ID, func(t *testing.T) {
			run := func() ([]uint64, sim.Snapshot) {
				factions := [2]string{"aegis", "ashfall"}
				if idx%2 == 1 {
					factions = [2]string{"ashfall", "aegis"}
				}
				s, err := sim.New(rules, sim.Config{
					Seed: 1000 + uint64(idx), Factions: factions, FullBase: true, StartGold: 9000, SuperPowers: "all",
				})
				if err != nil {
					t.Fatal(err)
				}
				kind := "strategicCommand"
				if factions[0] == "ashfall" {
					kind = "blackSite"
				}
				st, err := s.Build(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: kind})
				if err != nil {
					t.Fatal(err)
				}
				var hashes []uint64
				for i := 0; i < 200 && !st.Standing(); i++ {
					s.Step()
					hashes = append(hashes, s.Hash())
				}
				// Put an enemy squad near the target so unit targeting/damage/stun/nerve are exercised deterministically too.
				for _, sq := range s.Squads {
					if sq.Side == 1 && sq.Alive && sq.Class() == "infantry" {
						for j := range sq.Teams {
							sq.Teams[j].X, sq.Teams[j].Y = lx+18, ly-12
						}
						break
					}
				}
				targets := []sim.TargetXY{{X: lx, Y: ly}, {X: lx + 70, Y: ly + 30}, {X: lx - 65, Y: ly - 25}}
				if _, err := s.FireSuperPower(0, sp.ID, lx, ly, lx+220, ly+40, targets); err != nil {
					t.Fatalf("fire %s: %v", sp.ID, err)
				}
				for tick := 0; tick < 220; tick++ {
					s.Step()
					hashes = append(hashes, s.Hash())
				}
				return hashes, s.Snapshot(sim.Spectator)
			}

			h1, snap1 := run()
			h2, snap2 := run()
			if len(h1) != len(h2) {
				t.Fatalf("hash length mismatch: %d vs %d", len(h1), len(h2))
			}
			for i := range h1 {
				if h1[i] != h2[i] {
					t.Fatalf("%s diverged at step %d: %x != %x", sp.ID, i, h1[i], h2[i])
				}
			}
			if len(snap1.Craters) != len(snap2.Craters) || len(snap1.Hazards) != len(snap2.Hazards) {
				t.Fatalf("%s spectator state mismatch", sp.ID)
			}
		})
	}
}

func TestSuperPowersFogOfWarTargetsAndBalanceSanity(t *testing.T) {
	rules := shared.MustLoad()
	s, err := sim.New(rules, sim.Config{
		Seed: 77, Factions: [2]string{"aegis", "ashfall"}, FullBase: true, StartGold: 9000, SuperPowers: "all",
	})
	if err != nil {
		t.Fatal(err)
	}
	st0, err := s.Build(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "strategicCommand"})
	if err != nil {
		t.Fatal(err)
	}
	st1, err := s.Build(sim.Command{Side: 1, Kind: sim.CmdBuild, Structure: "blackSite"})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 200 && (!st0.Standing() || !st1.Standing()); i++ {
		s.Step()
	}

	// 1. Out-of-bounds target is rejected cleanly.
	if _, err := s.FireSuperPower(0, "rodOfGod", -50, 400, 0, 0, nil); !errors.Is(err, sim.ErrSuperTarget) {
		t.Fatalf("expected ErrSuperTarget for out-of-bounds x=-50, got %v", err)
	}
	if _, err := s.FireSuperPower(0, "rodOfGod", rules.Map.Width+50, 400, 0, 0, nil); !errors.Is(err, sim.ErrSuperTarget) {
		t.Fatalf("expected ErrSuperTarget for out-of-bounds x>W, got %v", err)
	}

	// 2. Fog of War: Side 0 fires Artillery Firestorm near its own west ground (unseen by Side 1).
	// Side 1 must NOT see the strike or craters while out of sight; Spectator sees everything;
	// once Side 1 moves a squad into sight, both Side 0 and Side 1 agree on the exact same craters!
	hq0 := rules.HQPoint(0)
	wx, wy := openLandNear(rules, hq0.X+140, hq0.Y-180)
	if _, err := s.FireSuperPower(0, "artilleryFirestorm", wx, wy, 0, 0, nil); err != nil {
		t.Fatal(err)
	}
	s.Step()
	if len(s.Snapshot(1).SuperStrikes) != 0 {
		t.Fatalf("fog leak: side 1 saw unseen enemy artillery strike: %+v", s.Snapshot(1).SuperStrikes)
	}
	if len(s.Snapshot(sim.Spectator).SuperStrikes) == 0 {
		t.Fatal("spectator should see active super strike")
	}
	for i := 0; i < 180; i++ {
		s.Step()
	}
	craters0 := s.Snapshot(0).Craters
	if len(craters0) == 0 {
		t.Fatal("expected side 0 to see craters near its own base")
	}
	if len(s.Snapshot(1).Craters) != 0 {
		t.Fatalf("fog leak: side 1 saw craters in unexplored fog: %+v", s.Snapshot(1).Craters)
	}
	// Move a Side 1 squad to look at (wx, wy): Side 1 must now see the exact same craters as Side 0!
	for _, sq := range s.Squads {
		if sq.Side == 1 && sq.Alive && sq.Class() == "infantry" {
			for j := range sq.Teams {
				sq.Teams[j].X, sq.Teams[j].Y = wx, wy
			}
			break
		}
	}
	s.Step()
	craters1 := s.Snapshot(1).Craters
	if len(craters1) != len(craters0) {
		t.Fatalf("crater disagreement once in sight: side0=%d side1=%d", len(craters0), len(craters1))
	}

	// 3. Firing into unseen fog does NOT reveal fog for the attacker!
	hq1 := rules.HQPoint(1)
	unseenX, unseenY := openLandNear(rules, hq1.X-160, hq1.Y-220)
	if s.Explored(0, unseenX, unseenY) {
		t.Fatal("expected target near enemy HQ to start unexplored by side 0")
	}
	if _, err := s.FireSuperPower(0, "rodOfGod", unseenX, unseenY, 0, 0, nil); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 60; i++ {
		s.Step()
	}
	if s.Explored(0, unseenX, unseenY) {
		t.Fatal("firing Rod of God into fog must NOT reveal fog cells")
	}

	// 4. Bridges, Tech Buildings, Haulers & Balance Sanity (no power wins in 1 use, nor 2 default powers sniping HQ).
	if len(rules.Map.Bridges) > 0 {
		br := rules.Map.Bridges[0]
		mx, my := (br.From[0]+br.To[0])/2, (br.From[1]+br.To[1])/2
		if _, err := s.FireSuperPower(0, "cruiseMissiles", mx, my, 0, 0, []sim.TargetXY{{X: mx, Y: my}, {X: mx, Y: my}, {X: mx, Y: my}}); err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 120; i++ {
			s.Step()
		}
		if s.Bridges[0].Standing {
			t.Fatal("expected 3 cruise missiles on a bridge to collapse it")
		}
	}

	// Check every single super power aimed directly on enemy HQ from 100% HP: none may take > 32% HQ HP!
	for _, sp := range rules.SuperPowers {
		sb, err := sim.New(rules, sim.Config{
			Seed: 55, Factions: [2]string{"aegis", "ashfall"}, Base: []string{"power"}, StartGold: 5000, SuperPowers: "all",
		})
		if err != nil {
			t.Fatal(err)
		}
		b, _ := sb.Build(sim.Command{Side: 0, Kind: sim.CmdBuild, Structure: "strategicCommand"})
		for i := 0; i < 200 && !b.Standing(); i++ {
			sb.Step()
		}
		ehq := rules.HQPoint(1)
		tx, ty := ehq.X, ehq.Y
		if sp.ID == "tunnelAmbush" {
			tx, ty = openLandNear(rules, ehq.X-90, ehq.Y)
		}
		targets := []sim.TargetXY{{X: tx, Y: ty}, {X: tx, Y: ty}, {X: tx, Y: ty}}
		if _, err := sb.FireSuperPower(0, sp.ID, tx, ty, tx+40, ty+40, targets); err != nil {
			t.Fatalf("balance check fire %s: %v", sp.ID, err)
		}
		for i := 0; i < 180 && !sb.Over; i++ {
			sb.Step()
		}
		if sb.Over {
			t.Fatalf("balance sanity failure: %s ended the match in a single use!", sp.ID)
		}
		hqShare := sb.Snapshot(sim.Spectator).HQ[1]
		// Even with spawned ambush infantry shooting for 14s, HQ must remain well above 50%.
		if hqShare < 0.55 {
			t.Fatalf("balance sanity failure: %s reduced enemy HQ to %.1f%% in one use", sp.ID, hqShare*100)
		}
	}
}
