package domain

import (
	"time"

	"github.com/google/uuid"
)

type Category struct {
	ID         uuid.UUID
	UserID     uuid.UUID
	ParentID   *uuid.UUID
	Name       string
	SortOrder  int
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

type Direction string

const (
	DirectionIn  Direction = "in"
	DirectionOut Direction = "out"
)

type TxSource string

const (
	TxSourceManual TxSource = "manual"
	TxSourceAgent  TxSource = "agent"
)

type Transaction struct {
	ID             uuid.UUID
	UserID         uuid.UUID
	AmountMinor    int64
	Currency       string
	Direction      Direction
	CategoryID     *uuid.UUID
	SubcategoryID  *uuid.UUID
	OccurredAt     time.Time
	Description    string
	Source         TxSource
	CreatedAt      time.Time
}

type Cadence string

const (
	CadenceMonthly Cadence = "monthly"
	CadenceYearly  Cadence = "yearly"
	CadenceWeekly  Cadence = "weekly"
)

type SubStatus string

const (
	SubActive SubStatus = "active"
	SubPaused SubStatus = "paused"
)

type Subscription struct {
	ID                   uuid.UUID
	UserID               uuid.UUID
	Name                 string
	AmountMinor          int64
	Currency             string
	Cadence              Cadence
	AnchorDay            *int8
	NextDueAt            time.Time
	Status               SubStatus
	LastPaidAt           *time.Time
	ReminderActive       bool
	LastReminderSentAt   *time.Time // date-only semantics in app
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

type DigestSettings struct {
	UserID                uuid.UUID
	Timezone              string
	DigestHour            int
	DigestEnabled         bool
	IncludeFinanceSummary bool
	IncludeTasks          bool
	LastDigestSentOn      *time.Time // date UTC
	UpdatedAt             time.Time
}
