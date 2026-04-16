package application

import (
	"context"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/conversations/domain"
	convports "github.com/open-polvo/open-polvo/internal/conversations/ports"
)

type GetConversation struct {
	Conversations convports.ConversationRepository
}

func (g *GetConversation) Execute(ctx context.Context, conversationID, userID uuid.UUID) (*domain.Conversation, error) {
	c, err := g.Conversations.GetByIDAndUser(ctx, conversationID, userID)
	if err != nil {
		return nil, err
	}
	return c, nil
}
