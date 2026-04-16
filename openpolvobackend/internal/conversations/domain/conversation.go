package domain

import (
	"time"

	"github.com/google/uuid"
)

type Conversation struct {
	ID                uuid.UUID
	UserID            uuid.UUID
	Title             *string
	LangGraphThreadID string
	DefaultModel      ModelProvider
	PinnedAt          *time.Time
	DeletedAt         *time.Time
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type Message struct {
	ID             uuid.UUID
	ConversationID uuid.UUID
	Role           string
	Content        string
	Metadata       []byte
	CreatedAt      time.Time
}
