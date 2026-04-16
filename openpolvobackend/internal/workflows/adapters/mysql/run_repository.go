package mysql

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/workflows/domain"
	"github.com/open-polvo/open-polvo/internal/workflows/ports"
)

type RunRepository struct {
	DB *sql.DB
}

var _ ports.RunRepository = (*RunRepository)(nil)

func (r RunRepository) Create(ctx context.Context, run *domain.WorkflowRun) error {
	var logBytes []byte
	if len(run.StepLog) > 0 {
		var err error
		logBytes, err = json.Marshal(run.StepLog)
		if err != nil {
			return err
		}
	}
	var errMsg any
	if run.ErrorMessage != nil {
		errMsg = *run.ErrorMessage
	}
	_, err := r.DB.ExecContext(ctx,
		`INSERT INTO laele_workflow_runs (id, workflow_id, user_id, status, step_log, error_message, created_at, finished_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		run.ID.String(), run.WorkflowID.String(), run.UserID.String(), string(run.Status),
		logBytes, errMsg, run.CreatedAt, run.FinishedAt,
	)
	return err
}

func (r RunRepository) Update(ctx context.Context, run *domain.WorkflowRun) error {
	logBytes, err := json.Marshal(run.StepLog)
	if err != nil {
		return err
	}
	var errMsg any
	if run.ErrorMessage != nil {
		errMsg = *run.ErrorMessage
	}
	res, err := r.DB.ExecContext(ctx,
		`UPDATE laele_workflow_runs SET status = ?, step_log = ?, error_message = ?, finished_at = ?
		 WHERE id = ? AND user_id = ?`,
		string(run.Status), logBytes, errMsg, run.FinishedAt, run.ID.String(), run.UserID.String(),
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

func (r RunRepository) GetByIDAndUser(ctx context.Context, id, userID uuid.UUID) (*domain.WorkflowRun, error) {
	row := r.DB.QueryRowContext(ctx,
		`SELECT id, workflow_id, user_id, status, step_log, error_message, created_at, finished_at
		 FROM laele_workflow_runs WHERE id = ? AND user_id = ?`,
		id.String(), userID.String(),
	)
	return scanRun(row)
}

func (r RunRepository) ListByWorkflow(ctx context.Context, workflowID, userID uuid.UUID, limit int) ([]domain.WorkflowRun, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := r.DB.QueryContext(ctx,
		`SELECT id, workflow_id, user_id, status, step_log, error_message, created_at, finished_at
		 FROM laele_workflow_runs WHERE workflow_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?`,
		workflowID.String(), userID.String(), limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.WorkflowRun
	for rows.Next() {
		run, err := scanRunRows(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *run)
	}
	return out, rows.Err()
}

func scanRun(row *sql.Row) (*domain.WorkflowRun, error) {
	var (
		id, wid, uid, status string
		logBytes             sql.NullString
		errMsg               sql.NullString
		created              time.Time
		finished             sql.NullTime
	)
	if err := row.Scan(&id, &wid, &uid, &status, &logBytes, &errMsg, &created, &finished); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, sql.ErrNoRows
		}
		return nil, err
	}
	return buildRun(id, wid, uid, status, logBytes, errMsg, created, finished)
}

func scanRunRows(rows *sql.Rows) (*domain.WorkflowRun, error) {
	var (
		id, wid, uid, status string
		logBytes             sql.NullString
		errMsg               sql.NullString
		created              time.Time
		finished             sql.NullTime
	)
	if err := rows.Scan(&id, &wid, &uid, &status, &logBytes, &errMsg, &created, &finished); err != nil {
		return nil, err
	}
	return buildRun(id, wid, uid, status, logBytes, errMsg, created, finished)
}

func buildRun(id, wid, uid, status string, logBytes sql.NullString, errMsg sql.NullString, created time.Time, finished sql.NullTime) (*domain.WorkflowRun, error) {
	var steps []domain.StepLogEntry
	if logBytes.Valid && logBytes.String != "" {
		_ = json.Unmarshal([]byte(logBytes.String), &steps)
	}
	rid, _ := uuid.Parse(id)
	wuuid, _ := uuid.Parse(wid)
	uuuid, _ := uuid.Parse(uid)
	run := &domain.WorkflowRun{
		ID: rid, WorkflowID: wuuid, UserID: uuuid,
		Status: domain.RunStatus(status), StepLog: steps, CreatedAt: created,
	}
	if errMsg.Valid {
		s := errMsg.String
		run.ErrorMessage = &s
	}
	if finished.Valid {
		t := finished.Time
		run.FinishedAt = &t
	}
	return run, nil
}
