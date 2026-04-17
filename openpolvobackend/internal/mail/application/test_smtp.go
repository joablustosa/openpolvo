package application

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"

	mailcrypto "github.com/open-polvo/open-polvo/internal/mail/crypto"
	"github.com/open-polvo/open-polvo/internal/mail/ports"
	"github.com/open-polvo/open-polvo/internal/mail/smtpout"
	platformcfg "github.com/open-polvo/open-polvo/internal/platform/config"
)

// TestSMTPConnection verifica as credenciais SMTP do utilizador sem enviar nenhuma mensagem.
type TestSMTPConnection struct {
	Repo ports.SMTPSettingsRepository
	Cfg  platformcfg.Config
}

func (uc *TestSMTPConnection) Execute(ctx context.Context, userID uuid.UUID) error {
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
	dial := smtpout.DialConfig{Timeout: uc.Cfg.SMTPDialTimeout, Network: uc.Cfg.SMTPDialNetwork}
	return smtpout.TestConnection(
		ctx,
		dial,
		rec.Host,
		rec.Port,
		rec.Username,
		string(plain),
		rec.UseTLS,
	)
}
