package application

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/conversations/domain"
	convports "github.com/open-polvo/open-polvo/internal/conversations/ports"
)

const agentMemoryMaxRunes = 8000

// ApplyAgentMemoryPatch funde metadata.agent_memory_patch na tabela SQLite.
func ApplyAgentMemoryPatch(ctx context.Context, repo convports.AgentMemoryRepository, conversationID uuid.UUID, meta map[string]any) {
	if repo == nil || meta == nil {
		return
	}
	raw, ok := meta["agent_memory_patch"].(map[string]any)
	if !ok || raw == nil {
		return
	}
	cur, err := repo.Get(ctx, conversationID)
	if err != nil {
		return
	}
	next := domain.AgentMemory{Global: cur.Global, Builder: cur.Builder}
	if v, ok := raw["global"]; ok && v != nil {
		next.Global = truncateRunes(strings.TrimSpace(fmt.Sprint(v)), agentMemoryMaxRunes)
	}
	if v, ok := raw["builder"]; ok && v != nil {
		next.Builder = truncateRunes(strings.TrimSpace(fmt.Sprint(v)), agentMemoryMaxRunes)
	}
	_ = repo.Upsert(ctx, conversationID, next)
}

func truncateRunes(s string, max int) string {
	if max <= 0 {
		return ""
	}
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}
