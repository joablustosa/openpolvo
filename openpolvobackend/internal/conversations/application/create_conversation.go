package application

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/conversations/domain"
	convports "github.com/open-polvo/open-polvo/internal/conversations/ports"
)

type CreateConversationCommand struct {
	UserID       uuid.UUID
	Title        *string
	DefaultModel domain.ModelProvider
}

type CreateConversation struct {
	Conversations convports.ConversationRepository
}

func (c *CreateConversation) Execute(ctx context.Context, cmd CreateConversationCommand) (*domain.Conversation, error) {
	now := time.Now().UTC()
	id := uuid.New()
	conv := &domain.Conversation{
		ID:                id,
		UserID:            cmd.UserID,
		Title:             cmd.Title,
		LangGraphThreadID: fmt.Sprintf("go-local:%s", id.String()),
		DefaultModel:      cmd.DefaultModel,
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	if err := c.Conversations.Create(ctx, conv); err != nil {
		return nil, err
	}
	return conv, nil
}
