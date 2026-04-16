package application

import (
	"context"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/conversations/domain"
	convports "github.com/open-polvo/open-polvo/internal/conversations/ports"
)

type ListConversations struct {
	Conversations convports.ConversationRepository
	Limit         int
}

func (l *ListConversations) Execute(ctx context.Context, userID uuid.UUID) ([]domain.Conversation, error) {
	limit := l.Limit
	if limit <= 0 {
		limit = 50
	}
	return l.Conversations.ListByUser(ctx, userID, limit)
}
