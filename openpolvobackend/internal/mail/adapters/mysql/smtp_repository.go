package mysql

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/mail/domain"
	"github.com/open-polvo/open-polvo/internal/mail/ports"
)

type SMTPSettingsRepository struct {
	DB *sql.DB
}

var _ ports.SMTPSettingsRepository = (*SMTPSettingsRepository)(nil)

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
		updated                             time.Time
	)
	if err := row.Scan(&uid, &host, &port, &user, &passEnc, &fromEmail, &fromName, &useTLS, &skipConfirm, &updated); err != nil {
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
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE
		   host = VALUES(host), port = VALUES(port), username = VALUES(username),
		   password_enc = VALUES(password_enc), from_email = VALUES(from_email), from_name = VALUES(from_name),
		   use_tls = VALUES(use_tls), email_chat_skip_confirmation = VALUES(email_chat_skip_confirmation), updated_at = VALUES(updated_at)`,
		s.UserID, s.Host, s.Port, s.Username, passwordEnc, s.FromEmail, s.FromName, useTLS, skip, now,
	)
	return err
}
