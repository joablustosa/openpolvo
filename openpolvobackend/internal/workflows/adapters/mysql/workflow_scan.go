package mysql

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/workflows/domain"
)

func scanWorkflowFromRow(row *sql.Row) (*domain.Workflow, error) {
	var (
		id, uid, title string
		graphBytes     []byte
		pinned         sql.NullTime
		cron           sql.NullString
		tz             string
		en             int64
		lastFired      sql.NullTime
		created, updated time.Time
	)
	err := row.Scan(
		&id, &uid, &title, &graphBytes, &pinned,
		&cron, &tz, &en, &lastFired,
		&created, &updated,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, sql.ErrNoRows
		}
		return nil, err
	}
	return buildWorkflow(id, uid, title, graphBytes, pinned, cron, tz, en, lastFired, created, updated)
}

func scanWorkflowFromRows(rows *sql.Rows) (*domain.Workflow, error) {
	var (
		id, uid, title string
		graphBytes     []byte
		pinned         sql.NullTime
		cron           sql.NullString
		tz             string
		en             int64
		lastFired      sql.NullTime
		created, updated time.Time
	)
	err := rows.Scan(
		&id, &uid, &title, &graphBytes, &pinned,
		&cron, &tz, &en, &lastFired,
		&created, &updated,
	)
	if err != nil {
		return nil, err
	}
	return buildWorkflow(id, uid, title, graphBytes, pinned, cron, tz, en, lastFired, created, updated)
}

func buildWorkflow(
	id, uid, title string,
	graphBytes []byte,
	pinned sql.NullTime,
	cron sql.NullString,
	tz string,
	en int64,
	lastFired sql.NullTime,
	created, updated time.Time,
) (*domain.Workflow, error) {
	var g domain.GraphJSON
	if err := json.Unmarshal(graphBytes, &g); err != nil {
		return nil, err
	}
	wid, _ := uuid.Parse(id)
	usr, _ := uuid.Parse(uid)
	w := &domain.Workflow{
		ID:               wid,
		UserID:           usr,
		Title:            title,
		Graph:            g,
		ScheduleTimezone: tz,
		ScheduleEnabled:  en != 0,
		CreatedAt:        created,
		UpdatedAt:        updated,
	}
	if pinned.Valid {
		t := pinned.Time
		w.PinnedAt = &t
	}
	if cron.Valid && cron.String != "" {
		s := cron.String
		w.ScheduleCron = &s
	}
	if lastFired.Valid {
		t := lastFired.Time
		w.ScheduleLastFiredAt = &t
	}
	return w, nil
}
