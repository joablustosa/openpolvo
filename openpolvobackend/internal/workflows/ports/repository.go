package ports

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/workflows/domain"
)

type WorkflowRepository interface {
	Create(ctx context.Context, w *domain.Workflow) error
	Update(ctx context.Context, w *domain.Workflow) error
	GetByIDAndUser(ctx context.Context, id, userID uuid.UUID) (*domain.Workflow, error)
	ListByUser(ctx context.Context, userID uuid.UUID, limit int) ([]domain.Workflow, error)
	Delete(ctx context.Context, id, userID uuid.UUID) error
	SetPinnedAt(ctx context.Context, workflowID, userID uuid.UUID, pinnedAt *time.Time) error
	// ListSchedulable devolve workflows com agendamento activo (índice em schedule_*).
	ListSchedulable(ctx context.Context, limit int) ([]domain.Workflow, error)
	UpdateScheduleLastFired(ctx context.Context, workflowID uuid.UUID, t time.Time) error
}

type RunRepository interface {
	Create(ctx context.Context, r *domain.WorkflowRun) error
	Update(ctx context.Context, r *domain.WorkflowRun) error
	GetByIDAndUser(ctx context.Context, id, userID uuid.UUID) (*domain.WorkflowRun, error)
	ListByWorkflow(ctx context.Context, workflowID, userID uuid.UUID, limit int) ([]domain.WorkflowRun, error)
}
