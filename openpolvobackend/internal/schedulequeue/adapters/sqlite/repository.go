package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/schedulequeue/domain"
	"github.com/open-polvo/open-polvo/internal/schedulequeue/ports"
)

type Repository struct {
	DB *sql.DB
}

var _ ports.Repository = (*Repository)(nil)

// formatQueueTime grava instantes em texto de largura fixa (UTC) para comparações
// lexicográficas correctas em SQLite (TEXT). Evita RFC3339Nano com fracções de
// comprimento variável, que quebram `scheduled_for <= ?`.
func formatQueueTime(t time.Time) string {
	return t.UTC().Format("2006-01-02 15:04:05")
}

func parseQueueTime(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, errors.New("empty time")
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t.UTC(), nil
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t.UTC(), nil
	}
	if t, err := time.Parse("2006-01-02 15:04:05", s); err == nil {
		return t.UTC(), nil
	}
	return time.Time{}, errors.New("unrecognized time: " + s)
}

func (r Repository) Enqueue(ctx context.Context, it domain.Item) (bool, error) {
	if r.DB == nil {
		return false, errors.New("db não configurada")
	}
	now := time.Now().UTC()
	if it.ID == uuid.Nil {
		it.ID = uuid.New()
	}
	if it.CreatedAt.IsZero() {
		it.CreatedAt = now
	}
	it.UpdatedAt = now
	if it.ScheduledFor.IsZero() {
		return false, errors.New("scheduled_for obrigatório")
	}

	res, err := r.DB.ExecContext(ctx, `
		INSERT INTO laele_schedule_queue
		  (id, kind, entity_id, user_id, scheduled_for, status, attempts, locked_until, last_error, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, 'queued', 0, NULL, '', ?, ?)
		ON CONFLICT(kind, entity_id, scheduled_for) DO NOTHING
	`, it.ID.String(), string(it.Kind), it.EntityID.String(), it.UserID.String(),
		formatQueueTime(it.ScheduledFor.UTC()),
		formatQueueTime(it.CreatedAt.UTC()),
		formatQueueTime(it.UpdatedAt.UTC()),
	)
	if err != nil {
		return false, err
	}
	aff, _ := res.RowsAffected()
	return aff > 0, nil
}

func (r Repository) ClaimNext(ctx context.Context, now time.Time, lockTTL time.Duration) (*domain.Item, error) {
	if r.DB == nil {
		return nil, errors.New("db não configurada")
	}
	if lockTTL <= 0 {
		lockTTL = 10 * time.Minute
	}
	now = now.UTC()
	lockUntil := now.Add(lockTTL)

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var (
		idS, kindS, entS, userS, schedS string
		attempts                         int
	)
	// julianday() interpreta ISO8601 e "YYYY-MM-DD HH:MM:SS", evitando comparação TEXT
	// incorrecta entre formatos antigos (RFC3339Nano) e novos.
	nowS := formatQueueTime(now)
	err = tx.QueryRowContext(ctx, `
		SELECT id, kind, entity_id, user_id, scheduled_for, attempts
		FROM laele_schedule_queue
		WHERE status='queued'
		  AND julianday(scheduled_for) <= julianday(?)
		  AND (locked_until IS NULL OR trim(locked_until) = ''
		       OR julianday(locked_until) <= julianday(?))
		ORDER BY julianday(scheduled_for) ASC
		LIMIT 1
	`, nowS, nowS).Scan(&idS, &kindS, &entS, &userS, &schedS, &attempts)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}

	res, err := tx.ExecContext(ctx, `
		UPDATE laele_schedule_queue
		SET status='running', attempts=attempts+1, locked_until=?, updated_at=?
		WHERE id=? AND status='queued'
	`, formatQueueTime(lockUntil), formatQueueTime(now), idS)
	if err != nil {
		return nil, err
	}
	aff, _ := res.RowsAffected()
	if aff == 0 {
		// Outro worker pegou.
		return nil, nil
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	id, _ := uuid.Parse(idS)
	ent, _ := uuid.Parse(entS)
	user, _ := uuid.Parse(userS)
	scheduledFor, perr := parseQueueTime(schedS)
	if perr != nil {
		return nil, perr
	}
	it := &domain.Item{
		ID:           id,
		Kind:         domain.Kind(strings.TrimSpace(kindS)),
		EntityID:     ent,
		UserID:       user,
		ScheduledFor: scheduledFor.UTC(),
		Status:       domain.StatusRunning,
		Attempts:     attempts + 1,
	}
	return it, nil
}

func (r Repository) MarkDone(ctx context.Context, id uuid.UUID, finishedAt time.Time) error {
	if r.DB == nil {
		return errors.New("db não configurada")
	}
	_, err := r.DB.ExecContext(ctx, `
		UPDATE laele_schedule_queue
		SET status='done', locked_until=NULL, updated_at=?
		WHERE id=?
	`, formatQueueTime(finishedAt.UTC()), id.String())
	return err
}

func (r Repository) MarkError(ctx context.Context, id uuid.UUID, errMsg string, finishedAt time.Time) error {
	if r.DB == nil {
		return errors.New("db não configurada")
	}
	_, err := r.DB.ExecContext(ctx, `
		UPDATE laele_schedule_queue
		SET status='error', last_error=?, locked_until=NULL, updated_at=?
		WHERE id=?
	`, truncate(errMsg, 500), formatQueueTime(finishedAt.UTC()), id.String())
	return err
}

func truncate(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}

