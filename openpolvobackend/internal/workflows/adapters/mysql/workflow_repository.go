package mysql

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/workflows/domain"
	"github.com/open-polvo/open-polvo/internal/workflows/ports"
)

const wfSelectCols = `id, user_id, title, graph_json, pinned_at, schedule_cron, schedule_timezone, schedule_enabled, schedule_last_fired_at, created_at, updated_at`

type WorkflowRepository struct {
	DB *sql.DB
}

var _ ports.WorkflowRepository = (*WorkflowRepository)(nil)

func (r WorkflowRepository) Create(ctx context.Context, w *domain.Workflow) error {
	b, err := json.Marshal(w.Graph)
	if err != nil {
		return err
	}
	var cron any
	if w.ScheduleCron != nil && *w.ScheduleCron != "" {
		cron = *w.ScheduleCron
	}
	en := int64(0)
	if w.ScheduleEnabled {
		en = 1
	}
	tz := w.ScheduleTimezone
	if tz == "" {
		tz = "UTC"
	}
	_, err = r.DB.ExecContext(ctx,
		`INSERT INTO laele_workflows (id, user_id, title, graph_json, pinned_at, schedule_cron, schedule_timezone, schedule_enabled, schedule_last_fired_at, created_at, updated_at)
		 VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?)`,
		w.ID.String(), w.UserID.String(), w.Title, b, cron, tz, en, w.CreatedAt, w.UpdatedAt,
	)
	return err
}

func (r WorkflowRepository) Update(ctx context.Context, w *domain.Workflow) error {
	b, err := json.Marshal(w.Graph)
	if err != nil {
		return err
	}
	var cron any
	if w.ScheduleCron != nil && *w.ScheduleCron != "" {
		cron = *w.ScheduleCron
	}
	en := int64(0)
	if w.ScheduleEnabled {
		en = 1
	}
	tz := w.ScheduleTimezone
	if tz == "" {
		tz = "UTC"
	}
	res, err := r.DB.ExecContext(ctx,
		`UPDATE laele_workflows SET title = ?, graph_json = ?, schedule_cron = ?, schedule_timezone = ?, schedule_enabled = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
		w.Title, b, cron, tz, en, w.UpdatedAt, w.ID.String(), w.UserID.String(),
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (r WorkflowRepository) GetByIDAndUser(ctx context.Context, id, userID uuid.UUID) (*domain.Workflow, error) {
	row := r.DB.QueryRowContext(ctx,
		`SELECT `+wfSelectCols+` FROM laele_workflows WHERE id = ? AND user_id = ?`,
		id.String(), userID.String(),
	)
	return scanWorkflowFromRow(row)
}

func (r WorkflowRepository) ListByUser(ctx context.Context, userID uuid.UUID, limit int) ([]domain.Workflow, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := r.DB.QueryContext(ctx,
		`SELECT `+wfSelectCols+` FROM laele_workflows
		 WHERE user_id = ?
		 ORDER BY (pinned_at IS NULL) ASC, pinned_at DESC, updated_at DESC
		 LIMIT ?`,
		userID.String(), limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Workflow
	for rows.Next() {
		w, err := scanWorkflowFromRows(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *w)
	}
	return out, rows.Err()
}

func (r WorkflowRepository) ListSchedulable(ctx context.Context, limit int) ([]domain.Workflow, error) {
	if limit <= 0 || limit > 1000 {
		limit = 500
	}
	rows, err := r.DB.QueryContext(ctx,
		`SELECT `+wfSelectCols+` FROM laele_workflows
		 WHERE schedule_enabled = 1 AND schedule_cron IS NOT NULL AND TRIM(schedule_cron) <> ''
		 ORDER BY updated_at ASC
		 LIMIT ?`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Workflow
	for rows.Next() {
		w, err := scanWorkflowFromRows(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *w)
	}
	return out, rows.Err()
}

func (r WorkflowRepository) UpdateScheduleLastFired(ctx context.Context, workflowID uuid.UUID, t time.Time) error {
	_, err := r.DB.ExecContext(ctx,
		`UPDATE laele_workflows SET schedule_last_fired_at = ? WHERE id = ?`,
		t, workflowID.String(),
	)
	return err
}

func (r WorkflowRepository) Delete(ctx context.Context, id, userID uuid.UUID) error {
	res, err := r.DB.ExecContext(ctx,
		`DELETE FROM laele_workflows WHERE id = ? AND user_id = ?`,
		id.String(), userID.String(),
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (r WorkflowRepository) SetPinnedAt(ctx context.Context, workflowID, userID uuid.UUID, pinnedAt *time.Time) error {
	now := time.Now().UTC()
	res, err := r.DB.ExecContext(ctx,
		`UPDATE laele_workflows SET pinned_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
		pinnedAt, now, workflowID.String(), userID.String(),
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}
