package sqlite

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/workflows/domain"
)

func parseTimeLoose(v any) time.Time {
	switch x := v.(type) {
	case nil:
		return time.Time{}
	case time.Time:
		return x
	case []byte:
		return parseTimeLoose(string(x))
	case string:
		s := strings.TrimSpace(x)
		if s == "" {
			return time.Time{}
		}
		if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
			return t
		}
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			return t
		}
		// SQLite datetime('now') → "2006-01-02 15:04:05"
		if t, err := time.Parse("2006-01-02 15:04:05", s); err == nil {
			return t.UTC()
		}
		return time.Time{}
	default:
		return time.Time{}
	}
}

func timePtrFromAny(v any) *time.Time {
	t := parseTimeLoose(v)
	if t.IsZero() {
		return nil
	}
	return &t
}

func scanWorkflowFromRow(row *sql.Row) (*domain.Workflow, error) {
	var (
		id, uid, title string
		graphBytes     []byte
		cron           sql.NullString
		tz             string
		en             int64
		pinnedRaw      any
		lastFiredRaw   any
		createdRaw     any
		updatedRaw     any
	)
	err := row.Scan(
		&id, &uid, &title, &graphBytes, &pinnedRaw,
		&cron, &tz, &en, &lastFiredRaw,
		&createdRaw, &updatedRaw,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, sql.ErrNoRows
		}
		return nil, err
	}
	var pinned sql.NullTime
	if t := parseTimeLoose(pinnedRaw); !t.IsZero() {
		pinned.Valid = true
		pinned.Time = t
	}
	var lastFired sql.NullTime
	if t := parseTimeLoose(lastFiredRaw); !t.IsZero() {
		lastFired.Valid = true
		lastFired.Time = t
	}
	created := parseTimeLoose(createdRaw)
	updated := parseTimeLoose(updatedRaw)
	return buildWorkflow(id, uid, title, graphBytes, pinned, cron, tz, en, lastFired, created, updated)
}

func scanWorkflowFromRows(rows *sql.Rows) (*domain.Workflow, error) {
	var (
		id, uid, title string
		graphBytes     []byte
		cron           sql.NullString
		tz             string
		en             int64
		pinnedRaw      any
		lastFiredRaw   any
		createdRaw     any
		updatedRaw     any
	)
	err := rows.Scan(
		&id, &uid, &title, &graphBytes, &pinnedRaw,
		&cron, &tz, &en, &lastFiredRaw,
		&createdRaw, &updatedRaw,
	)
	if err != nil {
		return nil, err
	}
	var pinned sql.NullTime
	if t := parseTimeLoose(pinnedRaw); !t.IsZero() {
		pinned.Valid = true
		pinned.Time = t
	}
	var lastFired sql.NullTime
	if t := parseTimeLoose(lastFiredRaw); !t.IsZero() {
		lastFired.Valid = true
		lastFired.Time = t
	}
	created := parseTimeLoose(createdRaw)
	updated := parseTimeLoose(updatedRaw)
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
