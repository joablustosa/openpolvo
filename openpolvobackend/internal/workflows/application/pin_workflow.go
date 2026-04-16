package application

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/workflows/ports"
)

type PinWorkflow struct {
	Workflows ports.WorkflowRepository
}

func (p *PinWorkflow) Execute(ctx context.Context, workflowID, userID uuid.UUID, pin bool) error {
	var t *time.Time
	if pin {
		now := time.Now().UTC()
		t = &now
	}
	return p.Workflows.SetPinnedAt(ctx, workflowID, userID, t)
}
