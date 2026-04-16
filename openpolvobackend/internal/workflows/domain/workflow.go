package domain

import (
	"time"

	"github.com/google/uuid"
)

type Workflow struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	Title     string
	Graph     GraphJSON
	PinnedAt  *time.Time
	// Derivado do primeiro nó `schedule` no grafo ao guardar; usado pelo scheduler.
	ScheduleCron          *string
	ScheduleTimezone      string
	ScheduleEnabled       bool
	ScheduleLastFiredAt   *time.Time
	CreatedAt time.Time
	UpdatedAt time.Time
}

type RunStatus string

const (
	RunPending   RunStatus = "pending"
	RunRunning   RunStatus = "running"
	RunSuccess   RunStatus = "success"
	RunFailed    RunStatus = "failed"
	RunCancelled RunStatus = "cancelled"
)

type WorkflowRun struct {
	ID           uuid.UUID
	WorkflowID   uuid.UUID
	UserID       uuid.UUID
	Status       RunStatus
	StepLog      []StepLogEntry
	ErrorMessage *string
	CreatedAt    time.Time
	FinishedAt   *time.Time
}

type StepLogEntry struct {
	NodeID  string `json:"node_id"`
	Type    string `json:"type"`
	OK      bool   `json:"ok"`
	Message string `json:"message,omitempty"`
}
