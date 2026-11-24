package provider

import (
	"context"
	"encoding/json"
	"net/http"
)

// TypeSafe's Jev is a decision model: it does not write, it picks one option from a list
// the request declares and gives every option a probability. That is not the shape of a
// thought (a system prompt, tools, a conversation), so it has an interface of its own
// beside Provider: a state and one question with its options in, the choice out.
//
// Like every provider here it can reach exactly one address, written below, and never
// follows a redirect. The key is the game's own (the relay's CALLSIGN_JEV_KEY), never a
// player's: see relay/decide.go for what protects it.
const (
	TypeSafe    = "typesafe"
	typeSafeURL = "https://api.typesafe.ai/v1/systemone"
	// question is the name the one question travels under. The model is not shown it.
	question = "order"
)

// Decision is one question to the decision model. The relay fills Model; a caller never does.
type Decision struct {
	Model        string
	State        json.RawMessage   // what the model reads: a JSON object
	Instructions string            // the question itself
	Options      map[string]string // option name → what choosing it means
}

// Decided is the model's answer: the option it chose and what it gave every option.
type Decided struct {
	Choice        string
	Confidence    float64
	Probabilities map[string]float64
	InputTokens   int
	OutputTokens  int
	Model         string // the versioned model that answered
}

// Decider calls a decision model with a key.
type Decider interface {
	Name() string
	Decide(ctx context.Context, key string, req Decision) (*Decided, error)
}

type typeSafe struct{ *caller }

// NewTypeSafe builds the decision provider on a transport. Pass nil for the real network.
func NewTypeSafe(transport http.RoundTripper) Decider { return &typeSafe{newCaller(transport)} }

func (p *typeSafe) Name() string { return TypeSafe }

func (p *typeSafe) Decide(ctx context.Context, key string, req Decision) (*Decided, error) {
	if len(req.Options) == 0 {
		return nil, &Error{Code: Failed, Message: "a decision needs options"}
	}
	criteria := make(map[string]string, len(req.Options))
	for name, about := range req.Options {
		criteria[name] = about
	}
	q := map[string]any{"type": "choice", "criteria": criteria}
	if req.Instructions != "" {
		q["instructions"] = req.Instructions
	}
	state := req.State
	if len(state) == 0 {
		state = emptyObject
	}
	body := map[string]any{"model": req.Model, "state": state, "questions": map[string]any{question: q}}
	status, header, data, err := p.post(ctx, typeSafeURL, http.Header{"Authorization": {"Bearer " + key}}, body)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		var failed struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
			Message string `json:"message"`
		}
		json.Unmarshal(data, &failed)
		msg := failed.Error.Message
		if msg == "" {
			msg = failed.Message
		}
		e := statusError(status, header, msg)
		if status == 529 {
			e.Code = Overloaded
		}
		return nil, e
	}
	var out struct {
		Model   string `json:"model"`
		Answers map[string]struct {
			Type          string             `json:"type"`
			Choice        string             `json:"choice"`
			Confidence    float64            `json:"confidence"`
			Probabilities map[string]float64 `json:"probabilities"`
		} `json:"answers"`
		Usage struct {
			InputTokens  int `json:"input_tokens"`
			OutputTokens int `json:"output_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, &Error{Code: Failed, Status: status, Message: "the provider's answer was not understood"}
	}
	a, found := out.Answers[question]
	if _, known := req.Options[a.Choice]; !found || a.Type != "choice" || !known {
		// A refusal, or an option that was never offered: not an answer to act on.
		return nil, &Error{Code: Failed, Status: status, Message: "the provider did not choose one of the options"}
	}
	return &Decided{
		Choice: a.Choice, Confidence: a.Confidence, Probabilities: a.Probabilities,
		InputTokens: out.Usage.InputTokens, OutputTokens: out.Usage.OutputTokens, Model: out.Model,
	}, nil
}
