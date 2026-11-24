// Package provider turns one thought, the game's own request shape, into a call to an AI
// provider and the answer back. The shape follows Anthropic's Messages API because the
// agents were written against it; every other provider is translated to and from it.
//
// A provider here can reach exactly one host, written into this package. Nothing a caller
// sends chooses the address, and redirects are never followed, so a player's key can only
// ever travel to the provider it belongs to.
package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Block types the agents use.
const (
	Text       = "text"
	ToolUse    = "tool_use"
	ToolResult = "tool_result"
	// State is what a provider needs back unchanged to continue a turn it started and has
	// no place in the three types above (Gemini's thought steps and their signatures).
	// Anthropic's own such blocks (thinking, redacted_thinking, fallback) keep their type.
	State = "relay_state"
)

// Stop reasons, as the agents read them.
const (
	EndTurn   = "end_turn"
	StopTool  = "tool_use"
	MaxTokens = "max_tokens"
	Refusal   = "refusal"
)

// Block is one piece of a message. Which fields are set depends on Type.
type Block struct {
	Type string

	Text string // Text

	ID    string          // ToolUse
	Name  string          // ToolUse
	Input json.RawMessage // ToolUse: a JSON object

	ToolUseID string // ToolResult
	Content   string // ToolResult
	IsError   bool   // ToolResult

	// Raw is the whole block as its provider wrote it, for the types that must go back
	// unchanged: Anthropic's thinking, redacted_thinking and fallback, and State.
	Raw json.RawMessage
	// Origin names the provider a Raw block belongs to. Every other provider drops it.
	Origin string
}

type Message struct {
	Role   string // "user" or "assistant"
	Blocks []Block
}

type Tool struct {
	Name        string
	Description string
	InputSchema json.RawMessage
	Strict      bool
}

// Request is one thought. The relay fills Model, Effort and MaxTokens; a caller never does.
type Request struct {
	Model     string
	Effort    string // low, medium or high
	MaxTokens int
	System    string
	Tools     []Tool
	Messages  []Message
}

type Response struct {
	Content      []Block
	StopReason   string
	InputTokens  int
	OutputTokens int
	Model        string // the model that answered, as the provider names it
}

// Error codes a provider call can end in.
const (
	BadKey      = "bad_key"        // the provider will not take this key
	RateLimited = "rate_limited"   // the key's own limits at the provider
	Overloaded  = "overloaded"     // the provider is busy or failing: worth one more try
	Failed      = "provider_error" // anything else
)

type Error struct {
	Code       string
	Status     int // the provider's HTTP status, 0 when the call never got one
	Message    string
	RetryAfter time.Duration
}

func (e *Error) Error() string {
	if e.Status == 0 {
		return e.Message
	}
	return fmt.Sprintf("%s (HTTP %d)", e.Message, e.Status)
}

// Provider calls one AI provider with the player's key.
type Provider interface {
	Name() string
	Think(ctx context.Context, key string, req Request) (*Response, error)
}

// The four providers and the one address each can reach.
const (
	Anthropic  = "anthropic"
	OpenRouter = "openrouter"
	OpenAI     = "openai"
	Gemini     = "gemini"

	anthropicURL  = "https://api.anthropic.com/v1/messages"
	openRouterURL = "https://openrouter.ai/api/v1/chat/completions"
	openAIURL     = "https://api.openai.com/v1/chat/completions"
	geminiURL     = "https://generativelanguage.googleapis.com/v1beta/interactions"
)

// Names lists the providers in a fixed order.
var Names = []string{Anthropic, OpenRouter, OpenAI, Gemini}

// All builds every provider on one transport. Pass nil for the real network. Tests pass a
// transport that answers in the provider's place; the addresses above stay what they are.
func All(transport http.RoundTripper) map[string]Provider {
	c := newCaller(transport)
	return map[string]Provider{
		Anthropic:  &anthropic{c},
		OpenRouter: &chat{caller: c, name: OpenRouter, url: openRouterURL, systemRole: "system", limitField: "max_tokens"},
		OpenAI:     &chat{caller: c, name: OpenAI, url: openAIURL, systemRole: "developer", limitField: "max_completion_tokens", strict: true},
		Gemini:     &gemini{c},
	}
}

// Transport is the network the relay uses for providers: TLS only in practice (the
// addresses are https), no proxy taken from the environment, and bounded waits.
func Transport() *http.Transport {
	return &http.Transport{
		Proxy:                 nil,
		DialContext:           (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 90 * time.Second,
		MaxIdleConnsPerHost:   16,
		IdleConnTimeout:       90 * time.Second,
		ForceAttemptHTTP2:     true,
	}
}

const maxAnswer = 4 << 20 // bytes of a provider's answer that are read

type caller struct{ http *http.Client }

func newCaller(transport http.RoundTripper) *caller {
	if transport == nil {
		transport = Transport()
	}
	return &caller{http: &http.Client{
		Transport: transport,
		// A redirect would carry the key's header to another address.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

// post sends one JSON body and returns the status, the headers and the answer's bytes.
func (c *caller) post(ctx context.Context, url string, header http.Header, body any) (int, http.Header, []byte, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return 0, nil, nil, &Error{Code: Failed, Message: "could not write the request: " + err.Error()}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return 0, nil, nil, &Error{Code: Failed, Message: err.Error()}
	}
	req.Header = header
	req.Header.Set("Content-Type", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		// The error text of net/http names the URL, never a header, so no key is in it.
		code := Overloaded
		if errors.Is(err, context.Canceled) {
			code = Failed
		}
		return 0, nil, nil, &Error{Code: code, Message: "the provider could not be reached: " + reason(err)}
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, maxAnswer+1))
	if err != nil {
		return 0, nil, nil, &Error{Code: Overloaded, Status: res.StatusCode, Message: "the provider's answer broke off"}
	}
	if len(data) > maxAnswer {
		return 0, nil, nil, &Error{Code: Failed, Status: res.StatusCode, Message: "the provider's answer was too large"}
	}
	return res.StatusCode, res.Header, data, nil
}

func reason(err error) string {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return "timed out"
	case errors.Is(err, context.Canceled):
		return "cancelled"
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return "timed out"
	}
	return "connection failed"
}

// retryAfter reads a Retry-After header given in seconds.
func retryAfter(h http.Header) time.Duration {
	n, err := strconv.ParseFloat(strings.TrimSpace(h.Get("Retry-After")), 64)
	if err != nil || n <= 0 {
		return 0
	}
	return time.Duration(n * float64(time.Second))
}

// clip keeps a provider's message short enough to pass on.
func clip(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > 300 {
		return string(r[:300]) + "…"
	}
	return s
}

// statusError is the usual reading of a failed call, shared by the providers.
func statusError(status int, h http.Header, message string) *Error {
	e := &Error{Status: status, Message: clip(message), RetryAfter: retryAfter(h)}
	if e.Message == "" {
		e.Message = "the provider answered " + strconv.Itoa(status)
	}
	switch {
	case status == http.StatusUnauthorized || status == http.StatusPaymentRequired || status == http.StatusForbidden:
		e.Code = BadKey
	case status == http.StatusTooManyRequests:
		e.Code = RateLimited
	case status == http.StatusRequestTimeout || status >= 500:
		e.Code = Overloaded
	default:
		e.Code = Failed
	}
	return e
}

// emptyObject is what a tool call with no arguments carries.
var emptyObject = json.RawMessage(`{}`)

// object returns raw when it is a JSON object, and reports whether it was.
func object(raw json.RawMessage) (json.RawMessage, bool) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return emptyObject, true
	}
	var m map[string]json.RawMessage
	if json.Unmarshal(trimmed, &m) != nil || m == nil {
		return nil, false
	}
	return json.RawMessage(trimmed), true
}
