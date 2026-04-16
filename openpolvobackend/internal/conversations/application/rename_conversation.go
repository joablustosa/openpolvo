package application

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	convports "github.com/open-polvo/open-polvo/internal/conversations/ports"
)

type RenameConversation struct {
	Conversations convports.ConversationRepository
}

func (r *RenameConversation) Execute(ctx context.Context, conversationID, userID uuid.UUID, title string) error {
	title = strings.TrimSpace(title)
	if title == "" {
		return convports.ErrEmptyTitle
	}
	if utf8.RuneCountInString(title) > 512 {
		title = string([]rune(title)[:512])
	}
	return r.Conversations.UpdateTitle(ctx, conversationID, userID, title)
}
