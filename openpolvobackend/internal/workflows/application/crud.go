package application

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/workflows/domain"
	"github.com/open-polvo/open-polvo/internal/workflows/ports"
)

type CreateWorkflow struct {
	Workflows ports.WorkflowRepository
}

func (uc *CreateWorkflow) Execute(ctx context.Context, userID uuid.UUID, title string, graph domain.GraphJSON) (*domain.Workflow, error) {
	if title == "" {
		title = "Workflow sem título"
	}
	now := time.Now().UTC()
	w := &domain.Workflow{
		ID:        uuid.New(),
		UserID:    userID,
		Title:     title,
		Graph:     graph,
		CreatedAt: now,
		UpdatedAt: now,
	}
	domain.ApplyScheduleFromGraph(w)
	if err := uc.Workflows.Create(ctx, w); err != nil {
		return nil, err
	}
	return w, nil
}

type UpdateWorkflow struct {
	Workflows ports.WorkflowRepository
}

func (uc *UpdateWorkflow) Execute(ctx context.Context, userID, id uuid.UUID, title *string, graph *domain.GraphJSON) (*domain.Workflow, error) {
	w, err := uc.Workflows.GetByIDAndUser(ctx, id, userID)
	if err != nil {
		return nil, err
	}
	if title != nil {
		t := strings.TrimSpace(*title)
		if t != "" {
			w.Title = t
		}
	}
	if graph != nil {
		w.Graph = *graph
	}
	domain.ApplyScheduleFromGraph(w)
	w.UpdatedAt = time.Now().UTC()
	if err := uc.Workflows.Update(ctx, w); err != nil {
		return nil, err
	}
	return w, nil
}

type GetWorkflow struct {
	Workflows ports.WorkflowRepository
}

func (uc *GetWorkflow) Execute(ctx context.Context, userID, id uuid.UUID) (*domain.Workflow, error) {
	return uc.Workflows.GetByIDAndUser(ctx, id, userID)
}

type ListWorkflows struct {
	Workflows ports.WorkflowRepository
}

func (uc *ListWorkflows) Execute(ctx context.Context, userID uuid.UUID) ([]domain.Workflow, error) {
	return uc.Workflows.ListByUser(ctx, userID, 100)
}

type DeleteWorkflow struct {
	Workflows ports.WorkflowRepository
}

func (uc *DeleteWorkflow) Execute(ctx context.Context, userID, id uuid.UUID) error {
	return uc.Workflows.Delete(ctx, id, userID)
}
