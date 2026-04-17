package application

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/open-polvo/open-polvo/internal/tasklists/domain"
	"github.com/open-polvo/open-polvo/internal/tasklists/ports"
)

// ─── CreateTaskList ──────────────────────────────────────────────────────────

type CreateTaskListInput struct {
	Title string
	Items []CreateTaskItemInput
}

type CreateTaskItemInput struct {
	Title       string
	Description string
}

type CreateTaskList struct {
	Lists ports.TaskListRepository
	Items ports.TaskItemRepository
}

func (uc *CreateTaskList) Execute(ctx context.Context, userID uuid.UUID, in CreateTaskListInput) (*domain.TaskList, error) {
	now := time.Now().UTC()
	tl := &domain.TaskList{
		ID:        uuid.New(),
		UserID:    userID,
		Title:     in.Title,
		Status:    domain.ListPending,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := uc.Lists.Create(ctx, tl); err != nil {
		return nil, err
	}

	items := make([]domain.TaskItem, 0, len(in.Items))
	for i, inp := range in.Items {
		item := domain.TaskItem{
			ID:         uuid.New(),
			TaskListID: tl.ID,
			UserID:     userID,
			Position:   i,
			Title:      inp.Title,
			Status:     domain.ItemPending,
		}
		if inp.Description != "" {
			item.Description = &inp.Description
		}
		items = append(items, item)
	}
	if len(items) > 0 {
		if err := uc.Items.CreateBatch(ctx, items); err != nil {
			return nil, err
		}
		tl.Items = items
	}
	return tl, nil
}

// ─── GetTaskList ─────────────────────────────────────────────────────────────

type GetTaskList struct {
	Lists ports.TaskListRepository
	Items ports.TaskItemRepository
}

func (uc *GetTaskList) Execute(ctx context.Context, userID, listID uuid.UUID) (*domain.TaskList, error) {
	tl, err := uc.Lists.GetByIDAndUser(ctx, listID, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrTaskListNotFound
		}
		return nil, err
	}
	items, err := uc.Items.ListByTaskList(ctx, tl.ID)
	if err != nil {
		return nil, err
	}
	tl.Items = items
	return tl, nil
}

// ─── ListTaskLists ───────────────────────────────────────────────────────────

type ListTaskLists struct {
	Lists ports.TaskListRepository
}

func (uc *ListTaskLists) Execute(ctx context.Context, userID uuid.UUID) ([]domain.TaskList, error) {
	return uc.Lists.ListByUser(ctx, userID, 100)
}

// ─── DeleteTaskList ──────────────────────────────────────────────────────────

type DeleteTaskList struct {
	Lists ports.TaskListRepository
}

func (uc *DeleteTaskList) Execute(ctx context.Context, userID, listID uuid.UUID) error {
	err := uc.Lists.Delete(ctx, listID, userID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrTaskListNotFound
	}
	return err
}
