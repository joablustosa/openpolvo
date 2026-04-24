package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/mail/domain"
	"github.com/open-polvo/open-polvo/internal/mail/ports"
)

type SMTPSettingsRepository struct {
	DB *sql.DB
}

var _ ports.SMTPSettingsRepository = (*SMTPSettingsRepository)(nil)

func parseTimeLoose(s string) time.Time {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}
	}
	// Prefer RFC3339/RFC3339Nano (o que gravamos).
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t
	}
	// Fallback: formato típico sqlite/go time.String() sem timezone.
	if t, err := time.Parse("2006-01-02 15:04:05", s); err == nil {
		return t.UTC()
	}
	return time.Time{}
}

func (r SMTPSettingsRepository) GetByUserID(ctx context.Context, userID uuid.UUID) (*domain.SMTPRecord, error) {
	row := r.DB.QueryRowContext(ctx,
		`SELECT user_id, host, port, username, password_enc, from_email, from_name, use_tls, COALESCE(email_chat_skip_confirmation, 0), updated_at
		 FROM laele_user_smtp_settings WHERE user_id = ?`,
		userID.String(),
	)
	var (
		uid, host, user, fromEmail, fromName string
		port, useTLS, skipConfirm            int
		passEnc                             []byte
		updatedRaw                          string
	)
	if err := row.Scan(&uid, &host, &port, &user, &passEnc, &fromEmail, &fromName, &useTLS, &skipConfirm, &updatedRaw); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, sql.ErrNoRows
		}
		return nil, err
	}
	return &domain.SMTPRecord{
		UserSMTPSettings: domain.UserSMTPSettings{
			UserID:                    uid,
			Host:                      host,
			Port:                      port,
			Username:                  user,
			Password:                  "",
			FromEmail:                 fromEmail,
			FromName:                  fromName,
			UseTLS:                    useTLS != 0,
			EmailChatSkipConfirmation: skipConfirm != 0,
			UpdatedAt:                 parseTimeLoose(updatedRaw),
		},
		PasswordCipher: passEnc,
	}, nil
}

func (r SMTPSettingsRepository) Upsert(ctx context.Context, s *domain.UserSMTPSettings, passwordEnc []byte) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	useTLS := 0
	if s.UseTLS {
		useTLS = 1
	}
	skip := 0
	if s.EmailChatSkipConfirmation {
		skip = 1
	}
	_, err := r.DB.ExecContext(ctx,
		`INSERT INTO laele_user_smtp_settings (user_id, host, port, username, password_enc, from_email, from_name, use_tls, email_chat_skip_confirmation, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET
		   host = excluded.host, port = excluded.port, username = excluded.username,
		   password_enc = excluded.password_enc, from_email = excluded.from_email, from_name = excluded.from_name,
		   use_tls = excluded.use_tls, email_chat_skip_confirmation = excluded.email_chat_skip_confirmation, updated_at = excluded.updated_at`,
		s.UserID, s.Host, s.Port, s.Username, passwordEnc, s.FromEmail, s.FromName, useTLS, skip, now,
	)
	return err
}
