package ports

import (
	"context"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/meta/domain"
)

type MetaSettingsRepository interface {
	GetByUserID(ctx context.Context, userID uuid.UUID) (*domain.MetaRecord, error)
	Upsert(ctx context.Context, s *domain.UserMetaSettings, appSecretEnc, waTokenEnc, fbTokenEnc, igTokenEnc []byte) error
}
