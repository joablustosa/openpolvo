package engine

import (
	"strings"
	"testing"

	wfports "github.com/open-polvo/open-polvo/internal/workflows/ports"
)

func TestFormatSerpMarkdown_snippets(t *testing.T) {
	hits := []wfports.WebSearchOrganicHit{
		{Title: "A", Link: "https://a.example/x", Snippet: "alpha snippet"},
		{Title: "B", Link: "https://b.example/y", Snippet: "beta"},
	}
	s := FormatSerpMarkdown(hits, "Resultados", 2)
	for _, sub := range []string{"https://a.example/x", "alpha snippet", "https://b.example/y", "beta"} {
		if !strings.Contains(s, sub) {
			t.Fatalf("missing %q in:\n%s", sub, s)
		}
	}
}
