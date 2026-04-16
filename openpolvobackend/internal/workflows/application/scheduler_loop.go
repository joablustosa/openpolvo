package application

import (
	"context"
	"log/slog"
	"time"

	"github.com/open-polvo/open-polvo/internal/workflows/ports"
)

// StartWorkflowScheduler corre em loop até ctx ser cancelado; em cada tick avalia workflows com agendamento activo.
func StartWorkflowScheduler(ctx context.Context, interval time.Duration, repo ports.WorkflowRepository, run *RunWorkflow, log *slog.Logger) {
	if interval < 10*time.Second {
		interval = 30 * time.Second
	}
	if log == nil {
		log = slog.Default()
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	log.Info("workflow scheduler started", "interval", interval.String())
	for {
		select {
		case <-ctx.Done():
			log.Info("workflow scheduler stopped")
			return
		case <-t.C:
			runSchedulerTick(ctx, repo, run, log)
		}
	}
}

func runSchedulerTick(ctx context.Context, repo ports.WorkflowRepository, run *RunWorkflow, log *slog.Logger) {
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
		due, err := ScheduleIsDue(*wf.ScheduleCron, tz, wf.ScheduleLastFiredAt, wf.CreatedAt, now)
		if err != nil {
			log.Warn("scheduler cron parse", "workflow_id", wf.ID.String(), "err", err)
			continue
		}
		if !due {
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
