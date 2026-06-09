package ports

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/conversations/domain"
)

type ConversationRepository interface {
	Create(ctx context.Context, c *domain.Conversation) error
	GetByIDAndUser(ctx context.Context, conversationID, userID uuid.UUID) (*domain.Conversation, error)
	ListByUser(ctx context.Context, userID uuid.UUID, limit int) ([]domain.Conversation, error)
	UpdateTitle(ctx context.Context, conversationID, userID uuid.UUID, title string) error
	TouchUpdatedAt(ctx context.Context, conversationID uuid.UUID, t time.Time) error
	SoftDelete(ctx context.Context, conversationID, userID uuid.UUID) error
	SetPinnedAt(ctx context.Context, conversationID, userID uuid.UUID, pinnedAt *time.Time) error
}

type MessageRepository interface {
	Create(ctx context.Context, m *domain.Message) error
	ListByConversation(ctx context.Context, conversationID uuid.UUID) ([]domain.Message, error)
}

// AgentMemoryRepository memória híbrida (prompt + SQLite) por conversa.
type AgentMemoryRepository interface {
	Get(ctx context.Context, conversationID uuid.UUID) (domain.AgentMemory, error)
	Upsert(ctx context.Context, conversationID uuid.UUID, mem domain.AgentMemory) error
}

// DevProjectRecorder persiste uma versão de projeto de dev a partir da mensagem
// do assistant, quando o metadata indica trabalho de dev. É um no-op caso contrário.
// Implementado pelo módulo projects (tipagem estrutural; sem dependência inversa).
type DevProjectRecorder interface {
	RecordFromAssistantMessage(ctx context.Context, userID, conversationID uuid.UUID, assistantText string, metadata map[string]any) error
}
