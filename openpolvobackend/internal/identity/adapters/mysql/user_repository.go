package mysql

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/identity/domain"
	"github.com/open-polvo/open-polvo/internal/identity/ports"
)

type UserRepository struct {
	DB *sql.DB
}

func (r UserRepository) GetByEmail(ctx context.Context, email string) (*domain.User, error) {
	row := r.DB.QueryRowContext(ctx,
		`SELECT id, email, password_hash, created_at, updated_at FROM laele_users WHERE email = ? LIMIT 1`,
		email,
	)
	return r.scanUser(row)
}

func (r UserRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	row := r.DB.QueryRowContext(ctx,
		`SELECT id, email, password_hash, created_at, updated_at FROM laele_users WHERE id = ? LIMIT 1`,
		id.String(),
	)
	return r.scanUser(row)
}

func (r UserRepository) Create(ctx context.Context, u *domain.User) error {
	_, err := r.DB.ExecContext(ctx,
		`INSERT INTO laele_users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
		u.ID.String(), u.Email, u.PasswordHash, u.CreatedAt, u.UpdatedAt,
	)
	return err
}

func (r UserRepository) scanUser(row *sql.Row) (*domain.User, error) {
	var (
		idStr, email, hash string
		created, updated   time.Time
	)
	if err := row.Scan(&idStr, &email, &hash, &created, &updated); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ports.ErrNotFound
		}
		return nil, err
	}
	id, err := uuid.Parse(idStr)
	if err != nil {
		return nil, err
	}
	return &domain.User{
		ID:           id,
		Email:        email,
		PasswordHash: hash,
		CreatedAt:    created,
		UpdatedAt:    updated,
	}, nil
}
