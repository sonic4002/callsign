// Command parsecalls reads radio calls as the net reads them: a JSON list of texts on
// standard input, and for each the body, language, ending, procedure words, map points
// and landmarks on standard output. agents/test/fixtures/orders.json was made with it, so
// that the brains' tests read exactly what the game server would hand an agent.
//
//	go run ./tools/parsecalls [-map small] < texts.json > parsed.json
package main

import (
	"encoding/json"
	"flag"
	"log"
	"os"

	"callsign/server/radio"
	"callsign/shared"
)

func main() {
	mapID := flag.String("map", shared.DefaultMap, "the map whose points and landmarks are named")
	flag.Parse()
	rules, err := shared.Load()
	if err != nil {
		log.Fatal(err)
	}
	m, ok := rules.Maps[*mapID]
	if !ok {
		log.Fatalf("no map %q", *mapID)
	}
	rules.Map = *m
	net := radio.NewNet(rules)
	var texts []string
	if err := json.NewDecoder(os.Stdin).Decode(&texts); err != nil {
		log.Fatal(err)
	}
	type parsed struct {
		Body      string   `json:"body"`
		Lang      string   `json:"lang"`
		End       string   `json:"end"`
		Prowords  []string `json:"prowords"`
		Points    []string `json:"points"`
		Landmarks []string `json:"landmarks"`
	}
	out := make([]parsed, 0, len(texts))
	for _, text := range texts {
		p, err := net.Parse(text)
		if err != nil {
			log.Fatalf("%q: %v", text, err)
		}
		out = append(out, parsed{p.Body, p.Lang, p.End, orEmpty(p.Prowords), orEmpty(p.Points), orEmpty(p.Landmarks)})
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(out); err != nil {
		log.Fatal(err)
	}
}

func orEmpty(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
