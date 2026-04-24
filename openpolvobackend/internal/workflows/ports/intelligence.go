package ports

import (
	"context"

	"github.com/open-polvo/open-polvo/internal/conversations/domain"
)

// LLMOverrides credenciais opcionais para o Open Polvo Intelligence (perfis SQLite na API Go).
type LLMOverrides struct {
	OpenAIAPIKey  string
	GoogleAPIKey  string
	OpenAIModel   string
	GoogleModel   string
}

// IntelligenceService gera texto e JSON via serviço Python (Open Polvo Intelligence).
type IntelligenceService interface {
	GenerateGraphJSON(ctx context.Context, provider domain.ModelProvider, ov LLMOverrides, userRequest, recordingJSON string) (string, error)
	GenerateText(ctx context.Context, provider domain.ModelProvider, ov LLMOverrides, system, user string) (string, error)
}
