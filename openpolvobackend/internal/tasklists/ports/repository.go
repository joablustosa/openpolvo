package ports

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/open-polvo/open-polvo/internal/tasklists/domain"
)

// TaskListRepository define operações de persistência para listas de tarefas.
type TaskListRepository interface {
	Create(ctx context.Context, tl *domain.TaskList) error
	Update(ctx context.Context, tl *domain.TaskList) error
	GetByIDAndUser(ctx context.Context, id, userID uuid.UUID) (*domain.TaskList, error)
	ListByUser(ctx context.Context, userID uuid.UUID, limit int) ([]domain.TaskList, error)
	Delete(ctx context.Context, id, userID uuid.UUID) error
}

// TaskItemRepository define operações de persistência para items de uma lista.
type TaskItemRepository interface {
	CreateBatch(ctx context.Context, items []domain.TaskItem) error
	Update(ctx context.Context, item *domain.TaskItem) error
	ListByTaskList(ctx context.Context, taskListID uuid.UUID) ([]domain.TaskItem, error)
	GetByIDAndUser(ctx context.Context, id, userID uuid.UUID) (*domain.TaskItem, error)
	DeleteByIDAndUser(ctx context.Context, id, userID uuid.UUID) error
	UpdateUserFields(ctx context.Context, id, userID uuid.UUID, title string, description *string, position int, dueAt *time.Time) error
	MaxPosition(ctx context.Context, taskListID uuid.UUID) (int, error)
	// ListDueInRangeForUser items com due_at no intervalo [from, to), com título da lista.
	ListDueInRangeForUser(ctx context.Context, userID uuid.UUID, from, to time.Time) ([]TaskItemDueRow, error)
}

// TaskItemDueRow item com prazo e nome da lista (agenda).
type TaskItemDueRow struct {
	ItemID     uuid.UUID
	TaskListID uuid.UUID
	ListTitle  string
	Title      string
	DueAt      time.Time
}
