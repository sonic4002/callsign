package shared

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strconv"
)

//go:embed models.json
var ModelsJSON []byte

// Operator is the key of the operator's brain in models.json, beside tiers "1" to "3".
const Operator = "operator"

// Models maps a brain tier to a model for each AI provider. The model relay is the only
// reader: a player's gold decides the tier, and this table decides what a tier thinks with.
type Models struct {
	Version   int                          `json:"version"`
	MaxTokens int                          `json:"maxTokens"` // cap on one answer, thinking included
	Effort    map[string]string            `json:"effort"`    // tier → low, medium or high
	Providers map[string]map[string]string `json:"providers"` // provider → tier → model id
	// Decision is the decision model of each decision provider, pinned to a version: the
	// fast brain's confidence threshold was tuned against that version and no other.
	Decision map[string]string `json:"decision"`
}

// LoadModels parses the embedded models.json and checks that every provider covers every
// tier in the rules, so a missing entry fails at start and not in the middle of a match.
func LoadModels(r *Rules) (*Models, error) {
	var m Models
	if err := json.Unmarshal(ModelsJSON, &m); err != nil {
		return nil, fmt.Errorf("models.json: %w", err)
	}
	if m.MaxTokens <= 0 {
		return nil, fmt.Errorf("models.json: maxTokens must be positive")
	}
	keys := []string{Operator}
	for _, t := range r.Tiers {
		keys = append(keys, strconv.Itoa(t.Tier))
	}
	if len(m.Providers) == 0 {
		return nil, fmt.Errorf("models.json: no providers")
	}
	for _, k := range keys {
		switch m.Effort[k] {
		case "low", "medium", "high":
		default:
			return nil, fmt.Errorf("models.json: effort for tier %s must be low, medium or high", k)
		}
		for name, tiers := range m.Providers {
			if tiers[k] == "" {
				return nil, fmt.Errorf("models.json: provider %s has no model for tier %s", name, k)
			}
		}
	}
	return &m, nil
}

// TierKey names a brain in models.json: the operator, or a squad's tier.
func TierKey(operator bool, tier int) string {
	if operator {
		return Operator
	}
	return strconv.Itoa(tier)
}
