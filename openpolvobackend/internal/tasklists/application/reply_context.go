package application

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	agentports "github.com/open-polvo/open-polvo/internal/agent/ports"
	"github.com/open-polvo/open-polvo/internal/tasklists/ports"
)

// TaskListsReplyLoader monta listas de tarefas para o Intelligence (truncado).
type TaskListsReplyLoader struct {
	Lists           ports.TaskListRepository
	Items           ports.TaskItemRepository
	MaxLists        int
	MaxItemsPerList int
	MaxDescRunes    int
	MaxResultRunes  int
}

func clipRunes(s string, max int) string {
	if max <= 0 || s == "" {
		return s
	}
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}

// ForReply devolve até MaxLists listas com até MaxItemsPerList items cada.
func (l *TaskListsReplyLoader) ForReply(ctx context.Context, userID uuid.UUID) []agentports.TaskListBrief {
	if l == nil || l.Lists == nil || l.Items == nil {
		return nil
	}
	maxL := l.MaxLists
	if maxL <= 0 {
		maxL = 20
	}
	maxI := l.MaxItemsPerList
	if maxI <= 0 {
		maxI = 40
	}
	maxD := l.MaxDescRunes
	if maxD <= 0 {
		maxD = 200
	}
	maxR := l.MaxResultRunes
	if maxR <= 0 {
		maxR = 400
	}
	lists, err := l.Lists.ListByUser(ctx, userID, maxL)
	if err != nil || len(lists) == 0 {
		return nil
	}
	out := make([]agentports.TaskListBrief, 0, len(lists))
	for i := range lists {
		tl := &lists[i]
		items, err := l.Items.ListByTaskList(ctx, tl.ID)
		if err != nil {
			continue
		}
		if len(items) > maxI {
			items = items[:maxI]
		}
		brief := agentports.TaskListBrief{
			ID:     tl.ID.String(),
			Title:  tl.Title,
			Status: string(tl.Status),
			Items:  make([]agentports.TaskItemBrief, 0, len(items)),
		}
		for j := range items {
			it := &items[j]
			var desc *string
			if it.Description != nil && strings.TrimSpace(*it.Description) != "" {
				c := clipRunes(strings.TrimSpace(*it.Description), maxD)
				desc = &c
			}
			var resClip *string
			if it.Result != nil && strings.TrimSpace(*it.Result) != "" {
				c := clipRunes(strings.TrimSpace(*it.Result), maxR)
				resClip = &c
			}
			tib := agentports.TaskItemBrief{
				ID:          it.ID.String(),
				Position:    it.Position,
				Title:       it.Title,
				Description: desc,
				Status:      string(it.Status),
				ResultClip:  resClip,
			}
			if it.DueAt != nil {
				s := it.DueAt.UTC().Format(time.RFC3339)
				tib.DueAt = &s
			}
			brief.Items = append(brief.Items, tib)
		}
		out = append(out, brief)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}