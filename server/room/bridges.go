package room

import (
	"errors"
	"fmt"
	"strings"
)

// A bridge is everybody's road, and a fallen one changes the whole map. Squads shoot one
// down, and a hero sets a charge on one, only when the commander ordered that bridge
// destroyed in so many words, and not long ago. An operator running the fight may think
// it clever; the commander finds the bridge gone.

// bridgeOrderSeconds is how long a commander's order to destroy a bridge stands.
const bridgeOrderSeconds = 180

// ErrBridgeNotOrdered refuses an attack on a bridge the commander did not order destroyed.
var ErrBridgeNotOrdered = errors.New("a bridge is destroyed only on Hammer's own order")

// destroyWords say, in either language, that a thing is to be destroyed.
var destroyWords = []string{
	"attack", "destroy", "shoot", "blow", "bring down", "take down", "demolish", "knock down", "drop the", "plant", "charge",
	"תקוף", "תקפו", "השמד", "השמידו", "פוצץ", "פוצצו", "הפל", "הפילו", "הרוס", "הרסו", "ירו על", "מטען",
}

// noteBridgeOrder records the bridges a commander's call orders destroyed: the call names
// the bridge and says to destroy it.
func (rm *Room) noteBridgeOrder(side int, body string, named []string) {
	low := strings.ToLower(body)
	ordered := false
	for _, w := range destroyWords {
		ordered = ordered || strings.Contains(low, w)
	}
	if !ordered {
		return
	}
	for _, id := range named {
		for i := range rm.r.Map.Bridges {
			if rm.r.Map.Bridges[i].ID == id {
				if rm.bridgeDoomed[side] == nil {
					rm.bridgeDoomed[side] = map[string]int{}
				}
				rm.bridgeDoomed[side][id] = rm.sim.Tick
			}
		}
	}
}

// mayHitBridge refuses an attack or a charge on a bridge unless the side's commander
// ordered that bridge destroyed within the last few minutes. Any other place passes.
func (rm *Room) mayHitBridge(side int, place string) error {
	for i := range rm.r.Map.Bridges {
		b := &rm.r.Map.Bridges[i]
		if b.ID != place {
			continue
		}
		at, ok := rm.bridgeDoomed[side][place]
		if ok && rm.sim.Tick-at <= bridgeOrderSeconds*rm.r.TickRate {
			return nil
		}
		return fmt.Errorf("%w: Hammer has not ordered %s destroyed. Do not attack it; ask Hammer if you think it should fall", ErrBridgeNotOrdered, b.Name.En)
	}
	return nil
}
