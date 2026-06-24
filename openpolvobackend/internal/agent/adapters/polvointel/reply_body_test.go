package polvointel

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	agentports "github.com/open-polvo/open-polvo/internal/agent/ports"
	"github.com/open-polvo/open-polvo/internal/conversations/domain"
)

func TestMarshalReplyBodyDeskOmitsLegacyFields(t *testing.T) {
	t.Parallel()
	in := agentports.ReplyInput{
		Messages: []domain.Message{
			{ID: uuid.New(), Role: "user", Content: "olá"},
		},
		ModelProvider: domain.ModelOllama,
		DeskContext: map[string]any{
			"mode":            "agent",
			"workspace_path":  "/tmp/ws",
			"conversation_id": "abc",
		},
		SMTP:               &agentports.SMTPContext{FromEmail: "a@b.c"},
		SandboxProjectID:   "sandbox-1",
		ProjectFileTree:    []string{"src/main.ts"},
		ProjectFiles:       map[string]string{"src/main.ts": "x"},
		DevStudioContext:   map[string]any{"k": "v"},
		CompileLog:         "err",
	}
	raw, err := marshalReplyBody(in)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	if _, ok := m["desk_context"]; !ok {
		t.Fatal("expected desk_context")
	}
	for _, key := range []string{
		"finance_context", "meta_context",
		"sandbox_project_id", "project_file_tree", "project_files",
		"dev_studio_context", "compile_log", "contacts_context",
	} {
		if _, ok := m[key]; ok {
			t.Fatalf("legacy field %q should be omitted in desk mode", key)
		}
	}
}

func TestMarshalReplyBodyDeskContextFields(t *testing.T) {
	t.Parallel()
	in := agentports.ReplyInput{
		Messages:      []domain.Message{{ID: uuid.New(), Role: "user", Content: "hi"}},
		ModelProvider: domain.ModelOllama,
		DeskContext: map[string]any{
			"mode":            "agent",
			"workspace_path":  "C:\\repo",
			"conversation_id": "id-1",
		},
		AgentMemory: &agentports.AgentMemoryIn{Global: "prefs", Builder: "stack"},
	}
	raw, err := marshalReplyBody(in)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	dc, ok := m["desk_context"].(map[string]any)
	if !ok {
		t.Fatalf("desk_context: %v", m["desk_context"])
	}
	if dc["mode"] != "agent" {
		t.Fatalf("mode: %v", dc["mode"])
	}
	mem, ok := m["agent_memory"].(map[string]any)
	if !ok || mem["global"] != "prefs" {
		t.Fatalf("agent_memory: %v", m["agent_memory"])
	}
}

func TestMarshalReplyBodyDeskIncludesSmtp(t *testing.T) {
	t.Parallel()
	in := agentports.ReplyInput{
		Messages:      []domain.Message{{ID: uuid.New(), Role: "user", Content: "envia email"}},
		ModelProvider: domain.ModelOllama,
		DeskContext:   map[string]any{"mode": "agent"},
		SMTP:          &agentports.SMTPContext{Configured: true, FromEmail: "a@b.c", Host: "smtp.test", Port: 587},
	}
	raw, err := marshalReplyBody(in)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	sc, ok := m["smtp_context"].(map[string]any)
	if !ok || sc["from_email"] != "a@b.c" {
		t.Fatalf("expected smtp_context, got %v", m["smtp_context"])
	}
}

func TestStripLegacyContextsForDesk(t *testing.T) {
	t.Parallel()
	in := agentports.ReplyInput{
		DeskContext:      map[string]any{"mode": "agent"},
		SMTP:             &agentports.SMTPContext{FromEmail: "a@b.c"},
		SandboxProjectID: "x",
		CompileLog:       "log",
	}
	StripLegacyContextsForDesk(&in)
	if in.SandboxProjectID != "" || in.CompileLog != "" {
		t.Fatalf("expected stripped dev fields: %+v", in)
	}
	if in.SMTP == nil || in.SMTP.FromEmail != "a@b.c" {
		t.Fatalf("expected smtp preserved: %+v", in.SMTP)
	}
}
