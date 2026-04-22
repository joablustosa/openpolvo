package mysql

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/scheduledtasks/domain"
	"github.com/open-polvo/open-polvo/internal/scheduledtasks/ports"
)

type ScheduledTaskRepository struct {
	DB *sql.DB
}

func (r *ScheduledTaskRepository) Create(ctx context.Context, t *domain.ScheduledTask) error {
	payload, err := t.PayloadJSON()
	if err != nil {
		return err
	}
	_, err = r.DB.ExecContext(ctx, `
		INSERT INTO laele_scheduled_tasks
		  (id, user_id, name, description, task_type, payload_json, cron_expr, timezone, active, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
		t.ID.String(), t.UserID.String(), t.Name, nullStr(t.Description),
		string(t.TaskType), payload, t.CronExpr, t.Timezone,
		boolToInt(t.Active), t.CreatedAt, t.UpdatedAt,
	)
	return err
}

func (r *ScheduledTaskRepository) GetByID(ctx context.Context, id, userID uuid.UUID) (*domain.ScheduledTask, error) {
	row := r.DB.QueryRowContext(ctx, `
		SELECT id, user_id, name, COALESCE(description,''), task_type, payload_json,
		       cron_expr, timezone, active, last_run_at, COALESCE(last_result,''), COALESCE(last_error,''),
		       run_count, created_at, updated_at
		FROM laele_scheduled_tasks WHERE id=? AND user_id=?`,
		id.String(), userID.String(),
	)
	t, err := scanTask(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ports.ErrNotFound
	}
	return t, err
}

func (r *ScheduledTaskRepository) ListByUser(ctx context.Context, userID uuid.UUID) ([]domain.ScheduledTask, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT id, user_id, name, COALESCE(description,''), task_type, payload_json,
		       cron_expr, timezone, active, last_run_at, COALESCE(last_result,''), COALESCE(last_error,''),
		       run_count, created_at, updated_at
		FROM laele_scheduled_tasks WHERE user_id=? ORDER BY created_at DESC`,
		userID.String(),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTasks(rows)
}

func (r *ScheduledTaskRepository) ListActive(ctx context.Context) ([]domain.ScheduledTask, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT id, user_id, name, COALESCE(description,''), task_type, payload_json,
		       cron_expr, timezone, active, last_run_at, COALESCE(last_result,''), COALESCE(last_error,''),
		       run_count, created_at, updated_at
		FROM laele_scheduled_tasks WHERE active=1`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTasks(rows)
}

func (r *ScheduledTaskRepository) Update(ctx context.Context, t *domain.ScheduledTask) error {
	payload, err := t.PayloadJSON()
	if err != nil {
		return err
	}
	_, err = r.DB.ExecContext(ctx, `
		UPDATE laele_scheduled_tasks
		SET name=?, description=?, task_type=?, payload_json=?, cron_expr=?, timezone=?, active=?, updated_at=?
		WHERE id=? AND user_id=?`,
		t.Name, nullStr(t.Description), string(t.TaskType), payload,
		t.CronExpr, t.Timezone, boolToInt(t.Active), time.Now().UTC(),
		t.ID.String(), t.UserID.String(),
	)
	return err
}

func (r *ScheduledTaskRepository) Delete(ctx context.Context, id, userID uuid.UUID) error {
	res, err := r.DB.ExecContext(ctx,
		`DELETE FROM laele_scheduled_tasks WHERE id=? AND user_id=?`,
		id.String(), userID.String(),
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ports.ErrNotFound
	}
	return nil
}

func (r *ScheduledTaskRepository) TouchLastRun(ctx context.Context, id uuid.UUID, result, errMsg string, now time.Time) error {
	_, err := r.DB.ExecContext(ctx, `
		UPDATE laele_scheduled_tasks
		SET last_run_at=?, last_result=?, last_error=?, run_count=run_count+1, updated_at=?
		WHERE id=?`,
		now, nullStr(result), nullStr(errMsg), now, id.String(),
	)
	return err
}

// ─── helpers ─────────────────────────────────────────────────────────────────

type scannable interface {
	Scan(...any) error
}

func scanTask(row scannable) (*domain.ScheduledTask, error) {
	var (
		idS, uidS, taskTypeS, payloadRaw, cronExpr, tz string
		name, desc, lastResult, lastError               string
		activeInt, runCount                             int
		lastRunAt                                       *time.Time
		createdAt, updatedAt                            time.Time
	)
	if err := row.Scan(
		&idS, &uidS, &name, &desc, &taskTypeS, &payloadRaw,
		&cronExpr, &tz, &activeInt, &lastRunAt, &lastResult, &lastError,
		&runCount, &createdAt, &updatedAt,
	); err != nil {
		return nil, err
	}
	id, _ := uuid.Parse(idS)
	uid, _ := uuid.Parse(uidS)
	payload, _ := domain.ParsePayload(payloadRaw)
	return &domain.ScheduledTask{
		ID: id, UserID: uid, Name: name, Description: desc,
		TaskType: domain.TaskType(taskTypeS), Payload: payload,
		CronExpr: cronExpr, Timezone: tz, Active: activeInt == 1,
		LastRunAt: lastRunAt, LastResult: lastResult, LastError: lastError,
		RunCount: runCount, CreatedAt: createdAt, UpdatedAt: updatedAt,
	}, nil
}

func scanTasks(rows *sql.Rows) ([]domain.ScheduledTask, error) {
	var out []domain.ScheduledTask
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
