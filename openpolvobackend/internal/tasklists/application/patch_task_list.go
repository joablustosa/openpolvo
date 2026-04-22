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

// PatchTaskListTitle actualiza apenas o título da lista (dono verificado).
type PatchTaskListTitle struct {
	Lists ports.TaskListRepository
}

func (uc *PatchTaskListTitle) Execute(ctx context.Context, userID, listID uuid.UUID, title string) (*domain.TaskList, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return nil, errors.New("título vazio")
	}
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
	now := time.Now().UTC()
	tl.Title = title
	tl.UpdatedAt = now
	if err := uc.Lists.Update(ctx, tl); err != nil {
		return nil, err
	}
	return tl, nil
}
