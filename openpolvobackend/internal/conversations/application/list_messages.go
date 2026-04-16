package application

import (
	"context"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/conversations/domain"
	convports "github.com/open-polvo/open-polvo/internal/conversations/ports"
)

type ListMessages struct {
	Conversations convports.ConversationRepository
	Messages      convports.MessageRepository
}

func (l *ListMessages) Execute(ctx context.Context, conversationID, userID uuid.UUID) ([]domain.Message, error) {
	if _, err := l.Conversations.GetByIDAndUser(ctx, conversationID, userID); err != nil {
		return nil, err
	}
	return l.Messages.ListByConversation(ctx, conversationID)
}
