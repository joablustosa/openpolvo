package ports

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/scheduledtasks/domain"
)

var ErrNotFound = errors.New("scheduled task not found")

type ScheduledTaskRepository interface {
	Create(ctx context.Context, t *domain.ScheduledTask) error
	GetByID(ctx context.Context, id, userID uuid.UUID) (*domain.ScheduledTask, error)
	ListByUser(ctx context.Context, userID uuid.UUID) ([]domain.ScheduledTask, error)
	ListActive(ctx context.Context) ([]domain.ScheduledTask, error) // para o scheduler
	Update(ctx context.Context, t *domain.ScheduledTask) error
	Delete(ctx context.Context, id, userID uuid.UUID) error
	TouchLastRun(ctx context.Context, id uuid.UUID, result, errMsg string, now time.Time) error
}
