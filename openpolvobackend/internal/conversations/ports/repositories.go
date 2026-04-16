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
