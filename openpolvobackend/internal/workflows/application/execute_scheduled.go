package application

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/workflows/ports"
)

// ExecuteScheduledWorkflow executa um workflow e actualiza schedule_last_fired_at para o tick planeado (scheduledFor).
func ExecuteScheduledWorkflow(
	ctx context.Context,
	run *RunWorkflow,
	repo ports.WorkflowRepository,
	userID, workflowID uuid.UUID,
	scheduledFor time.Time,
) error {
	if run == nil || repo == nil {
		return nil
	}
	if _, err := run.Execute(ctx, userID, workflowID); err != nil {
		return err
	}
	return repo.UpdateScheduleLastFired(ctx, workflowID, scheduledFor.UTC())
}

