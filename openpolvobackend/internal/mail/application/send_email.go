package application

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/google/uuid"

	mailcrypto "github.com/open-polvo/open-polvo/internal/mail/crypto"
	"github.com/open-polvo/open-polvo/internal/mail/ports"
	"github.com/open-polvo/open-polvo/internal/mail/smtpout"
	platformcfg "github.com/open-polvo/open-polvo/internal/platform/config"
)

type SendUserEmail struct {
	Repo ports.SMTPSettingsRepository
	Cfg  platformcfg.Config
}

type SendUserEmailInput struct {
	To      string
	Subject string
	Body    string
}

func (uc *SendUserEmail) Execute(ctx context.Context, userID uuid.UUID, in SendUserEmailInput) error {
	to := strings.TrimSpace(in.To)
	if to == "" {
		return errors.New("destinatário obrigatório")
	}
	sub := strings.TrimSpace(in.Subject)
	if sub == "" {
		return errors.New("assunto obrigatório")
	}
	rec, err := uc.Repo.GetByUserID(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return errors.New("smtp não configurado")
		}
		return err
	}
	if len(rec.PasswordCipher) == 0 {
		return errors.New("smtp não configurado")
	}
	plain, err := mailcrypto.DecryptAES256GCM(rec.PasswordCipher, mailcrypto.KeyForSMTPPassword(uc.Cfg))
	if err != nil {
		return errors.New("falha ao ler credencial SMTP (regrave a password nas definições)")
	}
	pass := string(plain)
	return smtpout.SendText(
		rec.Host,
		rec.Port,
		rec.Username,
		pass,
		rec.FromEmail,
		rec.FromName,
		rec.UseTLS,
		[]string{to},
		sub,
		in.Body,
	)
}
