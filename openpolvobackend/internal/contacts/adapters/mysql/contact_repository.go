package mysql

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/contacts/domain"
	"github.com/open-polvo/open-polvo/internal/contacts/ports"
)

type ContactRepository struct {
	DB *sql.DB
}

var _ ports.ContactRepository = (*ContactRepository)(nil)

func (r ContactRepository) ListByUser(ctx context.Context, userID uuid.UUID) ([]domain.Contact, error) {
	rows, err := r.DB.QueryContext(ctx,
		`SELECT id, user_id, name, phone, email, created_at, updated_at
		 FROM laele_user_contacts WHERE user_id = ? ORDER BY name ASC`,
		userID.String(),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Contact
	for rows.Next() {
		var c domain.Contact
		if err := rows.Scan(&c.ID, &c.UserID, &c.Name, &c.Phone, &c.Email, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r ContactRepository) GetByIDAndUser(ctx context.Context, id, userID uuid.UUID) (*domain.Contact, error) {
	row := r.DB.QueryRowContext(ctx,
		`SELECT id, user_id, name, phone, email, created_at, updated_at
		 FROM laele_user_contacts WHERE id = ? AND user_id = ?`,
		id.String(), userID.String(),
	)
	var c domain.Contact
	if err := row.Scan(&c.ID, &c.UserID, &c.Name, &c.Phone, &c.Email, &c.CreatedAt, &c.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, sql.ErrNoRows
		}
		return nil, err
	}
	return &c, nil
}

func (r ContactRepository) Create(ctx context.Context, c *domain.Contact) error {
	now := time.Now().UTC()
	if c.CreatedAt.IsZero() {
		c.CreatedAt = now
	}
	c.UpdatedAt = now
	_, err := r.DB.ExecContext(ctx,
		`INSERT INTO laele_user_contacts (id, user_id, name, phone, email, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		c.ID, c.UserID, c.Name, c.Phone, c.Email, c.CreatedAt, c.UpdatedAt,
	)
	return err
}

func (r ContactRepository) Update(ctx context.Context, c *domain.Contact) error {
	c.UpdatedAt = time.Now().UTC()
	res, err := r.DB.ExecContext(ctx,
		`UPDATE laele_user_contacts SET name = ?, phone = ?, email = ?, updated_at = ?
		 WHERE id = ? AND user_id = ?`,
		c.Name, c.Phone, c.Email, c.UpdatedAt, c.ID, c.UserID,
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

func (r ContactRepository) Delete(ctx context.Context, id, userID uuid.UUID) error {
	res, err := r.DB.ExecContext(ctx,
		`DELETE FROM laele_user_contacts WHERE id = ? AND user_id = ?`,
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
