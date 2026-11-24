package relay

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"callsign/relay/provider"
)

// Limits on one thought. They are far above what an agent sends (a system prompt of a few
// kilobytes, six tools, a conversation reset every fifteen wakes) and far below what could
// be used to run up a bill or to tunnel something else through the relay.
const (
	maxBody      = 512 << 10 // bytes of a request
	maxSystem    = 64 << 10
	maxTools     = 32
	maxSchema    = 16 << 10
	maxMessages  = 400
	maxBlocks    = 64
	maxText      = 128 << 10
	maxKeptBlock = 256 << 10 // a thinking or state block sent back unchanged
)

var (
	toolName = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	callID   = regexp.MustCompile(`^[A-Za-z0-9_.:=+/-]{1,256}$`)
	roomCode = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
)

// thinkRequest is the body of POST /relay/v1/think. There is no model, no token cap and no
// address in it: the relay decides those.
type thinkRequest struct {
	Room     string        `json:"room"`
	Side     *int          `json:"side"`
	Role     string        `json:"role"`
	Squad    int           `json:"squad"`
	System   string        `json:"system"`
	Tools    []wireTool    `json:"tools"`
	Messages []wireMessage `json:"messages"`
}

type wireTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
	Strict      bool            `json:"strict"`
}

type wireMessage struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

type wireBlock struct {
	Type      string          `json:"type"`
	Text      string          `json:"text"`
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Input     json.RawMessage `json:"input"`
	ToolUseID string          `json:"tool_use_id"`
	Content   json.RawMessage `json:"content"`
	IsError   bool            `json:"is_error"`
	Provider  string          `json:"provider"`
}

// Anthropic's blocks that go back to it unchanged, and nowhere else.
var keptTypes = map[string]bool{"thinking": true, "redacted_thinking": true, "fallback": true}

// parseThink reads and checks a request. What it returns was rebuilt field by field: a
// field the relay does not know is refused at the top level and in a tool, and dropped
// inside a message block, so nothing unexpected reaches a provider.
func parseThink(body []byte) (*thinkRequest, provider.Request, error) {
	var in thinkRequest
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		return nil, provider.Request{}, fmt.Errorf("the request is not the expected JSON: %s", plain(err))
	}
	if dec.More() {
		return nil, provider.Request{}, errors.New("the request holds more than one JSON value")
	}
	switch {
	case !roomCode.MatchString(in.Room):
		return nil, provider.Request{}, errors.New(`"room" must be the room's code`)
	case in.Side == nil || (*in.Side != 0 && *in.Side != 1):
		return nil, provider.Request{}, errors.New(`"side" must be 0 or 1`)
	case in.Role != "anvil" && in.Role != "squad":
		return nil, provider.Request{}, errors.New(`"role" must be "anvil" or "squad"`)
	case in.Role == "squad" && in.Squad <= 0:
		return nil, provider.Request{}, errors.New(`a squad's request needs its "squad" id`)
	case in.Role == "anvil" && in.Squad != 0:
		return nil, provider.Request{}, errors.New(`the operator's request has "squad": 0`)
	case len(in.System) > maxSystem:
		return nil, provider.Request{}, errors.New(`"system" is too long`)
	case len(in.Tools) > maxTools:
		return nil, provider.Request{}, errors.New("too many tools")
	case len(in.Messages) == 0:
		return nil, provider.Request{}, errors.New(`"messages" is empty`)
	case len(in.Messages) > maxMessages:
		return nil, provider.Request{}, errors.New("too many messages")
	}

	out := provider.Request{System: in.System}
	seen := map[string]bool{}
	for _, t := range in.Tools {
		schema, ok := jsonObject(t.InputSchema)
		switch {
		case !toolName.MatchString(t.Name):
			return nil, out, fmt.Errorf("tool name %q is not allowed", t.Name)
		case seen[t.Name]:
			return nil, out, fmt.Errorf("tool %q is defined twice", t.Name)
		case len(t.Description) > maxSchema:
			return nil, out, fmt.Errorf("the description of tool %q is too long", t.Name)
		case !ok || len(schema) > maxSchema:
			return nil, out, fmt.Errorf(`tool %q needs an "input_schema" object of reasonable size`, t.Name)
		}
		seen[t.Name] = true
		out.Tools = append(out.Tools, provider.Tool{Name: t.Name, Description: t.Description, InputSchema: schema, Strict: t.Strict})
	}

	for i, m := range in.Messages {
		if m.Role != "user" && m.Role != "assistant" {
			return nil, out, fmt.Errorf(`message %d: "role" must be "user" or "assistant"`, i)
		}
		if i == 0 && m.Role != "user" {
			return nil, out, errors.New("the first message must be the user's")
		}
		blocks, err := parseContent(m.Role, m.Content)
		if err != nil {
			return nil, out, fmt.Errorf("message %d: %w", i, err)
		}
		out.Messages = append(out.Messages, provider.Message{Role: m.Role, Blocks: blocks})
	}
	return &in, out, nil
}

func parseContent(role string, raw json.RawMessage) ([]provider.Block, error) {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		if len(text) > maxText {
			return nil, errors.New("the text is too long")
		}
		return []provider.Block{{Type: provider.Text, Text: text}}, nil
	}
	var items []json.RawMessage
	if json.Unmarshal(raw, &items) != nil {
		return nil, errors.New(`"content" must be a string or a list of blocks`)
	}
	if len(items) > maxBlocks {
		return nil, errors.New("too many blocks")
	}
	var out []provider.Block
	for _, item := range items {
		var b wireBlock
		if json.Unmarshal(item, &b) != nil {
			return nil, errors.New("a block is not an object")
		}
		switch {
		case b.Type == provider.Text:
			if len(b.Text) > maxText {
				return nil, errors.New("a text block is too long")
			}
			out = append(out, provider.Block{Type: provider.Text, Text: b.Text})
		case b.Type == provider.ToolUse:
			input, ok := jsonObject(b.Input)
			if role != "assistant" || !callID.MatchString(b.ID) || !toolName.MatchString(b.Name) || !ok || len(input) > maxText {
				return nil, errors.New("a tool_use block needs an id, a tool name and an input object, in an assistant message")
			}
			out = append(out, provider.Block{Type: provider.ToolUse, ID: b.ID, Name: b.Name, Input: input})
		case b.Type == provider.ToolResult:
			content, ok := resultText(b.Content)
			if role != "user" || !callID.MatchString(b.ToolUseID) || !ok || len(content) > maxText {
				return nil, errors.New("a tool_result block needs a tool_use_id and text content, in a user message")
			}
			out = append(out, provider.Block{Type: provider.ToolResult, ToolUseID: b.ToolUseID, Content: content, IsError: b.IsError})
		case role == "assistant" && keptTypes[b.Type] && len(item) <= maxKeptBlock:
			out = append(out, provider.Block{Type: b.Type, Raw: item, Origin: provider.Anthropic})
		case role == "assistant" && b.Type == provider.State && len(item) <= maxKeptBlock:
			out = append(out, provider.Block{Type: provider.State, Raw: item, Origin: b.Provider})
		default:
			// A block type the relay does not carry (or one in the wrong place) is left
			// out, never passed on.
		}
	}
	return out, nil
}

// resultText reads a tool result given as a string or as a list of text blocks.
func resultText(raw json.RawMessage) (string, bool) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return "", true
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s, true
	}
	var parts []wireBlock
	if json.Unmarshal(raw, &parts) != nil {
		return "", false
	}
	var texts []string
	for _, p := range parts {
		if p.Type != provider.Text {
			return "", false
		}
		texts = append(texts, p.Text)
	}
	return strings.Join(texts, "\n"), true
}

func jsonObject(raw json.RawMessage) (json.RawMessage, bool) {
	var m map[string]json.RawMessage
	if json.Unmarshal(raw, &m) != nil || m == nil {
		return nil, false
	}
	return json.RawMessage(bytes.TrimSpace(raw)), true
}

// plain strips the Go type names out of a decoding error.
func plain(err error) string {
	s := err.Error()
	s = strings.TrimPrefix(s, "json: ")
	return strings.ReplaceAll(s, "Go struct field thinkRequest.", "field ")
}

// thinkReply is the body of a successful answer.
type thinkReply struct {
	Content    []json.RawMessage `json:"content"`
	StopReason string            `json:"stop_reason"`
	Usage      usage             `json:"usage"`
	Model      string            `json:"model"`
	Provider   string            `json:"provider"`
}

type usage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

func reply(name string, res *provider.Response) thinkReply {
	out := thinkReply{
		Content:    []json.RawMessage{},
		StopReason: res.StopReason,
		Usage:      usage{res.InputTokens, res.OutputTokens},
		Model:      res.Model,
		Provider:   name,
	}
	for _, b := range res.Content {
		var raw json.RawMessage
		switch b.Type {
		case provider.Text:
			raw, _ = json.Marshal(map[string]string{"type": provider.Text, "text": b.Text})
		case provider.ToolUse:
			raw, _ = json.Marshal(map[string]any{"type": provider.ToolUse, "id": b.ID, "name": b.Name, "input": b.Input})
		default:
			raw = b.Raw
		}
		out.Content = append(out.Content, raw)
	}
	return out
}
