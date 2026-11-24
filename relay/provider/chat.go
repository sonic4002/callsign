package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
)

// chat calls a Chat Completions endpoint: OpenAI's own, and OpenRouter's, which keeps the
// same shape. The two differ in the address, the role that carries the system prompt
// ("developer" on OpenAI's current models), the name of the output cap, and whether
// strict tool schemas are passed on.
//
// Shapes from OpenAI's Chat Completions reference and OpenRouter's chat completion,
// tool calling and errors pages: tools are {type:"function", function:{name, description,
// parameters}}; the model's calls come back as message.tool_calls with the arguments as a
// JSON string; each result goes back as its own {role:"tool", tool_call_id} message.
type chat struct {
	*caller
	name       string
	url        string
	systemRole string
	limitField string
	strict     bool
}

func (c *chat) Name() string { return c.name }

type chatCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type chatError struct {
	// OpenAI writes the code as a string ("insufficient_quota"), OpenRouter as a number.
	Code     json.RawMessage `json:"code"`
	Message  string          `json:"message"`
	Type     string          `json:"type"`
	Metadata struct {
		ErrorType string `json:"error_type"`
	} `json:"metadata"`
}

func (c *chat) Think(ctx context.Context, key string, req Request) (*Response, error) {
	body := map[string]any{
		"model":            req.Model,
		"messages":         c.messages(req),
		c.limitField:       req.MaxTokens,
		"reasoning_effort": req.Effort,
	}
	if len(req.Tools) > 0 {
		tools := make([]map[string]any, 0, len(req.Tools))
		for _, t := range req.Tools {
			fn := map[string]any{"name": t.Name, "description": t.Description, "parameters": t.InputSchema}
			if t.Strict && c.strict {
				fn["strict"] = true
			}
			tools = append(tools, map[string]any{"type": "function", "function": fn})
		}
		body["tools"] = tools
	}
	header := http.Header{}
	header.Set("Authorization", "Bearer "+key)

	status, h, data, err := c.post(ctx, c.url, header, body)
	if err != nil {
		return nil, err
	}
	var out struct {
		Model   string     `json:"model"`
		Error   *chatError `json:"error"`
		Choices []struct {
			FinishReason string     `json:"finish_reason"`
			Error        *chatError `json:"error"`
			Message      struct {
				Content   *string    `json:"content"`
				Refusal   *string    `json:"refusal"`
				ToolCalls []chatCall `json:"tool_calls"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			Prompt     int `json:"prompt_tokens"`
			Completion int `json:"completion_tokens"`
		} `json:"usage"`
	}
	parsed := json.Unmarshal(data, &out) == nil
	if status != http.StatusOK {
		if out.Error == nil {
			return nil, statusError(status, h, "")
		}
		return c.failure(status, h, out.Error)
	}
	if !parsed {
		return nil, &Error{Code: Failed, Status: status, Message: "the provider's answer was not understood"}
	}
	// OpenRouter can answer 200 and still carry an error: at the top when the provider
	// failed after the headers went out, or on the choice beside partial output.
	if out.Error != nil {
		return c.failure(codeStatus(out.Error, http.StatusBadGateway), h, out.Error)
	}
	if len(out.Choices) == 0 {
		return nil, &Error{Code: Failed, Status: status, Message: "the provider answered with no choices"}
	}
	choice := out.Choices[0]
	if choice.Error != nil {
		return c.failure(codeStatus(choice.Error, http.StatusBadGateway), h, choice.Error)
	}

	res := &Response{Model: out.Model, InputTokens: out.Usage.Prompt, OutputTokens: out.Usage.Completion}
	if choice.Message.Content != nil && *choice.Message.Content != "" {
		res.Content = append(res.Content, Block{Type: Text, Text: *choice.Message.Content})
	}
	for _, call := range choice.Message.ToolCalls {
		input, ok := object(json.RawMessage(call.Function.Arguments))
		if !ok {
			return nil, &Error{Code: Failed, Status: status, Message: "the model wrote a tool call that is not a JSON object"}
		}
		res.Content = append(res.Content, Block{Type: ToolUse, ID: call.ID, Name: call.Function.Name, Input: input})
	}
	refused := choice.Message.Refusal != nil && *choice.Message.Refusal != ""
	switch {
	case refused || choice.FinishReason == "content_filter":
		res.StopReason = Refusal
		res.Content = nil // nothing a declining model wrote is acted on
	case len(choice.Message.ToolCalls) > 0:
		res.StopReason = StopTool
	case choice.FinishReason == "length":
		res.StopReason = MaxTokens
	default:
		res.StopReason = EndTurn
	}
	return res, nil
}

// failure reads an error body. A refusal that OpenRouter reports as an error is still an
// answer, not a fault.
func (c *chat) failure(status int, h http.Header, e *chatError) (*Response, error) {
	if t := e.Metadata.ErrorType; t == "refusal" || t == "content_policy_violation" {
		return &Response{StopReason: Refusal}, nil
	}
	err := statusError(status, h, e.Message)
	// OpenAI answers 429 both for going too fast and for an account with no credit left.
	// The second will not pass on a retry: it is the key that cannot be used.
	if code := strings.Trim(string(e.Code), `"`); code == "insufficient_quota" || e.Type == "insufficient_quota" {
		err.Code = BadKey
	}
	return nil, err
}

// codeStatus reads the HTTP-like number OpenRouter puts in an error inside a 200 answer.
func codeStatus(e *chatError, fallback int) int {
	var n int
	if json.Unmarshal(e.Code, &n) == nil && n >= 400 && n <= 599 {
		return n
	}
	return fallback
}

func (c *chat) messages(req Request) []map[string]any {
	var out []map[string]any
	if req.System != "" {
		out = append(out, map[string]any{"role": c.systemRole, "content": req.System})
	}
	for _, m := range req.Messages {
		var text []string
		var calls []map[string]any
		for _, b := range m.Blocks {
			switch b.Type {
			case Text:
				if b.Text != "" {
					text = append(text, b.Text)
				}
			case ToolUse:
				if m.Role == "assistant" {
					calls = append(calls, map[string]any{
						"id": b.ID, "type": "function",
						"function": map[string]any{"name": b.Name, "arguments": string(b.Input)},
					})
				}
			case ToolResult:
				// Results come first: they must follow the calls they answer directly.
				content := b.Content
				if b.IsError {
					content = "Error: " + content
				}
				out = append(out, map[string]any{"role": "tool", "tool_call_id": b.ToolUseID, "content": content})
			}
		}
		joined := strings.Join(text, "\n\n")
		switch {
		case m.Role == "assistant" && len(calls) > 0:
			msg := map[string]any{"role": "assistant", "tool_calls": calls, "content": nil}
			if joined != "" {
				msg["content"] = joined
			}
			out = append(out, msg)
		case joined != "":
			out = append(out, map[string]any{"role": m.Role, "content": joined})
		case m.Role == "assistant":
			// A turn that said nothing still has to hold its place between the user's.
			out = append(out, map[string]any{"role": "assistant", "content": "(nothing)"})
		}
	}
	return out
}
