package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
)

// gemini calls Google's Interactions API in stateless mode (store: false): the relay
// keeps no conversation, so the whole history goes up as a list of steps every time.
//
// Shapes from Google's Interactions API reference and its function calling, thinking and
// text generation guides: input steps are user_input, model_output, function_call and
// function_result; tools are {type:"function", name, description, parameters}; the
// answer's steps can also hold "thought" steps whose signatures the API wants back
// exactly as it sent them. Those travel to the agent and back inside one State block.
type gemini struct{ *caller }

func (g *gemini) Name() string { return Gemini }

type geminiText struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

func (g *gemini) Think(ctx context.Context, key string, req Request) (*Response, error) {
	body := map[string]any{
		"model": req.Model,
		"store": false,
		"input": geminiSteps(req.Messages),
		"generation_config": map[string]any{
			"thinking_level":    req.Effort,
			"max_output_tokens": req.MaxTokens,
		},
	}
	if req.System != "" {
		body["system_instruction"] = req.System
	}
	if len(req.Tools) > 0 {
		tools := make([]map[string]any, 0, len(req.Tools))
		for _, t := range req.Tools {
			tools = append(tools, map[string]any{"type": "function", "name": t.Name, "description": t.Description, "parameters": t.InputSchema})
		}
		body["tools"] = tools
	}
	header := http.Header{}
	header.Set("x-goog-api-key", key)

	status, h, data, err := g.post(ctx, geminiURL, header, body)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		var env struct {
			Error struct {
				Message string `json:"message"`
				Status  string `json:"status"`
			} `json:"error"`
		}
		json.Unmarshal(data, &env)
		e := statusError(status, h, env.Error.Message)
		// A key Google does not know is answered as a bad request, not as 401.
		low := strings.ToLower(env.Error.Message)
		if status == http.StatusBadRequest && (strings.Contains(low, "api key") || strings.Contains(low, "api_key")) {
			e.Code = BadKey
		}
		return nil, e
	}

	var out struct {
		Status string            `json:"status"`
		Model  string            `json:"model"`
		Steps  []json.RawMessage `json:"steps"`
		Usage  struct {
			Input   int `json:"total_input_tokens"`
			Output  int `json:"total_output_tokens"`
			Thought int `json:"total_thought_tokens"`
		} `json:"usage"`
	}
	if json.Unmarshal(data, &out) != nil {
		return nil, &Error{Code: Failed, Status: status, Message: "the provider's answer was not understood"}
	}
	if out.Status == "failed" || out.Status == "cancelled" {
		return nil, &Error{Code: Failed, Status: status, Message: "the provider reported the request as " + out.Status}
	}
	res := &Response{Model: out.Model, InputTokens: out.Usage.Input, OutputTokens: out.Usage.Output + out.Usage.Thought}
	called := false
	for _, raw := range out.Steps {
		var step struct {
			Type      string          `json:"type"`
			ID        string          `json:"id"`
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
			Content   []geminiText    `json:"content"`
		}
		if json.Unmarshal(raw, &step) != nil {
			continue
		}
		switch step.Type {
		case "model_output":
			for _, part := range step.Content {
				if part.Type == Text && part.Text != "" {
					res.Content = append(res.Content, Block{Type: Text, Text: part.Text})
				}
			}
		case "function_call":
			input, ok := object(step.Arguments)
			if !ok {
				return nil, &Error{Code: Failed, Status: status, Message: "the model wrote a tool call that is not a JSON object"}
			}
			called = true
			res.Content = append(res.Content, Block{Type: ToolUse, ID: step.ID, Name: step.Name, Input: input})
		}
	}
	// The steps exactly as Google wrote them, thoughts and signatures included. The next
	// request sends these back in place of the text and tool blocks made from them.
	if len(out.Steps) > 0 {
		state, _ := json.Marshal(map[string]any{"type": State, "provider": Gemini, "steps": out.Steps})
		res.Content = append([]Block{{Type: State, Raw: state, Origin: Gemini}}, res.Content...)
	}
	switch {
	case called:
		res.StopReason = StopTool
	case out.Status == "incomplete":
		res.StopReason = MaxTokens
	default:
		res.StopReason = EndTurn
	}
	return res, nil
}

func geminiSteps(msgs []Message) []any {
	names := map[string]string{} // tool call id → tool name, which a result has to repeat
	var steps []any
	for _, m := range msgs {
		if m.Role == "assistant" {
			if kept := geminiState(m.Blocks); kept != nil {
				for _, b := range m.Blocks {
					if b.Type == ToolUse {
						names[b.ID] = b.Name
					}
				}
				for _, raw := range kept {
					steps = append(steps, raw)
				}
				continue
			}
		}
		var text []geminiText
		flush := func() {
			if len(text) == 0 {
				return
			}
			kind := "user_input"
			if m.Role == "assistant" {
				kind = "model_output"
			}
			steps = append(steps, map[string]any{"type": kind, "content": text})
			text = nil
		}
		for _, b := range m.Blocks {
			switch b.Type {
			case Text:
				if b.Text != "" {
					text = append(text, geminiText{Type: Text, Text: b.Text})
				}
			case ToolUse:
				if m.Role != "assistant" {
					continue
				}
				flush()
				names[b.ID] = b.Name
				steps = append(steps, map[string]any{"type": "function_call", "id": b.ID, "name": b.Name, "arguments": b.Input})
			case ToolResult:
				flush()
				r := map[string]any{
					"type": "function_result", "call_id": b.ToolUseID, "name": names[b.ToolUseID],
					"result": []geminiText{{Type: Text, Text: b.Content}},
				}
				if b.IsError {
					r["is_error"] = true
				}
				steps = append(steps, r)
			}
		}
		flush()
	}
	return steps
}

// geminiState returns the steps of a turn Gemini wrote, when the agent kept them.
func geminiState(blocks []Block) []json.RawMessage {
	for _, b := range blocks {
		if b.Type != State || b.Origin != Gemini {
			continue
		}
		var state struct {
			Steps []json.RawMessage `json:"steps"`
		}
		if json.Unmarshal(b.Raw, &state) != nil {
			continue
		}
		// Only what a model's own turn can hold goes back up. Anything else in the block
		// did not come from this relay and is left out.
		var kept []json.RawMessage
		for _, raw := range state.Steps {
			var head struct {
				Type string `json:"type"`
			}
			if json.Unmarshal(raw, &head) == nil && (head.Type == "thought" || head.Type == "model_output" || head.Type == "function_call") {
				kept = append(kept, raw)
			}
		}
		if len(kept) > 0 {
			return kept
		}
	}
	return nil
}
