package application

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/google/uuid"

	mailcrypto "github.com/open-polvo/open-polvo/internal/mail/crypto"
	"github.com/open-polvo/open-polvo/internal/mail/domain"
	"github.com/open-polvo/open-polvo/internal/mail/ports"
	platformcfg "github.com/open-polvo/open-polvo/internal/platform/config"
)

type GetMySMTP struct {
	Repo ports.SMTPSettingsRepository
}

type mySMTPDTO struct {
	Host         string `json:"host"`
	Port         int    `json:"port"`
	Username     string `json:"username"`
	PasswordSet  bool   `json:"password_set"`
	FromEmail    string `json:"from_email"`
	FromName     string `json:"from_name"`
	UseTLS       bool   `json:"use_tls"`
	UpdatedAtISO string `json:"updated_at,omitempty"`
}

func (uc *GetMySMTP) Execute(ctx context.Context, userID uuid.UUID) (*mySMTPDTO, error) {
	rec, err := uc.Repo.GetByUserID(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return &mySMTPDTO{Port: 587, UseTLS: true}, nil
		}
		return nil, err
	}
	return &mySMTPDTO{
		Host:         rec.Host,
		Port:         rec.Port,
		Username:     rec.Username,
		PasswordSet:  len(rec.PasswordCipher) > 0,
		FromEmail:    rec.FromEmail,
		FromName:     rec.FromName,
		UseTLS:       rec.UseTLS,
		UpdatedAtISO: rec.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z07:00"),
	}, nil
}

type PutMySMTP struct {
	Repo ports.SMTPSettingsRepository
	Cfg  platformcfg.Config
}

type PutMySMTPInput struct {
	Host      string
	Port      int
	Username  string
	Password  string // vazio = manter existente
	FromEmail string
	FromName  string
	UseTLS    bool
}

func (uc *PutMySMTP) Execute(ctx context.Context, userID uuid.UUID, in PutMySMTPInput) error {
	host := strings.TrimSpace(in.Host)
	if host == "" {
		return errors.New("host obrigatório")
	}
	if in.Port <= 0 || in.Port > 65535 {
		return errors.New("porta inválida")
	}
	from := strings.TrimSpace(in.FromEmail)
	if from == "" {
		return errors.New("from_email obrigatório")
	}
	key := mailcrypto.KeyForSMTPPassword(uc.Cfg)
	var enc []byte
	existing, err := uc.Repo.GetByUserID(ctx, userID)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		existing = nil
	}
	pw := strings.TrimSpace(in.Password)
	if pw != "" {
		enc, err = mailcrypto.EncryptAES256GCM([]byte(pw), key)
		if err != nil {
			return err
		}
	} else {
		if existing == nil || len(existing.PasswordCipher) == 0 {
			return errors.New("password obrigatória na primeira configuração")
		}
		enc = existing.PasswordCipher
	}
	s := &domain.UserSMTPSettings{
		UserID:    userID.String(),
		Host:      host,
		Port:      in.Port,
		Username:  strings.TrimSpace(in.Username),
		Password:  "",
		FromEmail: from,
		FromName:  strings.TrimSpace(in.FromName),
		UseTLS:    in.UseTLS,
	}
	return uc.Repo.Upsert(ctx, s, enc)
}
