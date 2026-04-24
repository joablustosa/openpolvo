package domain

import (
	"time"

	"github.com/google/uuid"
)

// Profile é um registo persistido (api_key só em memória após descifrar).
type Profile struct {
	ID           uuid.UUID
	DisplayName  string
	Provider     string // openai | google
	ModelID      string
	SortOrder    int
	CreatedAt    time.Time
	UpdatedAt    time.Time
	APIKeyPlain  string // vazio em listagens públicas
	HasKeyCipher bool
}

// AgentPrefs controla o modo "automático" vs perfil fixo.
type AgentPrefs struct {
	AgentMode         string // auto | profile
	DefaultProfileID  *uuid.UUID
	UpdatedAt         time.Time
}
