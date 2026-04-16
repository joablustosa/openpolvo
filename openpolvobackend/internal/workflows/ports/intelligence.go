package ports

import (
	"context"

	"github.com/open-polvo/open-polvo/internal/conversations/domain"
)

// IntelligenceService gera texto e JSON via serviço Python (Open Polvo Intelligence).
type IntelligenceService interface {
	GenerateGraphJSON(ctx context.Context, provider domain.ModelProvider, userRequest, recordingJSON string) (string, error)
	GenerateText(ctx context.Context, provider domain.ModelProvider, system, user string) (string, error)
}
