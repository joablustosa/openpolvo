package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/contacts/domain"
	"github.com/open-polvo/open-polvo/internal/contacts/ports"
)

type ContactRepository struct {
	DB *sql.DB
}

var _ ports.ContactRepository = (*ContactRepository)(nil)

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
	}
	// SQLite datetime('now') → "2006-01-02 15:04:05"
	if t, err := time.Parse("2006-01-02 15:04:05", s); err == nil {
		return t.UTC()
	}
	return time.Time{}
}

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
		var createdRaw, updatedRaw string
		if err := rows.Scan(&c.ID, &c.UserID, &c.Name, &c.Phone, &c.Email, &createdRaw, &updatedRaw); err != nil {
			return nil, err
		}
		c.CreatedAt = parseTimeLoose(createdRaw)
		c.UpdatedAt = parseTimeLoose(updatedRaw)
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
	var createdRaw, updatedRaw string
	if err := row.Scan(&c.ID, &c.UserID, &c.Name, &c.Phone, &c.Email, &createdRaw, &updatedRaw); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, sql.ErrNoRows
		}
		return nil, err
	}
	c.CreatedAt = parseTimeLoose(createdRaw)
	c.UpdatedAt = parseTimeLoose(updatedRaw)
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
		c.ID, c.UserID, c.Name, c.Phone, c.Email,
		c.CreatedAt.UTC().Format(time.RFC3339Nano),
		c.UpdatedAt.UTC().Format(time.RFC3339Nano),
	)
	return err
}

func (r ContactRepository) Update(ctx context.Context, c *domain.Contact) error {
	c.UpdatedAt = time.Now().UTC()
	res, err := r.DB.ExecContext(ctx,
		`UPDATE laele_user_contacts SET name = ?, phone = ?, email = ?, updated_at = ?
		 WHERE id = ? AND user_id = ?`,
		c.Name, c.Phone, c.Email, c.UpdatedAt.UTC().Format(time.RFC3339Nano), c.ID, c.UserID,
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
