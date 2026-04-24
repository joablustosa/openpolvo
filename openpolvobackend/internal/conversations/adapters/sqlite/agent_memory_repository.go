package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/conversations/domain"
)

type AgentMemoryRepository struct {
	DB *sql.DB
}

func (r AgentMemoryRepository) Get(ctx context.Context, conversationID uuid.UUID) (domain.AgentMemory, error) {
	var g, b string
	err := r.DB.QueryRowContext(ctx,
		`SELECT global_content, builder_content FROM laele_conversation_agent_memory WHERE conversation_id = ?`,
		conversationID.String(),
	).Scan(&g, &b)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.AgentMemory{}, nil
	}
	if err != nil {
		return domain.AgentMemory{}, err
	}
	return domain.AgentMemory{Global: g, Builder: b}, nil
}

func (r AgentMemoryRepository) Upsert(ctx context.Context, conversationID uuid.UUID, mem domain.AgentMemory) error {
	now := time.Now().UTC()
	_, err := r.DB.ExecContext(ctx,
		`INSERT INTO laele_conversation_agent_memory (conversation_id, global_content, builder_content, updated_at)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(conversation_id) DO UPDATE SET
		   global_content = excluded.global_content,
		   builder_content = excluded.builder_content,
		   updated_at = excluded.updated_at`,
		conversationID.String(), mem.Global, mem.Builder, now,
	)
	return err
}
