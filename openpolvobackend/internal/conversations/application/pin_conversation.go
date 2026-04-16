package application

import (
	"context"
	"time"

	"github.com/google/uuid"

	convports "github.com/open-polvo/open-polvo/internal/conversations/ports"
)

type PinConversation struct {
	Conversations convports.ConversationRepository
}

func (p *PinConversation) Execute(ctx context.Context, conversationID, userID uuid.UUID, pin bool) error {
	var t *time.Time
	if pin {
		now := time.Now().UTC()
		t = &now
	}
	return p.Conversations.SetPinnedAt(ctx, conversationID, userID, t)
}
