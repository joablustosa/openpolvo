package application

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"

	sqdomain "github.com/open-polvo/open-polvo/internal/schedulequeue/domain"
	sqports "github.com/open-polvo/open-polvo/internal/schedulequeue/ports"
	"github.com/open-polvo/open-polvo/internal/workflows/ports"
)

// StartWorkflowScheduler corre em loop até ctx ser cancelado; em cada tick avalia workflows com agendamento activo.
func StartWorkflowScheduler(ctx context.Context, interval time.Duration, repo ports.WorkflowRepository, run *RunWorkflow, queue sqports.Repository, log *slog.Logger) {
	if interval < 10*time.Second {
		interval = 30 * time.Second
	}
	if log == nil {
		log = slog.Default()
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	log.Info("workflow scheduler started", "interval", interval.String())
	runSchedulerTick(ctx, repo, run, queue, log)
	for {
		select {
		case <-ctx.Done():
			log.Info("workflow scheduler stopped")
			return
		case <-t.C:
			runSchedulerTick(ctx, repo, run, queue, log)
		}
	}
}

func runSchedulerTick(ctx context.Context, repo ports.WorkflowRepository, run *RunWorkflow, queue sqports.Repository, log *slog.Logger) {
	list, err := repo.ListSchedulable(ctx, 500)
	if err != nil {
		log.Error("scheduler list", "err", err)
		return
	}
	now := time.Now().UTC()
	for i := range list {
		wf := &list[i]
		if wf.ScheduleCron == nil || *wf.ScheduleCron == "" {
			continue
		}
		tz := wf.ScheduleTimezone
		if tz == "" {
			tz = "UTC"
		}
		nextUTC, err := ScheduleNextUTC(*wf.ScheduleCron, tz, wf.ScheduleLastFiredAt, wf.CreatedAt)
		if err != nil {
			log.Warn("scheduler cron parse", "workflow_id", wf.ID.String(), "err", err)
			continue
		}
		if nextUTC.IsZero() || now.Before(nextUTC) {
			continue
		}
		if queue != nil {
			inserted, qerr := queue.Enqueue(ctx, sqdomain.Item{
				ID:           uuid.New(),
				Kind:         sqdomain.KindWorkflow,
				EntityID:     wf.ID,
				UserID:       wf.UserID,
				ScheduledFor: nextUTC.UTC(),
			})
			if qerr != nil {
				log.Error("scheduler enqueue", "workflow_id", wf.ID.String(), "err", qerr)
				continue
			}
			if inserted {
				log.Info("scheduler enqueued", "workflow_id", wf.ID.String(), "scheduled_for", nextUTC.Format(time.RFC3339))
			}
			continue
		}
		runCtx := ctx
		if runCtx.Err() != nil {
			return
		}
		_, err = run.Execute(runCtx, wf.UserID, wf.ID)
		if err != nil {
			log.Error("scheduler run", "workflow_id", wf.ID.String(), "err", err)
			continue
		}
		if uerr := repo.UpdateScheduleLastFired(ctx, wf.ID, time.Now().UTC()); uerr != nil {
			log.Error("scheduler last_fired", "workflow_id", wf.ID.String(), "err", uerr)
		}
	}
}
