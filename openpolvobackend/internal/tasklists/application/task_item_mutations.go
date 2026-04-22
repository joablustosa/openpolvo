package application

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/open-polvo/open-polvo/internal/tasklists/domain"
	"github.com/open-polvo/open-polvo/internal/tasklists/ports"
)

// AppendTaskItems adiciona tarefas ao fim da lista (posição após o máximo actual).
type AppendTaskItems struct {
	Lists ports.TaskListRepository
	Items ports.TaskItemRepository
}

func (uc *AppendTaskItems) Execute(ctx context.Context, userID, listID uuid.UUID, in []CreateTaskItemInput) (*domain.TaskList, error) {
	tl, err := uc.Lists.GetByIDAndUser(ctx, listID, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrTaskListNotFound
		}
		return nil, err
	}
	if tl.Status == domain.ListRunning {
		return nil, ErrListRunningMutation
	}
	maxPos, err := uc.Items.MaxPosition(ctx, listID)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	pos := maxPos + 1
	var newItems []domain.TaskItem
	for _, inp := range in {
		t := strings.TrimSpace(inp.Title)
		if t == "" {
			continue
		}
		item := domain.TaskItem{
			ID:         uuid.New(),
			TaskListID: listID,
			UserID:     userID,
			Position:   pos,
			Title:      t,
			Status:     domain.ItemPending,
		}
		if d := strings.TrimSpace(inp.Description); d != "" {
			item.Description = &d
		}
		newItems = append(newItems, item)
		pos++
	}
	if len(newItems) == 0 {
		return loadFullList(ctx, uc.Lists, uc.Items, listID, userID)
	}
	if err := uc.Items.CreateBatch(ctx, newItems); err != nil {
		return nil, err
	}
	tl.UpdatedAt = now
	if err := uc.Lists.Update(ctx, tl); err != nil {
		return nil, err
	}
	return loadFullList(ctx, uc.Lists, uc.Items, listID, userID)
}

// PatchTaskItemInput campos opcionais; título vazio mantém o actual se omitido.
type PatchTaskItemInput struct {
	Title       *string
	Description *string
	Position    *int
	DueAt       *time.Time // substitui prazo; nil com DueAtClear limpa
	DueAtClear  bool       // se true, due_at passa a NULL (ignora DueAt)
}

// PatchTaskItem actualiza título, descrição e/ou posição de um item pendente.
type PatchTaskItem struct {
	Lists ports.TaskListRepository
	Items ports.TaskItemRepository
}

func (uc *PatchTaskItem) Execute(ctx context.Context, userID, listID, itemID uuid.UUID, in PatchTaskItemInput) (*domain.TaskList, error) {
	tl, err := uc.Lists.GetByIDAndUser(ctx, listID, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrTaskListNotFound
		}
		return nil, err
	}
	if tl.Status == domain.ListRunning {
		return nil, ErrListRunningMutation
	}
	item, err := uc.Items.GetByIDAndUser(ctx, itemID, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrTaskItemNotFound
		}
		return nil, err
	}
	if item.TaskListID != listID {
		return nil, ErrTaskItemNotFound
	}
	if item.Status != domain.ItemPending {
		return nil, ErrItemNotEditable
	}
	title := item.Title
	if in.Title != nil {
		t := strings.TrimSpace(*in.Title)
		if t == "" {
			return nil, errors.New("título vazio")
		}
		title = t
	}
	desc := item.Description
	if in.Description != nil {
		d := strings.TrimSpace(*in.Description)
		if d == "" {
			desc = nil
		} else {
			desc = &d
		}
	}
	position := item.Position
	if in.Position != nil {
		position = *in.Position
	}
	dueAt := item.DueAt
	if in.DueAtClear {
		dueAt = nil
	} else if in.DueAt != nil {
		dueAt = in.DueAt
	}
	if err := uc.Items.UpdateUserFields(ctx, itemID, userID, title, desc, position, dueAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrItemNotEditable
		}
		return nil, err
	}
	now := time.Now().UTC()
	tl.UpdatedAt = now
	if err := uc.Lists.Update(ctx, tl); err != nil {
		return nil, err
	}
	return loadFullList(ctx, uc.Lists, uc.Items, listID, userID)
}

// DeleteTaskItem remove um item pendente da lista.
type DeleteTaskItem struct {
	Lists ports.TaskListRepository
	Items ports.TaskItemRepository
}

func (uc *DeleteTaskItem) Execute(ctx context.Context, userID, listID, itemID uuid.UUID) (*domain.TaskList, error) {
	tl, err := uc.Lists.GetByIDAndUser(ctx, listID, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrTaskListNotFound
		}
		return nil, err
	}
	if tl.Status == domain.ListRunning {
		return nil, ErrListRunningMutation
	}
	item, err := uc.Items.GetByIDAndUser(ctx, itemID, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrTaskItemNotFound
		}
		return nil, err
	}
	if item.TaskListID != listID {
		return nil, ErrTaskItemNotFound
	}
	if err := uc.Items.DeleteByIDAndUser(ctx, itemID, userID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrItemNotEditable
		}
		return nil, err
	}
	now := time.Now().UTC()
	tl.UpdatedAt = now
	if err := uc.Lists.Update(ctx, tl); err != nil {
		return nil, err
	}
	return loadFullList(ctx, uc.Lists, uc.Items, listID, userID)
}

func loadFullList(ctx context.Context, lists ports.TaskListRepository, items ports.TaskItemRepository, listID, userID uuid.UUID) (*domain.TaskList, error) {
	tl, err := lists.GetByIDAndUser(ctx, listID, userID)
	if err != nil {
		return nil, err
	}
	listItems, err := items.ListByTaskList(ctx, listID)
	if err != nil {
		return nil, err
	}
	tl.Items = listItems
	return tl, nil
}
