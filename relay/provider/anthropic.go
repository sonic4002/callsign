package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
)

// anthropic calls the Messages API. The game's shape is this API's shape, so the
// translation is small: the request is rebuilt field by field from what the relay
// accepted, and the answer is narrowed to the blocks an agent may see.
//
// Shapes from the Messages API reference (anthropic-version 2026-10-21): no sampling
// parameters, thinking is adaptive by default and its depth is set by output_config.effort,
// and a model that declines answers 200 with stop_reason "refusal".
type anthropic struct{ *caller }

const (
	anthropicVersion = "2026-10-21"
	// Lets the API hand a declined request to the model it recommends, inside the same call.
	fallbackBeta = "server-side-fallback-2026-07-01"
)

// Blocks of Anthropic's own that an agent sends back unchanged.
var anthropicKept = map[string]bool{"thinking": true, "redacted_thinking": true, "fallback": true}

func (a *anthropic) Name() string { return Anthropic }

func (a *anthropic) Think(ctx context.Context, key string, req Request) (*Response, error) {
	body := map[string]any{
		"model":      req.Model,
		"max_tokens": req.MaxTokens,
		"messages":   anthropicMessages(req.Messages),
		// One cache point, placed by the API on the last block that can take it: the
		// system prompt and tools repeat on every thought of a match.
		"cache_control": map[string]string{"type": "ephemeral"},
		"output_config": map[string]string{"effort": req.Effort},
	}
	if req.System != "" {
		body["system"] = req.System
	}
	if len(req.Tools) > 0 {
		tools := make([]map[string]any, 0, len(req.Tools))
		for _, t := range req.Tools {
			tool := map[string]any{"name": t.Name, "description": t.Description, "input_schema": t.InputSchema}
			if t.Strict {
				tool["strict"] = true
			}
			tools = append(tools, tool)
		}
		body["tools"] = tools
	}
	header := http.Header{}
	header.Set("x-api-key", key)
	header.Set("anthropic-version", anthropicVersion)
	// There is no server-side fallback for Haiku: a declined request stays declined.
	if !strings.HasPrefix(req.Model, "claude-haiku") {
		header.Set("anthropic-beta", fallbackBeta)
		body["fallbacks"] = "default"
	}

	status, h, data, err := a.post(ctx, anthropicURL, header, body)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		var env struct {
			Error struct {
				Type    string `json:"type"`
				Message string `json:"message"`
			} `json:"error"`
		}
		json.Unmarshal(data, &env)
		e := statusError(status, h, env.Error.Message)
		if status == 529 || env.Error.Type == "overloaded_error" {
			e.Code = Overloaded
		}
		return nil, e
	}

	var out struct {
		Content    []json.RawMessage `json:"content"`
		StopReason string            `json:"stop_reason"`
		Model      string            `json:"model"`
		Usage      struct {
			Input      int `json:"input_tokens"`
			Output     int `json:"output_tokens"`
			CacheRead  int `json:"cache_read_input_tokens"`
			CacheWrite int `json:"cache_creation_input_tokens"`
		} `json:"usage"`
	}
	if json.Unmarshal(data, &out) != nil {
		return nil, &Error{Code: Failed, Status: status, Message: "the provider's answer was not understood"}
	}
	res := &Response{
		Model:        out.Model,
		InputTokens:  out.Usage.Input + out.Usage.CacheRead + out.Usage.CacheWrite,
		OutputTokens: out.Usage.Output,
	}
	switch out.StopReason {
	case StopTool, MaxTokens, Refusal:
		res.StopReason = out.StopReason
	case "model_context_window_exceeded":
		res.StopReason = MaxTokens
	default:
		res.StopReason = EndTurn
	}

	// After a fallback, what the declining model wrote before the hand-over must not be
	// sent back: thinking and tool calls ahead of the last fallback block are left out,
	// and the fallback block keeps its place. Doing it here lets the agent echo the turn
	// as it received it.
	lastFallback := -1
	types := make([]string, len(out.Content))
	for i, raw := range out.Content {
		var head struct {
			Type string `json:"type"`
		}
		json.Unmarshal(raw, &head)
		types[i] = head.Type
		if head.Type == "fallback" {
			lastFallback = i
		}
	}
	for i, raw := range out.Content {
		switch t := types[i]; {
		case t == Text:
			var b struct {
				Text string `json:"text"`
			}
			json.Unmarshal(raw, &b)
			res.Content = append(res.Content, Block{Type: Text, Text: b.Text})
		case t == ToolUse && i > lastFallback:
			var b struct {
				ID    string          `json:"id"`
				Name  string          `json:"name"`
				Input json.RawMessage `json:"input"`
			}
			json.Unmarshal(raw, &b)
			input, ok := object(b.Input)
			if !ok {
				return nil, &Error{Code: Failed, Status: status, Message: "the model wrote a tool call that is not a JSON object"}
			}
			res.Content = append(res.Content, Block{Type: ToolUse, ID: b.ID, Name: b.Name, Input: input})
		case t == "fallback" || (anthropicKept[t] && i > lastFallback):
			res.Content = append(res.Content, Block{Type: t, Raw: raw, Origin: Anthropic})
		}
	}
	return res, nil
}

func anthropicMessages(msgs []Message) []map[string]any {
	out := make([]map[string]any, 0, len(msgs))
	for _, m := range msgs {
		content := make([]any, 0, len(m.Blocks))
		for _, b := range m.Blocks {
			switch {
			case b.Type == Text:
				if b.Text != "" {
					content = append(content, map[string]any{"type": Text, "text": b.Text})
				}
			case b.Type == ToolUse:
				content = append(content, map[string]any{"type": ToolUse, "id": b.ID, "name": b.Name, "input": b.Input})
			case b.Type == ToolResult:
				r := map[string]any{"type": ToolResult, "tool_use_id": b.ToolUseID, "content": b.Content}
				if b.IsError {
					r["is_error"] = true
				}
				content = append(content, r)
			case anthropicKept[b.Type] && b.Origin == Anthropic && m.Role == "assistant":
				// Sent back exactly as it came: the API rejects one that was changed.
				content = append(content, b.Raw)
			}
		}
		if len(content) == 0 {
			// A turn left empty by dropped blocks still has to hold its place.
			content = append(content, map[string]any{"type": Text, "text": "(nothing)"})
		}
		out = append(out, map[string]any{"role": m.Role, "content": content})
	}
	return out
}
