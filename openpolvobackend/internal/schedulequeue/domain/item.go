package domain

import (
	"time"

	"github.com/google/uuid"
)

type Kind string

const (
	KindTask     Kind = "task"
	KindWorkflow Kind = "workflow"
)

type Status string

const (
	StatusQueued  Status = "queued"
	StatusRunning Status = "running"
	StatusDone    Status = "done"
	StatusError   Status = "error"
)

type Item struct {
	ID           uuid.UUID
	Kind         Kind
	EntityID     uuid.UUID
	UserID       uuid.UUID
	ScheduledFor time.Time

	Status      Status
	Attempts    int
	LockedUntil *time.Time
	LastError   string

	CreatedAt time.Time
	UpdatedAt time.Time
}

