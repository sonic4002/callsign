package room

import (
	"testing"

	"callsign/server/bot"
)

// The brains that need no key read two things from the lobby: how much the rule-brain
// operator does on its own, and whether squads take orders through the fast brain. The
// maker of a match chooses both; the server's own settings stand in when they do not.
func TestTheBrainsSettingsArePerRoomAndShownInTheLobby(t *testing.T) {
	h := newHub(t, HubConfig{})
	usual, _, _, err := h.Create(Options{Opponent: OpponentFriend, Side: 0})
	if err != nil {
		t.Fatal(err)
	}
	if l := usual.Lobby(); l.Anvil != 3 || l.Fast {
		t.Fatalf("a match made without a choice: anvil %d, fast %v", l.Anvil, l.Fast)
	}
	on := true
	chosen, _, _, err := h.Create(Options{Opponent: OpponentFriend, Side: 0, Anvil: 1, Fast: &on})
	if err != nil {
		t.Fatal(err)
	}
	if l := chosen.Lobby(); l.Anvil != 1 || !l.Fast {
		t.Fatalf("a match made with a choice: anvil %d, fast %v", l.Anvil, l.Fast)
	}
	for _, bad := range []int{-1, 4} {
		if _, _, _, err := h.Create(Options{Opponent: OpponentFriend, Side: 0, Anvil: bad}); err == nil {
			t.Fatalf("an operator level of %d was accepted", bad)
		}
	}

	// The host's settings are the usual ones, and the maker of a match may still turn the fast brain off.
	hosted := newHub(t, HubConfig{Anvil: 2, Fast: true})
	usual, _, _, err = hosted.Create(Options{Opponent: OpponentFriend, Side: 0})
	if err != nil {
		t.Fatal(err)
	}
	if l := usual.Lobby(); l.Anvil != 2 || !l.Fast {
		t.Fatalf("the host's usual: anvil %d, fast %v", l.Anvil, l.Fast)
	}
	off := false
	plain, _, _, err := hosted.Create(Options{Opponent: OpponentFriend, Side: 0, Fast: &off})
	if err != nil {
		t.Fatal(err)
	}
	if plain.Lobby().Fast {
		t.Fatal("the maker turned the fast brain off, and it is on")
	}
	// A lesson spends nothing, whatever the host's usual is.
	lesson, _, _, err := hosted.Create(Options{Opponent: OpponentBot, Side: 0, Bot: bot.Tutorial})
	if err != nil {
		t.Fatal(err)
	}
	if lesson.Lobby().Fast {
		t.Fatal("a lesson uses the fast brain")
	}
}
