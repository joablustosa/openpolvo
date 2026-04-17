package application

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/open-polvo/open-polvo/internal/tasklists/domain"
	"github.com/open-polvo/open-polvo/internal/tasklists/ports"
)

// RunTaskList activa o agente executor para uma lista de tarefas.
// Marca a lista como running imediatamente (síncrono) e dispara a execução
// sequencial numa goroutine de background.
type RunTaskList struct {
	Lists        ports.TaskListRepository
	Items        ports.TaskItemRepository
	Executor     ports.TaskExecutor
	DefaultModel string
}

// Execute valida, marca running e lança a goroutine. Responde imediatamente.
func (uc *RunTaskList) Execute(ctx context.Context, userID, listID uuid.UUID) (*domain.TaskList, error) {
	tl, err := uc.Lists.GetByIDAndUser(ctx, listID, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrTaskListNotFound
		}
		return nil, err
	}

	if tl.Status == domain.ListRunning {
		return nil, ErrAlreadyRunning
	}
	// Permite re-execução apenas de listas em estado terminal (failed não relançável nesta fase).
	if tl.Status != domain.ListPending {
		return nil, ErrAlreadyRunning
	}
	if uc.Executor == nil {
		return nil, ErrExecutorNotConfigured
	}

	items, err := uc.Items.ListByTaskList(ctx, listID)
	if err != nil {
		return nil, err
	}

	// Marca lista como running de forma síncrona (antes de devolver ao handler).
	now := time.Now().UTC()
	tl.Status = domain.ListRunning
	tl.UpdatedAt = now
	if err := uc.Lists.Update(ctx, tl); err != nil {
		return nil, err
	}
	tl.Items = items

	// Execução sequencial em background.
	go uc.runSequential(context.Background(), tl, items)

	return tl, nil
}

// runSequential executa os items em ordem, um a um.
// Corre numa goroutine; não tem acesso ao contexto HTTP original.
func (uc *RunTaskList) runSequential(ctx context.Context, tl *domain.TaskList, items []domain.TaskItem) {
	mp := uc.DefaultModel
	if mp == "" {
		mp = "openai"
	}

	listFailed := false

	for i := range items {
		item := &items[i]

		// Salta items que não estão pending (ex: se a lista foi parcialmente executada).
		if item.Status != domain.ItemPending {
			continue
		}

		// Marca item como running.
		now := time.Now().UTC()
		item.Status = domain.ItemRunning
		item.StartedAt = &now
		if err := uc.Items.Update(ctx, item); err != nil {
			slog.Error("tasklist runner: update item running", "item_id", item.ID, "err", err)
		}

		// Executa via LLM.
		req := ports.TaskExecutionRequest{
			ModelProvider:   mp,
			TaskTitle:       item.Title,
			TaskDescription: derefStr(item.Description),
		}

		res, execErr := uc.Executor.ExecuteTask(ctx, req)

		fin := time.Now().UTC()
		item.FinishedAt = &fin

		if execErr != nil {
			item.Status = domain.ItemFailed
			s := execErr.Error()
			item.ErrorMsg = &s
			listFailed = true
		} else {
			item.Status = domain.ItemCompleted
			item.Result = &res.ResultText
		}

		if err := uc.Items.Update(ctx, item); err != nil {
			slog.Error("tasklist runner: update item result", "item_id", item.ID, "err", err)
		}

		// Para a sequência se um item falhou.
		if listFailed {
			break
		}
	}

	// Actualiza status final da lista.
	finAt := time.Now().UTC()
	tl.FinishedAt = &finAt
	tl.UpdatedAt = finAt
	if listFailed {
		tl.Status = domain.ListFailed
	} else {
		tl.Status = domain.ListCompleted
	}
	if err := uc.Lists.Update(ctx, tl); err != nil {
		slog.Error("tasklist runner: update list final status", "list_id", tl.ID, "err", err)
	}
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
