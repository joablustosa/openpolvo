package mysql

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
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t
	}
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
		updatedRaw                          any
	)
	if err := row.Scan(&uid, &host, &port, &user, &passEnc, &fromEmail, &fromName, &useTLS, &skipConfirm, &updatedRaw); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, sql.ErrNoRows
		}
		return nil, err
	}
	updated := time.Time{}
	switch v := updatedRaw.(type) {
	case time.Time:
		updated = v
	case []byte:
		updated = parseTimeLoose(string(v))
	case string:
		updated = parseTimeLoose(v)
	default:
		updated = time.Time{}
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
			UpdatedAt:                 updated,
		},
		PasswordCipher: passEnc,
	}, nil
}

func (r SMTPSettingsRepository) Upsert(ctx context.Context, s *domain.UserSMTPSettings, passwordEnc []byte) error {
	now := time.Now().UTC()
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
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) AS new
		 ON DUPLICATE KEY UPDATE
		   host = new.host,
		   port = new.port,
		   username = new.username,
		   password_enc = new.password_enc,
		   from_email = new.from_email,
		   from_name = new.from_name,
		   use_tls = new.use_tls,
		   email_chat_skip_confirmation = new.email_chat_skip_confirmation,
		   updated_at = new.updated_at`,
		s.UserID, s.Host, s.Port, s.Username, passwordEnc, s.FromEmail, s.FromName, useTLS, skip, now,
	)
	return err
}
