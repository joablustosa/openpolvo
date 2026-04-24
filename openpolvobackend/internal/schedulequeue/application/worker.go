package application

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"

	schedapp "github.com/open-polvo/open-polvo/internal/scheduledtasks/application"
	sqdomain "github.com/open-polvo/open-polvo/internal/schedulequeue/domain"
	sqports "github.com/open-polvo/open-polvo/internal/schedulequeue/ports"
	wfapp "github.com/open-polvo/open-polvo/internal/workflows/application"
	wfports "github.com/open-polvo/open-polvo/internal/workflows/ports"
)

type Worker struct {
	Queue sqports.Repository

	ScheduledTasks *schedapp.Runner

	WorkflowsRun  *wfapp.RunWorkflow
	WorkflowsRepo wfports.WorkflowRepository

	Workers      int
	PollInterval time.Duration
	LockTTL      time.Duration
	Log          *slog.Logger
}

func (w *Worker) Start(ctx context.Context) {
	log := w.Log
	if log == nil {
		log = slog.Default()
	}
	if w.Queue == nil {
		log.Warn("schedule-queue worker disabled: queue repo nil")
		return
	}
	n := w.Workers
	if n <= 0 {
		n = 1
	}
	poll := w.PollInterval
	if poll <= 0 {
		poll = 2 * time.Second
	}
	lockTTL := w.LockTTL
	if lockTTL <= 0 {
		lockTTL = 10 * time.Minute
	}

	log.Info("schedule-queue worker started", "workers", n, "poll", poll.String(), "lock_ttl", lockTTL.String())
	for i := 0; i < n; i++ {
		go w.loop(ctx, log, poll, lockTTL, i)
	}
}

func (w *Worker) loop(ctx context.Context, log *slog.Logger, poll, lockTTL time.Duration, workerIdx int) {
	// Primeira tentativa imediata ao arrancar.
	w.tick(ctx, log, lockTTL, workerIdx)
	t := time.NewTicker(poll)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			w.tick(ctx, log, lockTTL, workerIdx)
		}
	}
}

func (w *Worker) tick(ctx context.Context, log *slog.Logger, lockTTL time.Duration, workerIdx int) {
	now := time.Now().UTC()
	it, err := w.Queue.ClaimNext(ctx, now, lockTTL)
	if err != nil {
		log.Error("schedule-queue claim", "err", err, "worker", workerIdx)
		return
	}
	if it == nil {
		return
	}

	start := time.Now()
	runCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()

	var runErr error
	switch it.Kind {
	case sqdomain.KindTask:
		if w.ScheduledTasks == nil {
			runErr = errors.New("scheduled tasks runner não configurado")
			break
		}
		_, runErr = w.ScheduledTasks.ExecuteScheduled(runCtx, it.EntityID, it.UserID, it.ScheduledFor)
	case sqdomain.KindWorkflow:
		if w.WorkflowsRun == nil || w.WorkflowsRepo == nil {
			runErr = errors.New("workflow runner/repo não configurados")
			break
		}
		runErr = wfapp.ExecuteScheduledWorkflow(runCtx, w.WorkflowsRun, w.WorkflowsRepo, it.UserID, it.EntityID, it.ScheduledFor)
	default:
		runErr = errors.New("kind desconhecido: " + string(it.Kind))
	}

	dur := time.Since(start)
	if runErr != nil {
		log.Error("schedule-queue exec", "id", it.ID.String(), "kind", it.Kind, "entity_id", it.EntityID.String(), "err", runErr, "dur_ms", dur.Milliseconds())
		_ = w.Queue.MarkError(context.Background(), it.ID, runErr.Error(), time.Now().UTC())
		return
	}
	log.Info("schedule-queue done", "id", it.ID.String(), "kind", it.Kind, "entity_id", it.EntityID.String(), "dur_ms", dur.Milliseconds())
	_ = w.Queue.MarkDone(context.Background(), it.ID, time.Now().UTC())
}

func EnqueueTask(ctx context.Context, repo sqports.Repository, taskID, userID uuid.UUID, scheduledFor time.Time) error {
	_, err := repo.Enqueue(ctx, ItemForTask(taskID, userID, scheduledFor))
	return err
}

func EnqueueWorkflow(ctx context.Context, repo sqports.Repository, workflowID, userID uuid.UUID, scheduledFor time.Time) error {
	_, err := repo.Enqueue(ctx, ItemForWorkflow(workflowID, userID, scheduledFor))
	return err
}

func ItemForTask(taskID, userID uuid.UUID, scheduledFor time.Time) sqdomain.Item {
	return sqdomain.Item{
		ID:           uuid.New(),
		Kind:         sqdomain.KindTask,
		EntityID:     taskID,
		UserID:       userID,
		ScheduledFor: scheduledFor.UTC(),
	}
}

func ItemForWorkflow(workflowID, userID uuid.UUID, scheduledFor time.Time) sqdomain.Item {
	return sqdomain.Item{
		ID:           uuid.New(),
		Kind:         sqdomain.KindWorkflow,
		EntityID:     workflowID,
		UserID:       userID,
		ScheduledFor: scheduledFor.UTC(),
	}
}

