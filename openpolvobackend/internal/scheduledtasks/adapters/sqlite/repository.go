package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/scheduledtasks/domain"
	"github.com/open-polvo/open-polvo/internal/scheduledtasks/ports"
)

type ScheduledTaskRepository struct {
	DB *sql.DB
}

func parseTimeLoose(s string) time.Time {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t
	// SQLite datetime('now') → "2006-01-02 15:04:05"
	}
	if t, err := time.Parse("2006-01-02 15:04:05", s); err == nil {
		return t.UTC()
	}
	return time.Time{}
}

func timePtrFromNullable(s sql.NullString) *time.Time {
	if !s.Valid || strings.TrimSpace(s.String) == "" {
		return nil
	}
	t := parseTimeLoose(s.String)
	if t.IsZero() {
		return nil
	}
	return &t
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
		boolToInt(t.Active), t.CreatedAt.UTC().Format(time.RFC3339Nano), t.UpdatedAt.UTC().Format(time.RFC3339Nano),
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
		t.CronExpr, t.Timezone, boolToInt(t.Active), time.Now().UTC().Format(time.RFC3339Nano),
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
		now.UTC().Format(time.RFC3339Nano), nullStr(result), nullStr(errMsg), now.UTC().Format(time.RFC3339Nano), id.String(),
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
		lastRunAtRaw                                    sql.NullString
		createdAtRaw, updatedAtRaw                      string
	)
	if err := row.Scan(
		&idS, &uidS, &name, &desc, &taskTypeS, &payloadRaw,
		&cronExpr, &tz, &activeInt, &lastRunAtRaw, &lastResult, &lastError,
		&runCount, &createdAtRaw, &updatedAtRaw,
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
		LastRunAt: timePtrFromNullable(lastRunAtRaw), LastResult: lastResult, LastError: lastError,
		RunCount: runCount, CreatedAt: parseTimeLoose(createdAtRaw), UpdatedAt: parseTimeLoose(updatedAtRaw),
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
