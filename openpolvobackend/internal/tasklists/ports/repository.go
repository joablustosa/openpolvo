package ports

import (
	"context"

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
}
