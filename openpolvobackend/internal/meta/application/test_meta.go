package application

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"

	mailcrypto "github.com/open-polvo/open-polvo/internal/mail/crypto"
	"github.com/open-polvo/open-polvo/internal/meta/metaapi"
	"github.com/open-polvo/open-polvo/internal/meta/ports"
	platformcfg "github.com/open-polvo/open-polvo/internal/platform/config"
)

type TestMetaConnection struct {
	Repo   ports.MetaSettingsRepository
	Cfg    platformcfg.Config
	Client *metaapi.Client
}

// Execute verifica se pelo menos um token Meta é válido (chama GET /me na Graph API).
func (uc *TestMetaConnection) Execute(ctx context.Context, userID uuid.UUID) error {
	key := keyForMetaTokens(uc.Cfg)
	rec, err := uc.Repo.GetByUserID(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return errors.New("meta não configurado")
		}
		return err
	}
	// Testa o primeiro token disponível.
	if len(rec.FBPageTokenEnc) > 0 {
		tok, err := mailcrypto.DecryptAES256GCM(rec.FBPageTokenEnc, key)
		if err != nil {
			return errors.New("falha ao ler token Facebook")
		}
		return uc.Client.VerifyToken(ctx, string(tok))
	}
	if len(rec.IGAccessTokenEnc) > 0 {
		tok, err := mailcrypto.DecryptAES256GCM(rec.IGAccessTokenEnc, key)
		if err != nil {
			return errors.New("falha ao ler token Instagram")
		}
		return uc.Client.VerifyToken(ctx, string(tok))
	}
	if len(rec.WAAccessTokenEnc) > 0 {
		tok, err := mailcrypto.DecryptAES256GCM(rec.WAAccessTokenEnc, key)
		if err != nil {
			return errors.New("falha ao ler token WhatsApp")
		}
		return uc.Client.VerifyToken(ctx, string(tok))
	}
	return errors.New("nenhum token Meta configurado")
}
