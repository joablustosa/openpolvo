package ports

import (
	"context"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/llmprofiles/domain"
)

type Repository interface {
	ListProfiles(ctx context.Context) ([]domain.Profile, error)
	GetProfileByID(ctx context.Context, id uuid.UUID) (*domain.Profile, error)
	CreateProfile(ctx context.Context, displayName, provider, modelID string, sortOrder int, apiKeyPlain string) (uuid.UUID, error)
	UpdateProfile(ctx context.Context, id uuid.UUID, displayName, modelID *string, sortOrder *int, apiKeyPlain *string) error
	DeleteProfile(ctx context.Context, id uuid.UUID) error

	GetAgentPrefs(ctx context.Context) (domain.AgentPrefs, error)
	SetAgentPrefs(ctx context.Context, mode string, defaultProfileID *uuid.UUID) error

	HasConfiguredProvider(ctx context.Context, provider string) (bool, error)
	HasAnyConfiguredProfile(ctx context.Context) (bool, error)
	FirstProfileWithKey(ctx context.Context) (*domain.Profile, error)
	FirstProfileForProvider(ctx context.Context, provider string) (*domain.Profile, error)
}
