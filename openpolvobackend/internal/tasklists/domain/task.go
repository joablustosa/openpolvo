package domain

import (
	"time"

	"github.com/google/uuid"
)

type ListStatus string
type ItemStatus string

const (
	ListPending   ListStatus = "pending"
	ListRunning   ListStatus = "running"
	ListCompleted ListStatus = "completed"
	ListFailed    ListStatus = "failed"

	ItemPending   ItemStatus = "pending"
	ItemRunning   ItemStatus = "running"
	ItemCompleted ItemStatus = "completed"
	ItemFailed    ItemStatus = "failed"
)

// TaskList representa uma lista de tarefas a executar sequencialmente pelo agente.
type TaskList struct {
	ID         uuid.UUID
	UserID     uuid.UUID
	Title      string
	Status     ListStatus
	Items      []TaskItem // carregado sob pedido
	CreatedAt  time.Time
	UpdatedAt  time.Time
	FinishedAt *time.Time
}

// TaskItem representa uma tarefa individual dentro de uma lista.
type TaskItem struct {
	ID          uuid.UUID
	TaskListID  uuid.UUID
	UserID      uuid.UUID
	Position    int
	Title       string
	Description *string
	Status      ItemStatus
	Result      *string
	ErrorMsg    *string
	StartedAt   *time.Time
	FinishedAt  *time.Time
}
