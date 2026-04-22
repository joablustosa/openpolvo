package application

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/google/uuid"

	mailcrypto "github.com/open-polvo/open-polvo/internal/mail/crypto"
	"github.com/open-polvo/open-polvo/internal/meta/metaapi"
	"github.com/open-polvo/open-polvo/internal/meta/ports"
	platformcfg "github.com/open-polvo/open-polvo/internal/platform/config"
)

type SendMetaMessage struct {
	Repo   ports.MetaSettingsRepository
	Cfg    platformcfg.Config
	Client *metaapi.Client
}

type SendMetaMessageInput struct {
	Platform string // "whatsapp"
	To       string // número E.164 ou ID da thread
	Text     string
}

type SendMetaMessageResult struct {
	MessageID string `json:"message_id"`
}

func (uc *SendMetaMessage) Execute(ctx context.Context, userID uuid.UUID, in SendMetaMessageInput) (*SendMetaMessageResult, error) {
	key := keyForMetaTokens(uc.Cfg)
	rec, err := uc.Repo.GetByUserID(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errors.New("meta não configurado")
		}
		return nil, err
	}
	if strings.TrimSpace(in.Text) == "" {
		return nil, errors.New("texto obrigatório")
	}
	switch strings.ToLower(in.Platform) {
	case "whatsapp":
		if rec.WAPhoneNumberID == "" || len(rec.WAAccessTokenEnc) == 0 {
			return nil, errors.New("WhatsApp não configurado")
		}
		tok, err := mailcrypto.DecryptAES256GCM(rec.WAAccessTokenEnc, key)
		if err != nil {
			return nil, errors.New("falha ao ler token WhatsApp")
		}
		msgID, err := uc.Client.SendWhatsAppText(ctx, rec.WAPhoneNumberID, string(tok), in.To, in.Text)
		if err != nil {
			return nil, err
		}
		return &SendMetaMessageResult{MessageID: msgID}, nil
	default:
		return nil, errors.New("plataforma inválida para envio de mensagem: use 'whatsapp'")
	}
}
