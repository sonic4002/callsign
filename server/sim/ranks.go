package sim

import (
	"math"

	"callsign/shared"
)

// Earned ranks. A squad is credited with what it destroys, in gold: each soldier or
// vehicle at its share of the squad it belonged to. When that reaches a multiple of the
// squad's own cost it earns the next rank, which makes it steadier and a better shot;
// the top rank also mends its wounds out of combat. This is apart from the brain tier,
// which is bought.

// EvPromoted tells a side one of its squads has earned a rank; Unit is the rank's id.
const EvPromoted = "promoted"

var noRank = shared.Rank{Accuracy: 1, Nerve: 1}

// rankOf is what a squad's rank is worth; factors of 1 for a squad with none.
func (s *Sim) rankOf(sq *Squad) shared.Rank {
	if sq.Rank <= 0 || sq.Rank > len(s.R.Ranks) {
		return noRank
	}
	return s.R.Ranks[sq.Rank-1]
}

// creditKill gives the squads that shot a team the worth of the men it just lost, shared
// between them.
func (s *Sim) creditKill(tr *teamRef, lost int) {
	if len(tr.t.shooter) == 0 || lost <= 0 {
		return
	}
	worth := float64(tr.u.Cost) * float64(lost) / float64(max(1, tr.u.Teams*tr.u.Members))
	for _, k := range tr.t.shooter {
		k.Kills += worth / float64(len(tr.t.shooter))
	}
}

// rankProgress is how far a squad is toward its next rank, 0…1; 1 at the top.
func (s *Sim) rankProgress(sq *Squad) float64 {
	if sq.Rank >= len(s.R.Ranks) || sq.unit.Cost <= 0 {
		return 1
	}
	from := 0.0
	if sq.Rank > 0 {
		from = s.R.Ranks[sq.Rank-1].Kills
	}
	to := s.R.Ranks[sq.Rank].Kills
	have := sq.Kills / float64(sq.unit.Cost)
	return math.Max(0, math.Min(1, (have-from)/(to-from)))
}

// rankWork promotes the squads that have earned it and lets the top rank recover.
func (s *Sim) rankWork(live []*teamRef) {
	for _, sq := range s.Squads {
		if !sq.Alive || sq.haul != nil || sq.unit.Cost <= 0 {
			continue
		}
		for sq.Rank < len(s.R.Ranks) && sq.Kills >= s.R.Ranks[sq.Rank].Kills*float64(sq.unit.Cost) {
			sq.Rank++
			s.emit(Event{Side: sq.Side, Kind: EvPromoted, Squad: sq.ID, Unit: s.R.Ranks[sq.Rank-1].ID})
		}
	}
	quiet := int(s.R.Nerve.QuietSeconds * float64(s.R.TickRate))
	for _, tr := range live {
		heal := s.rankOf(tr.sq).HealPerSecond
		t := tr.t
		if heal <= 0 || t.Members == 0 || s.Tick-t.lastShot <= 3*quiet {
			continue
		}
		// Wounds mend; the fallen do not come back.
		if full := tr.u.HP * float64(t.Members); t.HP < full {
			t.HP = math.Min(full, t.HP+heal*tr.u.HP*s.dt)
		}
	}
}
