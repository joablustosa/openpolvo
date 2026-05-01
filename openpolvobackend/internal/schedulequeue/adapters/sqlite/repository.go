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
		it.ScheduledFor.UTC(),
		it.CreatedAt.UTC(),
		it.UpdatedAt.UTC(),
	)
	if err != nil {
		return false, err
	}
	aff, _ := res.RowsAffected()
	// MySQL costuma retornar 1 (insert) ou 2 (update por duplicate key). Queremos "true" apenas quando inseriu.
	return aff == 1, nil
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
		idS, kindS, entS, userS string
		scheduledFor           time.Time
		attempts               int
	)
	err = tx.QueryRowContext(ctx, `
		SELECT id, kind, entity_id, user_id, scheduled_for, attempts
		FROM laele_schedule_queue
		WHERE status='queued'
		  AND scheduled_for <= ?
		  AND (locked_until IS NULL OR locked_until <= ?)
		ORDER BY scheduled_for ASC
		LIMIT 1
	`, now, now).Scan(&idS, &kindS, &entS, &userS, &scheduledFor, &attempts)
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
	`, lockUntil, now, idS)
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
	`, finishedAt.UTC(), id.String())
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
	`, truncate(errMsg, 500), finishedAt.UTC(), id.String())
	return err
}

func truncate(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}

