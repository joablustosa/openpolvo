package mysql

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/meta/domain"
	"github.com/open-polvo/open-polvo/internal/meta/ports"
)

type MetaSettingsRepository struct {
	DB *sql.DB
}

var _ ports.MetaSettingsRepository = (*MetaSettingsRepository)(nil)

func (r MetaSettingsRepository) GetByUserID(ctx context.Context, userID uuid.UUID) (*domain.MetaRecord, error) {
	row := r.DB.QueryRowContext(ctx,
		`SELECT user_id, app_id, app_secret_enc,
		        wa_phone_number_id, wa_access_token_enc,
		        fb_page_id, fb_page_token_enc,
		        ig_account_id, ig_access_token_enc,
		        webhook_verify_token, updated_at
		 FROM laele_user_meta_settings WHERE user_id = ?`,
		userID.String(),
	)
	var (
		uid, appID, waPhoneID, fbPageID, igAccID, webhookToken string
		appSecEnc, waTokenEnc, fbTokenEnc, igTokenEnc          []byte
		updated                                                 time.Time
	)
	if err := row.Scan(
		&uid, &appID, &appSecEnc,
		&waPhoneID, &waTokenEnc,
		&fbPageID, &fbTokenEnc,
		&igAccID, &igTokenEnc,
		&webhookToken, &updated,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, sql.ErrNoRows
		}
		return nil, err
	}
	return &domain.MetaRecord{
		UserMetaSettings: domain.UserMetaSettings{
			UserID:             uid,
			AppID:              appID,
			WAPhoneNumberID:    waPhoneID,
			FBPageID:           fbPageID,
			IGAccountID:        igAccID,
			WebhookVerifyToken: webhookToken,
			UpdatedAt:          updated,
		},
		AppSecretEnc:     appSecEnc,
		WAAccessTokenEnc: waTokenEnc,
		FBPageTokenEnc:   fbTokenEnc,
		IGAccessTokenEnc: igTokenEnc,
	}, nil
}

func (r MetaSettingsRepository) Upsert(ctx context.Context, s *domain.UserMetaSettings, appSecretEnc, waTokenEnc, fbTokenEnc, igTokenEnc []byte) error {
	now := time.Now().UTC()
	_, err := r.DB.ExecContext(ctx,
		`INSERT INTO laele_user_meta_settings
		   (user_id, app_id, app_secret_enc,
		    wa_phone_number_id, wa_access_token_enc,
		    fb_page_id, fb_page_token_enc,
		    ig_account_id, ig_access_token_enc,
		    webhook_verify_token, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE
		   app_id = VALUES(app_id),
		   app_secret_enc = VALUES(app_secret_enc),
		   wa_phone_number_id = VALUES(wa_phone_number_id),
		   wa_access_token_enc = VALUES(wa_access_token_enc),
		   fb_page_id = VALUES(fb_page_id),
		   fb_page_token_enc = VALUES(fb_page_token_enc),
		   ig_account_id = VALUES(ig_account_id),
		   ig_access_token_enc = VALUES(ig_access_token_enc),
		   webhook_verify_token = VALUES(webhook_verify_token),
		   updated_at = VALUES(updated_at)`,
		s.UserID, s.AppID, appSecretEnc,
		s.WAPhoneNumberID, waTokenEnc,
		s.FBPageID, fbTokenEnc,
		s.IGAccountID, igTokenEnc,
		s.WebhookVerifyToken, now,
	)
	return err
}
