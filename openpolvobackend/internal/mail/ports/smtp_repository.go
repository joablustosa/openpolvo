package ports

import (
	"context"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/mail/domain"
)

type SMTPSettingsRepository interface {
	GetByUserID(ctx context.Context, userID uuid.UUID) (*domain.SMTPRecord, error)
	Upsert(ctx context.Context, s *domain.UserSMTPSettings, passwordEnc []byte) error
}
