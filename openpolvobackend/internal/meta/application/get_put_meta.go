package application

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/google/uuid"

	mailcrypto "github.com/open-polvo/open-polvo/internal/mail/crypto"
	"github.com/open-polvo/open-polvo/internal/meta/domain"
	"github.com/open-polvo/open-polvo/internal/meta/ports"
	platformcfg "github.com/open-polvo/open-polvo/internal/platform/config"
)

type GetMyMeta struct {
	Repo ports.MetaSettingsRepository
}

type MyMetaDTO struct {
	AppID              string `json:"app_id"`
	AppSecretSet       bool   `json:"app_secret_set"`
	WAPhoneNumberID    string `json:"wa_phone_number_id"`
	WATokenSet         bool   `json:"wa_token_set"`
	FBPageID           string `json:"fb_page_id"`
	FBPageTokenSet     bool   `json:"fb_page_token_set"`
	IGAccountID        string `json:"ig_account_id"`
	IGTokenSet         bool   `json:"ig_token_set"`
	WebhookVerifyToken string `json:"webhook_verify_token"`
	UpdatedAtISO       string `json:"updated_at,omitempty"`
}

func (uc *GetMyMeta) Execute(ctx context.Context, userID uuid.UUID) (*MyMetaDTO, error) {
	rec, err := uc.Repo.GetByUserID(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return &MyMetaDTO{}, nil
		}
		return nil, err
	}
	return &MyMetaDTO{
		AppID:              rec.AppID,
		AppSecretSet:       len(rec.AppSecretEnc) > 0,
		WAPhoneNumberID:    rec.WAPhoneNumberID,
		WATokenSet:         len(rec.WAAccessTokenEnc) > 0,
		FBPageID:           rec.FBPageID,
		FBPageTokenSet:     len(rec.FBPageTokenEnc) > 0,
		IGAccountID:        rec.IGAccountID,
		IGTokenSet:         len(rec.IGAccessTokenEnc) > 0,
		WebhookVerifyToken: rec.WebhookVerifyToken,
		UpdatedAtISO:       rec.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z07:00"),
	}, nil
}

type PutMyMeta struct {
	Repo ports.MetaSettingsRepository
	Cfg  platformcfg.Config
}

type PutMyMetaInput struct {
	AppID              string
	AppSecret          string // vazio = manter existente
	WAPhoneNumberID    string
	WAAccessToken      string // vazio = manter existente
	FBPageID           string
	FBPageToken        string // vazio = manter existente
	IGAccountID        string
	IGAccessToken      string // vazio = manter existente
	WebhookVerifyToken string
}

func (uc *PutMyMeta) Execute(ctx context.Context, userID uuid.UUID, in PutMyMetaInput) error {
	key := keyForMetaTokens(uc.Cfg)

	var existing *domain.MetaRecord
	rec, err := uc.Repo.GetByUserID(ctx, userID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if err == nil {
		existing = rec
	}

	encOrKeep := func(plain string, old []byte) ([]byte, error) {
		p := strings.TrimSpace(plain)
		if p != "" {
			return mailcrypto.EncryptAES256GCM([]byte(p), key)
		}
		return old, nil
	}

	var oldAppSec, oldWA, oldFB, oldIG []byte
	if existing != nil {
		oldAppSec = existing.AppSecretEnc
		oldWA = existing.WAAccessTokenEnc
		oldFB = existing.FBPageTokenEnc
		oldIG = existing.IGAccessTokenEnc
	}

	appSecEnc, err := encOrKeep(in.AppSecret, oldAppSec)
	if err != nil {
		return err
	}
	waEnc, err := encOrKeep(in.WAAccessToken, oldWA)
	if err != nil {
		return err
	}
	fbEnc, err := encOrKeep(in.FBPageToken, oldFB)
	if err != nil {
		return err
	}
	igEnc, err := encOrKeep(in.IGAccessToken, oldIG)
	if err != nil {
		return err
	}

	s := &domain.UserMetaSettings{
		UserID:             userID.String(),
		AppID:              strings.TrimSpace(in.AppID),
		WAPhoneNumberID:    strings.TrimSpace(in.WAPhoneNumberID),
		FBPageID:           strings.TrimSpace(in.FBPageID),
		IGAccountID:        strings.TrimSpace(in.IGAccountID),
		WebhookVerifyToken: strings.TrimSpace(in.WebhookVerifyToken),
	}
	return uc.Repo.Upsert(ctx, s, appSecEnc, waEnc, fbEnc, igEnc)
}
