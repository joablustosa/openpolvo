package application

import (
	"context"

	"github.com/google/uuid"

	wfdomain "github.com/open-polvo/open-polvo/internal/workflows/domain"
	"github.com/open-polvo/open-polvo/internal/workflows/ports"
)

type ListWorkflowRuns struct {
	Runs ports.RunRepository
}

func (uc *ListWorkflowRuns) Execute(ctx context.Context, userID, workflowID uuid.UUID) ([]wfdomain.WorkflowRun, error) {
	return uc.Runs.ListByWorkflow(ctx, workflowID, userID, 50)
}
