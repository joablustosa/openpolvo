package application

import (
	"context"

	"github.com/google/uuid"

	convports "github.com/open-polvo/open-polvo/internal/conversations/ports"
)

type DeleteConversation struct {
	Conversations convports.ConversationRepository
}

func (d *DeleteConversation) Execute(ctx context.Context, conversationID, userID uuid.UUID) error {
	return d.Conversations.SoftDelete(ctx, conversationID, userID)
}
