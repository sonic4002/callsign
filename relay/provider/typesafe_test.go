package provider

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func decision() Decision {
	return Decision{
		Model:        "jev-1.14.0",
		State:        json.RawMessage(`{"situation":{"you":"Viper 1"},"radio_call":"push up to the town"}`),
		Instructions: "Which single action does the radio call order?",
		Options:      map[string]string{"hold:F": "go to Foxtrot and defend it", "say_again": "the call is unclear"},
	}
}

const jevAnswer = `{"model":"jev-1.14.0","answers":{"order":{"type":"choice","choice":"hold:F","confidence":0.93,"probabilities":{"hold:F":0.97,"say_again":0.03}}},"usage":{"input_tokens":1312,"output_tokens":0}}`

func TestTypeSafeRequestAndAnswer(t *testing.T) {
	w := &wire{t: t, answers: []answer{ok(jevAnswer)}}
	res, err := NewTypeSafe(w).Decide(context.Background(), key, decision())
	if err != nil {
		t.Fatal(err)
	}
	got := w.seen[0]
	if got.method != "POST" || got.url != "https://api.typesafe.ai/v1/systemone" {
		t.Fatalf("called %s %s", got.method, got.url)
	}
	if got.header.Get("Authorization") != "Bearer "+key || strings.Contains(got.raw, key) || strings.Contains(got.url, key) {
		t.Fatal("the key travels in the Authorization header and nowhere else")
	}
	same(t, "request", got.body, `{
		"model": "jev-1.14.0",
		"state": {"situation": {"you": "Viper 1"}, "radio_call": "push up to the town"},
		"questions": {"order": {"type": "choice", "instructions": "Which single action does the radio call order?",
			"criteria": {"hold:F": "go to Foxtrot and defend it", "say_again": "the call is unclear"}}}
	}`)
	if res.Choice != "hold:F" || res.Confidence != 0.93 || res.Probabilities["hold:F"] != 0.97 || res.InputTokens != 1312 || res.Model != "jev-1.14.0" {
		t.Fatalf("answer = %+v", res)
	}
}

func TestTypeSafeErrorsAndOddAnswers(t *testing.T) {
	cases := []struct {
		name   string
		answer answer
		code   string
		status int
	}{
		{"a bad key", answer{status: 401, body: `{"error":{"message":"invalid key"}}`}, BadKey, 401},
		{"rate limited", answer{status: 429, header: map[string]string{"Retry-After": "2"}, body: `{}`}, RateLimited, 429},
		{"overloaded", answer{status: 529, body: `{"message":"overloaded"}`}, Overloaded, 529},
		{"a broken rule", answer{status: 422, body: `{"error":{"message":"questions.order.criteria: too many"}}`}, Failed, 422},
		{"a redirect", answer{status: 307, header: map[string]string{"Location": "https://elsewhere.example/steal"}, body: `{}`}, Failed, 307},
		{"not JSON", ok(`<html>`), Failed, 200},
		{"a refusal", ok(`{"answers":{"order":{"type":"refusal"}}}`), Failed, 200},
		{"an option that was never offered", ok(`{"answers":{"order":{"type":"choice","choice":"attack:Z"}}}`), Failed, 200},
	}
	for _, c := range cases {
		w := &wire{t: t, answers: []answer{c.answer}}
		_, err := NewTypeSafe(w).Decide(context.Background(), key, decision())
		e := wantError(t, err, c.code, c.status)
		if c.name == "rate limited" && e.RetryAfter == 0 {
			t.Errorf("%s: Retry-After was dropped", c.name)
		}
		if len(w.seen) != 1 {
			t.Errorf("%s: %d requests, want 1", c.name, len(w.seen))
		}
	}
	// No options, no call.
	w := &wire{t: t}
	if _, err := NewTypeSafe(w).Decide(context.Background(), key, Decision{Model: "m"}); err == nil || len(w.seen) != 0 {
		t.Fatal("a decision with no options was sent")
	}
}
