package polvointel

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	agentports "github.com/open-polvo/open-polvo/internal/agent/ports"
	"github.com/open-polvo/open-polvo/internal/conversations/domain"
)

func TestClientReply(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Open-Polvo-Internal-Key") != "secret" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.URL.Path != "/v1/reply" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"assistant_text": "olá",
			"metadata":       map[string]any{"intent": "geral"},
		})
	}))
	defer srv.Close()

	c := New(srv.URL, "secret", 5*time.Second)
	if c == nil {
		t.Fatal("expected client")
	}
	var _ agentports.ChatOrchestrator = c

	out, meta, err := c.Reply(context.Background(), agentports.ReplyInput{
		Messages: []domain.Message{
			{ID: uuid.New(), Role: "user", Content: "hi"},
		},
		ModelProvider: domain.ModelOpenAI,
	})
	if err != nil {
		t.Fatal(err)
	}
	if out != "olá" {
		t.Fatalf("got %q", out)
	}
	if meta["intent"] != "geral" {
		t.Fatalf("meta: %v", meta)
	}
}

func TestNewReturnsNilWhenIncomplete(t *testing.T) {
	t.Parallel()
	if New("", "k", time.Second) != nil {
		t.Fatal("expected nil")
	}
	if New("http://x", "", time.Second) != nil {
		t.Fatal("expected nil")
	}
}
