package ports

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/social/domain"
)

type AutomationConfigRepository interface {
	GetByUserID(ctx context.Context, userID uuid.UUID) (*domain.AutomationConfig, error)
	Upsert(ctx context.Context, cfg *domain.AutomationConfig) error
	ListActive(ctx context.Context) ([]domain.AutomationConfig, error)
	TouchLastRun(ctx context.Context, id string, t time.Time) error
}

type SocialPostRepository interface {
	Create(ctx context.Context, p *domain.SocialPost) error
	GetByID(ctx context.Context, id string) (*domain.SocialPost, error)
	UpdateStatus(ctx context.Context, id string, status domain.PostStatus, extra map[string]any) error
	ListByUserID(ctx context.Context, userID uuid.UUID, limit int) ([]domain.SocialPost, error)
	// GetPendingApprovalByUser retorna o post mais recente aguardando aprovação para o utilizador.
	GetPendingApprovalByUser(ctx context.Context, userID uuid.UUID) (*domain.SocialPost, error)
}
